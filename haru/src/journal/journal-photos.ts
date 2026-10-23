import { icon } from '../ui/icons';
import { IMG_LINE, imageLine } from '../ui/markdown';
import { type MdEditor } from '../ui/md-editor';
import { imagesStore, onImagesChanged } from '../calendar/images';

/** What the page's photos need from the journal around them. */
export interface PhotoDeps {
  body: HTMLElement;
  text: MdEditor;
  titleIn: HTMLInputElement;
  /** The page in the editor (null: a blank page). */
  openId: () => string | null;
  flush: (create?: boolean) => void;
  tell: (msg: string, undo?: () => void) => void;
}

export function mountPhotos({ body, text, titleIn, openId, flush, tell }: PhotoDeps): { photoUrl: (id: string) => string | null; renderPhotos: () => void } {
  const $ = <T extends Element>(sel: string) => body.querySelector<T>(sel)!;
  // ---- photos: pick, paste (Ctrl+V) or drop them onto the page, and they go into the text where the caret is
  // (dropped: where they fall), each on a line of its own, as in Notion or Obsidian. Opened large, copied or
  // removed from the photo itself. They live with the calendar's images (synced and backed up the same way),
  // filed under the page; photos from before they went inline (or whose line was deleted) stay under the text.
  const gallery = $<HTMLElement>('.j-images');
  const addImg = $<HTMLButtonElement>('.j-add-img');
  const imgFile = $<HTMLInputElement>('.j-img-file');
  addImg.append(icon('image-plus'));
  const photoKey = (id: string) => `journal:${id}`;
  /** A photo of the open page, to show (null: not on this device, or not yet). */
  function photoUrl(id: string): string | null {
    const store = imagesStore();
    const rec = store && openId() ? store.get(photoKey(openId()!)).find((r) => r.id === id) : undefined;
    return rec ? store!.url(rec) : null;
  }
  async function attach(files: Blob[]): Promise<void> {
    const store = imagesStore();
    if (!store || !files.some((f) => f.type.startsWith('image/'))) return;
    // a photo on a blank page starts the page
    flush(true);
    if (!openId()) return;
    const at = text.selectionStart;
    const added = await store.add(photoKey(openId()!), files);
    if (!added.length) return;
    placePhotos(added.map((r) => r.id), at);
    tell(`${added.length} photo${added.length === 1 ? '' : 's'} added`);
  }
  /** Puts photo lines into the text at `at` (on lines of their own), the caret after them. */
  function placePhotos(ids: string[], at: number): void {
    const v = text.value;
    const pos = Math.min(at, v.length);
    const before = pos > 0 && v[pos - 1] !== '\n' ? '\n' : '';
    const after = pos < v.length && v[pos] === '\n' ? '' : '\n';
    text.setRangeText(before + ids.map(imageLine).join('\n') + after, pos, pos, 'end');
    text.dispatchEvent(new Event('input', { bubbles: true }));
  }
  text.imageUrl = photoUrl;
  text.addEventListener('md-image', (e) => {
    const { id, action } = (e as CustomEvent<{ id: string; action: string }>).detail;
    const store = imagesStore();
    const rec = store && openId() ? store.get(photoKey(openId()!)).find((r) => r.id === id) : undefined;
    if (!rec || !store) return;
    if (action === 'open') {
      big.src = store.url(rec);
      viewer.showModal();
    } else if (action === 'copy') {
      void copyPhoto(rec.blob).then(() => tell('Photo copied'), () => tell('Couldn’t copy the photo'));
    } else if (action === 'remove') {
      store.remove(rec.id);
      tell('Photo removed');
    }
  });
  addImg.addEventListener('click', () => imgFile.click());
  imgFile.addEventListener('change', () => {
    void attach([...(imgFile.files ?? [])]);
    imgFile.value = '';
  });
  // an image on the clipboard goes in as a photo; text pastes as usual
  const onPaste = (e: ClipboardEvent) => {
    const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'));
    if (!files.length) return;
    e.preventDefault();
    void attach(files);
  };
  text.addEventListener('paste', onPaste);
  titleIn.addEventListener('paste', onPaste);
  const editorEl = $<HTMLElement>('.j-editor');
  editorEl.addEventListener('dragover', (e) => {
    if (![...(e.dataTransfer?.items ?? [])].some((i) => i.kind === 'file')) return;
    e.preventDefault();
    editorEl.classList.add('drop');
  });
  editorEl.addEventListener('dragleave', (e) => {
    if (!editorEl.contains(e.relatedTarget as Node)) editorEl.classList.remove('drop');
  });
  editorEl.addEventListener('drop', (e) => {
    const files = [...(e.dataTransfer?.files ?? [])];
    editorEl.classList.remove('drop');
    if (!files.length) return;
    e.preventDefault();
    // dropped on the text: they go where they fall
    const spot = document.caretRangeFromPoint?.(e.clientX, e.clientY);
    if (spot && text.contains(spot.startContainer)) {
      text.focus();
      getSelection()?.collapse(spot.startContainer, spot.startOffset);
    }
    void attach(files);
  });

  /** A photo onto the clipboard as an image (browsers take PNG, so other formats are redrawn as one). */
  async function copyPhoto(blob: Blob): Promise<void> {
    let png = blob;
    if (blob.type !== 'image/png') {
      const bmp = await createImageBitmap(blob);
      const c = document.createElement('canvas');
      c.width = bmp.width;
      c.height = bmp.height;
      c.getContext('2d')!.drawImage(bmp, 0, 0);
      bmp.close();
      png = await new Promise<Blob>((ok, fail) => c.toBlob((b) => (b ? ok(b) : fail(new Error('no png'))), 'image/png'));
    }
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
  }

  // full-size view: any click or Esc closes it
  const viewer = document.createElement('dialog');
  viewer.className = 'img-view';
  const big = document.createElement('img');
  big.alt = '';
  viewer.append(big);
  viewer.addEventListener('click', () => viewer.close());
  document.body.append(viewer);

  function renderPhotos(): void {
    const store = imagesStore();
    text.refreshImages();
    // under the text: only the photos not placed in it
    const placed = new Set(text.value.split('\n').flatMap((l) => IMG_LINE.exec(l)?.[1] ?? []));
    const list = store && openId() ? store.get(photoKey(openId()!)).filter((r) => !placed.has(r.id)) : [];
    gallery.hidden = !list.length;
    gallery.replaceChildren(...list.map((rec, k) => {
      const item = document.createElement('div');
      item.className = 'cal-img';
      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'cal-img-open';
      open.setAttribute('aria-label', `Open photo ${k + 1}`);
      const img = document.createElement('img');
      img.src = store!.url(rec);
      img.alt = '';
      img.loading = 'lazy';
      open.append(img);
      open.addEventListener('click', () => {
        big.src = store!.url(rec);
        viewer.showModal();
      });
      const copy = document.createElement('button');
      copy.type = 'button';
      copy.className = 'cal-img-del j-img-copy';
      copy.setAttribute('aria-label', `Copy photo ${k + 1}`);
      copy.title = 'Copy';
      copy.append(icon('copy'));
      copy.addEventListener('click', () => {
        void copyPhoto(rec.blob).then(() => tell('Photo copied'), () => tell('Couldn’t copy the photo'));
      });
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'cal-img-del';
      del.setAttribute('aria-label', `Remove photo ${k + 1}`);
      del.title = 'Remove';
      del.append(icon('x'));
      del.addEventListener('click', () => store!.remove(rec.id));
      item.append(open, copy, del);
      return item;
    }));
  }
  onImagesChanged(renderPhotos);

  return { photoUrl, renderPhotos };
}
