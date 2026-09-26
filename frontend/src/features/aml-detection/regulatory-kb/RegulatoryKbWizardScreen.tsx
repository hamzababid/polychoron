import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  acknowledgeRegulatoryInjection,
  createChunkingProfile,
  createRegulatoryDraft,
  embedRegulatoryDraft,
  fetchRegulatorySourceUrl,
  getRegulatoryDocument,
  getRegulatorySourceText,
  listChunkingProfiles,
  listRegulatoryChunks,
  previewRegulatoryChunks,
  publishRegulatoryDraft,
  saveRegulatoryChunks,
  setRegulatorySourceText,
  updateRegulatoryDraft,
  uploadRegulatorySourceFile,
} from '../api/client';
import type {
  ChunkingConfig,
  ChunkingProfile,
  ChunkingStrategy,
  RegulatoryChunkRow,
  RegulatoryDocumentDetail,
  RegulatorySourceMethod,
  SourceSummary,
} from '../api/types';
import { useToast } from '../../../shell/ToastProvider';
import { useFeatureBasePath } from '../useFeatureBasePath';
import { ChunkEditor } from './ChunkEditor';
import { emptyChunk, fromDraftChunks, type EditableChunk } from './chunkModel';
import { ConfirmDialog, JobProgress, MetadataForm, RetrievalForm, Tile } from './kbShared';
import { DEFAULT_CHUNKING, errorMessage, formatBytes, metadataFromDocument, metadataToInput, missingRequired, useEmbedJob, type MetadataValues, type RetrievalValues } from './kbUtils';
import './regulatory-kb.css';

const STEPS = ['Source', 'Metadata', 'Chunking', 'Preview & adjust', 'Retrieval', 'Review & publish'] as const;
const METHODS: { value: RegulatorySourceMethod; label: string; hint: string }[] = [
  { value: 'upload', label: 'Upload file', hint: 'PDF, DOCX or TXT, up to 20 MB. PDFs need a text layer — scanned images are not OCR’d.' },
  { value: 'paste', label: 'Paste full text', hint: 'Paste the whole regulation; you choose how it’s split next.' },
  { value: 'url', label: 'Fetch from URL', hint: 'A single fetch of the official page or PDF (10 MB max). Never scheduled or recursive.' },
  { value: 'manual', label: 'Manual chunks', hint: 'Author each section reference and passage by hand.' },
];

function rowsToEditable(rows: RegulatoryChunkRow[]): EditableChunk[] {
  return fromDraftChunks(
    rows.map((r) => ({
      chunk_id: r.chunkId,
      ordinal: r.ordinal,
      section_reference: r.sectionReference,
      text: r.text,
      char_count: r.charCount,
      embedded: r.embedded,
      warnings: r.warnings,
      injection_flags: r.injectionFlags,
      injection_acknowledged: r.injectionAcknowledged,
    })),
  );
}

/** Screen 2 — Add wizard (screens/11-regulatory-knowledge-base.md).
 * The draft exists server-side from the first action onward, and its id
 * and the current step live in the URL (`?draft=…&step=…`), so a
 * refresh — or coming back from the Library — resumes exactly here.
 * `?supersedes=<id>` starts the next version of an existing document. */
export function RegulatoryKbWizardScreen() {
  const base = useFeatureBasePath();
  const navigate = useNavigate();
  const toast = useToast();
  const [params, setParams] = useSearchParams();

  const draftId = params.get('draft');
  const supersedesId = params.get('supersedes');
  const step = Math.min(6, Math.max(1, Number(params.get('step') ?? 1)));

  const [doc, setDoc] = useState<RegulatoryDocumentDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Step 1
  const [method, setMethod] = useState<RegulatorySourceMethod>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [pasted, setPasted] = useState('');
  const [url, setUrl] = useState('');
  const [summary, setSummary] = useState<SourceSummary | null>(null);
  // Step 2 / 5
  const [metadata, setMetadata] = useState<MetadataValues | null>(null);
  const [retrieval, setRetrieval] = useState<RetrievalValues | null>(null);
  // Step 3
  const [config, setConfig] = useState<ChunkingConfig>(DEFAULT_CHUNKING);
  const [profiles, setProfiles] = useState<ChunkingProfile[]>([]);
  const [sourceText, setSourceText] = useState<string | null>(null);
  const [profileName, setProfileName] = useState<string | null>(null);
  // Step 4
  const [chunks, setChunks] = useState<EditableChunk[] | null>(null);
  const [dirty, setDirty] = useState(false);
  const [confirmRechunk, setConfirmRechunk] = useState(false);
  // Step 6
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [afterEmbed, setAfterEmbed] = useState<'draft' | 'publish' | null>(null);

  const goTo = useCallback(
    (n: number, id: string | null = draftId) => {
      const next = new URLSearchParams();
      if (id) next.set('draft', id);
      next.set('step', String(n));
      setParams(next);
    },
    [draftId, setParams],
  );

  const reload = useCallback(async () => {
    if (!draftId) return null;
    const d = await getRegulatoryDocument(draftId);
    setDoc(d);
    return d;
  }, [draftId]);

  useEffect(() => {
    if (!draftId) {
      setDoc(null);
      return;
    }
    getRegulatoryDocument(draftId)
      .then((d) => {
        if (d.status !== 'draft') {
          navigate(`${base}/regulatory-kb/${d.documentId}`, { replace: true });
          return;
        }
        setDoc(d);
        const known = METHODS.find((m) => m.value === d.sourceMethod);
        setMethod(known ? known.value : 'upload');
        setMetadata(metadataFromDocument(d));
        setRetrieval({ retrieval_enabled: d.retrievalEnabled, retrieval_priority: d.retrievalPriority, related_typology_codes: d.relatedTypologyCodes });
        if (d.chunkingConfig) setConfig({ ...DEFAULT_CHUNKING, ...d.chunkingConfig });
      })
      .catch((err: unknown) => setLoadError(errorMessage(err)));
  }, [draftId, base, navigate]);

  useEffect(() => {
    if (step === 3) {
      listChunkingProfiles()
        .then(setProfiles)
        .catch(() => setProfiles([]));
      if (draftId && sourceText === null) {
        getRegulatorySourceText(draftId)
          .then((r) => setSourceText(r.text ?? ''))
          .catch(() => setSourceText(''));
      }
    }
    if (step === 4 && draftId && chunks === null) {
      listRegulatoryChunks(draftId)
        .then((rows) => setChunks(rows.length ? rowsToEditable(rows) : [emptyChunk()]))
        .catch((err: unknown) => toast.error(errorMessage(err)));
    }
  }, [step, draftId, sourceText, chunks, toast]);

  const doPublish = async () => {
    if (!draftId) return;
    setBusy(true);
    try {
      const result = await publishRegulatoryDraft(draftId);
      toast.success(
        result.superseded_document_id
          ? 'Published — the previous version is now superseded and retained.'
          : 'Published — this document is now available to agents.',
      );
      navigate(`${base}/regulatory-kb/${draftId}`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
      setAfterEmbed(null);
      setConfirmPublish(false);
    }
  };

  const { job, track, running } = useEmbedJob((finished) => {
    void reload();
    if (finished.status !== 'completed') {
      toast.error(finished.error ?? 'Embedding failed.');
      setAfterEmbed(null);
      return;
    }
    if (afterEmbed === 'publish') void doPublish();
    else if (afterEmbed === 'draft') {
      toast.success('Draft saved and embedded — it is not visible to agents until published.');
      navigate(`${base}/regulatory-kb/${draftId}`);
    }
  });

  const isManual = (doc?.sourceMethod ?? method) === 'manual';

  // ── actions ──────────────────────────────────────────────────────

  const ensureDraft = async (sourceMethod: RegulatorySourceMethod): Promise<string> => {
    if (draftId) return draftId;
    const created = await createRegulatoryDraft({ source_method: sourceMethod, supersedes_document_id: supersedesId ?? undefined });
    return created.document_id;
  };

  const runSource = async () => {
    setBusy(true);
    try {
      const id = await ensureDraft(method);
      if (method === 'manual') {
        if (!draftId) goTo(2, id);
        else goTo(2);
        return;
      }
      let result: SourceSummary;
      if (method === 'upload') {
        if (!file) throw new Error('Choose a file first.');
        result = await uploadRegulatorySourceFile(id, file);
      } else if (method === 'paste') {
        if (!pasted.trim()) throw new Error('Paste the text first.');
        result = await setRegulatorySourceText(id, pasted);
      } else {
        if (!url.trim()) throw new Error('Enter the URL first.');
        result = await fetchRegulatorySourceUrl(id, url.trim());
      }
      setSummary(result);
      setSourceText(null);
      if (!draftId) {
        const next = new URLSearchParams();
        next.set('draft', id);
        next.set('step', '1');
        setParams(next, { replace: true });
      } else {
        void reload();
      }
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const saveMetadata = async (): Promise<boolean> => {
    if (!draftId || !metadata) return false;
    setBusy(true);
    try {
      await updateRegulatoryDraft(draftId, metadataToInput(metadata));
      await reload();
      return true;
    } catch (err) {
      toast.error(errorMessage(err));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const generatePreview = async () => {
    if (!draftId) return;
    setBusy(true);
    try {
      const result = await previewRegulatoryChunks(draftId, config);
      setChunks(fromDraftChunks(result.chunks));
      setDirty(false);
      toast.success(`${result.chunks.length} chunk(s) previewed — nothing embedded yet.`);
      goTo(4);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const saveChunks = async (): Promise<boolean> => {
    if (!draftId || !chunks) return false;
    const invalid = chunks.findIndex((c) => !c.sectionReference.trim() || !c.text.trim());
    if (invalid >= 0) {
      toast.error(`Chunk ${invalid + 1} needs both a section reference and text.`);
      return false;
    }
    setBusy(true);
    try {
      const result = await saveRegulatoryChunks(
        draftId,
        chunks.map((c) => ({ section_reference: c.sectionReference.trim(), text: c.text.trim() })),
      );
      setChunks(fromDraftChunks(result.chunks));
      setDirty(false);
      void reload();
      return true;
    } catch (err) {
      toast.error(errorMessage(err));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const acknowledge = async (chunkId: string) => {
    if (!draftId) return;
    try {
      await acknowledgeRegulatoryInjection(draftId, chunkId);
      setChunks((prev) => prev?.map((c) => (c.chunkId === chunkId ? { ...c, injectionAcknowledged: true } : c)) ?? prev);
      void reload();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const saveRetrieval = async (): Promise<boolean> => {
    if (!draftId || !retrieval) return false;
    setBusy(true);
    try {
      await updateRegulatoryDraft(draftId, retrieval);
      await reload();
      return true;
    } catch (err) {
      toast.error(errorMessage(err));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const saveProfile = async () => {
    if (!profileName?.trim()) return;
    try {
      await createChunkingProfile(profileName.trim(), config);
      toast.success(`Saved chunking profile “${profileName.trim()}”.`);
      setProfileName(null);
      setProfiles(await listChunkingProfiles());
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const finish = async (mode: 'draft' | 'publish') => {
    if (!draftId || !doc) return;
    setConfirmPublish(false);
    if (doc.embeddedCount < doc.chunkCount) {
      setAfterEmbed(mode);
      try {
        const { jobId } = await embedRegulatoryDraft(draftId);
        track(jobId);
      } catch (err) {
        toast.error(errorMessage(err));
        setAfterEmbed(null);
      }
      return;
    }
    if (mode === 'publish') await doPublish();
    else navigate(`${base}/regulatory-kb/${draftId}`);
  };

  // ── derived ──────────────────────────────────────────────────────

  const regexInfo = useMemo(() => {
    if (config.strategy !== 'heading_pattern' || !config.heading_pattern) return null;
    try {
      const re = new RegExp(config.heading_pattern, 'gm');
      if (sourceText === null) return { count: null as number | null, error: null as string | null };
      return { count: (sourceText.match(re) ?? []).length, error: null };
    } catch (err) {
      return { count: null, error: errorMessage(err) };
    }
  }, [config.strategy, config.heading_pattern, sourceText]);

  const missing = metadata ? missingRequired(metadata) : [];
  const reachable = (n: number) => {
    if (!draftId) return n === 1;
    if (n === 3 && isManual) return false;
    if (n === 3) return Boolean(doc?.hasExtractedText);
    if (n >= 4) return (doc?.chunkCount ?? 0) > 0 || (n === 4 && isManual);
    return true;
  };

  if (loadError) return <div className="aml-status aml-status--error">{loadError}</div>;
  if (draftId && !doc) return <div className="aml-status">Loading draft…</div>;

  const next = (n: number) => goTo(isManual && n === 3 ? 4 : n);
  const back = (n: number) => goTo(isManual && n === 3 ? 2 : n);

  return (
    <div className="kb-screen">
      <div className="kb-wizard">
        <nav className="kb-steps" aria-label="Steps">
          {STEPS.map((label, i) => {
            const n = i + 1;
            const skipped = n === 3 && isManual;
            return (
              <button
                key={label}
                className={`kb-steps__item ${n === step ? 'kb-steps__item--active' : ''} ${n < step ? 'kb-steps__item--done' : ''}`}
                disabled={!reachable(n) || n === step}
                onClick={() => goTo(n)}
              >
                <span className="kb-steps__n">{n}</span>
                <span>
                  {label}
                  {skipped && <span className="kb-muted"> (skipped — manual)</span>}
                </span>
              </button>
            );
          })}
          {doc && (
            <div className="kb-steps__meta">
              <div className="microlabel">Draft</div>
              <div>{doc.title}</div>
              <div className="kb-muted">
                v{doc.versionNumber}
                {doc.family.versionCount > 1 && ' · new version of an existing document'}
              </div>
              <div className="kb-muted">Saved automatically — you can leave and resume from the Library.</div>
            </div>
          )}
        </nav>

        <div className="kb-wizard__body scrollcol">
          {step === 1 && (
            <Tile title="1 · Source">
              {doc?.hasExtractedText && !summary && (
                <div className="kb-callout">
                  This draft already has source text
                  {doc.sourceFile ? ` from ${doc.sourceFile.filename} (${formatBytes(doc.sourceFile.sizeBytes)})` : ''}. You can continue, or replace it
                  below.
                </div>
              )}
              <div className="seg kb-seg" role="radiogroup">
                {METHODS.map((m) => (
                  <label key={m.value} className="seg-opt">
                    <input type="radio" name="method" checked={method === m.value} onChange={() => setMethod(m.value)} disabled={Boolean(draftId) && isManual} />
                    {m.label}
                  </label>
                ))}
              </div>
              <p className="kb-muted">{METHODS.find((m) => m.value === method)?.hint}</p>

              {method === 'upload' && (
                <div className="field">
                  <label>File</label>
                  <input className="input" type="file" accept=".pdf,.docx,.txt" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                  {file && <div className="kb-muted">{formatBytes(file.size)}</div>}
                </div>
              )}
              {method === 'paste' && (
                <div className="field">
                  <label>Full text</label>
                  <textarea className="input kb-paste" value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder="Paste the regulation here…" />
                  <div className="kb-muted">{pasted.length.toLocaleString()} characters</div>
                </div>
              )}
              {method === 'url' && (
                <div className="field">
                  <label>Official URL</label>
                  <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.sbp.org.pk/…" />
                </div>
              )}

              {summary && (
                <div className="kb-extract">
                  <div className="microlabel">
                    Extracted {summary.char_count.toLocaleString()} characters{summary.page_count ? ` from ${summary.page_count} page(s)` : ''}
                  </div>
                  <pre className="kb-extract__excerpt">{summary.excerpt}</pre>
                </div>
              )}

              <div className="kb-actions">
                <button className="aml-btn" onClick={() => navigate(`${base}/regulatory-kb`)}>
                  Cancel
                </button>
                {method !== 'manual' && (
                  <button className="aml-btn" onClick={() => void runSource()} disabled={busy}>
                    {busy ? 'Extracting…' : summary || doc?.hasExtractedText ? 'Replace source text' : 'Extract text'}
                  </button>
                )}
                <button
                  className="aml-btn aml-btn--primary"
                  disabled={busy || (method !== 'manual' && !summary && !doc?.hasExtractedText)}
                  onClick={() => (method === 'manual' ? void runSource() : goTo(2))}
                >
                  Continue →
                </button>
              </div>
            </Tile>
          )}

          {step === 2 && metadata && (
            <Tile title="2 · Metadata">
              <MetadataForm value={metadata} onChange={setMetadata} />
              {missing.length > 0 && <div className="kb-callout">Needed before publishing: {missing.join(', ')}.</div>}
              <div className="kb-actions">
                <button className="aml-btn" onClick={() => back(1)}>
                  ← Back
                </button>
                <button className="aml-btn aml-btn--primary" disabled={busy} onClick={() => void saveMetadata().then((ok) => ok && next(3))}>
                  Save & continue →
                </button>
              </div>
            </Tile>
          )}

          {step === 3 && (
            <Tile title="3 · Chunking configuration">
              {profiles.length > 0 && (
                <div className="field">
                  <label>Apply a saved profile</label>
                  <select
                    className="input"
                    value=""
                    onChange={(e) => {
                      const p = profiles.find((x) => x.profileId === e.target.value);
                      if (p) setConfig({ ...DEFAULT_CHUNKING, ...p.config });
                    }}
                  >
                    <option value="">Choose a profile…</option>
                    {profiles.map((p) => (
                      <option key={p.profileId} value={p.profileId}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="field">
                <label>Strategy</label>
                <div className="seg">
                  {(
                    [
                      ['heading_pattern', 'By heading pattern'],
                      ['paragraph', 'By paragraph'],
                      ['fixed_size', 'Fixed size'],
                    ] as [ChunkingStrategy, string][]
                  ).map(([value, label]) => (
                    <label key={value} className="seg-opt">
                      <input type="radio" name="strategy" checked={config.strategy === value} onChange={() => setConfig({ ...config, strategy: value })} />
                      {label}
                    </label>
                  ))}
                </div>
              </div>

              {config.strategy === 'heading_pattern' && (
                <div className="field">
                  <label>Heading pattern (regular expression, matched at the start of a line)</label>
                  <input
                    className="input kb-mono"
                    value={config.heading_pattern ?? ''}
                    onChange={(e) => setConfig({ ...config, heading_pattern: e.target.value })}
                    placeholder="^Section \d+"
                  />
                  <div className={regexInfo?.error ? 'kb-error' : 'kb-muted'}>
                    {regexInfo?.error
                      ? `Invalid pattern: ${regexInfo.error}`
                      : regexInfo?.count === null || regexInfo === null
                        ? 'Counting matches…'
                        : `${regexInfo.count} heading match${regexInfo.count === 1 ? '' : 'es'} found in the source text`}
                  </div>
                </div>
              )}

              <div className="kb-form">
                <div className="field">
                  <label>Target chunk size (chars)</label>
                  <input className="input" type="number" min={100} value={config.target_chunk_chars} onChange={(e) => setConfig({ ...config, target_chunk_chars: Number(e.target.value) })} />
                </div>
                <div className="field">
                  <label>Max chunk size (chars)</label>
                  <input className="input" type="number" min={100} value={config.max_chunk_chars} onChange={(e) => setConfig({ ...config, max_chunk_chars: Number(e.target.value) })} />
                </div>
                <div className="field">
                  <label>Overlap (chars) — carried into the next piece when a section is split</label>
                  <input className="input" type="number" min={0} value={config.overlap_chars} onChange={(e) => setConfig({ ...config, overlap_chars: Number(e.target.value) })} />
                </div>
                <div className="field">
                  <label>Min chunk size (chars) — smaller fragments merge into the previous chunk</label>
                  <input className="input" type="number" min={0} value={config.min_chunk_chars} onChange={(e) => setConfig({ ...config, min_chunk_chars: Number(e.target.value) })} />
                </div>
                <div className="field">
                  <label>Section reference</label>
                  <select
                    className="input"
                    value={config.section_reference_mode}
                    onChange={(e) => setConfig({ ...config, section_reference_mode: e.target.value as ChunkingConfig['section_reference_mode'] })}
                  >
                    <option value="from_heading">From the matched heading</option>
                    <option value="template">From a template</option>
                  </select>
                </div>
                {config.section_reference_mode === 'template' && (
                  <div className="field">
                    <label>Template — {'{title}'}, {'{n}'}, {'{heading}'}</label>
                    <input className="input kb-mono" value={config.section_reference_template ?? ''} onChange={(e) => setConfig({ ...config, section_reference_template: e.target.value })} />
                  </div>
                )}
              </div>
              <label className="kb-toggle">
                <input type="checkbox" checked={config.strip_headers_footers} onChange={(e) => setConfig({ ...config, strip_headers_footers: e.target.checked })} />
                <span>Strip page numbers and repeated running headers/footers</span>
              </label>

              <div className="kb-actions">
                <button className="aml-btn" onClick={() => back(2)}>
                  ← Back
                </button>
                <button className="aml-btn" onClick={() => setProfileName('')}>
                  Save as profile…
                </button>
                <button className="aml-btn aml-btn--primary" disabled={busy || Boolean(regexInfo?.error)} onClick={() => void generatePreview()}>
                  {busy ? 'Chunking…' : 'Generate preview →'}
                </button>
              </div>
            </Tile>
          )}

          {step === 4 && (
            <Tile
              title="4 · Preview & adjust"
              actions={
                chunks && (
                  <span className="kb-muted">
                    {chunks.length} chunks · {chunks.reduce((n, c) => n + c.text.length, 0).toLocaleString()} chars ·{' '}
                    {chunks.reduce((n, c) => n + c.warnings.length, 0)} warnings
                    {dirty && <strong className="kb-unsaved"> · unsaved changes</strong>}
                  </span>
                )
              }
            >
              <p className="kb-muted">
                Nothing is embedded until you continue. Edit, split, merge, reorder or delete chunks so each is one citable passage. Text flagged as a possible
                injected instruction must be acknowledged before publishing.
              </p>
              {!chunks ? (
                <div className="aml-status">Loading chunks…</div>
              ) : (
                <ChunkEditor
                  chunks={chunks}
                  dirty={dirty}
                  onChange={(c) => {
                    setChunks(c);
                    setDirty(true);
                  }}
                  onAcknowledge={(id) => void acknowledge(id)}
                />
              )}
              <div className="kb-actions">
                <button className="aml-btn" onClick={() => (isManual ? back(2) : dirty ? setConfirmRechunk(true) : back(3))}>
                  {isManual ? '← Back' : '← Re-chunk'}
                </button>
                <button className="aml-btn" disabled={!dirty || busy} onClick={() => void saveChunks()}>
                  Save changes
                </button>
                <button
                  className="aml-btn aml-btn--primary"
                  disabled={busy || !chunks?.length}
                  onClick={() => void (dirty ? saveChunks() : Promise.resolve(true)).then((ok) => ok && goTo(5))}
                >
                  Continue →
                </button>
              </div>
            </Tile>
          )}

          {step === 5 && retrieval && (
            <Tile title="5 · Retrieval settings">
              <RetrievalForm value={retrieval} onChange={setRetrieval} />
              <div className="kb-actions">
                <button className="aml-btn" onClick={() => goTo(4)}>
                  ← Back
                </button>
                <button className="aml-btn aml-btn--primary" disabled={busy} onClick={() => void saveRetrieval().then((ok) => ok && goTo(6))}>
                  Save & continue →
                </button>
              </div>
            </Tile>
          )}

          {step === 6 && doc && (
            <Tile title="6 · Review & publish">
              <dl className="kb-dl">
                <dt>Title</dt>
                <dd>{doc.title}</dd>
                <dt>Version</dt>
                <dd>
                  v{doc.versionNumber} · {doc.versionLabel || '—'}
                </dd>
                <dt>Issuer / type</dt>
                <dd>
                  {doc.issuingAuthority || '—'} · {doc.sourceType}
                </dd>
                <dt>Source</dt>
                <dd>
                  {doc.sourceMethod}
                  {doc.sourceFile && ` · ${doc.sourceFile.filename}`}
                  {doc.sourceUrl && (
                    <>
                      {' · '}
                      <a href={doc.sourceUrl} target="_blank" rel="noreferrer">
                        official publication ↗
                      </a>
                    </>
                  )}
                </dd>
                <dt>Chunks</dt>
                <dd>
                  {doc.chunkCount} ({doc.embeddedCount} embedded)
                </dd>
                <dt>Retrieval</dt>
                <dd>
                  {doc.retrievalEnabled ? 'available to agents' : 'not available to agents'} · priority {doc.retrievalPriority.toFixed(1)}×
                  {doc.relatedTypologyCodes.length > 0 && ` · only for ${doc.relatedTypologyCodes.join(', ')}`}
                </dd>
                <dt>Supersedes</dt>
                <dd>{doc.family.currentDocumentId ? 'the current version of this document (retained, not deleted)' : '— (a new document)'}</dd>
              </dl>

              {missing.length > 0 && <div className="kb-callout kb-callout--alert">Fill in before publishing: {missing.join(', ')} (step 2).</div>}
              {doc.unacknowledgedInjectionCount > 0 && (
                <div className="kb-callout kb-callout--alert">
                  {doc.unacknowledgedInjectionCount} chunk(s) have unacknowledged injection flags (step 4).
                </div>
              )}

              <JobProgress job={job} />

              <div className="kb-actions">
                <button className="aml-btn" onClick={() => goTo(5)} disabled={running}>
                  ← Back
                </button>
                <button className="aml-btn" disabled={running || busy} onClick={() => void finish('draft')}>
                  {doc.embeddedCount < doc.chunkCount ? 'Embed & save as draft' : 'Save as draft'}
                </button>
                <button
                  className="aml-btn aml-btn--primary"
                  disabled={running || busy || missing.length > 0 || doc.unacknowledgedInjectionCount > 0 || doc.chunkCount === 0}
                  onClick={() => setConfirmPublish(true)}
                >
                  Publish…
                </button>
              </div>
            </Tile>
          )}
        </div>
      </div>

      {profileName !== null && (
        <ConfirmDialog title="Save chunking profile" confirmLabel="Save profile" disabled={!profileName.trim()} onCancel={() => setProfileName(null)} onConfirm={() => void saveProfile()}>
          <div className="field">
            <label>Profile name</label>
            <input className="input" autoFocus value={profileName} onChange={(e) => setProfileName(e.target.value)} placeholder="e.g. SBP Regulations — by regulation number" />
          </div>
        </ConfirmDialog>
      )}

      {confirmRechunk && (
        <ConfirmDialog
          title="Re-chunk this draft?"
          confirmLabel="Discard adjustments"
          onCancel={() => setConfirmRechunk(false)}
          onConfirm={() => {
            setConfirmRechunk(false);
            setDirty(false);
            goTo(3);
          }}
        >
          Generating a new preview replaces the current chunks, including any manual adjustments you haven't saved.
        </ConfirmDialog>
      )}

      {confirmPublish && doc && (
        <ConfirmDialog title="Publish this document?" confirmLabel={doc.embeddedCount < doc.chunkCount ? 'Embed & publish' : 'Publish'} onCancel={() => setConfirmPublish(false)} onConfirm={() => void finish('publish')}>
          <p>
            <strong>{doc.chunkCount}</strong> chunk(s) of “{doc.title}” become {doc.retrievalEnabled ? 'retrievable and citable by agents' : 'current (but not retrievable — agent access is off)'}.
          </p>
          {doc.family.currentDocumentId && (
            <p>The version currently in force becomes <strong>superseded</strong>. It is retained, never deleted — past cases stay explainable against it.</p>
          )}
          {doc.embeddedCount < doc.chunkCount && <p className="kb-muted">{doc.chunkCount - doc.embeddedCount} chunk(s) will be embedded first.</p>}
        </ConfirmDialog>
      )}
    </div>
  );
}
