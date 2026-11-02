import { type Block, IMAGE_SCHEME, KEEP_TYPES, type RichText, TEXT_TYPES, blockLines, diffUnits, lineToBlock, nests, richToMd, unitToBlock, units } from './notion-blocks';
import { type Driver, type Item, type SourceConf, tokenOf } from './sources';

/**
 * A Notion workspace, through an internal integration (notion.so/profile/integrations): its secret stays in this
 * browser, and the integration sees only the pages shared with it (a page's ••• → Connections). Every such page
 * and database is listed once with search; pages under a page or a database are put under it, so the workspace
 * keeps its shape. A page with pages under it is a folder whose first note is the page itself. A page reads as
 * Markdown and saves back as blocks — only the ones changed (notion-blocks.ts). Pages are made and deleted (to
 * Notion's trash), pictures uploaded and deleted, from Haru.
 */
const API = 'https://api.notion.com/v1';
const VERSION = '2022-06-28';
/** Search pages are 100 results; this many at most (a very large workspace shows its most recent). */
const MAX_PAGES = 20;

interface Parent { type: 'page_id' | 'database_id' | 'workspace' | 'block_id'; page_id?: string; database_id?: string; block_id?: string }
interface PageObj { object: 'page' | 'database'; id: string; url: string; last_edited_time: string; parent: Parent; archived?: boolean; in_trash?: boolean; title?: RichText[]; properties?: Record<string, { type: string; title?: RichText[] }> }

export class NotionError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

const SELF = '#page';

export function notionDriver(conf: SourceConf): Driver {
  async function call<T>(path: string, body?: unknown, method?: 'PATCH' | 'DELETE' | 'POST'): Promise<T> {
    const res = await fetch(`${API}${path}`, {
      method: method ?? (body ? 'POST' : 'GET'),
      headers: { Authorization: `Bearer ${tokenOf(conf.id)}`, 'Notion-Version': VERSION, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      throw new NotionError(res.status === 401 ? 'The integration secret was refused'
        : res.status === 404 ? 'Not shared with the integration'
        : res.status === 429 ? 'Notion asked to slow down — try again in a moment'
        : `Notion said ${res.status}`, res.status);
    }
    return res.json() as Promise<T>;
  }

  const titleOf = (p: PageObj): string => {
    const rich = p.object === 'database' ? p.title : Object.values(p.properties ?? {}).find((v) => v.type === 'title')?.title;
    return (rich ?? []).map((t) => t.plain_text).join('').trim() || 'Untitled';
  };
  /**
   * A page put inside a block (a toggle, a column, a callout) names that block as its parent, not the page: the
   * blocks are followed up (a few levels, each asked once) to the page or database they sit in, so the page stays
   * under it instead of coming up to the top.
   */
  const viaBlock = new Map<string, string | null>();
  async function pageOfBlock(id: string): Promise<string | null> {
    if (viaBlock.has(id)) return viaBlock.get(id)!;
    let at: string | null = id;
    let found: string | null = null;
    for (let guard = 0; at && guard < 6; guard++) {
      const b: { parent?: Parent } | null = await call<{ parent?: Parent }>(`/blocks/${at}`).catch(() => null);
      const par: Parent | undefined = b?.parent;
      if (!par) break;
      if (par.page_id || par.database_id) {
        found = par.page_id ?? par.database_id ?? null;
        break;
      }
      at = par.block_id ?? null;
    }
    viaBlock.set(id, found);
    return found;
  }
  const parentOf = (p: PageObj): string | null => p.parent.page_id ?? p.parent.database_id ?? (p.parent.block_id ? viaBlock.get(p.parent.block_id) ?? null : null);

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

  /**
   * What a block holds, as lines: list items, toggles and paragraphs nest theirs (indented, three levels at most);
   * blocks that only hold others — columns, synced blocks, toggle headings, callouts, quotes — show their content at
   * their own level (it then reads as more than one unit, so the text never rewrites them; see writePage).
   */
  const CONTAINERS = new Set(['column_list', 'column', 'synced_block', 'heading_1', 'heading_2', 'heading_3', 'callout', 'quote', 'table_of_contents']);
  async function nestedLines(parent: Block, depth: number, hops = 0): Promise<string[]> {
    if (!parent.has_children || hops > 6) return [];
    if (parent.type === 'table') {
      // a table as a Markdown table: its first row is the header (Notion's own header, or the first row anyway)
      const rows = (await children(parent.id)).map((r) => ((r.table_row as { cells?: RichText[][] } | undefined)?.cells ?? []).map((c) => richToMd(c).replace(/\|/g, '\\|').replace(/\n/g, ' ')));
      if (!rows.length) return [];
      const width = Math.max(...rows.map((r) => r.length));
      const line = (r: string[]) => `| ${Array.from({ length: width }, (_, k) => r[k] ?? '').join(' | ')} |`;
      return [line(rows[0]!), `| ${Array.from({ length: width }, () => '---').join(' | ')} |`, ...rows.slice(1).map(line)];
    }
    const indent = nests(parent) || parent.type === 'paragraph';
    if (!indent && !CONTAINERS.has(parent.type)) return [];
    if (indent && depth > 3) return [];
    const at = indent ? depth : depth - 1;
    const out: string[] = [];
    let n = 0;
    for (const b of await children(parent.id)) {
      n = b.type === 'numbered_list_item' ? n + 1 : 0;
      out.push(...blockLines(b, at, n, await nestedLines(b, at + 1, hops + 1)));
    }
    return out;
  }

  /** What a page held when it was last read: its top-level blocks and the Markdown units they made. */
  interface Seg { id: string; type: string; units: number; first: string }
  const pages = new Map<string, { segs: Seg[]; units: string[]; owner: number[] }>();
  /** Pictures' current addresses (they expire), by block. */
  const images = new Map<string, string>();
  const pageId = (item: Item) => item.id.replace(SELF, '');
  const listy = (u: string) => /^(\s*)([-*+]|\d+\.)\s/.test(u);

  async function readPage(pid: string): Promise<string> {
    const segs: Seg[] = [];
    const all: string[] = [];
    const owner: number[] = [];
    let n = 0;
    for (const b of await children(pid)) {
      n = b.type === 'numbered_list_item' ? n + 1 : 0;
      if (b.type === 'image') {
        const v = b.image as { external?: { url: string }; file?: { url: string } } | undefined;
        const url = v?.external?.url ?? v?.file?.url;
        if (url) images.set(b.id, url);
      }
      const us = units(blockLines(b, 0, n, await nestedLines(b, 1)).join('\n'));
      segs.push({ id: b.id, type: b.type, units: us.length, first: us[0] ?? '' });
      for (const u of us) {
        all.push(u);
        owner.push(segs.length - 1);
      }
    }
    pages.set(pid, { segs, units: all, owner });
    // list items sit line under line; everything else a paragraph apart
    const row = (u: string) => /^\|/.test(u);
    return all.map((u, k) => (k && ((listy(u) && listy(all[k - 1]!)) || (row(u) && row(all[k - 1]!))) ? '\n' : k ? '\n\n' : '') + u).join('');
  }

  /** Saves `text` over the page: only the units that changed become calls. */
  async function writePage(pid: string, text: string): Promise<string> {
    if (!pages.has(pid)) await readPage(pid);
    const st = pages.get(pid)!;
    const next = units(text);
    const ops = diffUnits(st.units, next);
    let prev: string | null = null;
    let kept = 0;
    let atTop = false;
    const queue: ReturnType<typeof unitToBlock>[] = [];
    const flush = async () => {
      while (queue.length) {
        const batch = queue.splice(0, 100);
        if (!prev && st.segs.length) atTop = true;
        const r = await call<{ results: { id: string }[] }>(`/blocks/${pid}/children`, { children: batch, ...(prev ? { after: prev } : {}) }, 'PATCH');
        prev = r.results.at(-1)?.id ?? prev;
      }
    };
    const remove = async (i: number) => {
      const seg = st.segs[st.owner[i]!]!;
      if (seg.units !== 1 || KEEP_TYPES.has(seg.type)) {
        kept++;
        prev = seg.id;
        return;
      }
      await call(`/blocks/${seg.id}`, undefined, 'DELETE');
    };
    for (let k = 0; k < ops.length;) {
      const o = ops[k]!;
      if (o.op === 'keep') {
        await flush();
        prev = st.segs[st.owner[o.i]!]!.id;
        k++;
        continue;
      }
      // a run of changes between two kept units: changed blocks updated in place where they can be
      const dels: number[] = [];
      const ins: number[] = [];
      while (k < ops.length && ops[k]!.op !== 'keep') {
        const x = ops[k++]!;
        if (x.op === 'del') dels.push(x.i);
        else if (x.op === 'ins') ins.push(x.j);
      }
      // each changed block is matched to the new unit most like it (same kind, words in common), in order; the
      // rest are deletions and insertions around those
      const words = (u: string) => new Set(u.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((w) => w && w !== 'x'));
      const like = (a: string, b: string) => {
        const A = words(a);
        const B = words(b);
        if (!A.size || !B.size) return a.trim() === b.trim();
        let both = 0;
        for (const w of A) if (B.has(w)) both++;
        return both / Math.max(A.size, B.size) >= 0.5;
      };
      const pairs: [number, number][] = [];
      const editable = (d: number) => {
        const seg = st.segs[st.owner[d]!]!;
        return seg.units === 1 && TEXT_TYPES.has(seg.type) ? seg.type : null;
      };
      // as many changed as new, kind for kind: each was rewritten where it stands
      const oneForOne = dels.length === ins.length && dels.every((d, q) => editable(d) === unitToBlock(next[ins[q]!]!).type);
      if (oneForOne) dels.forEach((d, q) => pairs.push([d, q]));
      let from = oneForOne ? ins.length : 0;
      // new units that are an edit of something the text can't rewrite (inside columns, tables, toggle headings):
      // left out, so nothing is added twice — those change in Notion
      const absorbed = new Set<number>();
      for (const d of oneForOne ? [] : dels) {
        const seg = st.segs[st.owner[d]!]!;
        if (seg.units !== 1 || !TEXT_TYPES.has(seg.type)) {
          for (let q = from; q < ins.length; q++) {
            if (like(st.units[d]!, next[ins[q]!]!)) {
              absorbed.add(q);
              from = q + 1;
              break;
            }
          }
          continue;
        }
        for (let q = from; q < ins.length; q++) {
          const cand = next[ins[q]!]!;
          if (unitToBlock(cand).type === seg.type && like(st.units[d]!, cand)) {
            pairs.push([d, q]);
            from = q + 1;
            break;
          }
        }
      }
      let di = 0;
      let qi = 0;
      const gap = async (dUntil: number, qUntil: number) => {
        for (; di < dUntil; di++) {
          await flush();
          await remove(dels[di]!);
        }
        for (; qi < qUntil; qi++) if (!absorbed.has(qi)) queue.push(unitToBlock(next[ins[qi]!]!));
      };
      for (const [d, q] of pairs) {
        await gap(dels.indexOf(d), q);
        const seg = st.segs[st.owner[d]!]!;
        const oldU = st.units[d]!;
        const newU = next[ins[q]!]!;
        const fresh = unitToBlock(newU);
        const sameKids = oldU.split('\n').slice(1).join('\n') === newU.split('\n').slice(1).join('\n');
        await flush();
        if (seg.type === 'code' || sameKids) {
          const body = seg.type === 'code' ? (fresh.code as Record<string, unknown>) : lineToBlock(newU.split('\n')[0]!).body;
          await call(`/blocks/${seg.id}`, { [seg.type]: body }, 'PATCH');
          prev = seg.id;
        } else {
          // its nested items changed: the block is written again with them
          await remove(d);
          queue.push(fresh);
        }
        di++;
        qi++;
      }
      await gap(dels.length, ins.length);
    }
    await flush();
    await readPage(pid);
    const notes = [kept ? `${kept} kept (sub-pages and tables change in Notion)` : '', atTop ? 'added after the first block (Notion can’t add above it)' : ''].filter(Boolean);
    return ['Saved to Notion', ...notes].join(' · ');
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
      // pages inside blocks: find the page each block sits in (three at a time, Notion's pace)
      const blocks = [...new Set(found.flatMap((p) => (p.parent.type === 'block_id' && p.parent.block_id ? [p.parent.block_id] : [])))];
      for (let i = 0; i < blocks.length; i += 3) await Promise.all(blocks.slice(i, i + 3).map(pageOfBlock));
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
      return readPage(pageId(item));
    },
    async write(item, text) {
      return writePage(pageId(item), text);
    },
    async create(folder, name) {
      if (!folder) throw new NotionError('Open a page first: Notion adds pages under a page', 400);
      const title = [{ type: 'text', text: { content: name.trim() || 'Untitled' } }];
      const isDb = !folder.id.endsWith(SELF) && (await call<{ object: string; properties?: Record<string, { type: string }> }>(`/databases/${folder.id}`).catch(() => null));
      let parent: Record<string, string>;
      let properties: Record<string, unknown>;
      if (isDb && isDb.object === 'database') {
        const key = Object.entries(isDb.properties ?? {}).find(([, v]) => v.type === 'title')?.[0] ?? 'Name';
        parent = { database_id: folder.id };
        properties = { [key]: { title } };
      } else {
        parent = { page_id: pageId(folder) };
        properties = { title: { title } };
      }
      const page = await call<{ id: string; url: string }>('/pages', { parent, properties });
      return { id: page.id, name: name.trim() || 'Untitled', kind: 'note', parent: folder.id, path: `${folder.path}/${name.trim() || 'Untitled'}`, url: page.url, modified: Date.now() };
    },
    async remove(item) {
      await call(`/pages/${pageId(item)}`, { archived: true }, 'PATCH');
      pages.delete(pageId(item));
      return 'Moved to Notion’s trash';
    },
    async addImage(item, file) {
      const pid = pageId(item);
      const up = await call<{ id: string }>('/file_uploads', { mode: 'single_part', filename: file.name || 'image.png', content_type: file.type || 'image/png' });
      const form = new FormData();
      form.append('file', file, file.name || 'image.png');
      const sent = await fetch(`${API}/file_uploads/${up.id}/send`, { method: 'POST', headers: { Authorization: `Bearer ${tokenOf(conf.id)}`, 'Notion-Version': VERSION }, body: form });
      if (!sent.ok) throw new NotionError(sent.status === 401 ? 'The integration secret was refused' : `Notion said ${sent.status}`, sent.status);
      const last = pages.get(pid)?.segs.at(-1)?.id;
      await call(`/blocks/${pid}/children`, { children: [{ object: 'block', type: 'image', image: { type: 'file_upload', file_upload: { id: up.id } } }], ...(last ? { after: last } : {}) }, 'PATCH');
      return { text: await readPage(pid), saved: true };
    },
    async removeImage(item, ref) {
      const id = ref.replace(IMAGE_SCHEME, '');
      await call(`/blocks/${id}`, undefined, 'DELETE');
      images.delete(id);
      return { text: await readPage(pageId(item)), saved: true };
    },
    async orderIn(folder) {
      // where the sub-pages stand on the page (inside columns and toggles too): the page itself first, then them
      const pid = pageId(folder);
      const out: string[] = [`${pid}${SELF}`];
      const walk = async (id: string, hops: number): Promise<void> => {
        for (const b of await children(id)) {
          if (b.type === 'child_page' || b.type === 'child_database') out.push(b.id);
          else if (b.has_children && hops < 3 && ['column_list', 'column', 'toggle', 'synced_block', 'heading_1', 'heading_2', 'heading_3', 'callout'].includes(b.type)) await walk(b.id, hops + 1);
        }
      };
      try {
        await walk(pid, 0);
      } catch {
        // a database: no order of its own here
        return null;
      }
      return out;
    },
    async imageUrl(_item, ref) {
      return ref.startsWith(IMAGE_SCHEME) ? images.get(ref.slice(IMAGE_SCHEME.length)) ?? null : /^https?:/.test(ref) ? ref : null;
    },
  };
}
