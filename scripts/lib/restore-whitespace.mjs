// getbible.net serves the World English Bible with the original line breaks
// already stripped - and it strips them without leaving a space behind. So
// "one smallest letter\nor one tiny pen stroke" arrives as
// "one smallest letteror one tiny pen stroke", and the glued words go straight
// onto the reading page. bible-api.com serves the same public-domain text with
// the line breaks intact, so it can say where the spaces belong.
//
// The two editions are not identical - they differ in wording here and there
// ("the Kingdom of God" against "God's Kingdom") - so a whole-verse comparison
// would miss any glued word that shares a verse with a wording difference. This
// aligns the two word by word instead and only rewrites a run when the two
// sides are the same text once every space is removed. That makes it
// impossible for this to change a word: it can only put spaces back.

const squash = (s) => s.replace(/\s/g, '');

/** Longest-common-subsequence opcodes over two word arrays. */
function opcodes(a, b) {
  const n = a.length, m = b.length;
  const lcs = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const ops = [];
  let i = 0, j = 0;
  const push = (tag, i1, i2, j1, j2) => {
    if (i1 === i2 && j1 === j2) return;
    const last = ops[ops.length - 1];
    if (last && last.tag === tag) { last.i2 = i2; last.j2 = j2; return; }
    ops.push({ tag, i1, i2, j1, j2 });
  };
  while (i < n && j < m) {
    if (a[i] === b[j]) { push('equal', i, i + 1, j, j + 1); i++; j++; }
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) { push('diff', i, i + 1, j, j); i++; }
    else { push('diff', i, i, j, j + 1); j++; }
  }
  push('diff', i, n, j, m);
  return ops;
}

/**
 * Restore missing spaces in `text` using `reference`, touching nothing else.
 * Returns the repaired string, unchanged when there is nothing safe to fix.
 */
export function restoreWhitespace(text, reference) {
  if (!reference || text === reference) return text;
  const a = text.split(' ').filter(Boolean);
  const b = reference.split(' ').filter(Boolean);
  const out = [];
  let changed = false;
  for (const op of opcodes(a, b)) {
    const mine = a.slice(op.i1, op.i2);
    const theirs = b.slice(op.j1, op.j2);
    if (op.tag === 'equal') { out.push(...mine); continue; }
    // Same characters, different spacing: the reference knows where the space
    // goes. Any other difference is a genuine wording difference between the
    // two editions - keep our own text.
    if (mine.length > 0 && theirs.length > 0 && squash(mine.join('')) === squash(theirs.join(''))) {
      out.push(...theirs);
      changed = true;
    } else {
      out.push(...mine);
    }
  }
  return changed ? out.join(' ') : text;
}

/** Normalize a source's verse text the way both sides must be compared. */
export const collapse = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
