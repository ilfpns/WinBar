// Builds data/news.json: IT-only headlines (AI, AGI, robotics / physical AI, chips, embedded, software, hardware)
// from many outlets, English and Korean, each placed on the globe at the tech hub it is about.
// Runs on every deploy (`npm run news`) and every 10 minutes from GitHub Actions
// (.github/workflows/haru-news.yml), which writes straight into the published site.
// Browsers can't read these feeds directly (no CORS), so the site serves this snapshot instead.
//
// Usage: node scripts/fetch-news.mjs [out-file]   (default: public/data/news.json)
// Needs only Node 18+ (global fetch); no dependencies, so the scheduled job doesn't install anything.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const OUT = process.argv[2] ?? 'public/data/news.json';
const MAX_AGE_H = 72;       // older headlines drop off
const PER_SOURCE = 40;
const MAX_ITEMS = 500;

const gn = (q, lang = 'en') => lang === 'ko'
  ? `https://news.google.com/rss/search?q=${encodeURIComponent(`${q} when:2d`)}&hl=ko&gl=KR&ceid=KR:ko`
  : `https://news.google.com/rss/search?q=${encodeURIComponent(`${q} when:2d`)}&hl=en-US&gl=US&ceid=US:en`;

/**
 * Feeds. `home` places a headline when its title names no place or company we know.
 * `topic` is the default topic for a specialised feed whose headlines don't spell their field out.
 * `strict` feeds are general (e.g. Hacker News): only headlines that match an IT topic are kept.
 */
const FEEDS = [
  // outlets
  { name: 'TechCrunch', url: 'https://techcrunch.com/feed/', home: 'sv', strict: true },
  { name: 'The Verge', url: 'https://www.theverge.com/rss/index.xml', home: 'sv', strict: true },
  { name: 'Ars Technica', url: 'https://feeds.arstechnica.com/arstechnica/technology-lab', home: 'sv', strict: true },
  { name: 'WIRED', url: 'https://www.wired.com/feed/tag/ai/latest/rss', home: 'sv', topic: 'ai' },
  { name: 'MIT Technology Review', url: 'https://www.technologyreview.com/feed/', home: 'sv', strict: true },
  { name: 'IEEE Spectrum', url: 'https://spectrum.ieee.org/feeds/feed.rss', home: 'sv', strict: true },
  { name: "Tom's Hardware", url: 'https://www.tomshardware.com/feeds/all', home: 'sv', topic: 'hw' },
  { name: 'The Register', url: 'https://www.theregister.com/headlines.atom', home: 'uk', strict: true },
  { name: 'EE Times', url: 'https://www.eetimes.com/feed/', home: 'sv', topic: 'chips' },
  { name: 'Embedded.com', url: 'https://www.embedded.com/feed/', home: 'sv', topic: 'embedded' },
  { name: 'Hackaday', url: 'https://hackaday.com/blog/feed/', home: 'sv', topic: 'embedded' },
  { name: 'The Robot Report', url: 'https://www.therobotreport.com/feed/', home: 'sv', topic: 'robotics' },
  { name: 'Hacker News', url: 'https://hnrss.org/frontpage', home: 'sv', strict: true },
  // labs and vendors
  { name: 'OpenAI', url: 'https://openai.com/news/rss.xml', home: 'sv', topic: 'ai' },
  { name: 'Google DeepMind', url: 'https://deepmind.google/blog/rss.xml', home: 'uk', topic: 'ai' },
  { name: 'Hugging Face', url: 'https://huggingface.co/blog/feed.xml', home: 'fr', topic: 'ai' },
  { name: 'NVIDIA', url: 'https://blogs.nvidia.com/feed/', home: 'sv', topic: 'chips' },
  // Korean IT press
  { name: 'AI타임스', url: 'https://www.aitimes.com/rss/allArticle.xml', home: 'kr', topic: 'ai' },
  { name: '전자신문', url: 'https://rss.etnews.com/Section901.xml', home: 'kr', strict: true },
  { name: '블로터', url: 'https://www.bloter.net/rss/allArticle.xml', home: 'kr', strict: true },
  // Google News searches per field (many more outlets)
  { name: null, url: gn('"artificial general intelligence" OR AGI'), home: 'sv', topic: 'agi' },
  { name: null, url: gn('"physical AI" OR "humanoid robot" OR "vision-language-action" OR "VLA model"'), home: 'sv', topic: 'robotics' },
  { name: null, url: gn('GPU OR CPU OR NPU OR semiconductor OR chipmaker'), home: 'sv', topic: 'chips' },
  { name: null, url: gn('"embedded systems" OR microcontroller OR RTOS OR FPGA OR firmware'), home: 'sv', topic: 'embedded' },
  { name: null, url: gn('"large language model" OR LLM OR "AI model"'), home: 'sv', topic: 'ai' },
  { name: null, url: gn('"software engineering" OR "open source" OR programming language OR developer tools'), home: 'sv', topic: 'sw' },
  { name: null, url: gn('반도체 OR GPU OR 인공지능 OR 로봇', 'ko'), home: 'kr', strict: true },
];

/** Topics: the first match names the headline's field; a headline may carry several. */
const TOPICS = {
  agi: /\bAGI\b|artificial general intelligence|superintelligen|범용 ?인공지능|초지능/i,
  robotics: /robot|humanoid|physical ai|\bVLA\b|vision.language.action|embodied|autonomous (car|vehicle|driving)|self-driving|drone|로봇|휴머노이드|피지컬 ?AI|자율주행|드론/i,
  chips: /\b(GPU|CPU|NPU|TPU|SoC|HBM|DRAM|NAND|ASIC|RISC-V|x86|Arm)\b|semiconductor|chip|foundry|wafer|lithograph|nvidia|\bAMD\b|intel|qualcomm|tsmc|asml|broadcom|반도체|칩|파운드리|메모리|엔비디아|삼성전자|SK하이닉스/i,
  embedded: /embedded|microcontroller|\bMCU\b|firmware|\bRTOS\b|FPGA|raspberry pi|arduino|\bIoT\b|sensor|edge ai|임베디드|펌웨어|마이크로컨트롤러|사물인터넷|센서/i,
  ai: /\bAI\b|A\.I\.|artificial intelligence|machine learning|deep learning|neural|\bLLM|language model|chatbot|\bGPT|openai|anthropic|claude|gemini|deepmind|llama|mistral|deepseek|copilot|agent|인공지능|생성형|챗봇|에이전트|거대언어모델|LLM/i,
  sw: /software|open.source|developer|programming|\bcode\b|coding|compiler|linux|windows|android|\biOS\b|kernel|python|rust\b|javascript|github|cloud|database|API\b|cyber|security|vulnerab|소프트웨어|오픈소스|개발자|클라우드|보안|해킹/i,
  hw: /hardware|laptop|\bPC\b|smartphone|iphone|pixel|galaxy|display|battery|quantum|server|data ?center|supercomputer|headset|wearable|하드웨어|노트북|스마트폰|디스플레이|배터리|양자|서버|데이터센터/i,
};

/** Tech hubs drawn as pins. */
const PLACES = {
  sv: { name: 'Silicon Valley', lat: 37.39, lon: -122.08 },
  sea: { name: 'Seattle', lat: 47.61, lon: -122.33 },
  kr: { name: 'Seoul', lat: 37.57, lon: 126.98 },
  jp: { name: 'Tokyo', lat: 35.68, lon: 139.69 },
  cn: { name: 'China', lat: 39.9, lon: 116.4 },
  tw: { name: 'Taiwan', lat: 25.03, lon: 121.56 },
  uk: { name: 'London', lat: 51.51, lon: -0.13 },
  nl: { name: 'Netherlands', lat: 51.44, lon: 5.47 },
  de: { name: 'Germany', lat: 52.52, lon: 13.4 },
  fr: { name: 'Paris', lat: 48.86, lon: 2.35 },
  il: { name: 'Israel', lat: 32.08, lon: 34.78 },
  in: { name: 'India', lat: 12.97, lon: 77.59 },
  eu: { name: 'Brussels', lat: 50.85, lon: 4.35 },
};

/** Place words in a headline, checked in this order (countries before companies). */
const PLACE_WORDS = [
  ['kr', /korea|korean|seoul|samsung|sk hynix|hynix|\bLG\b|naver|kakao|hyundai|한국|국내|서울|삼성|하이닉스|네이버|카카오|현대차|LG/i],
  ['jp', /japan|japanese|tokyo|sony|softbank|nintendo|rapidus|toyota|일본|도쿄|소니|소프트뱅크/i],
  ['tw', /taiwan|tsmc|foxconn|mediatek|asus|acer|대만|TSMC|폭스콘/i],
  ['cn', /china|chinese|beijing|shenzhen|huawei|alibaba|tencent|baidu|deepseek|xiaomi|bytedance|tiktok|unitree|byd|smic|중국|화웨이|알리바바|텐센트|딥시크|샤오미/i],
  ['in', /\bindia|indian|bengaluru|bangalore|인도/i],
  ['il', /israel|tel aviv|이스라엘/i],
  ['nl', /netherlands|dutch|asml|nxp|네덜란드/i],
  ['de', /germany|german|siemens|infineon|bosch|독일/i],
  ['fr', /france|french|paris|mistral|프랑스/i],
  ['uk', /\bUK\b|britain|british|london|\barm holdings|deepmind|영국/i],
  ['eu', /\bEU\b|european|europe|brussels|유럽/i],
  ['sea', /microsoft|amazon|\baws\b|seattle|마이크로소프트|아마존/i],
  ['sv', /nvidia|apple|google|alphabet|\bmeta\b|openai|anthropic|intel|\bAMD\b|qualcomm|tesla|\bxAI\b|broadcom|silicon valley|엔비디아|애플|구글|메타|오픈AI|앤트로픽|인텔|퀄컴|테슬라/i],
];

const decode = (s) => s
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/<[^>]+>/g, '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ')
  .trim();
const tag = (block, name) => {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`));
  return m ? decode(m[1]) : '';
};

/** RSS <item> and Atom <entry> alike. */
function parse(xml) {
  const blocks = xml.includes('<item') ? xml.split(/<item[\s>]/).slice(1) : xml.split(/<entry[\s>]/).slice(1);
  return blocks.map((b) => {
    const atomLink = b.match(/<link[^>]*rel="alternate"[^>]*href="([^"]+)"/) ?? b.match(/<link[^>]*href="([^"]+)"/);
    return {
      title: tag(b, 'title'),
      link: tag(b, 'link') || (atomLink ? decode(atomLink[1]) : ''),
      time: Date.parse(tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated') || tag(b, 'dc:date')),
      source: tag(b, 'source'),
    };
  });
}

/** Finance chatter and market-research spam that only mention tech in passing. */
const NOISE = /(stocks?|shares|invest(ed|ing|or|ors|ment)?|buy now|price target|dividend|market (size|forecast|report|share|growth|outlook|analysis)|CAGR|prediction:)|주가|증시|특징주|목표가|매수|시황|K-뷰티/i;
const NOISY_SOURCES = /motley fool|indexbox|openpr|marketsandmarkets|yahoo finance|benzinga|zacks|seeking alpha|globenewswire|einpresswire|24\/7 wall st/i;

const topicsOf = (title) => Object.entries(TOPICS).filter(([, re]) => re.test(title)).map(([k]) => k);
const placeOf = (title, home) => PLACE_WORDS.find(([, re]) => re.test(title))?.[0] ?? home;
const key = (title) => title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

async function fetchFeed(feed) {
  const res = await fetch(feed.url, { headers: { 'user-agent': 'Mozilla/5.0 (haru news)' }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const cutoff = Date.now() - MAX_AGE_H * 3600_000;
  const out = [];
  for (const it of parse(await res.text())) {
    let { title } = it;
    const source = feed.name ?? it.source ?? '';
    // Google News appends " - Source" to every headline
    if (it.source && title.endsWith(` - ${it.source}`)) title = title.slice(0, -(it.source.length + 3));
    if (!title || !it.link || !Number.isFinite(it.time) || it.time < cutoff || it.time > Date.now() + 3600_000) continue;
    if (NOISE.test(title) || NOISY_SOURCES.test(source)) continue;
    let topics = topicsOf(title);
    if (!topics.length) {
      if (feed.strict || !feed.topic) continue; // general feeds: IT headlines only
      topics = [feed.topic];
    }
    out.push({
      title, source, link: it.link, time: it.time, topics,
      place: placeOf(title, feed.home),
      lang: /[가-힣]/.test(title) ? 'ko' : 'en',
    });
    if (out.length >= PER_SOURCE) break;
  }
  return out;
}

const previous = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : null;
const results = await Promise.allSettled(FEEDS.map(fetchFeed));
const items = [];
const seen = new Set();
let failed = 0;
results.forEach((r, i) => {
  if (r.status === 'rejected') {
    failed++;
    console.warn(`news: ${FEEDS[i].name ?? FEEDS[i].url.slice(0, 60)} — ${r.reason?.message ?? r.reason}`);
    return;
  }
  for (const it of r.value) {
    const k = key(it.title);
    if (seen.has(k)) continue; // the same story from two feeds
    seen.add(k);
    items.push(it);
  }
});
if (!items.length && previous) {
  console.warn('news: nothing fetched — keeping the previous file');
  process.exit(0);
}
items.sort((a, b) => b.time - a.time);
const kept = items.slice(0, MAX_ITEMS);
const places = Object.entries(PLACES).map(([id, p]) => ({ id, ...p }));

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify({ updated: new Date().toISOString(), places, items: kept })}\n`);
const by = (k) => Object.entries(kept.reduce((m, it) => [].concat(it[k]).reduce((mm, v) => ((mm[v] = (mm[v] ?? 0) + 1), mm), m), {}))
  .sort((a, b) => b[1] - a[1]).map(([v, n]) => `${v} ${n}`).join(', ');
console.log(`news: ${kept.length} IT headlines from ${FEEDS.length - failed}/${FEEDS.length} feeds → ${OUT}`);
console.log(`  topics: ${by('topics')}`);
console.log(`  places: ${by('place')}`);
