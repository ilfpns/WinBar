import { onViewing, watchTheirs } from '../cloud/viewing';
import { renderMarkdown } from '../ui/markdown';
import type { Entry, Folder } from './journal';

const fmtDay = (date: string) => new Date(`${date}T00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });

/**
 * Journal, while someone else's Haru is on screen (see viewing): their pages, newest first with the
 * folder each is in, and the open one rendered beside them — read only and live.
 */
export function mountJournalPeek(page: HTMLElement): void {
  const body = page.querySelector<HTMLElement>('.pg-body')!;
  const panel = document.createElement('div');
  panel.className = 'pg-body journal-body jpeek';
  panel.hidden = true;
  panel.innerHTML = `
    <aside class="j-side glass-card" aria-label="Their pages"><ul class="j-list"></ul></aside>
    <article class="a-reader glass-card" aria-live="polite"></article>`;
  page.append(panel);
  const list = panel.querySelector<HTMLUListElement>('.j-list')!;
  const reader = panel.querySelector<HTMLElement>('.a-reader')!;

  let pages: Entry[] = [];
  let folders: Folder[] = [];
  let openId: string | null = null;
  let stops: (() => void)[] = [];
  let failed = false;

  onViewing((who) => {
    stops.forEach((s) => s());
    stops = [];
    pages = [];
    folders = [];
    openId = null;
    failed = false;
    body.hidden = !!who;
    panel.hidden = !who;
    if (!who) return;
    render();
    stops = [
      watchTheirs<{ items?: Entry[] }>('lists/journal', (data, bad) => {
        failed = !!bad;
        pages = [...(data?.items ?? [])].sort((a, b) => b.date.localeCompare(a.date) || b.created - a.created);
        render();
      }),
      watchTheirs<{ items?: Folder[] }>('lists/journal-folders', (data) => {
        folders = data?.items ?? [];
        render();
      }),
    ];
  });

  function render(): void {
    if (!pages.length) {
      const li = document.createElement('li');
      li.className = 'j-empty';
      li.textContent = failed ? 'Their pages couldn’t be loaded.' : 'No pages yet';
      list.replaceChildren(li);
      reader.replaceChildren();
      return;
    }
    const open = pages.find((p) => p.id === openId) ?? pages[0]!;
    openId = open.id;
    const folderName = (id?: string) => folders.find((f) => f.id === id)?.name ?? '';
    list.replaceChildren(...pages.map((p) => {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `j-item${p.id === openId ? ' on' : ''}`;
      b.innerHTML = '<span class="j-i-top"><span class="j-i-title"></span><span class="meta j-i-date"></span></span><span class="a-by"></span>';
      b.querySelector('.j-i-title')!.textContent = p.title || 'Untitled';
      b.querySelector('.j-i-date')!.textContent = fmtDay(p.date).replace(/, \d{4}$/, '');
      b.querySelector('.a-by')!.textContent = folderName(p.folder);
      b.addEventListener('click', () => {
        openId = p.id;
        render();
      });
      li.append(b);
      return li;
    }));
    const head = document.createElement('div');
    head.className = 'j-ed-head';
    const date = document.createElement('span');
    date.className = 'j-date';
    date.textContent = fmtDay(open.date);
    const folder = document.createElement('span');
    folder.className = 'meta';
    folder.textContent = folderName(open.folder);
    head.append(date, folder);
    const title = document.createElement('h2');
    title.className = 'a-title';
    title.textContent = open.title || 'Untitled';
    const text = document.createElement('div');
    text.className = 'md-view a-text';
    // rendered from escaped text: nothing in someone's page can inject markup
    text.innerHTML = renderMarkdown(open.body);
    reader.replaceChildren(head, title, text);
  }
}
