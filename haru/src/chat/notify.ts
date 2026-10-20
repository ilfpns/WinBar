import { avatar } from '../cloud/session';
import { icon } from '../ui/icons';
import { lang } from '../ui/i18n';
import { goTo } from '../ui/router';

/**
 * A new chat message from someone else, the way Discord tells you: when Haru shows another page, a card rises at
 * the bottom right (who, what; a click opens the chat) with a soft ping; when Haru isn't the window you're
 * looking at, the system's own notification. Only while Haru is open in some tab — telling a closed browser
 * would take a push server. The bell beside Chat's title turns it on or off (asking the browser's permission
 * for system notifications the first time).
 */
const KEY = 'haru:chat-notify';
export const notifyOn = (): boolean => {
  try {
    return localStorage.getItem(KEY) !== '0';
  } catch {
    return true;
  }
};
const setOn = (on: boolean) => {
  try {
    localStorage.setItem(KEY, on ? '1' : '0');
  } catch {
    // for this visit
  }
};

/** A message's words without their Markdown marks, for a one-line preview. */
const plain = (text: string, photos: number) => {
  const words = text
    .replace(/@\[([^\]]+)\]\(user:[\w-]+\)/g, '@$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^\s*(#{1,6} |[-*+] \[[ xX]\] |[-*+] |\d+\. |> ?\[!\w+\] ?|> |\| )/gm, '')
    .replace(/\*\*|__|~~|`/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const pics = photos ? (lang() === 'ko' ? `사진 ${photos}장` : photos === 1 ? 'A photo' : `${photos} photos`) : '';
  return [words, pics].filter(Boolean).join(' · ') || pics;
};

// ---- the ping: two soft notes, made on the spot (no sound file)
let audio: AudioContext | null = null;
function ping(): void {
  try {
    audio ??= new AudioContext();
    const now = audio.currentTime;
    for (const [freq, at] of [[880, 0], [1320, 0.09]] as const) {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now + at);
      gain.gain.exponentialRampToValueAtTime(0.08, now + at + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + at + 0.28);
      osc.connect(gain).connect(audio.destination);
      osc.start(now + at);
      osc.stop(now + at + 0.3);
    }
  } catch {
    // no sound before the page has been touched; the card still shows
  }
}

// ---- the card at the bottom right
let stack: HTMLElement | null = null;
function card(name: string, photo: string | null, body: string): void {
  stack ??= Object.assign(document.createElement('div'), { className: 'toast-stack' });
  if (!stack.isConnected) document.body.append(stack);
  const t = document.createElement('button');
  t.type = 'button';
  t.className = 'toast';
  const text = document.createElement('span');
  text.className = 'toast-text';
  const who = document.createElement('strong');
  who.textContent = name;
  const what = document.createElement('span');
  what.className = 'toast-body';
  what.textContent = body;
  text.append(who, what);
  const where = document.createElement('span');
  where.className = 'toast-where';
  where.append(icon('messages'));
  t.append(avatar({ name, photo }, 'a-avatar toast-face'), text, where);
  const close = () => {
    t.classList.add('out');
    setTimeout(() => t.remove(), 260);
  };
  t.addEventListener('click', () => {
    goTo('chat');
    close();
  });
  stack.append(t);
  // at most three at once
  while (stack.children.length > 3) stack.firstElementChild!.remove();
  setTimeout(close, 6000);
}

/** Tells you about a message someone else just sent (if notifications are on and you aren't reading the chat). */
export function notifyMessage(m: { name: string; photo: string | null; text: string; images?: string[] }, inChat: boolean, mentioned = false): void {
  if (!notifyOn()) return;
  // named (by name or @ALL): said first
  const called = mentioned ? (lang() === 'ko' ? '나를 불렀어요 · ' : 'mentioned you · ') : '';
  const body = called + plain(m.text, m.images?.length ?? 0);
  const away = document.visibilityState === 'hidden' || !document.hasFocus();
  if (away && 'Notification' in window && Notification.permission === 'granted') {
    const n = new Notification(`${m.name} · Haru`, { body, icon: m.photo ?? `${import.meta.env.BASE_URL}favicon.png`, tag: 'haru-chat' });
    n.onclick = () => {
      window.focus();
      goTo('chat');
      n.close();
    };
    return;
  }
  if (inChat) return;
  card(m.name, m.photo, body);
  ping();
}

/** The bell beside Chat's title: on or off; turning it on asks for system notifications if not decided yet. */
export function mountNotifyToggle(head: HTMLElement): void {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'icon-btn chat-bell';
  const paint = () => {
    const on = notifyOn();
    b.replaceChildren(icon(on ? 'bell' : 'bell-off'));
    b.setAttribute('aria-pressed', String(on));
    const sys = 'Notification' in window ? Notification.permission : 'denied';
    const label = !on ? 'Notifications off' : sys === 'granted' ? 'Notifications on (also when Haru is in the background)' : 'Notifications on (in Haru only — allow notifications in the browser for the background)';
    b.setAttribute('aria-label', label);
    b.title = label;
  };
  b.addEventListener('click', async () => {
    const on = !notifyOn();
    setOn(on);
    if (on && 'Notification' in window && Notification.permission === 'default') await Notification.requestPermission().catch(() => 'denied');
    if (on) ping();
    paint();
  });
  head.append(b);
  paint();
}
