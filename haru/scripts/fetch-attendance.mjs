// Keeps Haru's attendance and the Notion database "출석 체크" (a date column, one checkbox column per person) in step.
// Runs every 10 minutes from GitHub Actions (.github/workflows/haru-news.yml), which writes straight into the
// published site; the Notion token comes from the NOTION_TOKEN secret and never reaches the site.
//  1. out: check-ins made on Haru wait in Firestore at notion-checkins/{key} (open to read, see firestore.rules);
//     each person's column is ticked on those dates, and a date without a row gets one. Ticks are only added.
//  2. in:  everyone's Notion days go to data/attendance.json for Haru to show.
// The site is public, so people are never named: each is keyed by a hash of their column name, and Haru
// (Settings → Account → Notion name) finds its own by hashing the name you give it.
//
// Usage: NOTION_TOKEN=… [FIREBASE_API_KEY=…] [DRY_RUN=1] node scripts/fetch-attendance.mjs [out-file]
//        (default out-file: public/data/attendance.json; without FIREBASE_API_KEY step 1 is skipped)
// Needs only Node 18+ (global fetch and crypto); no dependencies.
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const OUT = process.argv[2] ?? 'public/data/attendance.json';
const TITLE = process.env.NOTION_ATTENDANCE_TITLE ?? '출석 체크';
const TOKEN = process.env.NOTION_TOKEN;
const FIREBASE_KEY = process.env.FIREBASE_API_KEY;
const FIREBASE_PROJECT = process.env.FIREBASE_PROJECT_ID ?? 'haru-5e81a';
const DRY = !!process.env.DRY_RUN;
/** Only recent Haru check-ins are written (older days are history either side already settled). */
const WRITE_DAYS = 60;
if (!TOKEN) {
  console.log('NOTION_TOKEN not set: attendance left as it is');
  process.exit(0);
}

async function notion(path, body, method = body ? 'POST' : 'GET') {
  const res = await fetch(`https://api.notion.com/v1/${path}`, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`Notion ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

/** The same key Haru computes in the browser: the first 16 hex digits of SHA-256 of the trimmed name. */
const keyOf = (name) => createHash('sha256').update(name.trim().normalize('NFC')).digest('hex').slice(0, 16);

/** Days a person checked in on Haru (from Firestore, no sign-in: the collection is open to read). */
async function haruDays(key) {
  if (!FIREBASE_KEY) return [];
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/notion-checkins/${key}?key=${FIREBASE_KEY}`;
  const res = await fetch(url);
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`Firestore notion-checkins/${key}: ${res.status} ${await res.text()}`);
  const doc = await res.json();
  return (doc.fields?.days?.arrayValue?.values ?? []).map((v) => v.stringValue).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d ?? ''));
}

const found = await notion('search', { filter: { property: 'object', value: 'database' }, page_size: 100 });
const db = found.results.find((d) => d.title.map((t) => t.plain_text).join('') === TITLE);
if (!db) throw new Error(`database "${TITLE}" is not shared with the integration`);

const dateProp = Object.entries(db.properties).find(([, p]) => p.type === 'date')?.[0];
const titleProp = Object.entries(db.properties).find(([, p]) => p.type === 'title')?.[0];
const people = Object.entries(db.properties).filter(([, p]) => p.type === 'checkbox').map(([name]) => name);
if (!dateProp || !titleProp || !people.length) throw new Error('expected a title, a date column and one checkbox column per person');

/** date → its row: page id and which people are ticked. */
const rows = new Map();
let cursor;
do {
  const page = await notion(`databases/${db.id}/query`, { page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) });
  for (const row of page.results) {
    const date = row.properties[dateProp]?.date?.start?.slice(0, 10);
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || rows.has(date)) continue;
    rows.set(date, { id: row.id, ticked: new Set(people.filter((p) => row.properties[p]?.checkbox)) });
  }
  cursor = page.has_more ? page.next_cursor : undefined;
} while (cursor);

// ---- 1. Haru → Notion
const since = new Date(Date.now() - WRITE_DAYS * 86_400_000).toISOString().slice(0, 10);
const until = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
let ticked = 0;
let added = 0;
for (const person of people) {
  let days;
  try {
    days = await haruDays(keyOf(person));
  } catch (e) {
    console.log(`skip ${keyOf(person)}: ${e.message}`);
    continue;
  }
  for (const date of days) {
    if (date < since || date > until) continue;
    const row = rows.get(date);
    if (row?.ticked.has(person)) continue;
    if (row) {
      if (!DRY) await notion(`pages/${row.id}`, { properties: { [person]: { checkbox: true } } }, 'PATCH');
      row.ticked.add(person);
      ticked++;
    } else {
      const props = { [titleProp]: { title: [{ text: { content: 'Haru' } }] }, [dateProp]: { date: { start: date } }, [person]: { checkbox: true } };
      const page = DRY ? { id: `dry-${date}` } : await notion('pages', { parent: { database_id: db.id }, properties: props });
      rows.set(date, { id: page.id, ticked: new Set([person]) });
      added++;
    }
  }
}
console.log(`${DRY ? '[dry run] would tick' : 'ticked'} ${ticked} and add ${added} row(s) from Haru check-ins`);

// ---- 2. Notion → Haru
const days = Object.fromEntries(people.map((p) => [keyOf(p), []]));
for (const [date, row] of [...rows].sort(([a], [b]) => a.localeCompare(b))) {
  for (const p of row.ticked) days[keyOf(p)].push(date);
}
const out = { updated: new Date().toISOString(), people: days };
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(out)}\n`);
console.log(`attendance: ${people.length} people, ${Object.values(days).reduce((n, d) => n + d.length, 0)} check-ins → ${OUT}`);
