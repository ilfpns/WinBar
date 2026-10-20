/**
 * What waits for you, on Haru's own tab: unread chat messages and pages that name you add up to a count in the
 * title ("(3) Haru") and a green dot on the tab icon, so another tab in front still shows it. Back to plain
 * "Haru" (and the plain icon) once everything is read.
 */
const counts = new Map<string, number>();
let plainIcon: string | null = null;
let dotted: string | null = null;

function iconLink(): HTMLLinkElement | null {
  return document.querySelector<HTMLLinkElement>('link[rel="icon"]');
}

/** The tab icon with a dot in its top-right corner (drawn once, kept). */
async function dottedIcon(src: string): Promise<string | null> {
  if (dotted) return dotted;
  try {
    const img = new Image();
    img.src = src;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    g.drawImage(img, 0, 0, 64, 64);
    // a ring of the tab's dark under the dot keeps it apart from the logo
    g.fillStyle = '#0d0e10';
    g.beginPath();
    g.arc(50, 14, 14, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#4fbf7a';
    g.beginPath();
    g.arc(50, 14, 10, 0, Math.PI * 2);
    g.fill();
    dotted = c.toDataURL('image/png');
    return dotted;
  } catch {
    return null;
  }
}

function paint(): void {
  const n = [...counts.values()].reduce((a, b) => a + b, 0);
  const title = n ? `(${n > 99 ? '99+' : n}) Haru` : 'Haru';
  if (document.title !== title && /^(\(\d+\+?\) )?Haru$/.test(document.title)) document.title = title;
  const link = iconLink();
  if (!link) return;
  plainIcon ??= link.href;
  if (!n) {
    if (link.href !== plainIcon) link.href = plainIcon;
    return;
  }
  void dottedIcon(plainIcon).then((url) => {
    // still something waiting by the time the dot is drawn
    if (url && [...counts.values()].some((x) => x > 0)) link.href = url;
  });
}

/** How many of one kind wait for you (chat, mentions); the tab shows their sum. */
export function setBadge(kind: string, n: number): void {
  if ((counts.get(kind) ?? 0) === n) return;
  counts.set(kind, n);
  paint();
}
