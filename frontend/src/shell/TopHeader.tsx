import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useBreadcrumbs } from './useBreadcrumbs';
import { FEATURE_SEARCH, type SearchResult } from './featureSearch';

const MIN_QUERY_LENGTH = 2;
const DEBOUNCE_MS = 300;

/** Persistent header above every screen's own (internally-scrolling)
 * content — breadcrumbs on the left, feature-scoped global search on
 * the right. Fixed in place because .shell__content is a flex column
 * with this as its `flex: none` first child and each screen owning
 * its own `flex: 1; overflow-y: auto` body — scrolling a long screen
 * no longer scrolls this away with it. */
export function TopHeader() {
  const crumbs = useBreadcrumbs();
  const { suiteCode = '', featureCode = '' } = useParams();
  const navigate = useNavigate();
  const base = `/${suiteCode}/${featureCode}`;
  const searchConfig = FEATURE_SEARCH[featureCode];

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const blurTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!searchConfig) return;
    if (query.trim().length < MIN_QUERY_LENGTH) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      searchConfig
        .search(query.trim())
        .then(setResults)
        .catch(() => setResults([]))
        .finally(() => setLoading(false));
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, searchConfig]);

  useEffect(() => () => {
    if (blurTimeoutRef.current) clearTimeout(blurTimeoutRef.current);
  }, []);

  const handleSelect = (result: SearchResult) => {
    setQuery('');
    setResults([]);
    setOpen(false);
    navigate(result.href(base));
  };

  const showDropdown = open && query.trim().length >= MIN_QUERY_LENGTH;

  return (
    <div className="topheader">
      <nav className="breadcrumbs" aria-label="Breadcrumb">
        {crumbs.map((c, i) => {
          const isLast = i === crumbs.length - 1;
          return (
            <span key={i} className="breadcrumbs__item">
              {i > 0 && <span className="breadcrumbs__sep">/</span>}
              {c.to && !isLast ? (
                <a
                  href={c.to}
                  onClick={(e) => {
                    e.preventDefault();
                    navigate(c.to!);
                  }}
                >
                  {c.label}
                </a>
              ) : (
                <span className={isLast ? 'breadcrumbs__current' : undefined}>{c.label}</span>
              )}
            </span>
          );
        })}
      </nav>

      {searchConfig && (
        <div className="topheader__search">
          <input
            className="topheader__searchInput"
            type="search"
            placeholder={searchConfig.placeholder}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => {
              blurTimeoutRef.current = setTimeout(() => setOpen(false), 150);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setOpen(false);
                (e.target as HTMLInputElement).blur();
              }
              if (e.key === 'Enter' && results[0]) {
                handleSelect(results[0]);
              }
            }}
          />
          {showDropdown && (
            <div className="topheader__results">
              {loading ? (
                <div className="topheader__resultsEmpty">Searching…</div>
              ) : results.length === 0 ? (
                <div className="topheader__resultsEmpty">
                  {query.trim().length < MIN_QUERY_LENGTH ? `Keep typing (min ${MIN_QUERY_LENGTH} characters)…` : 'No matches.'}
                </div>
              ) : (
                results.map((r) => (
                  <button key={r.id} className="topheader__result" onMouseDown={(e) => e.preventDefault()} onClick={() => handleSelect(r)}>
                    <div className="topheader__resultTitle">{r.title}</div>
                    <div className="topheader__resultSubtitle">{r.subtitle}</div>
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
