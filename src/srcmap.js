// Maps text in the rendered document back to offsets in the Markdown source.
//
// Every rendered block element carries data-ln="start:end" (its source line
// range). Inside such a block we align the element's visible text with the
// source slice character by character, skipping Markdown syntax, so a DOM
// selection can be turned into a precise source range and back again.

// Characters produced by markdown-it's typographer, mapped to the ASCII they
// came from. `extra` is how many further source chars of that run to consume.
const TYPO = {
  '“': ['"'], '”': ['"'], '„': ['"'],
  '‘': ["'"], '’': ["'"],
  '–': ['-', /^-+/], '—': ['-', /^-+/],
  '…': ['.', /^\.+/],
  '©': ['(', /^\(c\)/i], '®': ['(', /^\(r\)/i], '™': ['(', /^\(tm\)/i],
  '±': ['+', /^\+-/],
};

const ENTITY = /^&(?:#\d+|#x[0-9a-f]+|\w+);/i;
const decoder = document.createElement('textarea');
function decodeEntity(s) {
  decoder.innerHTML = s;
  return decoder.value;
}

// Source regions that never produce visible text.
const MASKS = [
  /!\[[^\]]*\]\((?:<[^>]*>|[^)\s]*)(?:\s+"[^"]*")?\)/g, // images (alt text is not part of textContent)
  /\]\((?:<[^>]*>|[^)\s]*)(?:\s+(?:"[^"]*"|'[^']*'))?\)/g, // link destinations
  /\]\[[^\]]*\]/g, // reference link labels
  /<\/?[a-zA-Z][\w-]*(?=[\s/>])[^>]*>/g, // raw HTML tags
  /^[ \t>]*(?:(?:[-*+]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?)?(?:#{1,6}[ \t]+)?/gm, // block prefixes
];

function maskOf(src) {
  const mask = new Uint8Array(src.length);
  for (const re of MASKS) {
    re.lastIndex = 0;
    for (let m; (m = re.exec(src)); ) {
      if (!m[0].length) {
        re.lastIndex++;
        continue;
      }
      mask.fill(1, m.index, m.index + m[0].length);
    }
  }
  return mask;
}

const isWs = (c) => /\s/.test(c);

/**
 * Aligns `text` (rendered) with `src` (Markdown). Returns per-character
 * [start, end) source offsets, or null if the text can't be found in order.
 */
export function align(text, src) {
  const mask = maskOf(src);
  const start = new Int32Array(text.length);
  const end = new Int32Array(text.length);
  let j = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (isWs(c)) {
      // Whitespace is flexible: the renderer adds newlines between table cells
      // and collapses indentation, so consume source whitespace if present.
      start[i] = j;
      while (j < src.length && isWs(src[j]) && !mask[j]) j++;
      end[i] = j;
      continue;
    }
    const typo = TYPO[c];
    let k = j;
    let len = 0;
    for (; k < src.length; k++) {
      if (mask[k]) continue;
      const s = src[k];
      if (s === c) {
        len = 1;
        break;
      }
      if (typo && s === typo[0]) {
        const run = typo[1] && src.slice(k).match(typo[1]);
        len = run ? Math.min(run[0].length, c === '–' ? 2 : 3) : 1;
        break;
      }
      if (s === '&') {
        const ent = src.slice(k).match(ENTITY);
        if (ent && decodeEntity(ent[0]) === c) {
          len = ent[0].length;
          break;
        }
      }
    }
    if (!len) return null;
    start[i] = k;
    end[i] = k + len;
    j = k + len;
  }
  return { start, end };
}

/** Offset of the first character of line `n` in `source`. */
export function lineOffset(source, n) {
  let off = 0;
  for (let i = 0; i < n; i++) {
    const nl = source.indexOf('\n', off);
    if (nl < 0) return source.length;
    off = nl + 1;
  }
  return off;
}

export const lineOf = (source, off) => source.slice(0, off).split('\n').length - 1;

export function lineRange(el) {
  const [a, b] = (el.dataset.ln || el.dataset.src).split(':').map(Number);
  return [a, b];
}

/** The source slice an element was rendered from, and its absolute offset. */
export function sliceOf(source, el) {
  const [a, b] = lineRange(el);
  const from = lineOffset(source, a);
  const to = b >= source.split('\n').length ? source.length : lineOffset(source, b) - 1;
  return { from, text: source.slice(from, Math.max(from, to)) };
}

/** Character offset of a DOM boundary point within el's textContent. */
export function textOffset(el, node, offset) {
  const r = document.createRange();
  r.setStart(el, 0);
  r.setEnd(node, offset);
  return r.toString().length;
}

/**
 * DOM boundary point for a character offset within el's textContent. A start
 * point at a node boundary goes into the following node, so a range around
 * "**word**" starts inside the <strong> rather than at the end of the text before it.
 */
export function domPoint(el, idx, isStart = false) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let last = null;
  for (let n; (n = walker.nextNode()); ) {
    if (isStart ? idx < n.data.length : idx <= n.data.length) return [n, idx];
    idx -= n.data.length;
    last = n;
  }
  return last ? [last, last.data.length] : [el, 0];
}

/**
 * Maps an absolute source range [ss, se) back to a DOM Range, searching the
 * narrowest [data-ln] element under `root` that covers it.
 */
export function rangeFromSource(root, source, ss, se) {
  const la = lineOf(source, ss);
  const lb = lineOf(source, Math.max(ss, se - 1));
  let best = null;
  let bestSize = Infinity;
  for (const el of root.querySelectorAll('[data-ln]')) {
    const [a, b] = lineRange(el);
    if (a <= la && lb < b && b - a < bestSize) {
      best = el;
      bestSize = b - a;
    }
  }
  if (!best) return null;
  const { from, text } = sliceOf(source, best);
  const map = align(best.textContent, text);
  if (!map) return null;
  let i0 = -1;
  let i1 = -1;
  for (let i = 0; i < map.start.length; i++) {
    const s = map.start[i] + from;
    if (isWs(best.textContent[i])) continue;
    if (s >= ss && map.end[i] + from <= se) {
      if (i0 < 0) i0 = i;
      i1 = i + 1;
    }
  }
  if (i0 < 0) return null;
  const r = document.createRange();
  r.setStart(...domPoint(best, i0, true));
  r.setEnd(...domPoint(best, i1));
  return r;
}
