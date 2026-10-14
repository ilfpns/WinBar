import { mod } from './time';
import { CATEGORIES, CATEGORY_KEYS } from './model';
import { clearSelection, deleteSelected, state, subscribe, updateSelected } from './state';

/** Right-panel card shown while tasks are selected: apply one change to all of them. */
export function mountBulk(card: HTMLElement): void {
  const count = card.querySelector<HTMLElement>('#bulk-count')!;
  const err = card.querySelector<HTMLElement>('#bulk-err')!;
  const cats = card.querySelector<HTMLElement>('#bulk-cats')!;
  const del = card.querySelector<HTMLButtonElement>('[data-bulk="delete"]')!;

  cats.replaceChildren(...CATEGORY_KEYS.map((k) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.dataset.bulk = 'cat';
    b.dataset.cat = k;
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.setProperty('--c', `var(--cat-${k})`);
    b.append(dot, CATEGORIES[k]);
    return b;
  }));

  const run = (fail: string | null) => {
    err.textContent = fail ?? '';
  };

  card.addEventListener('click', (e) => {
    const btn = (e.target as Element).closest<HTMLElement>('[data-bulk]');
    if (!btn) return;
    const by = Number(btn.dataset.by ?? 0);
    switch (btn.dataset.bulk) {
      case 'done': return run(updateSelected((b) => ({ ...b, done: true })));
      case 'undone': return run(updateSelected((b) => ({ ...b, done: false })));
      case 'cat': {
        const cat = btn.dataset.cat as keyof typeof CATEGORIES;
        return run(updateSelected((b) => ({ ...b, cat })));
      }
      case 'move': return run(updateSelected((b) => ({ ...b, start: mod(b.start + by) })));
      case 'len': return run(updateSelected((b) => ({ ...b, dur: b.dur + by })));
      case 'clear': return clearSelection();
      case 'delete': return deleteSelected();
    }
  });

  let shownFor = '';
  function render(): void {
    const ids = state.selected;
    card.hidden = !ids.length;
    if (!ids.length) return;
    // a new selection starts without a stale error
    const key = ids.join();
    if (key !== shownFor) {
      shownFor = key;
      err.textContent = '';
    }
    const tasks = state.blocks.filter((b) => ids.includes(b.id));
    count.textContent = `${ids.length} selected`;
    del.textContent = `Delete ${ids.length}`;
    const shared = tasks.every((b) => b.cat === tasks[0]?.cat) ? tasks[0]?.cat : undefined;
    cats.querySelectorAll<HTMLElement>('.chip').forEach((c) => c.setAttribute('aria-checked', String(c.dataset.cat === shared)));
  }

  subscribe(render);
  render();
}
