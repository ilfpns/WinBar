// Builds public/data/school-timetable.json: this week's and next week's class timetable of the school, from
// 컴시간알리미 (comci.net), so Settings → Today can lay a class's day onto Today.
// Browsers can't read comci.net directly (plain http, no CORS), so the site serves this snapshot instead.
// Runs on every deploy (`npm run school`) and from GitHub Actions with the headlines (.github/workflows/haru-news.yml).
// Only what Today needs goes in: each period's start time and subject per class and weekday (no teachers' names).
//
// Usage: node scripts/fetch-school-timetable.mjs [out-file]   (default: public/data/school-timetable.json)
// Needs only Node 18+ (global fetch); no dependencies.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const OUT = process.argv[2] ?? 'public/data/school-timetable.json';
const SCHOOL = { name: '대덕소프트웨어마이스터고등학교', region: '대전', search: '%B4%EB%B4%F6' /* "대덕" in EUC-KR */ };
const BASE = 'http://comci.net:4082';

async function get(path) {
  const res = await fetch(BASE + path, { headers: { 'User-Agent': 'Mozilla/5.0', Referer: `${BASE}/st` } });
  if (!res.ok) throw new Error(`comci ${path}: ${res.status}`);
  const text = await res.text();
  // the JSON is followed by padding
  return JSON.parse(text.slice(0, text.lastIndexOf('}') + 1));
}

/** The site's own script names its endpoints; read them from it so a rename there doesn't break this. */
async function endpoints() {
  const res = await fetch(`${BASE}/st`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  const html = new TextDecoder('euc-kr').decode(await res.arrayBuffer());
  const search = /url:'\.(\/\d+\?\d+l)'/.exec(html)?.[1];
  const data = /var sc3='\.(\/\d+\?)'/.exec(html)?.[1];
  const prefix = /sc_data\('(\d+_)'/.exec(html)?.[1];
  // which fields hold the day's lessons and the subject names
  const lessons = /일일자료=Q자료\(자료\.(자료\d+)/.exec(html)?.[1];
  const subjects = /과목명=Q과목명\(자료\.(자료\d+)/.exec(html)?.[1];
  if (!search || !data || !prefix || !lessons || !subjects) throw new Error('comci page changed: endpoints not found');
  return { search, data, prefix, lessons, subjects };
}

const ep = await endpoints();
const found = (await get(ep.search + SCHOOL.search)).학교검색 ?? [];
const school = found.find((s) => s[2] === SCHOOL.name && s[1] === SCHOOL.region);
if (!school) throw new Error(`${SCHOOL.name} not found on comci`);
const code = school[3];

const weeks = [];
for (const r of [1, 2]) {
  const d = await get(ep.data + Buffer.from(`${ep.prefix}${code}_0_${r}`).toString('base64'));
  if (!d.시작일) continue;
  const split = Number(d.분리) || 100;
  const subjectNames = d[ep.subjects] ?? [];
  const periods = (d.일과시간 ?? []).map((s) => /\((\d{1,2}:\d{2})\)/.exec(s)?.[1]).filter(Boolean);
  const classes = {};
  for (let grade = 1; grade < (d.학급수?.length ?? 0); grade++) {
    const count = (d.학급수[grade] ?? 0) - (d.가상학급수?.[grade] ?? 0);
    for (let cls = 1; cls <= count; cls++) {
      const days = {};
      for (let day = 1; day <= 5; day++) {
        const row = d[ep.lessons]?.[grade]?.[cls]?.[day];
        if (!Array.isArray(row)) continue;
        const lessons = [];
        for (let p = 1; p <= Math.min(Number(row[0]) || 0, periods.length); p++) {
          // ">" marks a lesson changed for that day; the number is teacher * split + subject
          const n = Number(String(row[p] ?? '').replace(/^>/, ''));
          const subject = n > 0 ? String(subjectNames[n % split] ?? '').trim() : '';
          if (subject) lessons.push({ period: p, subject });
        }
        days[day] = lessons;
      }
      classes[`${grade}-${cls}`] = days;
    }
  }
  weeks.push({ start: d.시작일, periods, classes });
}
if (!weeks.length) throw new Error('no timetable weeks');

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify({ school: SCHOOL.name, generatedAt: new Date().toISOString(), weeks })}\n`);
console.log(`school timetable: ${weeks.length} week(s), ${Object.keys(weeks[0].classes).length} classes → ${OUT}`);
