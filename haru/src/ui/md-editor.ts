import { icon } from './icons';
import { IMG_LINE, imageLine } from './markdown';
import { CALLOUT_ICON, NL, ZW, blockOf, isHiddenMark, isRow, isSep, line, pipesOf, unZW } from './md-draw';
import { BLOCKS, type EditorCommand, MARKER, type MenuItem, SlashMenu } from './md-menu';

export type { EditorCommand } from './md-menu';

/**
 * <md-editor>: a note you write in Markdown that shows its formatting as you type — a `# ` line is a
 * heading at once, **bold** is bold, `- [ ]` is a box you can tick — while the marks stay in the text,
 * dimmed, so what is saved is plain Markdown. Notion-style extras: `/` opens a menu of blocks, Tab and
 * Shift+Tab indent, Enter carries a list on (and ends it on an empty item).
 *
 * It answers like a <textarea> — value, selectionStart/End, setSelectionRange, setRangeText, placeholder,
 * focus, blur, and the native input / keydown / beforeinput / paste / composition events — so the pages
 * that used a textarea keep their logic. Each line is one block element; Korean (IME) composition is never
 * re-rendered mid-syllable; undo and redo are its own (re-rendering would break the browser's).
 */

export class MdEditor extends HTMLElement {
  /**
   * Where a photo line's picture comes from (null: not here, or not yet). A click on a photo, or its copy /
   * remove button, comes out as an `md-image` event ({ id, action: 'open' | 'copy' | 'remove' }); on
   * remove the line is gone already.
   */
  imageUrl: ((id: string) => string | null) | null = null;
  /** The people `@` can name (null: no mentions here). */
  people: (() => { uid: string; name: string; photo: string | null }[]) | null = null;
  /** Commands of the page this editor is on (the chat's /변경요청), above the blocks in the / menu: picking one
   *  puts its text in place of the "/query" typed for it. */
  commands: (() => EditorCommand[]) | null = null;
  /** Whether / also offers the Markdown blocks (off in the chat, where / is for commands only). */
  slashBlocks = true;
  private composing = false;
  private placeholderText = '';
  private history: { text: string; caret: number }[] = [];
  private future: { text: string; caret: number }[] = [];
  private lastPush = 0;
  private lastCaret = 0;
  private menu = new SlashMenu(this);
  private menuAt = 0;

  constructor() {
    super();
    this.addEventListener('input', () => this.onInput());
    this.addEventListener('compositionstart', () => {
      this.composing = true;
      // a syllable on its way is already text: the placeholder goes now, not when it commits
      this.classList.remove('empty');
    });
    // a key that types (or an IME's "processing" key) clears the placeholder before any letter is drawn; the next
    // frame sets it back from what is really there
    this.addEventListener('keydown', (e) => {
      if (!this.classList.contains('empty') || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key.length !== 1 && e.keyCode !== 229) return;
      this.classList.remove('empty');
      requestAnimationFrame(() => {
        if (!this.composing) this.classList.toggle('empty', !unZW(this.textContent).length);
      });
    });
    this.addEventListener('compositionend', () => {
      this.composing = false;
      this.onInput();
    });
    this.addEventListener('keydown', (e) => this.onKey(e));
    this.addEventListener('beforeinput', (e) => this.onBeforeInput(e));
    this.addEventListener('paste', (e) => this.onPaste(e));
    this.addEventListener('click', (e) => this.onClick(e));
    this.addEventListener('pointerdown', (e) => this.onGrip(e));
    this.addEventListener('dblclick', (e) => {
      const grip = (e.target as Element).closest('.md-img-grip');
      if (grip) this.resizePhoto(grip.closest<HTMLElement>('.md-img')!, null);
    });
    this.addEventListener('blur', () => {
      this.closeMenu();
      // away from the editor no line is being edited: links and mentions read as chips again
      this.querySelectorAll('.md-l.active').forEach((l) => l.classList.remove('active'));
    });
    document.addEventListener('selectionchange', () => {
      if (document.activeElement !== this || this.composing) return;
      this.markActive();
      const sel = getSelection();
      const c = this.caret();
      if (sel?.isCollapsed) {
        const { start } = this.lineAt(this.value, c);
        const mark = this.markOfLine(c);
        // the table's separator row is hidden: the caret goes on to the row below it
        if (this.lineEl()?.classList.contains('tsep')) {
          const v = this.value;
          const end = v.indexOf('\n', c);
          this.placeCaret(end === -1 ? Math.max(0, start - 1) : end + 1);
          return;
        }
        if (mark && c - start < mark) {
          this.placeCaret(start + mark);
          return;
        }
        // parked at the end of a hidden mark (a click, an arrow key): step past it, where typing shows
        const f = sel.focusNode;
        if (f instanceof Text && sel.focusOffset === f.data.length && isHiddenMark(f) && !this.lineEl()?.matches('.hr, .img')) {
          const spot = this.caretSpot(c);
          if (spot && spot[0] !== f) {
            sel.collapse(spot[0], spot[1]);
            return;
          }
        }
      }
      this.lastCaret = c;
    });
  }

  connectedCallback(): void {
    // the attribute, not isContentEditable (which works out the element's style, mid-startup for every editor)
    if (this.getAttribute('contenteditable') === 'true') return;
    this.contentEditable = 'true';
    this.setAttribute('role', 'textbox');
    this.setAttribute('aria-multiline', 'true');
    this.spellcheck = false;
    if (!this.firstChild) this.render(this.textContent ?? '');
  }

  // ---------- the textarea-like face
  get value(): string {
    return this.serialize();
  }
  set value(v: string) {
    this.render(v.replace(/\r\n?/g, '\n'));
    this.history = [];
    this.future = [];
    this.lastCaret = Math.min(this.lastCaret, v.length);
  }
  get placeholder(): string {
    return this.placeholderText;
  }
  set placeholder(v: string) {
    this.placeholderText = v;
    this.dataset.placeholder = v;
  }
  get selectionStart(): number {
    return document.activeElement === this ? this.caret() : this.lastCaret;
  }
  get selectionEnd(): number {
    const sel = getSelection();
    if (document.activeElement !== this || !sel || sel.isCollapsed) return this.selectionStart;
    return Math.max(this.offsetOf(sel.anchorNode!, sel.anchorOffset), this.offsetOf(sel.focusNode!, sel.focusOffset));
  }
  setSelectionRange(start: number, _end?: number): void {
    this.placeCaret(start);
  }
  /** Replaces [start, end) with `text`; mode 'end' leaves the caret after it. */
  setRangeText(text: string, start: number, end: number, mode?: 'end' | 'start' | 'select' | 'preserve'): void {
    const v = this.value;
    this.remember(v, this.caret());
    this.render(v.slice(0, start) + text + v.slice(end));
    this.placeCaret(mode === 'start' ? start : start + text.length);
  }

  // ---------- text <-> blocks
  private serialize(): string {
    const lines: string[] = [];
    for (const n of this.childNodes) lines.push(n.nodeName === 'BR' ? '' : unZW(n.textContent).replace(/\n/g, ''));
    return lines.join('\n');
  }
  /** Draws the text as line blocks, touching only the lines that changed. */
  private render(text: string): void {
    const lines = text.split('\n');
    let fence = false;
    const want = lines.map((l, i) => {
      const d = line(l, fence, lines[i + 1]);
      if (/^\s*```/.test(l)) fence = !fence;
      return { ...d, src: l };
    });
    // a run of callout lines of one kind is one box: mark which lines carry on from the one above or below
    const kindOf = (src?: string) => (src === undefined ? null : /^\s*> ?\[!(\w+)\]/.exec(src)?.[1]?.toLowerCase() ?? null);
    want.forEach((w, i) => {
      const k = w.cls.includes('callout') ? kindOf(w.src) : null;
      if (!k) return;
      if (kindOf(want[i - 1]?.src) === k) w.cls += ' co-up';
      if (kindOf(want[i + 1]?.src) === k) w.cls += ' co-down';
    });
    const kids = [...this.childNodes];
    want.forEach((w, i) => {
      const cur = kids[i];
      if (cur instanceof HTMLElement && cur.tagName === 'DIV' && cur.dataset.src === w.src && cur.dataset.cls === w.cls && unZW(cur.textContent) === w.src) return;
      const div = document.createElement('div');
      div.className = w.cls;
      div.dataset.cls = w.cls;
      div.dataset.src = w.src;
      if (w.mark) div.dataset.mark = String(w.mark);
      if (w.indent) div.style.setProperty('--ind', String(w.indent));
      // an empty item still needs a line box, and a place after its hidden mark, to hold the caret
      div.innerHTML = w.html + (w.mark && w.mark === w.src.length && !/\b(hr|img)\b/.test(w.cls) ? ZW : '');
      if (cur) cur.replaceWith(div);
      else this.append(div);
    });
    for (const extra of kids.slice(want.length)) extra.remove();
    this.refreshImages();
    this.classList.toggle('empty', !text);
    this.markActive();
  }

  /** Puts each photo line's picture in (again): call when the images it shows arrive or change. */
  refreshImages(): void {
    for (const box of this.querySelectorAll<HTMLElement>('.md-img')) {
      const img = box.querySelector('img')!;
      const url = this.imageUrl?.(box.dataset.ref!) ?? null;
      if (url && img.getAttribute('src') !== url) img.src = url;
      if (!url) img.removeAttribute('src');
      box.classList.toggle('missing', !url);
      for (const b of box.querySelectorAll<HTMLElement>('.md-img-btn:empty')) b.append(icon(b.dataset.act === 'copy' ? 'copy' : 'x'));
    }
    // callouts: their icon
    for (const slot of this.querySelectorAll<HTMLElement>('.md-callout-ic:empty')) slot.append(icon(CALLOUT_ICON[slot.dataset.kind!] ?? 'lightbulb'));
    // links: the site's logo, or a chain when it has none (or can't be reached)
    for (const slot of this.querySelectorAll<HTMLElement>('.md-fav:empty')) {
      const host = slot.dataset.host;
      const chain = () => slot.replaceChildren(icon('link', 'ic md-fav-ic'));
      if (!host) {
        chain();
        continue;
      }
      const img = document.createElement('img');
      img.alt = '';
      img.decoding = 'async';
      img.addEventListener('error', chain, { once: true });
      // the service answers a site it has no logo for with its own 48px placeholder (status 404, which an
      // <img> can't see): that, or a blank 1px answer, counts as no logo
      img.addEventListener('load', () => {
        const [w, h] = [img.naturalWidth, img.naturalHeight];
        if (w <= 1 || (w === 48 && h === 48)) chain();
      }, { once: true });
      img.src = `https://icons.duckduckgo.com/ip3/${encodeURIComponent(host)}.ico`;
      slot.append(img);
    }
  }

  /** Where `node`/`off` sits in the text. */
  private offsetOf(node: Node, off: number): number {
    if (node === this) {
      let n = 0;
      for (let i = 0; i < off; i++) n += (this.childNodes[i]!.nodeName === 'BR' ? 0 : unZW(this.childNodes[i]!.textContent).length) + 1;
      return Math.max(0, n - (off ? 0 : 0));
    }
    let lineNode: Node | null = node;
    while (lineNode && lineNode.parentNode !== this) lineNode = lineNode.parentNode;
    if (!lineNode) return 0;
    let n = 0;
    for (const c of this.childNodes) {
      if (c === lineNode) break;
      n += (c.nodeName === 'BR' ? 0 : unZW(c.textContent).length) + 1;
    }
    const r = document.createRange();
    r.setStart(lineNode, 0);
    r.setEnd(node, off);
    return n + unZW(r.toString()).length;
  }
  private caret(): number {
    const sel = getSelection();
    if (!sel || !sel.focusNode || !this.contains(sel.focusNode)) return this.lastCaret;
    return this.offsetOf(sel.focusNode, sel.focusOffset);
  }
  private placeCaret(offset: number): void {
    this.lastCaret = offset;
    if (document.activeElement !== this) return;
    const spot = this.caretSpot(offset);
    if (spot) getSelection()?.collapse(spot[0], spot[1]);
    else getSelection()?.collapse(this, this.childNodes.length);
  }
  /**
   * The DOM spot for text offset `offset`. Where a hidden mark ends, the spot is the start of what follows
   * it (the item's words, or the zero-width space of an empty item), so typing never lands in the mark.
   */
  private caretSpot(offset: number): [Node, number] | null {
    let rest = offset;
    for (const lineEl of this.childNodes) {
      const len = lineEl.nodeName === 'BR' ? 0 : unZW(lineEl.textContent).length;
      if (rest <= len) {
        const walker = document.createTreeWalker(lineEl, NodeFilter.SHOW_TEXT);
        let last: [Node, number] = [lineEl, 0];
        for (let t = walker.nextNode() as Text | null; t; t = walker.nextNode() as Text | null) {
          const n = unZW(t.data).length;
          // at a node's end, go past any zero-width space: before it, the browser types into the mark again
          if (rest < n || (rest === n && !isHiddenMark(t))) return [t, rest === n ? t.data.length : rest];
          last = [t, t.data.length];
          rest -= n;
        }
        return last;
      }
      rest -= len + 1;
    }
    return null;
  }
  /** The line element the caret is on (or null). */
  private lineEl(): HTMLElement | null {
    const sel = getSelection();
    let n: Node | null = sel?.focusNode ?? null;
    if (!n || !this.contains(n)) return null;
    if (n === this) return (this.childNodes[Math.min(sel!.focusOffset, this.childNodes.length - 1)] as HTMLElement) ?? null;
    while (n && n.parentNode !== this) n = n.parentNode;
    return n as HTMLElement | null;
  }
  private markActive(): void {
    const el = document.activeElement === this ? this.lineEl() : null;
    for (const c of this.querySelectorAll('.md-l.active')) if (c !== el) c.classList.remove('active');
    el?.classList?.add('active');
  }
  /** How long the hidden block mark is on the line at text offset `c`. */
  private markOfLine(c: number): number {
    const i = this.value.slice(0, c).split('\n').length - 1;
    const el = this.childNodes[i] as HTMLElement | undefined;
    return Number(el?.dataset?.mark ?? 0);
  }

  override focus(options?: FocusOptions): void {
    super.focus(options);
    this.placeCaret(this.lastCaret);
  }

  // ---------- history (the browser's would break on every re-render)
  private remember(text: string, caret: number): void {
    const now = Date.now();
    const top = this.history.at(-1);
    // typing in one go is one undo step
    if (top && now - this.lastPush < 900 && top.text !== text) this.lastPush = now;
    else if (!top || top.text !== text) {
      this.history.push({ text, caret });
      if (this.history.length > 200) this.history.shift();
      this.lastPush = now;
    }
    this.future = [];
  }
  private step(back: boolean): void {
    const from = back ? this.history : this.future;
    const to = back ? this.future : this.history;
    const s = from.pop();
    if (!s) return;
    to.push({ text: this.value, caret: this.caret() });
    this.render(s.text);
    this.placeCaret(s.caret);
    this.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // ---------- editing
  private pending: { text: string; caret: number } | null = null;
  /**
   * Backspace right after a line's block mark: the mark goes first (the number, the bullet…), the indent stays;
   * the next Backspace then takes the indent away a level (two spaces, or a tab) at a time. A divider or photo
   * line goes whole. False when the caret isn't there.
   */
  private unmark(): boolean {
    const v = this.value;
    const c = this.selectionStart;
    if (c !== this.selectionEnd) return false;
    const { start, text } = this.lineAt(v, c);
    const b = blockOf(text);
    const mark = b ? b.indent.length + b.marker.length : 0;
    let next: string;
    let caret: number;
    if (b && mark && c === start + mark) {
      next = b.kind === 'hr' || b.kind === 'img' ? '' : b.indent + b.rest;
      caret = start + (b.kind === 'hr' || b.kind === 'img' ? 0 : b.indent.length);
    } else {
      // the caret at the end of a line's leading indent: out a level
      const lead = /^[ \t]*/.exec(text)![0];
      if (!lead || c !== start + lead.length) return false;
      const cut = lead.endsWith('\t') ? 1 : Math.min(2, lead.length);
      next = text.slice(0, lead.length - cut) + text.slice(lead.length);
      caret = c - cut;
    }
    this.remember(v, c);
    this.render(v.slice(0, start) + next + v.slice(start + text.length));
    this.placeCaret(caret);
    this.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }

  private onBeforeInput(e: InputEvent): void {
    // the same Backspace when it comes only as an input (a Korean IME sends its keydown as "processing", 229, which
    // the key handler leaves alone): without this the hidden mark could never be deleted
    if (e.inputType === 'deleteContentBackward' && !this.composing && !e.isComposing && this.unmark()) {
      e.preventDefault();
      return;
    }
    if (e.inputType === 'historyUndo' || e.inputType === 'historyRedo') {
      e.preventDefault();
      this.step(e.inputType === 'historyUndo');
      return;
    }
    // formatting shortcuts (Ctrl+B …) would add markup the text can't hold
    if (e.inputType.startsWith('format')) {
      e.preventDefault();
      return;
    }
    // typing on a photo's line goes on a new line after it (the photo stays whole)
    if (this.lineEl()?.classList.contains('img') && (e.inputType === 'insertText' || e.inputType === 'insertParagraph' || e.inputType === 'insertLineBreak')) {
      e.preventDefault();
      const { end } = this.lineAt(this.value, this.caret());
      this.insert(`\n${e.inputType === 'insertText' ? e.data ?? '' : ''}`, end, end);
      return;
    }
    if (!this.pending) this.pending = { text: this.value, caret: this.caret() };
    // a soft break (Shift+Enter) is a new line too: lines are the only breaks
    if (e.inputType === 'insertLineBreak' && !e.defaultPrevented) {
      e.preventDefault();
      this.insert('\n');
    }
  }
  private onInput(): void {
    // the placeholder follows what is there at once (mid-syllable too, while the redraw waits)
    this.classList.toggle('empty', !unZW(this.textContent).length);
    if (this.pending) {
      this.remember(this.pending.text, this.pending.caret);
      this.pending = null;
    }
    // mid-syllable (Korean IME): leave the DOM alone until the syllable commits
    if (this.composing) return;
    const caret = this.caret();
    const text = this.serialize();
    this.render(text);
    this.placeCaret(caret);
    this.updateMenu(text, caret);
  }
  /** Types `s` at the caret (replacing the selection), as one undo step. */
  private insert(s: string, from = this.selectionStart, to = this.selectionEnd): void {
    const v = this.value;
    this.remember(v, from);
    this.render(v.slice(0, from) + s + v.slice(to));
    this.placeCaret(from + s.length);
    this.dispatchEvent(new Event('input', { bubbles: true }));
  }
  private onPaste(e: ClipboardEvent): void {
    // plain text only; an image paste is the page's business (it may have taken it already)
    const t = e.clipboardData?.getData('text/plain') ?? '';
    e.preventDefault();
    if (t) this.insert(t.replace(/\r\n?/g, '\n'));
  }
  private lineAt(v: string, caret: number): { start: number; end: number; text: string } {
    const start = v.lastIndexOf('\n', caret - 1) + 1;
    const nl = v.indexOf('\n', caret);
    const end = nl === -1 ? v.length : nl;
    return { start, end, text: v.slice(start, end) };
  }
  private onKey(e: KeyboardEvent): void {
    if (this.menu.isOpen && this.menu.onKey(e)) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && !e.altKey && (e.key.toLowerCase() === 'z' || e.key.toLowerCase() === 'y')) {
      e.preventDefault();
      this.step(e.key.toLowerCase() === 'z' && !e.shiftKey);
      return;
    }
    if (e.isComposing || e.keyCode === 229) return;
    // Backspace at the start of the line after a photo (or Delete at the end of the line before one) takes
    // the photo's line out whole, as a block; joining the two would break the photo's line
    if ((e.key === 'Backspace' || e.key === 'Delete') && !mod && !e.altKey && this.selectionStart === this.selectionEnd) {
      const v = this.value;
      const c = this.selectionStart;
      const { start, end } = this.lineAt(v, c);
      const lines = v.split(NL);
      const i = v.slice(0, c).split(NL).length - 1;
      const j = e.key === 'Backspace' && c === start ? i - 1 : e.key === 'Delete' && c === end ? i + 1 : -1;
      if (j >= 0 && j < lines.length && IMG_LINE.test(lines[j]!)) {
        e.preventDefault();
        const [gone] = lines.splice(j, 1);
        this.remember(v, c);
        this.render(lines.join(NL));
        this.placeCaret(e.key === 'Backspace' ? c - gone!.length - 1 : c);
        this.dispatchEvent(new Event('input', { bubbles: true }));
        return;
      }
    }
    if ((e.key === 'Backspace' || e.key === 'ArrowLeft') && !mod && !e.shiftKey && !e.altKey) {
      const v = this.value;
      const c = this.selectionStart;
      if (c === this.selectionEnd) {
        const { start, text } = this.lineAt(v, c);
        const b = blockOf(text);
        const mark = b ? b.indent.length + b.marker.length : 0;
        if (b && mark && c === start + mark) {
          e.preventDefault();
          if (e.key === 'ArrowLeft') {
            this.placeCaret(start > 0 ? start - 1 : start + mark);
            return;
          }
          this.unmark();
          return;
        }
        if (e.key === 'Backspace' && this.unmark()) {
          e.preventDefault();
          return;
        }
      }
    }
    if ((e.key === 'Tab' || e.key === 'Enter') && !mod && !e.altKey && this.selectionStart === this.selectionEnd) {
      const v = this.value;
      const c = this.selectionStart;
      const { start, end, text } = this.lineAt(v, c);
      if (isRow(text) && !isSep(text)) {
        e.preventDefault();
        const pipes = pipesOf(text);
        const at = c - start;
        const cells = pipes.length - 1;
        const newRow = `|${'  |'.repeat(cells)}`;
        const addRow = () => {
          this.remember(v, c);
          this.render(`${v.slice(0, end)}
${newRow}${v.slice(end)}`);
          this.placeCaret(end + 3);
          this.dispatchEvent(new Event('input', { bubbles: true }));
        };
        if (e.key === 'Enter') return addRow();
        if (e.shiftKey) {
          // the cell before this one (or the last cell of the row above)
          const before = pipes.filter((p) => p < at);
          if (before.length >= 2) this.placeCaret(start + before[before.length - 2]! + 2);
          else if (start > 0) {
            const up = this.lineAt(v, start - 1);
            const upPipes = pipesOf(up.text);
            this.placeCaret(isRow(up.text) && !isSep(up.text) && upPipes.length > 1 ? up.start + upPipes[upPipes.length - 2]! + 2 : start - 1);
          }
          return;
        }
        // the next cell, the next row's first cell, or a new row
        const nextPipe = pipes.find((p) => p >= at);
        const after = pipes.filter((p) => p >= at);
        if (nextPipe !== undefined && after.length >= 2) return this.placeCaret(start + nextPipe + 2);
        let n = end + 1;
        let below = n <= v.length ? this.lineAt(v, n) : null;
        if (below && isSep(below.text)) {
          n = below.end + 1;
          below = n <= v.length ? this.lineAt(v, n) : null;
        }
        if (below && isRow(below.text) && n <= v.length) return this.placeCaret(below.start + (pipesOf(below.text)[0] ?? 0) + 2);
        return addRow();
      }
    }
    if (e.key === 'Tab') {
      // indent / outdent every line the selection touches
      e.preventDefault();
      const v = this.value;
      const a = this.selectionStart;
      const b = this.selectionEnd;
      const first = v.lastIndexOf('\n', a - 1) + 1;
      const lines = v.slice(first, this.lineAt(v, b).end).split('\n');
      let shift = 0;
      const out = lines.map((l, i) => {
        if (!e.shiftKey) {
          if (i === 0) shift = 2;
          return `  ${l}`;
        }
        const cut = /^ {1,2}|^\t/.exec(l)?.[0].length ?? 0;
        if (i === 0) shift = -cut;
        return l.slice(cut);
      });
      this.remember(v, a);
      const end = first + lines.join('\n').length;
      this.render(v.slice(0, first) + out.join('\n') + v.slice(end));
      this.placeCaret(Math.max(first, a + shift));
      this.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && !mod) {
      // a list carries on; an empty item ends it
      const v = this.value;
      const c = this.selectionStart;
      if (c !== this.selectionEnd) return;
      const { start, text } = this.lineAt(v, c);
      const m = /^(\s*)([-*] \[[ xX]\] |[-*+] |(\d+)\. |> ?\[!\w+\] ?|> |\| (?!.*\|\s*$))/.exec(text);
      if (!m) return;
      e.preventDefault();
      if (text.trim() === m[0].trim()) {
        // empty item: a nested one steps out a level, a top-level one drops its marker
        const indent = m[1]!;
        const next = indent ? indent.slice(0, Math.max(0, indent.length - 2)) + m[2] : '';
        this.remember(v, c);
        this.render(v.slice(0, start) + next + v.slice(start + text.length));
        this.placeCaret(start + next.length);
        this.dispatchEvent(new Event('input', { bubbles: true }));
        return;
      }
      const next = m[3] ? `${Number(m[3]) + 1}. ` : m[2]!.replace(/\[[xX]\]/, '[ ]');
      this.insert(`\n${m[1]}${next}`);
    }
  }
  /** Dragging a photo's corner: it follows the pointer live, and the width goes into its line on release. */
  private onGrip(e: PointerEvent): void {
    const grip = (e.target as Element).closest<HTMLElement>('.md-img-grip');
    if (!grip || e.button !== 0) return;
    e.preventDefault();
    const box = grip.closest<HTMLElement>('.md-img')!;
    const img = box.querySelector('img')!;
    const x0 = e.clientX;
    const w0 = img.getBoundingClientRect().width;
    const max = this.clientWidth;
    let w = w0;
    box.classList.add('resizing', 'sized');
    try {
      grip.setPointerCapture(e.pointerId);
    } catch { /* a pointer that can't be captured still drags while over the corner */ }
    const move = (ev: PointerEvent) => {
      w = Math.max(80, Math.min(max, w0 + ev.clientX - x0));
      img.style.width = `${w}px`;
    };
    const up = () => {
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', up);
      grip.removeEventListener('pointercancel', up);
      box.classList.remove('resizing');
      // a click on the corner leaves the size alone
      if (Math.abs(w - w0) >= 2) this.resizePhoto(box, w >= max - 1 ? max : w);
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
    grip.addEventListener('pointercancel', up);
  }
  /** Writes a photo's width into its line (null: back to its own size), as one undo step. */
  private resizePhoto(box: HTMLElement, width: number | null): void {
    const i = [...this.childNodes].indexOf(box.parentElement!);
    if (i < 0) return;
    const v = this.value;
    const lines = v.split(NL);
    const next = imageLine(box.dataset.ref!, width);
    if (lines[i] === next) return;
    lines[i] = next;
    this.remember(v, this.caret());
    this.render(lines.join(NL));
    this.dispatchEvent(new Event('input', { bubbles: true }));
  }
  private onClick(e: MouseEvent): void {
    const t = e.target as HTMLElement;
    if (t.closest('.md-img-grip')) return;
    // a photo: opens large; its buttons copy it or take it out of the text
    const photo = t.closest<HTMLElement>('.md-img');
    if (photo) {
      const action = t.closest<HTMLElement>('.md-img-btn')?.dataset.act ?? 'open';
      if (action === 'remove') {
        const i = [...this.childNodes].indexOf(photo.parentElement!);
        if (i < 0) return;
        const v = this.value;
        const lines = v.split('\n');
        lines.splice(i, 1);
        this.remember(v, this.caret());
        this.render(lines.join('\n'));
        this.dispatchEvent(new Event('input', { bubbles: true }));
      }
      this.dispatchEvent(new CustomEvent('md-image', { bubbles: true, detail: { id: photo.dataset.ref, action } }));
      return;
    }
    // a box ticks
    const box = t.closest('.mk-task');
    if (box) {
      const lineEl = box.parentElement!;
      const i = [...this.childNodes].indexOf(lineEl);
      if (i < 0) return;
      const v = this.value.split('\n');
      v[i] = v[i]!.replace(/\[([ xX])\]/, (_, c: string) => (c === ' ' ? '[x]' : '[ ]'));
      this.remember(this.value, this.caret());
      this.render(v.join('\n'));
      this.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    // Ctrl/⌘-click opens a link
    const link = t.closest<HTMLElement>('.md-link');
    if (link && (e.ctrlKey || e.metaKey)) window.open(link.dataset.href, '_blank', 'noopener');
  }

  // ---------- the / menu (blocks) and the @ menu (people)
  private updateMenu(text: string, caret: number): void {
    const { start, text: ln } = this.lineAt(text, caret);
    const before = ln.slice(0, caret - start);
    const at = this.people ? /(^|\s)@([^\s@\[\]()]{0,20})$/.exec(before) : null;
    if (at) {
      const q = at[2]!.toLowerCase();
      const items: MenuItem[] = this.people!().filter((p) => !q || p.name.toLowerCase().includes(q))
        .slice(0, 8).map((p) => ({ label: p.name, hint: '@', face: p, run: () => this.applyMention(p) }));
      if (!items.length) return this.closeMenu();
      this.menuAt = caret - at[2]!.length - 1;
      return this.menu.show(items);
    }
    const m = /(^|\s)\/([^\s/]{0,20})$/.exec(before);
    if (!m) return this.closeMenu();
    const q = m[2]!.toLowerCase();
    const commands: MenuItem[] = (this.commands?.() ?? [])
      .filter((c) => !q || c.label.toLowerCase().includes(q) || (c.text ?? '').toLowerCase().includes(q) || (c.keys ?? []).some((k) => k.includes(q)))
      .map((c) => ({ label: c.label, hint: c.hint, example: c.example, icon: c.icon, run: () => this.applyCommand(c) }));
    const blocks = this.slashBlocks ? BLOCKS : [];
    const items: MenuItem[] = [...commands, ...blocks.filter((b) => !q || b.label.toLowerCase().includes(q) || b.keys.includes(q))
      .map((b) => ({ label: b.label, hint: b.hint, icon: b.icon, run: () => this.applyBlock(b) }))];
    if (!items.length) return this.closeMenu();
    this.menuAt = caret - m[2]!.length - 1;
    this.menu.show(items);
  }
  private closeMenu(): void {
    this.menu.close();
  }
  /** Puts a mention of `p` where "@query" was typed (a space after it, to type on). */
  private applyMention(p: { uid: string; name: string }): void {
    const v = this.value;
    const caret = this.caret();
    this.closeMenu();
    const ins = `@[${p.name.replace(/[\[\]()]/g, '')}](user:${p.uid}) `;
    this.remember(v, caret);
    this.render(v.slice(0, this.menuAt) + ins + v.slice(caret));
    this.placeCaret(this.menuAt + ins.length);
    this.dispatchEvent(new Event('input', { bubbles: true }));
  }
  /** Puts a command's text where its "/query" was typed, or clears that and runs it. */
  private applyCommand(c: EditorCommand): void {
    const v = this.value;
    const caret = this.caret();
    const at = this.menuAt;
    this.closeMenu();
    const text = c.text ?? '';
    this.remember(v, caret);
    this.render(v.slice(0, at) + text + v.slice(caret));
    this.placeCaret(at + text.length);
    this.dispatchEvent(new Event('input', { bubbles: true }));
    c.run?.();
  }
  /** Turns the line into the block (the "/query" typed for it goes). */
  private applyBlock(b: (typeof BLOCKS)[number]): void {
    const v = this.value;
    const caret = this.caret();
    this.closeMenu();
    const without = v.slice(0, this.menuAt) + v.slice(caret);
    const { start, end, text } = this.lineAt(without, this.menuAt);
    this.remember(v, caret);
    if (b.prefix) {
      const m = MARKER.exec(text)!;
      const rest = text.slice(m[0].length);
      const lineText = m[1] + b.prefix + rest.replace(/\s+$/, '');
      this.render(without.slice(0, start) + lineText + without.slice(end));
      this.placeCaret(start + lineText.length);
    } else {
      const ins = b.insert!();
      const at = this.menuAt;
      this.render(without.slice(0, at) + ins + without.slice(at));
      // a code block: the caret goes inside it; a table: into its first header cell
      this.placeCaret(b.id === 'code' ? at + 4 : b.id === 'table' ? at + 2 : at + ins.length);
    }
    this.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

if (!customElements.get('md-editor')) customElements.define('md-editor', MdEditor);

declare global {
  interface HTMLElementTagNameMap {
    'md-editor': MdEditor;
  }
}
