import { listStore } from '../storage/list-store';
import { dayKey } from '../timetable/history';
import { icon } from '../ui/icons';
import { currentView, onView } from '../ui/router';
import { askConfirm } from '../ui/modal';

/**
 * Words: English vocabulary on flashcards. Each word sits in a box (0–5); knowing it moves it up a box and
 * further out (Leitner spacing), missing it sends it back to box 0 and round again in the same session.
 *
 * Decks: TOEIC (TSL) comes from the built-in word list (public/data/words.json) — each day up to NEW_PER_DAY
 * of its words join the cards — and My words are the ones you add. Cards show the word, then its Korean
 * meaning; the English definition on request.
 */
/** 'ngsl' was the Basic deck (since dropped): such cards stay saved, just out of sight. */
export type Deck = 'tsl' | 'ngsl' | 'mine';
export interface Word {
  id: string;
  word: string;
  /** Korean meaning (or, for your own words, whatever meaning you wrote). */
  meaning: string;
  /** English definition; may be empty. */
  def?: string;
  example: string;
  deck?: Deck;
  box: number;
  /** YYYY-MM-DD: the day it is next asked. */
  due: string;
  added: number;
  right: number;
  wrong: number;
}

const NEW_PER_DAY = 20;
/** Days until the next review after landing in box 0..5. */
const INTERVAL = [0, 1, 2, 4, 8, 16];
const MAX_BOX = INTERVAL.length - 1;
const DECKS: { id: Deck; label: string }[] = [
  { id: 'tsl', label: 'TOEIC' },
  { id: 'mine', label: 'My words' },
];
const DECKS_KEY = 'haru:words-decks';

const isWord = (v: unknown): v is Word => {
  const w = v as Partial<Word> | null;
  return !!w && typeof w.id === 'string' && typeof w.word === 'string' && typeof w.meaning === 'string';
};
export const wordsStore = listStore<Word>('words', isWord);
const deckOf = (w: Word): Deck => w.deck ?? 'mine';
/** Every card but those of the dropped Basic deck. */
const shownWords = () => wordsStore.all().filter((w) => deckOf(w) !== 'ngsl');

/** The built-in list: [word, English definition, Korean] in frequency order. */
interface Library { decks: { tsl: [string, string, string][] } }
let library: Library | null = null;
let loading: Promise<Library | null> | null = null;
function loadLibrary(): Promise<Library | null> {
  loading ??= fetch(`${import.meta.env.BASE_URL}data/words.json?v=${__BUILD_ID__}`)
    .then((r) => (r.ok ? (r.json() as Promise<Library>) : null))
    .then((l) => (library = l))
    .catch(() => null);
  return loading;
}

const addDays = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return dayKey(d);
};
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const shuffle = <T>(a: T[]): T[] => {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
};
const startOfToday = () => new Date(`${dayKey()}T00:00`).getTime();
/** "word - meaning", "word: meaning", "word, meaning" or tab-separated, one per line. */
function parseLine(line: string): { word: string; meaning: string } | null {
  const m = line.match(/^\s*(.+?)\s*(?:\t|\s[-–—=]\s|:|,)\s*(.+?)\s*$/);
  return m ? { word: m[1]!, meaning: m[2]! } : null;
}

export function mountWords(body: HTMLElement, sum: HTMLElement): void {
  const canSpeak = 'speechSynthesis' in window;
  body.innerHTML = `
    <section class="w-study glass-card" aria-label="Study">
      <div class="w-study-head">
        <div class="seg w-mode" role="group" aria-label="Cards">
          <button type="button" data-mode="due" aria-pressed="true">Today</button>
          <button type="button" data-mode="all" aria-pressed="false">All</button>
        </div>
        <div class="w-decks" role="group" aria-label="Decks"></div>
        <span class="meta w-left"></span>
      </div>
      <div class="w-stage">
        <button type="button" class="w-card" aria-live="polite">
          <span class="w-front">
            <span class="w-tag meta"></span>
            <span class="w-word"></span>
            <span class="meta w-hint">Space to flip</span>
          </span>
          <span class="w-back">
            <span class="w-word-sm"></span>
            <span class="w-def"></span>
            <span class="w-ko"></span>
            <span class="w-example"></span>
          </span>
        </button>
        <div class="w-card-tools">
          <button type="button" class="icon-btn w-say" aria-label="Pronounce (p)" title="Pronounce  p"></button>
          <button type="button" class="w-ko-btn" aria-pressed="false" title="English definition  e">EN</button>
        </div>
        <div class="w-done" hidden>
          <strong>All caught up</strong>
          <span class="meta w-done-sub"></span>
          <button type="button" class="btn-sm w-again-all">Review all words</button>
        </div>
      </div>
      <div class="w-actions">
        <button type="button" class="w-btn w-miss"><span>Again</span><kbd>←</kbd></button>
        <button type="button" class="w-btn w-flip"><span>Flip</span><kbd>Space</kbd></button>
        <button type="button" class="w-btn w-know"><span>Got it</span><kbd>→</kbd></button>
      </div>
      <div class="w-bar"><i></i></div>
      <button type="button" class="w-easy" hidden>I already know this word</button>
    </section>
    <div class="w-side">
      <form class="w-add glass-card" autocomplete="off">
        <span class="card-title">Add your word</span>
        <input name="word" placeholder="Word" maxlength="60" aria-label="Word" required>
        <input name="meaning" placeholder="Meaning (Korean is fine)" maxlength="160" aria-label="Meaning" required>
        <input name="example" placeholder="Example sentence (optional)" maxlength="240" aria-label="Example">
        <button type="submit" class="btn-solid">Add</button>
        <details class="w-paste">
          <summary>Paste a list</summary>
          <textarea rows="5" placeholder="one per line&#10;resilient - 회복력 있는&#10;ubiquitous: 어디에나 있는" aria-label="Word list"></textarea>
          <button type="button" class="btn-sm w-paste-add">Add all</button>
        </details>
        <span class="meta w-add-status" aria-live="polite"></span>
      </form>
      <section class="w-list-card glass-card" aria-label="Your cards">
        <div class="w-list-head">
          <span class="card-title">Cards</span>
          <input type="search" class="w-search" placeholder="Search" aria-label="Search cards">
        </div>
        <ul class="w-list"></ul>
        <p class="w-credit">TOEIC list: <a href="https://www.newgeneralservicelist.com/toeic-service-list" target="_blank" rel="noopener noreferrer">TSL 1.2</a> by Browne &amp; Culligan, CC BY-SA 4.0. Korean meanings added for Haru.</p>
      </section>
    </div>`;
  const $ = <T extends Element>(sel: string) => body.querySelector<T>(sel)!;
  const card = $<HTMLButtonElement>('.w-card');
  const say = $<HTMLButtonElement>('.w-say');
  say.append(icon('volume-2'));
  say.hidden = !canSpeak;
  const koBtn = $<HTMLButtonElement>('.w-ko-btn');
  const tools = $<HTMLElement>('.w-card-tools');
  const done = $<HTMLElement>('.w-done');
  const left = $<HTMLElement>('.w-left');
  const bar = $<HTMLElement>('.w-bar i');
  const list = $<HTMLUListElement>('.w-list');
  const search = $<HTMLInputElement>('.w-search');
  const form = $<HTMLFormElement>('.w-add');
  const status = $<HTMLElement>('.w-add-status');
  const easy = $<HTMLButtonElement>('.w-easy');
  const actions = [...body.querySelectorAll<HTMLButtonElement>('.w-actions button')];

  // ---- which decks are on (remembered per browser)
  let on = new Set<Deck>(['tsl', 'mine']);
  try {
    const saved = JSON.parse(localStorage.getItem(DECKS_KEY) ?? 'null') as Deck[] | null;
    if (Array.isArray(saved)) on = new Set(saved.filter((d) => DECKS.some((x) => x.id === d)));
  } catch {
    // defaults
  }
  const deckBox = $<HTMLElement>('.w-decks');
  const deckBtns = DECKS.map((d) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.textContent = d.label;
    b.setAttribute('aria-pressed', String(on.has(d.id)));
    b.addEventListener('click', () => {
      if (on.has(d.id)) on.delete(d.id);
      else on.add(d.id);
      b.setAttribute('aria-pressed', String(on.has(d.id)));
      try {
        localStorage.setItem(DECKS_KEY, JSON.stringify([...on]));
      } catch {
        // the choice lasts for this visit
      }
      void deal();
    });
    return b;
  });
  deckBox.append(...deckBtns);

  let mode: 'due' | 'all' = 'due';
  let queue: string[] = [];
  let total = 0;
  let flipped = false;
  let showEn = false;

  const words = shownWords;
  const inDecks = (w: Word) => on.has(deckOf(w));
  const dueWords = () => words().filter((w) => inDecks(w) && w.due <= dayKey());
  const newToday = () => words().filter((w) => deckOf(w) === 'tsl' && w.added >= startOfToday()).length;

  /** Today's new words from the TOEIC list, saved as cards. */
  async function introduce(): Promise<void> {
    const want = NEW_PER_DAY - newToday();
    if (want <= 0 || !on.has('tsl')) return;
    const lib = library ?? (await loadLibrary());
    if (!lib) return;
    // every saved card counts, hidden Basic ones too: no word comes back as new
    const have = new Set(wordsStore.all().map((w) => w.word.toLowerCase()));
    const now = Date.now();
    const fresh: Word[] = lib.decks.tsl
      .filter(([w]) => !have.has(w.toLowerCase()))
      .slice(0, want)
      .map((row, i) => ({ id: newId(), word: row[0], def: row[1], meaning: row[2], example: '', deck: 'tsl', box: 0, due: dayKey(), added: now + i, right: 0, wrong: 0 }));
    if (fresh.length) wordsStore.set([...wordsStore.all(), ...fresh]);
  }

  /** A new session: today's cards (due + new) or every card, in random order. */
  async function deal(): Promise<void> {
    if (mode === 'due') await introduce();
    queue = shuffle((mode === 'due' ? dueWords() : words().filter(inDecks)).map((w) => w.id));
    total = queue.length;
    flipped = false;
    showCard();
    renderSum();
  }

  function showCard(): void {
    const w = words().find((x) => x.id === queue[0]);
    if (queue.length && !w) {
      queue.shift(); // deleted meanwhile
      showCard();
      return;
    }
    card.hidden = !w;
    tools.hidden = !w;
    done.hidden = !!w;
    easy.hidden = !w || w.right + w.wrong > 0 || w.box > 0;
    actions.forEach((b) => (b.disabled = !w));
    bar.style.transform = `scaleX(${total ? (total - queue.length) / total : 1})`;
    left.textContent = w ? `${queue.length} left` : '';
    if (!w) {
      const n = words().filter(inDecks).length;
      $<HTMLElement>('.w-done-sub').textContent = n ? `${newToday()} new today · come back tomorrow for the next ${NEW_PER_DAY}` : 'Turn on a deck or add your own words';
      $<HTMLButtonElement>('.w-again-all').hidden = !n;
      return;
    }
    const d = deckOf(w);
    const tag = d === 'mine' ? 'My word' : `TOEIC${w.right + w.wrong ? '' : ' · new'}`;
    card.classList.toggle('flipped', flipped);
    $<HTMLElement>('.w-tag').textContent = tag;
    const wordEl = $<HTMLElement>('.w-word');
    wordEl.textContent = w.word;
    // its longest run of letters sets how small it must go to fit the card on one line
    wordEl.style.setProperty('--n', String(Math.max(6, ...w.word.split(/\s+/).map((part) => part.length))));
    $<HTMLElement>('.w-word-sm').textContent = w.word;
    // the back: the Korean meaning (your own words: the meaning you wrote); the English definition on request
    const def = w.def?.trim() ?? '';
    $<HTMLElement>('.w-def').textContent = w.meaning;
    const en = $<HTMLElement>('.w-ko');
    en.textContent = def;
    en.hidden = !def || !showEn;
    koBtn.hidden = !def;
    koBtn.setAttribute('aria-pressed', String(showEn));
    $<HTMLElement>('.w-example').textContent = w.example;
    card.setAttribute('aria-label', flipped ? `${w.word}: ${w.meaning}` : `${w.word}. Flip to see the meaning`);
  }

  function flip(): void {
    if (!queue.length) return;
    flipped = !flipped;
    showCard();
  }
  function toggleEn(): void {
    showEn = !showEn;
    // asking for the definition means wanting to see the answer
    if (showEn) flipped = true;
    showCard();
  }

  function answer(result: 'again' | 'got' | 'easy'): void {
    const id = queue[0];
    if (!id) return;
    const knew = result !== 'again';
    wordsStore.set(wordsStore.all().map((w) => {
      if (w.id !== id) return w;
      const box = result === 'easy' ? MAX_BOX : knew ? Math.min(MAX_BOX, w.box + 1) : 0;
      return { ...w, box, due: addDays(INTERVAL[box]!), right: w.right + (knew ? 1 : 0), wrong: w.wrong + (knew ? 0 : 1) };
    }));
    queue.shift();
    // missed: round again before the session ends
    if (!knew) queue.push(id);
    flipped = false;
    card.classList.remove('flipped', 'out-l', 'out-r');
    void card.offsetWidth;
    card.classList.add(knew ? 'out-r' : 'out-l');
    showCard();
  }

  function speak(): void {
    const w = words().find((x) => x.id === queue[0]);
    if (!w || !canSpeak) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(w.word);
    u.lang = 'en-US';
    speechSynthesis.speak(u);
  }

  card.addEventListener('click', flip);
  say.addEventListener('click', speak);
  koBtn.addEventListener('click', toggleEn);
  easy.addEventListener('click', () => answer('easy'));
  $<HTMLButtonElement>('.w-flip').addEventListener('click', flip);
  $<HTMLButtonElement>('.w-miss').addEventListener('click', () => answer('again'));
  $<HTMLButtonElement>('.w-know').addEventListener('click', () => answer('got'));
  $<HTMLButtonElement>('.w-again-all').addEventListener('click', () => setMode('all'));
  const modeBtns = [...body.querySelectorAll<HTMLButtonElement>('.w-mode button')];
  function setMode(next: 'due' | 'all'): void {
    mode = next;
    modeBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
    void deal();
  }
  modeBtns.forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode as 'due' | 'all')));

  document.addEventListener('keydown', (e) => {
    if (currentView() !== 'words' || e.metaKey || e.ctrlKey || e.altKey) return;
    if ((e.target as Element).closest('input, textarea, select, dialog, md-editor')) return;
    if (e.key === ' ') {
      e.preventDefault();
      flip();
    } else if (e.key === 'ArrowLeft' || e.key === '1') answer('again');
    else if (e.key === 'ArrowRight' || e.key === '2') answer('got');
    else if (e.key === 'e') toggleEn();
    else if (e.key === 'p') speak();
  });

  // ---- adding your own words
  function add(items: { word: string; meaning: string; example?: string }[]): { added: number; skipped: number } {
    const have = new Set(wordsStore.all().map((w) => w.word.toLowerCase()));
    const fresh: Word[] = [];
    for (const it of items) {
      const word = it.word.trim();
      const meaning = it.meaning.trim();
      if (!word || !meaning || have.has(word.toLowerCase())) continue;
      have.add(word.toLowerCase());
      fresh.push({ id: newId(), word, meaning, example: (it.example ?? '').trim(), deck: 'mine', box: 0, due: dayKey(), added: Date.now(), right: 0, wrong: 0 });
    }
    if (fresh.length) {
      wordsStore.set([...fresh, ...wordsStore.all()]);
      // new words join the running session
      if (on.has('mine') && (mode === 'due' || queue.length)) {
        queue.push(...fresh.map((w) => w.id));
        total += fresh.length;
        showCard();
      }
    }
    return { added: fresh.length, skipped: items.length - fresh.length };
  }
  let statusTimer = 0;
  const tell = (text: string) => {
    status.textContent = text;
    clearTimeout(statusTimer);
    statusTimer = window.setTimeout(() => (status.textContent = ''), 3500);
  };
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const r = add([{ word: String(f.get('word')), meaning: String(f.get('meaning')), example: String(f.get('example') ?? '') }]);
    if (r.added) {
      form.reset();
      form.querySelector<HTMLInputElement>('input[name="word"]')!.focus();
      tell(on.has('mine') ? 'Added' : 'Added · turn on My words to study it');
    } else tell('Already in your cards');
  });
  const paste = $<HTMLTextAreaElement>('.w-paste textarea');
  $<HTMLButtonElement>('.w-paste-add').addEventListener('click', () => {
    const lines = paste.value.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const parsed = lines.map(parseLine).filter((x): x is { word: string; meaning: string } => !!x);
    const r = add(parsed);
    const bad = lines.length - parsed.length;
    tell(`Added ${r.added}${r.skipped ? ` · ${r.skipped} already there` : ''}${bad ? ` · ${bad} unreadable` : ''}`);
    if (r.added) paste.value = '';
  });

  // ---- the cards so far
  function renderList(): void {
    const q = search.value.trim().toLowerCase();
    const shown = words()
      .filter((w) => !q || w.word.toLowerCase().includes(q) || w.meaning.toLowerCase().includes(q) || (w.def ?? '').toLowerCase().includes(q))
      .sort((a, b) => b.added - a.added)
      .slice(0, 300);
    if (!shown.length) {
      const li = document.createElement('li');
      li.className = 'w-empty';
      li.textContent = words().length ? 'No match' : 'Your cards will show up here';
      list.replaceChildren(li);
      return;
    }
    list.replaceChildren(...shown.map((w) => {
      const li = document.createElement('li');
      li.innerHTML = '<span class="w-l-word"></span><span class="w-l-mean"></span><span class="w-level" aria-hidden="true"></span>';
      li.querySelector('.w-l-word')!.textContent = w.word;
      li.querySelector('.w-l-mean')!.textContent = w.meaning;
      const level = li.querySelector<HTMLElement>('.w-level')!;
      for (let b = 1; b <= MAX_BOX; b++) level.append(Object.assign(document.createElement('i'), { className: b <= w.box ? 'on' : '' }));
      const deck = DECKS.find((d) => d.id === deckOf(w))!.label;
      li.title = `${deck} · box ${w.box} of ${MAX_BOX} · next ${w.due <= dayKey() ? 'today' : w.due} · right ${w.right} · missed ${w.wrong}`;
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'tpl-del';
      del.setAttribute('aria-label', `Delete ${w.word}`);
      del.append(icon('x'));
      del.addEventListener('click', async () => {
        // a card with progress on it asks first
        if ((w.right + w.wrong > 0 || w.box > 0) && !(await askConfirm({ title: `Delete “${w.word}”?`, body: 'Its progress goes with it.', danger: true }))) return;
        wordsStore.set(wordsStore.all().filter((x) => x.id !== w.id));
      });
      li.append(del);
      return li;
    }));
  }
  search.addEventListener('input', renderList);

  function renderSum(): void {
    const all = words();
    const learning = all.filter((w) => w.box < MAX_BOX).length;
    const mastered = all.length - learning;
    sum.textContent = all.length ? `${dueWords().length} due · ${newToday()} / ${NEW_PER_DAY} new today · ${learning} learning · ${mastered} mastered` : '';
  }

  wordsStore.onChange(() => {
    renderList();
    renderSum();
  });
  // coming back to the page (another day, or after a session ended): today's cards again
  onView((view) => {
    if (view === 'words' && !queue.length) void deal();
  });
  renderList();
  renderSum();
  // the word list only loads once the page is opened
  if (currentView() === 'words') void deal();
  else showCard();
}
