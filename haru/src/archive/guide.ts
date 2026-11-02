import { featureOn, type Feature } from '../ui/features';
import { icon } from '../ui/icons';
import { lang } from '../ui/i18n';
import { goTo, type View } from '../ui/router';
import { TOURS, resetTours, startTour, tourSeen } from '../ui/tour';

/**
 * 사용 안내, pinned in the Archive under the notices: every page's tour, to see again. Pick a page and its tour
 * plays there; Show all again makes every page's tour come up the next time it is opened.
 */
const ko = () => lang() === 'ko';

/** The pinned item for the list. */
export function guideItem(on: boolean, open: () => void): HTMLLIElement {
  const li = document.createElement('li');
  li.className = 'a-pin';
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `j-item a-pin-item${on ? ' on' : ''}`;
  b.innerHTML = '<span class="j-i-top"><span class="j-i-title"></span><span class="meta j-i-date"></span></span><span class="a-by meta">Haru</span>';
  b.querySelector('.j-i-title')!.textContent = '사용 안내';
  b.querySelector('.j-i-date')!.textContent = ko() ? '다시 보기' : 'Tours';
  b.querySelector('.j-i-top')!.prepend(icon('pin', 'ic a-pin-ic'));
  b.addEventListener('click', open);
  li.append(b);
  return li;
}

/** The page: one row per page with its tour, Show all again at the end. */
export function guidePage(repaint: () => void): HTMLElement[] {
  const head = document.createElement('div');
  head.className = 'j-ed-head';
  const by = document.createElement('span');
  by.className = 'a-by a-by-lg';
  by.append(icon('pin', 'ic a-pin-ic'), '고정됨');
  head.append(by);
  const title = document.createElement('h2');
  title.className = 'a-title';
  title.textContent = '사용 안내';
  const lead = document.createElement('p');
  lead.className = 'guide-lead';
  lead.textContent = ko()
    ? '페이지마다 처음 열 때 짧은 안내가 한 번 떠요. 다시 보고 싶은 페이지를 고르면 그 페이지로 가서 안내가 시작돼요.'
    : 'Each page shows a short tour the first time you open it. Pick a page to go there and see its tour again.';
  const list = document.createElement('div');
  list.className = 'guide-list';
  for (const v of Object.keys(TOURS) as View[]) {
    if (v !== 'today' && !featureOn(v as Feature)) continue;
    const t = TOURS[v];
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'guide-row';
    const name = document.createElement('span');
    name.className = 'guide-name';
    name.textContent = t.name[ko() ? 1 : 0];
    const meta = document.createElement('span');
    meta.className = 'meta guide-meta';
    meta.textContent = `${t.steps.length} ${ko() ? '단계' : 'steps'} · ${tourSeen(v) ? (ko() ? '봤음' : 'seen') : (ko() ? '아직 안 봄' : 'not seen yet')}`;
    const go = document.createElement('span');
    go.className = 'guide-go';
    go.append(ko() ? '다시 보기' : 'Show', icon('chevron-right'));
    row.append(name, meta, go);
    row.addEventListener('click', () => {
      goTo(v);
      // after the page has turned in
      setTimeout(() => startTour(v, repaint), 650);
    });
    list.append(row);
  }
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'btn-sm guide-reset';
  reset.append(icon('refresh'), ko() ? '모든 안내 다시 켜기' : 'Show all again');
  reset.title = ko() ? '각 페이지를 다음에 열 때 안내가 다시 떠요' : 'Each page shows its tour again the next time it opens';
  reset.addEventListener('click', () => {
    resetTours();
    repaint();
  });
  return [head, title, lead, list, reset];
}
