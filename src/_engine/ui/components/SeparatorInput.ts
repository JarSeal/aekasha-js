// A focusable separator's input (p805 D10, the APG window splitter's keys and a drag): the
// splitter's and the property grid's label column's. It moves a value its owner draws (the owner
// writes the ARIA and the layout) and reports a finished move. No styles, so the property grid
// carries none of the splitter's.
import { createPointerDrag } from '../forms/PointerDrag';

/**
 * What `createSeparatorInput` moves.
 * @internal
 */
export type SeparatorInputProps = {
  /** Which arrows move it: Left / Right ('x', a vertical line between side-by-side panes) or Up /
   * Down ('y') */
  axis: 'x' | 'y';
  /** An arrow's step (Shift ×10, Alt ×0.1) */
  step: number;
  /** The value now */
  get: () => number;
  /** Where Home goes */
  getMin: () => number;
  /** Where End goes */
  getMax: () => number;
  /** Writes a value a key or the pointer moved to (the owner keeps it in its range and draws it) */
  set: (value: number) => void;
  /** The value at the pointer, during a drag */
  getValueAt: (e: PointerEvent) => number;
  /** A press starting a drag (before its first move), eg. to keep the grab's offset */
  onPress?: (e: PointerEvent) => void;
  /** A move finished: an arrow's or Home's / End's keyup, a drag's end */
  onCommit: () => void;
  /** Enter (the splitter's collapse and restore); without it Enter isn't a key of the separator */
  onEnter?: () => void;
};

/**
 * Adds a separator's keys and drag to its element: the arrows along `axis` by `step` (Shift ×10,
 * Alt ×0.1), Home and End to the ends, Enter to `onEnter`; a pointer drag through
 * `createPointerDrag` (`data-dragging`). A used key is stopped, its keyup too (which reports the
 * move).
 * @internal
 * @returns `dispose()`, which removes its listeners and releases a held drag without a report
 */
export const createSeparatorInput = (elem: HTMLElement, props: SeparatorInputProps) => {
  const [back, forward] =
    props.axis === 'x' ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown'];
  /** The key whose keyup reports the move */
  let stepKey: string | null = null;

  const onKeyDown = (e: KeyboardEvent) => {
    let value: number | null = null;
    if (e.key === back || e.key === forward) {
      const step = props.step * (e.shiftKey ? 10 : e.altKey ? 0.1 : 1);
      value = props.get() + (e.key === back ? -step : step);
    } else if (e.key === 'Home') {
      value = props.getMin();
    } else if (e.key === 'End') {
      value = props.getMax();
    } else if (e.key === 'Enter' && props.onEnter) {
      e.preventDefault();
      e.stopPropagation();
      stepKey = 'Enter';
      if (!e.repeat) props.onEnter();
      return;
    }
    if (value === null) return;
    e.preventDefault();
    e.stopPropagation();
    stepKey = e.key;
    props.set(value);
  };

  const onKeyUp = (e: KeyboardEvent) => {
    if (e.key !== stepKey) return;
    e.stopPropagation();
    stepKey = null;
    // Enter reported its own change
    if (e.key !== 'Enter') props.onCommit();
  };

  const drag = createPointerDrag(elem, {
    canPress: () => true,
    onPress: (e) => props.onPress?.(e),
    onMove: (e) => props.set(props.getValueAt(e)),
    onEnd: props.onCommit,
  });

  elem.addEventListener('keydown', onKeyDown);
  elem.addEventListener('keyup', onKeyUp);

  return {
    dispose: () => {
      drag.dispose();
      elem.removeEventListener('keydown', onKeyDown);
      elem.removeEventListener('keyup', onKeyUp);
    },
  };
};
