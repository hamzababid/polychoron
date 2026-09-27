import { useState } from 'react';

const DEFAULT_PAGE_SIZE_OPTIONS = [10, 25, 50];

/** Client-side paging for lists an endpoint already returns in full
 * because they belong to one parent record (a document's chunks, a
 * case's transactions, a typology's versions). Lists that grow without
 * bound at the database level page on the server instead (Alert Queue,
 * KB Library, goAML Tracker, report history).
 *
 * Pair with <Pagination {...paging.props} />, rendered only when
 * `paging.needed` so a three-row list doesn't carry a page bar. The page
 * clamps if the list shrinks (e.g. after a delete), and `resetKey`
 * returns to page 1 when what's being listed changes (a new search). */
export function usePagedList<T>(
  items: readonly T[] | null | undefined,
  { initialPageSize = DEFAULT_PAGE_SIZE_OPTIONS[0], pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS, resetKey = '' } = {},
) {
  const [pageSize, setPageSize] = useState(initialPageSize);
  const [state, setState] = useState({ page: 1, resetKey });
  // A changed resetKey means page 1, without an effect: derive it.
  const requested = state.resetKey === resetKey ? state.page : 1;

  const all = items ?? [];
  const totalPages = Math.max(1, Math.ceil(all.length / pageSize));
  const page = Math.min(requested, totalPages);
  const offset = (page - 1) * pageSize;

  const setPage = (p: number) => setState({ page: p, resetKey });

  return {
    pageItems: all.slice(offset, offset + pageSize),
    // Position of pageItems[0] in the full list — for ordinals.
    offset,
    needed: all.length > Math.min(...pageSizeOptions),
    setPage,
    props: {
      page,
      pageSize,
      total: all.length,
      pageSizeOptions,
      onPageChange: setPage,
      onPageSizeChange: (n: number) => {
        setPageSize(n);
        setPage(1);
      },
    },
  };
}
