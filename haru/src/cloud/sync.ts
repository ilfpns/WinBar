import type { Fb } from './firebase';
import { announceAutoLost, changingAutomatically, setState, state, subscribe, fromOutside } from '../timetable/state';
import { type Block, blocksUpdated, newId, stampBlocks } from '../timetable/model';
import { allTemplates, onTemplates, saveTemplate, templatesFromRemote, templatesUpdated } from '../timetable/templates';
import { allDays, onDaySaved, putFromRemote, type DaySnapshot } from '../timetable/history';
import { allPlans, onPlans, plansFromRemote, plansUpdated } from '../timetable/plans';
import { type NoteRecord, notesStore, onNotesChanged } from '../calendar/notes';
import { fromDataUrl, imagesStore, onImagesChanged, toDataUrl } from '../calendar/images';
import { checkinStore } from '../calendar/attendance';
import type { ListStore } from '../storage/list-store';
import { wordsStore } from '../words/words';
import { folderStore, journalStore } from '../journal/journal';
import { logChange, startLog } from './log';
import { onResetAt, resetAt, resetFromRemote, resetUpdated } from '../timetable/day-reset';

/**
 * Two-way sync of one user's data with Firestore (`users/{uid}/…`). Each piece carries a time stamp and the
 * newer side wins; changes that arrive from the cloud are applied without being sent back.
 *
 *   state/timetable   { blocks, updated }          Today
 *   meta/templates    { list, updated }            day templates
 *   meta/plans        { list, updated }            days planned ahead
 *   meta/settings     { dayReset, updated }        New day time (minute of day, null: off)
 *   notes/{date}      { date, text, updated }      memos
 *   days/{date}       { date, blocks, saved }      day history
 *   images/{id}       { id, date, created, data }  memo images (data URL, kept under Firestore's 1 MB limit)
 *   lists/{key}       { items, updated }           words, journal pages and folders, check-ins
 */
export type SyncStatus = 'syncing' | 'synced' | 'offline' | 'error';

const MAX_IMAGE_BYTES = 900_000;

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
  const report = () => onStatus(!navigator.onLine ? 'offline' : pending ? 'syncing' : 'synced');
  addEventListener('online', report);
  addEventListener('offline', report);
  const write = (p: Promise<unknown>) => {
    pending++;
    report();
    p.catch(() => onStatus('error')).finally(() => {
      pending--;
      report();
    });
  };

  // ---------- Today
  let applying = false;
  let lastBlocks = state.blocks;
  let cloudBlocksStamp = 0;
  const pushBlocks = () => {
    const updated = blocksUpdated() || Date.now();
    cloudBlocksStamp = updated;
    write(fs.setDoc(ref('state/timetable'), { blocks: state.blocks, updated }));
  };
  /**
   * Haru's own change (a new day, the school's lessons) goes up only onto the Today it was made from. If another
   * device changed Today since (a laptop waking up before the newer Today has reached it), that Today stays: it
   * arrives and is applied here, and the change is redone on top of it.
   */
  const pushIfUnchanged = () => {
    const base = cloudBlocksStamp;
    const blocks = state.blocks;
    const updated = Date.now();
    write(fs.runTransaction(db, async (tx) => {
      const cur = await tx.get(ref('state/timetable'));
      if ((Number(cur.data()?.updated) || 0) > base) return false;
      tx.set(ref('state/timetable'), { blocks, updated });
      return true;
    }).then((ok) => {
      if (ok && state.blocks === blocks) {
        stampBlocks(updated);
        cloudBlocksStamp = updated;
      } else if (!ok) {
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
    stampBlocks(Date.now());
    pushBlocks();
  });
  unsubs.push(fs.onSnapshot(ref('state/timetable'), (snap) => {
    if (snap.metadata.hasPendingWrites) return;
    const data = snap.data() as { blocks: Block[]; updated: number } | undefined;
    if (!data) {
      // nothing in the cloud yet: this device's day goes up
      if (state.blocks.length) pushBlocks();
      return;
    }
    if (data.updated <= Math.max(blocksUpdated(), cloudBlocksStamp)) {
      // this device is newer (or the same): make sure the cloud has it
      if (blocksUpdated() > data.updated) pushBlocks();
      else cloudBlocksStamp = Math.max(cloudBlocksStamp, data.updated);
      return;
    }
    // the cloud is newer. A first sync must never silently drop a different local day: keep it as a template.
    const local = state.blocks;
    const same = JSON.stringify(local.map(({ id: _, ...b }) => b)) === JSON.stringify(data.blocks.map(({ id: _, ...b }) => b));
    if (local.length && !same && !blocksUpdated()) {
      saveTemplate(`This device ${new Date().toLocaleDateString('en-CA')}`);
    }
    if (!same) logChange('today', '', 'from-cloud', data.blocks, local);
    applying = true;
    fromOutside(() => setState({ blocks: data.blocks.map((b) => ({ ...b, id: b.id || newId(), done: b.done === true })), draft: null }));
    lastBlocks = state.blocks;
    applying = false;
    stampBlocks(data.updated);
    cloudBlocksStamp = data.updated;
  }, () => onStatus('error')));

  // ---------- templates (one list, last writer wins)
  let cloudTplStamp = 0;
  const pushTemplates = () => {
    cloudTplStamp = templatesUpdated() || Date.now();
    logChange('templates', '', 'save', allTemplates());
    write(fs.setDoc(ref('meta/templates'), { list: allTemplates(), updated: cloudTplStamp }));
  };
  onTemplates(() => {
    if (!stopped && templatesUpdated() > cloudTplStamp) pushTemplates();
  });
  unsubs.push(fs.onSnapshot(ref('meta/templates'), (snap) => {
    if (snap.metadata.hasPendingWrites) return;
    const data = snap.data() as { list: unknown[]; updated: number } | undefined;
    if (!data) {
      if (allTemplates().length) pushTemplates();
      return;
    }
    if (data.updated > templatesUpdated()) {
      cloudTplStamp = data.updated;
      logChange('templates', '', 'from-cloud', data.list, allTemplates());
      templatesFromRemote(data.list, data.updated);
    } else if (templatesUpdated() > data.updated) pushTemplates();
    else cloudTplStamp = data.updated;
  }, () => onStatus('error')));

  // ---------- plans (one list, last writer wins, like the templates)
  let cloudPlanStamp = 0;
  const pushPlans = () => {
    cloudPlanStamp = plansUpdated() || Date.now();
    logChange('plans', '', 'save', allPlans());
    write(fs.setDoc(ref('meta/plans'), { list: allPlans(), updated: cloudPlanStamp }));
  };
  onPlans(() => {
    if (!stopped && plansUpdated() > cloudPlanStamp) pushPlans();
  });
  unsubs.push(fs.onSnapshot(ref('meta/plans'), (snap) => {
    if (snap.metadata.hasPendingWrites) return;
    const data = snap.data() as { list: unknown[]; updated: number } | undefined;
    if (!data) {
      if (allPlans().length) pushPlans();
      return;
    }
    if (data.updated > plansUpdated()) {
      cloudPlanStamp = data.updated;
      logChange('plans', '', 'from-cloud', data.list, allPlans());
      plansFromRemote(data.list, data.updated);
    } else if (plansUpdated() > data.updated) pushPlans();
    else cloudPlanStamp = data.updated;
  }, () => onStatus('error')));

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
  unsubs.push(fs.onSnapshot(ref('meta/settings'), (snap) => {
    if (snap.metadata.hasPendingWrites) return;
    const data = snap.data() as { dayReset?: number | null; updated: number } | undefined;
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
  }, () => onStatus('error')));

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
      unsubs.push(fs.onSnapshot(col('notes'), (snap) => {
        for (const ch of snap.docChanges()) {
          if (ch.doc.metadata.hasPendingWrites) continue;
          const r = ch.doc.data() as NoteRecord;
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
      }, () => onStatus('error')));
    });
  }

  // ---------- day history (per date)
  // a day goes up only over an older copy of it (offline: the next start sends what the cloud lacks)
  onDaySaved((s) => {
    if (stopped) return;
    logChange('day', s.date, 'save', s.blocks);
    write(fs.runTransaction(db, async (tx) => {
      const cur = await tx.get(ref(`days/${s.date}`));
      if ((Number(cur.data()?.saved) || 0) >= s.saved) return;
      tx.set(ref(`days/${s.date}`), s);
    }).catch(() => {}));
  });
  void (async () => {
    const remote = await fs.getDocs(col('days')).catch(() => null);
    if (!remote) return;
    const seen = new Map<string, number>();
    for (const d of remote.docs) {
      const s = d.data() as DaySnapshot;
      seen.set(s.date, s.saved);
      await putFromRemote(s);
    }
    for (const s of await allDays()) {
      if ((seen.get(s.date) ?? 0) < s.saved) write(fs.setDoc(ref(`days/${s.date}`), s));
    }
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
      const data = await fitImage(r.blob);
      if (data) {
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
      unsubs.push(fs.onSnapshot(col('images'), async (snap) => {
        for (const ch of snap.docChanges()) {
          if (ch.doc.metadata.hasPendingWrites) continue;
          const r = ch.doc.data() as { id: string; date: string; created: number; data: string };
          if (ch.type === 'removed') {
            cloudImages.delete(r.id);
            images.removeFromRemote(r.id);
            continue;
          }
          cloudImages.add(r.id);
          if (!images.has(r.id)) images.putFromRemote({ id: r.id, date: r.date, created: r.created, blob: await fromDataUrl(r.data) });
        }
        if (!imagesSeeded) {
          imagesSeeded = true;
          void pushImages();
        }
      }, () => onStatus('error')));
    });
  }

  // ---------- lists (one document each, the newer side wins; check-ins are only ever added, so they merge)
  const lists: [string, ListStore<unknown>, boolean][] = [
    ['words', wordsStore, false],
    ['journal', journalStore, false],
    ['journal-folders', folderStore, false],
    ['checkins', checkinStore, true],
  ];
  for (const [key, store, merge] of lists) {
    let cloudStamp = 0;
    const push = () => {
      // Firestore takes no `undefined` fields: a JSON round trip drops them
      const items = JSON.parse(JSON.stringify(store.all())) as unknown[];
      // one document holds at most 1 MB
      if (JSON.stringify(items).length > MAX_IMAGE_BYTES) {
        onStatus('error');
        return;
      }
      cloudStamp = store.updated() || Date.now();
      logChange('list', key, 'save', items);
      write(fs.setDoc(ref(`lists/${key}`), { items, updated: cloudStamp }));
    };
    store.onChange(() => {
      if (!stopped && store.updated() > cloudStamp) push();
    });
    void store.ready.then(() => {
      if (stopped) return;
      unsubs.push(fs.onSnapshot(ref(`lists/${key}`), (snap) => {
        if (snap.metadata.hasPendingWrites) return;
        const data = snap.data() as { items: unknown[]; updated: number } | undefined;
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
        if (data.updated > store.updated()) {
          cloudStamp = data.updated;
          logChange('list', key, 'from-cloud', data.items, store.all());
          store.fromRemote(data.items, data.updated);
        } else if (store.updated() > data.updated) push();
        else cloudStamp = data.updated;
      }, () => onStatus('error')));
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
