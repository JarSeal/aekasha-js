// The property grid (p804 D9): the label column layout the debugger's panes use. Its fields, and
// the folders' in it at any depth, line up in two columns (the label, the control) through CSS
// subgrids; the column's width is a separator the pointer drags and the arrows move. It owns a
// scheduler, or shares a host's, which the fields added without one join.
import type { CMPAttr, CMPHandle } from '../core/CMPTypes';
import { CMP, classes } from '../core/CMP';
import { createBindingScheduler, type BindingScheduler } from './binding/BindingScheduler';
import { addFormChildren, type FormChild } from './Field';
import { getStepModifier } from './NumberSteps';
import './PropertyGrid.scss';
import '../styles/kit.scss';

/** What {@link createPropertyGrid} makes a property grid from. */
export type PropertyGridProps = {
  /** Its first children, in order (`add` adds more): fields, folders, buttons, any CMP. */
  children?: readonly FormChild[];
  /** A host's scheduler, shared with its other grids (a tab's sections): its `refresh()` reads
   * them all. Default: one of its own, disposed with the grid. */
  scheduler?: BindingScheduler;
  /** Whether its own scheduler's host shows at the start (default true; `scheduler.setVisible`
   * says when it changes). Not with a shared `scheduler`. */
  visible?: boolean;
  /** The label column's width, a percent of the grid's (default 40, kept from 20 to 80). */
  labelWidth?: number;
  /** The label column's width after the user moved it (a drag's release, a key's keyup): what an
   * owner persists (a grid writes no storage). */
  onLabelWidthChange?: (width: number) => void;
  /** Shows the label column's separator, which moves it (default true). */
  resizable?: boolean;
  /** Extra classes for the grid's element. */
  class?: string | string[];
  /** Extra attributes for the grid's element. */
  attr?: CMPAttr;
  /** The separator's element id (default: a generated one). */
  id?: string;
};

/** A property grid {@link createPropertyGrid} made. */
export type PropertyGrid = {
  /** The grid's element: add it where it goes. `cmp.remove()` disposes of it, its children and
   * its own scheduler. */
  cmp: CMPHandle;
  /** The CMP its rows are in. */
  content: CMPHandle;
  /** Its scheduler (its own, or the shared one): `setVisible` it when its host shows or hides. */
  scheduler: BindingScheduler;
  /** Adds children after the ones it has; a field or folder given no scheduler joins its. */
  add: (...children: FormChild[]) => void;
  /** Reads every field of its scheduler and re-reads each `hidden` and `disabled` function (the
   * scheduler's `refresh()`); never fires `onChange`. */
  refresh: () => void;
  /** The label column's width, a percent. */
  getLabelWidth: () => number;
  /** Sets the label column's width, a percent (kept from 20 to 80); no `onLabelWidthChange`. */
  setLabelWidth: (width: number) => void;
};

const DEFAULT_LABEL_WIDTH = 40;
const MIN_LABEL_WIDTH = 20;
const MAX_LABEL_WIDTH = 80;
/** A key's step, a percent (Shift ×10, Alt ×0.1) */
const KEY_STEP = 1;
const WIDTH_PROPERTY = '--aek-property-grid-label-width';

/** In the range, to a tenth (Alt's step) */
const constrainWidth = (width: number) =>
  Math.round(Math.min(MAX_LABEL_WIDTH, Math.max(MIN_LABEL_WIDTH, width)) * 10) / 10;

/**
 * Creates a property grid (p804 D9): the debugger's label column layout. Each field in it, and in
 * its folders at any depth, is a row of two columns: its label (cut with a tooltip when long, its
 * reset button after it) and its control, the controls lined up at every depth while each
 * folder's labels step in. A button or any other child spans both. The label column's width is a
 * percent of the grid's (`labelWidth`), which its separator moves.
 * - Scheduler: its own (`scheduler`, disposed with it), or a host's shared one; a field or folder
 *   added without one joins it (`add`, `children`), and `refresh()` reads them all.
 * - Keys: on the separator, ArrowLeft / ArrowRight move the column by 1 % (Shift ×10, Alt ×0.1),
 *   Home / End to 20 % / 80 %; each keyup reports the width (`onLabelWidthChange`).
 * - Pointer: a drag on the separator moves the column; the release reports the width.
 * - Parts: `.aekPropertyGrid` (`--aek-property-grid-label-width` on it) with
 *   `.aekPropertyGrid__content` (the rows) and `.aekPropertyGrid__separator` (`data-dragging`).
 * - Custom properties: `--aek-property-grid-label-width` (a percent, set by `labelWidth`),
 *   `--aek-property-grid-row-gap` (default `--aek-space-2`).
 * - ARIA: the separator is a focusable `separator` ("Label column", `aria-orientation="vertical"`,
 *   `aria-valuenow` the percent, `aria-valuemin` 20, `aria-valuemax` 80, `aria-controls` the
 *   content), a 24 px wide target: the columns' gap, so it covers no control.
 * @example
 * ```ts
 * const grid = createPropertyGrid({
 *   labelWidth: settings.labelWidth,
 *   onLabelWidthChange: (width) => saveSetting('labelWidth', width),
 *   children: [
 *     createSlider({ label: 'Speed', target: spinner, key: 'speed', min: 0, max: 10 }),
 *     createCheckbox({ label: 'Wireframe', target: material, key: 'wireframe' }),
 *     createMonitor({ label: 'Frame time', get: () => stats.frameMs, unit: 'ms' }),
 *   ],
 * });
 * settingsWindow.add(grid.cmp);
 * // The host's refresh, eg. on a timer while it shows: never fires onChange
 * grid.refresh();
 * ```
 */
export const createPropertyGrid = (props: PropertyGridProps = {}): PropertyGrid => {
  const isOwnScheduler = !props.scheduler;
  const scheduler = props.scheduler ?? createBindingScheduler({ visible: props.visible });
  let labelWidth = constrainWidth(props.labelWidth ?? DEFAULT_LABEL_WIDTH);
  let drag: { pointerId: number } | null = null;
  /** The key whose keyup reports the width */
  let stepKey: string | null = null;

  const cmp = CMP({
    class: classes('aekPropertyGrid', props.class),
    attr: props.attr,
    onRemoveCmp: () => {
      if (separator) {
        for (const [type, fn] of listeners)
          separator.removeEventListener(type, fn as EventListener);
      }
      if (isOwnScheduler) scheduler.dispose();
    },
  });
  const root = cmp.elem;
  const content = cmp.add({ class: 'aekPropertyGrid__content' });
  content.elem.id = `${cmp.id}__content`;

  const drawWidth = () => {
    root.style.setProperty(WIDTH_PROPERTY, `${labelWidth}%`);
    if (!separator) return;
    separator.setAttribute('aria-valuenow', String(labelWidth));
    separator.setAttribute('aria-valuetext', `${labelWidth} %`);
  };

  const separator = props.resizable === false ? null : document.createElement('div');

  const moveTo = (width: number) => {
    labelWidth = constrainWidth(width);
    drawWidth();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    let width: number | null = null;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      const step = KEY_STEP * getStepModifier(e);
      width = labelWidth + (e.key === 'ArrowLeft' ? -step : step);
    } else if (e.key === 'Home') {
      width = MIN_LABEL_WIDTH;
    } else if (e.key === 'End') {
      width = MAX_LABEL_WIDTH;
    }
    if (width === null) return;
    e.preventDefault();
    e.stopPropagation();
    stepKey = e.key;
    moveTo(width);
  };

  const onKeyUp = (e: KeyboardEvent) => {
    if (e.key !== stepKey) return;
    e.stopPropagation();
    stepKey = null;
    props.onLabelWidthChange?.(labelWidth);
  };

  /** The pointer's x as a percent of the grid's width */
  const getWidthAt = (clientX: number) => {
    const rect = root.getBoundingClientRect();
    return rect.width > 0 ? ((clientX - rect.left) / rect.width) * 100 : labelWidth;
  };

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0 || !separator) return;
    // No text selection; the focus stays where it was
    e.preventDefault();
    separator.setPointerCapture?.(e.pointerId);
    separator.setAttribute('data-dragging', '');
    drag = { pointerId: e.pointerId };
  };

  const onPointerMove = (e: PointerEvent) => {
    if (drag?.pointerId === e.pointerId) moveTo(getWidthAt(e.clientX));
  };

  const onPointerEnd = (e: PointerEvent) => {
    if (drag?.pointerId !== e.pointerId || !separator) return;
    drag = null;
    separator.removeAttribute('data-dragging');
    props.onLabelWidthChange?.(labelWidth);
  };

  const listeners: [string, (e: never) => void][] = [
    ['keydown', onKeyDown],
    ['keyup', onKeyUp],
    ['pointerdown', onPointerDown],
    ['pointermove', onPointerMove],
    ['pointerup', onPointerEnd],
    ['pointercancel', onPointerEnd],
    ['lostpointercapture', onPointerEnd],
  ];

  if (separator) {
    separator.className = 'aekPropertyGrid__separator';
    separator.id = props.id ?? `${cmp.id}__separator`;
    for (const [name, value] of [
      ['role', 'separator'],
      ['tabindex', '0'],
      ['aria-orientation', 'vertical'],
      ['aria-label', 'Label column'],
      ['aria-controls', content.elem.id],
      ['aria-valuemin', String(MIN_LABEL_WIDTH)],
      ['aria-valuemax', String(MAX_LABEL_WIDTH)],
    ]) {
      separator.setAttribute(name, value);
    }
    for (const [type, fn] of listeners) separator.addEventListener(type, fn as EventListener);
    root.append(separator);
  }
  drawWidth();

  const add = (children: readonly FormChild[]) => addFormChildren(content, children, scheduler);
  if (props.children) add(props.children);

  return {
    cmp,
    content,
    scheduler,
    add: (...children) => add(children),
    refresh: () => scheduler.refresh(),
    getLabelWidth: () => labelWidth,
    setLabelWidth: moveTo,
  };
};
