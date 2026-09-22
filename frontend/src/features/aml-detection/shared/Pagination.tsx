import './pagination.css';

interface Props {
  page: number;
  pageSize: number;
  total: number;
  pageSizeOptions?: number[];
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}

const DEFAULT_PAGE_SIZE_OPTIONS = [10, 25, 50];

/** Extracted from Alert Queue's pagination controls (same markup/CSS
 * classes, generalized) so every list screen in this feature shares
 * one implementation instead of drifting — see AlertQueueScreen and
 * ModelGovernanceScreen for the two current callers. */
export function Pagination({ page, pageSize, total, pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS, onPageChange, onPageSizeChange }: Props) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="pagination">
      <span>
        {total === 0 ? '0 rows' : `Rows ${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} of ${total}`}
      </span>
      <label className="pagination__pageSize">
        Show
        <select value={pageSize} onChange={(e) => onPageSizeChange(Number(e.target.value))}>
          {pageSizeOptions.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        per page
      </label>
      <div className="pagination__pageNav">
        <button className="aml-btn" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
          ← Prev
        </button>
        <span>
          Page {page} of {totalPages}
        </span>
        <button className="aml-btn" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>
          Next →
        </button>
      </div>
    </div>
  );
}
