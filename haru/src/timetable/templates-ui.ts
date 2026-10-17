import { allTemplates, applyTemplate, createTemplate, onTemplates, removeTemplate, saveTemplate, updateTemplate, type Template, type TemplateBlock } from './templates';
import { CATEGORIES, CATEGORY_KEYS, labelOf, type Category } from './model';
import { setState, state, subscribe } from './state';
import { DAY, formatDuration, hhmm, mod } from './time';
import { icon } from '../ui/icons';

export interface TemplateRefs {
  list: HTMLElement;
  form: HTMLFormElement;
  status: HTMLElement;
}

/** A typed time → minutes, or null: "9", "930", "0930", "9:30" and "24:00" all work. */
const minutesOf = (v: string): number | null => {
  const t = v.trim();
  const m = /^(\d{1,2})(?::?(\d{2}))?$/.exec(t.includes(':') || t.length > 2 ? t.replace(/^(\d{1,2})(\d{2})$/, '$1:$2') : t);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  return h > 24 || min > 59 || (h === 24 && min) ? null : (h * 60 + min) % DAY;
};
/** A time box: typed as HH:MM in the app's mono digits (the native picker shows 오전/오후 and doesn't fit). */
const timeBox = (cls: string, label: string, name = '') =>
  `<input class="${cls}"${name ? ` name="${name}"` : ''} inputmode="numeric" maxlength="5" placeholder="HH:MM" aria-label="${label}" autocomplete="off">`;
const clash = (a: TemplateBlock, b: TemplateBlock) => mod(a.start - b.start) < b.dur || mod(b.start - a.start) < a.dur;
const catOptions = (sel: Category) =>
  CATEGORY_KEYS.map((c) => `<option value="${c}"${c === sel ? ' selected' : ''}>${CATEGORIES[c]}</option>`).join('');

/**
 * The right drawer's two tabs: Today (the task list) and Templates — day templates to build task by task,
 * save from Today, edit, and put on Today (undo for a few seconds).
 */
export function mountTemplates(refs: TemplateRefs): void {
  const panel = document.getElementById('panel-right')!;
  const pane = document.getElementById('tpl-pane')!;
  const browse = document.getElementById('tpl-browse')!;
  const editor = document.getElementById('tpl-edit')!;
  const newBtn = document.getElementById('new')!;
  const tabs = [...panel.querySelectorAll<HTMLButtonElement>('[data-rtab]')];
  const input = refs.form.elements.namedItem('name') as HTMLInputElement;

  // ---- tabs
  function showTab(tab: 'today' | 'templates'): void {
    panel.dataset.tab = tab;
    pane.hidden = tab !== 'templates';
    newBtn.hidden = tab !== 'today';
    for (const t of tabs) t.setAttribute('aria-selected', String(t.dataset.rtab === tab));
  }
  tabs.forEach((t) => t.addEventListener('click', () => showTab(t.dataset.rtab as 'today' | 'templates')));
  showTab('today');

  let statusTimer = 0;
  function say(parts: (string | HTMLElement)[], ms = 4000): void {
    refs.status.replaceChildren(...parts);
    clearTimeout(statusTimer);
    statusTimer = window.setTimeout(() => refs.status.replaceChildren(), ms);
  }

  function apply(t: Template): void {
    const before = applyTemplate(t.id);
    if (!before) return;
    const undo = document.createElement('button');
    undo.type = 'button';
    undo.className = 'btn-text tpl-undo';
    undo.textContent = 'Undo';
    undo.addEventListener('click', () => {
      setState({ blocks: before, draft: null, selected: [] });
      say(['Restored']);
    });
    say([`${t.name} is on Today`, undo], 8000);
  }

  // ---- new: an empty one to fill in, or a copy of Today
  const nameOrAsk = (): string | null => {
    const name = input.value.trim();
    if (!name) {
      input.focus();
      say(['Name it first']);
      return null;
    }
    return name;
  };
  refs.form.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = nameOrAsk();
    if (!name) return;
    const t = createTemplate(name);
    input.value = '';
    openEditor(t.id);
  });
  document.getElementById('tpl-from-today')!.addEventListener('click', () => {
    const name = nameOrAsk();
    if (!name) return;
    if (!state.blocks.length) {
      say(['Today is empty']);
      return;
    }
    saveTemplate(name);
    input.value = '';
    say(['Saved from Today']);
  });

  // ---- the list
  function ribbonOf(t: Template): HTMLElement {
    // a mini ribbon of the day: where its tasks sit across 24 h, in their category colours
    const ribbon = document.createElement('span');
    ribbon.className = 'tpl-ribbon';
    for (const b of t.blocks) {
      const seg = document.createElement('i');
      seg.style.setProperty('--c', `var(--cat-${b.cat})`);
      seg.style.left = `${(b.start / DAY) * 100}%`;
      seg.style.width = `${(Math.min(b.dur, DAY - b.start) / DAY) * 100}%`;
      ribbon.append(seg);
      if (b.start + b.dur > DAY) {
        // wraps past midnight: the rest from 00:00
        const tail = seg.cloneNode() as HTMLElement;
        tail.style.left = '0%';
        tail.style.width = `${((b.start + b.dur - DAY) / DAY) * 100}%`;
        ribbon.append(tail);
      }
    }
    return ribbon;
  }

  function renderList(): void {
    const list = allTemplates();
    if (!list.length) {
      const li = document.createElement('li');
      li.className = 'tpl-empty';
      li.textContent = 'No templates yet. Name one above, then New to build it or From today to copy today.';
      refs.list.replaceChildren(li);
      return;
    }
    refs.list.replaceChildren(...list.map((t) => {
      const li = document.createElement('li');
      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'tpl-apply';
      open.title = `Edit “${t.name}”`;
      const planned = t.blocks.reduce((m, b) => m + b.dur, 0);
      open.innerHTML = '<span class="tpl-name"></span><span class="tpl-meta meta"></span>';
      open.querySelector('.tpl-name')!.textContent = t.name;
      open.querySelector('.tpl-meta')!.textContent = `${t.blocks.length} · ${formatDuration(planned)}`;
      open.append(ribbonOf(t));
      open.addEventListener('click', () => openEditor(t.id));
      const use = document.createElement('button');
      use.type = 'button';
      use.className = 'btn-sm tpl-use';
      use.textContent = 'Use';
      use.title = `Set Today to “${t.name}”`;
      use.disabled = !t.blocks.length;
      use.addEventListener('click', () => apply(t));
      li.append(open, use);
      return li;
    }));
  }

  // ---- the editor: one template's tasks, each editable in place, and a row to add more
  let editing: string | null = null;
  /** What the add row holds, carried across re-renders (null: fresh). */
  let addDraft: Record<string, string> | null = null;
  function openEditor(id: string): void {
    editing = id;
    addDraft = null;
    browse.hidden = true;
    editor.hidden = false;
    renderEditor();
    editor.querySelector<HTMLInputElement>('.tpl-add input[name="title"]')?.focus();
  }
  function closeEditor(): void {
    editing = null;
    editor.hidden = true;
    browse.hidden = false;
    editor.replaceChildren();
  }

  function renderEditor(): void {
    const t = allTemplates().find((x) => x.id === editing);
    if (!t) {
      closeEditor();
      return;
    }
    // the add row's contents and the focused field survive a re-render
    const draft = editor.querySelector<HTMLFormElement>('.tpl-add');
    if (draft && !addDraft) addDraft = Object.fromEntries([...new FormData(draft)].map(([k, v]) => [k, String(v)]));
    const kept = addDraft;
    addDraft = null;
    const focused = document.activeElement instanceof HTMLElement && editor.contains(document.activeElement) ? document.activeElement : null;
    const focusRow = focused?.closest('.tpl-task') ? [...editor.querySelectorAll('.tpl-task')].indexOf(focused.closest('.tpl-task')!) : -1;
    const focusCls = focused?.className.split(' ')[0] ?? '';
    const focusName = focused?.getAttribute('name') ?? '';
    editor.innerHTML = `
      <div class="tpl-edit-head">
        <button type="button" class="icon-btn tpl-back" aria-label="Back to templates"></button>
        <input class="tpl-rename" maxlength="32" aria-label="Template name">
        <span class="meta tpl-edit-sum"></span>
      </div>
      <span class="tpl-ribbon-slot"></span>
      <ol class="tpl-tasks"></ol>
      <form class="tpl-add" autocomplete="off">
        <input name="title" placeholder="Task" maxlength="40" aria-label="Task name">
        <select name="cat" aria-label="Category">${catOptions('work')}</select>
        ${timeBox('tpl-a-start', 'Start time', 'start')}
        ${timeBox('tpl-a-end', 'End time', 'end')}
        <button type="submit" class="btn-sm"><span>Add</span></button>
      </form>
      <p class="err tpl-err" role="alert"></p>
      <div class="tpl-edit-foot">
        <button type="button" class="btn-solid tpl-apply-now">Use on Today</button>
        <button type="button" class="btn-text danger tpl-remove">Delete</button>
      </div>`;
    const back = editor.querySelector<HTMLButtonElement>('.tpl-back')!;
    back.append(icon('chevron-left'));
    back.addEventListener('click', closeEditor);
    const rename = editor.querySelector<HTMLInputElement>('.tpl-rename')!;
    rename.value = t.name;
    rename.addEventListener('change', () => {
      const name = rename.value.trim();
      if (name && name !== t.name) updateTemplate(t.id, { name });
      else rename.value = t.name;
    });
    const planned = t.blocks.reduce((m, b) => m + b.dur, 0);
    editor.querySelector('.tpl-edit-sum')!.textContent = `${t.blocks.length} · ${formatDuration(planned)}`;
    editor.querySelector('.tpl-ribbon-slot')!.replaceWith(ribbonOf(t));
    const err = editor.querySelector<HTMLElement>('.tpl-err')!;

    /** Checks a changed task against the others; true when it fits (the caller then saves). */
    const fits = (blocks: TemplateBlock[], changed: TemplateBlock): boolean => {
      if (!changed.dur) {
        err.textContent = 'Start and end can’t be the same';
        return false;
      }
      const hit = blocks.find((b) => b !== changed && clash(b, changed));
      if (hit) {
        err.textContent = `Overlaps ${labelOf(hit)} (${hhmm(hit.start)}–${hhmm(hit.start + hit.dur)})`;
        return false;
      }
      err.textContent = '';
      return true;
    };

    const rows = editor.querySelector('.tpl-tasks')!;
    if (!t.blocks.length) {
      const li = document.createElement('li');
      li.className = 'tpl-empty';
      li.textContent = 'No tasks yet: add the first below';
      rows.append(li);
    }
    t.blocks.forEach((b, i) => {
      const li = document.createElement('li');
      li.className = 'tpl-task';
      li.style.setProperty('--c', `var(--cat-${b.cat})`);
      li.innerHTML = `
        <span class="dot"></span>
        <input class="tpl-t-title" maxlength="40" aria-label="Task name">
        <select class="tpl-t-cat" aria-label="Category">${catOptions(b.cat)}</select>
        ${timeBox('tpl-t-start', 'Start time')}
        ${timeBox('tpl-t-end', 'End time')}`;
      const title = li.querySelector<HTMLInputElement>('.tpl-t-title')!;
      const cat = li.querySelector<HTMLSelectElement>('.tpl-t-cat')!;
      const start = li.querySelector<HTMLInputElement>('.tpl-t-start')!;
      const end = li.querySelector<HTMLInputElement>('.tpl-t-end')!;
      title.value = b.title;
      title.placeholder = CATEGORIES[b.cat];
      start.value = hhmm(b.start);
      end.value = hhmm(b.start + b.dur);
      const edit = () => {
        const s = minutesOf(start.value);
        const e = minutesOf(end.value);
        if (s === null || e === null) {
          err.textContent = 'Times look like 09:00';
          start.value = hhmm(b.start);
          end.value = hhmm(b.start + b.dur);
          return;
        }
        const next = { title: title.value.trim(), cat: cat.value as Category, start: s, dur: mod(e - s) };
        const blocks = t.blocks.map((x, k) => (k === i ? next : x));
        if (fits(blocks, next)) updateTemplate(t.id, { blocks });
        else {
          start.value = hhmm(b.start);
          end.value = hhmm(b.start + b.dur);
        }
      };
      for (const f of [title, cat, start, end]) f.addEventListener('change', edit);
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'tpl-del';
      del.setAttribute('aria-label', `Remove ${labelOf(b)}`);
      del.append(icon('x'));
      del.addEventListener('click', () => updateTemplate(t.id, { blocks: t.blocks.filter((_, k) => k !== i) }));
      li.append(del);
      rows.append(li);
    });

    const add = editor.querySelector<HTMLFormElement>('.tpl-add')!;
    const f = (n: string) => add.elements.namedItem(n) as HTMLInputElement;
    f('start').value = '09:00';
    f('end').value = '10:00';
    if (kept) for (const [k, v] of Object.entries(kept)) f(k).value = String(v);
    else if (t.blocks.length) {
      // the next free hour after the last task
      const last = t.blocks.at(-1)!;
      f('start').value = hhmm(last.start + last.dur);
      f('end').value = hhmm(last.start + last.dur + 60);
    }
    add.addEventListener('submit', (e) => {
      e.preventDefault();
      const s = minutesOf(f('start').value);
      const en = minutesOf(f('end').value);
      if (s === null || en === null) {
        err.textContent = 'Times look like 09:00';
        return;
      }
      const next = { title: f('title').value.trim(), cat: f('cat').value as Category, start: s, dur: mod(en - s) };
      const blocks = [...t.blocks, next];
      if (!fits(blocks, next)) return;
      // ready for the next one, starting where this ended
      addDraft = { title: '', cat: next.cat, start: hhmm(s + next.dur), end: hhmm(s + next.dur + 60) };
      updateTemplate(t.id, { blocks });
      editor.querySelector<HTMLInputElement>('.tpl-add input[name="title"]')?.focus();
    });
    const useNow = editor.querySelector<HTMLButtonElement>('.tpl-apply-now')!;
    useNow.disabled = !t.blocks.length;
    useNow.addEventListener('click', () => apply(t));
    // back to the field that had focus (same row, same box)
    if (focused) {
      const row = focusRow >= 0 ? editor.querySelectorAll('.tpl-task')[focusRow] : editor;
      const sel = focusName ? `[name="${focusName}"]` : focusCls ? `.${focusCls}` : '';
      if (sel) row?.querySelector<HTMLElement>(sel)?.focus({ preventScroll: true });
    }
    editor.querySelector('.tpl-remove')!.addEventListener('click', () => {
      if (t.blocks.length && !confirm(`Delete the template “${t.name}”?`)) return;
      removeTemplate(t.id);
      closeEditor();
    });
  }

  onTemplates(() => {
    renderList();
    if (editing) renderEditor();
  });
  // From today only makes sense with something on Today
  const fromToday = document.getElementById('tpl-from-today')!;
  subscribe(() => fromToday.classList.toggle('empty', !state.blocks.length));
  fromToday.classList.toggle('empty', !state.blocks.length);
  renderList();
}
