import { kvGet, kvSet } from '../storage/db';

/**
 * The Library's tokens (GitHub, Notion, the memo repo), kept encrypted in this browser. The key is an AES-GCM key
 * made here as non-extractable and kept in IndexedDB: the page can use it, but nothing — not devtools, not a copy
 * of the storage, not an extension reading localStorage — can read it out, so what sits in localStorage
 * (`haru:library-keys`) is ciphertext only. Tokens are decrypted into memory once (`unlockSecrets`) and only ever
 * go to the API they belong to; never into the code, the repo, the cloud sync or a backup.
 *
 * (A token can't go in the build's env instead: the site is public, and everything built into it can be read.)
 */
const STORE = 'haru:library-keys';
const KEY_ID = 'library:secret-key';
const PREFIX = 'v1:';

let plain: Record<string, string> = {};
let key: CryptoKey | null = null;
let ready: Promise<void> | null = null;

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

function stored(): Record<string, string> {
  try {
    const v = JSON.parse(localStorage.getItem(STORE) ?? '{}') as unknown;
    return v && typeof v === 'object' ? (v as Record<string, string>) : {};
  } catch {
    return {};
  }
}
function store(v: Record<string, string>): void {
  try {
    localStorage.setItem(STORE, JSON.stringify(v));
  } catch {
    // this visit only
  }
}

async function theKey(): Promise<CryptoKey | null> {
  if (key) return key;
  try {
    key = (await kvGet<CryptoKey>(KEY_ID)) ?? null;
    if (!key) {
      key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
      await kvSet(KEY_ID, key);
    }
  } catch {
    key = null;
  }
  return key;
}

async function seal(text: string): Promise<string | null> {
  const k = await theKey();
  if (!k) return null;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, new TextEncoder().encode(text)));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv);
  out.set(ct, iv.length);
  return PREFIX + b64(out);
}
async function open(sealed: string): Promise<string | null> {
  const k = await theKey();
  if (!k || !sealed.startsWith(PREFIX)) return null;
  try {
    const all = unb64(sealed.slice(PREFIX.length));
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: all.slice(0, 12) }, k, all.slice(12));
    return new TextDecoder().decode(pt);
  } catch {
    return null;
  }
}

/** Decrypts the tokens into memory; tokens kept in the clear before this (older Haru) are sealed on the way. */
export function unlockSecrets(): Promise<void> {
  ready ??= (async () => {
    const raw = stored();
    const out: Record<string, string> = {};
    let changed = false;
    for (const [id, v] of Object.entries(raw)) {
      if (typeof v !== 'string' || !v) continue;
      if (v.startsWith(PREFIX)) {
        const t = await open(v);
        if (t !== null) out[id] = t;
      } else {
        out[id] = v;
        const s = await seal(v);
        if (s) {
          raw[id] = s;
          changed = true;
        }
      }
    }
    if (changed) store(raw);
    plain = out;
  })();
  return ready;
}

/** A token, once unlocked ('' when there is none). */
export const secret = (id: string): string => plain[id] ?? '';
/** Whether a token is kept for `id` (without showing it). */
export const hasSecret = (id: string): boolean => !!plain[id];

/** Keeps (or, empty, forgets) a token: in memory at once, sealed into storage right after. */
export function setSecret(id: string, token: string): void {
  if (token) plain[id] = token;
  else delete plain[id];
  void (async () => {
    const raw = stored();
    if (!token) delete raw[id];
    else {
      const s = await seal(token);
      // no key to seal with (storage blocked): kept for this visit only, never written in the clear
      if (!s) return;
      raw[id] = s;
    }
    store(raw);
  })();
}
