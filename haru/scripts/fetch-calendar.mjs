// Builds public/data/calendar.json: Korean public holidays & observances + the school's academic calendar.
// Runs before every deploy (and via `npm run calendar`). Browsers can't fetch these sources directly
// (no CORS / keys must stay private), so the site ships a static snapshot instead.
//
//   Holidays: Google Calendar's public Korean holiday calendar (no key).
//   School:   NEIS Open API SchoolSchedule. With NEIS_KEY set it pages through with the key;
//             without one, NEIS returns at most 5 rows per call, so the range is fetched week by week
//             (falling back to single days for busy weeks).
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';

const OUT = 'public/data/calendar.json';
const SCHOOL = { name: '대덕소프트웨어마이스터고등학교', office: 'G10', code: '7430310' };
const HOLIDAY_ICS = 'https://calendar.google.com/calendar/ical/ko.south_korea%23holiday%40group.v.calendar.google.com/public/basic.ics';
const NEIS = 'https://open.neis.go.kr/hub/SchoolSchedule';
const KEY = process.env.NEIS_KEY ?? '';
const SKIP = new Set(['토요휴업일']); // NEIS lists every Saturday; not an event

const ymd = (d) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
const iso = (s) => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function holidays(fromYear, toYear) {
  const text = (await (await fetch(HOLIDAY_ICS)).text()).replace(/\r?\n[ \t]/g, '');
  const events = [];
  for (const block of text.split('BEGIN:VEVENT').slice(1)) {
    const date = block.match(/DTSTART;VALUE=DATE:(\d{8})/)?.[1];
    const title = block.match(/SUMMARY:(.*)/)?.[1]?.trim();
    const desc = block.match(/DESCRIPTION:(.*)/)?.[1] ?? '';
    if (!date || !title) continue;
    const year = Number(date.slice(0, 4));
    if (year < fromYear || year > toYear) continue;
    events.push({ date: iso(date), title, kind: desc.startsWith('공휴일') ? 'holiday' : 'observance' });
  }
  return events;
}

async function neis(from, to, size = 5, page = 1) {
  const params = new URLSearchParams({
    Type: 'json', pIndex: String(page), pSize: String(size),
    ATPT_OFCDC_SC_CODE: SCHOOL.office, SD_SCHUL_CODE: SCHOOL.code, AA_FROM_YMD: ymd(from), AA_TO_YMD: ymd(to),
    ...(KEY ? { KEY } : {}),
  });
  const data = await (await fetch(`${NEIS}?${params}`)).json();
  const table = data.SchoolSchedule;
  if (!table) return { total: 0, rows: [] }; // INFO-200: nothing in range
  return { total: table[0].head[0].list_total_count, rows: table[1].row };
}

async function school(from, to) {
  const rows = [];
  if (KEY) {
    for (let page = 1; ; page++) {
      const { total, rows: got } = await neis(from, to, 1000, page);
      rows.push(...got);
      if (rows.length >= total || !got.length) break;
    }
  } else {
    for (let start = from; start <= to; start = addDays(start, 7)) {
      const end = addDays(start, 6) < to ? addDays(start, 6) : to;
      const week = await neis(start, end);
      if (week.total <= 5) rows.push(...week.rows);
      else {
        for (let day = start; day <= end; day = addDays(day, 1)) {
          rows.push(...(await neis(day, day)).rows);
          await sleep(80);
        }
      }
      await sleep(80);
    }
  }
  const seen = new Set();
  return rows
    .filter((r) => !SKIP.has(r.EVENT_NM))
    .map((r) => ({ date: iso(r.AA_YMD), title: r.EVENT_NM.trim(), kind: 'school', off: r.SBTR_DD_SC_NM === '휴업일' }))
    .filter((e) => (seen.has(e.date + e.title) ? false : (seen.add(e.date + e.title), true)));
}

const today = new Date();
const from = new Date(today.getFullYear(), today.getMonth() - 6, 1);
const to = new Date(today.getFullYear() + 1, today.getMonth() + 7, 0);

try {
  const [h, raw] = await Promise.all([holidays(from.getFullYear(), to.getFullYear()), school(from, to)]);
  // NEIS repeats national holidays in the school calendar; keep those once, from the holiday source
  const holidayDays = new Set(h.filter((e) => e.kind === 'holiday').map((e) => e.date));
  const holidayNames = new Set(h.map((e) => `${e.date}|${e.title}`));
  const s = raw.filter((e) => !holidayNames.has(`${e.date}|${e.title}`) && !(holidayDays.has(e.date) && /공휴일|절$|날$/.test(e.title)));
  const events = [...h, ...s].sort((a, b) => a.date.localeCompare(b.date));
  mkdirSync('public/data', { recursive: true });
  writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), school: SCHOOL.name, from: iso(ymd(from)), to: iso(ymd(to)), events }));
  console.log(`calendar: ${h.length} holidays/observances, ${s.length} school events (${KEY ? 'NEIS key' : 'keyless'}) → ${OUT}`);
} catch (err) {
  // keep shipping the previous snapshot rather than failing the deploy
  console.warn(`calendar: fetch failed (${err.message}); ${existsSync(OUT) ? 'keeping the existing snapshot' : 'no snapshot yet'}`);
  if (!existsSync(OUT)) writeFileSync(OUT, JSON.stringify({ generatedAt: null, events: [] }));
  else JSON.parse(readFileSync(OUT, 'utf-8'));
}
