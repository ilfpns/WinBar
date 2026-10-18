import { onViewing, watchTheirList } from '../cloud/viewing';
import { renderMarkdown } from '../ui/markdown';
import type { NoteRecord } from './notes';

const fmtDay = (date: string) => new Date(`${date}T00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });

/**
 * Calendar, while someone else's Haru is on screen (see viewing): their day memos, newest first, the
 * open one rendered beside them — read only and live. Your month waits underneath.
 */
export function mountCalendarPeek(page: HTMLElement): void {
  const own = [...page.querySelectorAll<HTMLElement>('.cal-filters, .cal-body, .cal-nav')];
  const panel = document.createElement('div');
  panel.className = 'journal-body cpeek';
  panel.hidden = true;
  panel.innerHTML = `
    <aside class="j-side glass-card" aria-label="Their memos"><ul class="j-list"></ul></aside>
    <article class="a-reader glass-card" aria-live="polite"></article>`;
  page.append(panel);
  const list = panel.querySelector<HTMLUListElement>('.j-list')!;
  const reader = panel.querySelector<HTMLElement>('.a-reader')!;

  let memos: NoteRecord[] | null = [];
  let openDate: string | null = null;
  let stop: (() => void) | null = null;

  onViewing((who) => {
    stop?.();
    stop = null;
    memos = [];
    openDate = null;
    own.forEach((el) => (el.hidden = !!who));
    panel.hidden = !who;
    if (!who) return;
    render();
    stop = watchTheirList<NoteRecord>('notes', (docs) => {
      memos = docs && docs.filter((n) => n.text?.trim()).sort((a, b) => b.date.localeCompare(a.date));
      render();
    });
  });

  function render(): void {
    if (!memos?.length) {
      const li = document.createElement('li');
      li.className = 'j-empty';
      li.textContent = memos ? 'No memos yet' : 'Their memos couldn’t be loaded.';
      list.replaceChildren(li);
      reader.replaceChildren();
      return;
    }
    const open = memos.find((m) => m.date === openDate) ?? memos[0]!;
    openDate = open.date;
    list.replaceChildren(...memos.map((m) => {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `j-item${m.date === openDate ? ' on' : ''}`;
      b.innerHTML = '<span class="j-i-top"><span class="j-i-title"></span></span><span class="j-i-prev"></span>';
      b.querySelector('.j-i-title')!.textContent = fmtDay(m.date);
      // the first lines as words, without their Markdown marks
      const lines = m.text.split(/\r?\n/).map((l) => l.replace(/^\s*(#{1,6} |[-*] \[[ xX]\] |[-*+] |\d+\. |> )/, '').replace(/\*\*|__|~~|`/g, '').trim());
      b.querySelector('.j-i-prev')!.textContent = lines.filter(Boolean).slice(0, 2).join(' · ').slice(0, 120);
      b.addEventListener('click', () => {
        openDate = m.date;
        render();
      });
      li.append(b);
      return li;
    }));
    const title = document.createElement('h2');
    title.className = 'a-title';
    title.textContent = fmtDay(open.date);
    const text = document.createElement('div');
    text.className = 'md-view a-text';
    // rendered from escaped text: nothing in someone's memo can inject markup
    text.innerHTML = renderMarkdown(open.text);
    reader.replaceChildren(title, text);
  }
}
