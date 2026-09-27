import { useEffect, useRef, useState } from 'react';
import { Pagination } from '../shared/Pagination';
import { WARNING_LABEL } from './kbUtils';
import { emptyChunk, type EditableChunk } from './chunkModel';

const PAGE_SIZES = [10, 25, 50];

/** Anything an officer has to look at before publishing. */
const needsAttention = (c: EditableChunk) =>
  c.warnings.length > 0 || (c.injectionFlags.length > 0 && !c.injectionAcknowledged) || !c.text.trim();

/** Local edits invalidate everything the server computed for the chunk. */
function edited(c: EditableChunk, patch: Partial<EditableChunk>): EditableChunk {
  return { ...c, ...patch, chunkId: null, embedded: false, warnings: [], injectionFlags: [], injectionAcknowledged: false };
}

/** Wizard step 4 — "Preview & adjust". Nothing here is embedded until
 * the officer moves on; every change is local until saved as the whole
 * ordered list (PUT .../drafts/:id/chunks).
 *
 * A long document produces dozens of chunks, so they're paged inside a
 * bounded, scrolling frame (the step's Back/Save/Continue stay in view
 * below it), with a "needs attention" filter and jump-to-chunk. Edits
 * still work on positions in the full list; after one that creates or
 * moves a chunk, the view follows that chunk to whatever page it's on. */
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
  const frame = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0]);
  // The filter shows the chunks that needed attention when it was
  // switched on — a snapshot, so fixing one doesn't make it vanish
  // mid-edit. null = filter off.
  const [attentionKeys, setAttentionKeys] = useState<Set<string> | null>(null);
  const attentionOnly = attentionKeys !== null;
  const [jumpTo, setJumpTo] = useState('');
  // Key of a chunk to bring into view once the next render has it.
  const revealKey = useRef<string | null>(null);

  // Positions (in the full list) of the chunks currently listed.
  // Saving reloads the list with fresh keys; a snapshot that no longer
  // matches anything falls back to what needs attention now.
  const snapshotLive = !!attentionKeys && chunks.some((c) => attentionKeys.has(c.key));
  const inFilter = (c: EditableChunk) => !attentionKeys || (snapshotLive ? attentionKeys.has(c.key) : needsAttention(c));
  const listed = chunks.map((c, i) => ({ c, i })).filter(({ c }) => inFilter(c));
  const attentionCount = chunks.filter(needsAttention).length;
  const totalPages = Math.max(1, Math.ceil(listed.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageItems = listed.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const goToPage = (p: number) => {
    setPage(p);
    frame.current?.scrollTo({ top: 0 });
  };

  /** Show the chunk at full-list position `i` of `next`, switching page
   * (and dropping the filter if it would hide it). */
  const reveal = (next: EditableChunk[], i: number) => {
    const target = next[i];
    if (!target) return;
    // A chunk created or moved while filtering joins the filtered view,
    // rather than silently turning the filter off.
    const keys = attentionKeys && !attentionKeys.has(target.key) ? new Set([...attentionKeys, target.key]) : attentionKeys;
    if (keys !== attentionKeys) setAttentionKeys(keys);
    const pool = next.map((c, idx) => ({ c, idx })).filter(({ c }) => !keys || keys.has(c.key)).map(({ idx }) => idx);
    setPage(Math.floor(pool.indexOf(i) / pageSize) + 1);
    revealKey.current = target.key;
  };

  // After every render: if a chunk is waiting to be revealed and is now
  // on screen, scroll it into view inside the frame.
  useEffect(() => {
    const key = revealKey.current;
    if (!key) return;
    const el = frame.current?.querySelector(`[data-chunk-key="${CSS.escape(key)}"]`);
    if (!el) return;
    revealKey.current = null;
    el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });

  const apply = (next: EditableChunk[], revealAt?: number) => {
    onChange(next);
    if (revealAt !== undefined) reveal(next, revealAt);
  };

  const update = (i: number, patch: Partial<EditableChunk>) => onChange(chunks.map((c, idx) => (idx === i ? edited(c, patch) : c)));
  const remove = (i: number) => onChange(chunks.filter((_, idx) => idx !== i));
  const insertAfter = (i: number) => apply([...chunks.slice(0, i + 1), emptyChunk(), ...chunks.slice(i + 1)], i + 1);
  const mergeWithNext = (i: number) => {
    const a = chunks[i];
    const b = chunks[i + 1];
    apply([...chunks.slice(0, i), edited(a, { text: `${a.text}\n\n${b.text}` }), ...chunks.slice(i + 2)], i);
  };
  const splitAtCursor = (i: number) => {
    const el = textareas.current.get(chunks[i].key);
    const at = el?.selectionStart ?? 0;
    const c = chunks[i];
    const head = c.text.slice(0, at).trim();
    const tail = c.text.slice(at).trim();
    if (!head || !tail) return;
    const second = { ...emptyChunk(), sectionReference: `${c.sectionReference} (cont.)`, text: tail };
    apply([...chunks.slice(0, i), edited(c, { text: head }), second, ...chunks.slice(i + 1)], i + 1);
  };
  const move = (i: number, delta: number) => {
    const j = i + delta;
    if (j < 0 || j >= chunks.length) return;
    const next = [...chunks];
    [next[i], next[j]] = [next[j], next[i]];
    apply(next, j);
  };

  const jump = () => {
    const n = Number(jumpTo);
    if (Number.isInteger(n) && n >= 1 && n <= chunks.length) reveal(chunks, n - 1);
    setJumpTo('');
  };

  return (
    <div className="kb-chunkframe">
      <div className="kb-chunkframe__toolbar">
        <label className="kb-chunkframe__filter">
          <input
            type="checkbox"
            checked={attentionOnly}
            onChange={(e) => {
              setAttentionKeys(e.target.checked ? new Set(chunks.filter(needsAttention).map((c) => c.key)) : null);
              goToPage(1);
            }}
            disabled={attentionCount === 0 && !attentionOnly}
          />
          Needs attention only ({attentionCount})
        </label>
        <form
          className="kb-chunkframe__jump"
          onSubmit={(e) => {
            e.preventDefault();
            jump();
          }}
        >
          <label>
            Go to chunk
            <input className="input" type="number" min={1} max={chunks.length} value={jumpTo} onChange={(e) => setJumpTo(e.target.value)} />
          </label>
          <button className="aml-btn" type="submit" disabled={!jumpTo}>
            Go
          </button>
        </form>
      </div>

      <div className="kb-chunkframe__scroll" ref={frame}>
        <div className="kb-chunks">
          {attentionOnly && listed.length === 0 && <div className="kb-muted">Nothing needs attention.</div>}
          {pageItems.map(({ c, i }) => {
            const unacknowledged = c.injectionFlags.length > 0 && !c.injectionAcknowledged;
            return (
              <div key={c.key} data-chunk-key={c.key} className={`kb-chunk ${unacknowledged ? 'kb-chunk--flagged' : ''}`}>
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
      </div>

      {listed.length > 0 && (
        <Pagination
          page={currentPage}
          pageSize={pageSize}
          total={listed.length}
          pageSizeOptions={PAGE_SIZES}
          noun={attentionOnly ? 'Flagged chunks' : 'Chunks'}
          onPageChange={goToPage}
          onPageSizeChange={(n) => {
            setPageSize(n);
            goToPage(1);
          }}
        />
      )}
    </div>
  );
}
