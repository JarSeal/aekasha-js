// The canvas's size source (p611 D6): what sizes the renderer and the cameras' aspect. The window
// by default (the full-page boot, `InitEngine`); an element's box when the engine is mounted into
// a page it doesn't own (`mountAekasha`). The HUD's own bounds (the draggable windows', the
// drawer's) are `ui/Window.ts`' `getWindowSize`, which the mount points at the same container.

/** The canvas's size in CSS pixels, and its aspect ratio. */
export type CanvasSize = {
  width: number;
  height: number;
  /** `width / height`; 1 while the height is 0 (a hidden container). */
  aspect: number;
};

/**
 * Where the canvas's size comes from: a reader and a change subscription.
 * @internal
 */
export type CanvasSizeSource = {
  /** The current size, in CSS pixels. */
  read: () => { width: number; height: number };
  /** Calls `onChange` whenever the size may have changed; returns the unsubscriber. */
  observe: (onChange: () => void) => () => void;
};

const windowSizeSource: CanvasSizeSource = {
  read: () => ({ width: window.innerWidth, height: window.innerHeight }),
  observe: (onChange) => {
    window.addEventListener('resize', onChange, false);
    return () => window.removeEventListener('resize', onChange, false);
  },
};

let source = windowSizeSource;
let stopObserving: (() => void) | null = null;
const listeners = new Set<() => void>();

const notifyListeners = () => {
  for (const fn of listeners) fn();
};

/**
 * Returns the canvas's size: the window's inner size, or the box of the element the engine is
 * mounted into. Read it for anything sized like the canvas (a camera's aspect, a render target);
 * the renderer and the cameras already follow it.
 * @returns the width and height in CSS pixels, and their aspect ratio
 */
export const getCanvasSize = (): CanvasSize => {
  const { width, height } = source.read();
  return { width, height, aspect: height > 0 ? width / height : 1 };
};

/**
 * Calls `fn` whenever the canvas's size source reports a change (the window's `resize` by
 * default). The main loop's resizers run from it.
 * @internal
 * @returns the remover
 */
export const onCanvasResize = (fn: () => void): (() => void) => {
  listeners.add(fn);
  if (!stopObserving) stopObserving = source.observe(notifyListeners);
  return () => {
    listeners.delete(fn);
    if (listeners.size || !stopObserving) return;
    stopObserving();
    stopObserving = null;
  };
};

/**
 * Sets the canvas's size source (null: the window again). The listeners move to the new source
 * and run once, since the size may differ.
 * @internal
 */
export const setCanvasSizeSource = (next: CanvasSizeSource | null) => {
  stopObserving?.();
  stopObserving = null;
  source = next ?? windowSizeSource;
  if (!listeners.size) return;
  stopObserving = source.observe(notifyListeners);
  notifyListeners();
};

/**
 * A size source that reads an element's content box (`clientWidth` / `clientHeight`), observed
 * with a `ResizeObserver`. Its changes include the window's `resize`, so what is sized against
 * the window (the debug windows) follows too.
 * @internal
 */
export const createElementSizeSource = (elem: HTMLElement): CanvasSizeSource => ({
  read: () => ({ width: elem.clientWidth, height: elem.clientHeight }),
  observe: (onChange) => {
    const observer = new ResizeObserver(() => onChange());
    observer.observe(elem);
    window.addEventListener('resize', onChange, false);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', onChange, false);
    };
  },
});
