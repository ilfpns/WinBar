const NS = 'http://www.w3.org/2000/svg';

type Attrs = Record<string, string | number>;

export function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Attrs = {}, text?: string): SVGElementTagNameMap[K] {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Text centred on a point — the dial uses this for every label. */
export const centeredText = (cls: string, x: number, y: number, text: string, style = ''): SVGTextElement =>
  svgEl('text', { class: cls, x, y, 'text-anchor': 'middle', 'dominant-baseline': 'central', ...(style ? { style } : {}) }, text);
