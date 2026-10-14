import type { Fb } from './firebase';
import { setState, state, subscribe } from '../timetable/state';
import { type Block, blocksUpdated, newId, stampBlocks } from '../timetable/model';
import { allTemplates, onTemplates, saveTemplate, templatesFromRemote, templatesUpdated } from '../timetable/templates';
import { allDays, onDaySaved, putFromRemote, type DaySnapshot } from '../timetable/history';
import { type NoteRecord, notesStore, onNotesChanged } from '../calendar/notes';
import { fromDataUrl, imagesStore, onImagesChanged, toDataUrl } from '../calendar/images';

/**
 * Two-way sync of one user's data with Firestore (`users/{uid}/…`). Each piece carries a time stamp and the
 * newer side wins; changes that arrive from the cloud are applied without being sent back.
 *
 *   state/timetable   { blocks, updated }          Today
 *   meta/templates    { list, updated }            day templates
 *   notes/{date}      { date, text, updated }      memos
 *   days/{date}       { date, blocks, saved }      day history
 *   images/{id}       { id, date, created, data }  memo images (data URL, kept under Firestore's 1 MB limit)
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
  subscribe(() => {
    if (stopped || state.blocks === lastBlocks) return;
    lastBlocks = state.blocks;
    if (applying) return;
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
      return;
    }
    // the cloud is newer. A first sync must never silently drop a different local day: keep it as a template.
    const local = state.blocks;
    const same = JSON.stringify(local.map(({ id: _, ...b }) => b)) === JSON.stringify(data.blocks.map(({ id: _, ...b }) => b));
    if (local.length && !same && !blocksUpdated()) {
      saveTemplate(`This device ${new Date().toLocaleDateString('en-CA')}`);
    }
    applying = true;
    setState({ blocks: data.blocks.map((b) => ({ ...b, id: b.id || newId(), done: b.done === true })), draft: null });
    lastBlocks = state.blocks;
    applying = false;
    stampBlocks(data.updated);
    cloudBlocksStamp = data.updated;
  }, () => onStatus('error')));

  // ---------- templates (one list, last writer wins)
  let cloudTplStamp = 0;
  const pushTemplates = () => {
    cloudTplStamp = templatesUpdated() || Date.now();
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
      templatesFromRemote(data.list, data.updated);
    } else if (templatesUpdated() > data.updated) pushTemplates();
    else cloudTplStamp = data.updated;
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
      write(fs.setDoc(ref(`notes/${r.date}`), r));
    }
    for (const date of [...cloudNotes.keys()]) {
      if (local.has(date)) continue;
      cloudNotes.delete(date);
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
            if (mine && mine.updated <= r.updated) notes.setFromRemote({ date: r.date, text: '', updated: Date.now() });
            continue;
          }
          cloudNotes.set(r.date, r.updated);
          if (!mine || r.updated > mine.updated) notes.setFromRemote(r);
        }
        if (!notesSeeded) {
          notesSeeded = true;
          pushNotes(); // memos only this device has go up
        }
      }, () => onStatus('error')));
    });
  }

  // ---------- day history (per date)
  onDaySaved((s) => {
    if (!stopped) write(fs.setDoc(ref(`days/${s.date}`), s));
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
      if (data) write(fs.setDoc(ref(`images/${r.id}`), { id: r.id, date: r.date, created: r.created, data }));
    }
    for (const id of [...cloudImages]) {
      if (local.has(id)) continue;
      cloudImages.delete(id);
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

  report();
  return () => {
    stopped = true;
    unsubs.forEach((u) => u());
    removeEventListener('online', report);
    removeEventListener('offline', report);
  };
}
