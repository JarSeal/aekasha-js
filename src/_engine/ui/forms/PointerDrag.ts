// A pointer drag on a control (p804 D7, D8): the press's capture, each move, and the end however
// it comes. The slider's and the range slider's tracks, the angle dial and the 2D pad. No styles of
// its own, so a field that drags brings none of another's.

/**
 * What a pointer drag calls.
 * @internal
 */
export type PointerDragHandlers = {
  /** Whether a primary press may start a drag (not while disabled) */
  canPress: () => boolean;
  /** The press: the pointer is captured and `data-dragging` set */
  onPress: (e: PointerEvent) => void;
  /** Each move of the pressed pointer */
  onMove: (e: PointerEvent) => void;
  /** The drag's end: the release, a `pointercancel`, a lost capture or `end()` */
  onEnd: () => void;
};

/**
 * A drag on an element: a primary press (`preventDefault`: no text selection, and the focus stays
 * unless the handler moves it) captures the pointer and sets `data-dragging` until the release, a
 * `pointercancel` or a lost capture. `dispose()` releases the capture without `onEnd`.
 * @internal
 */
export const createPointerDrag = (elem: HTMLElement, handlers: PointerDragHandlers) => {
  let pointerId: number | null = null;

  const end = () => {
    if (pointerId === null) return;
    pointerId = null;
    elem.removeAttribute('data-dragging');
    handlers.onEnd();
  };

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0 || pointerId !== null || !handlers.canPress()) return;
    e.preventDefault();
    pointerId = e.pointerId;
    elem.setPointerCapture?.(e.pointerId);
    elem.setAttribute('data-dragging', '');
    handlers.onPress(e);
  };

  const onPointerMove = (e: PointerEvent) => {
    if (pointerId === null || e.pointerId !== pointerId) return;
    handlers.onMove(e);
  };

  const listeners: [string, (e: never) => void][] = [
    ['pointerdown', onPointerDown],
    ['pointermove', onPointerMove],
    ['pointerup', end],
    ['pointercancel', end],
    ['lostpointercapture', end],
  ];
  for (const [type, fn] of listeners) elem.addEventListener(type, fn as EventListener);

  return {
    end,
    isDragging: () => pointerId !== null,
    dispose: () => {
      // Cleared first: the release's lostpointercapture would end the drag
      const held = pointerId;
      pointerId = null;
      if (held !== null && elem.hasPointerCapture?.(held)) elem.releasePointerCapture(held);
      for (const [type, fn] of listeners) elem.removeEventListener(type, fn as EventListener);
    },
  };
};

/**
 * A drag `createPointerDrag` made.
 * @internal
 */
export type PointerDrag = ReturnType<typeof createPointerDrag>;
