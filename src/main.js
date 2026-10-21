import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { render } from './md.js';
import { icon, hydrateIcons } from './icons.js';
import { LIGHT, DARK, ACCENTS, WIDTHS, WIDTH_MIN, WIDTH_MAX, applyPalette, accentColor } from './theme.js';
import './style.css';

const win = getCurrentWindow();
const $ = (s) => document.querySelector(s);
const app = $('#app');
const docEl = $('#doc');
const scroller = $('#scroller');
const sourceEl = $('#source');

const MD_RE = /\.(md|markdown|mdown|mkd)$/i;
const THEMES = ['system', 'light', 'dark'];

const store = {
  get(k, d) {
    try {
      const v = localStorage.getItem('noumark.' + k);
      return v == null ? d : JSON.parse(v);
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem('noumark.' + k, JSON.stringify(v));
    } catch {}
  },
};

const DEFAULTS = {
  theme: 'system',
  light: 'paper',
  dark: 'graphite',
  accent: 'blue',
  accentCustom: '#3978f6',
  font: 'sans',
  fontSize: 16,
  lineHeight: 1.75,
  width: 880,
  wideBlocks: true,
  sidebar: true,
  outline: true,
  sideW: 264,
  tocW: 232,
  zoom: 100,
};
const prefs = Object.fromEntries(Object.entries(DEFAULTS).map(([k, d]) => [k, store.get(k, d)]));
const savePref = (k, v) => {
  prefs[k] = v;
  store.set(k, v);
};

const state = {
  path: null,
  source: '',
  eol: '\n',
  lastWritten: null,
  blocks: new Set(),
  toc: [],
  files: [],
  root: null,
  openDirs: new Set(),
  back: [],
  fwd: [],
  mode: 'read',
  saveTimer: null,
  blockEdit: null,
  pendingReload: false,
};

// ───────────────────────── helpers ─────────────────────────

const escapeHtml = (s) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const basename = (p) => p.split(/[\\/]/).pop();
const dirname = (p) => p.replace(/[\\/][^\\/]*$/, '');

function joinPath(dir, rel) {
  if (/^[a-zA-Z]:[\\/]/.test(rel) || rel.startsWith('\\\\')) return rel;
  const unc = dir.startsWith('\\\\') ? '\\\\' : '';
  const out = [];
  for (const s of (dir + '/' + rel).split(/[\\/]+/)) {
    if (s === '..') out.pop();
    else if (s && s !== '.') out.push(s);
  }
  return unc + out.join('\\');
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

const isDark = () => document.documentElement.dataset.theme === 'dark';
const sourceLines = () => state.source.split('\n');

function blockText(el, lines) {
  const [a, b] = el.dataset.src.split(':').map(Number);
  return lines.slice(a, b).join('\n');
}

// ───────────────────────── rendering ─────────────────────────

function renderDoc({ flash = false } = {}) {
  if (!state.path) return;
  const { html, toc, words } = render(state.source);
  docEl.innerHTML = html;
  state.toc = toc;

  const lines = sourceLines();
  const next = new Set();
  for (const el of docEl.querySelectorAll(':scope > [data-src]')) {
    const text = blockText(el, lines);
    next.add(text);
    if (flash && !state.blocks.has(text)) el.classList.add('flash');
  }
  state.blocks = next;

  fixImages();
  renderMermaid();
  buildToc();
  fitWide();
  if (!$('#findbar').hidden) runFind(false);

  const minutes = Math.max(1, Math.round(words / 230));
  $('#st-words').textContent = `${words.toLocaleString()} words`;
  $('#st-time').textContent = `${minutes} min read`;
  onScroll();
}

function fixImages() {
  const dir = dirname(state.path);
  for (const img of docEl.querySelectorAll('img')) {
    const src = img.getAttribute('src') || '';
    img.loading = 'lazy';
    if (!/^(https?:|data:|asset:|blob:)/i.test(src)) {
      let rel = src;
      try {
        rel = decodeURI(src);
      } catch {}
      img.src = convertFileSrc(joinPath(dir, rel));
    }
  }
}

let mermaid;
let mermaidSeq = 0;
async function renderMermaid() {
  const nodes = [...docEl.querySelectorAll('.mermaid:not([data-done])')];
  if (!nodes.length) return;
  mermaid ??= (await import('mermaid')).default;
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: isDark() ? 'dark' : 'neutral',
    fontFamily: '"Segoe UI Variable Text", "Segoe UI", sans-serif',
  });
  for (const n of nodes) {
    const code = n.querySelector('.mermaid-code')?.textContent ?? '';
    n.dataset.done = '1';
    try {
      const { svg } = await mermaid.render(`mmd-${++mermaidSeq}`, code);
      n.innerHTML = svg;
    } catch (e) {
      n.innerHTML = `<pre class="mermaid-error">${escapeHtml(String(e?.message || e))}</pre>`;
    }
  }
  fitWide();
}

// Lets tables, code and diagrams that are wider than the text column use the
// free space on both sides of it instead of scrolling inside a narrow column.
const WIDE_SEL = ':scope > table, :scope > .code-block, :scope > pre, :scope > .mermaid';
function naturalWidth(el) {
  if (el.classList.contains('mermaid')) {
    const svg = el.querySelector('svg');
    return svg ? (parseFloat(svg.style.maxWidth) || svg.getBoundingClientRect().width) + 38 : 0;
  }
  if (el.tagName === 'TABLE') {
    // A constrained table wraps its cells instead of overflowing, so measure
    // it unconstrained.
    el.style.maxWidth = 'none';
    const w = el.offsetWidth;
    el.style.maxWidth = '';
    return w;
  }
  const inner = el.classList.contains('code-block') ? el.querySelector('pre') : el;
  return inner ? inner.scrollWidth + 2 : 0;
}
function fitWide() {
  const els = [...docEl.querySelectorAll(WIDE_SEL)];
  for (const el of els) {
    el.classList.remove('wide');
    el.style.removeProperty('--w');
  }
  if (!prefs.wideBlocks || !state.path || !els.length) return;
  const cs = getComputedStyle(docEl);
  const col = docEl.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const avail = scroller.clientWidth - 56;
  if (avail <= col + 8) return;
  for (const el of els) {
    const w = Math.min(naturalWidth(el), avail);
    if (w > col + 4) {
      el.style.setProperty('--w', `${Math.ceil(w)}px`);
      el.classList.add('wide');
    }
  }
}

// ───────────────────────── files ─────────────────────────

async function openFile(path, opts = {}) {
  let text;
  try {
    text = await invoke('read_file', { path });
  } catch (e) {
    toast(`Cannot open file: ${e}`);
    return;
  }
  if (state.blockEdit) commitBlockEdit();
  await flushSave();

  if (state.path && opts.push !== false && state.path !== path) {
    state.back.push({ path: state.path, scroll: scroller.scrollTop });
    state.fwd = [];
  }
  state.path = path;
  state.eol = text.includes('\r\n') ? '\r\n' : '\n';
  state.source = text.replace(/\r\n/g, '\n');
  state.lastWritten = state.source;
  state.blocks = new Set();
  app.classList.remove('welcome');

  if (state.mode === 'edit') sourceEl.value = state.source;
  renderDoc();
  requestAnimationFrame(() => {
    if (opts.hash) scrollToId(opts.hash, false);
    else scroller.scrollTop = opts.scroll ?? 0;
  });

  const name = basename(path);
  $('#doc-title').textContent = name;
  $('#st-path').textContent = path;
  win.setTitle(`${name} — Noumark`).catch(() => {});
  setSaveState('');
  updateNav();
  addRecent(path);
  invoke('watch_file', { path }).catch(() => {});
  loadTree(path);
}

// Runs in the background: a large folder must never delay showing the document.
async function loadTree(path) {
  const root = await invoke('workspace_root', { path });
  if (state.path !== path) return;
  for (let d = dirname(path); d.length > root.length; d = dirname(d)) state.openDirs.add(d);
  if (root !== state.root) {
    state.root = root;
    state.files = [];
    $('#root-name').textContent = basename(root) || root;
    const files = await invoke('list_markdown', { root });
    if (state.root !== root) return;
    state.files = files;
  }
  renderTree();
}

async function pickFile() {
  const p = await openDialog({
    multiple: false,
    filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd'] }, { name: 'All files', extensions: ['*'] }],
  });
  if (p) openFile(p);
}

function addRecent(path) {
  const recent = store.get('recent', []).filter((p) => p !== path);
  recent.unshift(path);
  store.set('recent', recent.slice(0, 12));
}

function setSaveState(s) {
  const el = $('#save-state');
  el.dataset.state = s;
  el.textContent = { editing: 'Editing…', saved: 'Saved', error: 'Save failed' }[s] || '';
  if (s === 'saved') setTimeout(() => el.dataset.state === 'saved' && setSaveState(''), 1600);
}

function scheduleSave(immediate = false) {
  clearTimeout(state.saveTimer);
  setSaveState('editing');
  state.saveTimer = setTimeout(save, immediate ? 0 : 600);
}

async function save() {
  state.saveTimer = null;
  if (!state.path || state.source === state.lastWritten) {
    setSaveState(state.path ? 'saved' : '');
    return;
  }
  const content = state.source;
  try {
    await invoke('write_file', { path: state.path, content: content.replace(/\n/g, state.eol) });
    state.lastWritten = content;
    setSaveState('saved');
  } catch (e) {
    setSaveState('error');
    toast(`Save failed: ${e}`);
  }
}

async function flushSave() {
  if (state.saveTimer) {
    clearTimeout(state.saveTimer);
    await save();
  }
}

let changeTimer;
async function reloadFromDisk() {
  if (!state.path) return;
  if (state.saveTimer || state.blockEdit) {
    state.pendingReload = true;
    return;
  }
  let text;
  try {
    text = await invoke('read_file', { path: state.path });
  } catch {
    return;
  }
  const norm = text.replace(/\r\n/g, '\n');
  state.pendingReload = false;
  if (norm === state.source) return;
  state.source = norm;
  state.lastWritten = norm;
  if (state.mode === 'edit') {
    const { selectionStart, selectionEnd, scrollTop } = sourceEl;
    sourceEl.value = norm;
    sourceEl.setSelectionRange(selectionStart, selectionEnd);
    sourceEl.scrollTop = scrollTop;
  }
  renderDoc({ flash: true });
  toast('Updated — file changed on disk');
}

// ───────────────────────── navigation ─────────────────────────

function updateNav() {
  $('#btn-back').disabled = !state.back.length;
  $('#btn-forward').disabled = !state.fwd.length;
}

function goBack() {
  const prev = state.back.pop();
  if (!prev) return;
  state.fwd.push({ path: state.path, scroll: scroller.scrollTop });
  openFile(prev.path, { push: false, scroll: prev.scroll });
}

function goForward() {
  const next = state.fwd.pop();
  if (!next) return;
  state.back.push({ path: state.path, scroll: scroller.scrollTop });
  openFile(next.path, { push: false, scroll: next.scroll });
}

function scrollToId(id, smooth = true) {
  const el = document.getElementById(id);
  if (!el) return;
  const top = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - 20;
  scroller.scrollTo({ top, behavior: smooth ? 'smooth' : 'auto' });
  el.classList.remove('flash');
  void el.offsetWidth;
  el.classList.add('flash');
}

async function handleLink(href) {
  if (!href) return;
  if (href.startsWith('#')) return scrollToId(decodeURIComponent(href.slice(1)));
  if (/^(https?:|mailto:)/i.test(href)) return invoke('open_external', { target: href });
  if (!state.path || /^[a-z][a-z0-9+.-]*:/i.test(href)) return;
  const [p, hash] = href.split('#');
  if (!p) return;
  const target = await invoke('resolve_link', { from: state.path, href: p });
  if (!target) return toast(`Link not found: ${p}`);
  if (MD_RE.test(target)) openFile(target, { hash: hash && decodeURIComponent(hash) });
  else invoke('open_external', { target }).catch((e) => toast(String(e)));
}

// ───────────────────────── block editing ─────────────────────────

function autosize(ta) {
  ta.style.height = 'auto';
  ta.style.height = ta.scrollHeight + 2 + 'px';
}

function startBlockEdit(el) {
  if (state.blockEdit) commitBlockEdit();
  const [a, b] = el.dataset.src.split(':').map(Number);
  const original = sourceLines().slice(a, b).join('\n');
  const wrap = document.createElement('div');
  wrap.className = 'block-editor';
  const ta = document.createElement('textarea');
  ta.spellcheck = false;
  ta.value = original;
  const hint = document.createElement('div');
  hint.className = 'block-hint';
  hint.innerHTML = '<span>Editing Markdown</span><span><kbd>Ctrl</kbd>+<kbd>Enter</kbd> save · <kbd>Esc</kbd> cancel</span>';
  wrap.append(ta, hint);
  el.replaceWith(wrap);
  state.blockEdit = { a, b, original, ta, wrap, el };

  autosize(ta);
  ta.addEventListener('input', () => autosize(ta));
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      cancelBlockEdit();
    } else if (e.key === 'Enter' && e.ctrlKey) {
      e.preventDefault();
      commitBlockEdit();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      insertAtCursor(ta, '  ');
    }
  });
  ta.addEventListener('blur', () => {
    setTimeout(() => {
      if (state.blockEdit?.ta === ta && document.activeElement !== ta) commitBlockEdit();
    }, 120);
  });
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);
}

function finishBlockEdit() {
  state.blockEdit = null;
  if (state.pendingReload) reloadFromDisk();
}

function commitBlockEdit() {
  const be = state.blockEdit;
  if (!be) return;
  if (be.ta.value === be.original) {
    be.wrap.replaceWith(be.el);
    finishBlockEdit();
    return;
  }
  const lines = sourceLines();
  lines.splice(be.a, be.b - be.a, ...be.ta.value.split('\n'));
  state.source = lines.join('\n');
  state.blockEdit = null;
  scheduleSave(true);
  renderDoc({ flash: true });
  finishBlockEdit();
}

function cancelBlockEdit() {
  const be = state.blockEdit;
  if (!be) return;
  be.wrap.replaceWith(be.el);
  finishBlockEdit();
}

function toggleTask(line) {
  const lines = sourceLines();
  const m = lines[line]?.match(/^(\s*(?:>\s*)*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\])/);
  if (!m) return;
  lines[line] = m[1] + (m[2] === ' ' ? 'x' : ' ') + m[3] + lines[line].slice(m[0].length);
  state.source = lines.join('\n');
  scheduleSave(true);
  renderDoc();
}

function insertAtCursor(ta, text) {
  const { selectionStart: s, selectionEnd: e } = ta;
  ta.setRangeText(text, s, e, 'end');
  ta.dispatchEvent(new Event('input'));
}

function wrapSelection(ta, mark) {
  const { selectionStart: s, selectionEnd: e, value } = ta;
  const sel = value.slice(s, e);
  ta.setRangeText(mark + sel + mark, s, e, 'select');
  if (!sel) ta.setSelectionRange(s + mark.length, s + mark.length);
  ta.dispatchEvent(new Event('input'));
}

// ───────────────────────── modes & layout ─────────────────────────

function setMode(mode) {
  if (!state.path) return;
  if (state.blockEdit) commitBlockEdit();
  state.mode = mode;
  app.classList.toggle('editing', mode === 'edit');
  const btn = $('#btn-mode');
  btn.innerHTML = icon(mode === 'edit' ? 'read' : 'edit');
  btn.title = mode === 'edit' ? 'Back to reading (Ctrl+E)' : 'Edit source (Ctrl+E)';
  $('#st-mode').textContent = mode === 'edit' ? 'Editing' : 'Reading';
  if (mode === 'edit') {
    sourceEl.value = state.source;
    sourceEl.focus();
  } else {
    renderDoc();
  }
}

function widthLabel() {
  return WIDTHS.find(([, , w]) => w === prefs.width)?.[1] ?? `${prefs.width}px`;
}

function applyLayout() {
  const root = document.documentElement.style;
  app.classList.toggle('no-sidebar', !prefs.sidebar);
  app.classList.toggle('no-outline', !prefs.outline);
  app.dataset.font = prefs.font;
  root.setProperty('--zoom', prefs.zoom / 100);
  root.setProperty('--fs', `${prefs.fontSize}px`);
  root.setProperty('--lh', prefs.lineHeight);
  root.setProperty('--content-w', prefs.width ? `${prefs.width}px` : '100vw');
  root.setProperty('--side-w', `${prefs.sideW}px`);
  root.setProperty('--toc-w', `${prefs.tocW}px`);
  $('#st-zoom').textContent = prefs.zoom === 100 ? '' : `${prefs.zoom}%`;
  $('#st-width').innerHTML = `${icon('width', 13)}${widthLabel()}`;
  requestAnimationFrame(fitWide);
}

function setZoom(z) {
  savePref('zoom', Math.min(200, Math.max(60, z)));
  applyLayout();
}

function setWidth(w) {
  setPref('width', w === 0 || w > WIDTH_MAX ? 0 : Math.max(WIDTH_MIN, Math.round(w / 10) * 10));
}

function cycleWidth() {
  const i = WIDTHS.findIndex(([, , w]) => w === prefs.width);
  setWidth(WIDTHS[(i + 1) % WIDTHS.length][2]);
  toast(`Content width: ${widthLabel()}`);
}

function stepWidth(dir) {
  const cur = prefs.width || WIDTH_MAX + 80;
  const next = cur + dir * 80;
  setWidth(next > WIDTH_MAX ? 0 : next);
  toast(`Content width: ${widthLabel()}`);
}

const systemDark = matchMedia('(prefers-color-scheme: dark)');
function applyTheme() {
  const dark = prefs.theme === 'dark' || (prefs.theme === 'system' && systemDark.matches);
  const changed = document.documentElement.dataset.theme !== (dark ? 'dark' : 'light');
  const bg = applyPalette(document.documentElement, dark, dark ? prefs.dark : prefs.light, accentColor(prefs.accent, prefs.accentCustom, dark));
  const btn = $('#btn-theme');
  btn.innerHTML = icon({ system: 'system', light: 'sun', dark: 'moon' }[prefs.theme]);
  btn.title = `Theme: ${prefs.theme} (Ctrl+T)`;
  win.setTheme(prefs.theme === 'system' ? null : prefs.theme).catch(() => {});
  invoke('set_background', { color: bg }).catch(() => {});
  if (changed && docEl.querySelector('.mermaid')) renderDoc();
}
systemDark.addEventListener('change', applyTheme);

function cycleTheme() {
  setPref('theme', THEMES[(THEMES.indexOf(prefs.theme) + 1) % THEMES.length]);
  toast(`Theme: ${prefs.theme}`);
}

// ───────────────────────── settings ─────────────────────────

const THEME_KEYS = new Set(['theme', 'light', 'dark', 'accent', 'accentCustom']);

/** Updates one or more preferences and re-applies whatever they affect. */
function setPref(key, value, extra = {}) {
  const changes = { [key]: value, ...extra };
  for (const [k, v] of Object.entries(changes)) savePref(k, v);
  if (Object.keys(changes).some((k) => THEME_KEYS.has(k))) applyTheme();
  applyLayout();
  syncSettings();
}

function resetPrefs() {
  for (const [k, v] of Object.entries(DEFAULTS)) if (k !== 'zoom') savePref(k, v);
  applyTheme();
  applyLayout();
  syncSettings();
  toast('Settings reset to defaults');
}

const seg = (key, options) =>
  `<div class="seg">${options.map(([v, label]) => `<button data-set="${key}" data-val="${v}">${label}</button>`).join('')}</div>`;

const themeCards = (key, list) =>
  `<div class="theme-grid">${Object.entries(list)
    .map(
      ([id, t]) =>
        `<button class="theme-card" data-set="${key}" data-val="${id}" title="${t.name}">` +
        `<span class="tc-preview" style="background:${t.bg};color:${t.text}"><i style="background:${t.surface2}"></i><b style="background:${t.text}"></b><b style="background:${t.muted}"></b><em></em></span>` +
        `<span class="tc-name">${t.name}</span></button>`,
    )
    .join('')}</div>`;

const range = (key, min, max, step, unit = '') =>
  `<div class="range"><input type="range" data-range="${key}" min="${min}" max="${max}" step="${step}"><output data-out="${key}" data-unit="${unit}"></output></div>`;

const toggle = (key, label) =>
  `<label class="toggle"><span>${label}</span><input type="checkbox" data-check="${key}"><i></i></label>`;

function buildSettings() {
  $('.settings-card').innerHTML = `
    <header class="set-head"><span>${icon('settings', 16)}Settings</span><button class="icon-btn sm" data-close title="Close (Esc)">${icon('x', 15)}</button></header>
    <div class="set-body">
      <section>
        <h3>Appearance</h3>
        ${seg('theme', [['system', 'Auto'], ['light', 'Light'], ['dark', 'Dark']])}
        <h4>Light theme</h4>
        ${themeCards('light', LIGHT)}
        <h4>Dark theme</h4>
        ${themeCards('dark', DARK)}
        <h4>Accent</h4>
        <div class="accents">${Object.keys(ACCENTS)
          .map((a) => `<button class="accent" data-set="accent" data-val="${a}" title="${a}" style="--c:${ACCENTS[a][0]};--c2:${ACCENTS[a][1]}"></button>`)
          .join('')}<label class="accent custom" title="Custom colour" data-accent-custom><input type="color" data-color="accentCustom"></label></div>
      </section>
      <section>
        <h3>Reading</h3>
        <h4>Font</h4>
        ${seg('font', [['sans', 'Sans'], ['serif', 'Serif'], ['mono', 'Mono']])}
        <h4>Text size</h4>
        ${range('fontSize', 13, 22, 0.5, 'px')}
        <h4>Line height</h4>
        ${range('lineHeight', 1.4, 2.1, 0.05)}
        <h4>Content width</h4>
        ${seg('width', WIDTHS.map(([, name, w]) => [w, name]))}
        ${range('width', WIDTH_MIN, WIDTH_MAX + 40, 20)}
        ${toggle('wideBlocks', 'Let wide tables, code &amp; diagrams use the free space')}
      </section>
      <section>
        <h3>Layout</h3>
        ${toggle('sidebar', 'Files sidebar')}
        ${toggle('outline', 'Outline')}
        <p class="set-hint">Drag the edge of the sidebar or the outline to resize it; double-click the edge to reset.</p>
      </section>
    </div>
    <footer class="set-foot"><button class="btn sm" data-reset>${icon('reload', 14)}Reset to defaults</button></footer>`;
}

/** Reflects the current preferences in the settings panel controls. */
function syncSettings() {
  const card = $('.settings-card');
  if (!card.firstChild) return;
  for (const b of card.querySelectorAll('[data-set]')) b.classList.toggle('on', String(prefs[b.dataset.set]) === b.dataset.val);
  card.querySelector('[data-accent-custom]').classList.toggle('on', prefs.accent === 'custom');
  card.querySelector('[data-accent-custom]').style.setProperty('--c', prefs.accentCustom);
  card.querySelector('[data-color]').value = prefs.accentCustom;
  for (const c of card.querySelectorAll('[data-check]')) c.checked = !!prefs[c.dataset.check];
  for (const r of card.querySelectorAll('[data-range]')) {
    const k = r.dataset.range;
    const v = k === 'width' && !prefs.width ? WIDTH_MAX + 40 : prefs[k];
    if (document.activeElement !== r) r.value = v;
  }
  for (const o of card.querySelectorAll('[data-out]')) {
    const k = o.dataset.out;
    o.textContent = k === 'width' ? widthLabel() : k === 'lineHeight' ? Number(prefs[k]).toFixed(2) : `${prefs[k]}${o.dataset.unit}`;
  }
}

function openSettings() {
  if (!$('.settings-card').firstChild) buildSettings();
  $('#settings').hidden = false;
  app.classList.add('settings-open');
  syncSettings();
}
function closeSettings() {
  $('#settings').hidden = true;
  app.classList.remove('settings-open');
}
function toggleSettings() {
  $('#settings').hidden ? openSettings() : closeSettings();
}

$('#settings').addEventListener('mousedown', (e) => {
  if (e.target.id === 'settings') closeSettings();
});
$('#settings').addEventListener('click', (e) => {
  if (e.target.closest('[data-close]')) return closeSettings();
  if (e.target.closest('[data-reset]')) return resetPrefs();
  const b = e.target.closest('[data-set]');
  if (!b) return;
  const key = b.dataset.set;
  const val = typeof DEFAULTS[key] === 'number' ? Number(b.dataset.val) : b.dataset.val;
  if (key === 'light' || key === 'dark') setPref(key, val, prefs.theme === 'system' ? {} : { theme: key });
  else setPref(key, val);
});
$('#settings').addEventListener('input', (e) => {
  const t = e.target;
  if (t.dataset.range) {
    const k = t.dataset.range;
    const v = Number(t.value);
    if (k === 'width') setWidth(v > WIDTH_MAX ? 0 : v);
    else setPref(k, v);
  } else if (t.dataset.color) {
    setPref('accentCustom', t.value, { accent: 'custom' });
  }
});
$('#settings').addEventListener('change', (e) => {
  if (e.target.dataset.check) setPref(e.target.dataset.check, e.target.checked);
});

// ───────────────────────── panel resizing ─────────────────────────

function initResizer(el, key, dir, min, max) {
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    const x0 = e.clientX;
    const w0 = prefs[key];
    app.classList.add('resizing');
    const move = (ev) => {
      prefs[key] = Math.round(Math.min(max, Math.max(min, w0 + (ev.clientX - x0) * dir)));
      document.documentElement.style.setProperty(key === 'sideW' ? '--side-w' : '--toc-w', `${prefs[key]}px`);
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      app.classList.remove('resizing');
      savePref(key, prefs[key]);
      fitWide();
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  });
  el.addEventListener('dblclick', () => setPref(key, DEFAULTS[key]));
}

function toggleFocus() {
  app.classList.toggle('focus');
  onScroll();
  if (app.classList.contains('focus')) toast('Focus mode — Esc to exit');
}

// ───────────────────────── outline & scroll ─────────────────────────

function buildToc() {
  const toc = $('#toc');
  if (!state.toc.length) {
    toc.innerHTML = '<div class="toc-empty">No headings</div>';
    return;
  }
  const min = Math.min(...state.toc.map((h) => h.level));
  toc.innerHTML = state.toc
    .map((h) => `<a href="#${h.id}" data-id="${h.id}" style="--depth:${h.level - min}">${escapeHtml(h.text)}</a>`)
    .join('');
}

let scrollRaf = 0;
function onScroll() {
  cancelAnimationFrame(scrollRaf);
  scrollRaf = requestAnimationFrame(() => {
    const max = scroller.scrollHeight - scroller.clientHeight;
    $('#progress-bar').style.transform = `scaleX(${max > 0 ? scroller.scrollTop / max : 0})`;

    const top = scroller.getBoundingClientRect().top;
    let active = state.toc[0]?.id;
    for (const h of state.toc) {
      const el = document.getElementById(h.id);
      if (el && el.getBoundingClientRect().top - top < 120) active = h.id;
      else break;
    }
    for (const a of $('#toc').children) a.classList.toggle('active', a.dataset.id === active);

    if (app.classList.contains('focus')) {
      const mid = top + scroller.clientHeight * 0.42;
      for (const el of docEl.children) {
        const r = el.getBoundingClientRect();
        el.classList.toggle('lit', r.top <= mid + 40 && r.bottom >= mid - 40);
      }
    }
  });
}

// ───────────────────────── sidebar tree ─────────────────────────

function buildTreeModel() {
  const root = { dirs: new Map(), files: [] };
  for (const f of state.files) {
    const parts = f.rel.split('/');
    let node = root;
    let abs = state.root;
    for (const part of parts.slice(0, -1)) {
      abs = abs + '\\' + part;
      if (!node.dirs.has(part)) node.dirs.set(part, { dirs: new Map(), files: [], abs });
      node = node.dirs.get(part);
    }
    node.files.push(f);
  }
  return root;
}

function treeHtml(node, depth) {
  const dirs = [...node.dirs.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const files = [...node.files].sort((a, b) => basename(a.rel).localeCompare(basename(b.rel)));
  let html = '';
  for (const [name, d] of dirs) {
    const open = state.openDirs.has(d.abs);
    html += `<div class="t-dir${open ? ' open' : ''}" data-dir="${escapeHtml(d.abs)}" style="--depth:${depth}">${icon('chevron', 14)}<span>${escapeHtml(name)}</span></div>`;
    if (open) html += treeHtml(d, depth + 1);
  }
  for (const f of files) html += fileRow(f, basename(f.rel), depth);
  return html;
}

function fileRow(f, label, depth, sub = '') {
  const active = f.path === state.path ? ' active' : '';
  return `<div class="t-file${active}" data-path="${escapeHtml(f.path)}" style="--depth:${depth}">${icon('file', 14)}<span>${escapeHtml(label.replace(MD_RE, ''))}</span>${sub ? `<em>${escapeHtml(sub)}</em>` : ''}</div>`;
}

function renderTree() {
  const tree = $('#tree');
  const q = $('#side-filter').value.trim().toLowerCase();
  if (!state.files.length) {
    tree.innerHTML = '<div class="toc-empty">No Markdown files</div>';
    return;
  }
  tree.innerHTML = q
    ? state.files
        .filter((f) => f.rel.toLowerCase().includes(q))
        .map((f) => fileRow(f, basename(f.rel), 0, dirname('/' + f.rel).slice(1)))
        .join('') || '<div class="toc-empty">No matches</div>'
    : treeHtml(buildTreeModel(), 0);
  tree.querySelector('.active')?.scrollIntoView({ block: 'nearest' });
}

// ───────────────────────── find ─────────────────────────

const find = { ranges: [], idx: 0 };

function openFind() {
  if (!state.path) return;
  const bar = $('#findbar');
  bar.hidden = false;
  const input = $('#find-input');
  const sel = window.getSelection()?.toString();
  if (sel && sel.length < 80 && !sel.includes('\n')) input.value = sel;
  input.focus();
  input.select();
  runFind();
}

function closeFind() {
  $('#findbar').hidden = true;
  CSS.highlights?.clear();
}

function runFind(jump = true) {
  const q = $('#find-input').value.toLowerCase();
  find.ranges = [];
  CSS.highlights?.clear();
  if (q) {
    const walker = document.createTreeWalker(docEl, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const n = walker.currentNode;
      const t = n.data.toLowerCase();
      for (let i = t.indexOf(q); i !== -1; i = t.indexOf(q, i + q.length)) {
        const r = new Range();
        r.setStart(n, i);
        r.setEnd(n, i + q.length);
        find.ranges.push(r);
      }
    }
  }
  if (find.ranges.length && CSS.highlights) CSS.highlights.set('find', new Highlight(...find.ranges));
  find.idx = Math.min(find.idx, Math.max(0, find.ranges.length - 1));
  if (jump) find.idx = 0;
  showMatch(jump);
}

function showMatch(scroll = true) {
  const n = find.ranges.length;
  $('#find-count').textContent = $('#find-input').value ? (n ? `${find.idx + 1} / ${n}` : 'No results') : '';
  if (!n) return;
  const r = find.ranges[find.idx];
  CSS.highlights?.set('find-current', new Highlight(r));
  if (scroll) {
    const rect = r.getBoundingClientRect();
    const sr = scroller.getBoundingClientRect();
    if (rect.top < sr.top + 60 || rect.bottom > sr.bottom - 60) {
      scroller.scrollTo({ top: scroller.scrollTop + rect.top - sr.top - sr.height / 3, behavior: 'smooth' });
    }
  }
}

function stepFind(d) {
  if (!find.ranges.length) return;
  find.idx = (find.idx + d + find.ranges.length) % find.ranges.length;
  showMatch();
}

// ───────────────────────── command palette ─────────────────────────

const commands = [
  { id: 'open', title: 'Open file…', key: 'Ctrl O', icon: 'open', run: pickFile },
  { id: 'edit', title: 'Toggle edit source', key: 'Ctrl E', icon: 'edit', run: () => setMode(state.mode === 'edit' ? 'read' : 'edit') },
  { id: 'sidebar', title: 'Toggle file sidebar', key: 'Ctrl B', icon: 'sidebar', run: () => toggleSidebar() },
  { id: 'outline', title: 'Toggle outline', key: 'Ctrl \\', icon: 'outline', run: () => toggleOutline() },
  { id: 'theme', title: 'Cycle theme (system / light / dark)', key: 'Ctrl T', icon: 'sun', run: cycleTheme },
  { id: 'focus', title: 'Focus mode', key: 'Ctrl .', icon: 'focus', run: toggleFocus },
  { id: 'find', title: 'Find in document', key: 'Ctrl F', icon: 'search', run: openFind },
  { id: 'settings', title: 'Settings — themes, fonts & layout', key: 'Ctrl ,', icon: 'settings', run: () => openSettings() },
  { id: 'width', title: 'Cycle content width', icon: 'width', run: cycleWidth },
  { id: 'wider', title: 'Wider content', key: 'Ctrl ]', icon: 'width', run: () => stepWidth(1) },
  { id: 'narrower', title: 'Narrower content', key: 'Ctrl [', icon: 'width', run: () => stepWidth(-1) },
  ...WIDTHS.map(([id, name, w]) => ({ id: `width-${id}`, title: `Content width: ${name}`, icon: 'width', run: () => setWidth(w) })),
  ...['Sans', 'Serif', 'Mono'].map((f) => ({ id: `font-${f}`, title: `Reading font: ${f}`, icon: 'type', run: () => setPref('font', f.toLowerCase()) })),
  ...Object.entries(LIGHT).map(([id, t]) => ({ id: `light-${id}`, title: `Light theme: ${t.name}`, icon: 'sun', run: () => setPref('light', id, { theme: 'light' }) })),
  ...Object.entries(DARK).map(([id, t]) => ({ id: `dark-${id}`, title: `Dark theme: ${t.name}`, icon: 'moon', run: () => setPref('dark', id, { theme: 'dark' }) })),
  ...Object.keys(ACCENTS).map((a) => ({ id: `accent-${a}`, title: `Accent colour: ${a[0].toUpperCase() + a.slice(1)}`, icon: 'palette', run: () => setPref('accent', a) })),
  { id: 'zoomin', title: 'Zoom in', key: 'Ctrl +', icon: 'zoomIn', run: () => setZoom(prefs.zoom + 10) },
  { id: 'zoomout', title: 'Zoom out', key: 'Ctrl -', icon: 'zoomOut', run: () => setZoom(prefs.zoom - 10) },
  { id: 'zoomreset', title: 'Reset zoom', key: 'Ctrl 0', icon: 'search', run: () => setZoom(100) },
  { id: 'reload', title: 'Reload from disk', key: 'F5', icon: 'reload', run: () => reloadFromDisk() },
  { id: 'reveal', title: 'Reveal in File Explorer', icon: 'folder', run: () => state.path && invoke('reveal', { path: state.path }) },
  { id: 'copypath', title: 'Copy file path', icon: 'copy', run: () => state.path && navigator.clipboard.writeText(state.path).then(() => toast('Path copied')) },
  { id: 'default', title: 'Set Noumark as default Markdown app', icon: 'star', run: () => invoke('open_external', { target: 'ms-settings:defaultapps' }) },
];

const palette = { items: [], idx: 0 };

function fuzzy(q, s) {
  const t = s.toLowerCase();
  let qi = 0;
  let score = 0;
  let last = -2;
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] !== q[qi]) continue;
    score += i === last + 1 ? 3 : 1;
    if (i === 0 || /[\s/_\-.]/.test(t[i - 1])) score += 2;
    last = i;
    qi++;
  }
  return qi === q.length ? score - t.length * 0.01 : -1;
}

function rank(list, q, key) {
  if (!q) return list.slice(0, 60);
  return list
    .map((x) => ({ x, s: fuzzy(q, key(x)) }))
    .filter((r) => r.s >= 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, 60)
    .map((r) => r.x);
}

function paletteItems(raw) {
  const q = raw.trim().toLowerCase();
  if (q.startsWith('>')) {
    return rank(commands, q.slice(1).trim(), (c) => c.title).map((c) => ({ icon: c.icon, title: c.title, key: c.key, run: c.run }));
  }
  if (q.startsWith('#')) {
    return rank(state.toc, q.slice(1).trim(), (h) => h.text).map((h) => ({
      icon: 'hash',
      title: h.text,
      sub: `H${h.level}`,
      run: () => scrollToId(h.id),
    }));
  }
  const recent = store.get('recent', []);
  const files = state.files.length ? state.files : recent.map((p) => ({ path: p, rel: p }));
  const ordered = q ? files : [...files].sort((a, b) => {
    const ra = recent.indexOf(a.path);
    const rb = recent.indexOf(b.path);
    return (ra < 0 ? 999 : ra) - (rb < 0 ? 999 : rb);
  });
  const items = rank(ordered, q, (f) => f.rel).map((f) => ({
    icon: 'file',
    title: basename(f.rel).replace(MD_RE, ''),
    sub: f.rel,
    run: () => openFile(f.path),
  }));
  if (q) {
    items.push(
      ...rank(state.toc, q, (h) => h.text).slice(0, 8).map((h) => ({ icon: 'hash', title: h.text, sub: 'Heading', run: () => scrollToId(h.id) })),
      ...rank(commands, q, (c) => c.title).slice(0, 5).map((c) => ({ icon: c.icon, title: c.title, key: c.key, sub: 'Command', run: c.run })),
    );
  }
  return items;
}

function openPalette(prefix = '') {
  const p = $('#palette');
  p.hidden = false;
  const input = $('#palette-input');
  input.value = prefix;
  input.focus();
  updatePalette();
}

function closePalette() {
  $('#palette').hidden = true;
}

function updatePalette() {
  palette.items = paletteItems($('#palette-input').value);
  palette.idx = 0;
  drawPalette();
}

function drawPalette() {
  const list = $('#palette-list');
  if (!palette.items.length) {
    list.innerHTML = '<div class="pal-empty">Nothing found</div>';
    return;
  }
  list.innerHTML = palette.items
    .map(
      (it, i) =>
        `<div class="pal-item${i === palette.idx ? ' active' : ''}" data-i="${i}">${icon(it.icon, 16)}` +
        `<span class="pal-title">${escapeHtml(it.title)}</span>` +
        `${it.sub ? `<span class="pal-sub">${escapeHtml(it.sub)}</span>` : ''}` +
        `${it.key ? `<kbd>${escapeHtml(it.key)}</kbd>` : ''}</div>`,
    )
    .join('');
  list.querySelector('.active')?.scrollIntoView({ block: 'nearest' });
}

function runPaletteItem(i) {
  const it = palette.items[i];
  if (!it) return;
  closePalette();
  it.run();
}

// ───────────────────────── welcome ─────────────────────────

function showWelcome() {
  app.classList.add('welcome');
  const recent = store.get('recent', []);
  const shortcuts = [
    ['Ctrl K', 'Command palette'],
    ['Ctrl E', 'Edit source'],
    ['Double-click', 'Edit any block'],
    ['Ctrl F', 'Find'],
    ['Ctrl .', 'Focus mode'],
    ['Ctrl ,', 'Themes & layout'],
  ];
  docEl.innerHTML = `
    <section class="hero">
      <div class="hero-mark"></div>
      <h1 class="wordmark"><span>nou</span>mark</h1>
      <p class="tagline">Markdown, beautifully. Instantly.</p>
      <div class="hero-actions">
        <button class="btn primary" data-act="open">${icon('open', 16)}Open file<kbd>Ctrl O</kbd></button>
        <button class="btn" data-act="default">${icon('star', 16)}Set as default for .md</button>
      </div>
      ${recent.length ? `<h2 class="hero-sub">Recent</h2><div class="recent">${recent
        .map((p) => `<button class="recent-item" data-path="${escapeHtml(p)}">${icon('file', 16)}<span>${escapeHtml(basename(p))}</span><em>${escapeHtml(dirname(p))}</em></button>`)
        .join('')}</div>` : ''}
      <div class="shortcuts">${shortcuts.map(([k, v]) => `<div><kbd>${k}</kbd><span>${v}</span></div>`).join('')}</div>
      <p class="drop-hint">or drop a .md file anywhere</p>
    </section>`;
}

// ───────────────────────── events ─────────────────────────

function toggleSidebar() {
  setPref('sidebar', !prefs.sidebar);
}
function toggleOutline() {
  setPref('outline', !prefs.outline);
}

docEl.addEventListener('click', (e) => {
  const act = e.target.closest('[data-act]');
  if (act) return act.dataset.act === 'open' ? pickFile() : invoke('open_external', { target: 'ms-settings:defaultapps' });
  const recent = e.target.closest('.recent-item');
  if (recent) return openFile(recent.dataset.path);

  const cb = e.target.closest('input.task');
  if (cb) {
    e.preventDefault();
    return toggleTask(Number(cb.dataset.line));
  }
  const copy = e.target.closest('.code-copy');
  if (copy) {
    const code = copy.closest('.code-block').querySelector('code').textContent;
    navigator.clipboard.writeText(code).then(() => {
      copy.textContent = 'Copied';
      copy.classList.add('done');
      setTimeout(() => {
        copy.textContent = 'Copy';
        copy.classList.remove('done');
      }, 1400);
    });
    return;
  }
  const a = e.target.closest('a');
  if (a) {
    e.preventDefault();
    handleLink(a.getAttribute('href'));
  }
});

docEl.addEventListener('dblclick', (e) => {
  if (state.mode !== 'read' || !state.path) return;
  if (e.target.closest('a, input, button, .block-editor')) return;
  let el = e.target.closest('[data-src]');
  while (el && el.parentElement !== docEl) el = el.parentElement.closest('[data-src]');
  if (!el) return;
  e.preventDefault();
  window.getSelection()?.removeAllRanges();
  startBlockEdit(el);
});

let previewTimer;
sourceEl.addEventListener('input', () => {
  state.source = sourceEl.value;
  scheduleSave();
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => renderDoc(), 140);
});

sourceEl.addEventListener('keydown', (e) => {
  if (e.key === 'Tab') {
    e.preventDefault();
    insertAtCursor(sourceEl, '  ');
  } else if (e.ctrlKey && !e.shiftKey && (e.key === 'b' || e.key === 'i')) {
    e.preventDefault();
    e.stopPropagation();
    wrapSelection(sourceEl, e.key === 'b' ? '**' : '*');
  }
});

sourceEl.addEventListener('scroll', () => {
  const max = sourceEl.scrollHeight - sourceEl.clientHeight;
  if (max > 0) scroller.scrollTop = (sourceEl.scrollTop / max) * (scroller.scrollHeight - scroller.clientHeight);
});

scroller.addEventListener('scroll', onScroll, { passive: true });

$('#toc').addEventListener('click', (e) => {
  const a = e.target.closest('a');
  if (!a) return;
  e.preventDefault();
  scrollToId(a.dataset.id);
});

$('#tree').addEventListener('click', (e) => {
  const dir = e.target.closest('.t-dir');
  if (dir) {
    const d = dir.dataset.dir;
    state.openDirs.has(d) ? state.openDirs.delete(d) : state.openDirs.add(d);
    return renderTree();
  }
  const f = e.target.closest('.t-file');
  if (f && f.dataset.path !== state.path) openFile(f.dataset.path);
});

$('#side-filter').addEventListener('input', renderTree);
$('#btn-sidebar').addEventListener('click', toggleSidebar);
$('#btn-outline').addEventListener('click', toggleOutline);
$('#btn-back').addEventListener('click', goBack);
$('#btn-forward').addEventListener('click', goForward);
$('#btn-theme').addEventListener('click', cycleTheme);
$('#btn-settings').addEventListener('click', toggleSettings);
$('#st-width').addEventListener('click', cycleWidth);
$('#btn-palette').addEventListener('click', () => openPalette());
$('#btn-mode').addEventListener('click', () => (state.path ? setMode(state.mode === 'edit' ? 'read' : 'edit') : pickFile()));

$('#win-min').addEventListener('click', () => win.minimize());
$('#win-max').addEventListener('click', () => win.toggleMaximize());
$('#win-close').addEventListener('click', async () => {
  if (state.blockEdit) commitBlockEdit();
  await flushSave();
  win.close();
});
win.onResized(async () => {
  const max = await win.isMaximized();
  $('#win-max').innerHTML = max ? '&#xE923;' : '&#xE922;';
  app.classList.toggle('maximized', max);
});

$('#palette-input').addEventListener('input', updatePalette);
$('#palette-input').addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const n = palette.items.length;
    if (!n) return;
    palette.idx = (palette.idx + (e.key === 'ArrowDown' ? 1 : -1) + n) % n;
    drawPalette();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    runPaletteItem(palette.idx);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    closePalette();
  }
});
$('#palette-list').addEventListener('click', (e) => {
  const it = e.target.closest('.pal-item');
  if (it) runPaletteItem(Number(it.dataset.i));
});
$('#palette').addEventListener('mousedown', (e) => {
  if (e.target.id === 'palette') closePalette();
});

$('#find-input').addEventListener('input', () => runFind());
$('#find-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    stepFind(e.shiftKey ? -1 : 1);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    closeFind();
  }
});
$('#find-prev').addEventListener('click', () => stepFind(-1));
$('#find-next').addEventListener('click', () => stepFind(1));
$('#find-close').addEventListener('click', closeFind);

document.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  const ctrl = e.ctrlKey || e.metaKey;
  if (ctrl && (k === 'k' || k === 'p')) {
    e.preventDefault();
    return openPalette(e.shiftKey ? '>' : '');
  }
  if (ctrl && k === 'o') return e.preventDefault(), pickFile();
  if (ctrl && k === 'e') return e.preventDefault(), setMode(state.mode === 'edit' ? 'read' : 'edit');
  if (ctrl && k === 'b') return e.preventDefault(), toggleSidebar();
  if (ctrl && k === '\\') return e.preventDefault(), toggleOutline();
  if (ctrl && k === 't') return e.preventDefault(), cycleTheme();
  if (ctrl && k === ',') return e.preventDefault(), toggleSettings();
  if (ctrl && k === '[') return e.preventDefault(), stepWidth(-1);
  if (ctrl && k === ']') return e.preventDefault(), stepWidth(1);
  if (ctrl && k === 'f') return e.preventDefault(), openFind();
  if (ctrl && k === '.') return e.preventDefault(), toggleFocus();
  if (ctrl && k === 's') return e.preventDefault(), flushSave().then(() => setSaveState('saved'));
  if (ctrl && (k === '=' || k === '+')) return e.preventDefault(), setZoom(prefs.zoom + 10);
  if (ctrl && k === '-') return e.preventDefault(), setZoom(prefs.zoom - 10);
  if (ctrl && k === '0') return e.preventDefault(), setZoom(100);
  if (e.altKey && e.key === 'ArrowLeft') return e.preventDefault(), goBack();
  if (e.altKey && e.key === 'ArrowRight') return e.preventDefault(), goForward();
  if (e.key === 'F5') return e.preventDefault(), reloadFromDisk();
  if (ctrl && (k === 'r' || k === 'g' || k === 'u' || k === 'j')) return e.preventDefault();
  if (e.key === 'Escape') {
    if (!$('#palette').hidden) return closePalette();
    if (!$('#settings').hidden) return closeSettings();
    if (!$('#findbar').hidden) return closeFind();
    if (app.classList.contains('focus')) return toggleFocus();
  }
});

document.addEventListener('mouseup', (e) => {
  if (e.button === 3) goBack();
  if (e.button === 4) goForward();
});

document.addEventListener(
  'wheel',
  (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    setZoom(prefs.zoom + (e.deltaY < 0 ? 10 : -10));
  },
  { passive: false },
);

document.addEventListener('contextmenu', (e) => {
  const editable = e.target.closest('textarea, input');
  if (!editable && !window.getSelection()?.toString()) e.preventDefault();
});

// ───────────────────────── boot ─────────────────────────

async function init() {
  hydrateIcons();
  applyLayout();
  applyTheme();
  initResizer($('#rz-side'), 'sideW', 1, 180, 520);
  initResizer($('#rz-toc'), 'tocW', -1, 160, 440);
  new ResizeObserver(() => fitWide()).observe(scroller);
  try {
    await listen('open-file', (e) => openFile(e.payload));
    listen('file-changed', (e) => {
      if (e.payload !== state.path) return;
      clearTimeout(changeTimer);
      changeTimer = setTimeout(reloadFromDisk, 120);
    });
    getCurrentWebview().onDragDropEvent((e) => {
      const t = e.payload.type;
      app.classList.toggle('dragging', t === 'enter' || t === 'over');
      if (t === 'drop') {
        const p = e.payload.paths.find((x) => MD_RE.test(x) || /\.txt$/i.test(x));
        if (p) openFile(p);
        else toast('Drop a Markdown file to open it');
      }
    });

    const pending = await invoke('take_pending');
    if (pending.length) await openFile(pending[pending.length - 1]);
    else showWelcome();
  } catch (e) {
    console.error(e);
    if (!state.path) showWelcome();
  }
}

init();
