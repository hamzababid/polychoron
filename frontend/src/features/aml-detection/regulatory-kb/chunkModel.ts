import type { DraftChunk } from '../api/types';

export interface EditableChunk {
  /** Server chunk id, if this exact text is saved — needed to
   * acknowledge an injection flag. Local edits clear it. */
  chunkId: string | null;
  key: string;
  sectionReference: string;
  text: string;
  embedded: boolean;
  warnings: string[];
  injectionFlags: string[];
  injectionAcknowledged: boolean;
}

let keySeq = 0;
const nextKey = () => `c${++keySeq}`;

export function fromDraftChunks(chunks: DraftChunk[]): EditableChunk[] {
  return chunks.map((c) => ({
    chunkId: c.chunk_id,
    key: nextKey(),
    sectionReference: c.section_reference,
    text: c.text,
    embedded: c.embedded,
    warnings: c.warnings,
    injectionFlags: c.injection_flags,
    injectionAcknowledged: c.injection_acknowledged,
  }));
}

export function emptyChunk(): EditableChunk {
  return { chunkId: null, key: nextKey(), sectionReference: '', text: '', embedded: false, warnings: [], injectionFlags: [], injectionAcknowledged: false };
}

