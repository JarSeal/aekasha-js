// The draggable windows' pointer drags: a move by the header, a resize by an edge or the corner.
// One session per window, applied at most once per animation frame, committed at its end through
// the caller's `onCommit` (DraggableWindow.ts records and saves the geometry).
import {
  clampToGrabbable,
  getGrabArea,
  RESIZING_ATTR,
  writePosition,
} from './DraggableWindowGeometry';
import type { DragMode, WindowEntry } from './DraggableWindowTypes';
import { getWindowSize } from '../../core/Window';

/**
 * Runs at the end of a drag that changed the window's geometry: DraggableWindow.ts' record and
 * save.
 * @internal
 */
export type DragCommit = (entry: WindowEntry) => void;

const startDragSession = (entry: WindowEntry, mode: DragMode, e: PointerEvent) => {
  const { config, runtime } = entry;
  const windowElem = runtime.windowCMP?.elem;
  if (!windowElem || runtime.session || e.button !== 0 || !e.isPrimary) return;
  if (mode === 'MOVE' && (config.disableDragging || (e.target as Element).closest('button'))) {
    return;
  }

  const target = e.currentTarget as HTMLElement;
  target.setPointerCapture(e.pointerId);
  const rect = windowElem.getBoundingClientRect();
  // left / top in the HUD's bounds (a mount's container is offset in the viewport)
  const bounds = getWindowSize();
  const startGeometry = {
    x: rect.left - bounds.left,
    y: rect.top - bounds.top,
    w: rect.width,
    h: rect.height,
  };
  runtime.session = {
    mode,
    pointerId: e.pointerId,
    target,
    startPointer: { x: e.clientX, y: e.clientY },
    startGeometry,
    grabArea: mode === 'MOVE' ? getGrabArea(runtime) : null,
    pointer: { x: e.clientX, y: e.clientY },
    geometry: { ...startGeometry },
    rafId: null,
    apply: () => applyDragSession(entry),
  };
  if (mode !== 'MOVE') windowElem.setAttribute(RESIZING_ATTR, '');
};

const applyDragSession = ({ runtime }: WindowEntry) => {
  const s = runtime.session;
  const elem = runtime.windowCMP?.elem;
  if (!s || !elem) return;
  s.rafId = null;
  const dx = s.pointer.x - s.startPointer.x;
  const dy = s.pointer.y - s.startPointer.y;
  const start = s.startGeometry;
  const g = s.geometry;

  if (s.mode === 'MOVE') {
    g.x = start.x + dx;
    g.y = start.y + dy;
    if (s.grabArea) clampToGrabbable(g, s.grabArea);
    writePosition(elem, g);
    return;
  }
  // The CSS min/max size clamps what is shown, the end of the drag stores that
  if (s.mode !== 'RESIZE_V') {
    g.w = start.w + dx;
    elem.style.width = `${g.w}px`;
  }
  if (s.mode !== 'RESIZE_H') {
    g.h = start.h + dy;
    elem.style.height = `${g.h}px`;
  }
};

const onDragPointerMove = (entry: WindowEntry, e: PointerEvent) => {
  const s = entry.runtime.session;
  if (!s || e.pointerId !== s.pointerId) return;
  s.pointer.x = e.clientX;
  s.pointer.y = e.clientY;
  if (s.rafId === null) s.rafId = requestAnimationFrame(s.apply);
};

/** Ends the drag and commits the geometry to the config. */
const onDragPointerEnd = (entry: WindowEntry, e: PointerEvent, onCommit: DragCommit) => {
  const { config, runtime } = entry;
  const s = runtime.session;
  if (!s || e.pointerId !== s.pointerId) return;
  if (s.rafId !== null) {
    cancelAnimationFrame(s.rafId);
    applyDragSession(entry);
  }
  runtime.session = null;
  if (s.target.hasPointerCapture(s.pointerId)) s.target.releasePointerCapture(s.pointerId);

  const g = config.geometry;
  const { x, y } = g;
  if (s.mode === 'MOVE') {
    g.x = Math.round(s.geometry.x);
    g.y = Math.round(s.geometry.y);
  } else {
    runtime.windowCMP?.elem.removeAttribute(RESIZING_ATTR);
    const elem = runtime.windowCMP?.elem;
    if (elem) {
      // A resized axis is stored in px from now on, whatever unit it had
      const rect = elem.getBoundingClientRect();
      const sizeUnits = { ...config.units?.size };
      if (s.mode !== 'RESIZE_V') {
        g.w = Math.round(rect.width);
        sizeUnits.w = 'px';
        elem.style.width = `${g.w}px`;
      }
      if (s.mode !== 'RESIZE_H') {
        g.h = Math.round(rect.height);
        sizeUnits.h = 'px';
        elem.style.height = `${g.h}px`;
      }
      config.units = { ...config.units, size: sizeUnits };
    }
  }
  // A resize always saves: its units may have changed even when the numbers didn't
  if (s.mode !== 'MOVE' || g.x !== x || g.y !== y) {
    onCommit(entry);
  }
};

/**
 * Drops an unfinished drag without committing it (eg. the window closes mid drag).
 * @internal
 */
export const cancelDragSession = ({ runtime }: WindowEntry) => {
  const s = runtime.session;
  if (!s) return;
  if (s.rafId !== null) cancelAnimationFrame(s.rafId);
  runtime.session = null;
};

/**
 * Makes an element of a window a drag handle (the header moves it, the edges resize it); `onCommit` runs when a drag changed the window's geometry.
 * @internal
 */
export const addDragHandle = (
  entry: WindowEntry,
  elem: HTMLElement,
  mode: DragMode,
  onCommit: DragCommit
) => {
  const onEnd = (e: PointerEvent) => onDragPointerEnd(entry, e, onCommit);
  elem.addEventListener('pointerdown', (e) => startDragSession(entry, mode, e));
  elem.addEventListener('pointermove', (e) => onDragPointerMove(entry, e));
  elem.addEventListener('pointerup', onEnd);
  elem.addEventListener('pointercancel', onEnd);
};
