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
    // A box at the origin (linkedom has none): the anchor's maths are tested on their own
    getBoundingClientRect() {
      return { left: 0, top: 0, right: 0, bottom: 0, x: 0, y: 0, width: 0, height: 0 };
    },
    scrollIntoView() {},
  });
};

type TextControl = HTMLInputElement | HTMLTextAreaElement;
type Selection = { start: number; end: number };

/** The elements holding a pointer's capture, by pointer id */
const pointerCaptures = new Map<number, Element>();

/**
 * The form controls as the fields use them (p804 D14; linkedom 0.18.13's gaps, Phase 0 step 5),
 * grown as the fields need them: an input's or a textarea's `value` kept apart from its
 * `defaultValue` (linkedom writes the attribute on every set), the selection API
 * (`selectionStart`, `selectionEnd`, `setSelectionRange`, `select()`; a new value puts the caret
 * at its end), a checkbox's `checked` kept apart from `defaultChecked` (the attribute is the default,
 * the property the state), its `indeterminate`, and its `click()` (not disabled) flipping it, a
 * cancelled click putting it back, then `input` and `change`; a radio's `checked` unchecking its
 * group (the same name in the same tree) and its `click()` checking it, with `input` and `change`
 * only when it wasn't checked; and pointer capture
 * (`setPointerCapture`, `releasePointerCapture`,
 * `hasPointerCapture`; `lostpointercapture` on a release, `dispatchPointer` routes a captured
 * pointer's events and releases it on `pointerup` / `pointercancel`).
 */
const shimFormControls = (window: Window & typeof globalThis) => {
  const values = new WeakMap<TextControl, string>();
  const selections = new WeakMap<TextControl, Selection>();
  const textControls = [window.HTMLInputElement, window.HTMLTextAreaElement];
  for (const Control of textControls) {
    const isTextarea = Control === window.HTMLTextAreaElement;
    const getDefault = (elem: TextControl) =>
      isTextarea ? elem.textContent ?? '' : elem.getAttribute('value') ?? '';
    const getValue = (elem: TextControl) => values.get(elem) ?? getDefault(elem);
    const getSelection = (elem: TextControl) => {
      const length = getValue(elem).length;
      const selection = selections.get(elem) ?? { start: length, end: length };
      return { start: Math.min(selection.start, length), end: Math.min(selection.end, length) };
    };
    Object.defineProperties(Control.prototype, {
      value: {
        configurable: true,
        get(this: TextControl) {
          return getValue(this);
        },
        set(this: TextControl, value: unknown) {
          const text = String(value ?? '');
          values.set(this, text);
          selections.set(this, { start: text.length, end: text.length });
        },
      },
      defaultValue: {
        configurable: true,
        get(this: TextControl) {
          return getDefault(this);
        },
        set(this: TextControl, value: unknown) {
          if (isTextarea) this.textContent = String(value ?? '');
          else this.setAttribute('value', String(value ?? ''));
        },
      },
      selectionStart: {
        configurable: true,
        get(this: TextControl) {
          return getSelection(this).start;
        },
      },
      selectionEnd: {
        configurable: true,
        get(this: TextControl) {
          return getSelection(this).end;
        },
      },
    });
    Object.assign(Control.prototype, {
      setSelectionRange(this: TextControl, start: number, end: number) {
        selections.set(this, { start: Math.min(start, end), end: Math.max(start, end) });
      },
      select(this: TextControl) {
        selections.set(this, { start: 0, end: getValue(this).length });
      },
    });
  }
  shimCheckboxes(window);
  Object.assign(window.HTMLElement.prototype, {
    setPointerCapture(this: Element, pointerId: number) {
      const previous = pointerCaptures.get(pointerId);
      if (previous === this) return;
      pointerCaptures.set(pointerId, this);
      if (previous) fireLostCapture(previous, pointerId);
    },
    releasePointerCapture(this: Element, pointerId: number) {
      if (pointerCaptures.get(pointerId) !== this) return;
      pointerCaptures.delete(pointerId);
      fireLostCapture(this, pointerId);
    },
    hasPointerCapture(this: Element, pointerId: number) {
      return pointerCaptures.get(pointerId) === this;
    },
  });
};

/** The radios of `radio`'s group: the same name in the same tree (detached ones too) */
const getRadioGroup = (radio: HTMLInputElement) => {
  const name = radio.getAttribute('name');
  if (!name) return [radio];
  let root: Node = radio;
  while (root.parentNode) root = root.parentNode;
  const radios = [
    ...(root as ParentNode).querySelectorAll<HTMLInputElement>('input[type="radio"]'),
  ];
  return radios.filter((other) => other.getAttribute('name') === name);
};

const shimCheckboxes = (window: Window & typeof globalThis) => {
  const checkedStates = new WeakMap<HTMLInputElement, boolean>();
  const indeterminates = new WeakMap<HTMLInputElement, boolean>();
  const proto = window.HTMLInputElement.prototype;
  const elementClick = window.HTMLElement.prototype.click;
  Object.defineProperties(proto, {
    checked: {
      configurable: true,
      get(this: HTMLInputElement) {
        return checkedStates.get(this) ?? this.hasAttribute('checked');
      },
      set(this: HTMLInputElement, on: unknown) {
        // A radio checked unchecks the rest of its group
        if (on && this.getAttribute('type') === 'radio') {
          for (const other of getRadioGroup(this)) checkedStates.set(other, false);
        }
        checkedStates.set(this, Boolean(on));
      },
    },
    defaultChecked: {
      configurable: true,
      get(this: HTMLInputElement) {
        return this.hasAttribute('checked');
      },
      set(this: HTMLInputElement, on: unknown) {
        this.toggleAttribute('checked', Boolean(on));
      },
    },
    indeterminate: {
      configurable: true,
      get(this: HTMLInputElement) {
        return indeterminates.get(this) ?? false;
      },
      set(this: HTMLInputElement, on: unknown) {
        indeterminates.set(this, Boolean(on));
      },
    },
  });
  Object.assign(proto, {
    click(this: HTMLInputElement) {
      const type = this.getAttribute('type');
      if (type === 'radio') {
        clickRadio(this);
        return;
      }
      if (type !== 'checkbox') {
        elementClick.call(this);
        return;
      }
      if (this.hasAttribute('disabled')) return;
      const wasChecked = this.checked;
      const wasIndeterminate = this.indeterminate;
      // The browser's order: flipped, the click (cancelable), then input and change
      this.checked = !wasChecked;
      this.indeterminate = false;
      const click = new window.Event('click', { bubbles: true, cancelable: true });
      if (!this.dispatchEvent(click)) {
        this.checked = wasChecked;
        this.indeterminate = wasIndeterminate;
        return;
      }
      this.dispatchEvent(new window.Event('input', { bubbles: true }));
      this.dispatchEvent(new window.Event('change', { bubbles: true }));
    },
  });

  /** A radio's click: checked (its group's others unchecked), the cancelable click, then `input`
   * and `change` only when it wasn't checked before */
  const clickRadio = (radio: HTMLInputElement) => {
    if (radio.hasAttribute('disabled')) return;
    const wasChecked = getRadioGroup(radio).find((other) => other.checked) ?? null;
    radio.checked = true;
    const click = new window.Event('click', { bubbles: true, cancelable: true });
    if (!radio.dispatchEvent(click)) {
      radio.checked = false;
      if (wasChecked) wasChecked.checked = true;
      return;
    }
    if (wasChecked === radio) return;
    radio.dispatchEvent(new window.Event('input', { bubbles: true }));
    radio.dispatchEvent(new window.Event('change', { bubbles: true }));
  };
};

const fireLostCapture = (elem: Element, pointerId: number) => {
  elem.dispatchEvent(
    Object.assign(new window.Event('lostpointercapture', { bubbles: true }), { pointerId })
  );
};

/**
 * Stubs `document`, `window` and the element classes the kit uses with a linkedom page that has
 * the browser's event order (capture, target, bubble), focus (see `shimFocus`) and the form
 * controls the fields use (see `shimFormControls`), for the kit's tests. Call it in `beforeAll` (an import isn't there yet in `vi.hoisted`), before the module
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
  shimFormControls(window as unknown as Window & typeof globalThis);
  pointerCaptures.clear();
  Object.assign(window, { innerWidth: 1280, innerHeight: 720 });
  vi.stubGlobal('document', document);
  vi.stubGlobal('window', window);
  vi.stubGlobal('HTMLElement', window.HTMLElement);
  vi.stubGlobal('HTMLInputElement', window.HTMLInputElement);
  // A frame is a 16 ms timer, so a test's fake timers run it (`vi.advanceTimersByTime`)
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) =>
    setTimeout(() => fn(Date.now()), 16)
  );
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
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

/** What a pointer event carries (linkedom has no `PointerEvent` or `MouseEvent`) */
export type KitPointerInit = KitKeyInit & {
  pointerId?: number;
  /** The button pressed (0 primary) */
  button?: number;
  clientX?: number;
  clientY?: number;
};

/**
 * Dispatches a pointer event at `target`, bubbling and cancelable like a browser's. A pointer an
 * element captured goes to that element (`setPointerCapture`), and `pointerup` / `pointercancel`
 * release its capture after the event (`lostpointercapture`), as a browser does.
 * @internal
 * @returns the event, to read `defaultPrevented`
 */
export const dispatchPointer = (
  target: EventTarget,
  type:
    | 'pointerdown'
    | 'pointermove'
    | 'pointerup'
    | 'pointercancel'
    | 'pointerenter'
    | 'pointerleave'
    | 'click',
  init: KitPointerInit = {}
) => {
  const pointerId = init.pointerId ?? 1;
  const event = Object.assign(new window.Event(type, { bubbles: true, cancelable: true }), {
    pointerId,
    pointerType: 'mouse',
    isPrimary: true,
    button: 0,
    buttons: type === 'pointerup' || type === 'click' ? 0 : 1,
    clientX: 0,
    clientY: 0,
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    ...init,
  });
  const captured = type === 'click' ? undefined : pointerCaptures.get(pointerId);
  (captured ?? target).dispatchEvent(event);
  if (type === 'pointerup' || type === 'pointercancel') {
    const holder = pointerCaptures.get(pointerId);
    if (holder) {
      pointerCaptures.delete(pointerId);
      fireLostCapture(holder, pointerId);
    }
  }
  return event as unknown as PointerEvent;
};

/**
 * The listeners on `target` (of `type`, or of every type): a test's check that nothing is left
 * after a piece's `remove()` (p803 D11).
 * @internal
 */
export const countListeners = (target: EventTarget, type?: string) => {
  // linkedom's window is a proxy: its listeners are on the document's parent, its event target
  const resolved =
    target === (window as unknown) ? (document as unknown as KitTarget)._getParent?.() : target;
  const byType = resolved && listeners.get(resolved);
  if (!byType) return 0;
  if (type) return byType.get(type)?.length ?? 0;
  let count = 0;
  for (const list of byType.values()) count += list.length;
  return count;
};
