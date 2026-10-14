// Builds data/news.json: the latest headlines for a set of places on the globe.
// Runs on every deploy (`npm run news`) and every 10 minutes from GitHub Actions
// (.github/workflows/haru-news.yml), which writes straight into the published site.
// Browsers can't read Google News RSS directly (no CORS), so the site serves this snapshot instead.
//
//   Korea:  Google News top stories for Korea (Korean).
//   Others: Google News search in Korean for the place, last day — Korean-language coverage of it.
//
// Usage: node scripts/fetch-news.mjs [out-file]   (default: public/data/news.json)
// Needs only Node 18+ (global fetch); no dependencies, so the scheduled job doesn't install anything.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const OUT = process.argv[2] ?? 'public/data/news.json';
const PER_REGION = 15;
const KO = 'hl=ko&gl=KR&ceid=KR:ko';

/** Places shown as pins on the globe (capital or centre of the region). */
const REGIONS = [
  { id: 'kr', name: 'Korea', lat: 37.57, lon: 126.98, url: `https://news.google.com/rss?${KO}` },
  { id: 'us', name: 'United States', lat: 38.9, lon: -77.04, q: '미국' },
  { id: 'jp', name: 'Japan', lat: 35.68, lon: 139.69, q: '일본' },
  { id: 'cn', name: 'China', lat: 39.9, lon: 116.4, q: '중국' },
  { id: 'kp', name: 'North Korea', lat: 39.02, lon: 125.75, q: '북한' },
  { id: 'gb', name: 'United Kingdom', lat: 51.51, lon: -0.13, q: '영국' },
  { id: 'fr', name: 'France', lat: 48.86, lon: 2.35, q: '프랑스' },
  { id: 'de', name: 'Germany', lat: 52.52, lon: 13.4, q: '독일' },
  { id: 'ru', name: 'Russia', lat: 55.76, lon: 37.62, q: '러시아' },
  { id: 'ua', name: 'Ukraine', lat: 50.45, lon: 30.52, q: '우크라이나' },
  { id: 'me', name: 'Middle East', lat: 31.77, lon: 35.21, q: '중동 OR 이스라엘 OR 이란' },
  { id: 'in', name: 'India', lat: 28.61, lon: 77.21, q: '인도 총리 OR 인도 정부 OR 인도 경제' },
  { id: 'au', name: 'Australia', lat: -35.28, lon: 149.13, q: '호주' },
  { id: 'br', name: 'Brazil', lat: -15.79, lon: -47.88, q: '브라질' },
];

const decode = (s) => s
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&amp;/g, '&')
  .trim();
const tag = (block, name) => {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`));
  return m ? decode(m[1]) : '';
};

async function fetchRegion(r) {
  const url = r.url ?? `https://news.google.com/rss/search?q=${encodeURIComponent(`${r.q} when:1d`)}&${KO}`;
  const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (haru news)' } });
  if (!res.ok) throw new Error(`${r.id}: HTTP ${res.status}`);
  const xml = await res.text();
  const seen = new Set();
  const items = [];
  for (const block of xml.split('<item>').slice(1)) {
    const source = tag(block, 'source');
    let title = tag(block, 'title');
    // Google appends " - Source" to every headline
    if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3));
    const link = tag(block, 'link');
    const time = Date.parse(tag(block, 'pubDate'));
    if (!title || !link || !Number.isFinite(time) || seen.has(title)) continue;
    seen.add(title);
    items.push({ title, source, link, time });
  }
  items.sort((a, b) => b.time - a.time);
  return items.slice(0, PER_REGION);
}

const previous = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : null;
const regions = [];
let failed = 0;
for (const r of REGIONS) {
  const { url, q, ...place } = r;
  try {
    regions.push({ ...place, items: await fetchRegion(r) });
  } catch (e) {
    failed++;
    console.warn(`news: ${e.message}`);
    // keep what we had for that place rather than blanking it
    regions.push({ ...place, items: previous?.regions?.find((p) => p.id === r.id)?.items ?? [] });
  }
}
if (failed === REGIONS.length && previous) {
  console.warn('news: every source failed — keeping the previous file');
  process.exit(0);
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify({ updated: new Date().toISOString(), regions })}\n`);
console.log(`news: ${regions.reduce((n, r) => n + r.items.length, 0)} headlines in ${regions.length} places → ${OUT}`);
