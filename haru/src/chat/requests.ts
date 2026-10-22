import type { Session } from '../cloud/session';

/**
 * Change requests: anyone in the chat writes "/변경요청 …" (a command, so "/"; "@" calls a person) to ask for a change to Haru. The message goes to the
 * chat as usual and, as a request, into a queue in Firestore (`change-requests/{chat message id}`; all
 * invited accounts may add to it, each as themselves). Nothing acts on it by itself: whoever develops Haru reads the queue
 * (`node scripts/change-requests.mjs list`), makes the change by hand, ships it, and records the outcome in
 * public/data/change-requests.json — which the published site shows as a line under the request.
 */
// (/변경사항 and /요청 too: people write it either way)
export const TRIGGER = /^\s*\/(변경\s*(요청|사항)|요청)|^\s*\/change\b/i;
const MAX = 2000;

export type Status = 'queued' | 'done' | 'declined';
export interface Outcome {
  status: Status;
  /** One short line: what changed, or why not. */
  summary?: string;
  /** The version it shipped in (v1.x). */
  version?: string;
}

/** Whether a message is a request this account may file. */
export const isRequest = (text: string, s: Session | null): boolean => !!s && TRIGGER.test(text);

/** Files the request under its chat message's id. */
export async function fileRequest(s: Session, chatId: string, text: string): Promise<void> {
  const { fs, db } = s.fb;
  const words = text.replace(TRIGGER, '').trim().slice(0, MAX);
  await fs.setDoc(fs.doc(db, 'change-requests', chatId), { uid: s.uid, name: s.name, text: words || text.slice(0, MAX), at: Date.now() });
}

// ---- outcomes, as published with the site
let outcomes: Record<string, Outcome> = {};
let lastFetch = 0;
const listeners = new Set<() => void>();

export function onOutcomes(fn: () => void): void {
  listeners.add(fn);
}

/** Reads the published outcomes again (at most every 30 s unless forced). */
export async function refreshOutcomes(force = false): Promise<void> {
  if (!force && Date.now() - lastFetch < 30_000) return;
  lastFetch = Date.now();
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}data/change-requests.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return;
    const next = ((await res.json()) as { requests?: Record<string, Outcome> }).requests ?? {};
    const changed = JSON.stringify(next) !== JSON.stringify(outcomes);
    outcomes = next;
    if (changed) listeners.forEach((fn) => fn());
  } catch {
    // nothing published yet: every request reads as waiting
  }
}

const LABEL: Record<Status, string> = { queued: '변경요청 · 대기 중', done: '변경요청 · 반영됨', declined: '변경요청 · 보류' };

/** The line under a request message. */
export function outcomeLine(chatId: string): HTMLElement {
  const o = outcomes[chatId] ?? { status: 'queued' as Status };
  const el = document.createElement('div');
  el.className = `chat-cr ${o.status}`;
  el.append(Object.assign(document.createElement('span'), { className: 'chat-cr-tag', textContent: o.version ? `${LABEL[o.status]} · ${o.version}` : LABEL[o.status] }));
  if (o.summary) el.append(Object.assign(document.createElement('span'), { className: 'chat-cr-sum', textContent: o.summary }));
  return el;
}
