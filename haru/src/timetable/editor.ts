import { mod } from './time';
import { CATEGORIES, CATEGORY_KEYS, type Category, type Status, statusOf } from './model';
import { closeDraft, commitDraft, deleteDraftBlock, patchDraft, setDraftStatus, state, subscribe } from './state';
import { timeField } from '../ui/time-field';

interface EditorFields extends HTMLFormControlsCollection {
  title: HTMLInputElement;
  note: HTMLTextAreaElement;
}

function req<T extends Element>(root: ParentNode, selector: string): T {
  const node = root.querySelector<T>(selector);
  if (!node) throw new Error(`missing ${selector}`);
  return node;
}

export function mountEditor(form: HTMLFormElement): void {
  const f = form.elements as EditorFields;
  const head = req<HTMLElement>(form, '#ed-head');
  const err = req<HTMLElement>(form, '#err');
  const del = req<HTMLButtonElement>(form, '#del');
  const chips = req<HTMLElement>(form, '#chips');

  // custom 24h pickers: native <select>/<input type=time> follow OS styling and the 12h locale
  const setTimes = (start: number, end: number) => {
    err.textContent = '';
    patchDraft({ start, dur: mod(end - start) });
  };
  const startField = timeField(req(form, '[data-field="start"]'), (m) => {
    const d = state.draft;
    if (d) setTimes(m, d.start + d.dur);
  });
  const endField = timeField(req(form, '[data-field="end"]'), (m) => {
    const d = state.draft;
    if (d) setTimes(d.start, m);
  });

  chips.replaceChildren(...CATEGORY_KEYS.map((k) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.setAttribute('role', 'radio');
    b.dataset.cat = k;
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.setProperty('--c', `var(--cat-${k})`);
    b.append(dot, CATEGORIES[k]);
    b.addEventListener('click', () => patchDraft({ cat: k as Category }));
    return b;
  }));

  // where the task stands: Yet (new tasks) · In progress · Done
  const statusSeg = req<HTMLElement>(form, '#status-seg');
  statusSeg.addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLButtonElement>('[data-status]');
    if (b) setDraftStatus(b.dataset.status as Status);
  });

  let filledKey = -1;
  /** The draft the status picker last showed: a new one jumps straight to its status instead of sliding. */
  let shownKey = -1;

  function render(): void {
    const d = state.draft;
    form.hidden = !d;
    if (!d) return;
    if (filledKey !== state.draftKey) {
      // a newly opened draft: refill everything and focus the title
      filledKey = state.draftKey;
      head.textContent = d.id ? 'Edit task' : 'New task';
      del.hidden = !d.id;
      f.title.value = d.title;
      f.note.value = d.note ?? '';
      err.textContent = '';
      // at the next frame, where the layout is worked out anyway (focusing now would force it mid-click)
      requestAnimationFrame(() => f.title.focus({ preventScroll: true }));
    }
    form.style.setProperty('--c', `var(--cat-${d.cat})`);
    startField.set(d.start);
    endField.set(mod(d.start + d.dur));
    chips.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.cat === d.cat)));
    const status = statusOf(d);
    statusSeg.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.status === status)));
    // the highlight slides to the new status and its icon plays once (not when another task is opened)
    const changed = statusSeg.dataset.status !== status && shownKey === state.draftKey;
    statusSeg.dataset.status = status;
    shownKey = state.draftKey;
    if (changed) {
      statusSeg.classList.remove('changed');
      void statusSeg.offsetWidth;
      statusSeg.classList.add('changed');
    } else if (statusSeg.dataset.key !== String(state.draftKey)) {
      statusSeg.classList.remove('changed');
    }
    statusSeg.dataset.key = String(state.draftKey);
  }

  f.title.addEventListener('input', () => patchDraft({ title: f.title.value }));
  f.note.addEventListener('input', () => patchDraft({ note: f.note.value }));

  let lastSave = 0;
  const save = () => {
    // one Enter can arrive twice with a Korean IME (once committing the syllable, once as a plain Enter)
    if (performance.now() - lastSave < 300) return;
    lastSave = performance.now();
    err.textContent = commitDraft() ?? '';
  };
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    save();
  });
  // Enter saves from anywhere in the editor (title, category chips, time fields, Done) — not only the title box
  let afterComposition = false;
  form.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;
    // Enter on Cancel / Delete does what that button says; in the note it starts a new line
    if ((e.target as Element).closest('[data-act], textarea')) return;
    e.preventDefault();
    if (e.isComposing || e.keyCode === 229) {
      afterComposition = true; // save once the syllable being typed is committed
      return;
    }
    save();
  });
  form.addEventListener('compositionend', () => {
    if (!afterComposition) return;
    afterComposition = false;
    setTimeout(save, 0);
  });

  form.addEventListener('click', (e) => {
    const act = (e.target as Element).closest<HTMLElement>('[data-act]')?.dataset.act;
    if (act === 'cancel') closeDraft();
    if (act === 'delete') deleteDraftBlock();
  });

  subscribe(render);
  render();
}
