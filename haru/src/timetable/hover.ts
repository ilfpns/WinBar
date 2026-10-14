/**
 * Which task the pointer is over, on the dial or in the list.
 * Kept out of the app state on purpose: hover changes are frequent and only the
 * dial's centre emblem reacts, so they must not re-render the list underneath the pointer.
 */
type Listener = (id: string | null) => void;
const listeners = new Set<Listener>();
let current: string | null = null;

export function setHover(id: string | null): void {
  if (id === current) return;
  current = id;
  listeners.forEach((fn) => fn(id));
}

export function onHover(fn: Listener): void {
  listeners.add(fn);
}
