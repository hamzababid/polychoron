export interface DiffPart {
  type: 'same' | 'del' | 'ins';
  text: string;
}

// LCS is O(n·m); beyond this a changed chunk is shown as a whole
// replacement rather than freezing the page on a huge passage.
const MAX_CELLS = 4_000_000;

/** Word-level diff (whitespace preserved) for the Version compare screen. */
export function wordDiff(older: string, newer: string): DiffPart[] {
  const a = older.split(/(\s+)/);
  const b = newer.split(/(\s+)/);
  if (a.length * b.length > MAX_CELLS) {
    return [
      { type: 'del', text: older },
      { type: 'ins', text: ` ${newer}` },
    ];
  }

  const n = a.length;
  const m = b.length;
  const lcs: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const parts: DiffPart[] = [];
  const push = (type: DiffPart['type'], text: string) => {
    const last = parts[parts.length - 1];
    if (last && last.type === type) last.text += text;
    else parts.push({ type, text });
  };
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      push('same', a[i]);
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      push('del', a[i++]);
    } else {
      push('ins', b[j++]);
    }
  }
  while (i < n) push('del', a[i++]);
  while (j < m) push('ins', b[j++]);
  return parts;
}
