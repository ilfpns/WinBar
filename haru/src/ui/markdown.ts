import { icon, type IconName } from './icons';
/**
 * A small Markdown renderer for the memo pads (no library): headings, **bold**, *italic*, ~~strike~~,
 * `code`, fenced code blocks, > quotes, - / 1. lists, - [ ] checkboxes, [links](https://…), bare URLs and ---.
 * Everything is HTML-escaped first, so a memo can never inject markup. Single line breaks are kept, as in a
 * notepad. Checkboxes carry their source line (`data-line`) so a click can tick the text itself.
 */
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const SAFE_URL = /^(https?:\/\/|mailto:)/i;
const CALLOUT_ICON: Record<string, IconName> = { note: 'lightbulb', tip: 'sparkles', info: 'info', warning: 'triangle-alert' };

/**
 * A photo placed in the text: a line of its own, `![](img:<id>)`, naming an image in the images store.
 * Only the device that holds the image can show it; elsewhere (someone else's shared page) the line is dropped.
 */
export const IMG_LINE = /^!\[[^\]]*\]\(img:([\w-]+)\)\s*$/;
/** The people a text mentions (`@[name](user:uid)`), each once. */
export const mentionsIn = (text: string): string[] => [...new Set([...text.matchAll(/@\[[^\]]+\]\(user:([\w-]+)\)/g)].map((m) => m[1]!))];
export const imageLine = (id: string, width?: number | null) => `![${width ? `|${Math.round(width)}` : ''}](img:${id})`;
/** The width a photo line asks for (Obsidian's `![|320](…)`), or null: as large as it comes, up to the page. */
export const imageWidth = (line: string): number | null => {
  const w = Number(/^!\[(?:[^\]|]*\|)?([0-9]{2,4})\]/.exec(line)?.[1]);
  return w >= 40 ? w : null;
};

function inline(text: string): string {
  // code spans and links first, set aside so the emphasis rules never reach into them
  const kept: string[] = [];
  const keep = (html: string) => `\u0000${kept.push(html) - 1}\u0000`;
  const link = (url: string, label: string) => keep(`<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`);
  const s = esc(text)
    .replace(/@\[([^\]]+)\]\(user:([\w-]+)\)/g, (_, name: string, uid: string) => keep(`<span class="md-mention${uid === 'all' ? ' all' : ''}" data-uid="${uid}">@${name}</span>`))
    .replace(/`([^`]+)`/g, (_, c: string) => keep(`<code>${c}</code>`))
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label: string, url: string) => (SAFE_URL.test(url) ? link(url, label) : m))
    .replace(/(^|[\s(])(https?:\/\/[^\s<)\u0000]+)/g, (_, pre: string, url: string) => pre + link(url, url))
    .replace(/\*\*(.+?)\*\*|__(.+?)__/g, (_, a?: string, b?: string) => `<strong>${a ?? b}</strong>`)
    .replace(/(^|[^*\w])\*(?!\s)(.+?)\*(?!\w)/g, '$1<em>$2</em>')
    .replace(/(^|[^_\w])_(?!\s)(.+?)_(?!\w)/g, '$1<em>$2</em>')
    .replace(/~~(.+?)~~/g, '<del>$1</del>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i: string) => kept[Number(i)]!);
}

export function renderMarkdown(src: string, imageUrl?: (id: string) => string | null): string {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  let para: string[] = [];
  /** The list being read: its items with their depth (two spaces or a tab per level). */
  let items: { tag: 'ul' | 'ol'; level: number; li: string }[] = [];
  let quote: string[] = [];
  /** The callout being read: its kind and lines (a run of `> [!kind]` lines is one box). */
  let callout: { kind: string; lines: string[] } | null = null;

  const flushPara = () => {
    if (para.length) out.push(`<p>${para.map(inline).join('<br>')}</p>`);
    para = [];
  };
  // nested lists: a deeper item opens a list inside the item before it (never more than one level at a time)
  const flushList = () => {
    if (!items.length) return;
    let html = '';
    const open: ('ul' | 'ol')[] = [];
    for (const it of items) {
      const lvl = Math.min(it.level, open.length);
      if (lvl === open.length) {
        html += `<${it.tag}>`;
        open.push(it.tag);
      } else {
        while (open.length > lvl + 1) html += `</li></${open.pop()}>`;
        html += '</li>';
        if (open[lvl] !== it.tag) {
          html += `</${open.pop()}><${it.tag}>`;
          open.push(it.tag);
        }
      }
      html += it.li;
    }
    while (open.length) html += `</li></${open.pop()}>`;
    out.push(html);
    items = [];
  };
  const flushQuote = () => {
    if (quote.length) out.push(`<blockquote>${quote.map(inline).join('<br>')}</blockquote>`);
    quote = [];
    if (callout) {
      const kind = CALLOUT_ICON[callout.kind] ? callout.kind : 'note';
      out.push(`<div class="md-callout" data-kind="${kind}"><span class="md-callout-ic">${icon(CALLOUT_ICON[kind]!).outerHTML}</span><div>${callout.lines.map(inline).join('<br>')}</div></div>`);
    }
    callout = null;
  };
  const flush = () => {
    flushPara();
    flushList();
    flushQuote();
  };

  const cellsOf = (l: string) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
  const isRow = (l: string) => /^\s*\|.*\|\s*$/.test(l);
  const isSep = (l: string) => /^\s*\|(\s*:?-{3,}:?\s*\|)+\s*$/.test(l);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    // a table: a header row, a | --- | separator, then rows
    if (isRow(line) && i + 1 < lines.length && isSep(lines[i + 1]!)) {
      flush();
      const head = cellsOf(line);
      const body: string[][] = [];
      i += 2;
      while (i < lines.length && isRow(lines[i]!)) body.push(cellsOf(lines[i++]!));
      i--;
      out.push(`<table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${
        body.map((r) => `<tr>${head.map((_, k) => `<td>${inline(r[k] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
      continue;
    }
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
    const img = IMG_LINE.exec(line);
    if (img) {
      flush();
      const url = imageUrl?.(img[1]!);
      const w = imageWidth(line);
      if (url) out.push(`<figure class="md-img"><img src="${esc(url)}" alt=""${w ? ` style="width:${w}px"` : ''}></figure>`);
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
    const co = line.match(/^\s*>\s?\[!(\w+)\]\s?(.*)$/);
    if (co) {
      flushPara();
      flushList();
      if (!callout || callout.kind !== co[1]!.toLowerCase()) {
        flushQuote();
        callout = { kind: co[1]!.toLowerCase(), lines: [] };
      }
      callout.lines.push(co[2]!);
      continue;
    }
    if (callout) flushQuote();
    // `| …` is a quote as well (a table row ends with a pipe too)
    const q = line.match(/^\s*>\s?(.*)$/) ?? (/\|\s*$/.test(line) ? null : line.match(/^\s*\|\s(.*)$/));
    if (q) {
      flushPara();
      flushList();
      quote.push(q[1]!);
      continue;
    }
    const li = line.match(/^(\s*)(?:([-*+])|(\d+)[.)])\s+(.*)$/);
    if (li) {
      flushPara();
      flushQuote();
      const tag = li[2] ? 'ul' : 'ol';
      const level = Math.floor(li[1]!.replace(/\t/g, '  ').length / 2);
      const task = li[4]!.match(/^\[([ xX])\]\s+(.*)$/);
      // left open: a deeper item may nest inside it
      items.push({ tag, level, li: task
        ? `<li class="md-task${task[1] !== ' ' ? ' done' : ''}"><input type="checkbox" data-line="${i}"${task[1] !== ' ' ? ' checked' : ''}><span>${inline(task[2]!)}</span>`
        : `<li>${inline(li[4]!)}` });
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
