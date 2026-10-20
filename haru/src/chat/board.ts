import { onSession, session, type Session } from '../cloud/session';
import { icon } from '../ui/icons';
import { askConfirm } from '../ui/modal';

/**
 * The board: one shared drawing surface over the chat, like drawing on a story. Everyone invited draws on the same
 * board and sees the others' strokes as they land (each stroke is a Firestore document, `board/{id}`, in
 * coordinates relative to the board so any screen size shows the same picture). Pick a colour and a width; undo
 * your last stroke, clear yours, or (owners) clear it all; "Send to chat" puts the board as it is into your next
 * message as a photo.
 */
interface Stroke {
  uid: string;
  color: string;
  /** Width as a share of the board's shorter side. */
  size: number;
  /** x, y, x, y… each 0..1 of the board. */
  pts: number[];
  at: number;
}
const COLORS = ['#f4f4f5', '#7ee2a8', '#2c9a5a', '#ffd166', '#ff7aa2', '#6ab0ff'];
const SIZES = [0.004, 0.009, 0.018];
const MAX_POINTS = 1500;

export function mountBoard(room: HTMLElement, opener: HTMLButtonElement, sendToChat: (png: Blob) => void): void {
  const panel = document.createElement('div');
  panel.className = 'board';
  panel.hidden = true;
  panel.innerHTML = `
    <div class="board-bar">
      <div class="board-colors" role="radiogroup" aria-label="Colour"></div>
      <div class="board-sizes" role="radiogroup" aria-label="Width"></div>
      <span class="board-fill"></span>
      <button type="button" class="icon-btn board-undo" aria-label="Undo my last stroke" title="Undo my last stroke"></button>
      <button type="button" class="icon-btn board-clear" aria-label="Clear my drawing" title="Clear my drawing"></button>
      <button type="button" class="btn-sm board-send">Send to chat</button>
      <button type="button" class="icon-btn board-close" aria-label="Close the board" title="Close  Esc"></button>
    </div>
    <canvas class="board-canvas" aria-label="Shared board"></canvas>
    <p class="board-note" hidden></p>`;
  room.append(panel);
  const canvas = panel.querySelector<HTMLCanvasElement>('.board-canvas')!;
  const g = canvas.getContext('2d')!;
  const note = panel.querySelector<HTMLElement>('.board-note')!;
  panel.querySelector('.board-undo')!.append(icon('rotate-ccw'));
  panel.querySelector('.board-clear')!.append(icon('eraser'));
  panel.querySelector('.board-close')!.append(icon('x'));
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

  // ---- drawing: the board's own size, crisp on any screen; every stroke redrawn on a resize
  const fit = () => {
    const r = canvas.getBoundingClientRect();
    const dpr = devicePixelRatio || 1;
    const w = Math.max(1, Math.round(r.width * dpr));
    const h = Math.max(1, Math.round(r.height * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    redraw();
  };
  new ResizeObserver(fit).observe(canvas);
  function line(s: Stroke): void {
    const W = canvas.width;
    const H = canvas.height;
    const p = s.pts;
    if (p.length < 2) return;
    g.strokeStyle = s.color;
    g.fillStyle = s.color;
    g.lineWidth = Math.max(1, s.size * Math.min(W, H));
    g.lineCap = 'round';
    g.lineJoin = 'round';
    if (p.length === 2) {
      g.beginPath();
      g.arc(p[0]! * W, p[1]! * H, g.lineWidth / 2, 0, Math.PI * 2);
      g.fill();
      return;
    }
    // smooth: a curve through the midpoints
    g.beginPath();
    g.moveTo(p[0]! * W, p[1]! * H);
    for (let i = 2; i < p.length - 2; i += 2) {
      const mx = ((p[i]! + p[i + 2]!) / 2) * W;
      const my = ((p[i + 1]! + p[i + 3]!) / 2) * H;
      g.quadraticCurveTo(p[i]! * W, p[i + 1]! * H, mx, my);
    }
    g.lineTo(p[p.length - 2]! * W, p[p.length - 1]! * H);
    g.stroke();
  }
  function redraw(): void {
    g.clearRect(0, 0, canvas.width, canvas.height);
    for (const { s } of strokes) line(s);
    if (live) line(live);
  }

  const at = (e: PointerEvent): [number, number] => {
    const r = canvas.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    return [Math.round(x * 10000) / 10000, Math.round(y * 10000) / 10000];
  };
  canvas.addEventListener('pointerdown', (e) => {
    const s = session();
    if (!s || e.button !== 0) return;
    e.preventDefault();
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // drawing still follows while over the board
    }
    live = { uid: s.uid, color, size, pts: [...at(e)], at: Date.now() };
    redraw();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!live || live.pts.length >= MAX_POINTS * 2) return;
    const [x, y] = at(e);
    const n = live.pts.length;
    // skip points too close to the last one (keeps strokes light)
    if (Math.hypot(x - live.pts[n - 2]!, y - live.pts[n - 1]!) < 0.002) return;
    live.pts.push(x, y);
    redraw();
  });
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

  // ---- the board into the chat, as a photo (on the board's dark ground)
  panel.querySelector('.board-send')!.addEventListener('click', () => {
    const c = document.createElement('canvas');
    c.width = canvas.width;
    c.height = canvas.height;
    const cg = c.getContext('2d')!;
    cg.fillStyle = getComputedStyle(canvas).backgroundColor || '#121417';
    cg.fillRect(0, 0, c.width, c.height);
    cg.drawImage(canvas, 0, 0);
    c.toBlob((b) => {
      if (!b) return;
      sendToChat(b);
      close();
    }, 'image/png');
  });

  function open(): void {
    panel.hidden = false;
    opener.setAttribute('aria-pressed', 'true');
    requestAnimationFrame(fit);
  }
  function close(): void {
    panel.hidden = true;
    opener.setAttribute('aria-pressed', 'false');
  }
  opener.addEventListener('click', () => (panel.hidden ? open() : close()));
  panel.querySelector('.board-close')!.addEventListener('click', close);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !panel.hidden && !document.querySelector('dialog[open]')) close();
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
}
