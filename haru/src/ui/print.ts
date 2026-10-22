import { renderMarkdown } from './markdown';

/**
 * PDF export through the browser's print dialog ("Save as PDF"): no library, real selectable text.
 * The pages go into a print-only layer; everything else is hidden while it prints.
 */
export interface PrintSection {
  title: string;
  /** Small line under the title (a date, a summary). */
  meta?: string;
  /** Markdown body. */
  body: string;
  /** Where the photos placed in the body can be read from (left out, they are skipped). */
  imageUrl?: (id: string) => string | null;
}

export function printPdf(fileName: string, heading: string, sections: PrintSection[]): void {
  // a layer left from an earlier print (no afterprint came) must not print again
  document.getElementById('print-root')?.remove();
  const root = document.createElement('div');
  root.id = 'print-root';
  // the page has no margin (so the browser adds no date, title or address in it); a blank head and foot
  // repeated on every page give the paper its margins instead
  root.innerHTML = '<table class="pr-frame"><thead><tr><td><div class="pr-gap"></div></td></tr></thead>'
    + '<tfoot><tr><td><div class="pr-gap"></div></td></tr></tfoot><tbody><tr><td class="pr-sheet"></td></tr></tbody></table>';
  const sheet = root.querySelector<HTMLElement>('.pr-sheet')!;
  // only the name and a rule on top
  const h = document.createElement('header');
  h.className = 'pr-head';
  h.innerHTML = '<span class="pr-brand">Haru</span>';
  h.setAttribute('aria-label', heading);
  sheet.append(h);
  for (const s of sections) {
    const art = document.createElement('article');
    art.className = 'pr-entry';
    const t = document.createElement('h1');
    t.textContent = s.title;
    art.append(t);
    if (s.meta) {
      const m = document.createElement('p');
      m.className = 'pr-meta';
      m.textContent = s.meta;
      art.append(m);
    }
    const body = document.createElement('div');
    body.className = 'pr-body';
    body.innerHTML = renderMarkdown(s.body, s.imageUrl);
    art.append(body);
    sheet.append(art);
  }
  document.body.append(root);
  document.body.classList.add('printing');
  // the browser names the PDF after the page title
  const title = document.title;
  document.title = fileName;
  const done = () => {
    removeEventListener('afterprint', done);
    document.body.classList.remove('printing');
    document.title = title;
    root.remove();
  };
  addEventListener('afterprint', done);
  // give the layer a frame to lay out before the dialog snapshots it
  requestAnimationFrame(() => requestAnimationFrame(() => print()));
}
