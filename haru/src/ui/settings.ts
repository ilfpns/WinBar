import { greetName, setGreetName } from './greeting';
import { icon } from './icons';
import { toggleDrawer } from '../timetable/state';
import { shownTheme, showTheme } from './theme';
import { FEATURES, featureOn, onFeatures, setFeature } from './features';
import { timeField } from './time-field';
import { DEFAULT_RESET, onResetAt, resetAt, setResetAt } from '../timetable/day-reset';
import { notionName, notionTaken, notionView, onNotionAttendance, setNotionName } from '../calendar/notion-attendance';
import { NEIS_KEYLESS_ROWS, type School, applyLessons, classesOf, hasNeisKey, isComci, lessonsToday, mealBlocks, mealsToday, myClass, mySchool, searchSchools, setMyClass, setMySchool } from '../timetable/school';
import { autoOn, dayDate, setAuto } from '../timetable/school-auto';
import { askConfirm } from './modal';
import { type Session, avatar, onSession, session } from '../cloud/session';
import { labelOf } from '../timetable/model';
import { hhmm } from '../timetable/time';
import { type Motion, savedMotion, setMotion } from './motion';
import { asPopover, hidePop, isPopOpen, onPopToggle, showPop } from './popover';
import { type InstallState, install, installState, onInstallState } from './pwa';

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
  build.textContent = __BUILD_ID__;

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

  // ---- pages: the sidebar picks one; search shows every matching row across them
  const navBtns = [...dialog.querySelectorAll<HTMLButtonElement>('.set-nav [data-set-page]')];
  const pages = [...dialog.querySelectorAll<HTMLElement>('.set-page')];
  const search = dialog.querySelector<HTMLInputElement>('#set-search')!;
  const none = dialog.querySelector<HTMLElement>('.set-none')!;
  const PAGE_KEY = 'haru:settings-page';
  let page = read(PAGE_KEY) ?? 'appearance';
  if (!pages.some((p) => p.dataset.page === page)) page = 'appearance';
  function showPage(next: string): void {
    page = next;
    write(PAGE_KEY, page);
    search.value = '';
    filter();
  }
  function filter(): void {
    const q = search.value.trim().toLowerCase();
    let any = false;
    for (const p of pages) {
      if (!q) {
        p.hidden = p.dataset.page !== page;
        p.querySelectorAll<HTMLElement>('.set-row').forEach((r) => (r.hidden = false));
        continue;
      }
      // searching: a page shows when its title or any of its rows match, and only those rows
      const titleHit = (p.querySelector('.set-title')?.textContent ?? '').toLowerCase().includes(q);
      let hits = 0;
      p.querySelectorAll<HTMLElement>('.set-row').forEach((r) => {
        const hit = titleHit || (r.textContent ?? '').toLowerCase().includes(q);
        r.hidden = !hit;
        if (hit) hits++;
      });
      p.hidden = !titleHit && !hits;
      if (!p.hidden) any = true;
    }
    none.hidden = !q || any;
    navBtns.forEach((b) => {
      b.setAttribute('aria-current', String(!q && b.dataset.setPage === page));
      b.classList.toggle('dim', !!q && !pages.some((p) => !p.hidden && p.dataset.page === b.dataset.setPage));
    });
  }
  navBtns.forEach((b) => b.addEventListener('click', () => showPage(b.dataset.setPage!)));
  dialog.querySelector<HTMLButtonElement>('.set-me')!.addEventListener('click', () => showPage('account'));
  // the card at the sidebar's foot, the backup note over it and About's data line follow who is signed in
  const me = dialog.querySelector<HTMLElement>('.set-me')!;
  const meName = me.querySelector<HTMLElement>('.set-me-text strong')!;
  const meSub = me.querySelector<HTMLElement>('.set-me-text .meta')!;
  const promoText = dialog.querySelector<HTMLElement>('.set-promo p')!;
  const aboutData = dialog.querySelector<HTMLElement>('#about-data');
  const paintMe = (s: Session | null) => {
    me.querySelector('.set-me-avatar')!.replaceWith(s ? avatar(s, 'set-me-avatar') : Object.assign(document.createElement('span'), { className: 'set-me-avatar', textContent: 'H' }));
    meName.textContent = s ? s.name || s.email : 'This device';
    meSub.textContent = s ? s.email : 'Local · sign-in off';
    me.setAttribute('aria-label', s ? `Account · ${s.name || s.email}` : 'Account · this device');
    promoText.textContent = s ? 'Synced to your account. A backup file is a second copy you keep.' : 'Everything lives on this device. A backup file keeps it safe.';
    if (aboutData) aboutData.textContent = s
      ? 'Kept in this browser and synced to your account (Firestore), so your other devices have it too'
      : 'Kept in this browser (local storage and IndexedDB), never sent anywhere while sign-in is off';
  };
  onSession(paintMe);
  paintMe(session());
  search.addEventListener('input', filter);
  dialog.querySelector('#set-promo-export')!.addEventListener('click', () => document.getElementById('backup-export')!.click());
  filter();

  // ---- features: switches for the pages and tools that can be off
  const featureBox = dialog.querySelector<HTMLElement>('#set-features')!;
  featureBox.replaceChildren(...FEATURES.map((f) => {
    const row = document.createElement('div');
    row.className = 'set-row';
    row.innerHTML = '<div class="set-label"><strong></strong><span></span></div>';
    row.querySelector('strong')!.textContent = f.label;
    row.querySelector('span')!.textContent = f.hint;
    const sw = document.createElement('button');
    sw.type = 'button';
    sw.className = 'switch';
    sw.setAttribute('role', 'switch');
    sw.setAttribute('aria-label', f.label);
    sw.append(document.createElement('i'));
    const paint = () => sw.setAttribute('aria-checked', String(featureOn(f.id)));
    sw.addEventListener('click', () => setFeature(f.id, !featureOn(f.id)));
    onFeatures(paint);
    paint();
    row.append(sw);
    return row;
  }));

  // ---- new day: when Today is filed away and starts empty (off: it carries on)
  const resetTime = dialog.querySelector<HTMLButtonElement>('#reset-time')!;
  const resetOn = dialog.querySelector<HTMLButtonElement>('#reset-on')!;
  // the time stays shown (dimmed) while off, so turning it back on keeps it
  let lastReset = resetAt() ?? DEFAULT_RESET;
  const resetField = timeField(resetTime, (m) => {
    lastReset = m;
    setResetAt(m);
  });
  resetOn.addEventListener('click', () => setResetAt(resetAt() === null ? lastReset : null));
  const paintReset = () => {
    const at = resetAt();
    if (at !== null) lastReset = at;
    resetField.set(lastReset);
    resetTime.disabled = at === null;
    resetOn.setAttribute('aria-checked', String(at !== null));
  };
  onResetAt(paintReset);
  paintReset();

  // ---- school timetable: find your school, pick your class, Apply lays today's lessons on Today
  const classSel = dialog.querySelector<HTMLSelectElement>('#school-class')!;
  const schoolStatus = dialog.querySelector<HTMLElement>('#school-status')!;
  const schoolApply = dialog.querySelector<HTMLButtonElement>('#school-apply')!;
  const schoolName = dialog.querySelector<HTMLElement>('#school-name')!;
  const schoolForm = dialog.querySelector<HTMLFormElement>('#school-search')!;
  const schoolQ = dialog.querySelector<HTMLInputElement>('#school-q')!;
  const schoolResults = dialog.querySelector<HTMLElement>('#school-results')!;
  // the class picker: a field like the time fields that opens grades as rows of class chips (the <select>
  // underneath keeps the value and the logic that reads it)
  classSel.hidden = true;
  const classBtn = document.createElement('button');
  classBtn.type = 'button';
  classBtn.className = 'time-field class-field';
  classBtn.setAttribute('aria-haspopup', 'dialog');
  classBtn.setAttribute('aria-expanded', 'false');
  classBtn.setAttribute('aria-label', 'Class');
  const classText = document.createElement('span');
  classText.className = 'time-text';
  classBtn.append(classText, icon('chevron-down'));
  classSel.before(classBtn);
  const classPop = document.createElement('div');
  classPop.className = 'class-pop';
  asPopover(classPop);
  document.body.append(classPop);
  const paintClassBtn = () => {
    classText.textContent = classSel.selectedOptions[0]?.value ? classSel.selectedOptions[0]!.text : 'Class';
    classBtn.classList.toggle('empty', !classSel.value);
    classBtn.disabled = classSel.options.length <= 1;
  };
  function openClassPop(): void {
    const byGrade = new Map<string, HTMLOptionElement[]>();
    for (const o of [...classSel.options].filter((x) => x.value)) {
      const g = o.value.split('-')[0]!;
      byGrade.set(g, [...(byGrade.get(g) ?? []), o]);
    }
    classPop.replaceChildren(...[...byGrade].map(([g, opts]) => {
      const row = document.createElement('div');
      row.className = 'class-row';
      const label = document.createElement('span');
      label.className = 'meta class-grade';
      label.textContent = `${g}학년`;
      const chips = document.createElement('div');
      chips.className = 'class-chips';
      chips.append(...opts.map((o) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = `${o.value.split('-')[1]}반`;
        b.setAttribute('aria-pressed', String(o.value === classSel.value));
        b.addEventListener('click', () => {
          classSel.value = o.value;
          classSel.dispatchEvent(new Event('change'));
          hidePop(classPop);
        });
        return b;
      }));
      row.append(label, chips);
      return row;
    }));
    // inside the settings dialog (a modal dialog leaves everything outside it unclickable)
    showPop(classPop, classBtn);
    const r = classBtn.getBoundingClientRect();
    const w = classPop.offsetWidth;
    const h = classPop.offsetHeight;
    classPop.style.left = `${Math.max(8, Math.min(r.right - w, innerWidth - w - 8))}px`;
    classPop.style.top = `${r.bottom + 6 + h > innerHeight - 8 ? r.top - h - 6 : r.bottom + 6}px`;
    classPop.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus();
  }
  classBtn.addEventListener('click', () => (isPopOpen(classPop) ? hidePop(classPop) : openClassPop()));
  onPopToggle(classPop, (open) => classBtn.setAttribute('aria-expanded', String(open)));
  const schoolSay = (text: string, ok?: boolean) => {
    schoolStatus.textContent = text;
    schoolStatus.className = `set-status${ok === undefined ? '' : ok ? ' ok' : ' bad'}`;
  };
  /** Shows the chosen school and fills its classes. */
  async function paintSchool(): Promise<void> {
    const s = mySchool();
    schoolName.textContent = `${s.name} · ${s.region}`;
    classSel.replaceChildren(new Option('Class', ''));
    schoolApply.disabled = true;
    paintClassBtn();
    let classes: string[] = [];
    try {
      classes = await classesOf(s);
    } catch {
      // NEIS unreachable
    }
    if (!classes.length) {
      schoolSay('The school timetable isn’t available right now', false);
      return;
    }
    schoolSay('');
    for (const c of classes) {
      const [g, n] = c.split('-');
      classSel.append(new Option(`${g}학년 ${n}반`, c, false, c === myClass()));
    }
    schoolApply.disabled = false;
    paintClassBtn();
  }
  schoolForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const q = schoolQ.value.trim();
    if (q.length < 2) return;
    let found: School[] = [];
    try {
      found = await searchSchools(q);
    } catch {
      // NEIS unreachable
    }
    schoolResults.hidden = false;
    if (!found.length) {
      schoolResults.replaceChildren(Object.assign(document.createElement('span'), { className: 'meta', textContent: 'No schools found' }));
      return;
    }
    schoolResults.replaceChildren(...found.slice(0, 12).map((s) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip school-pick';
      b.textContent = `${s.name} · ${s.region}`;
      b.addEventListener('click', () => {
        setMySchool(s);
        schoolResults.hidden = true;
        schoolQ.value = '';
        void paintSchool();
      });
      return b;
    }));
  });
  void paintSchool();
  classSel.addEventListener('change', () => {
    setMyClass(classSel.value);
    paintClassBtn();
  });
  schoolApply.addEventListener('click', async () => {
    if (!classSel.value) {
      schoolSay('Pick your class first', false);
      return;
    }
    // the day Today is on (after midnight but before the New day time, that is still yesterday)
    const lessons = await lessonsToday(mySchool(), classSel.value, dayDate());
    if (typeof lessons === 'string') {
      schoolSay(lessons, false);
      return;
    }
    const first = lessons[0]!;
    const last = lessons.at(-1)!;
    const span = `${hhmm(first.start)}–${hhmm(last.start + last.dur)}`;
    if (!(await askConfirm({ title: 'Put today’s lessons on Today?', body: `${lessons.length} lessons, ${span}. Tasks in those hours are replaced.`, ok: 'Apply', icon: 'graduation-cap' }))) return;
    const replaced = applyLessons(lessons);
    schoolSay(`Added ${lessons.length} lessons${replaced.length ? ` · replaced ${replaced.map(labelOf).join(', ')}` : ''}`, true);
    // NEIS without a key stops at its first rows: the day may go on past them
    if (!isComci(mySchool()) && !(await hasNeisKey()) && lessons.length >= NEIS_KEYLESS_ROWS) {
      schoolSay(`Added ${lessons.length} lessons · NEIS gives only the first ${NEIS_KEYLESS_ROWS} periods without a key`, true);
    }
  });

  // ---- school meals: Apply puts today's on Today now; the switches fill each day by themselves
  const mealsApply = dialog.querySelector<HTMLButtonElement>('#meals-apply')!;
  const mealsStatus = dialog.querySelector<HTMLElement>('#meals-status')!;
  const mealsSay = (text: string, ok?: boolean) => {
    mealsStatus.textContent = text;
    mealsStatus.className = `set-status${ok === undefined ? '' : ok ? ' ok' : ' bad'}`;
  };
  mealsApply.addEventListener('click', async () => {
    mealsSay('…');
    const meals = await mealsToday(mySchool(), dayDate());
    if (typeof meals === 'string') {
      mealsSay(meals, false);
      return;
    }
    const blocks = await mealBlocks(mySchool(), meals, dayDate());
    const list = blocks.map((b) => `${b.title} ${hhmm(b.start)}`).join(', ');
    if (!(await askConfirm({ title: 'Put today’s meals on Today?', body: `${list}. Tasks in those hours are replaced; the menu goes in each task's note.`, ok: 'Apply', icon: 'utensils' }))) {
      mealsSay('');
      return;
    }
    const replaced = applyLessons(blocks);
    mealsSay(`Added ${list}${replaced.length ? ` · replaced ${replaced.map(labelOf).join(', ')}` : ''}`, true);
  });
  for (const [kind, id] of [['lessons', '#school-auto'], ['meals', '#meals-auto']] as const) {
    const sw = dialog.querySelector<HTMLButtonElement>(id)!;
    const paint = () => sw.setAttribute('aria-checked', String(autoOn(kind)));
    sw.addEventListener('click', () => {
      if (kind === 'lessons' && !autoOn(kind) && !classSel.value) {
        schoolSay('Pick your class first', false);
        return;
      }
      setAuto(kind, !autoOn(kind));
      paint();
      const say = kind === 'lessons' ? schoolSay : mealsSay;
      say(autoOn(kind) ? 'On: every day, around your own tasks' : 'Off', autoOn(kind) || undefined);
    });
    paint();
  }

  // ---- name in the greeting on Today
  const greetIn = dialog.querySelector<HTMLInputElement>('#greet-name')!;
  greetIn.value = greetName();
  greetIn.addEventListener('change', () => setGreetName(greetIn.value));

  // ---- name in Notion: which column of the Notion attendance table is yours, and whether it was found
  const notionIn = dialog.querySelector<HTMLInputElement>('#notion-name')!;
  const notionStatus = dialog.querySelector<HTMLElement>('#notion-status')!;
  let notionPaint = 0;
  async function paintNotion(): Promise<void> {
    // only the latest paint writes (an earlier one still waiting must not overwrite a newer answer)
    const turn = ++notionPaint;
    if (document.activeElement !== notionIn) notionIn.value = notionName();
    const name = notionName();
    const v = name && !notionTaken() ? await notionView(name) : null;
    if (turn !== notionPaint) return;
    notionStatus.className = 'set-status';
    notionStatus.textContent = !name ? ''
      : notionTaken() ? 'This name is linked to another Haru account'
        : v?.known ? `Found in Notion · ${v.days.size} days` : 'Not a column in the Notion table yet';
    if (name) notionStatus.classList.add(!notionTaken() && v?.known ? 'ok' : 'bad');
  }
  notionIn.addEventListener('change', () => setNotionName(notionIn.value));
  onNotionAttendance(() => void paintNotion());
  void paintNotion();

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
  // ---- motion: full, or less (the decoration goes; what tells you something changed stays)
  const motionBtns = [...document.querySelectorAll<HTMLButtonElement>('[data-motion-pick]')];
  const paintMotion = () => motionBtns.forEach((b) => b.setAttribute('aria-checked', String(b.dataset.motionPick === savedMotion())));
  motionBtns.forEach((b) => b.addEventListener('click', () => {
    setMotion(b.dataset.motionPick as Motion);
    paintMotion();
  }));
  paintMotion();
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
  const logos = [...document.querySelectorAll<HTMLButtonElement>('.rail-brand, .brand-mark-btn, .tb-brand')];
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
    // from the title bar it drops below the logo, elsewhere it opens beside it
    const below = !!from.closest('.titlebar');
    menu.style.left = `${Math.round(below ? r.left : r.right + 10)}px`;
    menu.style.top = `${Math.round(below ? r.bottom + 6 : r.top)}px`;
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
    if (what === 'install') startInstall();
  });

  // ---- installing Haru as an app (Settings → About; the logo's menu and the overview's foot while there is
  // something to do, the overview being where a phone finds it)
  /** The browser's own install where it has one, the steps (Settings → About) where it doesn't. */
  function startInstall(): void {
    void install().then((asked) => {
      if (asked) return;
      showPage('about');
      open();
    });
  }
  const HINT: Record<InstallState, string> = {
    installed: 'Installed. Haru opens in its own window',
    prompt: 'Put Haru on your home screen or taskbar. It opens like an app, even offline',
    ios: 'In Safari: Share, then Add to Home Screen. Sign in again in the app; your data comes with your account',
    manual: 'From your browser’s menu: Install app, or Add to Home screen',
  };
  const installHint = document.getElementById('install-hint')!;
  const installBtn = document.getElementById('install-btn') as HTMLButtonElement;
  const installItem = menu.querySelector<HTMLButtonElement>('[data-menu="install"]')!;
  const installFoot = document.getElementById('install-open') as HTMLButtonElement;
  installFoot.addEventListener('click', startInstall);
  const paintInstall = () => {
    const s = installState();
    installHint.textContent = HINT[s];
    installBtn.hidden = s !== 'prompt';
    installItem.hidden = installFoot.hidden = s !== 'prompt' && s !== 'ios';
  };
  installBtn.addEventListener('click', () => void install());
  onInstallState(paintInstall);
  paintInstall();
  document.addEventListener('pointerdown', (e) => {
    if (menuOpen && !(e.target as Element).closest('#logo-menu, .rail-brand, .brand-mark-btn, .tb-brand')) closeMenu();
  });
  menu.addEventListener('keydown', (e) => {
    const items = [...menu.querySelectorAll<HTMLButtonElement>('button:not([hidden])')];
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
