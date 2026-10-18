// Builds data/attendance.json from the Notion database "출석 체크" (a date column, one checkbox column per person).
// Runs every 10 minutes from GitHub Actions (.github/workflows/haru-news.yml), which writes straight into the
// published site; the token comes from the NOTION_TOKEN secret and never reaches the site.
// The site is public, so people are not named in the file: each is keyed by a hash of their column name, and
// Haru (Settings → Account → Notion name) finds its own by hashing the name you give it.
//
// Usage: NOTION_TOKEN=… node scripts/fetch-attendance.mjs [out-file]   (default: public/data/attendance.json)
// Needs only Node 18+ (global fetch and crypto); no dependencies.
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const OUT = process.argv[2] ?? 'public/data/attendance.json';
const TITLE = process.env.NOTION_ATTENDANCE_TITLE ?? '출석 체크';
const TOKEN = process.env.NOTION_TOKEN;
if (!TOKEN) {
  console.log('NOTION_TOKEN not set: attendance left as it is');
  process.exit(0);
}

async function notion(path, body) {
  const res = await fetch(`https://api.notion.com/v1/${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`Notion ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

/** The same key Haru computes in the browser: the first 16 hex digits of SHA-256 of the trimmed name. */
export const keyOf = (name) => createHash('sha256').update(name.trim().normalize('NFC')).digest('hex').slice(0, 16);

const found = await notion('search', { filter: { property: 'object', value: 'database' }, page_size: 100 });
const db = found.results.find((d) => d.title.map((t) => t.plain_text).join('') === TITLE);
if (!db) throw new Error(`database "${TITLE}" is not shared with the integration`);

const dateProp = Object.entries(db.properties).find(([, p]) => p.type === 'date')?.[0];
const people = Object.entries(db.properties).filter(([, p]) => p.type === 'checkbox').map(([name]) => name);
if (!dateProp || !people.length) throw new Error('expected a date column and one checkbox column per person');

const days = Object.fromEntries(people.map((p) => [keyOf(p), new Set()]));
let cursor;
do {
  const page = await notion(`databases/${db.id}/query`, { page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) });
  for (const row of page.results) {
    const date = row.properties[dateProp]?.date?.start?.slice(0, 10);
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    for (const p of people) if (row.properties[p]?.checkbox) days[keyOf(p)].add(date);
  }
  cursor = page.has_more ? page.next_cursor : undefined;
} while (cursor);

const out = { updated: new Date().toISOString(), people: Object.fromEntries(Object.entries(days).map(([k, s]) => [k, [...s].sort()])) };
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(out)}\n`);
console.log(`attendance: ${people.length} people, ${Object.values(out.people).reduce((n, d) => n + d.length, 0)} check-ins → ${OUT}`);
