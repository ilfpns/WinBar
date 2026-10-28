import { type Gone, unionGone } from '../storage/gone';

/**
 * Two copies of one list — this device's and the cloud's — brought together so that an edit on one side never
 * wipes out a different edit on the other. Each copy carries its items (stamped) and its tombstones (what it
 * deleted, and when: storage/gone.ts):
 *  - an item both hold: the copy with the newer item stamp (a tie: the cloud's);
 *  - an item one side holds: kept (it was made or changed there) — unless either side's tombstone for it is
 *    as new as the item, which says it was deleted after that change;
 *  - the tombstones: both sides', the later mark of each.
 * An item with no stamp is kept. The order is the cloud's; items only this device holds go in front (`prepend`:
 * journal pages, newest first) or at the end.
 */
export interface Merged<T> { list: T[]; gone: Gone; sameAsLocal: boolean; sameAsCloud: boolean }

export function mergeLists<T>(
  local: { items: readonly T[]; gone: Gone }, cloud: { items: readonly T[]; gone: Gone },
  key: (t: T) => string, stamp: (t: T) => number, prepend = false,
): Merged<T> {
  const gone = unionGone(local.gone ?? {}, cloud.gone ?? {});
  const alive = (t: T) => !(gone[key(t)] && stamp(t) <= gone[key(t)]!);
  const localBy = new Map(local.items.map((t) => [key(t), t]));
  const out: T[] = [];
  for (const c of cloud.items) {
    const l = localBy.get(key(c));
    localBy.delete(key(c));
    const pick = l !== undefined && stamp(l) > stamp(c) ? l : c;
    if (alive(pick)) out.push(pick);
  }
  const extra = [...localBy.values()].filter(alive);
  const list = prepend ? [...extra, ...out] : [...out, ...extra];
  const sameList = (x: readonly T[]) => x.length === list.length && x.every((t, i) => JSON.stringify(t) === JSON.stringify(list[i]));
  const sameGone = (g: Gone) => JSON.stringify(Object.entries(g ?? {}).sort()) === JSON.stringify(Object.entries(gone).sort());
  return { list, gone, sameAsLocal: sameList(local.items) && sameGone(local.gone), sameAsCloud: sameList(cloud.items) && sameGone(cloud.gone) };
}
