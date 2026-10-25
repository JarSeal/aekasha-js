/** The element whose box bounds the HUD (a mounted engine's container), or null: the window */
let boundsElem: HTMLElement | null = null;
/** What runs when the bounds change size (`onBoundsResize`) */
const resizeListeners = new Set<() => void>();
/** Stops the resize source while it's attached (some listener is there): null otherwise */
let detachResizeSource: (() => void) | null = null;

const runResizeListeners = () => {
  for (const listener of resizeListeners) listener();
};

/** Follows the bounds' size: a `ResizeObserver` on the bounds element, or the window's `resize`.
 * Returns what stops it. */
const attachResizeSource = () => {
  if (boundsElem && typeof ResizeObserver === 'function') {
    const observer = new ResizeObserver(runResizeListeners);
    observer.observe(boundsElem);
    return () => observer.disconnect();
  }
  window.addEventListener('resize', runResizeListeners);
  return () => window.removeEventListener('resize', runResizeListeners);
};

/**
 * Sets the element whose box bounds the HUD's fixed elements: `mountAekasha`'s container (its
 * `contain: layout` makes it their containing block), or null for the browser window. An attached
 * resize source (`onBoundsResize`) moves to the new bounds.
 * @internal
 */
export const setWindowBoundsElement = (elem: HTMLElement | null) => {
  if (elem === boundsElem) return;
  boundsElem = elem;
  if (!detachResizeSource) return;
  detachResizeSource();
  detachResizeSource = attachResizeSource();
};

/**
 * Runs `listener` whenever the HUD's bounds change size (p803 D4: the windows' clamp follows them
 * without the main loop). The source attaches with the first listener and stops with the last: a
 * `ResizeObserver` on the bounds element (`setWindowBoundsElement`), whose first call follows its
 * `observe()`, or the browser window's `resize`.
 * @internal
 * @param listener runs on each size change, undebounced
 * @returns what removes the listener
 */
export const onBoundsResize = (listener: () => void) => {
  resizeListeners.add(listener);
  detachResizeSource ??= attachResizeSource();
  return () => {
    resizeListeners.delete(listener);
    if (resizeListeners.size || !detachResizeSource) return;
    detachResizeSource();
    detachResizeSource = null;
  };
};

/**
 * The box the HUD's fixed elements are laid out in, the draggable windows' and the debug drawer's
 * bounds: the browser window's inner size, or a mounted engine's container (its padding box). Its
 * `left` and `top` are that box's position in the viewport, so a viewport position (a
 * `getBoundingClientRect()`) minus them is a fixed element's CSS `left` / `top`; 0 for the window.
 * @internal
 */
export const getWindowSize = () => {
  if (boundsElem) {
    const rect = boundsElem.getBoundingClientRect();
    const width = boundsElem.clientWidth;
    const height = boundsElem.clientHeight;
    return {
      left: rect.left + boundsElem.clientLeft,
      top: rect.top + boundsElem.clientTop,
      width,
      height,
      aspect: width / height,
    };
  }
  const width = window.innerWidth;
  const height = window.innerHeight;

  return {
    left: 0,
    top: 0,
    width,
    height,
    aspect: width / height,
  };
};
