import { BadRequestException, Injectable, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type { Repository } from 'typeorm';
import { RegulatorySourceFile } from '../../../platform/entities/index.js';
import { KB_FEATURE_CODE } from './regulatory-kb-commands.service.js';

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const MAX_FETCH_BYTES = 10 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 20_000;
const MAX_REDIRECTS = 3;

const PDF = 'application/pdf';
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const TXT = 'text/plain';
const HTML = 'text/html';

export interface UploadedFileLike {
  originalname: string;
  size: number;
  buffer: Buffer;
}

/** specs/platform/10-regulatory-knowledge-base-spec.md, "Source-file
 * mechanics (app-api)". regulatory_source_files is the one KB table
 * app-api writes (spec 09) — raw bytes are too large for a Temporal
 * payload, so they're stored here and agent-service's extraction
 * command reads them by file_id.
 *
 * URL fetch is also done here, not in agent-service: it isn't an LLM
 * call, and doing it here means uploads and fetches share one
 * extraction path. It's a single, human-triggered fetch — never
 * scheduled, never recursive (spec 10 non-negotiable #2). */
@Injectable()
export class RegulatorySourceFilesService {
  constructor(@InjectRepository(RegulatorySourceFile) private readonly files: Repository<RegulatorySourceFile>) {}

  async storeUpload(file: UploadedFileLike | undefined, uploadedBy: string): Promise<RegulatorySourceFile> {
    if (!file) throw new BadRequestException('Attach a PDF, DOCX or TXT file as the "file" field.');
    if (file.size > MAX_UPLOAD_BYTES) throw new PayloadTooLargeException('Uploads are limited to 20 MB.');
    const contentType = contentTypeForUpload(file.originalname, file.buffer);
    return this.store({ filename: file.originalname, contentType, content: file.buffer, uploadedBy, fetchedFromUrl: null });
  }

  async fetchAndStore(rawUrl: string, uploadedBy: string): Promise<RegulatorySourceFile> {
    const { content, contentType, finalUrl } = await fetchOnce(rawUrl);
    const filename = decodeURIComponent(new URL(finalUrl).pathname.split('/').filter(Boolean).pop() ?? '') || new URL(finalUrl).hostname;
    return this.store({ filename, contentType, content, uploadedBy, fetchedFromUrl: rawUrl });
  }

  async getWithContent(fileId: string): Promise<RegulatorySourceFile> {
    const file = await this.files
      .createQueryBuilder('f')
      .addSelect('f.content')
      .where('f.fileId = :fileId AND f.featureCode = :featureCode', { fileId, featureCode: KB_FEATURE_CODE })
      .getOne();
    if (!file) throw new NotFoundException(`No source file ${fileId}`);
    return file;
  }

  /** Called after a draft is discarded — its source file is no longer
   * referenced. A published version's file is never deleted. */
  async deleteIfOrphaned(fileId: string): Promise<void> {
    await this.files.query(
      `DELETE FROM regulatory_source_files f
       WHERE f.file_id = $1 AND NOT EXISTS (SELECT 1 FROM regulatory_documents d WHERE d.source_file_id = f.file_id)`,
      [fileId],
    );
  }

  private async store(input: {
    filename: string;
    contentType: string;
    content: Buffer;
    uploadedBy: string;
    fetchedFromUrl: string | null;
  }): Promise<RegulatorySourceFile> {
    const row = this.files.create({
      featureCode: KB_FEATURE_CODE,
      filename: input.filename.slice(0, 255),
      contentType: input.contentType,
      sizeBytes: input.content.length,
      sha256: createHash('sha256').update(input.content).digest('hex'),
      fetchedFromUrl: input.fetchedFromUrl,
      content: input.content,
      uploadedBy: input.uploadedBy,
    });
    const saved = await this.files.save(row);
    // Never echo the bytes back.
    delete (saved as Partial<RegulatorySourceFile>).content;
    return saved;
  }
}

/** Extension decides the claimed type; magic bytes must agree. */
export function contentTypeForUpload(filename: string, content: Buffer): string {
  const ext = filename.toLowerCase().split('.').pop();
  if (ext === 'pdf') {
    if (!isPdf(content)) throw new BadRequestException('This file is named .pdf but is not a PDF.');
    return PDF;
  }
  if (ext === 'docx') {
    if (!isZip(content)) throw new BadRequestException('This file is named .docx but is not a Word document.');
    return DOCX;
  }
  if (ext === 'txt') {
    if (!isUtf8Text(content)) throw new BadRequestException('This .txt file is not valid UTF-8 text.');
    return TXT;
  }
  throw new BadRequestException('Only PDF, DOCX and TXT files can be uploaded.');
}

function isPdf(b: Buffer): boolean {
  return b.subarray(0, 5).toString('latin1') === '%PDF-';
}

function isZip(b: Buffer): boolean {
  return b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;
}

function isUtf8Text(b: Buffer): boolean {
  if (b.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(b);
    return true;
  } catch {
    return false;
  }
}

async function fetchOnce(rawUrl: string): Promise<{ content: Buffer; contentType: string; finalUrl: string }> {
  let url = parseHttpUrl(rawUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    for (let hop = 0; ; hop++) {
      await assertPublicHost(url.hostname);
      let res: Response;
      try {
        res = await fetch(url, { redirect: 'manual', signal: controller.signal, headers: { 'user-agent': 'PolychoronAI-KB/1.0' } });
      } catch (err) {
        throw new BadRequestException(
          controller.signal.aborted ? 'The URL took longer than 20 seconds to respond.' : `Could not fetch the URL: ${(err as Error).message}`,
        );
      }

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location');
        if (!location || hop >= MAX_REDIRECTS) throw new BadRequestException('Too many redirects (max 3).');
        url = parseHttpUrl(new URL(location, url).toString());
        continue; // each hop re-validated
      }
      if (!res.ok) throw new BadRequestException(`The URL returned HTTP ${res.status}.`);

      const content = await readCapped(res, controller);
      return { content, contentType: contentTypeForFetch(res.headers.get('content-type'), content, url), finalUrl: url.toString() };
    }
  } finally {
    clearTimeout(timer);
  }
}

function parseHttpUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new BadRequestException('That is not a valid URL.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new BadRequestException('Only http(s) URLs can be fetched.');
  if (url.username || url.password) throw new BadRequestException('URLs with embedded credentials are not allowed.');
  return url;
}

async function readCapped(res: Response, controller: AbortController): Promise<Buffer> {
  const declared = Number(res.headers.get('content-length') ?? 0);
  if (declared > MAX_FETCH_BYTES) throw new PayloadTooLargeException('The document at that URL is larger than 10 MB.');
  const reader = res.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const parts: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_FETCH_BYTES) {
      controller.abort();
      throw new PayloadTooLargeException('The document at that URL is larger than 10 MB.');
    }
    parts.push(Buffer.from(value));
  }
  return Buffer.concat(parts);
}

function contentTypeForFetch(header: string | null, content: Buffer, url: URL): string {
  const type = (header ?? '').split(';')[0].trim().toLowerCase();
  if (type === PDF || isPdf(content)) {
    if (!isPdf(content)) throw new BadRequestException('The URL claims to be a PDF but is not one.');
    return PDF;
  }
  if (type === DOCX || (type === 'application/octet-stream' && url.pathname.toLowerCase().endsWith('.docx'))) {
    if (!isZip(content)) throw new BadRequestException('The URL claims to be a Word document but is not one.');
    return DOCX;
  }
  if (type === HTML || type === 'application/xhtml+xml') return HTML;
  if (type === TXT) return TXT;
  throw new BadRequestException(`Unsupported content type at that URL (${type || 'unknown'}) — PDF, DOCX, HTML or plain text only.`);
}

/** SSRF guard: every address the hostname resolves to must be public. */
async function assertPublicHost(hostname: string): Promise<void> {
  const host = hostname.replace(/^\[|\]$/g, '');
  let addresses: string[];
  if (isIP(host)) {
    addresses = [host];
  } else {
    try {
      addresses = (await lookup(host, { all: true, verbatim: true })).map((a) => a.address);
    } catch {
      throw new BadRequestException(`Could not resolve ${hostname}.`);
    }
  }
  if (addresses.length === 0 || addresses.some(isPrivateAddress)) {
    throw new BadRequestException('That URL points to a private or internal address and cannot be fetched.');
  }
}

export function isPrivateAddress(address: string): boolean {
  const mapped = address.toLowerCase().match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  const ip = mapped ? mapped[1] : address.toLowerCase();
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  return ip === '::' || ip === '::1' || /^f[cd]/.test(ip) || /^fe[89ab]/.test(ip);
}
