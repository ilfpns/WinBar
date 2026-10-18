import { icon, type IconName } from './icons';

/**
 * Haru's own small dialogs in place of the browser's prompt() and confirm(): the same glass as the rest of
 * the app, Enter to accept, Esc or a click outside to cancel. Both resolve once the dialog has closed.
 */
interface Base {
  title: string;
  /** A line under the title. */
  body?: string;
  /** The accept button's label. */
  ok?: string;
  icon?: IconName;
}

function open<T>(opts: Base & { danger?: boolean; input?: { label: string; value?: string; placeholder?: string; max?: number } }, result: (accepted: boolean, value: string) => T): Promise<T> {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.className = 'modal';
    dlg.innerHTML = `
      <form method="dialog" class="modal-card">
        <div class="modal-head"><span class="modal-icon"></span><h2 class="modal-title"></h2></div>
        <p class="modal-body"></p>
        <label class="modal-field"><span class="modal-label"></span><input class="modal-input" autocomplete="off"></label>
        <div class="modal-actions">
          <button type="button" class="btn-sm modal-cancel">Cancel</button>
          <button type="submit" class="modal-ok"></button>
        </div>
      </form>`;
    const $ = <E extends Element>(sel: string) => dlg.querySelector<E>(sel)!;
    $('.modal-icon').append(icon(opts.icon ?? (opts.danger ? 'x' : opts.input ? 'plus' : 'info')));
    $('.modal-icon').classList.toggle('danger', !!opts.danger);
    $('.modal-title').textContent = opts.title;
    const body = $<HTMLElement>('.modal-body');
    body.textContent = opts.body ?? '';
    body.hidden = !opts.body;
    const field = $<HTMLElement>('.modal-field');
    const input = $<HTMLInputElement>('.modal-input');
    field.hidden = !opts.input;
    if (opts.input) {
      $('.modal-label').textContent = opts.input.label;
      input.value = opts.input.value ?? '';
      input.placeholder = opts.input.placeholder ?? '';
      if (opts.input.max) input.maxLength = opts.input.max;
    }
    const ok = $<HTMLButtonElement>('.modal-ok');
    ok.className = `modal-ok ${opts.danger ? 'btn-danger' : 'btn-accent'}`;
    ok.textContent = opts.ok ?? (opts.danger ? 'Delete' : 'OK');
    // nothing typed: nothing to accept
    const sync = () => (ok.disabled = !!opts.input && !input.value.trim());
    input.addEventListener('input', sync);
    sync();

    let accepted = false;
    const finish = () => {
      dlg.classList.add('closing');
      setTimeout(() => {
        dlg.close();
        dlg.remove();
        resolve(result(accepted, input.value.trim()));
      }, 150);
    };
    $('form').addEventListener('submit', (e) => {
      e.preventDefault();
      if (ok.disabled) return;
      accepted = true;
      finish();
    });
    $('.modal-cancel').addEventListener('click', finish);
    dlg.addEventListener('cancel', (e) => {
      e.preventDefault();
      finish();
    });
    // a click on the dimmed backdrop cancels
    dlg.addEventListener('click', (e) => {
      if (e.target === dlg) finish();
    });
    document.body.append(dlg);
    dlg.showModal();
    (opts.input ? input : opts.danger ? $<HTMLButtonElement>('.modal-cancel') : ok).focus();
    if (opts.input) input.select();
  });
}

/** Asks for a line of text; null when cancelled. */
export function askText(opts: Base & { label: string; value?: string; placeholder?: string; max?: number }): Promise<string | null> {
  return open({ ...opts, input: { label: opts.label, value: opts.value, placeholder: opts.placeholder, max: opts.max } }, (yes, v) => (yes && v ? v : null));
}

/** Asks to go ahead; `danger` styles it as a delete (focus starts on Cancel). */
export function askConfirm(opts: Base & { danger?: boolean }): Promise<boolean> {
  return open(opts, (yes) => yes);
}

/** A small menu of actions beside `anchor` (a ⋯ button, or where a right-click landed). */
export function showMenu(anchor: HTMLElement | { x: number; y: number }, items: { label: string; icon: IconName; danger?: boolean; run: () => void }[]): void {
  document.querySelector('.pop-menu')?.remove();
  const menu = document.createElement('div');
  menu.className = 'pop-menu';
  menu.setAttribute('role', 'menu');
  for (const it of items) {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'menuitem');
    b.classList.toggle('danger', !!it.danger);
    b.append(icon(it.icon), it.label);
    b.addEventListener('click', () => {
      close();
      it.run();
    });
    menu.append(b);
  }
  document.body.append(menu);
  const r = anchor instanceof HTMLElement ? anchor.getBoundingClientRect() : { left: anchor.x, bottom: anchor.y, right: anchor.x };
  const w = menu.offsetWidth;
  const h = menu.offsetHeight;
  menu.style.left = `${Math.max(8, Math.min(r.left, innerWidth - w - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(r.bottom + 6, innerHeight - h - 8))}px`;
  menu.querySelector('button')?.focus();
  function close(): void {
    menu.remove();
    document.removeEventListener('pointerdown', outside, true);
    document.removeEventListener('keydown', keys, true);
  }
  const outside = (e: PointerEvent) => {
    if (!menu.contains(e.target as Node)) close();
  };
  const keys = (e: KeyboardEvent) => {
    const btns = [...menu.querySelectorAll<HTMLButtonElement>('button')];
    const i = btns.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
      if (anchor instanceof HTMLElement) anchor.focus();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      btns[(i + (e.key === 'ArrowDown' ? 1 : btns.length - 1)) % btns.length]!.focus();
    }
  };
  setTimeout(() => {
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', keys, true);
  });
}
