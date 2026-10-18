import { onViewing, watchTheirs } from '../cloud/viewing';
import type { Word } from './words';

/**
 * Words, while someone else's Haru is on screen (see viewing): their word list in place of your cards —
 * word, meaning, example and how far along it is — read only and live. Your cards wait underneath.
 */
export function mountWordsPeek(page: HTMLElement): void {
  const body = page.querySelector<HTMLElement>('.pg-body')!;
  const panel = document.createElement('section');
  panel.className = 'wpeek glass-card';
  panel.hidden = true;
  page.append(panel);
  let stop: (() => void) | null = null;

  onViewing((who) => {
    stop?.();
    stop = null;
    body.hidden = !!who;
    panel.hidden = !who;
    if (!who) {
      panel.replaceChildren();
      return;
    }
    render(null);
    stop = watchTheirs<{ items?: Word[] }>('lists/words', (data, failed) =>
      render(failed ? null : (data?.items ?? []).filter((w) => w.deck !== 'ngsl'), failed));
  });

  function render(words: Word[] | null, failed?: boolean): void {
    const list = document.createElement('ol');
    list.className = 'wpeek-list';
    if (!words?.length) {
      const li = document.createElement('li');
      li.className = 'j-empty';
      li.textContent = failed ? 'Their words couldn’t be loaded.' : words ? 'No words yet' : 'Loading…';
      list.append(li);
      panel.replaceChildren(list);
      return;
    }
    // the words they added themselves first, then the course cards they have started, newest first
    const sorted = [...words].sort((a, b) => Number(a.deck === 'tsl') - Number(b.deck === 'tsl') || b.added - a.added);
    for (const w of sorted) {
      const li = document.createElement('li');
      li.innerHTML = '<span class="wpeek-word"></span><span class="wpeek-meaning"></span><span class="meta wpeek-box"></span><span class="wpeek-ex"></span>';
      li.querySelector('.wpeek-word')!.textContent = w.word;
      li.querySelector('.wpeek-meaning')!.textContent = w.meaning;
      li.querySelector('.wpeek-box')!.textContent = `${w.deck === 'tsl' ? 'TOEIC' : 'Mine'} · ${w.box}/5`;
      li.querySelector('.wpeek-ex')!.textContent = w.example ?? '';
      list.append(li);
    }
    const sum = document.createElement('p');
    sum.className = 'meta wpeek-sum';
    sum.textContent = `${words.length} words`;
    panel.replaceChildren(sum, list);
  }
}
