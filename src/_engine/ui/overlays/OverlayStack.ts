// The overlay stack (p803 D7): every open dialog, drop-down list, tooltip, popover, menu and
// focused toast is an entry. Escape pressed inside the HUD root goes
// to the top entry alone, a closed entry returns the focus, and an entry that asks makes the rest
// of the HUD inert.
import { getHUDRootCMP, hasHudRoot } from '../core/HUD';

/**
 * The attribute on a debugger root (the drawer, the editor drawer, the on-screen tools, a debug
 * window): an app's inert entry leaves the element live, so the debugger still works over an app's
 * modal dialog; a debug entry's (`isDebug`) doesn't (p803 D7).
 * @internal
 */
export const DEBUGGER_ROOT_ATTR = 'data-aek-debugger';

/**
 * The attribute on a HUD root child no inert entry covers: the announcer's live region (p805 D4),
 * which holds nothing focusable and must be read under a modal too.
 * @internal
 */
export const KEEP_LIVE_ATTR = 'data-aek-keep-live';

/**
 * An overlay stack entry.
 * @internal
 */
export type OverlayProps = {
  /** The overlay's element: a dialog's window, a drop-down's list. Escape goes to the entry
   * while it's on top; the entry is dropped once this leaves the document */
  elem: HTMLElement;
  /** What Escape calls on the top entry. Without it Escape stops at the entry and does nothing
   * (a modal dialog that doesn't close on Escape). */
  close?: () => void;
  /** Where the focus goes when the entry is removed: default what had it at the push */
  returnFocus?: HTMLElement | null;
  /** Makes the HUD root's other children inert while this is the top such entry (a modal
   * dialog; the entries above it stay live) */
  inert?: boolean;
  /** More HUD root children the entry owns, which its inert leaves live (a dialog's backdrop) */
  keep?: HTMLElement[];
  /** A debugger overlay: its inert covers the debugger's roots too (`DEBUGGER_ROOT_ATTR`) */
  isDebug?: boolean;
};

type OverlayEntry = OverlayProps & { returnFocus: HTMLElement | null };

/** The open overlays, bottom to top */
const entries: OverlayEntry[] = [];
/** The HUD root's children this stack made inert (an element the app made inert isn't here) */
let inertElems = new Set<Element>();
let isKeyListenerAdded = false;

/**
 * Swallows the keyup of the key a piece handled, so a KEY_UP binding of that key (eg. an app's
 * Escape) doesn't fire right after. A one-off capture listener on the window, not on the HUD
 * root: the keyup goes where the focus is then, which a close may have moved out of the HUD.
 * @internal
 */
export const swallowNextKeyUp = (key: string) => {
  const onKeyUp = (e: KeyboardEvent) => {
    window.removeEventListener('keyup', onKeyUp, true);
    if (e.key === key) e.stopImmediatePropagation();
  };
  window.addEventListener('keyup', onKeyUp, true);
};

/** The top entry still in the document; the ones closed some other way are dropped */
const getTopEntry = () => {
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].elem.isConnected) return entries[i];
    entries.splice(i, 1);
  }
  return null;
};

/** In the capture phase on the HUD root: before the piece's own listeners and the input system's
 * (bubble phase on the window), and only for a key pressed with the focus inside the HUD, so an
 * embed's host page keeps its Escape */
const onKeyDown = (e: KeyboardEvent) => {
  if (e.key !== 'Escape') return;
  const top = getTopEntry();
  if (!top) return;
  e.preventDefault();
  e.stopPropagation();
  swallowNextKeyUp('Escape');
  // A held Escape closes one overlay, not every stacked one
  if (!e.repeat) top.close?.();
};

/** Added on the first push with a HUD root, and kept: a no-op while the stack is empty */
const addKeyListener = () => {
  if (isKeyListenerAdded || !hasHudRoot()) return;
  isKeyListenerAdded = true;
  getHUDRootCMP().elem.addEventListener('keydown', onKeyDown, true);
};

const ownsElem = (entry: OverlayEntry, child: Element) =>
  child.contains(entry.elem) || Boolean(entry.keep?.some((elem) => child.contains(elem)));

/** Sets `inert` on the HUD root's children the top inert entry covers, and takes it off the ones
 * it no longer does. Read on each push and remove: a child added while it's open stays live. */
const applyInert = () => {
  const next = new Set<Element>();
  let topIndex = -1;
  for (let i = entries.length - 1; i >= 0 && topIndex === -1; i--) {
    if (entries[i].inert && entries[i].elem.isConnected) topIndex = i;
  }
  if (topIndex !== -1 && hasHudRoot()) {
    const top = entries[topIndex];
    const live = entries.slice(topIndex);
    const children = getHUDRootCMP().elem.children;
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      if (live.some((entry) => ownsElem(entry, child))) continue;
      if (child.hasAttribute(KEEP_LIVE_ATTR)) continue;
      if (!top.isDebug && child.hasAttribute(DEBUGGER_ROOT_ATTR)) continue;
      // The app's own inert: neither set nor removed here
      if (child.hasAttribute('inert') && !inertElems.has(child)) continue;
      next.add(child);
    }
  }
  for (const elem of inertElems) if (!next.has(elem)) elem.removeAttribute('inert');
  for (const elem of next) elem.setAttribute('inert', '');
  inertElems = next;
};

/**
 * Puts an overlay on top of the stack (p803 D7). While it's the top entry, Escape pressed with
 * the focus inside the HUD root closes it (its `close`) and goes no further, its keyup included:
 * no key binding or other listener gets it. A key pressed outside the HUD root is the page's.
 * @internal
 * @returns what removes the entry: with `returnFocus` (default true) the focus goes back to
 * where it was at the push, if that's still in the document and the focus is in the overlay or
 * nowhere (the body). Removing an entry twice is a no-op.
 */
export const pushOverlay = (props: OverlayProps) => {
  addKeyListener();
  const active = document.activeElement as HTMLElement | null;
  const entry: OverlayEntry = {
    ...props,
    returnFocus: props.returnFocus !== undefined ? props.returnFocus : active,
  };
  entries.push(entry);
  if (entry.inert) applyInert();
  return (returnFocus = true) => {
    const index = entries.indexOf(entry);
    if (index === -1) return;
    entries.splice(index, 1);
    if (entry.inert || inertElems.size) applyInert();
    if (!returnFocus) return;
    const target = entry.returnFocus;
    if (!target?.isConnected || target === document.body) return;
    const focused = document.activeElement;
    const isFocusInOverlay =
      !focused ||
      focused === document.body ||
      entry.elem.contains(focused) ||
      Boolean(entry.keep?.some((elem) => elem.contains(focused)));
    if (isFocusInOverlay) target.focus({ preventScroll: true });
  };
};
