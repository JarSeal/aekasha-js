/** What Tab reaches: an enabled control, a link, or an element with a `tabindex` other than -1 */
const FOCUSABLE_SELECTOR =
  'button:not([disabled]), a[href], input:not([disabled]):not([type="hidden"]), ' +
  'select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * The rendered elements Tab reaches in `root`, in document order (not `tabindex` order: the kit
 * writes no positive `tabindex`). Found by selector, since a `<button>`'s `tabIndex` isn't
 * reliable in every DOM (p803 Phase 0); an element with no box (in a collapsed folder,
 * `display: none`) is left out.
 * @internal
 */
export const getFocusableElements = (root: Element) => {
  const candidates = root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
  const focusables: HTMLElement[] = [];
  for (let i = 0; i < candidates.length; i++) {
    if (candidates[i].getClientRects().length) focusables.push(candidates[i]);
  }
  return focusables;
};

/**
 * The first rendered element Tab reaches in `root`, or null.
 * @internal
 */
export const getFirstFocusable = (root?: Element) =>
  (root && getFocusableElements(root)[0]) || null;

/**
 * Keeps Tab and Shift+Tab inside `elem` (p803 D7, a modal dialog's): Tab on its last focusable
 * element goes to its first, Shift+Tab on its first (or on `elem` itself) to its last, and with
 * none the key does nothing. Between those, the browser moves the focus as usual.
 * @internal
 * @param elem the trapping element; its keydown listener sees a Tab pressed inside it only
 * @returns what removes the trap
 */
export const trapFocus = (elem: HTMLElement) => {
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Tab' || e.ctrlKey || e.altKey || e.metaKey) return;
    const focusables = getFocusableElements(elem);
    if (!focusables.length) {
      e.preventDefault();
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;
    const isAtEdge = e.shiftKey ? active === first || active === elem : active === last;
    if (!isAtEdge) return;
    e.preventDefault();
    (e.shiftKey ? last : first).focus({ preventScroll: true });
  };
  elem.addEventListener('keydown', onKeyDown);
  return () => elem.removeEventListener('keydown', onKeyDown);
};
