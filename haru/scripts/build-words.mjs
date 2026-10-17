// Builds public/data/words.json (the Words page's built-in decks) from scripts/words/tsl.csv (ngsl.csv, the dropped Basic deck, is kept but not built).
// Run: node scripts/build-words.mjs   — see scripts/words/README.md for where the lists come from.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/** Minimal RFC 4180 CSV reader (quoted fields, doubled quotes, commas and newlines inside quotes). */
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some(Boolean));
}

const decks = {};
for (const deck of ['tsl']) {
  const [head, ...rows] = parseCsv(readFileSync(join(here, 'words', `${deck}.csv`), 'utf8').replace(/^﻿/, ''));
  const col = (name) => head.indexOf(name);
  const [w, d, k, r] = ['word', 'definition', 'ko', 'rank'].map(col);
  decks[deck] = rows
    .sort((a, b) => Number(a[r]) - Number(b[r]))
    .map((row) => [row[w].trim(), row[d].trim(), row[k].trim()]);
}

const out = {
  v: 1,
  source: 'TSL 1.2 by Browne, C. and Culligan, B. (newgeneralservicelist.com), CC BY-SA 4.0; Korean meanings added for Haru, same license.',
  decks,
};
writeFileSync(join(here, '..', 'public', 'data', 'words.json'), JSON.stringify(out));
console.log(`words.json: ${decks.tsl.length} TOEIC words`);
