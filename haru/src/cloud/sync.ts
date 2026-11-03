import type { Fb } from './firebase';
import { announceAutoLost, applyRemote, changingAutomatically, setState, state, subscribe } from '../timetable/state';
import { type Block, blocksGone, blocksUpdated, isBlock, newId, setBlocksGone, stampBlocks } from '../timetable/model';
import { allTemplates, onTemplates, saveTemplate, templatesFromRemote, templatesGone, templatesUpdated } from '../timetable/templates';
import { allDays, onDaySaved, putFromRemote, type DaySnapshot } from '../timetable/history';
import { allPlans, onPlans, plansFromRemote, plansGone, plansUpdated } from '../timetable/plans';
import { type NoteRecord, notesStore, onNotesChanged } from '../calendar/notes';
import { fromDataUrl, imagesStore, onImagesChanged, toDataUrl } from '../calendar/images';
import { checkinStore } from '../calendar/attendance';
import type { ListStore } from '../storage/list-store';
import { wordsStore } from '../words/words';
import { folderStore, journalStore } from '../journal/journal';
import { logChange, startLog } from './log';
import { mergeLists } from './merge';
import type { Template } from '../timetable/templates';
import type { Plan } from '../timetable/plans';
import type { Entry, Folder } from '../journal/journal-store';
import { type Gone, cleanGone, nextStamp } from '../storage/gone';
import { onResetAt, resetAt, resetFromRemote, resetUpdated } from '../timetable/day-reset';

/**
 * Two-way sync of one user's data with Firestore (`users/{uid}/…`). Each piece carries a time stamp and the
 * newer side wins; changes that arrive from the cloud are applied without being sent back.
 *
 *   state/timetable   { blocks, updated, gone }    Today (merged task by task: each task's `u`, the tombstones)
 *   meta/templates    { list, updated, gone }      day templates (merged item by item, see merge.ts)
 *   meta/plans        { list, updated, gone }      days planned ahead (merged day by day)
 *   meta/settings     { dayReset, updated }        New day time (minute of day, null: off)
 *   notes/{date}      { date, text, updated }      memos
 *   days/{date}       { date, blocks, saved }      day history
 *   images/{id}       { id, date, created, data }  memo images (data URL, kept under Firestore's 1 MB limit)
 *   lists/{key}       { items, updated }           words, journal pages and folders, check-ins
 */
export type SyncStatus = 'syncing' | 'synced' | 'offline' | 'error';

const MAX_IMAGE_BYTES = 900_000;
/** A Firestore document holds at most 1 MiB: anything larger is refused, so it isn't sent (and says so). */
const MAX_DOC_CHARS = 900_000;
const tooBig = (v: unknown): boolean => {
  try {
    return JSON.stringify(v).length > MAX_DOC_CHARS;
  } catch {
    return true;
  }
};

// ---------- what comes from the cloud is checked before it is used: a document in an unexpected shape (an older
// Haru, a hand edit, a failed write) is read as far as it makes sense, never thrown on
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const withId = (v: unknown): boolean => isObj(v) && typeof v.id === 'string' && !!v.id;
const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const blocksOf = (v: unknown): Block[] => arr(v).filter(isBlock);

/** Re-encodes an image smaller until its data URL fits in one Firestore document. */
async function fitImage(blob: Blob): Promise<string | null> {
  let url = await toDataUrl(blob);
  if (url.length <= MAX_IMAGE_BYTES) return url;
  const bmp = await createImageBitmap(blob).catch(() => null);
  if (!bmp) return null;
  for (const side of [1600, 1200, 900, 640]) {
    const k = Math.min(1, side / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k);
    c.height = Math.round(bmp.height * k);
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
    url = c.toDataURL('image/webp', 0.82);
    if (url.length <= MAX_IMAGE_BYTES) break;
  }
  bmp.close();
  return url.length <= MAX_IMAGE_BYTES ? url : null;
}

export function startSync(fb: Fb, uid: string, onStatus: (s: SyncStatus) => void): () => void {
  const { db, fs } = fb;
  const base = `users/${uid}`;
  const ref = (path: string) => fs.doc(db, `${base}/${path}`);
  const col = (name: string) => fs.collection(db, `${base}/${name}`);
  const unsubs: (() => void)[] = [];
  // every change is also kept in the change log (see log.ts)
  unsubs.push(startLog(fb, uid));
  // the store listeners below live as long as the page; after sign-out they must do nothing
  let stopped = false;
  let pending = 0;
  /** The last write (or a listener) failed: shown until a write or a listener goes through again. */
  let failed = false;
  const report = () => {
    if (!stopped) onStatus(!navigator.onLine ? 'offline' : failed ? 'error' : pending ? 'syncing' : 'synced');
  };
  const fail = (what: string, e?: unknown) => {
    console.warn(`Haru sync: ${what}`, e ?? '');
    failed = true;
    report();
  };
  addEventListener('online', report);
  addEventListener('offline', report);
  const write = (p: Promise<unknown>) => {
    pending++;
    report();
    p.then(() => {
      failed = false;
    }, (e: unknown) => fail('a write failed', e)).finally(() => {
      pending--;
      report();
    });
  };
  /**
   * A live listener that comes back after an error. Firestore ends a listener for good on its first error (a lost
   * connection that doesn't heal, a token being renewed, rules being published): without this, the other devices'
   * changes would stop arriving until a reload. A throw in `next` (an unexpected document) is caught, not fatal.
   */
  const listen = <S>(open: (next: (snap: S) => void, error: (e: unknown) => void) => () => void, next: (snap: S) => unknown, what: string) => {
    let close = () => {};
    let timer = 0;
    let tries = 0;
    const start = () => {
      if (stopped) return;
      close = open((snap) => {
        tries = 0;
        try {
          const r = next(snap);
          if (r instanceof Promise) r.catch((e: unknown) => fail(`${what}: couldn't apply`, e));
        } catch (e) {
          fail(`${what}: couldn't apply`, e);
        }
      }, (e) => {
        fail(`${what}: listener stopped`, e);
        close = () => {};
        clearTimeout(timer);
        timer = window.setTimeout(start, Math.min(60_000, 2000 * 2 ** tries++));
      });
    };
    start();
    unsubs.push(() => {
      clearTimeout(timer);
      close();
    });
  };
  const docListen = (path: string, next: (snap: { data(): unknown; metadata: { hasPendingWrites: boolean } }) => unknown) =>
    listen((n, e) => fs.onSnapshot(ref(path), n, e), next, path);

  // ---------- Today (one document; the two copies are merged task by task — each task's stamp `u` and the
  // tombstones `gone`, like the lists — so a task checked off here and one added there both stay)
  let applying = false;
  let lastBlocks = state.blocks;
  let cloudBlocksStamp = 0;
  /** After one of Haru's own changes was dropped: the cloud's next copy is taken as is, not merged. */
  let takeCloud = false;
  const pushBlocks = () => {
    const updated = blocksUpdated() || Date.now();
    const doc = { blocks: state.blocks, updated, gone: blocksGone() };
    if (tooBig(doc)) return fail('Today is too large to sync');
    cloudBlocksStamp = updated;
    write(fs.setDoc(ref('state/timetable'), doc));
  };
  /**
   * Haru's own change (a new day, the school's lessons) goes up only onto the Today it was made from. If another
   * device changed Today since (a laptop waking up before the newer Today has reached it), that Today stays: it
   * arrives and is applied here, and the change is redone on top of it.
   */
  const pushIfUnchanged = () => {
    const base = cloudBlocksStamp;
    const blocks = state.blocks;
    const gone = blocksGone();
    const updated = Date.now();
    write(fs.runTransaction(db, async (tx) => {
      const cur = await tx.get(ref('state/timetable'));
      if ((Number(cur.data()?.updated) || 0) > base) return false;
      tx.set(ref('state/timetable'), { blocks, updated, gone });
      return true;
    }).then((ok) => {
      if (ok && state.blocks === blocks) {
        stampBlocks(updated);
        cloudBlocksStamp = updated;
      } else if (!ok) {
        takeCloud = true;
        logChange('today', '', 'auto-dropped', blocks);
        announceAutoLost();
      }
    }, () => announceAutoLost()));
  };
  subscribe(() => {
    if (stopped || state.blocks === lastBlocks) return;
    const before = lastBlocks;
    lastBlocks = state.blocks;
    if (applying) return;
    logChange('today', '', changingAutomatically() ? 'auto' : 'edit', state.blocks, before);
    if (changingAutomatically()) {
      pushIfUnchanged();
      return;
    }
    stampBlocks(nextStamp(blocksUpdated()));
    pushBlocks();
  });
  const take = (blocks: Block[], gone: Gone, stamp: number) => {
    applying = true;
    applyRemote(() => setState({ blocks: blocks.map((b) => ({ ...b, id: b.id || newId(), done: b.done === true })), draft: null }));
    setBlocksGone(gone);
    lastBlocks = state.blocks;
    applying = false;
    stampBlocks(stamp);
  };
  docListen('state/timetable', (snap) => {
    if (snap.metadata.hasPendingWrites) return;
    const raw = snap.data();
    const data = isObj(raw) ? { blocks: blocksOf(raw.blocks), updated: num(raw.updated), gone: raw.gone as Gone | undefined } : undefined;
    if (!data) {
      // nothing in the cloud yet: this device's day goes up
      if (state.blocks.length) pushBlocks();
      return;
    }
    const local = state.blocks;
    if (takeCloud && data.updated > cloudBlocksStamp) {
      takeCloud = false;
      logChange('today', '', 'from-cloud', data.blocks, local);
      take(data.blocks, cleanGone(data.gone), data.updated);
      cloudBlocksStamp = data.updated;
      return;
    }
    const m = mergeLists({ items: local, gone: blocksGone() }, { items: data.blocks, gone: cleanGone(data.gone) }, (b) => b.id, (b) => Number(b.u) || 0);
    // a first sync must never silently lose a different local day: it is kept as a template as well
    if (local.length && !m.sameAsLocal && !blocksUpdated()) saveTemplate(`This device ${new Date().toLocaleDateString('en-CA')}`);
    cloudBlocksStamp = data.updated;
    if (!m.sameAsLocal) {
      logChange('today', '', 'from-cloud', m.list, local);
      // the cloud's copy as is keeps its stamp; a merge is a change of its own, and goes back up
      take(m.list, m.gone, m.sameAsCloud ? data.updated : Date.now());
      if (!m.sameAsCloud) pushBlocks();
    } else if (!m.sameAsCloud) {
      setBlocksGone(m.gone);
      pushBlocks();
    } else stampBlocks(Math.max(blocksUpdated(), data.updated));
  });

  // ---------- templates (one list; the copies are merged template by template, so two devices editing
  // different templates at once keep both)
  let cloudTplStamp = 0;
  const pushTemplates = () => {
    const doc = { list: allTemplates(), updated: templatesUpdated() || Date.now(), gone: templatesGone() };
    if (tooBig(doc)) return fail('the templates are too large to sync');
    cloudTplStamp = doc.updated;
    logChange('templates', '', 'save', doc.list);
    write(fs.setDoc(ref('meta/templates'), doc));
  };
  onTemplates(() => {
    if (!stopped && templatesUpdated() > cloudTplStamp) pushTemplates();
  });
  docListen('meta/templates', (snap) => {
    if (snap.metadata.hasPendingWrites) return;
    const raw = snap.data();
    const data = isObj(raw) ? { list: arr(raw.list).filter(withId), updated: num(raw.updated), gone: raw.gone as Gone | undefined } : undefined;
    if (!data) {
      if (allTemplates().length) pushTemplates();
      return;
    }
    const m = mergeLists({ items: allTemplates(), gone: templatesGone() }, { items: data.list as Template[], gone: cleanGone(data.gone) }, (t) => t.id, (t) => Number(t.updated) || 0);
    cloudTplStamp = data.updated;
    if (!m.sameAsLocal) {
      logChange('templates', '', 'from-cloud', m.list, allTemplates());
      // taking the cloud's copy as is keeps its stamp; a merge is a change of its own, and goes back up
      templatesFromRemote(m.list, m.sameAsCloud ? data.updated : Date.now(), m.gone);
    } else if (!m.sameAsCloud) pushTemplates();
  });

  // ---------- plans (one list, merged day by day like the templates)
  let cloudPlanStamp = 0;
  const pushPlans = () => {
    const doc = { list: allPlans(), updated: plansUpdated() || Date.now(), gone: plansGone() };
    if (tooBig(doc)) return fail('the plans are too large to sync');
    cloudPlanStamp = doc.updated;
    logChange('plans', '', 'save', doc.list);
    write(fs.setDoc(ref('meta/plans'), doc));
  };
  onPlans(() => {
    if (!stopped && plansUpdated() > cloudPlanStamp) pushPlans();
  });
  docListen('meta/plans', (snap) => {
    if (snap.metadata.hasPendingWrites) return;
    const raw = snap.data();
    const data = isObj(raw) ? { list: arr(raw.list).filter((p) => isObj(p) && isDate(p.date)), updated: num(raw.updated), gone: raw.gone as Gone | undefined } : undefined;
    if (!data) {
      if (allPlans().length) pushPlans();
      return;
    }
    const m = mergeLists({ items: allPlans(), gone: plansGone() }, { items: data.list as Plan[], gone: cleanGone(data.gone) }, (p) => p.date, (p) => Number(p.saved) || 0);
    cloudPlanStamp = data.updated;
    if (!m.sameAsLocal) {
      logChange('plans', '', 'from-cloud', m.list, allPlans());
      plansFromRemote(m.list, m.sameAsCloud ? data.updated : Date.now(), m.gone);
    } else if (!m.sameAsCloud) pushPlans();
  });

  // ---------- New day time (one value, the newer side wins). A device that never chose one sends the default
  // stamped 0, so any device's actual choice wins over it.
  let cloudResetStamp = 0;
  const pushReset = () => {
    cloudResetStamp = resetUpdated();
    logChange('settings', 'dayReset', 'save', resetAt());
    write(fs.setDoc(ref('meta/settings'), { dayReset: resetAt(), updated: cloudResetStamp }));
  };
  onResetAt(() => {
    if (!stopped && resetUpdated() > cloudResetStamp) pushReset();
  });
  docListen('meta/settings', (snap) => {
    if (snap.metadata.hasPendingWrites) return;
    const raw = snap.data();
    // a minute of the day, or null (off); anything else is read as not set
    const reset = isObj(raw) && (raw.dayReset === null || (typeof raw.dayReset === 'number' && raw.dayReset >= 0 && raw.dayReset < 1440)) ? raw.dayReset as number | null : undefined;
    const data = isObj(raw) ? { dayReset: reset, updated: num(raw.updated) } : undefined;
    if (!data || data.dayReset === undefined) {
      // nothing in the cloud yet: this device's choice (or the default) goes up
      pushReset();
      return;
    }
    if (data.updated > resetUpdated()) {
      cloudResetStamp = data.updated;
      if (data.dayReset !== resetAt()) logChange('settings', 'dayReset', 'from-cloud', data.dayReset, resetAt());
      resetFromRemote(data.dayReset, data.updated);
    } else if (resetUpdated() > data.updated) pushReset();
    else cloudResetStamp = data.updated;
  });

  // ---------- memos (per date)
  const notes = notesStore();
  /** What the cloud is known to hold: date → updated. */
  const cloudNotes = new Map<string, number>();
  let notesSeeded = false;
  const pushNotes = () => {
    if (stopped || !notes || !notesSeeded) return;
    const local = new Map(notes.all().map((r) => [r.date, r]));
    for (const r of local.values()) {
      if ((cloudNotes.get(r.date) ?? 0) >= r.updated) continue;
      if (tooBig(r)) {
        fail(`the memo of ${r.date} is too large to sync`);
        continue;
      }
      cloudNotes.set(r.date, r.updated);
      logChange('memo', r.date, 'save', r.text);
      write(fs.setDoc(ref(`notes/${r.date}`), r));
    }
    for (const date of [...cloudNotes.keys()]) {
      if (local.has(date)) continue;
      cloudNotes.delete(date);
      logChange('memo', date, 'delete');
      write(fs.deleteDoc(ref(`notes/${date}`)));
    }
  };
  onNotesChanged(pushNotes);
  if (notes) {
    void notes.ready.then(() => {
      listen<{ docChanges(): { type: string; doc: { id: string; data(): unknown; metadata: { hasPendingWrites: boolean } } }[] }>((n, e) => fs.onSnapshot(col('notes'), n, e), (snap) => {
        for (const ch of snap.docChanges()) {
          if (ch.doc.metadata.hasPendingWrites) continue;
          const raw = ch.doc.data();
          // the date is the document's own name; a memo without text or a stamp is read as empty and old
          const date = isObj(raw) && isDate(raw.date) ? raw.date : ch.doc.id;
          if (!isDate(date)) continue;
          const r: NoteRecord = { ...(isObj(raw) ? raw : {}), date, text: isObj(raw) && typeof raw.text === 'string' ? raw.text : '', updated: isObj(raw) ? num(raw.updated) : 0 } as NoteRecord;
          const mine = notes.record(r.date);
          if (ch.type === 'removed') {
            cloudNotes.delete(r.date);
            // deleted elsewhere: drop it here too, unless this device changed it since
            if (mine && mine.updated <= r.updated) {
              logChange('memo', r.date, 'from-cloud', '', mine.text);
              notes.setFromRemote({ date: r.date, text: '', updated: Date.now() });
            }
            continue;
          }
          cloudNotes.set(r.date, r.updated);
          if (!mine || r.updated > mine.updated) {
            if (mine && mine.text !== r.text) logChange('memo', r.date, 'from-cloud', r.text, mine.text);
            notes.setFromRemote(r);
          }
        }
        if (!notesSeeded) {
          notesSeeded = true;
          pushNotes(); // memos only this device has go up
        }
      }, 'notes');
    });
  }

  // ---------- day history (per date)
  // a day goes up only over an older copy of it (offline: the next start sends what the cloud lacks). What the cloud
  // holds is remembered on this device (date → saved), so a start reads only the days saved lately instead of every
  // day there is, and a save the cloud already has (the same snapshot again on start or on leaving) reads nothing.
  // Every week, or with nothing remembered, all days are read once: that catches a day sent late from a device that
  // was offline for longer than the margin.
  const DAYS_KEY = `haru:days-cloud:${uid}`;
  const DAYS_MARGIN = 3 * 86_400_000;
  const DAYS_FULL_EVERY = 7 * 86_400_000;
  let daysKnown: { days: Record<string, number>; full: number } = { days: {}, full: 0 };
  try {
    const v = JSON.parse(localStorage.getItem(DAYS_KEY) ?? 'null') as typeof daysKnown | null;
    if (v && typeof v.days === 'object' && typeof v.full === 'number') daysKnown = v;
  } catch {
    // unreadable: read every day once
  }
  const keepKnown = () => {
    try {
      localStorage.setItem(DAYS_KEY, JSON.stringify(daysKnown));
    } catch {
      // full reads only, then
    }
  };
  const cloudHas = (date: string, saved: number) => {
    if ((daysKnown.days[date] ?? 0) >= saved) return;
    daysKnown.days[date] = saved;
    keepKnown();
  };
  const sendDay = (s: DaySnapshot) => tooBig(s) ? fail(`the day ${s.date} is too large to sync`) : write(fs.runTransaction(db, async (tx) => {
    const cur = await tx.get(ref(`days/${s.date}`));
    const there = Number(cur.data()?.saved) || 0;
    if (there >= s.saved) return there;
    tx.set(ref(`days/${s.date}`), s);
    return s.saved;
  }).then((saved) => cloudHas(s.date, saved)).catch(() => {}));
  onDaySaved((s) => {
    if (stopped) return;
    if ((daysKnown.days[s.date] ?? 0) >= s.saved) return;
    logChange('day', s.date, 'save', s.blocks);
    sendDay(s);
  });
  void (async () => {
    // days this device lacks though the cloud has them (cleared for another account) can only come from a full read
    const mine = await allDays();
    const here = new Set(mine.map((d) => d.date));
    const full = !daysKnown.full || Date.now() - daysKnown.full > DAYS_FULL_EVERY || Object.keys(daysKnown.days).some((d) => !here.has(d));
    const since = Math.max(0, ...Object.values(daysKnown.days)) - DAYS_MARGIN;
    const q = full ? col('days') : fs.query(col('days'), fs.where('saved', '>', since));
    const remote = await fs.getDocs(q).catch((e: unknown) => (fail('couldn’t read the past days', e), null));
    if (!remote || stopped) return;
    if (full) daysKnown = { days: {}, full: Date.now() };
    for (const d of remote.docs) {
      const raw = d.data() as unknown;
      const date = isObj(raw) && isDate(raw.date) ? raw.date : d.id;
      if (!isObj(raw) || !isDate(date)) continue;
      const s: DaySnapshot = { date, blocks: blocksOf(raw.blocks), saved: num(raw.saved) };
      daysKnown.days[s.date] = Math.max(daysKnown.days[s.date] ?? 0, s.saved);
      await putFromRemote(s).catch((e: unknown) => fail(`couldn't keep the day ${s.date}`, e));
    }
    keepKnown();
    for (const s of mine) if ((daysKnown.days[s.date] ?? 0) < s.saved) sendDay(s);
  })();

  // ---------- images (added / removed; never edited)
  const images = imagesStore();
  const cloudImages = new Set<string>();
  let imagesSeeded = false;
  const pushImages = async () => {
    if (stopped || !images || !imagesSeeded) return;
    const local = new Map(images.all().map((r) => [r.id, r]));
    for (const r of local.values()) {
      if (cloudImages.has(r.id)) continue;
      cloudImages.add(r.id);
      const data = await fitImage(r.blob).catch(() => null);
      if (!data) fail(`the image ${r.id} couldn’t be made small enough to sync`);
      else {
        logChange('image', r.id, 'add', { date: r.date });
        write(fs.setDoc(ref(`images/${r.id}`), { id: r.id, date: r.date, created: r.created, data }));
      }
    }
    for (const id of [...cloudImages]) {
      if (local.has(id)) continue;
      cloudImages.delete(id);
      logChange('image', id, 'delete');
      write(fs.deleteDoc(ref(`images/${id}`)));
    }
  };
  onImagesChanged(() => void pushImages());
  if (images) {
    void images.ready.then(() => {
      listen<{ docChanges(): { type: string; doc: { id: string; data(): unknown; metadata: { hasPendingWrites: boolean } } }[] }>((n, e) => fs.onSnapshot(col('images'), n, e), async (snap) => {
        for (const ch of snap.docChanges()) {
          if (ch.doc.metadata.hasPendingWrites) continue;
          const raw = ch.doc.data();
          const r = { id: ch.doc.id, date: isObj(raw) && typeof raw.date === 'string' ? raw.date : '', created: isObj(raw) ? num(raw.created) : 0, data: isObj(raw) && typeof raw.data === 'string' ? raw.data : '' };
          if (ch.type === 'removed') {
            cloudImages.delete(r.id);
            images.removeFromRemote(r.id);
            continue;
          }
          cloudImages.add(r.id);
          if (images.has(r.id) || !r.data.startsWith('data:')) continue;
          // one image that won't decode never holds up the others
          const blob = await fromDataUrl(r.data).catch(() => null);
          if (blob) images.putFromRemote({ id: r.id, date: r.date, created: r.created, blob });
          else fail(`the image ${r.id} couldn’t be read`);
        }
        if (!imagesSeeded) {
          imagesSeeded = true;
          void pushImages();
        }
      }, 'images');
    });
  }

  // ---------- lists (one document each). Check-ins are only ever added, so the two copies are simply put
  // together; journal pages and folders are merged item by item (merge.ts); words have no stamps, the newer
  // copy wins
  type ItemMerge = { key: (t: unknown) => string; stamp: (t: unknown) => number; prepend?: boolean };
  const byId = (stampOf: (t: unknown) => number, prepend = false): ItemMerge => ({ key: (t) => String((t as { id: string }).id), stamp: stampOf, prepend });
  const lists: [string, ListStore<unknown>, boolean, ItemMerge | null][] = [
    ['words', wordsStore, false, null],
    ['journal', journalStore, false, byId((t) => Number((t as Entry).updated) || 0, true)],
    ['journal-folders', folderStore, false, byId((t) => Number((t as Folder).created) || 0)],
    ['checkins', checkinStore, true, null],
  ];
  for (const [key, store, merge, items] of lists) {
    const items_ = items;
    let cloudStamp = 0;
    const push = () => {
      // Firestore takes no `undefined` fields: a JSON round trip drops them
      const items = JSON.parse(JSON.stringify(store.all())) as unknown[];
      // one document holds at most 1 MB
      if (tooBig(items)) return fail(`the list ${key} is too large to sync`);
      cloudStamp = store.updated() || Date.now();
      logChange('list', key, 'save', items);
      write(fs.setDoc(ref(`lists/${key}`), { items, updated: cloudStamp, ...(items_ && { gone: store.gone() }) }));
    };
    store.onChange(() => {
      if (!stopped && store.updated() > cloudStamp) push();
    });
    void store.ready.then(() => {
      if (stopped) return;
      docListen(`lists/${key}`, (snap) => {
        if (snap.metadata.hasPendingWrites) return;
        const raw = snap.data();
        // only what the merge below needs to read (each store checks its own records again as it takes them): pages
        // and folders have an id, check-ins are dates; words go to their store as they are
        const ok = merge ? isDate : items ? withId : () => true;
        const data = isObj(raw) ? { items: arr(raw.items).filter(ok), updated: num(raw.updated), gone: raw.gone as Gone | undefined } : undefined;
        if (!data) {
          // nothing in the cloud yet: this device's list goes up
          if (store.all().length) push();
          return;
        }
        if (merge) {
          const both = [...new Set([...store.all(), ...data.items])].sort() as unknown[];
          if (both.length !== store.all().length) store.fromRemote(both, Math.max(data.updated, store.updated()));
          cloudStamp = data.updated;
          if (both.length !== data.items.length) push();
          return;
        }
        if (items) {
          const m = mergeLists({ items: store.all(), gone: store.gone() }, { items: data.items, gone: cleanGone(data.gone) }, items.key, items.stamp, items.prepend);
          cloudStamp = data.updated;
          if (!m.sameAsLocal) {
            logChange('list', key, 'from-cloud', m.list, store.all());
            store.fromRemote(m.list, m.sameAsCloud ? data.updated : Date.now(), m.gone);
          } else if (!m.sameAsCloud) push();
          return;
        }
        if (data.updated > store.updated()) {
          cloudStamp = data.updated;
          logChange('list', key, 'from-cloud', data.items, store.all());
          store.fromRemote(data.items, data.updated);
        } else if (store.updated() > data.updated) push();
        else cloudStamp = data.updated;
      });
    });
  }

  report();
  return () => {
    stopped = true;
    unsubs.forEach((u) => u());
    removeEventListener('online', report);
    removeEventListener('offline', report);
  };
}
