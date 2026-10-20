// The change-request queue ("@변경요청 …" in Haru's chat, Firestore `change-requests`), for whoever develops Haru.
// Nothing here changes the app: it lists what is waiting, and records what became of a request in
// public/data/change-requests.json (published with the site, shown in the chat under the request).
//
//   node scripts/change-requests.mjs list                          what is waiting (oldest first)
//   node scripts/change-requests.mjs all                           every request and its state
//   node scripts/change-requests.mjs done <id> "<summary>" [v1.x]  made it
//   node scripts/change-requests.mjs declined <id> "<reason>"      won't make it
//
// Reading needs no sign-in (the collection is open to read, see firestore.rules); Node 18+, no dependencies.
import { readFileSync, writeFileSync } from 'node:fs';

const PROJECT = process.env.FIREBASE_PROJECT_ID ?? 'haru-5e81a';
const OUT = new URL('../public/data/change-requests.json', import.meta.url);

function outcomes() {
  try {
    return JSON.parse(readFileSync(OUT, 'utf8')).requests ?? {};
  } catch {
    return {};
  }
}

async function queue() {
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/change-requests?pageSize=300`;
  const res = await fetch(url);
  if (res.status === 403) throw new Error('The queue is closed to reading: publish firestore.rules (change-requests: allow read: if true)');
  if (!res.ok) throw new Error(`Firestore change-requests: ${res.status} ${await res.text()}`);
  const docs = (await res.json()).documents ?? [];
  return docs.map((d) => {
    const f = d.fields ?? {};
    return {
      id: d.name.split('/').pop(),
      text: f.text?.stringValue ?? '',
      name: f.name?.stringValue ?? '',
      at: Number(f.at?.integerValue ?? f.at?.doubleValue ?? 0),
    };
  }).sort((a, b) => a.at - b.at);
}

const when = (t) => new Date(t).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

const [cmd = 'list', id, note, version] = process.argv.slice(2);
try {
if (cmd === 'list' || cmd === 'all') {
  const done = outcomes();
  const items = (await queue()).filter((r) => cmd === 'all' || !done[r.id]);
  if (!items.length) console.log(cmd === 'list' ? '대기 중인 변경요청 없음' : '변경요청 없음');
  else {
    if (cmd === 'list') console.log(`대기 중인 변경요청 ${items.length}건`);
    for (const r of items) console.log(`- [${done[r.id]?.status ?? 'queued'}] ${r.id} · ${when(r.at)} · ${r.text.replace(/\s+/g, ' ')}`);
  }
} else if (cmd === 'done' || cmd === 'declined') {
  if (!id || !note) {
    console.error(`usage: node scripts/change-requests.mjs ${cmd} <id> "<${cmd === 'done' ? 'summary' : 'reason'}>"${cmd === 'done' ? ' [v1.x]' : ''}`);
    process.exitCode = 1;
  } else {
  const all = outcomes();
  all[id] = { status: cmd, summary: note, ...(version ? { version } : {}), at: Date.now() };
  writeFileSync(OUT, JSON.stringify({ updated: new Date().toISOString(), requests: all }, null, 2) + '\n');
  console.log(`${id}: ${cmd} — 배포하면 채팅에 보인다`);
  }
} else {
  console.error('commands: list | all | done <id> "<summary>" [v1.x] | declined <id> "<reason>"');
  process.exitCode = 1;
}
} catch (e) {
  console.error(String(e instanceof Error ? e.message : e));
  process.exitCode = 1;
}
