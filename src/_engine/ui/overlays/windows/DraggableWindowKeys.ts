// The draggable windows' keyboard paths (p803 D8): the header's keys (the arrows move a window,
// Alt+arrows resize it, Shift takes four steps at once, Enter collapses or expands it) and the
// window cycle keys (F6 / Shift+F6 by default), which move the focus from window to window. Like
// the other window modules it doesn't import DraggableWindow.ts: that passes in what it needs.
import { swallowNextKeyUp } from '../OverlayStack';
import {
  clampToGrabbable,
  getGrabArea,
  isCssCentred,
  RESIZING_ATTR,
  writePosition,
} from './DraggableWindowGeometry';
import type { WindowEntry } from './DraggableWindowTypes';

/**
 * The keys that move the focus to the next and the previous open window (see
 * {@link setWindowCycleKeys}): chords like `'F6'` or `'Ctrl+Shift+W'`, modifiers (`Ctrl`, `Shift`,
 * `Alt`, `Meta`) first, then the key as `KeyboardEvent.key` names it (case doesn't matter).
 */
export type WindowCycleKeys = { next: string; previous: string };

type Chord = { key: string; ctrl: boolean; shift: boolean; alt: boolean; meta: boolean };

/** One step of a key move or resize: `--aek-space-5` at the default density, 16 px */
const STEP_IN_BASE = 16 / 14;
const FALLBACK_STEP_PX = 16;
/** Shift's factor on a step */
const BIG_STEP = 4;
const ARROWS: { [key: string]: [number, number] } = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};
const DEFAULT_CYCLE_KEYS: WindowCycleKeys = { next: 'F6', previous: 'Shift+F6' };

/**
 * A chord's text as {@link WindowCycleKeys} writes it, parsed.
 * @internal
 */
export const parseKeyChord = (text: string): Chord => {
  // A trailing '+' is the key itself ('Ctrl++')
  const parts = text.endsWith('++') ? [...text.slice(0, -2).split('+'), '+'] : text.split('+');
  const key = (parts.pop() ?? '').trim().toLowerCase();
  const mods = parts.map((part) => part.trim().toLowerCase());
  const has = (...names: string[]) => mods.some((mod) => names.includes(mod));
  return {
    key,
    ctrl: has('ctrl', 'control'),
    shift: has('shift'),
    alt: has('alt', 'option'),
    meta: has('meta', 'cmd', 'command'),
  };
};

const matchesChord = (e: KeyboardEvent, chord: Chord) =>
  e.key.toLowerCase() === chord.key &&
  e.ctrlKey === chord.ctrl &&
  e.shiftKey === chord.shift &&
  e.altKey === chord.alt &&
  e.metaKey === chord.meta;

let cycleChords: { next: Chord; previous: Chord } | null = {
  next: parseKeyChord(DEFAULT_CYCLE_KEYS.next),
  previous: parseKeyChord(DEFAULT_CYCLE_KEYS.previous),
};

/**
 * Sets the keys that move the focus from window to window (p803 D8; default F6 for the next and
 * Shift+F6 for the previous, the platforms' "next pane" pair), or turns them off with `null`.
 * The next window is the next open one in the order they were opened, the app's windows first and
 * then the debug windows; the key focuses its first focusable element (its content's, else its
 * header) and brings it to the front. The keys work with the focus anywhere in the HUD root's
 * parent element (the page's body, or a mounted engine's container with the canvas), so an
 * embed's host page keeps them, and a press that moved the focus goes no further (no key binding
 * gets it).
 * @param keys the two chords, or null for none
 * @example
 * ```ts
 * // F6 is the game's own: cycle the windows with Ctrl+F6 / Ctrl+Shift+F6 instead
 * setWindowCycleKeys({ next: 'Ctrl+F6', previous: 'Ctrl+Shift+F6' });
 * ```
 */
export const setWindowCycleKeys = (keys: WindowCycleKeys | null) => {
  cycleChords = keys && { next: parseKeyChord(keys.next), previous: parseKeyChord(keys.previous) };
};

/**
 * What the cycle keys need of the windows (DraggableWindow.ts'): the HUD root, every window, and
 * how to focus one.
 * @internal
 */
export type WindowCycle = {
  /** The HUD root's element: its children are the windows, in the order they were mounted */
  hudRoot: HTMLElement;
  /** Every window, mounted or not */
  getEntries: () => Iterable<WindowEntry>;
  /** Brings a window to the front and focuses its first focusable element */
  focusWindow: (entry: WindowEntry) => void;
};

/** The open windows the keys visit: in the order they were mounted (the HUD root's order, which
 * a bring-to-front doesn't change), the app's and then the debug windows; not one that can't take
 * the focus (inert under a modal dialog, hidden by an editor view) */
const getCycleWindows = ({ hudRoot, getEntries }: WindowCycle) => {
  const byElem = new Map<Element, WindowEntry>();
  for (const entry of getEntries()) {
    if (entry.runtime.windowCMP) byElem.set(entry.runtime.windowCMP.elem, entry);
  }
  const app: WindowEntry[] = [];
  const debug: WindowEntry[] = [];
  const children = hudRoot.children;
  for (let i = 0; i < children.length; i++) {
    const entry = byElem.get(children[i]);
    if (!entry || children[i].closest('[inert]') || !children[i].getClientRects().length) continue;
    (entry.config.isDebugWindow ? debug : app).push(entry);
  }
  return app.concat(debug);
};

/** Focuses the next (1) or previous (-1) window (from outside every window: the first or the
 * last). Returns whether there was one. */
const cycleWindowFocus = (cycle: WindowCycle, direction: 1 | -1) => {
  const list = getCycleWindows(cycle);
  if (!list.length) return false;
  const active = document.activeElement;
  const current = active
    ? list.findIndex(({ runtime }) => runtime.windowCMP?.elem.contains(active))
    : -1;
  const next =
    current === -1
      ? direction === 1
        ? 0
        : list.length - 1
      : (current + direction + list.length) % list.length;
  cycle.focusWindow(list[next]);
  return true;
};

/**
 * Adds the cycle keys' listener, in the capture phase on `target` (the HUD root's parent: the
 * page's body, or a mount's container with the canvas, so a key pressed on the canvas reaches the
 * windows and an embed's host page keeps its own). A key that moved the focus goes no further.
 * Added once, on the windows' first mount, and kept.
 * @internal
 */
export const addWindowCycleListener = (target: HTMLElement, cycle: WindowCycle) => {
  target.addEventListener(
    'keydown',
    (e) => {
      if (!cycleChords) return;
      const direction = matchesChord(e, cycleChords.next)
        ? 1
        : matchesChord(e, cycleChords.previous)
          ? -1
          : 0;
      if (!direction || !cycleWindowFocus(cycle, direction)) return;
      e.preventDefault();
      e.stopPropagation();
      swallowNextKeyUp(e.key);
    },
    true
  );
};

/** One key step in px: `--aek-base` follows the UI scale and the browser's font size */
const getStepPx = (elem: HTMLElement) => {
  if (typeof getComputedStyle !== 'function') return FALLBACK_STEP_PX;
  const base = parseFloat(getComputedStyle(elem).getPropertyValue('--aek-base'));
  return base > 0 ? Math.round(base * STEP_IN_BASE) : FALLBACK_STEP_PX;
};

/** Moves the window by (dx, dy), kept grabbable as a drag keeps it. Returns whether it moved. */
const moveByKey = ({ config, runtime }: WindowEntry, dx: number, dy: number) => {
  const elem = runtime.windowCMP?.elem;
  if (!elem || config.disableDragging || isCssCentred(config)) return false;
  const g = config.geometry;
  const pos = { x: g.x + dx, y: g.y + dy };
  clampToGrabbable(pos, getGrabArea(runtime));
  pos.x = Math.round(pos.x);
  pos.y = Math.round(pos.y);
  if (pos.x === g.x && pos.y === g.y) return false;
  g.x = pos.x;
  g.y = pos.y;
  writePosition(elem, g);
  return true;
};

/** Resizes the window by (dw, dh) on its resizable axes; its CSS min and max size clamp it, and
 * a resized axis is stored in px from then on, as a drag's. Returns whether its size changed. */
const resizeByKey = ({ config, runtime }: WindowEntry, dw: number, dh: number) => {
  const elem = runtime.windowCMP?.elem;
  const w = dw !== 0 && !config.disableHoriResize;
  // A collapsed window's height is its header's
  const h = dh !== 0 && !config.disableVertResize && !config.isCollapsed;
  if (!elem || (!w && !h)) return false;
  const g = config.geometry;
  const prev = { w: g.w, h: g.h };
  elem.setAttribute(RESIZING_ATTR, '');
  const rect = elem.getBoundingClientRect();
  if (w) elem.style.width = `${rect.width + dw}px`;
  if (h) elem.style.height = `${rect.height + dh}px`;
  const next = elem.getBoundingClientRect();
  const sizeUnits = { ...config.units?.size };
  if (w) {
    g.w = Math.round(next.width);
    sizeUnits.w = 'px';
    elem.style.width = `${g.w}px`;
  }
  if (h) {
    g.h = Math.round(next.height);
    sizeUnits.h = 'px';
    elem.style.height = `${g.h}px`;
  }
  config.units = { ...config.units, size: sizeUnits };
  elem.removeAttribute(RESIZING_ATTR);
  return g.w !== prev.w || g.h !== prev.h;
};

/**
 * The header's keys (p803 D8), for a key pressed on the header itself (not on its buttons): the
 * arrows move the window a step (`--aek-space-5`, 16 px at the defaults), Alt+arrows resize it
 * (left and up shrink), Shift makes it four steps, and Enter toggles its collapse. A key it uses
 * goes no further (no key binding gets it). The change is committed (`onCommit`: recorded and
 * saved to LS) when the arrow is released or the focus leaves the header.
 * @internal
 */
export const addHeaderKeys = (
  entry: WindowEntry,
  header: HTMLElement,
  {
    onCommit,
    onToggleCollapse,
  }: { onCommit: (entry: WindowEntry) => void; onToggleCollapse: () => void }
) => {
  let isChanged = false;
  const commit = () => {
    if (!isChanged) return;
    isChanged = false;
    onCommit(entry);
  };
  header.addEventListener('keydown', (e) => {
    if (e.target !== header || e.ctrlKey || e.metaKey) return;
    const { config } = entry;
    if (e.key === 'Enter') {
      if (config.disableCollapseBtn || e.altKey || e.shiftKey) return;
      e.preventDefault();
      e.stopPropagation();
      if (!e.repeat) onToggleCollapse();
      return;
    }
    const arrow = ARROWS[e.key];
    if (!arrow) return;
    const isResize = e.altKey;
    if (isResize ? config.disableHoriResize && config.disableVertResize : config.disableDragging) {
      return;
    }
    // Taken even at a limit, so the press never reaches a key binding (a player's move)
    e.preventDefault();
    e.stopPropagation();
    const step = getStepPx(header) * (e.shiftKey ? BIG_STEP : 1);
    const dx = arrow[0] * step;
    const dy = arrow[1] * step;
    if (isResize ? resizeByKey(entry, dx, dy) : moveByKey(entry, dx, dy)) isChanged = true;
  });
  header.addEventListener('keyup', (e) => {
    if (ARROWS[e.key]) commit();
  });
  header.addEventListener('focusout', commit);
};
