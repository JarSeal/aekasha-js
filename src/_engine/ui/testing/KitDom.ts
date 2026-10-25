// The UI kit's tests' DOM (p803 D11): linkedom with the browser behaviour the kit relies on and
// linkedom doesn't have. Only tests import it (it imports vitest).
import { vi } from 'vitest';

type ListenerEntry = { fn: EventListenerOrEventListenerObject; capture: boolean; once: boolean };
/** linkedom's internal event fields this file reads */
type KitEvent = Event & { _stopImmediatePropagationFlag?: boolean };
type KitTarget = EventTarget & { _getParent?: () => KitTarget | null };

const CAPTURING_PHASE = 1;
const AT_TARGET = 2;
const BUBBLING_PHASE = 3;

/** Every listener, by target and type: the patched EventTarget's store */
const listeners = new WeakMap<object, Map<string, ListenerEntry[]>>();

const isCaptureOption = (options?: boolean | AddEventListenerOptions | EventListenerOptions) =>
  typeof options === 'boolean' ? options : Boolean(options?.capture);

/** The target and its ancestors: an element's parent is its parentNode, the document's the
 * window's event target */
const getEventPath = (target: KitTarget) => {
  const path: KitTarget[] = [];
  for (let node: KitTarget | null = target; node; node = node._getParent?.() ?? null) {
    path.push(node);
  }
  return path;
};

/**
 * linkedom calls every listener from the target up, capture or not, and a capture listener's
 * `stopPropagation()` doesn't keep the event from the target. The kit's listeners rely on the
 * order (CMP's are all capture listeners, the overlay stack's Escape is one on the HUD root), so
 * this is the DOM's: capture from the window down, the target, then bubble up.
 */
const patchEventTarget = (proto: EventTarget) => {
  Object.assign(proto, {
    addEventListener(
      this: object,
      type: string,
      fn: EventListenerOrEventListenerObject | null,
      options?: boolean | AddEventListenerOptions
    ) {
      if (!fn) return;
      let byType = listeners.get(this);
      if (!byType) listeners.set(this, (byType = new Map()));
      let list = byType.get(type);
      if (!list) byType.set(type, (list = []));
      const capture = isCaptureOption(options);
      if (list.some((l) => l.fn === fn && l.capture === capture)) return;
      list.push({ fn, capture, once: typeof options === 'object' && Boolean(options.once) });
    },
    removeEventListener(
      this: object,
      type: string,
      fn: EventListenerOrEventListenerObject | null,
      options?: boolean | EventListenerOptions
    ) {
      const list = listeners.get(this)?.get(type);
      const capture = isCaptureOption(options);
      const index = list?.findIndex((l) => l.fn === fn && l.capture === capture) ?? -1;
      if (index !== -1) list!.splice(index, 1);
    },
    dispatchEvent(this: KitTarget, event: KitEvent) {
      const path = getEventPath(this);
      const e = event as unknown as Record<string, unknown>;
      e.target = path[0];
      const invoke = (node: KitTarget, phase: number, capture: boolean | null) => {
        const list = listeners.get(node)?.get(event.type);
        if (!list) return;
        e.currentTarget = node;
        e.eventPhase = phase;
        for (const l of [...list]) {
          if (capture !== null && l.capture !== capture) continue;
          if (l.once) list.splice(list.indexOf(l), 1);
          if (typeof l.fn === 'function') l.fn.call(node, event);
          else l.fn.handleEvent(event);
          if (event._stopImmediatePropagationFlag) return;
        }
      };
      for (let i = path.length - 1; i > 0 && !event.cancelBubble; i--) {
        invoke(path[i], CAPTURING_PHASE, true);
      }
      if (!event.cancelBubble) invoke(path[0], AT_TARGET, true);
      if (!event.cancelBubble) invoke(path[0], AT_TARGET, false);
      for (let i = 1; event.bubbles && i < path.length && !event.cancelBubble; i++) {
        invoke(path[i], BUBBLING_PHASE, false);
      }
      e.currentTarget = null;
      e.eventPhase = 0;
      return !event.defaultPrevented;
    },
  });
};

/** Whether a browser would focus the element: a control that isn't disabled, a link, or any
 * element with a `tabindex` (`-1` too: focusable from code) */
const isFocusable = (elem: Element) =>
  elem.hasAttribute('tabindex') ||
  (/^(BUTTON|INPUT|SELECT|TEXTAREA)$/.test(elem.tagName) && !elem.hasAttribute('disabled')) ||
  (elem.tagName === 'A' && elem.hasAttribute('href'));

/**
 * Focus as a browser has it (linkedom's `activeElement` is always undefined, its `focus()` fires
 * no `focusin`, and `inert` blocks nothing): `document.activeElement` follows `focus()` and
 * `blur()`, the body when nothing (or a removed element) has it; blur, focusout, focus and focusin
 * fire with their `relatedTarget`; an element in an `[inert]` subtree, or one a browser can't
 * focus, refuses it.
 */
const shimFocus = (document: Document, window: Window & typeof globalThis) => {
  let active: HTMLElement | null = null;
  Object.defineProperty(document, 'activeElement', {
    configurable: true,
    get: () => (active?.isConnected ? active : document.body),
  });
  const fire = (target: Element, type: string, relatedTarget: Element | null) => {
    const bubbles = type === 'focusin' || type === 'focusout';
    target.dispatchEvent(Object.assign(new window.Event(type, { bubbles }), { relatedTarget }));
  };
  const focus = (elem: HTMLElement) => {
    if (active === elem || !elem.isConnected || !isFocusable(elem)) return;
    if (elem.closest('[inert]')) return;
    const previous = active?.isConnected ? active : null;
    active = null;
    if (previous) {
      fire(previous, 'blur', elem);
      fire(previous, 'focusout', elem);
    }
    active = elem;
    fire(elem, 'focus', previous);
    fire(elem, 'focusin', previous);
  };
  const blur = (elem: HTMLElement) => {
    if (active !== elem) return;
    active = null;
    fire(elem, 'blur', null);
    fire(elem, 'focusout', null);
  };
  Object.assign(window.HTMLElement.prototype, {
    focus(this: HTMLElement) {
      focus(this);
    },
    blur(this: HTMLElement) {
      blur(this);
    },
    // Rendered when it's in the document: linkedom lays nothing out
    getClientRects(this: HTMLElement) {
      return this.isConnected ? [{ width: 1, height: 1 }] : [];
    },
    scrollIntoView() {},
  });
};

/**
 * Stubs `document`, `window` and the element classes the kit uses with a linkedom page that has
 * the browser's event order (capture, target, bubble) and focus (see `shimFocus`), for the kit's
 * tests. Call it in `beforeAll` (an import isn't there yet in `vi.hoisted`), before the module
 * under test adds a listener.
 * @internal
 * @param html the page (default: an empty body with a `#hudSlot` for `createHudRoot`)
 * @returns linkedom's document and window
 */
export const stubKitDomAsync = async (
  html = '<!doctype html><html><head></head><body><div id="hudSlot"></div></body></html>'
) => {
  const { parseHTML } = await import('linkedom');
  const { document, window } = parseHTML(html);
  // Before anything adds a listener: the window's event target is made from it on first use
  let proto: object | null = document;
  while (proto && !Object.prototype.hasOwnProperty.call(proto, 'dispatchEvent')) {
    proto = Object.getPrototypeOf(proto);
  }
  if (!proto) throw new Error('stubKitDomAsync: no EventTarget in linkedom’s document');
  patchEventTarget(proto as EventTarget);
  shimFocus(document as unknown as Document, window as unknown as Window & typeof globalThis);
  Object.assign(window, { innerWidth: 1280, innerHeight: 720 });
  vi.stubGlobal('document', document);
  vi.stubGlobal('window', window);
  vi.stubGlobal('HTMLElement', window.HTMLElement);
  vi.stubGlobal('HTMLInputElement', window.HTMLInputElement);
  return { document, window };
};

/** What a key event carries besides its key (linkedom has no `KeyboardEvent`) */
export type KitKeyInit = {
  shiftKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
  repeat?: boolean;
};

/**
 * Dispatches a key event at `target`, bubbling and cancelable like a browser's.
 * @internal
 * @returns the event, to read `defaultPrevented`
 */
export const dispatchKey = (
  target: EventTarget,
  type: 'keydown' | 'keyup',
  key: string,
  init: KitKeyInit = {}
) => {
  const event = Object.assign(new window.Event(type, { bubbles: true, cancelable: true }), {
    key,
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    repeat: false,
    ...init,
  });
  target.dispatchEvent(event);
  return event as unknown as KeyboardEvent;
};

/**
 * The listeners on `target` (of `type`, or of every type): a test's check that nothing is left
 * after a piece's `remove()` (p803 D11).
 * @internal
 */
export const countListeners = (target: EventTarget, type?: string) => {
  const byType = listeners.get(target);
  if (!byType) return 0;
  if (type) return byType.get(type)?.length ?? 0;
  let count = 0;
  for (const list of byType.values()) count += list.length;
  return count;
};
