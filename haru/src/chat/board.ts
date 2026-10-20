import { onSession, session, type Session } from '../cloud/session';
import { icon } from '../ui/icons';
import { askConfirm } from '../ui/modal';

/**
 * Drawing on the chat itself, like drawing on a story: a clear layer over the messages that everyone invited
 * shares. A stroke belongs to the message it was drawn over — it is kept as offsets from that message (across
 * as a share of the room's width, down in pixels from the message's top) — so it scrolls with the chat and sits
 * where it was drawn on every screen. Each stroke is a Firestore document, `board/{id}`, live for everyone.
 * The brush turns drawing on (a colour, a width, undo your last stroke, clear yours; owners: all); off, the
 * strokes stay in sight and the chat underneath scrolls and selects as usual.
 */
interface Stroke {
  uid: string;
  color: string;
  /** Width as a share of the room's width. */
  size: number;
  /** x, y, x, y…: x a share of the room's width, y pixels below the anchor message's top (or, on old strokes
   *  without an anchor, both shares of the layer). */
  pts: number[];
  /** The message the stroke was drawn over. */
  anchor?: string;
  at: number;
}
const COLORS = ['#f4f4f5', '#7ee2a8', '#2c9a5a', '#ffd166', '#ff7aa2', '#6ab0ff'];
const SIZES = [0.004, 0.009, 0.018];
const MAX_POINTS = 1500;

/** `list` is the chat's scrolling list of messages (each `li` carries its message's id in `data-id`). */
export function mountBoard(room: HTMLElement, list: HTMLElement, opener: HTMLButtonElement): void {
  const panel = document.createElement('div');
  panel.className = 'board';
  panel.innerHTML = `
    <div class="board-bar">
      <div class="board-colors" role="radiogroup" aria-label="Colour"></div>
      <div class="board-sizes" role="radiogroup" aria-label="Width"></div>
      <span class="board-fill"></span>
      <button type="button" class="icon-btn board-undo" aria-label="Undo my last stroke" title="Undo my last stroke"></button>
      <button type="button" class="icon-btn board-clear" aria-label="Clear my drawing" title="Clear my drawing"></button>
      <button type="button" class="btn-sm board-close">Done</button>
    </div>
    <canvas class="board-canvas" aria-label="Shared board"></canvas>
    <p class="board-note" hidden></p>`;
  room.append(panel);
  const canvas = panel.querySelector<HTMLCanvasElement>('.board-canvas')!;
  const g = canvas.getContext('2d')!;
  const note = panel.querySelector<HTMLElement>('.board-note')!;
  panel.querySelector('.board-undo')!.append(icon('rotate-ccw'));
  panel.querySelector('.board-clear')!.append(icon('eraser'));
  opener.append(icon('brush'));

  let color = COLORS[1]!;
  let size = SIZES[1]!;
  const colorsEl = panel.querySelector<HTMLElement>('.board-colors')!;
  const sizesEl = panel.querySelector<HTMLElement>('.board-sizes')!;
  const paintPicks = () => {
    colorsEl.querySelectorAll<HTMLElement>('button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.c === color)));
    sizesEl.querySelectorAll<HTMLElement>('button').forEach((b) => b.setAttribute('aria-checked', String(Number(b.dataset.s) === size)));
  };
  colorsEl.append(...COLORS.map((c) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.dataset.c = c;
    b.style.setProperty('--c', c);
    b.setAttribute('aria-label', c);
    b.addEventListener('click', () => {
      color = c;
      paintPicks();
    });
    return b;
  }));
  sizesEl.append(...SIZES.map((sz, k) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.dataset.s = String(sz);
    b.style.setProperty('--d', `${4 + k * 4}px`);
    b.setAttribute('aria-label', ['Thin', 'Medium', 'Thick'][k]!);
    b.addEventListener('click', () => {
      size = sz;
      paintPicks();
    });
    return b;
  }));
  paintPicks();

  let strokes: { id: string; s: Stroke }[] = [];
  let live: Stroke | null = null;
  let stop: (() => void) | null = null;

  // ---- the layer lies exactly over the list of messages, crisp on any screen
  const fit = () => {
    const lr = list.getBoundingClientRect();
    const rr = room.getBoundingClientRect();
    Object.assign(panel.style, { left: `${lr.left - rr.left}px`, top: `${lr.top - rr.top}px`, width: `${lr.width}px`, height: `${lr.height}px` });
    const dpr = devicePixelRatio || 1;
    const w = Math.max(1, Math.round(lr.width * dpr));
    const h = Math.max(1, Math.round(lr.height * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    redraw();
  };
  new ResizeObserver(fit).observe(list);
  // the messages move under it: scrolling, new messages, photos arriving
  let queued = 0;
  const soon = () => {
    if (queued) return;
    queued = requestAnimationFrame(() => {
      queued = 0;
      redraw();
    });
  };
  list.addEventListener('scroll', soon, { passive: true });
  new MutationObserver(soon).observe(list, { childList: true });
  list.addEventListener('load', soon, true);

  /** Where an anchor message's top is on the layer now (CSS px), or null when it isn't on the page. */
  const anchorTop = (id: string): number | null => {
    const li = list.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"]`);
    return li ? li.offsetTop - list.scrollTop : null;
  };
  /** A stroke's points in device pixels on the layer (null: its message isn't here). */
  function place(s: Stroke): number[] | null {
    const dpr = devicePixelRatio || 1;
    const W = canvas.width;
    if (!s.anchor) return s.pts.map((v, i) => v * (i % 2 ? canvas.height : W));
    const top = anchorTop(s.anchor);
    if (top === null) return null;
    return s.pts.map((v, i) => (i % 2 ? (top + v) * dpr : v * W));
  }
  function line(s: Stroke): void {
    const p = place(s);
    if (!p || p.length < 2) return;
    // nothing to draw when the whole stroke is above or below the layer
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 1; i < p.length; i += 2) {
      lo = Math.min(lo, p[i]!);
      hi = Math.max(hi, p[i]!);
    }
    const pad = s.size * canvas.width;
    if (hi < -pad || lo > canvas.height + pad) return;
    g.strokeStyle = s.color;
    g.fillStyle = s.color;
    g.lineWidth = Math.max(1, s.anchor ? s.size * canvas.width : s.size * Math.min(canvas.width, canvas.height));
    g.lineCap = 'round';
    g.lineJoin = 'round';
    if (p.length === 2) {
      g.beginPath();
      g.arc(p[0]!, p[1]!, g.lineWidth / 2, 0, Math.PI * 2);
      g.fill();
      return;
    }
    // smooth: a curve through the midpoints
    g.beginPath();
    g.moveTo(p[0]!, p[1]!);
    for (let i = 2; i < p.length - 2; i += 2) g.quadraticCurveTo(p[i]!, p[i + 1]!, (p[i]! + p[i + 2]!) / 2, (p[i + 1]! + p[i + 3]!) / 2);
    g.lineTo(p[p.length - 2]!, p[p.length - 1]!);
    g.stroke();
  }
  function redraw(): void {
    g.clearRect(0, 0, canvas.width, canvas.height);
    for (const { s } of strokes) line(s);
    if (live) line(live);
  }

  // ---- drawing: a stroke takes the message under its first point as its anchor
  const layerXY = (e: PointerEvent): [number, number] => {
    const r = canvas.getBoundingClientRect();
    return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), e.clientY - r.top];
  };
  function anchorAt(y: number): string | null {
    // the last message whose top is above the point (or the first one, above them all)
    const msgs = [...list.querySelectorAll<HTMLElement>('[data-id]')];
    if (!msgs.length) return null;
    const contentY = y + list.scrollTop;
    let pick = msgs[0]!;
    for (const li of msgs) {
      if (li.offsetTop <= contentY) pick = li;
      else break;
    }
    return pick.dataset.id!;
  }
  const round = (v: number, k: number) => Math.round(v * k) / k;
  canvas.addEventListener('pointerdown', (e) => {
    const s = session();
    if (!s || e.button !== 0) return;
    const [x, y] = layerXY(e);
    const anchor = anchorAt(y);
    if (!anchor) return say('Write a message first: drawings stay with the messages');
    e.preventDefault();
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // drawing still follows while over the layer
    }
    const top = anchorTop(anchor)!;
    live = { uid: s.uid, color, size, anchor, pts: [round(x, 10000), round(y - top, 10)], at: Date.now() };
    redraw();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!live?.anchor || live.pts.length >= MAX_POINTS * 2) return;
    const [x, y] = layerXY(e);
    const top = anchorTop(live.anchor);
    if (top === null) return;
    const px = round(x, 10000);
    const py = round(y - top, 10);
    const n = live.pts.length;
    // skip points too close to the last one (keeps strokes light)
    if (Math.hypot((px - live.pts[n - 2]!) * canvas.clientWidth, py - live.pts[n - 1]!) < 2) return;
    live.pts.push(px, py);
    redraw();
  });
  // the wheel still scrolls the chat while drawing (the stroke follows its message)
  canvas.addEventListener('wheel', (e) => {
    list.scrollTop += e.deltaY;
    e.preventDefault();
  }, { passive: false });
  const end = async () => {
    const s = session();
    const done = live;
    live = null;
    if (!s || !done) return;
    // shown at once; the snapshot replaces it when the write lands
    const tmp = { id: `local-${done.at}`, s: done };
    strokes.push(tmp);
    redraw();
    const { fs, db } = s.fb;
    try {
      await fs.addDoc(fs.collection(db, 'board'), done);
    } catch (x) {
      strokes = strokes.filter((t) => t !== tmp);
      redraw();
      say(String((x as { code?: string })?.code ?? '').includes('permission')
        ? 'The board isn’t allowed yet: the Firestore rules need publishing again'
        : 'Couldn’t save that stroke. Check your connection.');
    }
  };
  canvas.addEventListener('pointerup', () => void end());
  canvas.addEventListener('pointercancel', () => void end());

  let noteTimer = 0;
  function say(text: string): void {
    note.textContent = text;
    note.hidden = false;
    clearTimeout(noteTimer);
    noteTimer = window.setTimeout(() => (note.hidden = true), 4000);
  }

  // ---- your strokes: undo the last, clear them; an owner may clear the whole board
  const mine = () => {
    const s = session();
    return s ? strokes.filter((t) => t.s.uid === s.uid && !t.id.startsWith('local-')) : [];
  };
  panel.querySelector('.board-undo')!.addEventListener('click', () => {
    const s = session();
    const last = mine().at(-1);
    if (!s || !last) return;
    const { fs, db } = s.fb;
    void fs.deleteDoc(fs.doc(db, 'board', last.id)).catch(() => {});
  });
  panel.querySelector('.board-clear')!.addEventListener('click', async () => {
    const s = session();
    if (!s) return;
    const all = s.owner;
    const doomed = all ? strokes.filter((t) => !t.id.startsWith('local-')) : mine();
    if (!doomed.length) return;
    if (!(await askConfirm({ title: all ? 'Clear the whole board?' : 'Clear your drawing?', body: all ? 'Everyone’s strokes go.' : 'Only your strokes go.', danger: true }))) return;
    const { fs, db } = s.fb;
    await Promise.all(doomed.map((t) => fs.deleteDoc(fs.doc(db, 'board', t.id)).catch(() => {})));
  });

  // ---- drawing on or off: the layer always shows; only while drawing does it take the pointer
  const drawing = () => panel.classList.contains('drawing');
  function setDrawing(on: boolean): void {
    panel.classList.toggle('drawing', on);
    opener.setAttribute('aria-pressed', String(on));
    requestAnimationFrame(fit);
  }
  opener.addEventListener('click', () => setDrawing(!drawing()));
  panel.querySelector('.board-close')!.addEventListener('click', () => setDrawing(false));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && drawing() && !document.querySelector('dialog[open]')) setDrawing(false);
  });

  function listen(s: Session | null): void {
    stop?.();
    stop = null;
    strokes = [];
    panel.querySelector<HTMLButtonElement>('.board-clear')!.title = s?.owner ? 'Clear the whole board' : 'Clear my drawing';
    if (s) {
      const { fs, db } = s.fb;
      stop = fs.onSnapshot(fs.query(fs.collection(db, 'board'), fs.orderBy('at', 'asc'), fs.limit(1500)), (snap) => {
        strokes = snap.docs.map((d) => ({ id: d.id, s: d.data() as Stroke }));
        redraw();
      }, () => say('The board couldn’t be loaded. Check your connection.'));
    }
    redraw();
  }
  onSession(listen);
  listen(session());
  requestAnimationFrame(fit);
}
