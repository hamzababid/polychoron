import { useState, type ReactNode } from 'react';
import type { IngestionJobStatus, RegulatoryDocumentStatus, RegulatorySourceType, TypologyRow } from '../api/types';
import { SOURCE_TYPES, STATUS_LABEL, useIssuingAuthorities, useTypologies, type MetadataValues, type RetrievalValues } from './kbUtils';

/** Shared components of the Regulatory Knowledge Base screens
 * (specs/suites/bfsi/features/aml-detection/screens/11-regulatory-knowledge-base.md). */

/** Status must be visually unmistakable (screen spec, Library). */
export function StatusBadge({ status }: { status: RegulatoryDocumentStatus }) {
  return <span className={`kb-status kb-status--${status}`}>{STATUS_LABEL[status]}</span>;
}

export function Tile({ title, actions, children, className }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={`tile ${className ?? ''}`}>
      <i className="corner tl" />
      <i className="corner tr" />
      <i className="corner bl" />
      <i className="corner br" />
      {(title || actions) && (
        <div className="tile-head">
          {title && <h6 style={{ margin: 0 }}>{title}</h6>}
          {actions && <div className="kb-tile-actions">{actions}</div>}
        </div>
      )}
      <div className="tile-body">{children}</div>
    </div>
  );
}

export function JobProgress({ job, label = 'Embedding' }: { job: IngestionJobStatus | null; label?: string }) {
  if (!job) return null;
  const done = job.progress?.done ?? 0;
  const total = job.progress?.total ?? 0;
  const pct = total ? Math.round((done / total) * 100) : job.status === 'completed' ? 100 : 0;
  return (
    <div className="kb-progress" role="status">
      <div className="kb-progress__label">
        {job.status === 'running' && `${label}… ${total ? `${done} / ${total} chunks` : 'starting'}`}
        {job.status === 'completed' && `${label} complete — ${done || job.chunkCount || 0} chunk(s)`}
        {job.status === 'failed' && <span className="kb-error">{label} failed: {job.error}</span>}
      </div>
      <div className="kb-progress__track">
        <div className={`kb-progress__bar ${job.status === 'failed' ? 'kb-progress__bar--failed' : ''}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** Free-form tag chips: Enter or comma adds, × removes. */
export function TagInput({ value, onChange, placeholder }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const tag = draft.trim().replace(/,$/, '');
    if (tag && !value.includes(tag)) onChange([...value, tag]);
    setDraft('');
  };
  return (
    <div className="kb-tags input">
      {value.map((t) => (
        <span key={t} className="tag tag-accent kb-tags__chip">
          {t}
          <button type="button" aria-label={`Remove ${t}`} onClick={() => onChange(value.filter((x) => x !== t))}>
            ×
          </button>
        </span>
      ))}
      <input
        value={draft}
        placeholder={value.length ? '' : placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            add();
          } else if (e.key === 'Backspace' && !draft && value.length) {
            onChange(value.slice(0, -1));
          }
        }}
        onBlur={add}
      />
    </div>
  );
}

export function TypologyPicker({ value, onChange, typologies }: { value: string[]; onChange: (v: string[]) => void; typologies: TypologyRow[] }) {
  if (!typologies.length) return <div className="kb-muted">No typologies configured.</div>;
  return (
    <div className="kb-checklist">
      {typologies.map((t) => (
        <label key={t.typologyCode} className="kb-checklist__item">
          <input
            type="checkbox"
            checked={value.includes(t.typologyCode)}
            onChange={(e) => onChange(e.target.checked ? [...value, t.typologyCode] : value.filter((c) => c !== t.typologyCode))}
          />
          <span>
            {t.typologyLabel} <span className="kb-muted">({t.typologyCode})</span>
          </span>
        </label>
      ))}
    </div>
  );
}

/** Wizard step 2 / Edit → "Correct metadata". Related typologies live
 * on the retrieval settings, not here. */
export function MetadataForm({ value, onChange }: { value: MetadataValues; onChange: (v: MetadataValues) => void }) {
  const authorities = useIssuingAuthorities();
  const set = <K extends keyof MetadataValues>(k: K, v: MetadataValues[K]) => onChange({ ...value, [k]: v });
  return (
    <div className="kb-form">
      <div className="field kb-form__wide">
        <label>
          Title <span className="kb-required">*</span>
        </label>
        <input className="input" value={value.title} onChange={(e) => set('title', e.target.value)} placeholder="e.g. AML/CFT/CPF Regulations" />
      </div>
      <div className="field">
        <label>Source type</label>
        <select className="input" value={value.source_type} onChange={(e) => set('source_type', e.target.value as RegulatorySourceType)}>
          {SOURCE_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label>
          Issuing authority <span className="kb-required">*</span>
        </label>
        <input className="input" list="kb-authorities" value={value.issuing_authority} onChange={(e) => set('issuing_authority', e.target.value)} placeholder="SBP, FMU, …" />
        <datalist id="kb-authorities">
          {[...new Set([...authorities, 'SBP', 'FMU', 'Government of Pakistan', 'FATF'])].map((a) => (
            <option key={a} value={a} />
          ))}
        </datalist>
      </div>
      <div className="field">
        <label>
          Version label <span className="kb-required">*</span>
        </label>
        <input className="input" value={value.version_label} onChange={(e) => set('version_label', e.target.value)} placeholder="as amended 2026" />
      </div>
      <div className="field">
        <label>Effective date</label>
        <input className="input" type="date" value={value.effective_date} onChange={(e) => set('effective_date', e.target.value)} />
      </div>
      <div className="field kb-form__wide">
        <label>
          Source URL — the official publication every citation traces back to <span className="kb-required">*</span>
        </label>
        <input className="input" value={value.source_url} onChange={(e) => set('source_url', e.target.value)} placeholder="https://www.sbp.org.pk/…" />
      </div>
      <div className="field">
        <label>Jurisdiction</label>
        <input className="input" value={value.jurisdiction} onChange={(e) => set('jurisdiction', e.target.value)} />
      </div>
      <div className="field">
        <label>Language</label>
        <input className="input" value={value.language} onChange={(e) => set('language', e.target.value)} />
      </div>
      <div className="field kb-form__wide">
        <label>Tags</label>
        <TagInput value={value.tags} onChange={(v) => set('tags', v)} placeholder="Type a tag and press Enter" />
      </div>
      <div className="field kb-form__wide">
        <label>Internal notes — never shown to agents</label>
        <textarea className="input" rows={3} value={value.notes} onChange={(e) => set('notes', e.target.value)} />
      </div>
    </div>
  );
}

export function RetrievalForm({ value, onChange }: { value: RetrievalValues; onChange: (v: RetrievalValues) => void }) {
  const typologies = useTypologies();
  return (
    <div className="kb-retrieval">
      <label className="kb-toggle">
        <input type="checkbox" checked={value.retrieval_enabled} onChange={(e) => onChange({ ...value, retrieval_enabled: e.target.checked })} />
        <span>
          <strong>Available to agents</strong>
          <span className="kb-muted"> — off keeps the document stored and viewable, but it's never retrieved or cited.</span>
        </span>
      </label>

      <div className="field">
        <label>
          Retrieval priority: <strong>{value.retrieval_priority.toFixed(1)}×</strong>
        </label>
        <input
          type="range"
          min={0.5}
          max={2}
          step={0.1}
          value={value.retrieval_priority}
          onChange={(e) => onChange({ ...value, retrieval_priority: Number(e.target.value) })}
          className="kb-range"
        />
        <div className="kb-muted">Multiplies similarity when ranking — raise binding regulation above guidance. 1.0 is neutral.</div>
      </div>

      <div className="field">
        <label>Restrict to typologies</label>
        <div className="kb-muted" style={{ marginBottom: 6 }}>
          None selected = offered for every typology. If set, only offered while one of these typologies is active in the Pattern Matching
          catalog.
        </div>
        <TypologyPicker value={value.related_typology_codes} onChange={(v) => onChange({ ...value, related_typology_codes: v })} typologies={typologies} />
      </div>
    </div>
  );
}

export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  busy,
  disabled,
  onConfirm,
  onCancel,
}: {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  busy?: boolean;
  disabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-label={title}>
      <div className="dialog">
        <div className="dialog-title">{title}</div>
        <div className="dialog-body">{children}</div>
        <div className="dialog-actions">
          <button className="aml-btn" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button className="aml-btn aml-btn--primary" onClick={onConfirm} disabled={busy || disabled}>
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
