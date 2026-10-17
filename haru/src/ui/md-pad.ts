import { renderMarkdown, toggleTask } from './markdown';

/**
 * Markdown for a memo textarea: while you type it is plain text; the moment it loses focus the same box
 * shows the rendered page. A click on the page goes back to writing (links open, checkboxes tick instead).
 * `el` wraps both and takes the textarea's place; call `refresh()` after setting the value from code.
 */
export interface MdPad {
  el: HTMLElement;
  refresh(): void;
}

export function mdPad(textarea: HTMLTextAreaElement, cls = ''): MdPad {
  const el = document.createElement('div');
  el.className = `md-pad${cls ? ` ${cls}` : ''}`;
  const view = document.createElement('div');
  view.className = 'md-view';
  view.tabIndex = 0;
  view.setAttribute('role', 'button');
  view.setAttribute('aria-label', 'Rendered note — click to edit');
  textarea.replaceWith(el);
  el.append(textarea, view);

  let shown = '';
  function refresh(): void {
    const editing = document.activeElement === textarea;
    const has = !!textarea.value.trim();
    el.classList.toggle('rendered', has && !editing);
    if (has && !editing && shown !== textarea.value) {
      shown = textarea.value;
      view.innerHTML = renderMarkdown(textarea.value);
    }
  }
  const edit = () => {
    el.classList.remove('rendered');
    textarea.focus({ preventScroll: true });
    const end = textarea.value.length;
    textarea.setSelectionRange(end, end);
  };

  textarea.addEventListener('focus', refresh);
  // after the textarea's own blur handlers (they may rewrite the text)
  textarea.addEventListener('blur', () => setTimeout(refresh, 0));
  textarea.addEventListener('input', () => {
    if (document.activeElement !== textarea) refresh();
  });
  view.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('a')) return;
    const box = t.closest<HTMLInputElement>('input[type="checkbox"][data-line]');
    if (box) {
      textarea.value = toggleTask(textarea.value, Number(box.dataset.line));
      // let the owner save it, as if typed
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      shown = '';
      refresh();
      return;
    }
    // selecting text on the page shouldn't jump into editing
    if (getSelection()?.toString()) return;
    edit();
  });
  view.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      edit();
    }
  });
  refresh();
  return { el, refresh };
}
