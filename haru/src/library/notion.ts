import { type Driver, type Item, type SourceConf, tokenOf } from './sources';

/**
 * A Notion workspace, through an internal integration (notion.so/profile/integrations): its secret stays in this
 * browser, and the integration sees only the pages shared with it (a page's ••• → Connections). Every such page
 * and database is listed once with search; pages under a page or a database are put under it, so the workspace
 * keeps its shape. A page with pages under it is a folder whose first note is the page itself. Read only: a page's
 * blocks are turned into Markdown to be shown.
 */
const API = 'https://api.notion.com/v1';
const VERSION = '2022-06-28';
/** Search pages are 100 results; this many at most (a very large workspace shows its most recent). */
const MAX_PAGES = 20;

interface RichText { plain_text: string; href?: string | null; annotations?: { bold?: boolean; italic?: boolean; code?: boolean; strikethrough?: boolean } }
interface Parent { type: 'page_id' | 'database_id' | 'workspace' | 'block_id'; page_id?: string; database_id?: string }
interface PageObj { object: 'page' | 'database'; id: string; url: string; last_edited_time: string; parent: Parent; archived?: boolean; in_trash?: boolean; title?: RichText[]; properties?: Record<string, { type: string; title?: RichText[] }> }
interface Block { id: string; type: string; has_children: boolean; [k: string]: unknown }

export class NotionError extends Error {}

const SELF = '#page';

export function notionDriver(conf: SourceConf): Driver {
  async function call<T>(path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${API}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${tokenOf(conf.id)}`, 'Notion-Version': VERSION, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      throw new NotionError(res.status === 401 ? 'The integration secret was refused'
        : res.status === 404 ? 'Not shared with the integration'
        : res.status === 429 ? 'Notion asked to slow down — try again in a moment'
        : `Notion said ${res.status}`);
    }
    return res.json() as Promise<T>;
  }

  const titleOf = (p: PageObj): string => {
    const rich = p.object === 'database' ? p.title : Object.values(p.properties ?? {}).find((v) => v.type === 'title')?.title;
    return (rich ?? []).map((t) => t.plain_text).join('').trim() || 'Untitled';
  };
  const parentOf = (p: PageObj): string | null => p.parent.page_id ?? p.parent.database_id ?? null;

  const text = (rich: RichText[] = []): string => rich.map((t) => {
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

  async function children(id: string): Promise<Block[]> {
    const out: Block[] = [];
    let cursor: string | undefined;
    do {
      const r = await call<{ results: Block[]; next_cursor: string | null }>(`/blocks/${id}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`);
      out.push(...r.results);
      cursor = r.next_cursor ?? undefined;
    } while (cursor && out.length < 1000);
    return out;
  }

  /** Blocks as Markdown; lists and toggles nest up to three levels. */
  async function markdown(blocks: Block[], depth = 0): Promise<string> {
    const lines: string[] = [];
    const pad = '  '.repeat(depth);
    let n = 0;
    for (const b of blocks) {
      const v = (b[b.type] ?? {}) as { rich_text?: RichText[]; checked?: boolean; language?: string; title?: string; url?: string; caption?: RichText[]; external?: { url: string }; file?: { url: string } };
      const t = text(v.rich_text);
      n = b.type === 'numbered_list_item' ? n + 1 : 0;
      switch (b.type) {
        case 'heading_1': lines.push(`# ${t}`); break;
        case 'heading_2': lines.push(`## ${t}`); break;
        case 'heading_3': lines.push(`### ${t}`); break;
        case 'bulleted_list_item': case 'toggle': lines.push(`${pad}- ${t}`); break;
        case 'numbered_list_item': lines.push(`${pad}${n}. ${t}`); break;
        case 'to_do': lines.push(`${pad}- [${v.checked ? 'x' : ' '}] ${t}`); break;
        case 'quote': lines.push(`> ${t}`); break;
        case 'callout': lines.push(`> [!note] ${t}`); break;
        case 'code': lines.push(`\`\`\`${v.language ?? ''}`, ...text(v.rich_text).split('\n'), '```'); break;
        case 'divider': lines.push('---'); break;
        case 'child_page': lines.push(`- ${v.title ?? 'Untitled'}`); break;
        case 'child_database': lines.push(`- ${v.title ?? 'Database'}`); break;
        case 'bookmark': case 'embed': case 'link_preview': if (v.url) lines.push(v.url); break;
        case 'image': { const url = v.external?.url ?? v.file?.url; if (url) lines.push(`[Image${v.caption?.length ? `: ${text(v.caption)}` : ''}](${url})`); break; }
        case 'paragraph': lines.push(depth ? `${pad}${t}` : t); break;
        default: if (t) lines.push(t);
      }
      const nests = ['bulleted_list_item', 'numbered_list_item', 'to_do', 'toggle'].includes(b.type);
      if (b.has_children && nests && depth < 3) lines.push(await markdown(await children(b.id), depth + 1));
      // a paragraph block ends its paragraph; list items run on
      if (!nests && depth === 0) lines.push('');
    }
    return lines.join('\n');
  }

  return {
    async load() {
      const found: PageObj[] = [];
      let cursor: string | undefined;
      for (let k = 0; k < MAX_PAGES; k++) {
        const r = await call<{ results: PageObj[]; next_cursor: string | null; has_more: boolean }>('/search', {
          page_size: 100, sort: { direction: 'descending', timestamp: 'last_edited_time' }, ...(cursor ? { start_cursor: cursor } : {}),
        });
        found.push(...r.results.filter((p) => !p.archived && !p.in_trash));
        if (!r.has_more || !r.next_cursor) break;
        cursor = r.next_cursor;
      }
      const ids = new Set(found.map((p) => p.id));
      const hasKids = new Set(found.map(parentOf).filter((x): x is string => !!x && ids.has(x)));
      const names = new Map(found.map((p) => [p.id, titleOf(p)]));
      const byId = new Map(found.map((p) => [p.id, p]));
      const pathOf = (p: PageObj): string => {
        const parts: string[] = [];
        let at: string | null = p.id;
        for (let guard = 0; at && guard < 12; guard++) {
          parts.unshift(names.get(at) ?? '');
          const pp = byId.get(at);
          at = pp ? parentOf(pp) : null;
          if (at && !ids.has(at)) at = null;
        }
        return parts.join('/');
      };
      const out: Item[] = [];
      for (const p of found) {
        const parent = parentOf(p);
        const item = { name: titleOf(p), parent: parent && ids.has(parent) ? parent : null, path: pathOf(p), modified: Date.parse(p.last_edited_time) || undefined, url: p.url };
        if (p.object === 'database' || hasKids.has(p.id)) {
          out.push({ ...item, id: p.id, kind: 'folder' });
          if (p.object === 'page') out.push({ ...item, id: p.id + SELF, kind: 'note', parent: p.id });
        } else out.push({ ...item, id: p.id, kind: 'note' });
      }
      return out;
    },
    async read(item) {
      return markdown(await children(item.id.replace(SELF, '')));
    },
  };
}
