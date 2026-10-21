// Floating formatting toolbar for reading mode. Select text in the rendered
// document and the toolbar edits the underlying Markdown directly, so you
// never have to drop into the raw source for everyday formatting.

import { icon } from './icons.js';
import { align, sliceOf, textOffset, lineRange, rangeFromSource } from './srcmap.js';

const NO_EDIT = '.code-block, .mermaid, .katex, .frontmatter, .block-editor, .footnotes, pre';
const INLINE_HOST = 'p, h1, h2, h3, h4, h5, h6, td, th, li, dt, dd';
const INLINE_EL = 'strong, b, em, i, s, del, code, a';
const LINK_TAIL = /^\]\((<[^>]*>|[^)\s]*)(\s+(?:"[^"]*"|'[^']*'))?\)/;

const FORMATS = {
  bold: { sel: 'strong, b', marks: ['**', '__'], strip: /\*\*/g },
  italic: { sel: 'em, i', marks: ['*', '_'], strip: /(?<![*\\])\*(?!\*)/g },
  strike: { sel: 's, del', marks: ['~~'], strip: /~~/g },
  code: { sel: 'code', marks: ['`'], strip: /`/g },
};

const BUTTONS = [
  ['bold', 'Bold (Ctrl+B)'],
  ['italic', 'Italic (Ctrl+I)'],
  ['strike', 'Strikethrough'],
  ['code', 'Inline code'],
  ['link', 'Link'],
  '|',
  ['heading', 'Heading'],
  ['quote', 'Quote'],
  ['list', 'Bullet list'],
  '|',
  ['image', 'Image'],
  ['table', 'Table'],
  '|',
  ['edit', 'Edit Markdown of this block'],
];

const TABLE_TEMPLATE = ['| Column 1 | Column 2 | Column 3 |', '| --- | --- | --- |', '|  |  |  |'];

const elOf = (n) => (n.nodeType === 1 ? n : n.parentElement);
const fmtDest = (u) => (/[\s()<>]/.test(u) ? `<${u}>` : u);

function splitRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const cells = [];
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && i + 1 < s.length) {
      cur += s[i] + s[++i];
    } else if (s[i] === '|') {
      cells.push(cur.trim());
      cur = '';
    } else {
      cur += s[i];
    }
  }
  cells.push(cur.trim());
  return cells;
}

const joinRow = (prefix, cells) => `${prefix}| ${cells.join(' | ')} |`;

/** Relative path from a directory to a file, using forward slashes. */
function relPath(fromDir, target) {
  const a = fromDir.split(/[\\/]+/).filter(Boolean);
  const b = target.split(/[\\/]+/).filter(Boolean);
  if (!a.length || !b.length || a[0].toLowerCase() !== b[0].toLowerCase()) return target.replace(/\\/g, '/');
  let i = 0;
  while (i < a.length && i < b.length - 1 && a[i].toLowerCase() === b[i].toLowerCase()) i++;
  return [...Array(a.length - i).fill('..'), ...b.slice(i)].join('/');
}

/**
 * @param {object} o
 * @param {HTMLElement} o.docEl     rendered document
 * @param {() => boolean} o.enabled  whether formatting is allowed right now
 * @param {() => string} o.getSource
 * @param {(next: string) => void} o.commit  replaces the source and re-renders
 * @param {() => string|null} o.docDir
 * @param {() => Promise<string|null>} o.pickImage
 * @param {(el: HTMLElement) => void} o.editBlock
 * @param {(msg: string) => void} o.toast
 */
export function createFormatBar(o) {
  const bar = document.createElement('div');
  bar.id = 'fmtbar';
  bar.hidden = true;
  bar.innerHTML =
    '<div class="fb-row fb-main">' +
    BUTTONS.map((b) =>
      b === '|' ? '<span class="fb-sep"></span>' : `<button type="button" class="fb-btn" data-cmd="${b[0]}" title="${b[1]}">${icon(b[0], 17)}</button>`,
    ).join('') +
    '</div>' +
    '<div class="fb-row fb-form" hidden>' +
    '<span class="fb-form-icon"></span><input spellcheck="false" />' +
    `<button type="button" class="fb-btn" data-form="browse" title="Choose an image file">${icon('folder', 16)}</button>` +
    `<button type="button" class="fb-btn" data-form="unlink" title="Remove link">${icon('unlink', 16)}</button>` +
    `<button type="button" class="fb-btn fb-ok" data-form="ok" title="Apply (Enter)">${icon('check', 16)}</button>` +
    '</div>' +
    '<div class="fb-menu" hidden></div>';
  document.body.append(bar);

  const main = bar.querySelector('.fb-main');
  const form = bar.querySelector('.fb-form');
  const input = form.querySelector('input');
  const menu = bar.querySelector('.fb-menu');
  let ctx = null;
  let formKind = null;

  // ───────── reading the selection ─────────

  function readContext() {
    const sel = getSelection();
    if (!o.enabled() || !sel.rangeCount || sel.isCollapsed) return null;
    const range = sel.getRangeAt(0).cloneRange();
    const startEl = elOf(range.startContainer);
    if (!startEl || !o.docEl.contains(startEl)) return null;

    // A triple-click ends the range at offset 0 of the next block; pull it back.
    if (range.endOffset === 0 && range.endContainer !== range.startContainer) {
      const host = startEl.closest(INLINE_HOST) || startEl.closest('[data-src]');
      if (host && !host.contains(range.endContainer)) range.setEnd(host, host.childNodes.length);
    }
    const anc = elOf(range.commonAncestorContainer);
    if (!anc || anc === o.docEl || !o.docEl.contains(anc)) return null;
    if (anc.closest(NO_EDIT) || range.cloneContents().querySelector(NO_EDIT)) return null;
    let top = anc;
    while (top.parentElement !== o.docEl) top = top.parentElement;
    if (!top.dataset.src) return null;

    const source = o.getSource();
    const c = { range, source, top, anc, inline: null, cell: startEl.closest('td, th') };
    const h1 = startEl.closest(INLINE_HOST);
    const h2 = elOf(range.endContainer).closest(INLINE_HOST);
    if (h1 && h1 === h2) c.inline = mapInline(range, h1, source);
    return c;
  }

  function mapInline(range, host, source) {
    const block = host.closest('[data-ln]');
    if (!block || !o.docEl.contains(block)) return null;
    // Grow the range over inline elements it only partly covers, so the
    // Markdown we wrap never splits a pair of markers.
    const r = range.cloneRange();
    let grewStart = false;
    let grewEnd = false;
    for (let a = elOf(r.startContainer).closest(INLINE_EL); a && a !== host && host.contains(a); a = a.parentElement.closest(INLINE_EL)) {
      if (!a.contains(r.endContainer)) {
        r.setStartBefore(a);
        grewStart = true;
      }
    }
    for (let a = elOf(r.endContainer).closest(INLINE_EL); a && a !== host && host.contains(a); a = a.parentElement.closest(INLINE_EL)) {
      if (!a.contains(r.startContainer)) {
        r.setEndAfter(a);
        grewEnd = true;
      }
    }
    const hostEnd = textOffset(block, host, host.childNodes.length);
    const T = block.textContent.slice(0, hostEnd);
    let s = textOffset(block, r.startContainer, r.startOffset);
    let e = textOffset(block, r.endContainer, r.endOffset);
    while (s < e && /\s/.test(T[s])) s++;
    while (e > s && /\s/.test(T[e - 1])) e--;
    if (s >= e) return null;

    const { from, text } = sliceOf(source, block);
    const map = align(T, text);
    if (!map) return null;
    let ss = from + map.start[s];
    let se = from + map.end[e - 1];
    if (grewStart) while (ss > from && '*_~`['.includes(source[ss - 1])) ss--;
    if (grewEnd) {
      while (se < source.length && '*_~`'.includes(source[se])) se++;
      const m = source.slice(se).match(LINK_TAIL);
      if (m) se += m[0].length;
    }
    return { block, host, from, map, T, s, e, ss, se };
  }

  /** Source range [start, end) of the visible text of an inline element. */
  function textRange(el) {
    const { block, from, map, T } = ctx.inline;
    const s0 = textOffset(block, el, 0);
    const e0 = s0 + el.textContent.length;
    if (e0 <= s0 || e0 > T.length) return null;
    return [from + map.start[s0], from + map.end[e0 - 1]];
  }

  /** The innermost element matching `selector` whose text covers the whole selection. */
  function activeEl(selector) {
    if (!ctx?.inline) return null;
    const { block, host, s, e } = ctx.inline;
    let best = null;
    for (const el of host.querySelectorAll(selector)) {
      const s0 = textOffset(block, el, 0);
      if (s0 <= s && e <= s0 + el.textContent.length) best = el;
    }
    return best;
  }

  function activeLink() {
    const a = activeEl('a');
    const r = a && textRange(a);
    if (!r) return null;
    const src = ctx.source;
    const m = src.slice(r[1]).match(LINK_TAIL);
    if (src[r[0] - 1] !== '[' || !m) return null;
    return { ts: r[0], te: r[1], tail: m, url: m[1].replace(/^<|>$/g, '') };
  }

  // ───────── applying edits ─────────

  function commit(next, select) {
    if (o.getSource() !== ctx.source) {
      o.toast('The file changed — select the text again');
      return hide();
    }
    hide();
    o.commit(next);
    if (!select) return getSelection().removeAllRanges();
    const r = rangeFromSource(o.docEl, next, select[0], select[1]);
    const sel = getSelection();
    sel.removeAllRanges();
    if (r) {
      sel.addRange(r);
      update();
    }
  }

  const fail = () => o.toast("Couldn't map this selection — double-click the block to edit its Markdown");

  function toggleFormat(name) {
    if (!ctx?.inline) return fail();
    const F = FORMATS[name];
    const src = ctx.source;
    const act = activeEl(F.sel);
    if (act) {
      const r = textRange(act);
      if (!r) return fail();
      const [ts, te] = r;
      let ml;
      let mr;
      if (name === 'code') {
        ml = (src.slice(0, ts).match(/`+ ?$/) || [''])[0].length;
        mr = (src.slice(te).match(/^ ?`+/) || [''])[0].length;
      } else {
        const m = F.marks.find((k) => src.slice(ts - k.length, ts) === k && src.slice(te, te + k.length) === k);
        ml = mr = m ? m.length : 0;
      }
      if (!ml || !mr) return fail();
      return commit(src.slice(0, ts - ml) + src.slice(ts, te) + src.slice(te + mr), [ts - ml, te - ml]);
    }
    const { ss, se, T, s, e } = ctx.inline;
    const inner = name === 'code' ? T.slice(s, e).replace(/`/g, '') : src.slice(ss, se).replace(F.strip, '');
    const mk = F.marks[0];
    commit(src.slice(0, ss) + mk + inner + mk + src.slice(se), [ss + mk.length, ss + mk.length + inner.length]);
  }

  function applyLink(url, remove) {
    const src = ctx.source;
    const link = activeLink();
    if (link) {
      const { ts, te, tail } = link;
      if (remove || !url) return commit(src.slice(0, ts - 1) + src.slice(ts, te) + src.slice(te + tail[0].length), [ts - 1, te - 1]);
      const title = tail[2] || '';
      return commit(src.slice(0, te) + `](${fmtDest(url)}${title})` + src.slice(te + tail[0].length), [ts, te]);
    }
    if (!url || !ctx.inline) return;
    const { ss, se } = ctx.inline;
    commit(src.slice(0, ss) + '[' + src.slice(ss, se) + `](${fmtDest(url)})` + src.slice(se), [ss + 1, se + 1]);
  }

  function applyImage(dest) {
    if (!dest || !ctx.inline) return;
    const src = ctx.source;
    const { ss, se, T, s, e } = ctx.inline;
    const alt = T.slice(s, e).replace(/[[\]]/g, '').replace(/\s+/g, ' ');
    commit(src.slice(0, ss) + `![${alt}](${fmtDest(dest)})` + src.slice(se));
  }

  // Block-level edits work on whole source lines.
  function editLines(a, b, fn) {
    const lines = ctx.source.split('\n');
    const out = fn(lines.slice(a, b), lines);
    if (!out) return;
    lines.splice(a, b - a, ...out);
    commit(lines.join('\n'));
  }

  function setHeading(level) {
    const [a, b] = lineRange(ctx.top);
    const tag = ctx.top.tagName;
    editLines(a, b, (ls) => {
      let text;
      if (/^H\d$/.test(tag)) {
        const setext = ls.length >= 2 && /^\s*[=-]+\s*$/.test(ls[ls.length - 1]);
        text = setext ? ls.slice(0, -1).map((l) => l.trim()).join(' ') : ls[0].replace(/^\s*#{1,6}\s*/, '').replace(/\s+#+\s*$/, '');
      } else {
        text = ls.map((l) => l.trim()).join(' ');
      }
      return [level ? `${'#'.repeat(level)} ${text}` : text];
    });
  }

  function toggleQuote() {
    const [a, b] = lineRange(ctx.top);
    const quoted = ctx.top.tagName === 'BLOCKQUOTE';
    editLines(a, b, (ls) => (quoted ? ls.map((l) => l.replace(/^(\s*)> ?/, '$1')) : ls.map((l) => (l.trim() ? `> ${l}` : '>'))));
  }

  function toggleList() {
    const [a, b] = lineRange(ctx.top);
    if (ctx.top.tagName === 'UL') {
      return editLines(a, b, (ls) => ls.map((l) => l.replace(/^[-*+]\s+(?:\[[ xX]\]\s+)?/, '')));
    }
    editLines(a, b, (ls) => ls.filter((l) => l.trim()).map((l) => `- ${l.trim()}`));
  }

  function insertTable() {
    const [, b] = lineRange(ctx.top);
    const lines = ctx.source.split('\n');
    const block = ['', ...TABLE_TEMPLATE];
    if (lines[b] !== undefined && lines[b].trim()) block.push('');
    lines.splice(b, 0, ...block);
    commit(lines.join('\n'));
  }

  function tableOp(op) {
    const cell = ctx.cell;
    const table = cell?.closest('table');
    const tr = cell?.closest('tr');
    if (!table?.dataset.ln || !tr?.dataset.ln) return fail();
    const [ta, tb] = lineRange(table);
    const [row] = lineRange(tr);
    const col = cell.cellIndex;
    const lines = ctx.source.split('\n');
    const prefix = lines[ta].match(/^[ \t>]*/)[0];
    const cols = splitRow(lines[ta].slice(prefix.length)).length;
    const rowLines = [];
    for (let i = ta; i < tb; i++) if (lines[i].includes('|')) rowLines.push(i);

    if (op === 'row') {
      const at = row === ta ? ta + 2 : row + 1;
      lines.splice(at, 0, joinRow(prefix, Array(cols).fill('')));
    } else if (op === 'delrow') {
      if (row === ta) return o.toast("The header row can't be deleted");
      lines.splice(row, 1);
    } else if (op === 'col' || op === 'delcol') {
      if (op === 'delcol' && cols <= 1) return o.toast("A table needs at least one column");
      for (const i of rowLines) {
        const cells = splitRow(lines[i].slice(prefix.length));
        if (op === 'col') cells.splice(col + 1, 0, i === ta + 1 ? '---' : i === ta ? 'Column' : '');
        else cells.splice(col, 1);
        lines[i] = joinRow(prefix, cells);
      }
    }
    commit(lines.join('\n'));
  }

  // ───────── UI ─────────

  function position() {
    if (bar.hidden || !ctx) return;
    const rect = ctx.range.getBoundingClientRect();
    if (!rect.width && !rect.height) return hide();
    const w = bar.offsetWidth;
    const h = bar.offsetHeight;
    const topLimit = (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--tb-h')) || 44) + 8;
    let top = rect.top - h - 10;
    const below = top < topLimit;
    if (below) top = rect.bottom + 10;
    if (top > innerHeight - h - 8 || rect.bottom < topLimit) return hide();
    const left = Math.max(8, Math.min(innerWidth - w - 8, rect.left + rect.width / 2 - w / 2));
    bar.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
    bar.classList.toggle('below', below);
  }

  function syncButtons() {
    const inline = !!ctx.inline;
    const tag = ctx.top.tagName;
    const set = (cmd, enabled, on = false) => {
      const btn = main.querySelector(`[data-cmd="${cmd}"]`);
      btn.disabled = !enabled;
      btn.classList.toggle('on', enabled && on);
    };
    for (const f of Object.keys(FORMATS)) set(f, inline, !!activeEl(FORMATS[f].sel));
    set('link', inline, !!activeLink());
    set('image', inline);
    set('heading', tag === 'P' || /^H\d$/.test(tag), /^H\d$/.test(tag));
    set('quote', true, tag === 'BLOCKQUOTE');
    set('list', tag === 'P' || tag === 'UL', tag === 'UL');
    set('table', true, !!ctx.cell);
    set('edit', true);
  }

  function highlight(on) {
    if (!window.CSS?.highlights) return;
    if (on && ctx) CSS.highlights.set('fmt-pending', new Highlight(ctx.range));
    else CSS.highlights.delete('fmt-pending');
  }

  function show() {
    closeForm();
    closeMenu();
    syncButtons();
    bar.hidden = false;
    position();
  }

  function hide() {
    if (bar.hidden) return;
    bar.hidden = true;
    closeForm();
    closeMenu();
    ctx = null;
  }

  function update() {
    if (formKind) return;
    const c = readContext();
    if (!c) return hide();
    ctx = c;
    show();
  }

  function openForm(kind) {
    closeMenu();
    formKind = kind;
    const link = kind === 'link' ? activeLink() : null;
    form.querySelector('.fb-form-icon').innerHTML = icon(kind, 16);
    form.querySelector('[data-form="browse"]').hidden = kind !== 'image';
    form.querySelector('[data-form="unlink"]').hidden = !link;
    input.placeholder = kind === 'link' ? 'Paste or type a link…' : 'Image URL or path…';
    input.value = link ? link.url : '';
    main.hidden = true;
    form.hidden = false;
    highlight(true);
    position();
    input.focus();
    input.select();
  }

  function closeForm() {
    if (!formKind) return;
    formKind = null;
    form.hidden = true;
    main.hidden = false;
    highlight(false);
  }

  function submitForm(remove = false) {
    const kind = formKind;
    const value = input.value.trim();
    closeForm();
    if (kind === 'link') applyLink(value, remove);
    else if (kind === 'image') applyImage(value);
  }

  function openMenu(cmd, items) {
    menu.innerHTML = items
      .map(([id, label, on]) => `<button type="button" class="fb-item${on ? ' on' : ''}" data-item="${id}">${label}</button>`)
      .join('');
    menu.dataset.cmd = cmd;
    const btn = main.querySelector(`[data-cmd="${cmd}"]`);
    menu.style.left = `${btn.offsetLeft}px`;
    menu.hidden = false;
  }

  function closeMenu() {
    menu.hidden = true;
  }

  function run(cmd) {
    if (!ctx) return;
    if (cmd in FORMATS) return toggleFormat(cmd);
    if (cmd === 'link' || cmd === 'image') return openForm(cmd);
    if (cmd === 'quote') return toggleQuote();
    if (cmd === 'list') return toggleList();
    if (cmd === 'edit') {
      const top = ctx.top;
      hide();
      getSelection().removeAllRanges();
      return o.editBlock(top);
    }
    if (!menu.hidden && menu.dataset.cmd === cmd) return closeMenu();
    if (cmd === 'heading') {
      const level = /^H(\d)$/.exec(ctx.top.tagName)?.[1];
      return openMenu('heading', [
        ['h1', 'Heading 1', level === '1'],
        ['h2', 'Heading 2', level === '2'],
        ['h3', 'Heading 3', level === '3'],
        ['h0', 'Normal text', !level],
      ]);
    }
    if (cmd === 'table') {
      if (!ctx.cell) return insertTable();
      return openMenu('table', [
        ['row', 'Insert row below'],
        ['col', 'Insert column right'],
        ['delrow', 'Delete row'],
        ['delcol', 'Delete column'],
        ['newtable', 'New table below'],
      ]);
    }
  }

  function runItem(id) {
    closeMenu();
    if (/^h\d$/.test(id)) return setHeading(Number(id[1]));
    if (id === 'newtable') return insertTable();
    tableOp(id);
  }

  // Keep the document selection alive while clicking toolbar buttons.
  bar.addEventListener('mousedown', (e) => {
    if (e.target !== input) e.preventDefault();
  });
  main.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-cmd]');
    if (btn && !btn.disabled) run(btn.dataset.cmd);
  });
  menu.addEventListener('click', (e) => {
    const it = e.target.closest('[data-item]');
    if (it) runItem(it.dataset.item);
  });
  form.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-form]');
    if (!btn) return;
    const what = btn.dataset.form;
    if (what === 'ok') submitForm();
    else if (what === 'unlink') submitForm(true);
    else if (what === 'browse') {
      const path = await o.pickImage();
      if (!path) return input.focus();
      const dir = o.docDir();
      input.value = dir ? relPath(dir, path) : path;
      submitForm();
    }
  });
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      submitForm();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeForm();
      const sel = getSelection();
      sel.removeAllRanges();
      if (ctx) sel.addRange(ctx.range);
      position();
    }
  });

  document.addEventListener('mouseup', () => setTimeout(update, 0));
  document.addEventListener('keyup', (e) => {
    if (e.key === 'Shift' || e.shiftKey || (e.ctrlKey && e.key.toLowerCase() === 'a')) update();
  });
  document.addEventListener('selectionchange', () => {
    if (bar.hidden || formKind || bar.contains(document.activeElement)) return;
    const sel = getSelection();
    if (!sel.rangeCount || sel.isCollapsed) hide();
  });
  document.addEventListener('mousedown', (e) => {
    if (formKind && !bar.contains(e.target)) {
      closeForm();
      hide();
    }
  });
  addEventListener('resize', position);

  return {
    hide,
    reposition: position,
    get visible() {
      return !bar.hidden;
    },
    /** Handles Ctrl+B / Ctrl+I while the toolbar is up. Returns true if handled. */
    handleKey(e) {
      if (bar.hidden || formKind || !ctx || !(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return false;
      const k = e.key.toLowerCase();
      const cmd = k === 'b' ? 'bold' : k === 'i' ? 'italic' : null;
      if (!cmd || !ctx.inline) return false;
      e.preventDefault();
      run(cmd);
      return true;
    },
  };
}
