import { icon, type IconName } from './icons';

/** The blocks the / menu offers: each rewrites the line (or inserts text). */
export const BLOCKS: { id: string; label: string; hint: string; icon: IconName; keys: string; prefix?: string; insert?: () => string }[] = [
  { id: 'h1', label: 'Heading 1', hint: '#', icon: 'chevron-right', keys: 'h1 heading title 제목', prefix: '# ' },
  { id: 'h2', label: 'Heading 2', hint: '##', icon: 'chevron-right', keys: 'h2 heading subtitle 제목', prefix: '## ' },
  { id: 'h3', label: 'Heading 3', hint: '###', icon: 'chevron-right', keys: 'h3 heading 제목', prefix: '### ' },
  { id: 'ul', label: 'Bulleted list', hint: '-', icon: 'circle-dot', keys: 'bullet list ul 목록', prefix: '- ' },
  { id: 'ol', label: 'Numbered list', hint: '1.', icon: 'circle-dot', keys: 'numbered list ol 번호', prefix: '1. ' },
  { id: 'todo', label: 'To-do', hint: '[ ]', icon: 'circle-check', keys: 'todo task check 할일 체크', prefix: '- [ ] ' },
  { id: 'quote', label: 'Quote', hint: '|', icon: 'quote', keys: 'quote 인용 |', prefix: '| ' },
  { id: 'callout', label: 'Callout', hint: '[!]', icon: 'lightbulb', keys: 'callout note tip 콜아웃 강조 메모', prefix: '> [!note] ' },
  { id: 'code', label: 'Code block', hint: '```', icon: 'chevron-right', keys: 'code 코드', insert: () => '```\n\n```' },
  { id: 'table', label: 'Table', hint: '|  |', icon: 'chart-column', keys: 'table grid 표 테이블', insert: () => '| Column 1 | Column 2 | Column 3 |\n| --- | --- | --- |\n|  |  |  |\n|  |  |  |\n' },
  { id: 'hr', label: 'Divider', hint: '---', icon: 'chevron-right', keys: 'divider line hr 구분선', insert: () => '---\n' },
  { id: 'date', label: 'Today’s date', hint: 'date', icon: 'calendar', keys: 'date today 날짜 오늘', insert: () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  } },
];
/** A row of the / or @ menu: a block to turn the line into, or a person to name. */
/** A command for the / menu: it puts `text` where "/query" was typed, or (with `run`) clears it and does something. */
export interface EditorCommand {
  label: string;
  /** Short, at the right: what it does. */
  hint: string;
  /** A second line: an example of its use. */
  example?: string;
  icon?: IconName;
  /** Other words that find it (English names, for one). */
  keys?: string[];
  text?: string;
  run?: () => void;
}
export interface MenuItem {
  label: string;
  hint: string;
  /** A second line: how it is used. */
  example?: string;
  icon?: IconName;
  face?: { name: string; photo: string | null };
  run: () => void;
}
/** A person's round face for the @ menu: their photo, or their initial. */
function faceOf(p: { name: string; photo: string | null }): HTMLElement {
  const el = document.createElement('span');
  el.className = 'slash-face';
  if (p.photo) {
    const img = document.createElement('img');
    img.src = p.photo;
    img.alt = '';
    img.referrerPolicy = 'no-referrer';
    el.append(img);
  } else el.textContent = (p.name.trim()[0] ?? '?').toUpperCase();
  return el;
}
/** List markers a line can carry (stripped when a / block replaces them). */
export const MARKER = /^(\s*)(#{1,6} |[-*] \[[ xX]\] |[-*+] |\d+\. |> ?\[!\w+\] ?|> |\| (?!.*\|\s*$))?/;

/** The / or @ menu's box, under the caret of `anchor` (the editor): arrows move the pick, Enter or Tab runs it, Esc closes it. */
export class SlashMenu {
  private menu: HTMLElement | null = null;
  private menuItems: MenuItem[] = [];
  private menuPick = 0;

  constructor(private readonly anchor: HTMLElement) {}

  get isOpen(): boolean {
    return !!this.menu;
  }
  /** Shows these rows (the pick stays where it was, when it still fits). */
  show(items: MenuItem[]): void {
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
      const face = b.face ? faceOf(b.face) : icon(b.icon ?? 'chevron-right');
      it.querySelector('.slash-ic')!.append(face);
      it.querySelector('.slash-label')!.textContent = b.label;
      if (b.example) {
        it.classList.add('has-example');
        it.append(Object.assign(document.createElement('span'), { className: 'slash-example', textContent: b.example }));
      }
      it.querySelector('.slash-hint')!.textContent = b.hint;
      it.addEventListener('click', () => b.run());
      it.addEventListener('mousemove', () => {
        if (this.menuPick === i) return;
        this.menuPick = i;
        this.drawMenu();
      });
      return it;
    }));
    // under the caret
    const r = getSelection()?.rangeCount ? getSelection()!.getRangeAt(0).getBoundingClientRect() : this.anchor.getBoundingClientRect();
    const h = this.menu.offsetHeight;
    const top = r.bottom + 6 + h > innerHeight - 8 ? r.top - h - 6 : r.bottom + 6;
    this.menu.style.left = `${Math.max(8, Math.min(r.left, innerWidth - this.menu.offsetWidth - 8))}px`;
    this.menu.style.top = `${Math.max(8, top)}px`;
    this.menu.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }
  close(): void {
    this.menu?.remove();
    this.menu = null;
    this.menuPick = 0;
  }
  /** True when the key was the menu's. */
  onKey(e: KeyboardEvent): boolean {
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
      this.menuItems[this.menuPick]!.run();
      return true;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopImmediatePropagation();
      this.close();
      return true;
    }
    return false;
  }
}
