/** A note's text before it is shown: Obsidian's front matter and links turned into what the renderer knows. */

/** Where a `[[link]]` points once it is a Markdown link: never a real address; the Library catches the click. */
export const WIKI = 'https://wiki.haru.invalid/';

/** Front matter (`---` lines at the top) apart from the text, as key–value pairs. */
export function splitFrontMatter(src: string): { meta: [string, string][]; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(src);
  if (!m) return { meta: [], body: src };
  const meta = m[1]!.split(/\r?\n/).flatMap((l) => {
    const kv = /^([\w-]+):\s*(.*)$/.exec(l);
    return kv && kv[2]!.trim() ? [[kv[1]!, kv[2]!.replace(/^\[|\]$/g, '').trim()] as [string, string]] : [];
  });
  return { meta, body: src.slice(m[0].length) };
}

/** Obsidian's links in plain Markdown: `[[Note|label]]` a link Haru catches, `![[file]]` its name. */
export const wikiToMarkdown = (src: string) => src
  .replace(/!\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g, (_, f: string) => `\`${f}\``)
  .replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g, (_, t: string, label?: string) => `[${label ?? t}](${WIKI}${encodeURIComponent(t.trim())})`);
