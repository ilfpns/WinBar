import { type MdEditor } from './md-editor';

/**
 * A memo pad: the <md-editor> (Markdown that formats itself as you type) in a box that can hold extras
 * beside it (the calendar's PDF button). `refresh()` is kept for callers that set the text from code —
 * the editor redraws itself, so it has nothing left to do.
 */
export interface MdPad {
  el: HTMLElement;
  refresh(): void;
}

export function mdPad(editor: MdEditor, cls = ''): MdPad {
  const el = document.createElement('div');
  el.className = `md-pad${cls ? ` ${cls}` : ''}`;
  editor.replaceWith(el);
  el.append(editor);
  return { el, refresh: () => {} };
}
