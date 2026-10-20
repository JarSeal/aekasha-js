// The draggable windows' geometry: their inline styles, the px conversion of a centred position,
// the clamps that keep a window grabbable or on screen, the fits, the cascade and the placement of
// a freshly mounted window. Reads the DOM and the viewport, holds no state.
import { getWindowSize } from './Window';
import styles from './DraggableWindow.module.scss';
import type {
  DraggableWindowConfig,
  DraggableWindowRuntime,
  DraggableWindowUnit,
  GrabArea,
  WindowEntry,
} from './DraggableWindowTypes';

/** How much of a window's title area a drag keeps horizontally on screen */
const MIN_GRAB_VISIBLE_PX = 80;
/** The gap a fit keeps from the viewport's edges */
const FIT_MARGIN_PX = 8;

const isNonPx = (unit?: DraggableWindowUnit) => Boolean(unit && unit !== 'px');

/**
 * A window with a non-px position axis is CSS-centred on that axis (a dialog): it follows a
 * viewport resize without JS, and the clamps leave it alone.
 * @internal
 */
export const isCssCentred = ({ units }: DraggableWindowConfig) =>
  isNonPx(units?.position?.x) || isNonPx(units?.position?.y);

/**
 * A non-px position is the window's centre, so it is translated by half its size.
 * @internal
 */
export const getGeometryStyle = ({
  geometry: g,
  minSize,
  maxSize,
  units,
}: DraggableWindowConfig) => {
  const isCentredX = isNonPx(units?.position?.x);
  const isCentredY = isNonPx(units?.position?.y);
  return {
    left: `${g.x}${units?.position?.x || 'px'}`,
    top: `${g.y}${units?.position?.y || 'px'}`,
    width: `${g.w}${units?.size?.w || 'px'}`,
    height: `${g.h}${units?.size?.h || 'px'}`,
    minWidth: `${minSize.w}${units?.minSize?.w || 'px'}`,
    minHeight: `${minSize.h}${units?.minSize?.h || 'px'}`,
    maxWidth: maxSize ? `${maxSize.w}${units?.maxSize?.w || 'px'}` : '100vw',
    maxHeight: maxSize ? `${maxSize.h}${units?.maxSize?.h || 'px'}` : '100vh',
    transform:
      isCentredX || isCentredY
        ? `translate3d(${isCentredX ? '-50%' : '0'}, ${isCentredY ? '-50%' : '0'}, 0)`
        : null,
  };
};

/**
 * Writes a window's px position (left / top) to its element.
 * @internal
 */
export const writePosition = (elem: HTMLElement, { x, y }: { x: number; y: number }) => {
  elem.style.left = `${x}px`;
  elem.style.top = `${y}px`;
};

/** Converts a mounted draggable window's non-px (centre) position to px left/top, where the CSS
 * centring rendered it, and drops `units.position`. */
const convertPositionToPx = ({ config, runtime }: WindowEntry) => {
  const elem = runtime.windowCMP?.elem;
  if (!elem || config.disableDragging || !isCssCentred(config)) return;
  const rect = elem.getBoundingClientRect();
  config.geometry.x = Math.round(rect.left);
  config.geometry.y = Math.round(rect.top);
  if (config.units) delete config.units.position;
  elem.style.transform = '';
  writePosition(elem, config.geometry);
};

/**
 * The part of a window's header a drag can grab (its title, without the buttons), relative to the
 * window's left edge, and the header's height: measured at a drag's start.
 * @internal
 */
export const getGrabArea = ({
  windowCMP,
  headerCMP,
  titleCMP,
}: DraggableWindowRuntime): GrabArea => {
  const windowRect = windowCMP?.elem.getBoundingClientRect();
  const titleRect = titleCMP?.elem.getBoundingClientRect();
  return {
    left: windowRect && titleRect ? titleRect.left - windowRect.left : 0,
    width: titleRect?.width || 0,
    headerH: headerCMP?.elem.getBoundingClientRect().height || 0,
  };
};

/**
 * Lets a window hang off an edge, but keeps MIN_GRAB_VISIBLE_PX of its title area horizontally
 * and its whole header vertically on screen, so it can always be grabbed.
 * @internal
 */
export const clampToGrabbable = (pos: { x: number; y: number }, area: GrabArea) => {
  const { width, height } = getWindowSize();
  const grab = Math.min(MIN_GRAB_VISIBLE_PX, area.width);
  // The min bound last: on a viewport too narrow for both, the title's start stays visible
  pos.x = Math.max(grab - area.left - area.width, Math.min(pos.x, width - grab - area.left));
  pos.y = Math.max(0, Math.min(pos.y, height - area.headerH));
};

/**
 * Moves a mounted window fully on screen, per axis: a window that fits is shifted in, a larger
 * one is aligned to the left / top edge. The size never changes. CSS-centred windows are skipped.
 * Returns whether it moved.
 * @internal
 */
export const keepOnScreen = ({ config, runtime }: WindowEntry) => {
  const elem = runtime.windowCMP?.elem;
  if (!elem || isCssCentred(config)) return false;
  const { width, height } = getWindowSize();
  const rect = elem.getBoundingClientRect();
  const g = config.geometry;
  const x = rect.width > width ? 0 : Math.max(0, Math.min(g.x, width - rect.width));
  const y = rect.height > height ? 0 : Math.max(0, Math.min(g.y, height - rect.height));
  if (x === g.x && y === g.y) return false;
  g.x = Math.round(x);
  g.y = Math.round(y);
  writePosition(elem, g);
  return true;
};

/**
 * Whether the fit actions apply to the window: an open, mounted, draggable one (never a dialog).
 * @internal
 */
export const isFittable = ({ config, runtime }: WindowEntry) =>
  config.isOpen && Boolean(runtime.windowCMP) && !config.disableDragging && !isCssCentred(config);

/** The cascade step's offset (x and y), wrapping before it passes a third of the viewport. */
const getCascadeOffset = (cascadeIndex: number, headerH: number) => {
  if (!headerH || cascadeIndex <= 0) return 0;
  const { width, height } = getWindowSize();
  const steps = Math.floor(Math.min(width, height) / 3 / headerH) + 1;
  return (cascadeIndex % steps) * headerH;
};

/**
 * Moves a fittable window to the top center (plus the cascade offset), shrinks a resizable axis
 * that overflows (the CSS min size wins), and falls back to keepOnScreen for what still overflows.
 * A collapsed window fits its expanded size. Returns whether the geometry changed.
 * @internal
 */
export const fitWindow = (entry: WindowEntry, cascadeIndex: number) => {
  const { config, runtime } = entry;
  const elem = runtime.windowCMP?.elem;
  if (!elem || !isFittable(entry)) return false;
  const { width, height } = getWindowSize();
  const offset = getCascadeOffset(cascadeIndex, runtime.headerCMP?.elem.offsetHeight || 0);
  const g = config.geometry;
  const prev = JSON.stringify([g, config.units?.size]);

  // Measured expanded and without the height transition, so the reads are the final size
  elem.classList.add(styles.resizing);
  if (config.isCollapsed) elem.classList.remove(styles.collapsed);

  let rect = elem.getBoundingClientRect();
  const sizeUnits = { ...config.units?.size };
  const maxW = width - 2 * FIT_MARGIN_PX;
  const maxH = height - 2 * FIT_MARGIN_PX - offset;
  const shrinkW = rect.width > maxW && !config.disableHoriResize;
  const shrinkH = rect.height > maxH && !config.disableVertResize;
  if (shrinkW) elem.style.width = `${Math.max(0, maxW)}px`;
  if (shrinkH) elem.style.height = `${Math.max(0, maxH)}px`;
  if (shrinkW || shrinkH) {
    rect = elem.getBoundingClientRect();
    // A shrunk axis is stored in px from now on, like a manual resize
    if (shrinkW) {
      g.w = Math.round(rect.width);
      sizeUnits.w = 'px';
      elem.style.width = `${g.w}px`;
    }
    if (shrinkH) {
      g.h = Math.round(rect.height);
      sizeUnits.h = 'px';
      elem.style.height = `${g.h}px`;
    }
    config.units = { ...config.units, size: sizeUnits };
  }

  // The right edge stays inside the margin, so a wide window gives up its x offset
  const x = Math.min((width - rect.width) / 2 + offset, width - FIT_MARGIN_PX - rect.width);
  g.x = Math.round(Math.max(FIT_MARGIN_PX, x));
  g.y = Math.round(FIT_MARGIN_PX + offset);
  writePosition(elem, g);
  keepOnScreen(entry);

  if (config.isCollapsed) {
    elem.classList.add(styles.collapsed);
    // Flushes the collapsed height before the transition comes back, so it doesn't animate
    void elem.offsetHeight;
  }
  elem.classList.remove(styles.resizing);
  return JSON.stringify([g, config.units?.size]) !== prev;
};

/**
 * Settles a freshly mounted (or reset) window's position: px for a draggable window, offset by
 * `cascadeIndex` header heights (a new window of a kind), then fully on screen.
 * @internal
 */
export const placeWindow = (entry: WindowEntry, cascadeIndex = 0) => {
  convertPositionToPx(entry);
  const elem = entry.runtime.windowCMP?.elem;
  if (elem && cascadeIndex && !isCssCentred(entry.config)) {
    const offset = getCascadeOffset(cascadeIndex, entry.runtime.headerCMP?.elem.offsetHeight || 0);
    entry.config.geometry.x += offset;
    entry.config.geometry.y += offset;
    writePosition(elem, entry.config.geometry);
  }
  keepOnScreen(entry);
};
