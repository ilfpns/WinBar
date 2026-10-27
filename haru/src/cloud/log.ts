import type { Fb } from './firebase';

/**
 * The change log, for getting lost data back: read by Claude only (the MCP's haru_log; nothing in the app shows
 * it). Every change to this account's data on this device — made by hand, by Haru itself, or arriving from
 * another device over what was here — goes to `logs/{uid}/entries` with what it was before and after.
 * Append-only: the rules let no one change or delete an entry, so a later overwrite never takes the record with it.
 *
 *   { at, device, kind, key, action, before?, after? }   before/after: JSON text (cut at MAX_TEXT)
 *
 * Repeated edits of one thing within GAP are kept as one entry (the first before, the last after); an arrival
 * from another device or a dropped change is written at once.
 */
export type LogAction = 'edit' | 'auto' | 'save' | 'delete' | 'add' | 'from-cloud' | 'auto-dropped' | 'import';

const GAP = 15_000;
const MAX_TEXT = 300_000;
const IMMEDIATE: LogAction[] = ['from-cloud', 'auto-dropped', 'import'];

/** This browser, as the log names it: the system and a random id kept per browser. */
function device(): string {
  const ua = navigator.userAgent;
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'Other';
  let id = '';
  try {
    id = localStorage.getItem('haru:device') ?? '';
    if (!id) localStorage.setItem('haru:device', (id = Math.random().toString(36).slice(2, 8)));
  } catch {
    id = 'unknown';
  }
  return `${os}-${id}`;
}

const text = (v: unknown): string | undefined => {
  if (v === undefined) return undefined;
  const s = JSON.stringify(v) ?? 'null';
  return s.length > MAX_TEXT ? `${s.slice(0, MAX_TEXT)}…(cut, ${s.length} chars)` : s;
};

interface Pending { kind: string; key: string; action: LogAction; at: number; before?: unknown; after?: unknown; timer: number }

let current: ((kind: string, key: string, action: LogAction, after?: unknown, before?: unknown) => void) | null = null;

/** Logs one change for the signed-in account (nothing while signed out). */
export function logChange(kind: string, key: string, action: LogAction, after?: unknown, before?: unknown): void {
  current?.(kind, key, action, after, before);
}

/** Starts logging for one account; the returned function stops it (writing what is still held). */
export function startLog(fb: Fb, uid: string): () => void {
  const { fs, db } = fb;
  const entries = fs.collection(db, `logs/${uid}/entries`);
  const name = device();
  const pending = new Map<string, Pending>();

  const send = (p: Omit<Pending, 'timer'>) => {
    const entry: Record<string, unknown> = { at: p.at, device: name, kind: p.kind, key: p.key, action: p.action };
    const before = text(p.before);
    const after = text(p.after);
    if (before !== undefined) entry.before = before;
    if (after !== undefined) entry.after = after;
    // the log never gets in the way: a refused or failed write (rules not published yet) is dropped quietly
    void fs.addDoc(entries, entry).catch(() => {});
  };
  const flush = (id: string) => {
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    clearTimeout(p.timer);
    send(p);
  };
  const flushAll = () => [...pending.keys()].forEach(flush);

  current = (kind, key, action, after, before) => {
    const at = Date.now();
    if (IMMEDIATE.includes(action)) {
      send({ kind, key, action, at, before, after });
      return;
    }
    const id = `${kind}|${key}|${action}`;
    const p = pending.get(id);
    if (p) {
      p.after = after;
      return;
    }
    pending.set(id, { kind, key, action, at, before, after, timer: window.setTimeout(() => flush(id), GAP) });
  };
  addEventListener('pagehide', flushAll);
  return () => {
    flushAll();
    removeEventListener('pagehide', flushAll);
    current = null;
  };
}
