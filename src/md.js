import MarkdownIt from 'markdown-it';
import footnote from 'markdown-it-footnote';
import texmath from 'markdown-it-texmath';
import katex from 'katex';
import hljs from 'highlight.js/lib/common';
import powershell from 'highlight.js/lib/languages/powershell';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import nginx from 'highlight.js/lib/languages/nginx';
import DOMPurify from 'dompurify';
import 'katex/dist/katex.min.css';

hljs.registerLanguage('powershell', powershell);
hljs.registerLanguage('dockerfile', dockerfile);
hljs.registerLanguage('nginx', nginx);

const md = new MarkdownIt({ html: true, linkify: true, typographer: true });
md.use(footnote);
md.use(texmath, { engine: katex, delimiters: 'dollars', katexOptions: { throwOnError: false } });

const esc = (s) => md.utils.escapeHtml(s);

export function slugify(text) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-');
}

// Tags top-level blocks with their source line range (data-src="start:end")
// so a rendered block can be mapped back to the Markdown it came from.
// Also assigns heading ids, collects the outline and turns "[ ]" list items
// into real checkboxes that know which source line they toggle.
md.core.ruler.push('noumark', (st) => {
  const tokens = st.tokens;
  const seen = new Set();
  const toc = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.level === 0 && t.map && t.nesting !== -1) t.attrSet('data-src', `${t.map[0]}:${t.map[1]}`);

    if (t.type === 'heading_open') {
      const text = tokens[i + 1].children
        .filter((c) => c.type === 'text' || c.type === 'code_inline')
        .map((c) => c.content)
        .join('');
      const base = slugify(text) || 'section';
      let slug = base;
      for (let n = 1; seen.has(slug); n++) slug = `${base}-${n}`;
      seen.add(slug);
      t.attrSet('id', slug);
      toc.push({ level: Number(t.tag.slice(1)), text, id: slug });
    }

    if (t.type === 'inline' && tokens[i - 1]?.type === 'paragraph_open' && tokens[i - 2]?.type === 'list_item_open') {
      const m = t.content.match(/^\[([ xX])\](?:[ \t]|$)/);
      const first = t.children[0];
      if (m && first?.type === 'text' && first.content.startsWith(m[0].trimEnd())) {
        const li = tokens[i - 2];
        const checked = m[1] !== ' ';
        first.content = first.content.slice(m[0].length);
        const cb = new st.Token('html_inline', '', 0);
        cb.content = `<input type="checkbox" class="task" data-line="${li.map[0]}"${checked ? ' checked' : ''}>`;
        t.children.unshift(cb);
        li.attrJoin('class', checked ? 'task-item done' : 'task-item');
      }
    }
  }
  st.env.toc = toc;
});

md.renderer.rules.fence = (tokens, idx) => {
  const t = tokens[idx];
  const lang = (t.info || '').trim().split(/\s+/)[0].toLowerCase();
  const src = t.attrGet('data-src');
  const srcAttr = src ? ` data-src="${src}"` : '';
  if (lang === 'mermaid') {
    return `<div class="mermaid"${srcAttr}><pre class="mermaid-code">${esc(t.content)}</pre></div>\n`;
  }
  const body = lang && hljs.getLanguage(lang)
    ? hljs.highlight(t.content, { language: lang, ignoreIllegals: true }).value
    : esc(t.content);
  return (
    `<div class="code-block"${srcAttr}>` +
    `<div class="code-head"><span class="code-lang">${esc(lang || 'text')}</span>` +
    `<button class="code-copy" type="button">Copy</button></div>` +
    `<pre><code class="hljs">${body}</code></pre></div>\n`
  );
};

const FRONT_MATTER = /^---\n([\s\S]*?)\n(?:---|\.\.\.)\n/;

function renderFrontMatter(yaml, lineCount) {
  const rows = yaml
    .split('\n')
    .map((l) => l.match(/^([\w.-]+)\s*:\s*(.*)$/))
    .filter(Boolean)
    .map(([, k, v]) => `<div class="fm-row"><span class="fm-key">${esc(k)}</span><span class="fm-val">${esc(v.replace(/^["']|["']$/g, ''))}</span></div>`)
    .join('');
  return rows ? `<div class="frontmatter" data-src="0:${lineCount}">${rows}</div>` : '';
}

export function render(source) {
  let text = source;
  let head = '';
  const fm = text.match(FRONT_MATTER);
  if (fm) {
    const lineCount = fm[0].split('\n').length - 1;
    head = renderFrontMatter(fm[1], lineCount);
    // Blank the front matter instead of removing it so line numbers stay aligned.
    text = '\n'.repeat(lineCount) + text.slice(fm[0].length);
  }
  const env = {};
  const html = head + md.render(text, env);
  const clean = DOMPurify.sanitize(html, { ADD_ATTR: ['target'], FORBID_TAGS: ['style'] });
  const words = (source.replace(/```[\s\S]*?```/g, '').match(/\S+/g) || []).length;
  return { html: clean, toc: env.toc || [], words };
}
