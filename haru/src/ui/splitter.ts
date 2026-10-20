/**
 * Draggable seams between a page's panels: grab the gap between two of them and drag to give one more room.
 * The size goes into a CSS variable the page's layout reads (a grid column, or a card's height), is kept per
 * page in this browser, and a double-click on the seam puts it back. Only where the panels sit side by side
 * (or stacked, for a height); narrow screens stack everything and the seams hide.
 */
export interface SplitOptions {
  /** Remembered under `haru:split:<key>`. */
  key: string;
  /** 'x': a width (the seam stands between two columns); 'y': a height (the seam lies under the pane). */
  axis: 'x' | 'y';
  /** The panel whose size the seam changes. */
  pane: HTMLElement;
  /** The element the variable is set on (default: the host). */
  target?: HTMLElement;
  /** The CSS variable the layout reads, in px. */
  prop: string;
  /** For 'x': whether the pane is the column after the seam (it then grows as the seam moves left). */
  after?: boolean;
  min: number;
  /** The largest size, worked out when a drag starts. */
  max: () => number;
  /** Whether the seam applies right now (it hides otherwise). */
  enabled?: () => boolean;
}

const read = (key: string): number | null => {
  try {
    const v = Number(localStorage.getItem(`haru:split:${key}`));
    return v > 0 ? v : null;
  } catch {
    return null;
  }
};
const write = (key: string, v: number | null) => {
  try {
    if (v === null) localStorage.removeItem(`haru:split:${key}`);
    else localStorage.setItem(`haru:split:${key}`, String(Math.round(v)));
  } catch {
    // for this visit
  }
};

/** Puts a seam on `host` (the panels' common parent) for `o.pane`. */
export function addSplit(host: HTMLElement, o: SplitOptions): void {
  const target = o.target ?? host;
  const seam = document.createElement('div');
  seam.className = `split split-${o.axis}`;
  seam.setAttribute('role', 'separator');
  seam.setAttribute('aria-orientation', o.axis === 'x' ? 'vertical' : 'horizontal');
  seam.setAttribute('aria-label', 'Drag to resize · double-click to reset');
  seam.title = 'Drag to resize · double-click to reset';
  seam.tabIndex = 0;
  host.append(seam);

  const saved = read(o.key);
  if (saved) target.style.setProperty(o.prop, `${saved}px`);
  target.classList.toggle('split-sized', !!saved);

  /** Lays the seam over the gap beside (or under) the pane. */
  const place = () => {
    const hidden = !o.pane.offsetParent || (getComputedStyle(host).display === 'flex' && o.axis === 'x') || (o.enabled ? !o.enabled() : false);
    seam.hidden = hidden;
    if (hidden) return;
    const h = host.getBoundingClientRect();
    const p = o.pane.getBoundingClientRect();
    if (o.axis === 'x') {
      const gap = parseFloat(getComputedStyle(host).columnGap) || 16;
      const edge = o.after ? p.left - h.left - gap / 2 : p.right - h.left + gap / 2;
      seam.style.left = `${edge - 6}px`;
      seam.style.top = `${p.top - h.top + host.scrollTop}px`;
      seam.style.height = `${p.height}px`;
    } else {
      const gap = parseFloat(getComputedStyle(host).rowGap) || 16;
      seam.style.top = `${p.bottom - h.top + host.scrollTop + gap / 2 - 6}px`;
      seam.style.left = `${p.left - h.left}px`;
      seam.style.width = `${p.width}px`;
    }
  };
  new ResizeObserver(place).observe(host);
  new ResizeObserver(place).observe(o.pane);
  // (a window resize reaches the seam through the observers above, after layout, where measuring is free)
  requestAnimationFrame(place);

  const size = () => (o.axis === 'x' ? o.pane.getBoundingClientRect().width : o.pane.getBoundingClientRect().height);
  const set = (v: number) => {
    target.style.setProperty(o.prop, `${Math.round(v)}px`);
    target.classList.add('split-sized');
  };

  seam.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const start = o.axis === 'x' ? e.clientX : e.clientY;
    const from = size();
    const max = Math.max(o.min, o.max());
    let now = from;
    try {
      seam.setPointerCapture(e.pointerId);
    } catch {
      // a pointer that can't be captured still drags while over the seam
    }
    document.body.classList.add('splitting', `splitting-${o.axis}`);
    seam.classList.add('dragging');
    const move = (ev: PointerEvent) => {
      const d = (o.axis === 'x' ? ev.clientX : ev.clientY) - start;
      now = Math.max(o.min, Math.min(max, from + (o.after ? -d : d)));
      set(now);
      place();
    };
    const up = () => {
      seam.removeEventListener('pointermove', move);
      seam.removeEventListener('pointerup', up);
      seam.removeEventListener('pointercancel', up);
      document.body.classList.remove('splitting', `splitting-${o.axis}`);
      seam.classList.remove('dragging');
      if (Math.abs(now - from) >= 1) write(o.key, now);
    };
    seam.addEventListener('pointermove', move);
    seam.addEventListener('pointerup', up);
    seam.addEventListener('pointercancel', up);
  });
  // the keyboard: arrows nudge it
  seam.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 40 : 10;
    const back = o.axis === 'x' ? 'ArrowLeft' : 'ArrowUp';
    const fwd = o.axis === 'x' ? 'ArrowRight' : 'ArrowDown';
    if (e.key !== back && e.key !== fwd) return;
    e.preventDefault();
    const dir = (e.key === fwd ? 1 : -1) * (o.after ? -1 : 1);
    const v = Math.max(o.min, Math.min(o.max(), size() + dir * step));
    set(v);
    write(o.key, v);
    place();
  });
  seam.addEventListener('dblclick', () => {
    target.style.removeProperty(o.prop);
    target.classList.remove('split-sized');
    write(o.key, null);
    requestAnimationFrame(place);
  });
}
