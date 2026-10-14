import { createGlobe, type GeoPoint } from './globe';
import { currentView, onView } from '../ui/router';

const SEOUL: GeoPoint = { lat: 37.57, lon: 126.98 };

const fmt = (p: GeoPoint) =>
  `${Math.abs(p.lat).toFixed(1)}°${p.lat >= 0 ? 'N' : 'S'}  ${Math.abs(p.lon).toFixed(1)}°${p.lon >= 0 ? 'E' : 'W'}`;

/** News page: for now, the interactive dot globe the headlines will hang off. */
export function mountNews(canvas: HTMLCanvasElement, readout: HTMLElement, date: HTMLElement): void {
  date.textContent = new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  fetch(`${import.meta.env.BASE_URL}data/globe.json`)
    .then((r) => r.json() as Promise<{ points: [number, number][] }>)
    .then(({ points }) => {
      const globe = createGlobe(canvas, points, SEOUL);
      globe.onReadout((p, pinned) => {
        readout.textContent = p ? fmt(p) : '';
        readout.classList.toggle('pinned', pinned);
      });
      // spin only while the page is on screen (including while it slides in)
      const sync = () => globe.setActive(currentView() === 'news' || document.body.classList.contains('switching'));
      onView(() => {
        globe.setActive(true);
        setTimeout(sync, 700);
      });
      sync();
    })
    .catch(() => {});
}
