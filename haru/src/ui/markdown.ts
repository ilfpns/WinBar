/**
 * A small Markdown renderer for the memo pads (no library): headings, **bold**, *italic*, ~~strike~~,
 * `code`, fenced code blocks, > quotes, - / 1. lists, - [ ] checkboxes, [links](https://…), bare URLs and ---.
 * Everything is HTML-escaped first, so a memo can never inject markup. Single line breaks are kept, as in a
 * notepad. Checkboxes carry their source line (`data-line`) so a click can tick the text itself.
 */
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const SAFE_URL = /^(https?:\/\/|mailto:)/i;

function inline(text: string): string {
  // code spans and links first, set aside so the emphasis rules never reach into them
  const kept: string[] = [];
  const keep = (html: string) => `\u0000${kept.push(html) - 1}\u0000`;
  const link = (url: string, label: string) => keep(`<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`);
  const s = esc(text)
    .replace(/`([^`]+)`/g, (_, c: string) => keep(`<code>${c}</code>`))
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label: string, url: string) => (SAFE_URL.test(url) ? link(url, label) : m))
    .replace(/(^|[\s(])(https?:\/\/[^\s<)\u0000]+)/g, (_, pre: string, url: string) => pre + link(url, url))
    .replace(/\*\*(.+?)\*\*|__(.+?)__/g, (_, a?: string, b?: string) => `<strong>${a ?? b}</strong>`)
    .replace(/(^|[^*\w])\*(?!\s)(.+?)\*(?!\w)/g, '$1<em>$2</em>')
    .replace(/(^|[^_\w])_(?!\s)(.+?)_(?!\w)/g, '$1<em>$2</em>')
    .replace(/~~(.+?)~~/g, '<del>$1</del>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i: string) => kept[Number(i)]!);
}

export function renderMarkdown(src: string): string {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  let para: string[] = [];
  let list: { tag: 'ul' | 'ol'; items: string[] } | null = null;
  let quote: string[] = [];

  const flushPara = () => {
    if (para.length) out.push(`<p>${para.map(inline).join('<br>')}</p>`);
    para = [];
  };
  const flushList = () => {
    if (list) out.push(`<${list.tag}>${list.items.join('')}</${list.tag}>`);
    list = null;
  };
  const flushQuote = () => {
    if (quote.length) out.push(`<blockquote>${quote.map(inline).join('<br>')}</blockquote>`);
    quote = [];
  };
  const flush = () => {
    flushPara();
    flushList();
    flushQuote();
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    // fenced code
    if (/^\s*```/.test(line)) {
      flush();
      const body: string[] = [];
      while (++i < lines.length && !/^\s*```/.test(lines[i]!)) body.push(lines[i]!);
      out.push(`<pre><code>${esc(body.join('\n'))}</code></pre>`);
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      flush();
      out.push(`<h${h[1]!.length}>${inline(h[2]!)}</h${h[1]!.length}>`);
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flush();
      out.push('<hr>');
      continue;
    }
    const q = line.match(/^\s*>\s?(.*)$/);
    if (q) {
      flushPara();
      flushList();
      quote.push(q[1]!);
      continue;
    }
    const li = line.match(/^\s*(?:([-*+])|(\d+)[.)])\s+(.*)$/);
    if (li) {
      flushPara();
      flushQuote();
      const tag = li[1] ? 'ul' : 'ol';
      if (!list || list.tag !== tag) {
        flushList();
        list = { tag, items: [] };
      }
      const task = li[3]!.match(/^\[([ xX])\]\s+(.*)$/);
      list.items.push(task
        ? `<li class="md-task${task[1] !== ' ' ? ' done' : ''}"><input type="checkbox" data-line="${i}"${task[1] !== ' ' ? ' checked' : ''}><span>${inline(task[2]!)}</span></li>`
        : `<li>${inline(li[3]!)}</li>`);
      continue;
    }
    flushList();
    flushQuote();
    para.push(line);
  }
  flush();
  return out.join('');
}

/** Ticks or unticks the `- [ ]` checkbox on source line `n`. */
export function toggleTask(src: string, n: number): string {
  const lines = src.split('\n');
  const line = lines[n];
  if (line === undefined) return src;
  lines[n] = line.replace(/\[([ xX])\]/, (_, c: string) => (c === ' ' ? '[x]' : '[ ]'));
  return lines.join('\n');
}
