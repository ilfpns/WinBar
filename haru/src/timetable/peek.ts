import { onViewing, watchTheirs } from '../cloud/viewing';
import { drawReadOnlyDial } from './dial';
import { type Block, isBlock } from './model';
import { svgEl } from './svg';

/**
 * Today, while someone else's Haru is on screen (see viewing): their day is laid over yours as the same
 * dial, in the same place — read only, live. Your own dial is only hidden underneath, never touched.
 */
export function mountPeek(stage: HTMLElement): void {
  const wrap = stage.querySelector<HTMLElement>('.dial-wrap')!;
  const face = svgEl('svg', { class: 'peek-dial', viewBox: '-520 -520 1040 1040', role: 'img' }) as SVGSVGElement;
  face.style.display = 'none';
  wrap.append(face);

  let stop: (() => void) | null = null;
  let shown: Block[] = [];
  let clock = 0;

  onViewing((who) => {
    stop?.();
    stop = null;
    clearInterval(clock);
    shown = [];
    wrap.classList.toggle('peeking', !!who);
    if (!who) {
      face.style.display = 'none';
      face.replaceChildren();
      return;
    }
    face.setAttribute('aria-label', `${who.name}’s Today (read only)`);
    face.style.display = '';
    drawReadOnlyDial(face, shown);
    stop = watchTheirs<{ blocks?: unknown[] }>('state/timetable', (data) => {
      shown = (data?.blocks ?? []).filter(isBlock).map((b) => ({ ...b, done: b.done === true }));
      drawReadOnlyDial(face, shown);
    });
    // keep their clock hand moving too
    clock = window.setInterval(() => drawReadOnlyDial(face, shown), 20_000);
  });
}
