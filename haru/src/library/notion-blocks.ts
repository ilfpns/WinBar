/**
 * Notion pages as Markdown and back. A page's top-level blocks become units of Markdown (one per block, its nested
 * items indented under it); an edited page is split into units the same way and lined up against the old ones, so
 * only what changed is sent: a changed block is updated in place, a removed one deleted, a new one inserted after
 * the block before it. Blocks that hold more than text — sub-pages, databases, columns, tables, synced blocks — are
 * never deleted or rewritten from the text (a sub-page goes with Delete on itself). Images stand as
 * `![caption](notion-image:<id>)`, an address that stays the same between reads (Notion's own file links expire).
 * Pure functions: notion.ts makes the calls.
 */
export interface RichText { plain_text: string; href?: string | null; annotations?: { bold?: boolean; italic?: boolean; code?: boolean; strikethrough?: boolean } }
export interface Block { id: string; type: string; has_children: boolean; [k: string]: unknown }

export const IMAGE_SCHEME = 'notion-image:';

/** Notion rich text → Markdown inline. */
export function richToMd(rich: RichText[] = []): string {
  return rich.map((t) => {
    let s = t.plain_text;
    if (!s.trim()) return s;
    const a = t.annotations ?? {};
    if (a.code) s = `\`${s}\``;
    if (a.bold) s = `**${s}**`;
    if (a.italic) s = `*${s}*`;
    if (a.strikethrough) s = `~~${s}~~`;
    if (t.href && /^https?:/.test(t.href)) s = `[${s}](${t.href})`;
    return s;
  }).join('');
}

interface RichReq { type: 'text'; text: { content: string; link?: { url: string } }; annotations?: { bold?: boolean; italic?: boolean; code?: boolean; strikethrough?: boolean } }

/** Markdown inline → Notion rich text: **bold**, *italic*, `code`, ~~strike~~, [label](https://…). */
export function mdToRich(md: string): RichReq[] {
  const out: RichReq[] = [];
  const re = /(\*\*([^*]+)\*\*)|(\*([^*]+)\*)|(`([^`]+)`)|(~~([^~]+)~~)|(\[([^\]]+)\]\((https?:\/\/[^)\s]+)\))/g;
  let last = 0;
  const push = (content: string, annotations?: RichReq['annotations'], url?: string) => {
    // Notion takes at most 2000 characters a piece
    for (let i = 0; i < content.length; i += 2000) {
      out.push({ type: 'text', text: { content: content.slice(i, i + 2000), ...(url ? { link: { url } } : {}) }, ...(annotations ? { annotations } : {}) });
    }
  };
  for (const m of md.matchAll(re)) {
    if (m.index! > last) push(md.slice(last, m.index));
    if (m[2] !== undefined) push(m[2], { bold: true });
    else if (m[4] !== undefined) push(m[4], { italic: true });
    else if (m[6] !== undefined) push(m[6], { code: true });
    else if (m[8] !== undefined) push(m[8], { strikethrough: true });
    else if (m[10] !== undefined) push(m[10], undefined, m[11]);
    last = m.index! + m[0].length;
  }
  if (last < md.length) push(md.slice(last));
  return out;
}

type V = { rich_text?: RichText[]; checked?: boolean; language?: string; title?: string; url?: string; caption?: RichText[] };
const NESTS = new Set(['bulleted_list_item', 'numbered_list_item', 'to_do', 'toggle']);
/** Updated in place when their text changes. */
export const TEXT_TYPES = new Set(['paragraph', 'heading_1', 'heading_2', 'heading_3', 'bulleted_list_item', 'numbered_list_item', 'to_do', 'quote', 'callout', 'code', 'toggle']);
/** Never deleted from the text: they hold pages, data or layout. */
export const KEEP_TYPES = new Set(['child_page', 'child_database', 'column_list', 'column', 'table', 'synced_block', 'template', 'unsupported', 'link_to_page']);

/** One block (and, through `kids`, its nested items) as Markdown lines. */
export function blockLines(b: Block, depth: number, n: number, kids: string[]): string[] {
  const v = (b[b.type] ?? {}) as V;
  const t = richToMd(v.rich_text);
  const pad = '  '.repeat(depth);
  const own = ((): string[] => {
    switch (b.type) {
      case 'heading_1': return [`# ${t}`];
      case 'heading_2': return [`## ${t}`];
      case 'heading_3': return [`### ${t}`];
      case 'bulleted_list_item': case 'toggle': return [`${pad}- ${t}`];
      case 'numbered_list_item': return [`${pad}${n}. ${t}`];
      case 'to_do': return [`${pad}- [${v.checked ? 'x' : ' '}] ${t}`];
      case 'quote': return [`> ${t}`];
      case 'callout': return [`> [!note] ${t}`];
      case 'code': return [`\`\`\`${v.language ?? ''}`, ...richToMd(v.rich_text).split('\n'), '```'];
      case 'divider': return ['---'];
      case 'child_page': return [`- ${v.title ?? 'Untitled'}`];
      case 'child_database': return [`- ${v.title ?? 'Database'}`];
      case 'bookmark': case 'embed': case 'link_preview': return v.url ? [v.url] : [];
      case 'image': return [`![${richToMd(v.caption)}](${IMAGE_SCHEME}${b.id})`];
      case 'paragraph': return [`${pad}${t}`];
      default: return t ? [`${pad}${t}`] : [];
    }
  })();
  // a paragraph's line breaks would read as new paragraphs: they stay on one line
  const flat = b.type === 'code' ? own : own.map((l) => l.replace(/\n/g, ' '));
  return [...flat, ...kids];
}
export const nests = (b: Block): boolean => NESTS.has(b.type);

/** Markdown split into units: a line that isn't indented starts one, indented lines join it, a code fence is one. */
export function units(text: string): string[] {
  const out: string[][] = [];
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    if (!l.trim()) continue;
    if (/^```/.test(l)) {
      const block = [l];
      while (++i < lines.length && !/^```\s*$/.test(lines[i]!)) block.push(lines[i]!);
      block.push('```');
      out.push(block);
      continue;
    }
    if (/^\s/.test(l) && out.length) out.at(-1)!.push(l);
    else out.push([l]);
  }
  return out.map((u) => u.join('\n'));
}

/** What a unit is compared by: numbered items by their text, not their number (renumbering is no change). */
export const unitKey = (u: string): string => u.replace(/^(\s*)\d+\.\s/gm, '$11. ').trimEnd();

/** Lines up two lists of units: each new unit kept from the old, or inserted; each old one kept or deleted. */
export type Op = { op: 'keep'; i: number; j: number } | { op: 'del'; i: number } | { op: 'ins'; j: number };
export function diffUnits(a: string[], b: string[]): Op[] {
  const A = a.map(unitKey);
  const B = b.map(unitKey);
  // common start and end first (most edits touch a few lines), the longest common run for the rest
  let s = 0;
  while (s < A.length && s < B.length && A[s] === B[s]) s++;
  let e = 0;
  while (e < A.length - s && e < B.length - s && A[A.length - 1 - e] === B[B.length - 1 - e]) e++;
  const a2 = A.slice(s, A.length - e);
  const b2 = B.slice(s, B.length - e);
  const n = a2.length;
  const m = b2.length;
  const ops: Op[] = [];
  for (let k = 0; k < s; k++) ops.push({ op: 'keep', i: k, j: k });
  if (n * m > 4_000_000) {
    // too many to line up: the middle is replaced as a whole
    for (let i = 0; i < n; i++) ops.push({ op: 'del', i: s + i });
    for (let j = 0; j < m; j++) ops.push({ op: 'ins', j: s + j });
  } else {
    const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i]![j] = a2[i] === b2[j] ? L[i + 1]![j + 1]! + 1 : Math.max(L[i + 1]![j]!, L[i]![j + 1]!);
    let i = 0;
    let j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && a2[i] === b2[j]) ops.push({ op: 'keep', i: s + i++, j: s + j++ });
      else if (j < m && (i >= n || L[i]![j + 1]! >= L[i + 1]![j]!)) ops.push({ op: 'ins', j: s + j++ });
      else ops.push({ op: 'del', i: s + i++ });
    }
  }
  for (let k = 0; k < e; k++) ops.push({ op: 'keep', i: A.length - e + k, j: B.length - e + k });
  return ops;
}

interface BlockReq { object: 'block'; type: string; [k: string]: unknown }

/** A unit's own line (without its nested lines) as the block type and the body Notion takes for it. */
export function lineToBlock(line: string): { type: string; body: Record<string, unknown> } {
  const l = line.trim();
  const rt = (s: string) => ({ rich_text: mdToRich(s) });
  let m: RegExpMatchArray | null;
  if ((m = l.match(/^###\s+(.*)$/))) return { type: 'heading_3', body: rt(m[1]!) };
  if ((m = l.match(/^##\s+(.*)$/))) return { type: 'heading_2', body: rt(m[1]!) };
  if ((m = l.match(/^#\s+(.*)$/))) return { type: 'heading_1', body: rt(m[1]!) };
  if ((m = l.match(/^[-*+]\s+\[([ xX])\]\s+(.*)$/))) return { type: 'to_do', body: { ...rt(m[2]!), checked: m[1] !== ' ' } };
  if ((m = l.match(/^[-*+]\s+(.*)$/))) return { type: 'bulleted_list_item', body: rt(m[1]!) };
  if ((m = l.match(/^\d+[.)]\s+(.*)$/))) return { type: 'numbered_list_item', body: rt(m[1]!) };
  if ((m = l.match(/^>\s?\[!\w+\]\s?(.*)$/))) return { type: 'callout', body: rt(m[1]!) };
  if ((m = l.match(/^>\s?(.*)$/))) return { type: 'quote', body: rt(m[1]!) };
  if (/^([-*_])(\s*\1){2,}$/.test(l)) return { type: 'divider', body: {} };
  if ((m = l.match(/^!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)$/))) return { type: 'image', body: { type: 'external', external: { url: m[2]! }, caption: mdToRich(m[1]!) } };
  return { type: 'paragraph', body: rt(l) };
}

/** A whole unit as a new block (a code fence, or a line with its nested items as children). */
export function unitToBlock(unit: string): BlockReq {
  const lines = unit.split('\n');
  const fence = lines[0]!.match(/^```(\w*)/);
  if (fence) {
    // code is taken as it is: no inline marks
    const content = lines.slice(1, -1).join('\n');
    const rich: RichReq[] = [];
    for (let i = 0; i < content.length || i === 0; i += 2000) rich.push({ type: 'text', text: { content: content.slice(i, i + 2000) } });
    return { object: 'block', type: 'code', code: { rich_text: rich, language: fence[1] || 'plain text' } };
  }
  const { type, body } = lineToBlock(lines[0]!);
  const kids = units(lines.slice(1).map((l) => l.replace(/^ {2}|^\t/, '')).join('\n'));
  const children = kids.length && NESTS.has(type) ? kids.map(unitToBlock) : undefined;
  return { object: 'block', type, [type]: { ...body, ...(children ? { children } : {}) } };
}
