import { useEffect, useRef, useState } from 'react';
import './multi-select-filter.css';

export interface FilterOption {
  value: string;
  label: string;
}

/** A filter-bar dropdown of checkboxes. The button reads like the
 * design system's filter selects ("Status: all" / "Status: 2
 * selected"); nothing applies until a box is ticked, and the parent
 * owns the value (e.g. from the URL). */
export function MultiSelectFilter({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: FilterOption[];
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  const summary =
    value.length === 0
      ? 'all'
      : value.length === 1
        ? (options.find((o) => o.value === value[0])?.label ?? value[0])
        : `${value.length} selected`;

  const toggle = (v: string) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);

  return (
    <div className="msf" ref={root}>
      <button type="button" className={`filter-pill msf__button ${value.length ? 'msf__button--active' : ''}`} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {label}: {summary} <span aria-hidden>▾</span>
      </button>
      {open && (
        <div className="msf__panel" role="listbox" aria-multiselectable>
          {options.map((o) => (
            <label key={o.value} className="msf__option">
              <input type="checkbox" checked={value.includes(o.value)} onChange={() => toggle(o.value)} />
              {o.label}
            </label>
          ))}
          {options.length === 0 && <div className="msf__empty">No options yet</div>}
          {value.length > 0 && (
            <button type="button" className="msf__clear" onClick={() => onChange([])}>
              Clear
            </button>
          )}
        </div>
      )}
    </div>
  );
}
