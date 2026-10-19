// Keeps Haru's attendance and the Notion database "출석 체크" (a date column, one checkbox column per person) in step.
// Runs every 5 minutes from GitHub Actions (.github/workflows/haru-attendance.yml), which writes straight into the
// published site; the Notion token comes from the NOTION_TOKEN secret and never reaches the site.
//  1. out: each check-in or undo on Haru is a mark (on/off and when) waiting in Firestore at notion-checkins/{key}
//     (open to read, see firestore.rules). A mark newer than the Notion row's last edit sets that person's box to it
//     (a date without a row gets one); a row edited in Notion after the mark keeps what Notion says.
//  2. in:  everyone's Notion days, and when each recent row was last edited, go to data/attendance.json, so Haru
//     can weigh its own marks against Notion the same way.
// The site is public, so people are never named: each is keyed by a hash of their column name, and Haru
// (Settings → Account → Name in Notion) finds its own by hashing the name you give it.
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
/** Only recent days are written either way, and only their edit times are published. */
const WINDOW_DAYS = 60;
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
const isDay = (d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d);

/** A person's marks from Haru: date → { on, at } (from Firestore, no sign-in: the collection is open to read). */
async function haruMarks(key) {
  if (!FIREBASE_KEY) return new Map();
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/notion-checkins/${key}?key=${FIREBASE_KEY}`;
  const res = await fetch(url);
  if (res.status === 404) return new Map();
  if (!res.ok) throw new Error(`Firestore notion-checkins/${key}: ${res.status} ${await res.text()}`);
  const fields = (await res.json()).fields?.marks?.mapValue?.fields ?? {};
  const marks = new Map();
  for (const [date, v] of Object.entries(fields)) {
    const m = v.mapValue?.fields;
    if (isDay(date) && m) marks.set(date, { on: m.on?.booleanValue === true, at: Number(m.at?.integerValue ?? m.at?.doubleValue ?? 0) });
  }
  return marks;
}

const found = await notion('search', { filter: { property: 'object', value: 'database' }, page_size: 100 });
const db = found.results.find((d) => d.title.map((t) => t.plain_text).join('') === TITLE);
if (!db) throw new Error(`database "${TITLE}" is not shared with the integration`);

const dateProp = Object.entries(db.properties).find(([, p]) => p.type === 'date')?.[0];
const titleProp = Object.entries(db.properties).find(([, p]) => p.type === 'title')?.[0];
const people = Object.entries(db.properties).filter(([, p]) => p.type === 'checkbox').map(([name]) => name);
if (!dateProp || !titleProp || !people.length) throw new Error('expected a title, a date column and one checkbox column per person');

/** date → its row: page id, who is ticked, and when it was last edited (ms). */
const rows = new Map();
let cursor;
do {
  const page = await notion(`databases/${db.id}/query`, { page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) });
  for (const row of page.results) {
    const date = row.properties[dateProp]?.date?.start?.slice(0, 10);
    if (!isDay(date) || rows.has(date)) continue;
    rows.set(date, { id: row.id, ticked: new Set(people.filter((p) => row.properties[p]?.checkbox)), edited: Date.parse(row.last_edited_time) || 0 });
  }
  cursor = page.has_more ? page.next_cursor : undefined;
} while (cursor);

// ---- 1. Haru → Notion: the newer side wins, date by date
const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);
const until = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
let set = 0;
let cleared = 0;
let added = 0;
for (const person of people) {
  let marks;
  try {
    marks = await haruMarks(keyOf(person));
  } catch (e) {
    console.log(`skip ${keyOf(person)}: ${e.message}`);
    continue;
  }
  for (const [date, mark] of marks) {
    if (date < since || date > until) continue;
    const row = rows.get(date);
    // edited in Notion after this mark: Notion has the last word
    if (row && mark.at <= row.edited) continue;
    const on = row?.ticked.has(person) ?? false;
    if (mark.on === on) continue;
    if (row) {
      if (!DRY) await notion(`pages/${row.id}`, { properties: { [person]: { checkbox: mark.on } } }, 'PATCH');
      if (mark.on) row.ticked.add(person);
      else row.ticked.delete(person);
      row.edited = Date.now();
      if (mark.on) set++;
      else cleared++;
    } else if (mark.on) {
      const props = { [titleProp]: { title: [{ text: { content: 'Haru' } }] }, [dateProp]: { date: { start: date } }, [person]: { checkbox: true } };
      const page = DRY ? { id: `dry-${date}` } : await notion('pages', { parent: { database_id: db.id }, properties: props });
      rows.set(date, { id: page.id, ticked: new Set([person]), edited: Date.now() });
      added++;
    }
  }
}
console.log(`${DRY ? '[dry run] would set' : 'set'} ${set}, clear ${cleared}, add ${added} row(s) from Haru`);

// ---- 2. Notion → Haru: everyone's days, and recent rows' edit times
const days = Object.fromEntries(people.map((p) => [keyOf(p), []]));
const edited = {};
for (const [date, row] of [...rows].sort(([a], [b]) => a.localeCompare(b))) {
  for (const p of row.ticked) days[keyOf(p)].push(date);
  if (date >= since) edited[date] = row.edited;
}
const out = { updated: new Date().toISOString(), people: days, edited };
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(out)}\n`);
console.log(`attendance: ${people.length} people, ${Object.values(days).reduce((n, d) => n + d.length, 0)} check-ins → ${OUT}`);
