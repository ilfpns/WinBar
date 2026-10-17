import { icon } from './icons';
import { toggleDrawer } from '../timetable/state';
import { shownTheme, showTheme } from './theme';

/**
 * The Haru logo (on the rail, or in the open overview) opens a small menu: Settings, the overview, a quick
 * theme switch. Settings (appearance, language, account, backup, clearing the day) is a dialog, also reached
 * from Settings at the overview's foot. Also the rail's hover hints: one floating label beside whichever rail
 * button the pointer is on.
 */
type Theme = 'dark' | 'light' | 'system';
const THEME_KEY = 'haru:theme';
const LANG_KEY = 'haru:lang';
const read = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    // for this visit only
  }
};
const savedTheme = (): Theme => (read(THEME_KEY) === 'light' ? 'light' : read(THEME_KEY) === 'system' ? 'system' : 'dark');
const lightQuery = matchMedia('(prefers-color-scheme: light)');
const applyTheme = (t: Theme) => showTheme(t === 'system' ? (lightQuery.matches ? 'light' : 'dark') : t);

export function mountSettings(): void {
  const dialog = document.getElementById('settings') as HTMLDialogElement;
  const build = document.getElementById('settings-build')!;
  build.textContent = `Haru · build ${__BUILD_ID__}`;

  const open = () => {
    if (!dialog.open) dialog.showModal();
  };
  const close = () => {
    dialog.classList.add('closing');
    setTimeout(() => {
      dialog.classList.remove('closing');
      dialog.close();
    }, 180);
  };
  document.getElementById('settings-open')!.addEventListener('click', open);
  document.getElementById('settings-close')!.addEventListener('click', close);
  // a click on the dimmed backdrop closes; Esc closes natively
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) close();
  });
  dialog.addEventListener('cancel', (e) => {
    e.preventDefault();
    close();
  });

  // ---- theme: dark (default), light, or whatever the system uses
  const themeBtns = [...document.querySelectorAll<HTMLButtonElement>('[data-theme-pick]')];
  const menuTheme = document.querySelector<HTMLElement>('.logo-menu-theme')!;
  const menuThemeBtn = menuTheme.closest('button')!;
  function setTheme(t: Theme): void {
    write(THEME_KEY, t);
    applyTheme(t);
    paintTheme();
  }
  function paintTheme(): void {
    const t = savedTheme();
    themeBtns.forEach((b) => b.setAttribute('aria-checked', String(b.dataset.themePick === t)));
    const light = shownTheme() === 'light';
    menuTheme.textContent = light ? 'Dark mode' : 'Light mode';
    menuThemeBtn.querySelector('svg')?.replaceWith(icon(light ? 'moon' : 'sun'));
  }
  themeBtns.forEach((b) => b.addEventListener('click', () => setTheme(b.dataset.themePick as Theme)));
  lightQuery.addEventListener('change', () => {
    if (savedTheme() === 'system') {
      applyTheme('system');
      paintTheme();
    }
  });
  applyTheme(savedTheme());
  paintTheme();

  // ---- language: the page reloads in the other one (every label is translated on the way in)
  const langBtns = [...document.querySelectorAll<HTMLButtonElement>('[data-lang-pick]')];
  const lang = read(LANG_KEY) === 'ko' ? 'ko' : 'en';
  langBtns.forEach((b) => {
    b.setAttribute('aria-checked', String(b.dataset.langPick === lang));
    // the language names stay as they are, in either language
    b.dataset.noI18n = '';
    b.addEventListener('click', () => {
      if (b.dataset.langPick === lang) return;
      write(LANG_KEY, b.dataset.langPick!);
      location.reload();
    });
  });

  // ---- the logo's menu
  const menu = document.getElementById('logo-menu')!;
  const logos = [...document.querySelectorAll<HTMLButtonElement>('.rail-brand, .brand-mark-btn')];
  let opener: HTMLButtonElement | null = null;
  // open or not, apart from the closing fade (a click during the fade opens it again)
  let menuOpen = false;
  let hideTimer = 0;
  function closeMenu(focusBack = false): void {
    if (!menuOpen) return;
    menuOpen = false;
    menu.classList.add('closing');
    clearTimeout(hideTimer);
    hideTimer = window.setTimeout(() => {
      menu.hidden = true;
      menu.classList.remove('closing');
    }, 140);
    logos.forEach((l) => l.setAttribute('aria-expanded', 'false'));
    if (focusBack) opener?.focus();
  }
  function openMenu(from: HTMLButtonElement): void {
    opener = from;
    const r = from.getBoundingClientRect();
    menu.style.left = `${Math.round(r.right + 10)}px`;
    menu.style.top = `${Math.round(r.top)}px`;
    clearTimeout(hideTimer);
    menuOpen = true;
    menu.classList.remove('closing');
    menu.hidden = false;
    from.setAttribute('aria-expanded', 'true');
    menu.querySelector<HTMLButtonElement>('button')!.focus({ preventScroll: true });
  }
  for (const logo of logos) {
    logo.addEventListener('click', (e) => {
      e.stopPropagation();
      if (menuOpen && opener === logo) closeMenu();
      else openMenu(logo);
    });
    // right-click still goes straight to Settings
    logo.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      closeMenu();
      open();
    });
  }
  menu.addEventListener('click', (e) => {
    const item = (e.target as Element).closest<HTMLButtonElement>('[data-menu]');
    if (!item) return;
    const what = item.dataset.menu;
    if (what === 'theme') {
      // flips what is showing (and stops following the system)
      setTheme(shownTheme() === 'light' ? 'dark' : 'light');
      return;
    }
    closeMenu();
    if (what === 'settings') open();
    if (what === 'overview') toggleDrawer('left');
  });
  document.addEventListener('pointerdown', (e) => {
    if (menuOpen && !(e.target as Element).closest('#logo-menu, .rail-brand, .brand-mark-btn')) closeMenu();
  });
  menu.addEventListener('keydown', (e) => {
    const items = [...menu.querySelectorAll<HTMLButtonElement>('button')];
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'Escape') {
      e.stopPropagation();
      closeMenu(true);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]!.focus();
    } else if (e.key === 'Tab') closeMenu();
  });

  // ---- rail hints
  const rail = document.getElementById('rail')!;
  const tip = document.createElement('div');
  tip.className = 'rail-tip';
  tip.setAttribute('role', 'tooltip');
  tip.hidden = true;
  document.body.append(tip);
  let showTimer = 0;
  const hide = () => {
    clearTimeout(showTimer);
    tip.classList.remove('on');
  };
  rail.addEventListener('pointerover', (e) => {
    const btn = (e.target as Element).closest<HTMLElement>('[data-tip]');
    if (!btn || e.pointerType === 'touch') return;
    clearTimeout(showTimer);
    // the first hint waits a moment; moving along the rail then updates at once
    showTimer = window.setTimeout(() => {
      const [name, ...rest] = btn.dataset.tip!.split(' · ');
      tip.innerHTML = '<strong></strong><span></span>';
      tip.querySelector('strong')!.textContent = name!;
      tip.querySelector('span')!.textContent = rest.join(' · ');
      const r = btn.getBoundingClientRect();
      tip.style.top = `${r.top + r.height / 2}px`;
      tip.style.left = `${rail.getBoundingClientRect().right + 10}px`;
      tip.hidden = false;
      tip.classList.add('on');
    }, tip.classList.contains('on') ? 0 : 220);
  });
  rail.addEventListener('pointerleave', hide);
  rail.addEventListener('pointerdown', hide);
}
