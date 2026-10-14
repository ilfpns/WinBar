// Builds data/news.json: IT-only headlines (AI, AGI, robotics / physical AI, chips, embedded, software, hardware)
// from many outlets, English and Korean, each placed on the globe at the country it is about.
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
const PER_PLACE = 60;       // newest headlines kept per country (busy countries can't crowd out the rest)
const PER_PLACE_US = 120;   // the US gets more: most outlets are there
const CONCURRENCY = 8;      // feeds fetched at once (Google News throttles bursts)
const PER_TOPIC = 12;       // …but each country also keeps this many of every topic, so quiet fields aren't crowded out
const WEEK_DAYS = 7;        // "this week": hot keywords and the most-covered story

const gn = (q, lang = 'en') => lang === 'ko'
  ? `https://news.google.com/rss/search?q=${encodeURIComponent(`${q} when:2d`)}&hl=ko&gl=KR&ceid=KR:ko`
  : `https://news.google.com/rss/search?q=${encodeURIComponent(`${q} when:2d`)}&hl=en-US&gl=US&ceid=US:en`;

/** Countries drawn as pins (`iso`: ISO 3166 numeric codes lit on the globe); `q` searches that country's IT news (English, plus the local language where useful). */
const COUNTRIES = {
  us: { iso: ['840'], name: 'United States', lat: 37.39, lon: -122.08, q: ['"United States" OR U.S. OR American'] },
  kr: { iso: ['410'], name: 'South Korea', lat: 37.57, lon: 126.98, q: ['"South Korea" OR Korean OR Samsung OR "SK hynix"'], ko: '한국' },
  cn: { iso: ['156'], name: 'China', lat: 39.9, lon: 116.4, q: ['China OR Chinese OR Huawei OR Alibaba OR DeepSeek'] },
  jp: { iso: ['392'], name: 'Japan', lat: 35.68, lon: 139.69, q: ['Japan OR Japanese OR SoftBank OR Rapidus OR Sony'], ko: '일본' },
  tw: { iso: ['158'], name: 'Taiwan', lat: 25.03, lon: 121.56, q: ['Taiwan OR TSMC OR MediaTek OR Foxconn'] },
  in: { iso: ['356'], name: 'India', lat: 12.97, lon: 77.59, q: ['India OR Indian OR Bengaluru'] },
  uk: { iso: ['826'], name: 'United Kingdom', lat: 51.51, lon: -0.13, q: ['UK OR Britain OR British OR Arm OR DeepMind'] },
  de: { iso: ['276'], name: 'Germany', lat: 52.52, lon: 13.4, q: ['Germany OR German OR Siemens OR Infineon'] },
  fr: { iso: ['250'], name: 'France', lat: 48.86, lon: 2.35, q: ['France OR French OR Mistral'] },
  nl: { iso: ['528'], name: 'Netherlands', lat: 52.37, lon: 4.9, q: ['Netherlands OR Dutch OR ASML OR NXP'] },
  il: { iso: ['376'], name: 'Israel', lat: 32.08, lon: 34.78, q: ['Israel OR Israeli'] },
  eu: { iso: ['040', '056', '100', '191', '196', '203', '208', '233', '246', '250', '276', '300', '348', '372', '380', '428', '440', '442', '470', '528', '616', '620', '642', '703', '705', '724', '752'], name: 'European Union', lat: 50.85, lon: 4.35, q: ['"European Union" OR EU OR Brussels'] },
  ca: { iso: ['124'], name: 'Canada', lat: 43.65, lon: -79.38, q: ['Canada OR Canadian OR Toronto'] },
  sg: { iso: ['702'], name: 'Singapore', lat: 1.35, lon: 103.82, q: ['Singapore'] },
  ae: { iso: ['784'], name: 'UAE', lat: 24.45, lon: 54.38, q: ['UAE OR Emirates OR "Abu Dhabi" OR Dubai OR G42'] },
  sa: { iso: ['682'], name: 'Saudi Arabia', lat: 24.71, lon: 46.68, q: ['"Saudi Arabia" OR Saudi OR Humain'] },
  au: { iso: ['036'], name: 'Australia', lat: -33.87, lon: 151.21, q: ['Australia OR Australian'] },
  br: { iso: ['076'], name: 'Brazil', lat: -23.55, lon: -46.63, q: ['Brazil OR Brazilian'] },
  // Asia / Oceania
  my: { iso: ['458'], name: 'Malaysia', lat: 3.14, lon: 101.69, q: ['Malaysia OR Malaysian OR Johor'] },
  vn: { iso: ['704'], name: 'Vietnam', lat: 21.03, lon: 105.85, q: ['Vietnam OR Vietnamese'] },
  id: { iso: ['360'], name: 'Indonesia', lat: -6.2, lon: 106.85, q: ['Indonesia OR Indonesian OR Jakarta'] },
  th: { iso: ['764'], name: 'Thailand', lat: 13.76, lon: 100.5, q: ['Thailand OR Thai OR Bangkok'] },
  pk: { iso: ['586'], name: 'Pakistan', lat: 33.68, lon: 73.05, q: ['Pakistan OR Pakistani'] },
  kp: { iso: ['408'], name: 'North Korea', lat: 39.02, lon: 125.75, q: ['"North Korea" OR "North Korean" OR Lazarus'] },
  nz: { iso: ['554'], name: 'New Zealand', lat: -36.85, lon: 174.76, q: ['"New Zealand"'] },
  // Europe
  ru: { iso: ['643'], name: 'Russia', lat: 55.76, lon: 37.62, q: ['Russia OR Russian OR Yandex'] },
  ua: { iso: ['804'], name: 'Ukraine', lat: 50.45, lon: 30.52, q: ['Ukraine OR Ukrainian OR Kyiv'] },
  ie: { iso: ['372'], name: 'Ireland', lat: 53.35, lon: -6.26, q: ['Ireland OR Irish OR Dublin'] },
  es: { iso: ['724'], name: 'Spain', lat: 40.42, lon: -3.7, q: ['Spain OR Spanish OR Madrid OR Barcelona'] },
  it: { iso: ['380'], name: 'Italy', lat: 45.46, lon: 9.19, q: ['Italy OR Italian OR Milan'] },
  pl: { iso: ['616'], name: 'Poland', lat: 52.23, lon: 21.01, q: ['Poland OR Warsaw'] },
  se: { iso: ['752'], name: 'Sweden', lat: 59.33, lon: 18.07, q: ['Sweden OR Swedish OR Ericsson OR Spotify'] },
  fi: { iso: ['246'], name: 'Finland', lat: 60.17, lon: 24.94, q: ['Finland OR Finnish OR Nokia'] },
  ch: { iso: ['756'], name: 'Switzerland', lat: 47.37, lon: 8.54, q: ['Switzerland OR Swiss OR Zurich OR Geneva'] },
  // Middle East / Africa
  tr: { iso: ['792'], name: 'Türkiye', lat: 41.01, lon: 28.98, q: ['Turkey OR Türkiye OR Turkish OR Istanbul'] },
  qa: { iso: ['634'], name: 'Qatar', lat: 25.29, lon: 51.53, q: ['Qatar OR Qatari OR Doha'] },
  ng: { iso: ['566'], name: 'Nigeria', lat: 6.52, lon: 3.38, q: ['Nigeria OR Nigerian OR Lagos'] },
  za: { iso: ['710'], name: 'South Africa', lat: -26.2, lon: 28.05, q: ['"South Africa" OR "South African" OR Johannesburg'] },
  ke: { iso: ['404'], name: 'Kenya', lat: -1.29, lon: 36.82, q: ['Kenya OR Kenyan OR Nairobi'] },
  eg: { iso: ['818'], name: 'Egypt', lat: 30.04, lon: 31.24, q: ['Egypt OR Egyptian OR Cairo'] },
  // Latin America
  mx: { iso: ['484'], name: 'Mexico', lat: 19.43, lon: -99.13, q: ['Mexico OR Mexican'] },
  ar: { iso: ['032'], name: 'Argentina', lat: -34.6, lon: -58.38, q: ['Argentina OR Argentine OR "Buenos Aires"'] },
  cl: { iso: ['152'], name: 'Chile', lat: -33.45, lon: -70.67, q: ['Chile OR Chilean'] },
};
const IT_TERMS = '(AI OR "artificial intelligence" OR semiconductor OR chip OR robot OR robotics OR software OR "tech" OR GPU OR "data center")';

/**
 * Feeds. `place` pins every headline of a feed to one country (the per-country searches);
 * otherwise `home` places a headline when its title names no country or company we know.
 * `topic` is the default topic for a specialised feed whose headlines don't spell their field out.
 * `strict` feeds are general (e.g. Hacker News): only headlines that match an IT topic are kept.
 */
const FEEDS = [
  // per country (listed first so a story found for a country keeps that country)
  ...Object.entries(COUNTRIES).flatMap(([id, c]) => [
    ...c.q.map((q) => ({ name: null, url: gn(`(${q}) ${IT_TERMS}`), place: id, strict: true })),
    ...(c.ko ? [{ name: null, url: gn(`${c.ko} (인공지능 OR 반도체 OR 로봇 OR 소프트웨어)`, 'ko'), place: id, strict: true }] : []),
  ]),
  // outlets
  { name: 'TechCrunch', url: 'https://techcrunch.com/feed/', home: 'us', strict: true },
  { name: 'The Verge', url: 'https://www.theverge.com/rss/index.xml', home: 'us', strict: true },
  { name: 'Ars Technica', url: 'https://feeds.arstechnica.com/arstechnica/technology-lab', home: 'us', strict: true },
  { name: 'WIRED', url: 'https://www.wired.com/feed/tag/ai/latest/rss', home: 'us', topic: 'ai' },
  { name: 'MIT Technology Review', url: 'https://www.technologyreview.com/feed/', home: 'us', strict: true },
  { name: 'IEEE Spectrum', url: 'https://spectrum.ieee.org/feeds/feed.rss', home: 'us', strict: true },
  { name: "Tom's Hardware", url: 'https://www.tomshardware.com/feeds/all', home: 'us', topic: 'hw' },
  { name: 'The Register', url: 'https://www.theregister.com/headlines.atom', home: 'uk', strict: true },
  { name: 'EE Times', url: 'https://www.eetimes.com/feed/', home: 'us', topic: 'chips' },
  { name: 'Embedded.com', url: 'https://www.embedded.com/feed/', home: 'us', topic: 'embedded' },
  { name: 'Hackaday', url: 'https://hackaday.com/blog/feed/', home: 'us', topic: 'embedded' },
  { name: 'The Robot Report', url: 'https://www.therobotreport.com/feed/', home: 'us', topic: 'robotics' },
  { name: 'Hacker News', url: 'https://hnrss.org/frontpage', home: 'us', strict: true },
  // more US press, by field
  { name: 'CNBC', url: 'https://www.cnbc.com/id/19854910/device/rss/rss.html', home: 'us', strict: true },
  { name: 'The New York Times', url: 'https://rss.nytimes.com/services/xml/rss/nyt/Technology.xml', home: 'us', strict: true },
  { name: 'Business Insider', url: 'https://feeds.businessinsider.com/custom/all', home: 'us', strict: true },
  { name: 'Fast Company', url: 'https://www.fastcompany.com/technology/rss', home: 'us', strict: true },
  { name: 'Engadget', url: 'https://www.engadget.com/rss.xml', home: 'us', strict: true },
  { name: 'Gizmodo', url: 'https://gizmodo.com/rss', home: 'us', strict: true },
  { name: 'ZDNET', url: 'https://www.zdnet.com/news/rss.xml', home: 'us', strict: true },
  { name: 'CNET', url: 'https://www.cnet.com/rss/news/', home: 'us', strict: true },
  { name: '9to5Mac', url: 'https://9to5mac.com/feed/', home: 'us', topic: 'hw' },
  { name: 'MacRumors', url: 'https://feeds.macrumors.com/MacRumors-All', home: 'us', topic: 'hw' },
  { name: 'Electrek', url: 'https://electrek.co/feed/', home: 'us', strict: true },
  { name: 'The Decoder', url: 'https://the-decoder.com/feed/', home: 'us', topic: 'ai' },
  { name: 'MarkTechPost', url: 'https://www.marktechpost.com/feed/', home: 'us', topic: 'ai' },
  { name: 'SemiEngineering', url: 'https://semiengineering.com/feed/', home: 'us', topic: 'chips' },
  { name: 'ServeTheHome', url: 'https://www.servethehome.com/feed/', home: 'us', topic: 'hw' },
  { name: 'TechPowerUp', url: 'https://www.techpowerup.com/rss/news', home: 'us', topic: 'hw' },
  { name: 'Wccftech', url: 'https://wccftech.com/feed/', home: 'us', strict: true },
  { name: 'Phoronix', url: 'https://www.phoronix.com/rss.php', home: 'us', topic: 'sw' },
  { name: 'LWN', url: 'https://lwn.net/headlines/rss', home: 'us', topic: 'sw' },
  { name: 'InfoQ', url: 'https://feed.infoq.com/', home: 'us', topic: 'sw' },
  { name: 'The New Stack', url: 'https://thenewstack.io/feed/', home: 'us', topic: 'sw' },
  { name: 'EDN', url: 'https://www.edn.com/feed/', home: 'us', topic: 'embedded' },
  { name: 'All About Circuits', url: 'https://www.allaboutcircuits.com/rss/', home: 'us', topic: 'embedded' },
  { name: 'IEEE Spectrum Robotics', url: 'https://spectrum.ieee.org/feeds/topic/robotics.rss', home: 'us', topic: 'robotics' },
  // labs and vendors
  { name: 'OpenAI', url: 'https://openai.com/news/rss.xml', home: 'us', topic: 'ai' },
  { name: 'Google DeepMind', url: 'https://deepmind.google/blog/rss.xml', home: 'uk', topic: 'ai' },
  { name: 'Hugging Face', url: 'https://huggingface.co/blog/feed.xml', home: 'fr', topic: 'ai' },
  { name: 'NVIDIA', url: 'https://blogs.nvidia.com/feed/', home: 'us', topic: 'chips' },
  { name: 'Google AI', url: 'https://blog.google/technology/ai/rss/', home: 'us', topic: 'ai' },
  { name: 'AWS Machine Learning', url: 'https://aws.amazon.com/blogs/machine-learning/feed/', home: 'us', topic: 'ai' },
  { name: 'Meta Engineering', url: 'https://engineering.fb.com/feed/', home: 'us', topic: 'sw' },
  { name: 'GitHub Blog', url: 'https://github.blog/feed/', home: 'us', topic: 'sw' },
  { name: 'Stack Overflow Blog', url: 'https://stackoverflow.blog/feed/', home: 'us', topic: 'sw' },
  // Korean IT press
  { name: 'AI타임스', url: 'https://www.aitimes.com/rss/allArticle.xml', home: 'kr', topic: 'ai' },
  { name: '전자신문', url: 'https://rss.etnews.com/Section901.xml', home: 'kr', strict: true },
  { name: '블로터', url: 'https://www.bloter.net/rss/allArticle.xml', home: 'kr', strict: true },
  // Google News searches per field (many more outlets)
  { name: null, url: gn('"artificial general intelligence" OR AGI'), home: 'us', topic: 'agi' },
  { name: null, url: gn('"physical AI" OR "humanoid robot" OR "vision-language-action" OR "VLA model"'), home: 'us', topic: 'robotics' },
  { name: null, url: gn('GPU OR CPU OR NPU OR semiconductor OR chipmaker'), home: 'us', topic: 'chips' },
  { name: null, url: gn('"embedded systems" OR microcontroller OR RTOS OR FPGA OR firmware'), home: 'us', topic: 'embedded' },
  { name: null, url: gn('"large language model" OR LLM OR "AI model"'), home: 'us', topic: 'ai' },
  { name: null, url: gn('"software engineering" OR "open source" OR programming language OR developer tools'), home: 'us', topic: 'sw' },
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


/**
 * Keywords tracked for "hot this week": a canonical name and the words that mean it (English and Korean).
 * Model and product names with a version number (GPT-5, RTX 5090, Gemini 3…) are picked up on top of these.
 */
const TERMS = [
  ['OpenAI', /openai|chatgpt|오픈AI|챗GPT/i], ['Anthropic', /anthropic|\bclaude\b|앤트로픽|클로드/i], ['Google', /google|alphabet|구글/i],
  ['Gemini', /gemini|제미나이/i], ['DeepMind', /deepmind|딥마인드/i], ['Meta', /\bmeta\b|llama|메타/i], ['Microsoft', /microsoft|copilot|마이크로소프트/i],
  ['Apple', /apple|iphone|\bmac(book)?\b|애플|아이폰/i], ['Amazon', /amazon|\baws\b|아마존/i], ['xAI', /\bxai\b|\bgrok\b/i], ['Mistral', /mistral/i],
  ['DeepSeek', /deepseek|딥시크/i], ['Alibaba', /alibaba|qwen|알리바바/i], ['Huawei', /huawei|화웨이/i], ['ByteDance', /bytedance|tiktok|바이트댄스|틱톡/i],
  ['Nvidia', /nvidia|엔비디아/i], ['AMD', /\bAMD\b/], ['Intel', /\bintel\b|인텔/i], ['TSMC', /tsmc/i], ['Samsung', /samsung|삼성/i],
  ['SK hynix', /hynix|하이닉스/i], ['Qualcomm', /qualcomm|퀄컴/i], ['Arm', /\barm\b(?! ?(and|in|of|the)\b)|\bArm holdings/], ['ASML', /asml/i],
  ['Broadcom', /broadcom|브로드컴/i], ['Tesla', /tesla|테슬라/i], ['Figure', /figure ai|figure 0\d|피규어/i], ['Boston Dynamics', /boston dynamics|보스턴 ?다이내믹스/i],
  ['Unitree', /unitree|유니트리/i], ['HBM', /\bHBM\d?\b/i], ['GPU', /\bGPUs?\b/i], ['RISC-V', /risc-?v/i], ['Chip export', /export (control|ban|curb)|수출 ?통제/i],
  ['Data center', /data ?cent(er|re)s?|데이터 ?센터/i], ['Humanoid', /humanoid|휴머노이드/i], ['Physical AI', /physical ai|피지컬 ?AI/i], ['VLA', /\bVLA\b|vision.language.action/i],
  ['Robotaxi', /robotaxi|로보택시/i], ['Self-driving', /self-driving|autonomous (car|vehicle|driving)|자율주행/i], ['Drone', /drones?\b|드론/i],
  ['AGI', /\bAGI\b|superintelligen|초지능|범용 ?인공지능/i], ['AI agent', /\bagents?\b|agentic|에이전트/i], ['LLM', /\bLLMs?\b|language models?|거대언어모델/i],
  ['Open source', /open.source|오픈소스/i], ['Quantum', /quantum|양자/i], ['Cybersecurity', /cyber|hack(ed|er|ing)|ransomware|breach|vulnerab|해킹|사이버/i],
  ['Smartphone', /smartphone|스마트폰/i], ['Edge AI', /edge ai|on-device|온디바이스/i], ['AI chip', /ai chips?|AI ?반도체/i], ['Foundry', /foundry|파운드리/i],
  ['Regulation', /regulat|\bAI act\b|규제|법안/i], ['Copyright', /copyright|저작권/i], ['Layoffs', /layoffs?|job cuts|감원|구조조정/i], ['IPO', /\bIPO\b|상장/i],
  ['Funding', /rais(es|ed) \$|funding round|series [a-e]\b|투자 ?유치/i], ['Acquisition', /acquir|acquisition|merger|인수/i],
];
const PRODUCT = /\b(GPT|Gemini|Claude|Llama|Grok|Qwen|DeepSeek|Mistral|Sora|Veo|RTX|Ryzen|EPYC|Xeon|Snapdragon|Exynos|Blackwell|Rubin|iPhone|Galaxy|Pixel|Optimus)[- ]?(R?\d+(\.\d+)?[a-z]?|Ultra|Pro|Max)\b/gi;
/** Canonical keywords of a headline (tracked terms first, then versioned product names). */
function keywordsOf(title) {
  const out = TERMS.filter(([, re]) => re.test(title)).map(([name]) => name);
  for (const m of title.matchAll(PRODUCT)) {
    const name = `${m[1][0].toUpperCase()}${m[1].slice(1)}${m[0].slice(m[1].length).replace(/^ /, ' ')}`.replace(/^Gpt/i, 'GPT').replace(/^Rtx/i, 'RTX').replace(/^Epyc/i, 'EPYC');
    if (!out.includes(name)) out.push(name);
  }
  return out.slice(0, 5);
}

/** Place words in a headline, checked in this order (countries before companies). */
const PLACE_WORDS = [
  ['kp', /north korea|pyongyang|lazarus|북한|평양/i],
  ['kr', /korea|korean|seoul|samsung|sk hynix|hynix|\bLG\b|naver|kakao|hyundai|한국|국내|서울|삼성|하이닉스|네이버|카카오|현대차|LG/i],
  ['jp', /japan|japanese|tokyo|sony|softbank|nintendo|rapidus|toyota|일본|도쿄|소니|소프트뱅크/i],
  ['tw', /taiwan|tsmc|foxconn|mediatek|asus|acer|대만|TSMC|폭스콘/i],
  ['cn', /china|chinese|beijing|shenzhen|huawei|alibaba|tencent|baidu|deepseek|xiaomi|bytedance|tiktok|unitree|byd|smic|중국|화웨이|알리바바|텐센트|딥시크|샤오미/i],
  ['id', /indonesia|jakarta|인도네시아/i],
  ['in', /\bindia|indian|bengaluru|bangalore|인도/i],
  ['il', /israel|tel aviv|이스라엘/i],
  ['nl', /netherlands|dutch|asml|nxp|네덜란드/i],
  ['de', /germany|german|siemens|infineon|bosch|독일/i],
  ['fr', /france|french|paris|mistral|프랑스/i],
  ['uk', /\bUK\b|britain|british|london|\barm holdings|deepmind|영국/i],
  ['eu', /\bEU\b|european|europe|brussels|유럽/i],
  ['ca', /canada|canadian|toronto|montreal|캐나다/i],
  ['sg', /singapore|싱가포르/i],
  ['ae', /\bUAE\b|emirates|abu dhabi|dubai|\bG42\b|아랍에미리트|두바이/i],
  ['sa', /saudi|humain|사우디/i],
  ['au', /australia|australian|호주/i],
  ['br', /brazil|brazilian|브라질/i],
  ['my', /malaysia|johor|kuala lumpur|말레이시아/i],
  ['vn', /vietnam|vietnamese|베트남/i],
  ['th', /thailand|\bthai\b|bangkok|태국/i],
  ['pk', /pakistan|파키스탄/i],
  ['nz', /new zealand|뉴질랜드/i],
  ['ua', /ukrain|kyiv|우크라이나/i],
  ['ru', /russia|yandex|moscow|러시아/i],
  ['ie', /ireland|\birish\b|dublin|아일랜드/i],
  ['es', /\bspain|spanish|madrid|barcelona|스페인/i],
  ['it', /\bital(y|ian)|milan|이탈리아/i],
  ['pl', /poland|warsaw|폴란드/i],
  ['se', /sweden|swedish|stockholm|ericsson|spotify|스웨덴/i],
  ['fi', /finland|finnish|helsinki|nokia|핀란드/i],
  ['ch', /switzerland|\bswiss\b|zurich|geneva|스위스/i],
  ['tr', /turkey|türkiye|turkish|istanbul|튀르키예|터키/i],
  ['qa', /qatar|doha|카타르/i],
  ['ng', /nigeria|lagos|나이지리아/i],
  ['za', /south africa|johannesburg|남아공|남아프리카/i],
  ['ke', /kenya|nairobi|케냐/i],
  ['eg', /egypt|cairo|이집트/i],
  ['mx', /(?<!new )mexico|mexican|멕시코/i],
  ['ar', /argentin|buenos aires|아르헨티나/i],
  ['cl', /\bchile\b|chilean|칠레/i],
  ['us', /nvidia|apple|google|alphabet|\bmeta\b|openai|anthropic|intel|\bAMD\b|qualcomm|tesla|\bxAI\b|broadcom|microsoft|amazon|\baws\b|silicon valley|seattle|\bU\.?S\.?\b|united states|american|washington|trump|미국|엔비디아|애플|구글|메타|오픈AI|앤트로픽|인텔|퀄컴|테슬라|마이크로소프트|아마존/i],
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
const NOISE = /\b(stocks?|shares|invest(ed|ing|or|ors|ment)?|buy now|price target|dividend|market (size|forecast|report|share|growth|outlook|analysis)|CAGR|prediction:)(?=\W|$)|주가|증시|특징주|목표가|매수|시황|K-뷰티/i;
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
      title, source, link: it.link, time: it.time, topics, kw: keywordsOf(title),
      // the title's own country/company wins; a country search's hit that names none stays with that country
      place: placeOf(title, feed.place ?? feed.home),
      lang: /[가-힣]/.test(title) ? 'ko' : 'en',
    });
    if (out.length >= PER_SOURCE) break;
  }
  return out;
}

const previous = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : null;
/** Runs `fn` over `list` with at most `n` in flight; results keep the list's order. */
async function pool(list, n, fn) {
  const results = new Array(list.length);
  let next = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (next < list.length) {
      const i = next++;
      results[i] = await fn(list[i]).then((value) => ({ status: 'fulfilled', value }), (reason) => ({ status: 'rejected', reason }));
    }
  }));
  return results;
}
const results = await pool(FEEDS, CONCURRENCY, fetchFeed);
const items = [];
const seen = new Set();
let failed = 0;
results.forEach((r, i) => {
  if (r.status === 'rejected') {
    failed++;
    console.warn(`news: ${FEEDS[i].name ?? FEEDS[i].place ?? FEEDS[i].url.slice(0, 60)} — ${r.reason?.message ?? r.reason}`);
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
const perPlace = new Map();
const perTopic = new Map();
const kept = items.filter((it) => {
  const n = (perPlace.get(it.place) ?? 0) + 1;
  perPlace.set(it.place, n);
  const t = `${it.place}:${it.topics[0]}`;
  const m = (perTopic.get(t) ?? 0) + 1;
  perTopic.set(t, m);
  return n <= (it.place === 'us' ? PER_PLACE_US : PER_PLACE) || m <= PER_TOPIC;
});

// ---------- this week: hot keywords and the most-covered story
// Per (Korean) day: keyword counts and that day's most-covered story. Days still inside the fetch window are
// recounted every run; older days are carried over from the previous file, so the week fills up over 7 days.
const dayOf = (t) => new Date(t + 9 * 3600_000).toISOString().slice(0, 10);
const STOP = new Set('the a an and or of to in on for with from by at as is are be its it this that new how why what will can says after over into about amid more than your their you our not just'.split(' '));
const tokens = (title) => new Set(title.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2 && !STOP.has(w)));
/** Groups headlines about the same story (shared words) and returns the one most outlets ran. */
function mostCovered(list) {
  const clusters = [];
  for (const it of list) {
    const tk = tokens(it.title);
    const home = clusters.find((c) => {
      let shared = 0;
      for (const w of tk) if (c.tokens.has(w)) shared++;
      return shared >= 3 && shared / Math.min(tk.size, c.tokens.size) >= 0.5;
    });
    if (home) {
      home.items.push(it);
      for (const w of tk) home.tokens.add(w);
    } else clusters.push({ tokens: tk, items: [it] });
  }
  let best = null;
  for (const c of clusters) {
    const outlets = new Set(c.items.map((i) => i.source)).size;
    if (outlets > (best?.outlets ?? 1)) best = { outlets, items: c.items };
  }
  if (!best) return null;
  // the earliest report from a named outlet stands for the story
  const lead = [...best.items].sort((a, b) => a.time - b.time)[0];
  return { title: lead.title, link: lead.link, source: lead.source, time: lead.time, outlets: best.outlets };
}
const today = dayOf(Date.now());
const window = new Set(items.map((it) => dayOf(it.time)));
const days = new Map((previous?.week?.days ?? []).map((d) => [d.day, d]));
for (const day of window) {
  const list = items.filter((it) => dayOf(it.time) === day);
  const terms = {};
  for (const it of list) for (const k of it.kw ?? []) terms[k] = (terms[k] ?? 0) + 1;
  days.set(day, { day, terms, top: mostCovered(list) });
}
const recent = [...days.values()]
  .filter((d) => (Date.parse(today) - Date.parse(d.day)) / 86_400_000 < WEEK_DAYS)
  .sort((a, b) => a.day.localeCompare(b.day));
const weekTerms = {};
for (const d of recent) for (const [k, n] of Object.entries(d.terms)) weekTerms[k] = (weekTerms[k] ?? 0) + n;
const hot = Object.entries(weekTerms).sort((a, b) => b[1] - a[1]).slice(0, 12);
const weekTop = recent.map((d) => d.top).filter(Boolean).sort((a, b) => b.outlets - a.outlets)[0] ?? null;
const week = { from: recent[0]?.day ?? today, to: today, hot, top: weekTop, days: recent };
const places = Object.entries(COUNTRIES).map(([id, { name, lat, lon, iso }]) => ({ id, name, lat, lon, iso }));

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify({ updated: new Date().toISOString(), places, week, items: kept })}\n`);
const by = (k) => Object.entries(kept.reduce((m, it) => [].concat(it[k]).reduce((mm, v) => ((mm[v] = (mm[v] ?? 0) + 1), mm), m), {}))
  .sort((a, b) => b[1] - a[1]).map(([v, n]) => `${v} ${n}`).join(', ');
console.log(`news: ${kept.length} IT headlines from ${FEEDS.length - failed}/${FEEDS.length} feeds → ${OUT}`);
console.log(`  topics: ${by('topics')}`);
console.log(`  places: ${by('place')}`);
console.log(`  hot this week: ${hot.slice(0, 8).map(([k, n]) => `${k} ${n}`).join(', ')}`);
console.log(`  most covered: ${weekTop ? `${weekTop.title} (${weekTop.outlets} outlets)` : '—'}`);
