// Anchored overlays (p803 D7): an element placed at a side of an anchor element, flipped to the
// other side when it doesn't fit, shifted along the side to stay inside the HUD's bounds, and
// given the space left as its max size; shown in the browser's top layer (the Popover API), so no
// window's `overflow` clips it, or in the HUD root where that's missing. Our own (about 1 KiB):
// floating-ui would be about 3 KiB gzip for more than the kit needs.
import { getHUDRootCMP, hasHudRoot } from '../core/HUD';
import { getWindowSize, onBoundsResize } from '../core/Window';

/**
 * A side of the anchor.
 * @internal
 */
export type AnchorSide = 'top' | 'bottom' | 'left' | 'right';
/**
 * Where along the side the element lines up with the anchor.
 * @internal
 */
export type AnchorAlign = 'start' | 'center' | 'end';
/**
 * A box in viewport px.
 * @internal
 */
export type AnchorBox = { left: number; top: number; width: number; height: number };

/**
 * What `computeAnchorPlacement` places.
 * @internal
 */
export type AnchorPlacementInput = {
  /** The anchor's box */
  anchor: AnchorBox;
  /** The element's natural size (before a max size) */
  size: { width: number; height: number };
  /** The box to stay inside: the HUD's bounds */
  bounds: AnchorBox;
  /** The preferred side */
  side: AnchorSide;
  /** Where along the side (default 'start') */
  align?: AnchorAlign;
  /** The px between the anchor and the element, and kept from the bounds' edges (default 0) */
  gap?: number;
};

/**
 * Where `computeAnchorPlacement` puts the element: its viewport position, the side it took and
 * the space left there (its max size).
 * @internal
 */
export type AnchorPlacement = {
  side: AnchorSide;
  x: number;
  y: number;
  maxWidth: number;
  maxHeight: number;
};

const OPPOSITE: Record<AnchorSide, AnchorSide> = {
  top: 'bottom',
  bottom: 'top',
  left: 'right',
  right: 'left',
};

/** The space between the anchor's `side` and the bounds' edge, the gaps taken off */
const getSpace = (side: AnchorSide, anchor: AnchorBox, bounds: AnchorBox, gap: number) => {
  if (side === 'bottom') return bounds.top + bounds.height - (anchor.top + anchor.height) - 2 * gap;
  if (side === 'top') return anchor.top - bounds.top - 2 * gap;
  if (side === 'right') return bounds.left + bounds.width - (anchor.left + anchor.width) - 2 * gap;
  return anchor.left - bounds.left - 2 * gap;
};

/** The start of a `length` long element along an axis, aligned to the anchor's span there and
 * shifted to stay between the bounds' edges (their start when it's longer than they are) */
const alignOnAxis = (
  align: AnchorAlign,
  anchorStart: number,
  anchorLength: number,
  length: number,
  boundsStart: number,
  boundsLength: number,
  gap: number
) => {
  let start =
    align === 'start'
      ? anchorStart
      : align === 'end'
        ? anchorStart + anchorLength - length
        : anchorStart + (anchorLength - length) / 2;
  start = Math.min(start, boundsStart + boundsLength - gap - length);
  return Math.max(start, boundsStart + gap);
};

/**
 * Places an element at a side of an anchor (p803 D7), all in viewport px: on `side` when its size
 * fits there or fits better than on the opposite side (else flipped), aligned along the side and
 * shifted to stay inside the bounds, with the space left on its side and across as its max size.
 * Pure: the anchor's tests run it in Node.
 * @internal
 */
export const computeAnchorPlacement = ({
  anchor,
  size,
  bounds,
  side: preferred,
  align = 'start',
  gap = 0,
}: AnchorPlacementInput): AnchorPlacement => {
  const isVertical = preferred === 'top' || preferred === 'bottom';
  const length = isVertical ? size.height : size.width;
  const preferredSpace = getSpace(preferred, anchor, bounds, gap);
  const oppositeSpace = getSpace(OPPOSITE[preferred], anchor, bounds, gap);
  const side =
    length > preferredSpace && oppositeSpace > preferredSpace ? OPPOSITE[preferred] : preferred;
  const space = Math.max(0, side === preferred ? preferredSpace : oppositeSpace);
  const along = Math.min(length, space);

  if (isVertical) {
    const maxWidth = Math.max(0, bounds.width - 2 * gap);
    const width = Math.min(size.width, maxWidth);
    const x = alignOnAxis(align, anchor.left, anchor.width, width, bounds.left, bounds.width, gap);
    const y = side === 'bottom' ? anchor.top + anchor.height + gap : anchor.top - gap - along;
    return { side, x, y, maxWidth, maxHeight: space };
  }
  const maxHeight = Math.max(0, bounds.height - 2 * gap);
  const height = Math.min(size.height, maxHeight);
  const y = alignOnAxis(align, anchor.top, anchor.height, height, bounds.top, bounds.height, gap);
  const x = side === 'right' ? anchor.left + anchor.width + gap : anchor.left - gap - along;
  return { side, x, y, maxWidth: space, maxHeight };
};

/**
 * What `showAnchored` shows.
 * @internal
 */
export type ShowAnchoredProps = {
  /** The overlay, in the document already (the top layer keeps its place in the DOM, so it
   * inherits the tokens and the theme from there) */
  elem: HTMLElement;
  /** What it's anchored to */
  anchor: HTMLElement;
  /** The preferred side (default 'bottom') */
  side?: AnchorSide;
  /** Where along the side (default 'start') */
  align?: AnchorAlign;
  /** The px between the anchor and the overlay, and kept from the bounds' edges (default 4: the
   * tokens' `--aek-space-2` at the defaults) */
  gap?: number;
  /** At least as wide as the anchor along a top or bottom side (a drop-down's list) */
  matchAnchorWidth?: boolean;
};

/** The attribute `showAnchored` writes the side it took to, for an arrow or a caret */
const SIDE_ATTR = 'data-side';

/**
 * Whether the browser has the Popover API's top layer (p803 D7; not in linkedom, nor in some
 * WebGL 2 browsers).
 * @internal
 */
export const hasTopLayer = () =>
  typeof HTMLElement === 'function' && typeof HTMLElement.prototype.showPopover === 'function';

/** The fallback's overlay leaves its subtree for the HUD root: it takes the nearest theme and
 * density with it */
const copyInheritedAttr = (elem: HTMLElement, anchor: HTMLElement, name: string) => {
  const value = anchor.closest(`[${name}]`)?.getAttribute(name);
  if (value) elem.setAttribute(name, value);
};

/**
 * Shows `elem` anchored to `anchor` (p803 D7) and keeps it there while the page scrolls (any
 * ancestor: a capture listener on the document) or the window or the HUD's bounds resize, each
 * read in one animation frame (and written only when the anchor, the bounds or its size moved). In the top layer (`popover="manual"`, so the browser closes it on
 * nothing: the overlay stack does) neither a window's `overflow` nor an embed's container clips
 * it, and its position is the viewport's. Without the Popover API it moves to the HUD root at
 * `--aek-z-tooltip` (a dialog's centring transform would make a fixed element inside it relative
 * to the dialog), with the theme and density of its old place, and its position is the HUD's
 * bounds'. Either way it gets `position: fixed`, its place and max size as inline styles, and
 * `data-side` (the side it took).
 * @internal
 * @returns what stops the tracking and takes it out of the top layer; removing the element is the
 * caller's
 */
export const showAnchored = ({
  elem,
  anchor,
  side = 'bottom',
  align = 'start',
  gap = 4,
  matchAnchorWidth,
}: ShowAnchoredProps) => {
  const isTopLayer = hasTopLayer();
  if (isTopLayer) {
    elem.setAttribute('popover', 'manual');
    elem.showPopover();
  } else if (hasHudRoot()) {
    copyInheritedAttr(elem, anchor, 'data-aek-theme');
    copyInheritedAttr(elem, anchor, 'data-aek-density');
    elem.style.zIndex = 'var(--aek-z-tooltip)';
    getHUDRootCMP().elem.appendChild(elem);
  }
  elem.style.position = 'fixed';

  /** What the last `place()` read (the anchor's box, the bounds', the overlay's size): it writes
   * nothing when none of it changed (a scroll elsewhere on the page) */
  const lastInputs = new Float64Array(10).fill(NaN);
  let hasInputChanged = false;
  const trackInput = (index: number, value: number) => {
    if (lastInputs[index] === value) return;
    lastInputs[index] = value;
    hasInputChanged = true;
  };

  const place = () => {
    const anchorRect = anchor.getBoundingClientRect();
    const bounds = getWindowSize();
    // The content's height even while a max height clips it. The width is the rendered one, under
    // the last max width: after the space grows, a centre or end alignment uses the old width until
    // the next place (measuring the natural width would take a write before the reads)
    const width = elem.offsetWidth;
    const height = elem.scrollHeight + elem.offsetHeight - elem.clientHeight;
    hasInputChanged = false;
    trackInput(0, anchorRect.left);
    trackInput(1, anchorRect.top);
    trackInput(2, anchorRect.width);
    trackInput(3, anchorRect.height);
    trackInput(4, bounds.left);
    trackInput(5, bounds.top);
    trackInput(6, bounds.width);
    trackInput(7, bounds.height);
    trackInput(8, width);
    trackInput(9, height);
    if (!hasInputChanged) return;
    const placement = computeAnchorPlacement({
      anchor: anchorRect,
      size: { width, height },
      bounds,
      side,
      align,
      gap,
    });
    // The top layer's position is the viewport's, the HUD root's the bounds'
    const offsetX = isTopLayer ? 0 : bounds.left;
    const offsetY = isTopLayer ? 0 : bounds.top;
    const style = elem.style;
    style.left = `${placement.x - offsetX}px`;
    style.top = `${placement.y - offsetY}px`;
    style.maxWidth = `${placement.maxWidth}px`;
    style.maxHeight = `${placement.maxHeight}px`;
    if (matchAnchorWidth) style.minWidth = `${Math.min(anchorRect.width, placement.maxWidth)}px`;
    if (elem.getAttribute(SIDE_ATTR) !== placement.side)
      elem.setAttribute(SIDE_ATTR, placement.side);
  };

  let frame = 0;
  const onFrame = () => {
    frame = 0;
    if (elem.isConnected && anchor.isConnected) place();
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(onFrame);
  };
  // Not the overlay's own scroll (a long list): that moves nothing
  const onScroll = (e: Event) => {
    if (!elem.contains(e.target as Node)) schedule();
  };
  if (matchAnchorWidth) elem.style.minWidth = `${anchor.getBoundingClientRect().width}px`;
  place();
  document.addEventListener('scroll', onScroll, { capture: true, passive: true });
  window.addEventListener('resize', schedule);
  const removeBoundsListener = onBoundsResize(schedule);

  return () => {
    document.removeEventListener('scroll', onScroll, { capture: true });
    window.removeEventListener('resize', schedule);
    removeBoundsListener();
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    // A no-op on a hidden popover; a removed element is out of the top layer already
    if (isTopLayer && elem.isConnected) elem.hidePopover();
  };
};
