import { type IconName } from './icons';
import { IMG_LINE, imageWidth } from './markdown';

/** <md-editor>'s drawing: a line of Markdown as HTML that shows its formatting, every character kept. */
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/**
 * An empty item's only text is its hidden mark (font-size 0), so the caret would sit at the mark's end and
 * what is typed would land inside it — out of sight while a Korean syllable is composed. A zero-width space
 * after the mark gives the caret a visible place to type into; it is never part of the text.
 */
export const NL = String.fromCharCode(10);
export const ZW = '​';
export const unZW = (s: string | null) => (s ?? '').replaceAll(ZW, '');
/** Marks drawn as a dot, box or bar (their text hidden): the caret never types into them. */
export const isHiddenMark = (t: Text) => !!t.parentElement?.closest('.mk-ind, .mk-h, .mk-li, .mk-task, .mk-q, .mk-img, .mk-callout');
/** A callout's kind → its icon (Obsidian's `> [!kind]`; an unknown kind reads as a note). */
export const CALLOUT_ICON: Record<string, IconName> = { note: 'lightbulb', tip: 'sparkles', info: 'info', warning: 'triangle-alert' };
const mk = (s: string) => `<span class="mk mk-in">${esc(s)}</span>`;
const SAFE_URL = /^(https?:\/\/|mailto:)/i;

/**
 * Links read like Notion's: the site's logo (a chain when it has none) and a short name — the label of a
 * `[label](url)`, or for a bare URL its page title when known (YouTube and the like) or its address cut short.
 * The URL itself stays in the text; it shows only on the line being edited.
 */
const TITLES_KEY = 'haru:link-titles';
const titles: Record<string, string> = (() => {
  try {
    return JSON.parse(localStorage.getItem(TITLES_KEY) ?? '{}') as Record<string, string>;
  } catch {
    return {};
  }
})();
const asked = new Set<string>();
const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};
/** What a bare URL shows: its title when known, else host and path, cut short. */
function shortLink(url: string): string {
  if (titles[url]) return titles[url]!;
  try {
    const u = new URL(url);
    const path = decodeURIComponent(u.pathname).replace(/\/$/, '');
    const s = hostOf(url) + (path && path !== '/' ? path : '');
    return s.length > 42 ? `${s.slice(0, 40)}…` : s;
  } catch {
    return url;
  }
}
/** Pages that oEmbed (noembed.com, open to any site) can name: videos and the like. */
const NAMED = /(^|\.)(youtube\.com|youtu\.be|vimeo\.com|soundcloud\.com|spotify\.com|twitter\.com|x\.com|tiktok\.com|flickr\.com)$/;
function askTitle(url: string): void {
  if (titles[url] || asked.has(url) || !NAMED.test(hostOf(url))) return;
  asked.add(url);
  void fetch(`https://noembed.com/embed?url=${encodeURIComponent(url)}`)
    .then((r) => r.json() as Promise<{ title?: string }>)
    .then(({ title }) => {
      if (!title) return;
      titles[url] = title.length > 60 ? `${title.slice(0, 58)}…` : title;
      try {
        localStorage.setItem(TITLES_KEY, JSON.stringify(titles));
      } catch { /* storage may be off */ }
      for (const el of document.querySelectorAll<HTMLElement>('md-editor .md-link.bare')) {
        if (el.dataset.href === url) el.dataset.label = titles[url]!;
      }
    })
    .catch(() => {});
}
const attr = (s: string) => esc(s).replace(/"/g, '&quot;');
/** The logo slot at a link's start (filled after drawing; a chain when the site has none). */
const fav = (url: string) => `<span class="md-fav" contenteditable="false" data-host="${attr(hostOf(url))}"></span>`;

/** Inline marks, keeping every character (the marks show only on the line being edited). */
function inline(src: string): string {
  const re = /(@\[[^\]]+\]\(user:[\w-]+\))|(`[^`]+`)|(\*\*[^*]+\*\*)|(~~[^~]+~~)|(\*[^*\s][^*]*\*)|(\[[^\]]+\]\([^)\s]+\))|(https?:\/\/[^\s<>]*[^\s<>.,;:!?)\]'"])/g;
  let out = '';
  let at = 0;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    out += esc(src.slice(at, m.index));
    const t = m[0];
    if (m[1]) {
      // a mention: @name as a chip (its uid stays in the text)
      const [, name, uid] = /^@\[([^\]]+)\]\(user:([\w-]+)\)$/.exec(t)!;
      out += `<span class="md-mention${uid === 'all' ? ' all' : ''}" data-uid="${attr(uid!)}">${mk('@[')}${esc(name!)}${mk(`](user:${uid})`)}</span>`;
    } else if (m[2]) out += `<code>${mk('`')}${esc(t.slice(1, -1))}${mk('`')}</code>`;
    else if (m[3]) out += `<strong>${mk('**')}${esc(t.slice(2, -2))}${mk('**')}</strong>`;
    else if (m[4]) out += `<del>${mk('~~')}${esc(t.slice(2, -2))}${mk('~~')}</del>`;
    else if (m[5]) out += `<em>${mk('*')}${esc(t.slice(1, -1))}${mk('*')}</em>`;
    else if (m[7]) {
      askTitle(t);
      out += `<span class="md-link bare" data-href="${attr(t)}" data-label="${attr(shortLink(t))}" title="Ctrl+click to open">${fav(t)}<span class="mk mk-in">${esc(t)}</span></span>`;
    } else {
      const [, label, url] = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(t)!;
      out += SAFE_URL.test(url!)
        ? `<span class="md-link" data-href="${attr(url!)}" title="Ctrl+click to open">${fav(url!)}${mk('[')}${esc(label!)}${mk(`](${url})`)}</span>`
        : esc(t);
    }
    at = m.index + t.length;
  }
  return out + esc(src.slice(at));
}

/** A drawn line: its classes and HTML, how many leading characters are its block mark (hidden: the
 *  caret never stops inside them) and its indent level. */
interface Drawn { cls: string; html: string; mark: number; indent: number }

/** The block mark a line starts with (indent included): heading, to-do, bullet, number, quote or a divider. */
export function blockOf(src: string): { kind: string; indent: string; marker: string; rest: string; done?: boolean; callout?: string } | null {
  if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(src)) return { kind: 'hr', indent: '', marker: src, rest: '' };
  if (IMG_LINE.test(src)) return { kind: 'img', indent: '', marker: src, rest: '' };
  let m = /^(#{1,6} )(.*)$/.exec(src);
  if (m) return { kind: `h${Math.min(3, m[1]!.length - 1)}`, indent: '', marker: m[1]!, rest: m[2]! };
  m = /^(\s*)([-*] \[([ xX])\] )(.*)$/.exec(src);
  if (m) return { kind: 'task', indent: m[1]!, marker: m[2]!, rest: m[4]!, done: m[3] !== ' ' };
  m = /^(\s*)([-*+] )(.*)$/.exec(src);
  if (m) return { kind: 'li', indent: m[1]!, marker: m[2]!, rest: m[3]! };
  m = /^(\s*)(\d+\. )(.*)$/.exec(src);
  if (m) return { kind: 'ol', indent: m[1]!, marker: m[2]!, rest: m[3]! };
  // a callout (`> [!note] …`), before a plain quote
  m = /^(\s*)(> ?\[!(\w+)\] ?)(.*)$/.exec(src);
  if (m) return { kind: 'callout', indent: m[1]!, marker: m[2]!, rest: m[4]!, callout: m[3]!.toLowerCase() };
  m = /^(\s*)(> ?)(.*)$/.exec(src);
  if (m) return { kind: 'quote', indent: m[1]!, marker: m[2]!, rest: m[3]! };
  // `| ` starts a quote too (a table row, with a pipe at each end, was taken before this)
  m = /^(\s*)(\| )(.*)$/.exec(src);
  if (m) return { kind: 'quote', indent: m[1]!, marker: m[2]!, rest: m[3]! };
  return null;
}

/** A table row: | a | b | (a separator row is | --- | --- |). */
export const isRow = (s: string) => /^\s*\|.*\|\s*$/.test(s);
export const isSep = (s: string) => /^\s*\|(\s*:?-{3,}:?\s*\|)+\s*$/.test(s);
/** Where the cells of a row start and end (offsets of its pipes). */
export const pipesOf = (s: string) => [...s].flatMap((ch, i) => (ch === '|' ? [i] : []));

/** A table row: the pipes take no room, the cells line up as columns. */
function row(src: string, header: boolean): Drawn {
  if (isSep(src)) return { cls: 'md-l tr tsep', html: `<span class="mk mk-sep">${esc(src)}</span>`, mark: src.length, indent: 0 };
  const pipes = pipesOf(src);
  let html = src.slice(0, pipes[0]) ? `<span class="mk mk-ind">${esc(src.slice(0, pipes[0]))}</span>` : '';
  pipes.forEach((at, k) => {
    html += '<span class="mk mk-pipe">|</span>';
    const next = pipes[k + 1];
    if (next !== undefined) html += `<span class="td">${inline(src.slice(at + 1, next)) || ''}</span>`;
  });
  const tail = src.slice(pipes.at(-1)! + 1);
  if (tail) html += `<span class="mk mk-ind">${esc(tail)}</span>`;
  return { cls: `md-l tr${header ? ' th' : ''}`, html, mark: 0, indent: 0 };
}

/** One line drawn; `fence` says whether it sits inside a ``` block, `next` is the line after it. */
export function line(src: string, fence: boolean, next?: string): Drawn {
  if (/^\s*```/.test(src)) return { cls: 'md-l fence', html: `<span class="mk">${esc(src)}</span>`, mark: 0, indent: 0 };
  if (fence) return { cls: 'md-l code', html: esc(src) || '<br>', mark: 0, indent: 0 };
  if (!src) return { cls: 'md-l', html: '<br>', mark: 0, indent: 0 };
  if (isRow(src)) return row(src, next !== undefined && isSep(next) && !isSep(src));
  const b = blockOf(src);
  if (!b) return { cls: 'md-l', html: inline(src), mark: 0, indent: 0 };
  const indent = Math.floor(b.indent.replace(/\t/g, '  ').length / 2);
  const ind = b.indent ? `<span class="mk mk-ind">${esc(b.indent)}</span>` : '';
  if (b.kind === 'hr') return { cls: 'md-l hr', html: `<span class="mk mk-hr">${esc(src)}</span>`, mark: src.length, indent: 0 };
  // a photo: its line hidden, the picture drawn in its place (filled in from the editor's imageUrl)
  if (b.kind === 'img') {
    const w = imageWidth(src);
    const html = `<span class="mk mk-img">${esc(src)}</span><span class="md-img${w ? ' sized' : ''}" contenteditable="false" data-ref="${IMG_LINE.exec(src)![1]}"><img alt="" draggable="false"${w ? ` style="width:${w}px"` : ''}><span class="md-img-grip" aria-hidden="true" title="Drag to resize · double-click for the original size"></span><span class="md-img-bar"><button type="button" class="md-img-btn" data-act="copy" aria-label="Copy photo" title="Copy"></button><button type="button" class="md-img-btn" data-act="remove" aria-label="Remove photo" title="Remove"></button></span></span>`;
    return { cls: 'md-l img', html, mark: src.length, indent: 0 };
  }
  // a numbered item keeps its number visible; the other marks are drawn (a dot, a box, a bar) instead
  const markCls = b.kind === 'ol' ? 'mk mk-ol' : b.kind === 'task' ? 'mk mk-task' : b.kind === 'li' ? 'mk mk-li' : b.kind === 'quote' ? 'mk mk-q' : b.kind === 'callout' ? 'mk mk-callout' : 'mk mk-h';
  // a callout carries its icon (filled in after drawing)
  const calloutIc = b.kind === 'callout' ? `<span class="md-callout-ic" contenteditable="false" data-kind="${CALLOUT_ICON[b.callout!] ? b.callout : 'note'}"></span>` : '';
  return {
    cls: `md-l ${b.kind}${b.done ? ' done' : ''}`,
    html: `${ind}<span class="${markCls}">${esc(b.marker)}</span>${calloutIc}${inline(b.rest) || ''}`,
    mark: b.indent.length + b.marker.length,
    indent,
  };
}
