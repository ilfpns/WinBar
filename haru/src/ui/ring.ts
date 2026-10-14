import { type IconName, icon } from './icons';

/**
 * A progress ring around an icon with a short label: the stat is read from how full the ring is.
 * The exact value lives in the tooltip / accessible label.
 */
const SIZE = 100;
const STROKE = 7;
const RADIUS = (SIZE - STROKE) / 2;
const CIRC = 2 * Math.PI * RADIUS;

export interface Ring {
  el: HTMLElement;
  set(fraction: number, tip: string): void;
  setIcon(name: IconName): void;
}

export function ring(name: IconName, color: string, label?: string): Ring {
  const el = document.createElement('figure');
  el.className = 'ring';
  el.style.setProperty('--rc', color);
  el.innerHTML = `
    <div class="ring-dial" role="img">
      <svg class="ring-svg" viewBox="0 0 ${SIZE} ${SIZE}" aria-hidden="true">
        <circle class="ring-track" cx="50" cy="50" r="${RADIUS}" />
        <circle class="ring-fill" cx="50" cy="50" r="${RADIUS}" stroke-dasharray="${CIRC}" stroke-dashoffset="${CIRC}" />
      </svg>
    </div>`;
  const dial = el.querySelector<HTMLElement>('.ring-dial')!;
  const fill = el.querySelector<SVGCircleElement>('.ring-fill')!;
  let glyph = icon(name, 'ic ring-ic');
  dial.append(glyph);
  if (label) {
    const caption = document.createElement('figcaption');
    caption.textContent = label;
    el.append(caption);
  }
  return {
    el,
    set(fraction, tip) {
      const f = Math.min(1, Math.max(0, fraction));
      fill.style.strokeDashoffset = String(CIRC * (1 - f));
      el.classList.toggle('empty', f === 0);
      dial.dataset.tip = tip;
      dial.setAttribute('aria-label', tip);
    },
    setIcon(next) {
      const fresh = icon(next, 'ic ring-ic');
      glyph.replaceWith(fresh);
      glyph = fresh;
    },
  };
}
