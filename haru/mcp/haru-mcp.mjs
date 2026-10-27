#!/usr/bin/env node
// Haru for Claude: an MCP server (stdio) that lets Claude read and arrange your Haru — Today's tasks, days planned
// ahead (Calendar → Week), calendar memos, holidays and the school calendar, past days, and Journal pages. It signs
// in as your own invited Google account and goes through Firestore's REST API, so firestore.rules apply exactly as
// in the app (your planner, and the others' Today read only). Whatever it writes reaches every open Haru through
// the usual sync, stamped newer than what they hold.
//
//   node mcp/haru-mcp.mjs login     sign in once in the browser (keeps a refresh token in ~/.config/haru-mcp)
//   node mcp/haru-mcp.mjs whoami    which account it uses
//   node mcp/haru-mcp.mjs logout    forget it
//   node mcp/haru-mcp.mjs           run the server (what Claude starts; see README → Claude)
//
// The Firebase web config comes from haru/.env.local (VITE_FIREBASE_*, as the app's build reads it) or the same
// names in the environment. Node 18+, no dependencies.
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';

const VERSION = '1.0.0';
const SITE = process.env.HARU_SITE ?? 'https://ilfpns.github.io/WinBar/';
const CREDENTIALS = process.env.HARU_MCP_CREDENTIALS ?? join(homedir(), '.config', 'haru-mcp', 'credentials.json');

// ---------- config

function webConfig() {
  const env = { ...process.env };
  const file = new URL('../.env.local', import.meta.url);
  if (existsSync(file)) {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const m = /^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  }
  const apiKey = env.VITE_FIREBASE_API_KEY;
  const projectId = env.VITE_FIREBASE_PROJECT_ID ?? 'haru-5e81a';
  const authDomain = env.VITE_FIREBASE_AUTH_DOMAIN ?? `${projectId}.firebaseapp.com`;
  if (!apiKey) throw new Error('No Firebase web config: put VITE_FIREBASE_API_KEY (and the others) in haru/.env.local');
  return { apiKey, projectId, authDomain };
}

// ---------- sign-in

function readCredentials() {
  try {
    const c = JSON.parse(readFileSync(CREDENTIALS, 'utf8'));
    return c && typeof c.refreshToken === 'string' ? c : null;
  } catch {
    return null;
  }
}

function saveCredentials(c) {
  mkdirSync(dirname(CREDENTIALS), { recursive: true });
  writeFileSync(CREDENTIALS, JSON.stringify(c, null, 2));
  chmodSync(CREDENTIALS, 0o600);
}

let token = null; // { id, uid, expires }

/** A fresh Firebase ID token for the signed-in account (refreshed a minute before it runs out). */
async function idToken() {
  if (token && Date.now() < token.expires - 60_000) return token;
  const creds = readCredentials();
  if (!creds) throw new UserError('Not signed in: run `node haru/mcp/haru-mcp.mjs login` once');
  const { apiKey } = webConfig();
  const res = await fetch(`https://securetoken.googleapis.com/v1/token?key=${apiKey}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: creds.refreshToken }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new UserError(`Sign-in expired (${data.error?.message ?? res.status}): run \`node haru/mcp/haru-mcp.mjs login\` again`);
  if (data.refresh_token && data.refresh_token !== creds.refreshToken) saveCredentials({ ...creds, refreshToken: data.refresh_token });
  token = { id: data.id_token, uid: data.user_id, email: creds.email, expires: Date.now() + Number(data.expires_in) * 1000 };
  return token;
}

const LOGIN_PAGE = (cfg, nonce) => `<!doctype html>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Haru for Claude</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #000; color: #e8e8e8;
    font: 15px/1.5 system-ui, sans-serif; }
  main { padding: 28px 32px; border-radius: 18px; background: rgba(255,255,255,.06); text-align: center; max-width: 340px; }
  button { margin-top: 14px; padding: 10px 18px; border: 0; border-radius: 999px; background: #e8e8e8; color: #000;
    font: inherit; cursor: pointer; }
  p { color: #9a9a9a; margin: 8px 0 0; }
</style>
<main><strong>Haru for Claude</strong><p id="msg">Sign in with your Haru account.</p>
<button id="go" type="button">Sign in with Google</button></main>
<script type="module">
  import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';
  import { getAuth, GoogleAuthProvider, signInWithPopup } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';
  const auth = getAuth(initializeApp(${JSON.stringify(cfg)}));
  const msg = document.getElementById('msg');
  const go = document.getElementById('go');
  go.onclick = async () => {
    try {
      const { user } = await signInWithPopup(auth, new GoogleAuthProvider());
      const res = await fetch('/done', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ nonce: ${JSON.stringify(nonce)}, uid: user.uid, email: user.email, refreshToken: user.refreshToken }) });
      msg.textContent = await res.text();
      if (res.ok) go.remove();
    } catch (e) {
      msg.textContent = e.code === 'auth/popup-closed-by-user' ? 'Sign-in was closed. Try again.' : String(e.message ?? e);
    }
  };
</script>`;

async function login() {
  const cfg = webConfig();
  const nonce = randomBytes(16).toString('hex');
  await new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      if (req.method === 'GET' && req.url === '/') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(LOGIN_PAGE(cfg, nonce));
        return;
      }
      if (req.method !== 'POST' || req.url !== '/done') return void res.writeHead(404).end();
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', async () => {
        let got;
        try {
          got = JSON.parse(body);
        } catch {
          return void res.writeHead(400).end('Bad request');
        }
        if (got.nonce !== nonce || typeof got.refreshToken !== 'string') return void res.writeHead(403).end('Bad request');
        saveCredentials({ uid: got.uid, email: got.email, refreshToken: got.refreshToken });
        token = null;
        try {
          // an account that isn't invited can't read the profiles (firestore.rules)
          await firestore.get(`profiles/${got.uid}`);
        } catch (e) {
          rmSync(CREDENTIALS, { force: true });
          res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' }).end(`${got.email} is not invited to Haru.`);
          server.close();
          return reject(new Error(`${got.email} is not invited to Haru (${e.message})`));
        }
        res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }).end(`Signed in as ${got.email}. You can close this tab.`);
        server.close();
        console.log(`Signed in as ${got.email}. Saved in ${CREDENTIALS}`);
        resolve();
      });
    });
    // "localhost" is one of Firebase Auth's authorized domains by default; 127.0.0.1 is not
    server.listen(0, '127.0.0.1', () => {
      const url = `http://localhost:${server.address().port}/`;
      console.log(`Opening ${url} — sign in there with your Haru Google account.`);
      const [cmd, args] = process.platform === 'darwin' ? ['open', [url]]
        : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]];
      execFile(cmd, args, () => {});
    });
  });
}

// ---------- Firestore (REST)

/** A JS value as a Firestore Value; undefined fields are left out, like the app's JSON round trip. */
function encode(v) {
  if (v === null) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.filter((x) => x !== undefined).map(encode) } };
  return { mapValue: { fields: encodeFields(v) } };
}
const encodeFields = (o) => Object.fromEntries(Object.entries(o).filter(([, x]) => x !== undefined).map(([k, x]) => [k, encode(x)]));

function decode(v) {
  if ('nullValue' in v) return null;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('stringValue' in v) return v.stringValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (v.arrayValue.values ?? []).map(decode);
  if ('mapValue' in v) return decodeFields(v.mapValue.fields ?? {});
  return null;
}
const decodeFields = (f) => Object.fromEntries(Object.entries(f).map(([k, x]) => [k, decode(x)]));

const firestore = {
  async call(method, path, { body, query } = {}) {
    const { projectId } = webConfig();
    const t = await idToken();
    const url = new URL(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${path}`);
    for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, v);
    const res = await fetch(url, {
      method,
      headers: { authorization: `Bearer ${t.id}`, 'content-type': 'application/json' },
      body: body && JSON.stringify(body),
    });
    if (res.status === 404 && method === 'GET') return null;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(`Firestore ${method} ${path}: ${data.error?.status ?? res.status} ${data.error?.message ?? ''}`.trim());
      err.status = data.error?.status;
      throw err;
    }
    return data;
  },
  /** A document as { data, updateTime }, or null when there is none. */
  async get(path) {
    const d = await this.call('GET', path);
    return d && { data: decodeFields(d.fields ?? {}), updateTime: d.updateTime };
  },
  /** Every document of a collection, as data. */
  async list(path) {
    const out = [];
    let pageToken = '';
    do {
      const d = await this.call('GET', path, { query: { pageSize: '300', ...(pageToken && { pageToken }) } });
      for (const doc of d?.documents ?? []) out.push({ id: doc.name.split('/').pop(), data: decodeFields(doc.fields ?? {}) });
      pageToken = d?.nextPageToken ?? '';
    } while (pageToken);
    return out;
  },
  /** Writes the whole document; `prev` (from get) makes it fail if someone changed it in between. */
  set(path, data, prev) {
    const query = prev === undefined ? {} : prev ? { 'currentDocument.updateTime': prev.updateTime } : { 'currentDocument.exists': 'false' };
    return this.call('PATCH', path, { body: { fields: encodeFields(data) }, query });
  },
  delete(path) {
    return this.call('DELETE', path);
  },
};

// ---------- the change log (logs/{uid}/entries, append-only; the app's side is src/cloud/log.ts)

const LOG_MAX = 300_000;
const logText = (v) => {
  const s = JSON.stringify(v) ?? 'null';
  return s.length > LOG_MAX ? `${s.slice(0, LOG_MAX)}…(cut, ${s.length} chars)` : s;
};

/** Logs what Claude changed, as the app logs its own changes (device "Claude-MCP"); a failed log never fails the change. */
async function logWrite(path, before, after) {
  const m = /^users\/([^/]+)\/(.+)$/.exec(path);
  if (!m) return;
  const [, uid, rest] = m;
  const [kind, field, key] = rest === 'state/timetable' ? ['today', 'blocks', '']
    : rest === 'meta/plans' ? ['plans', 'list', '']
    : rest.startsWith('notes/') ? ['memo', 'text', rest.slice(6)]
    : rest.startsWith('lists/') ? ['list', 'items', rest.slice(6)]
    : [rest, null, ''];
  const pick = (d) => (d === undefined ? undefined : field ? d?.[field] : d);
  const entry = { at: Date.now(), device: 'Claude-MCP', kind, key, action: after === undefined ? 'delete' : 'edit' };
  if (pick(before) !== undefined) entry.before = logText(pick(before));
  if (pick(after) !== undefined) entry.after = logText(pick(after));
  await firestore.call('POST', `logs/${uid}/entries`, { body: { fields: encodeFields(entry) } }).catch(() => {});
}

/** Read, change and write one document, again from the top if another device wrote it meanwhile. */
async function update(path, change) {
  for (let i = 0; ; i++) {
    const prev = await firestore.get(path);
    const { data, result } = change(prev?.data);
    try {
      await firestore.set(path, data, prev);
      await logWrite(path, prev?.data, data);
      return result;
    } catch (e) {
      if (e.status !== 'FAILED_PRECONDITION' || i >= 4) throw e;
    }
  }
}

// ---------- the planner

const CATEGORIES = ['work', 'study', 'school', 'meeting', 'meal', 'health', 'personal', 'sleep', 'etc'];
const DAY = 1440;
const mod = (m) => ((m % DAY) + DAY) % DAY;
const hhmm = (m) => `${String(Math.floor(mod(m) / 60)).padStart(2, '0')}:${String(mod(m) % 60).padStart(2, '0')}`;
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const localDate = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

class UserError extends Error {}
const fail = (msg) => {
  throw new UserError(msg);
};

function minutes(s, what) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s ?? '').trim());
  if (!m || +m[1] > 24 || +m[2] > 59 || (+m[1] === 24 && +m[2] > 0)) fail(`${what} must be HH:MM (24h), got ${JSON.stringify(s)}`);
  return mod(+m[1] * 60 + +m[2]);
}
const date = (s, what = 'date') => (DATE.test(String(s ?? '')) ? s : fail(`${what} must be YYYY-MM-DD, got ${JSON.stringify(s)}`));

/** start/end (or duration) from a tool's arguments; an end before the start runs past midnight. */
function span(t, base) {
  const start = t.start !== undefined ? minutes(t.start, 'start') : base?.start;
  if (start === undefined) fail('start is required');
  let dur = base?.dur;
  if (t.end !== undefined) dur = mod(minutes(t.end, 'end') - start) || DAY;
  else if (t.duration !== undefined) dur = Math.round(Number(t.duration));
  if (!(dur > 0 && dur <= DAY)) fail('give an end time or a duration (1–1440 minutes)');
  return { start, dur };
}

function category(c, fallback = 'etc') {
  if (c === undefined) return fallback;
  return CATEGORIES.includes(c) ? c : fail(`cat must be one of ${CATEGORIES.join(', ')}`);
}

const clash = (blocks, b) =>
  blocks.find((x) => x.id !== b.id && (mod(b.start - x.start) < x.dur || mod(x.start - b.start) < b.dur));

function checkFree(blocks, b) {
  const x = clash(blocks, b);
  if (x) fail(`"${b.title}" ${hhmm(b.start)}–${hhmm(b.start + b.dur)} overlaps "${x.title}" ${hhmm(x.start)}–${hhmm(x.start + x.dur)} (id ${x.id}); tasks on a day can't overlap`);
}

const statusOf = (b) => (b.done ? 'done' : b.doing ? 'doing' : 'yet');
/** A task as the app keeps it: the `doing` and `note` keys only when set (Firestore takes no undefined). */
function stored(b) {
  const out = { id: b.id, title: b.title, cat: b.cat, start: b.start, dur: b.dur, done: b.done === true };
  if (b.doing && !b.done) out.doing = true;
  if (b.note) out.note = b.note;
  return out;
}
const shown = (b) => ({
  ...(b.id && { id: b.id }),
  start: hhmm(b.start),
  end: hhmm(b.start + b.dur),
  minutes: b.dur,
  title: b.title,
  cat: b.cat,
  ...(b.done !== undefined && { status: statusOf(b) }),
  ...(b.note && { note: b.note }),
});
const byStart = (a, b) => a.start - b.start;

function progress(blocks) {
  const sum = (bs) => bs.reduce((m, b) => m + b.dur, 0);
  const done = sum(blocks.filter((b) => b.done));
  return { planned: `${sum(blocks)} min`, done: `${done} min`, dayDone: `${Math.round((done / DAY) * 100)}%` };
}

async function members() {
  return (await firestore.list('profiles')).map(({ id, data }) => ({ uid: data.uid ?? id, name: data.name ?? '', email: data.email ?? '' }));
}

async function memberUid(who) {
  const t = await idToken();
  if (!who) return t.uid;
  const q = String(who).toLowerCase();
  const all = await members();
  const m = all.find((p) => p.email.toLowerCase() === q || p.uid === who) ?? all.find((p) => p.name.toLowerCase().includes(q));
  return m ? m.uid : fail(`No member matches ${JSON.stringify(who)}; haru_members lists them`);
}

const todayPath = (uid) => `users/${uid}/state/timetable`;
const cleanBlocks = (list) => (Array.isArray(list) ? list : []).filter((b) => b && typeof b.start === 'number' && typeof b.dur === 'number');

/** Changes my Today: `change(blocks)` returns the new list and what to report. */
async function editToday(change) {
  const { uid } = await idToken();
  return update(todayPath(uid), (cur) => {
    const { blocks, result } = change(cleanBlocks(cur?.blocks));
    return { data: { blocks: blocks.sort(byStart).map(stored), updated: Date.now() }, result };
  });
}

const now = () => ({ now: `${localDate()} ${hhmm(new Date().getHours() * 60 + new Date().getMinutes())}` });

let calendarCache = null;
async function calendarEvents() {
  if (calendarCache && Date.now() - calendarCache.at < 3_600_000) return calendarCache.events;
  const res = await fetch(new URL('data/calendar.json', SITE));
  if (!res.ok) throw new Error(`calendar.json: ${res.status}`);
  const { events = [] } = await res.json();
  calendarCache = { at: Date.now(), events };
  return events;
}

function range(a) {
  const from = date(a.from ?? localDate(), 'from');
  const to = date(a.to ?? from, 'to');
  return to < from ? fail('to is before from') : { from, to };
}

// ---------- tools

const TIME = { type: 'string', description: 'HH:MM, 24h (local time)' };
const DATE_ARG = { type: 'string', description: 'YYYY-MM-DD' };
const CAT = { type: 'string', enum: CATEGORIES, description: 'Category (default etc)' };
const TASK = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    cat: CAT,
    start: TIME,
    end: { ...TIME, description: 'HH:MM end; earlier than start means it runs past midnight' },
    duration: { type: 'number', description: 'Minutes, instead of end' },
  },
  required: ['title', 'start'],
};

const tools = [
  {
    name: 'haru_today',
    description: "Today's tasks on the Haru dial (start–end, status yet/doing/done, note) and the day's progress. Give `member` (email or name) to look at another member's Today, read only.",
    inputSchema: { type: 'object', properties: { member: { type: 'string' } } },
    async run(a) {
      const uid = await memberUid(a.member);
      const doc = await firestore.get(todayPath(uid));
      const blocks = cleanBlocks(doc?.data.blocks).sort(byStart);
      return { ...now(), tasks: blocks.map(shown), progress: progress(blocks) };
    },
  },
  {
    name: 'haru_add_tasks',
    description: "Adds tasks to my Today. Tasks can't overlap each other or existing ones (nothing is added if any would). The dial works in 15-minute steps; use those unless other times are asked for.",
    inputSchema: {
      type: 'object',
      properties: { tasks: { type: 'array', items: { ...TASK, properties: { ...TASK.properties, note: { type: 'string' } } } } },
      required: ['tasks'],
    },
    run: (a) => editToday((blocks) => {
      if (!Array.isArray(a.tasks) || !a.tasks.length) fail('tasks is empty');
      const added = a.tasks.map((t) => ({ id: newId(), title: String(t.title ?? '').trim(), cat: category(t.cat), ...span(t), done: false, note: t.note ? String(t.note) : undefined }));
      const all = [...blocks];
      for (const b of added) {
        checkFree(all, b);
        all.push(b);
      }
      return { blocks: all, result: { added: added.map(shown) } };
    }),
  },
  {
    name: 'haru_update_task',
    description: 'Changes one of my Today tasks by id (from haru_today): title, cat, times, status (yet | doing | done) or note (empty string removes it).',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        title: { type: 'string' },
        cat: CAT,
        start: TIME,
        end: TIME,
        duration: { type: 'number' },
        status: { type: 'string', enum: ['yet', 'doing', 'done'] },
        note: { type: 'string' },
      },
      required: ['id'],
    },
    run: (a) => editToday((blocks) => {
      const old = blocks.find((b) => b.id === a.id) ?? fail(`No task with id ${a.id} on Today`);
      const b = { ...old, ...span(a, old), cat: category(a.cat, old.cat) };
      if (a.title !== undefined) b.title = String(a.title).trim();
      if (a.note !== undefined) b.note = String(a.note);
      if (a.status !== undefined) {
        if (!['yet', 'doing', 'done'].includes(a.status)) fail('status must be yet, doing or done');
        b.done = a.status === 'done';
        b.doing = a.status === 'doing';
      }
      checkFree(blocks, b);
      return { blocks: blocks.map((x) => (x.id === b.id ? b : x)), result: { updated: shown(b) } };
    }),
  },
  {
    name: 'haru_remove_tasks',
    description: 'Removes tasks from my Today by id.',
    inputSchema: { type: 'object', properties: { ids: { type: 'array', items: { type: 'string' } } }, required: ['ids'] },
    run: (a) => editToday((blocks) => {
      const ids = new Set(a.ids ?? []);
      const gone = blocks.filter((b) => ids.has(b.id));
      if (!gone.length) fail('None of those ids are on Today');
      return { blocks: blocks.filter((b) => !ids.has(b.id)), result: { removed: gone.map(shown) } };
    }),
  },
  {
    name: 'haru_past_day',
    description: 'A past day as it was kept in the calendar (its tasks and how far they got). Give `member` for another member.',
    inputSchema: { type: 'object', properties: { date: DATE_ARG, member: { type: 'string' } }, required: ['date'] },
    async run(a) {
      const uid = await memberUid(a.member);
      const doc = await firestore.get(`users/${uid}/days/${date(a.date)}`);
      if (!doc) return { date: a.date, kept: false, note: 'No snapshot for this day (Haru carries the last one before it over)' };
      const blocks = cleanBlocks(doc.data.blocks).sort(byStart);
      return { date: a.date, kept: true, tasks: blocks.map(shown), progress: progress(blocks) };
    },
  },
  {
    name: 'haru_plans',
    description: 'Days planned ahead (Calendar → Week) between from and to (default: from today on). A plan becomes Today when its day begins.',
    inputSchema: { type: 'object', properties: { from: DATE_ARG, to: DATE_ARG } },
    async run(a) {
      const { uid } = await idToken();
      const from = a.from ? date(a.from, 'from') : localDate();
      const to = a.to ? date(a.to, 'to') : '9999-12-31';
      const doc = await firestore.get(`users/${uid}/meta/plans`);
      const list = (doc?.data.list ?? []).filter((p) => p.date >= from && p.date <= to);
      return { plans: list.map((p) => ({ date: p.date, from: p.from, tasks: cleanBlocks(p.blocks).sort(byStart).map(shown) })) };
    },
  },
  {
    name: 'haru_set_plan',
    description: "Lays out a future day (replacing its plan, if any). It becomes that day's Today when the day begins. Tasks can't overlap.",
    inputSchema: {
      type: 'object',
      properties: { date: DATE_ARG, tasks: { type: 'array', items: { ...TASK, properties: { ...TASK.properties, note: { type: 'string' } } } }, from: { type: 'string', description: 'Shown under the day (default "Claude")' } },
      required: ['date', 'tasks'],
    },
    async run(a) {
      const { uid } = await idToken();
      const day = date(a.date);
      if (day <= localDate()) fail('Plans are for days ahead; change Today with the task tools instead');
      const blocks = [];
      for (const t of a.tasks ?? []) {
        const b = { title: String(t.title ?? '').trim(), cat: category(t.cat), ...span(t) };
        if (String(t.note ?? '').trim()) b.note = String(t.note);
        checkFree(blocks, b);
        blocks.push(b);
      }
      blocks.sort(byStart);
      return update(`users/${uid}/meta/plans`, (cur) => {
        const list = (cur?.list ?? []).filter((p) => p.date !== day);
        list.push({ date: day, blocks, from: a.from ? String(a.from) : 'Claude', saved: Date.now() });
        list.sort((x, y) => x.date.localeCompare(y.date));
        return { data: { list, updated: Date.now() }, result: { planned: day, tasks: blocks.map(shown) } };
      });
    },
  },
  {
    name: 'haru_clear_plan',
    description: "Removes a future day's plan.",
    inputSchema: { type: 'object', properties: { date: DATE_ARG }, required: ['date'] },
    async run(a) {
      const { uid } = await idToken();
      const day = date(a.date);
      return update(`users/${uid}/meta/plans`, (cur) => {
        const list = cur?.list ?? [];
        if (!list.some((p) => p.date === day)) fail(`No plan on ${day}`);
        return { data: { list: list.filter((p) => p.date !== day), updated: Date.now() }, result: { cleared: day } };
      });
    },
  },
  {
    name: 'haru_calendar',
    description: 'The calendar between from and to (default today): Korean holidays and observances, the school calendar, and my memos for each day.',
    inputSchema: { type: 'object', properties: { from: DATE_ARG, to: DATE_ARG } },
    async run(a) {
      const { uid } = await idToken();
      const { from, to } = range(a);
      const [events, notes] = await Promise.all([
        calendarEvents().catch(() => []),
        firestore.list(`users/${uid}/notes`),
      ]);
      const days = new Map();
      const at = (d) => days.get(d) ?? days.set(d, { date: d }).get(d);
      for (const e of events) if (e.date >= from && e.date <= to) (at(e.date).events ??= []).push({ title: e.title, kind: e.kind });
      for (const { data } of notes) if (data.date >= from && data.date <= to && data.text) at(data.date).memo = data.text;
      return { from, to, days: [...days.values()].sort((x, y) => x.date.localeCompare(y.date)) };
    },
  },
  {
    name: 'haru_set_memo',
    description: "Writes a day's calendar memo (replacing it; an empty text removes it). Memos are Markdown. (A `! 12:00~12:30 work Title` line only moves to Today when typed in the app; to put a task on a day use haru_add_tasks or haru_set_plan.)",
    inputSchema: { type: 'object', properties: { date: DATE_ARG, text: { type: 'string' } }, required: ['date', 'text'] },
    async run(a) {
      const { uid } = await idToken();
      const day = date(a.date);
      const text = String(a.text ?? '');
      const path = `users/${uid}/notes/${day}`;
      const prev = await firestore.get(path);
      if (!text.trim()) {
        await firestore.delete(path);
        await logWrite(path, prev?.data, undefined);
        return { removed: day };
      }
      const data = { date: day, text, updated: Date.now() };
      await firestore.set(path, data);
      await logWrite(path, prev?.data, data);
      return { saved: day };
    },
  },
  {
    name: 'haru_journal',
    description: 'My Journal pages, newest first: id, date, title, folder and the start of the text. `query` searches titles and text.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'number', description: 'Default 30' } } },
    async run(a) {
      const { uid } = await idToken();
      const [pages, folders] = await Promise.all([firestore.get(`users/${uid}/lists/journal`), firestore.get(`users/${uid}/lists/journal-folders`)]);
      const names = new Map((folders?.data.items ?? []).map((f) => [f.id, f.name]));
      const q = String(a.query ?? '').toLowerCase();
      const list = (pages?.data.items ?? [])
        .filter((e) => !q || `${e.title}\n${e.body}`.toLowerCase().includes(q))
        .sort((x, y) => y.date.localeCompare(x.date) || y.updated - x.updated)
        .slice(0, Number(a.limit) || 30);
      return {
        pages: list.map((e) => ({ id: e.id, date: e.date, title: e.title, folder: names.get(e.folder) ?? '/', ...(e.pinned && { pinned: true }), start: e.body.slice(0, 160) })),
      };
    },
  },
  {
    name: 'haru_journal_read',
    description: 'One Journal page in full (Markdown).',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    async run(a) {
      const { uid } = await idToken();
      const doc = await firestore.get(`users/${uid}/lists/journal`);
      const e = (doc?.data.items ?? []).find((x) => x.id === a.id) ?? fail(`No Journal page with id ${a.id}`);
      return { id: e.id, date: e.date, title: e.title, body: e.body };
    },
  },
  {
    name: 'haru_journal_write',
    description: 'Writes a Journal page: without `id` a new page at the top level, with `id` it changes that page (only the fields given). Body is Markdown.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' }, date: DATE_ARG, title: { type: 'string' }, body: { type: 'string' } },
    },
    async run(a) {
      const { uid } = await idToken();
      return update(`users/${uid}/lists/journal`, (cur) => {
        const items = [...(cur?.items ?? [])];
        const t = Date.now();
        let page;
        if (a.id) {
          const i = items.findIndex((x) => x.id === a.id);
          if (i < 0) fail(`No Journal page with id ${a.id}`);
          page = { ...items[i], ...(a.date !== undefined && { date: date(a.date) }), ...(a.title !== undefined && { title: String(a.title) }), ...(a.body !== undefined && { body: String(a.body) }), updated: t };
          items[i] = page;
        } else {
          page = { id: newId(), date: a.date ? date(a.date) : localDate(), title: String(a.title ?? ''), body: String(a.body ?? ''), created: t, updated: t };
          items.unshift(page);
        }
        // the app keeps the whole journal in one document (at most 1 MB)
        if (JSON.stringify(items).length > 900_000) fail('The journal is full (one Firestore document holds 1 MB)');
        return { data: { items, updated: t }, result: { saved: { id: page.id, date: page.date, title: page.title } } };
      });
    },
  },
  {
    name: 'haru_log',
    description: "The change log, for getting lost data back (the app never shows it): every change to your Haru, newest first, with what it was before and after — made by hand, by Haru itself (a new day, the school's lessons), by Claude, or arriving from another device over what was there. kind: today, day (a past day's record, key = date), memo (key = date), plans, templates, list (key = words, journal, journal-folders, checkins), image, backup. action: edit, auto (Haru's own change), save, delete, add, from-cloud (another device's copy replaced this one: `before` is what was replaced), auto-dropped, import. `device` names the browser (system + id) or Claude-MCP. To restore, put the `before` back with the usual tools (haru_add_tasks, haru_set_memo, haru_set_plan…).",
    inputSchema: {
      type: 'object',
      properties: {
        from: DATE_ARG,
        to: DATE_ARG,
        kind: { type: 'string' },
        key: { type: 'string', description: 'A date (day, memo) or a list name' },
        limit: { type: 'number', description: 'Default 30, at most 300' },
      },
    },
    async run(a) {
      const { uid } = await idToken();
      const startOf = (d) => new Date(`${d}T00:00`).getTime();
      const filters = [];
      const at = (op, v) => filters.push({ fieldFilter: { field: { fieldPath: 'at' }, op, value: encode(v) } });
      if (a.from) at('GREATER_THAN_OR_EQUAL', startOf(date(a.from, 'from')));
      if (a.to) at('LESS_THAN', startOf(date(a.to, 'to')) + 86_400_000);
      const limit = Math.min(300, Math.max(1, Math.round(Number(a.limit) || 30)));
      const narrowed = a.kind !== undefined || a.key !== undefined;
      const res = await firestore.call('POST', `logs/${uid}:runQuery`, {
        body: {
          structuredQuery: {
            from: [{ collectionId: 'entries' }],
            ...(filters.length && { where: filters.length === 1 ? filters[0] : { compositeFilter: { op: 'AND', filters } } }),
            orderBy: [{ field: { fieldPath: 'at' }, direction: 'DESCENDING' }],
            // kind and key are matched here (no composite index needed): look further back for them
            limit: narrowed ? 2000 : limit,
          },
        },
      });
      const parse = (s) => {
        if (s === undefined) return undefined;
        try {
          return JSON.parse(s);
        } catch {
          return s;
        }
      };
      const entries = (Array.isArray(res) ? res : [])
        .filter((r) => r.document)
        .map((r) => decodeFields(r.document.fields ?? {}))
        .filter((e) => (a.kind === undefined || e.kind === a.kind) && (a.key === undefined || e.key === a.key))
        .slice(0, limit)
        .map((e) => ({
          time: new Date(e.at).toLocaleString('sv-SE'),
          device: e.device,
          kind: e.kind,
          ...(e.key && { key: e.key }),
          action: e.action,
          ...(e.before !== undefined && { before: parse(e.before) }),
          ...(e.after !== undefined && { after: parse(e.after) }),
        }));
      return { count: entries.length, entries };
    },
  },
  {
    name: 'haru_members',
    description: "Who is in Haru (name, email) — for looking at someone's Today.",
    inputSchema: { type: 'object', properties: {} },
    run: async () => ({ members: (await members()).map(({ name, email }) => ({ name, email })) }),
  },
];

// ---------- MCP over stdio (newline-delimited JSON-RPC)

const PROTOCOLS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const INSTRUCTIONS = `Haru is the user's day planner: Today is a 24-hour dial of tasks (each with a start, an end and a status), with days planned ahead, a calendar of holidays, the school calendar and day memos, and a Journal. Times are the user's local time. Tasks on one day never overlap. Look before you change: read haru_today or haru_plans first, and say what you changed.`;

const send = (msg) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...msg })}\n`);

async function handle(msg) {
  const { id, method, params } = msg;
  if (id === undefined) return; // notifications (initialized, cancelled) need no answer
  try {
    if (method === 'initialize') {
      const asked = params?.protocolVersion;
      return send({
        id,
        result: {
          protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0],
          capabilities: { tools: {} },
          serverInfo: { name: 'haru', version: VERSION },
          instructions: INSTRUCTIONS,
        },
      });
    }
    if (method === 'ping') return send({ id, result: {} });
    if (method === 'tools/list') return send({ id, result: { tools: tools.map(({ run: _, ...t }) => t) } });
    if (method === 'tools/call') {
      const tool = tools.find((t) => t.name === params?.name);
      if (!tool) return send({ id, error: { code: -32602, message: `Unknown tool ${params?.name}` } });
      try {
        const out = await tool.run(params.arguments ?? {});
        return send({ id, result: { content: [{ type: 'text', text: JSON.stringify(out, null, 1) }] } });
      } catch (e) {
        if (!(e instanceof UserError)) console.error(e);
        return send({ id, result: { content: [{ type: 'text', text: e.message }], isError: true } });
      }
    }
    send({ id, error: { code: -32601, message: `Method not found: ${method}` } });
  } catch (e) {
    send({ id, error: { code: -32603, message: e.message } });
  }
}

function serve() {
  const rl = createInterface({ input: process.stdin });
  rl.on('line', (line) => {
    if (!line.trim()) return;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return send({ id: null, error: { code: -32700, message: 'Parse error' } });
    }
    for (const m of Array.isArray(msg) ? msg : [msg]) void handle(m);
  });
}

const cmd = process.argv[2];
if (cmd === 'login') {
  login().then(() => process.exit(0), (e) => {
    console.error(e.message);
    process.exit(1);
  });
} else if (cmd === 'logout') {
  rmSync(CREDENTIALS, { force: true });
  console.log('Signed out.');
} else if (cmd === 'whoami') {
  idToken().then((t) => console.log(`${t.email} (${t.uid})`), (e) => {
    console.error(e.message);
    process.exit(1);
  });
} else if (cmd) {
  console.error('Usage: node mcp/haru-mcp.mjs [login | whoami | logout]');
  process.exit(1);
} else serve();
