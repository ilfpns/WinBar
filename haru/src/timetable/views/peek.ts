import { onViewing, watchTheirToday } from '../../cloud/viewing';
import { drawReadOnlyDial } from '../dial';
import { type Block } from '../model';
import { svgEl } from '../svg';

/**
 * Today, while someone else's Haru is on screen (see viewing): their day is laid over yours as the same
 * dial, in the same place — read only, live. Your own dial is only hidden underneath, never touched. Until their
 * Haru has begun today, the dial is empty with a dash in the middle (what they hold is still an earlier day's).
 */
export function mountPeek(stage: HTMLElement): void {
  const wrap = stage.querySelector<HTMLElement>('.dial-wrap')!;
  const face = svgEl('svg', { class: 'peek-dial', viewBox: '-520 -520 1040 1040', role: 'img' }) as SVGSVGElement;
  face.style.display = 'none';
  wrap.append(face);

  let stop: (() => void) | null = null;
  let shown: Block[] = [];
  let started = true;
  let clock = 0;
  const draw = () => drawReadOnlyDial(face, shown, started ? {} : { center: '–' });

  onViewing((who) => {
    stop?.();
    stop = null;
    clearInterval(clock);
    shown = [];
    started = true;
    wrap.classList.toggle('peeking', !!who);
    if (!who) {
      face.style.display = 'none';
      face.replaceChildren();
      return;
    }
    face.setAttribute('aria-label', `${who.name}’s Today (read only)`);
    face.style.display = '';
    draw();
    stop = watchTheirToday((blocks) => {
      started = !!blocks;
      shown = blocks ?? [];
      draw();
    });
    // keep their clock hand moving too
    clock = window.setInterval(draw, 20_000);
  });
}
