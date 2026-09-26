import { useRef } from 'react';
import { WARNING_LABEL } from './kbUtils';
import { emptyChunk, type EditableChunk } from './chunkModel';

/** Local edits invalidate everything the server computed for the chunk. */
function edited(c: EditableChunk, patch: Partial<EditableChunk>): EditableChunk {
  return { ...c, ...patch, chunkId: null, embedded: false, warnings: [], injectionFlags: [], injectionAcknowledged: false };
}

/** Wizard step 4 — "Preview & adjust". Nothing here is embedded until
 * the officer moves on; every change is local until saved as the whole
 * ordered list (PUT .../drafts/:id/chunks). */
export function ChunkEditor({
  chunks,
  onChange,
  onAcknowledge,
  dirty,
}: {
  chunks: EditableChunk[];
  onChange: (chunks: EditableChunk[]) => void;
  onAcknowledge: (chunkId: string) => void;
  dirty: boolean;
}) {
  const textareas = useRef(new Map<string, HTMLTextAreaElement>());

  const update = (i: number, patch: Partial<EditableChunk>) => onChange(chunks.map((c, idx) => (idx === i ? edited(c, patch) : c)));
  const remove = (i: number) => onChange(chunks.filter((_, idx) => idx !== i));
  const insertAfter = (i: number) => onChange([...chunks.slice(0, i + 1), emptyChunk(), ...chunks.slice(i + 1)]);
  const mergeWithNext = (i: number) => {
    const a = chunks[i];
    const b = chunks[i + 1];
    onChange([...chunks.slice(0, i), edited(a, { text: `${a.text}\n\n${b.text}` }), ...chunks.slice(i + 2)]);
  };
  const splitAtCursor = (i: number) => {
    const el = textareas.current.get(chunks[i].key);
    const at = el?.selectionStart ?? 0;
    const c = chunks[i];
    const head = c.text.slice(0, at).trim();
    const tail = c.text.slice(at).trim();
    if (!head || !tail) return;
    const second = { ...emptyChunk(), sectionReference: `${c.sectionReference} (cont.)`, text: tail };
    onChange([...chunks.slice(0, i), edited(c, { text: head }), second, ...chunks.slice(i + 1)]);
  };
  const move = (i: number, delta: number) => {
    const j = i + delta;
    if (j < 0 || j >= chunks.length) return;
    const next = [...chunks];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };

  return (
    <div className="kb-chunks">
      {chunks.map((c, i) => {
        const unacknowledged = c.injectionFlags.length > 0 && !c.injectionAcknowledged;
        return (
          <div key={c.key} className={`kb-chunk ${unacknowledged ? 'kb-chunk--flagged' : ''}`}>
            <div className="kb-chunk__head">
              <span className="kb-chunk__ordinal">{i + 1}</span>
              <input
                className="input kb-chunk__ref"
                value={c.sectionReference}
                placeholder="Section reference, e.g. Section 7A(1)"
                onChange={(e) => update(i, { sectionReference: e.target.value })}
              />
              <span className="kb-muted kb-chunk__chars">{c.text.length.toLocaleString()} chars</span>
              {c.embedded && <span className="tag tag-neutral">embedded</span>}
              {c.warnings.map((w) => (
                <span key={w} className="tag kb-warn">
                  {WARNING_LABEL[w] ?? w}
                </span>
              ))}
            </div>
            <textarea
              ref={(el) => {
                if (el) textareas.current.set(c.key, el);
                else textareas.current.delete(c.key);
              }}
              className="input kb-chunk__text"
              rows={Math.min(12, Math.max(3, Math.ceil(c.text.length / 110)))}
              value={c.text}
              placeholder="Passage text, exactly as published"
              onChange={(e) => update(i, { text: e.target.value })}
            />
            {c.injectionFlags.length > 0 && (
              <div className={`kb-injection ${c.injectionAcknowledged ? 'kb-injection--ok' : ''}`}>
                {c.injectionAcknowledged ? (
                  <>Instruction-like text acknowledged — it will be treated as data, never as an instruction.</>
                ) : (
                  <>
                    <strong>Possible injected instruction</strong> ({c.injectionFlags.length} pattern
                    {c.injectionFlags.length === 1 ? '' : 's'}). Confirm this is genuine regulatory wording before publishing.
                    <button
                      className="aml-btn"
                      disabled={!c.chunkId || dirty}
                      title={!c.chunkId || dirty ? 'Save your changes first' : undefined}
                      onClick={() => c.chunkId && onAcknowledge(c.chunkId)}
                    >
                      Acknowledge
                    </button>
                  </>
                )}
              </div>
            )}
            <div className="kb-chunk__actions">
              <button className="btn btn-ghost" onClick={() => move(i, -1)} disabled={i === 0}>
                ↑
              </button>
              <button className="btn btn-ghost" onClick={() => move(i, 1)} disabled={i === chunks.length - 1}>
                ↓
              </button>
              <button className="btn btn-ghost" onClick={() => splitAtCursor(i)} title="Place the cursor in the text, then split there">
                Split at cursor
              </button>
              <button className="btn btn-ghost" onClick={() => mergeWithNext(i)} disabled={i === chunks.length - 1}>
                Merge with next
              </button>
              <button className="btn btn-ghost" onClick={() => insertAfter(i)}>
                + Add below
              </button>
              <button className="btn btn-ghost kb-danger" onClick={() => remove(i)} disabled={chunks.length === 1}>
                Delete
              </button>
            </div>
          </div>
        );
      })}
      {chunks.length === 0 && (
        <button className="aml-btn" onClick={() => onChange([emptyChunk()])}>
          + Add first chunk
        </button>
      )}
    </div>
  );
}
