/**
 * What a list has deleted, by key and when (a tombstone): kept with the list and sent with it, so two copies of
 * the list can be merged (cloud/merge.ts) without a deletion on one side being undone by the other side's
 * older copy, and without an edit on one side being lost to a deletion of something else on the other.
 * Tombstones older than KEEP_DAYS are dropped: a copy that old is merged by stamps alone.
 */
export type Gone = Record<string, number>;

const KEEP_DAYS = 60;

/** `gone` with the keys that `before` had and `after` lacks marked as deleted now, old marks dropped. */
export function markGone<T>(gone: Gone, before: readonly T[], after: readonly T[], key: (t: T) => string, now = Date.now()): Gone {
  const kept = new Set(after.map(key));
  const out = pruneGone(gone, now);
  for (const t of before) if (!kept.has(key(t))) out[key(t)] = now;
  return out;
}

export function pruneGone(gone: Gone, now = Date.now()): Gone {
  const out: Gone = {};
  for (const [k, at] of Object.entries(gone ?? {})) if (typeof at === 'number' && now - at < KEEP_DAYS * 86_400_000) out[k] = at;
  return out;
}

/** Both sides' tombstones, the later mark of each. */
export function unionGone(a: Gone, b: Gone): Gone {
  const out: Gone = { ...a };
  for (const [k, at] of Object.entries(b ?? {})) if (typeof at === 'number' && (out[k] ?? 0) < at) out[k] = at;
  return out;
}

export const cleanGone = (v: unknown): Gone =>
  v && typeof v === 'object' ? Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, at]) => typeof at === 'number')) as Gone : {};
