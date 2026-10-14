import { allTemplates, applyTemplate, onTemplates, removeTemplate, saveTemplate } from './templates';
import { setState, state, subscribe } from './state';
import { formatDuration } from './time';
import { icon } from '../ui/icons';

export interface TemplateRefs {
  list: HTMLElement;
  form: HTMLFormElement;
  status: HTMLElement;
}

/** Left drawer: day templates — click one to set Today to it (undo for a few seconds), save Today as one. */
export function mountTemplates(refs: TemplateRefs): void {
  const input = refs.form.elements.namedItem('name') as HTMLInputElement;
  let statusTimer = 0;
  function say(parts: (string | HTMLElement)[], ms = 4000): void {
    refs.status.replaceChildren(...parts);
    clearTimeout(statusTimer);
    statusTimer = window.setTimeout(() => refs.status.replaceChildren(), ms);
  }

  refs.form.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = input.value.trim();
    if (!name) {
      input.focus();
      return;
    }
    if (!state.blocks.length) {
      say(['Today is empty']);
      return;
    }
    saveTemplate(name);
    input.value = '';
    input.blur();
    say(['Saved']);
  });

  function render(): void {
    const list = allTemplates();
    if (!list.length) {
      const li = document.createElement('li');
      li.className = 'tpl-empty';
      li.textContent = 'No templates yet';
      refs.list.replaceChildren(li);
      return;
    }
    refs.list.replaceChildren(...list.map((t) => {
      const li = document.createElement('li');
      const apply = document.createElement('button');
      apply.type = 'button';
      apply.className = 'tpl-apply';
      apply.title = `Set Today to “${t.name}”`;
      const planned = t.blocks.reduce((m, b) => m + b.dur, 0);
      // a mini ribbon of the day: where its tasks sit across 24 h, in their category colours
      const ribbon = document.createElement('span');
      ribbon.className = 'tpl-ribbon';
      for (const b of t.blocks) {
        const seg = document.createElement('i');
        seg.style.setProperty('--c', `var(--cat-${b.cat})`);
        seg.style.left = `${(b.start / 1440) * 100}%`;
        seg.style.width = `${(Math.min(b.dur, 1440 - b.start) / 1440) * 100}%`;
        ribbon.append(seg);
        if (b.start + b.dur > 1440) {
          // wraps past midnight: the rest from 00:00
          const tail = seg.cloneNode() as HTMLElement;
          tail.style.left = '0%';
          tail.style.width = `${((b.start + b.dur - 1440) / 1440) * 100}%`;
          ribbon.append(tail);
        }
      }
      apply.innerHTML = '<span class="tpl-name"></span><span class="tpl-meta meta"></span>';
      apply.querySelector('.tpl-name')!.textContent = t.name;
      apply.querySelector('.tpl-meta')!.textContent = `${t.blocks.length} · ${formatDuration(planned)}`;
      apply.append(ribbon);
      apply.addEventListener('click', () => {
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
        say([`${t.name} applied`, undo], 8000);
      });
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'tpl-del';
      del.setAttribute('aria-label', `Delete template ${t.name}`);
      del.append(icon('x'));
      del.addEventListener('click', () => removeTemplate(t.id));
      li.append(apply, del);
      return li;
    }));
  }

  onTemplates(render);
  // the form's button only makes sense with something to save
  subscribe(() => refs.form.classList.toggle('empty', !state.blocks.length));
  refs.form.classList.toggle('empty', !state.blocks.length);
  render();
}
