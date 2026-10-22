import { icon } from './icons';

/**
 * Haru as an app: installed to the home screen or taskbar it opens in its own window, without the address bar
 * (public/manifest.webmanifest), and opens without a connection too (public/sw.js). It stays the same site: a
 * deploy reaches the installed app on its next open. A window left open learns of a new version from the
 * service worker and shows a card to reload into it.
 */
interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export type InstallState = 'installed' | 'prompt' | 'ios' | 'manual';

let deferred: InstallPrompt | null = null;
let justInstalled = false;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((fn) => fn());

const standalone = (): boolean =>
  matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
// iPhone and iPad (iPadOS says it is a Mac, but a Mac has no touch screen): installed only from Safari's Share menu
const ios = (): boolean => /iphone|ipad|ipod/i.test(navigator.userAgent) || (/macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1);

/** How Haru can be installed here. */
export function installState(): InstallState {
  if (standalone() || justInstalled) return 'installed';
  if (deferred) return 'prompt';
  return ios() ? 'ios' : 'manual';
}

export function onInstallState(fn: () => void): void {
  listeners.add(fn);
}

/** Asks the browser to install Haru; false where it can't be asked (then the steps are shown instead). */
export async function install(): Promise<boolean> {
  if (!deferred) return false;
  const p = deferred;
  deferred = null;
  await p.prompt();
  if ((await p.userChoice).outcome === 'accepted') justInstalled = true;
  changed();
  return true;
}

// ---- a new version while a window is open
let card: HTMLElement | null = null;
function offerReload(waiting: ServiceWorker): void {
  if (card?.isConnected) return;
  // at the top: it stays until answered, and the bottom right is where Chat's send button is
  card = document.createElement('div');
  card.className = 'toast toast-update';
  card.setAttribute('role', 'status');
  const go = document.createElement('button');
  go.type = 'button';
  go.className = 'toast-go';
  const text = document.createElement('span');
  text.className = 'toast-text';
  text.append(
    Object.assign(document.createElement('strong'), { textContent: 'New version of Haru' }),
    Object.assign(document.createElement('span'), { className: 'toast-body', textContent: 'Reload to use it' }),
  );
  go.append(icon('refresh'), text);
  const later = document.createElement('button');
  later.type = 'button';
  later.className = 'icon-btn toast-x';
  later.setAttribute('aria-label', 'Later');
  later.append(icon('x'));
  card.append(go, later);
  go.addEventListener('click', () => {
    go.disabled = true;
    // the new worker takes over, then the page reloads into the new build
    navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
    waiting.postMessage('take-over');
    // a worker that never answers: reload anyway (the page itself always comes from the network first)
    setTimeout(() => location.reload(), 3000);
  });
  later.addEventListener('click', () => {
    card!.classList.add('out');
    setTimeout(() => card?.remove(), 260);
  });
  document.body.append(card);
}

/** The build a worker was made for (null if it doesn't answer). */
const buildOf = (w: ServiceWorker): Promise<string | null> => new Promise((resolve) => {
  const ch = new MessageChannel();
  ch.port1.onmessage = (e) => resolve(String(e.data));
  w.postMessage('build', [ch.port2]);
  setTimeout(() => resolve(null), 2000);
});

function watch(reg: ServiceWorkerRegistration): void {
  // only an update: the first worker on a device has nothing to replace
  const ready = async (w: ServiceWorker | null) => {
    if (!w || !navigator.serviceWorker.controller) return;
    // opened after a deploy, the page is already the new build (it comes from the network first): the new
    // worker just takes over, nothing to reload
    if ((await buildOf(w)) === __BUILD_ID__) w.postMessage('take-over');
    else offerReload(w);
  };
  void ready(reg.waiting);
  reg.addEventListener('updatefound', () => {
    const w = reg.installing;
    w?.addEventListener('statechange', () => {
      if (w.state === 'installed') void ready(w);
    });
  });
  // look for a new version on coming back to the window, and every half hour while it stays open
  let last = Date.now();
  const check = () => {
    if (Date.now() - last < 60_000) return;
    last = Date.now();
    reg.update().catch(() => {});
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') check();
  });
  setInterval(check, 30 * 60_000);
}

export function mountPwa(): void {
  addEventListener('beforeinstallprompt', (e) => {
    // Haru shows its own Install (logo menu, Settings → About) instead of the browser's banner
    e.preventDefault();
    deferred = e as InstallPrompt;
    changed();
  });
  addEventListener('appinstalled', () => {
    deferred = null;
    justInstalled = true;
    changed();
  });
  // not in development: a kept copy would hide every edit
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  // after the page has loaded: the worker's first downloads don't compete with Haru's own
  const register = () => navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).then(watch, () => {
    // no worker (a private window, blocked storage): Haru works as a plain site
  });
  if (document.readyState === 'complete') void register();
  else addEventListener('load', () => void register(), { once: true });
}
