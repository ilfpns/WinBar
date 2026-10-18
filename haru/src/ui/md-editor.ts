import { icon, type IconName } from './icons';

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
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/**
 * An empty item's only text is its hidden mark (font-size 0), so the caret would sit at the mark's end and
 * what is typed would land inside it — out of sight while a Korean syllable is composed. A zero-width space
 * after the mark gives the caret a visible place to type into; it is never part of the text.
 */
const ZW = '​';
const unZW = (s: string | null) => (s ?? '').replaceAll(ZW, '');
/** Marks drawn as a dot, box or bar (their text hidden): the caret never types into them. */
const isHiddenMark = (t: Text) => !!t.parentElement?.closest('.mk-ind, .mk-h, .mk-li, .mk-task, .mk-q');
const mk = (s: string) => `<span class="mk mk-in">${esc(s)}</span>`;
const SAFE_URL = /^(https?:\/\/|mailto:)/i;

/** Inline marks, keeping every character (the marks show only on the line being edited). */
function inline(src: string): string {
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(~~[^~]+~~)|(\*[^*\s][^*]*\*)|(\[[^\]]+\]\([^)\s]+\))/g;
  let out = '';
  let at = 0;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    out += esc(src.slice(at, m.index));
    const t = m[0];
    if (m[1]) out += `<code>${mk('`')}${esc(t.slice(1, -1))}${mk('`')}</code>`;
    else if (m[2]) out += `<strong>${mk('**')}${esc(t.slice(2, -2))}${mk('**')}</strong>`;
    else if (m[3]) out += `<del>${mk('~~')}${esc(t.slice(2, -2))}${mk('~~')}</del>`;
    else if (m[4]) out += `<em>${mk('*')}${esc(t.slice(1, -1))}${mk('*')}</em>`;
    else {
      const [, label, url] = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(t)!;
      out += SAFE_URL.test(url!)
        ? `<span class="md-link" data-href="${esc(url!).replace(/"/g, '&quot;')}">${mk('[')}${esc(label!)}${mk(`](${url})`)}</span>`
        : esc(t);
    }
    at = m.index + t.length;
  }
  return out + esc(src.slice(at));
}

/** A drawn line: its classes and HTML, how many leading characters are its block mark (hidden: the
 *  caret never stops inside them) and its indent level. */
interface Drawn { cls: string; html: string; mark: number; indent: number }

/** The block mark a line starts with (indent included): heading, to-do, bullet, number, quote or a divider. */
function blockOf(src: string): { kind: string; indent: string; marker: string; rest: string; done?: boolean } | null {
  if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(src)) return { kind: 'hr', indent: '', marker: src, rest: '' };
  let m = /^(#{1,6} )(.*)$/.exec(src);
  if (m) return { kind: `h${Math.min(3, m[1]!.length - 1)}`, indent: '', marker: m[1]!, rest: m[2]! };
  m = /^(\s*)([-*] \[([ xX])\] )(.*)$/.exec(src);
  if (m) return { kind: 'task', indent: m[1]!, marker: m[2]!, rest: m[4]!, done: m[3] !== ' ' };
  m = /^(\s*)([-*+] )(.*)$/.exec(src);
  if (m) return { kind: 'li', indent: m[1]!, marker: m[2]!, rest: m[3]! };
  m = /^(\s*)(\d+\. )(.*)$/.exec(src);
  if (m) return { kind: 'ol', indent: m[1]!, marker: m[2]!, rest: m[3]! };
  m = /^(\s*)(> ?)(.*)$/.exec(src);
  if (m) return { kind: 'quote', indent: m[1]!, marker: m[2]!, rest: m[3]! };
  return null;
}

/** A table row: | a | b | (a separator row is | --- | --- |). */
const isRow = (s: string) => /^\s*\|.*\|\s*$/.test(s);
const isSep = (s: string) => /^\s*\|(\s*:?-{3,}:?\s*\|)+\s*$/.test(s);
/** Where the cells of a row start and end (offsets of its pipes). */
const pipesOf = (s: string) => [...s].flatMap((ch, i) => (ch === '|' ? [i] : []));

/** A table row: the pipes take no room, the cells line up as columns. */
function row(src: string, header: boolean): Drawn {
  if (isSep(src)) return { cls: 'md-l tr tsep', html: `<span class="mk mk-sep">${esc(src)}</span>`, mark: src.length, indent: 0 };
  const pipes = pipesOf(src);
  let html = src.slice(0, pipes[0]) ? `<span class="mk mk-ind">${esc(src.slice(0, pipes[0]))}</span>` : '';
  pipes.forEach((at, k) => {
    html += '<span class="mk mk-pipe">|</span>';
    const next = pipes[k + 1];
    if (next !== undefined) html += `<span class="td">${inline(src.slice(at + 1, next)) || ''}</span>`;
  });
  const tail = src.slice(pipes.at(-1)! + 1);
  if (tail) html += `<span class="mk mk-ind">${esc(tail)}</span>`;
  return { cls: `md-l tr${header ? ' th' : ''}`, html, mark: 0, indent: 0 };
}

/** One line drawn; `fence` says whether it sits inside a ``` block, `next` is the line after it. */
function line(src: string, fence: boolean, next?: string): Drawn {
  if (/^\s*```/.test(src)) return { cls: 'md-l fence', html: `<span class="mk">${esc(src)}</span>`, mark: 0, indent: 0 };
  if (fence) return { cls: 'md-l code', html: esc(src) || '<br>', mark: 0, indent: 0 };
  if (!src) return { cls: 'md-l', html: '<br>', mark: 0, indent: 0 };
  if (isRow(src)) return row(src, next !== undefined && isSep(next) && !isSep(src));
  const b = blockOf(src);
  if (!b) return { cls: 'md-l', html: inline(src), mark: 0, indent: 0 };
  const indent = Math.floor(b.indent.replace(/\t/g, '  ').length / 2);
  const ind = b.indent ? `<span class="mk mk-ind">${esc(b.indent)}</span>` : '';
  if (b.kind === 'hr') return { cls: 'md-l hr', html: `<span class="mk mk-hr">${esc(src)}</span>`, mark: src.length, indent: 0 };
  // a numbered item keeps its number visible; the other marks are drawn (a dot, a box, a bar) instead
  const markCls = b.kind === 'ol' ? 'mk mk-ol' : b.kind === 'task' ? 'mk mk-task' : b.kind === 'li' ? 'mk mk-li' : b.kind === 'quote' ? 'mk mk-q' : 'mk mk-h';
  return {
    cls: `md-l ${b.kind}${b.done ? ' done' : ''}`,
    html: `${ind}<span class="${markCls}">${esc(b.marker)}</span>${inline(b.rest) || ''}`,
    mark: b.indent.length + b.marker.length,
    indent,
  };
}

/** The blocks the / menu offers: each rewrites the line (or inserts text). */
const BLOCKS: { id: string; label: string; hint: string; icon: IconName; keys: string; prefix?: string; insert?: () => string }[] = [
  { id: 'h1', label: 'Heading 1', hint: '#', icon: 'chevron-right', keys: 'h1 heading title 제목', prefix: '# ' },
  { id: 'h2', label: 'Heading 2', hint: '##', icon: 'chevron-right', keys: 'h2 heading subtitle 제목', prefix: '## ' },
  { id: 'h3', label: 'Heading 3', hint: '###', icon: 'chevron-right', keys: 'h3 heading 제목', prefix: '### ' },
  { id: 'ul', label: 'Bulleted list', hint: '-', icon: 'circle-dot', keys: 'bullet list ul 목록', prefix: '- ' },
  { id: 'ol', label: 'Numbered list', hint: '1.', icon: 'circle-dot', keys: 'numbered list ol 번호', prefix: '1. ' },
  { id: 'todo', label: 'To-do', hint: '[ ]', icon: 'circle-check', keys: 'todo task check 할일 체크', prefix: '- [ ] ' },
  { id: 'quote', label: 'Quote', hint: '>', icon: 'chevron-right', keys: 'quote 인용', prefix: '> ' },
  { id: 'code', label: 'Code block', hint: '```', icon: 'chevron-right', keys: 'code 코드', insert: () => '```\n\n```' },
  { id: 'table', label: 'Table', hint: '|  |', icon: 'chart-column', keys: 'table grid 표 테이블', insert: () => '| Column 1 | Column 2 | Column 3 |\n| --- | --- | --- |\n|  |  |  |\n|  |  |  |\n' },
  { id: 'hr', label: 'Divider', hint: '---', icon: 'chevron-right', keys: 'divider line hr 구분선', insert: () => '---\n' },
  { id: 'date', label: 'Today’s date', hint: 'date', icon: 'calendar', keys: 'date today 날짜 오늘', insert: () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  } },
];
/** List markers a line can carry (stripped when a / block replaces them). */
const MARKER = /^(\s*)(#{1,6} |[-*] \[[ xX]\] |[-*+] |\d+\. |> )?/;

export class MdEditor extends HTMLElement {
  private composing = false;
  private placeholderText = '';
  private history: { text: string; caret: number }[] = [];
  private future: { text: string; caret: number }[] = [];
  private lastPush = 0;
  private lastCaret = 0;
  private menu: HTMLElement | null = null;
  private menuItems: typeof BLOCKS = [];
  private menuAt = 0;
  private menuPick = 0;

  constructor() {
    super();
    this.addEventListener('input', () => this.onInput());
    this.addEventListener('compositionstart', () => (this.composing = true));
    this.addEventListener('compositionend', () => {
      this.composing = false;
      this.onInput();
    });
    this.addEventListener('keydown', (e) => this.onKey(e));
    this.addEventListener('beforeinput', (e) => this.onBeforeInput(e));
    this.addEventListener('paste', (e) => this.onPaste(e));
    this.addEventListener('click', (e) => this.onClick(e));
    this.addEventListener('blur', () => this.closeMenu());
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
        if (f instanceof Text && sel.focusOffset === f.data.length && isHiddenMark(f) && !this.lineEl()?.classList.contains('hr')) {
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
    if (this.isContentEditable) return;
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
      div.innerHTML = w.html + (w.mark && w.mark === w.src.length && !w.cls.includes('hr') ? ZW : '');
      if (cur) cur.replaceWith(div);
      else this.append(div);
    });
    for (const extra of kids.slice(want.length)) extra.remove();
    this.classList.toggle('empty', !text);
    this.markActive();
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
  private onBeforeInput(e: InputEvent): void {
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
    if (!this.pending) this.pending = { text: this.value, caret: this.caret() };
    // a soft break (Shift+Enter) is a new line too: lines are the only breaks
    if (e.inputType === 'insertLineBreak' && !e.defaultPrevented) {
      e.preventDefault();
      this.insert('\n');
    }
  }
  private onInput(): void {
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
    if (this.menu && this.onMenuKey(e)) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && !e.altKey && (e.key.toLowerCase() === 'z' || e.key.toLowerCase() === 'y')) {
      e.preventDefault();
      this.step(e.key.toLowerCase() === 'z' && !e.shiftKey);
      return;
    }
    if (e.isComposing || e.keyCode === 229) return;
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
          // nested: step out a level; otherwise the mark goes and the words stay
          const next = b.indent.length >= 2 && b.kind !== 'hr'
            ? b.indent.slice(2) + b.marker + b.rest
            : b.kind === 'hr' ? '' : b.rest;
          this.remember(v, c);
          this.render(v.slice(0, start) + next + v.slice(start + text.length));
          this.placeCaret(start + (b.indent.length >= 2 && b.kind !== 'hr' ? mark - 2 : 0));
          this.dispatchEvent(new Event('input', { bubbles: true }));
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
      const m = /^(\s*)([-*] \[[ xX]\] |[-*+] |(\d+)\. |> )/.exec(text);
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
  private onClick(e: MouseEvent): void {
    const t = e.target as HTMLElement;
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

  // ---------- the / menu
  private updateMenu(text: string, caret: number): void {
    const { start, text: ln } = this.lineAt(text, caret);
    const before = ln.slice(0, caret - start);
    const m = /(^|\s)\/([^\s/]{0,20})$/.exec(before);
    if (!m) return this.closeMenu();
    const q = m[2]!.toLowerCase();
    const items = BLOCKS.filter((b) => !q || b.label.toLowerCase().includes(q) || b.keys.includes(q));
    if (!items.length) return this.closeMenu();
    this.menuAt = caret - m[2]!.length - 1;
    this.menuItems = items;
    this.menuPick = Math.min(this.menuPick, items.length - 1);
    this.drawMenu();
  }
  private drawMenu(): void {
    if (!this.menu) {
      this.menu = document.createElement('div');
      this.menu.className = 'slash-menu';
      this.menu.setAttribute('role', 'listbox');
      // clicks must not take the focus (and the caret) away from the note
      this.menu.addEventListener('mousedown', (e) => e.preventDefault());
      document.body.append(this.menu);
    }
    this.menu.replaceChildren(...this.menuItems.map((b, i) => {
      const it = document.createElement('button');
      it.type = 'button';
      it.setAttribute('role', 'option');
      it.setAttribute('aria-selected', String(i === this.menuPick));
      it.innerHTML = '<span class="slash-ic"></span><span class="slash-label"></span><span class="slash-hint"></span>';
      it.querySelector('.slash-ic')!.append(icon(b.icon));
      it.querySelector('.slash-label')!.textContent = b.label;
      it.querySelector('.slash-hint')!.textContent = b.hint;
      it.addEventListener('click', () => this.applyBlock(b));
      it.addEventListener('mousemove', () => {
        if (this.menuPick === i) return;
        this.menuPick = i;
        this.drawMenu();
      });
      return it;
    }));
    // under the caret
    const r = getSelection()?.rangeCount ? getSelection()!.getRangeAt(0).getBoundingClientRect() : this.getBoundingClientRect();
    const h = this.menu.offsetHeight;
    const top = r.bottom + 6 + h > innerHeight - 8 ? r.top - h - 6 : r.bottom + 6;
    this.menu.style.left = `${Math.max(8, Math.min(r.left, innerWidth - this.menu.offsetWidth - 8))}px`;
    this.menu.style.top = `${Math.max(8, top)}px`;
    this.menu.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }
  private closeMenu(): void {
    this.menu?.remove();
    this.menu = null;
    this.menuPick = 0;
  }
  private onMenuKey(e: KeyboardEvent): boolean {
    if (e.isComposing) return false;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = this.menuItems.length;
      this.menuPick = (this.menuPick + (e.key === 'ArrowDown' ? 1 : n - 1)) % n;
      this.drawMenu();
      return true;
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      e.stopImmediatePropagation();
      this.applyBlock(this.menuItems[this.menuPick]!);
      return true;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopImmediatePropagation();
      this.closeMenu();
      return true;
    }
    return false;
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
