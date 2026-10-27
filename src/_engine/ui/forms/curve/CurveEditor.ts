// The curve editor (p804 D8): an SVG plot of a curve with a handle per point, each an APG slider
// moved in two directions, and the selected point's numbers (x, y and, for keys, its tangents) in
// a row under it. An easing's two control points (CSS's `cubic-bezier()`), or keys with tangents:
// the value's shape says which. Keys keep their order in the array, as the gradient's stops do.
// The geometry (paths, the keys' order and tangents) is CurvePlot.ts'. `createCurveEditor` is one
// closure past 150 lines, as the other fields: its parts share the selection, the drag and the
// kept scratch value, and split into modules they'd pass all of it around.
import { createButton } from '../../components/Button';
import { createMenu } from '../../overlays/Menu';
import { createObjectValueKind, type BindingValueKind } from '../binding/Binding';
import type { NumberRules } from '../binding/ValueText';
import { createField, type Field, type FieldProps } from '../Field';
import { buildMonitor, readFirstValue } from '../Monitor';
import { createNumberInput, type NumberTarget } from '../NumberInput';
import { getStepModifier, listenStepKeys } from '../NumberSteps';
import { createPointerDrag, type PointerDrag } from '../PointerDrag';
import {
  CURVE_PRESET_NAMES,
  evaluateCurve,
  findCurveSegment,
  getCurvePreset,
  isBezierCurve,
  type CurveBezier,
  type CurveKey,
  type CurvePresetName,
  type CurveValue,
} from './Curve';
import { CURVE_KEYS_KIND, createCurvePlot, type TangentPlace } from './CurvePlot';
import './CurveEditor.scss';
import '../../styles/kit.scss';

/**
 * What {@link createCurveEditor} makes a curve editor from.
 * @template T the value: an easing's four numbers or keys
 */
export type CurveEditorProps<T extends CurveValue = CurveValue> = FieldProps<T> & {
  /** Each axis' range and step: the plot spans them (default 0 to 1 by 0.01). An easing's x is
   * always 0-1 (CSS's); its y range is where its handles may go (`{ y: { min: -0.5, max: 1.5 } }`
   * for an overshoot). */
  axes?: Partial<Record<'x' | 'y', NumberRules>>;
  /** Keys: the fewest (default 2). */
  minKeys?: number;
  /** Keys: the most (default 32). */
  maxKeys?: number;
  /** The presets menu: `false` hides it, a list offers those (default every preset). */
  presets?: boolean | readonly CurvePresetName[];
};

/**
 * A curve editor {@link createCurveEditor} made: the field's handle.
 * @template T the value
 */
export type CurveEditor<T extends CurveValue = CurveValue> = Field<T>;

type NumberInput = ReturnType<typeof createNumberInput>;

const PRESET_LABELS: Readonly<Record<CurvePresetName, string>> = {
  linear: 'Linear',
  easeIn: 'Ease in',
  easeOut: 'Ease out',
  easeInOut: 'Ease in-out',
  smoothstep: 'Smoothstep',
};
const ADD_ICON =
  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M8 3v10M3 8h10"/></svg>';
const REMOVE_ICON =
  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M3 8h10"/></svg>';
const SVG_NS = 'http://www.w3.org/2000/svg';
const DEFAULT_RULES: NumberRules = { min: 0, max: 1, step: 0.01 };
/** A tangent dragged past its key's x stays this close on its own side (a steep slope) */
const TANGENT_MIN_DX = 0.001;
/** The arrows: the axis each moves (0 x, 1 y) and which way */
const POINT_KEYS: Readonly<Record<string, readonly [axis: 0 | 1, sign: number]>> = {
  ArrowLeft: [0, -1],
  ArrowRight: [0, 1],
  ArrowUp: [1, 1],
  ArrowDown: [1, -1],
};

const span = (className: string) => {
  const elem = document.createElement('span');
  elem.className = className;
  return elem;
};
const clamp01 = (value: number) => (value > 0 ? (value < 1 ? value : 1) : 0);

/** An axis' rules: its own over the default range */
const getAxisRules = (own: NumberRules | undefined): NumberRules => ({ ...DEFAULT_RULES, ...own });

/**
 * Creates a curve editor (p804 D8): a plot of a curve with a handle per point and the selected
 * point's numbers under it, from its binding (`{ target, key }`, `{ get, set }` or `{ value }`),
 * written in place (the array and its keys stay the instances). The value's shape at creation is
 * its mode: four numbers are an easing as CSS's `cubic-bezier(x1, y1, x2, y2)` (two control
 * points; the ends fixed at (0, 0) and (1, 1)), an array of `{ x, y, inTangent?, outTangent? }` is
 * keys joined by cubic Hermite segments (a falloff, an animation curve). {@link evaluateCurve}
 * reads it, {@link getCurvePreset} makes the presets the menu offers.
 * - Pointer: a press on a point selects it and drags it (`last: false` per move, `last: true` on
 *   the release). Keys: a press elsewhere on the plot adds a key there and drags it; the selected
 *   key's tangent handles drag its slopes. An easing: a press elsewhere moves the nearer handle
 *   there. Alt drags on a tenth of the steps.
 * - Keys on a point (each a tab stop, in the array's order): ArrowLeft / ArrowRight move it along
 *   x and ArrowUp / ArrowDown along y by the axis' step (Shift ×10, Alt ×0.1), each keyup
 *   `last: true`. On a key, Delete or Backspace removes it (not below `minKeys`), Insert or `+`
 *   adds one after it, halfway to the next along x, on the curve (not past `maxKeys`). Focusing
 *   a point selects it.
 * - The row under the plot: the selected point's X and Y (spin buttons: typed expressions, the
 *   number keys), for a key its In and Out tangents (a missing one shown as its straight slope;
 *   a write sets it), "Add key" and "Remove key", and the "Presets" menu button.
 * - Parts: `.aekField` (`data-kind="curve"`) with the shell's parts, its `.aekField__control`
 *   holding `.aekCurveEditor` (the group, `data-mode` `bezier` or `keys`) with
 *   `.aekCurveEditor__plot` (`data-dragging`, `data-flash`) holding `.aekCurveEditor__area`: the
 *   grid, `.aekCurveEditor__svg` (`__arms` and `__curve` paths), `.aekCurveEditor__tangent`
 *   (`data-side` `in` / `out`) and a `.aekCurveEditor__point` per point (`data-selected`); and
 *   `.aekCurveEditor__row` (`.aekCurveEditor__pair`s of `.aekCurveEditor__part`s, `.aekCurveEditor__add`,
 *   `.aekCurveEditor__remove`, `.aekCurveEditor__presets`).
 * - Custom properties: `--aek-curve-editor-height` (default `--aek-space-7` × 5),
 *   `--aek-curve-editor-curve-color`, `--aek-curve-editor-grid-color` and the fields'
 *   `--aek-field-*`.
 * - ARIA: the editor is a group named by the label; each point a `role="slider"` named "Handle
 *   {n}" or "Key {n}", its value the y (`aria-valuetext` "X 0.25, Y 0.50"); the plot's curve and
 *   the tangent handles are `aria-hidden` (the row's numbers are their keyboard path). While
 *   disabled the points are `aria-disabled` and out of the tab order.
 * - Motion: a change from outside flashes the plot.
 * - `readonly`: a monitor of the curve (`cubic-bezier(0.42, 0.00, 0.58, 1.00)`, or the keys'
 *   `(0.00, 0.00), (1.00, 1.00)`).
 * @template T the value
 * @example
 * ```ts
 * const falloff = createCurveEditor({
 *   label: 'Falloff',
 *   target: lightSettings,
 *   key: 'falloff',
 *   axes: { x: { min: 0, max: 20, step: 0.1 } },
 *   onChange: (curve, { last }) => {
 *     if (last) saveSettings();
 *   },
 * });
 * settingsPanel.add(falloff.cmp);
 * ```
 */
export const createCurveEditor = <T extends CurveValue>(
  props: CurveEditorProps<T>
): CurveEditor<T> => {
  const first = readFirstValue<T>(props);
  const isBezier = Array.isArray(first) && isBezierCurve(first);
  const valueKind = (isBezier
    ? createObjectValueKind(['0', '1', '2', '3'], () => [])
    : CURVE_KEYS_KIND) as unknown as BindingValueKind<T>;
  const xRules: NumberRules = isBezier
    ? { ...getAxisRules(props.axes?.x), min: 0, max: 1 }
    : getAxisRules(props.axes?.x);
  const yRules = getAxisRules(props.axes?.y);
  const noun = isBezier ? 'Handle' : 'Key';
  const xSpin = createNumberInput({ ...xRules, ariaLabel: `${noun} X` });
  const ySpin = createNumberInput({ ...yRules, ariaLabel: `${noun} Y` });
  const pointText = (x: number, y: number) =>
    `${xSpin.formatter.getText(x)}, ${ySpin.formatter.getText(y)}`;

  if (props.readonly) {
    xSpin.dispose();
    ySpin.dispose();
    return buildMonitor(props, {
      valueKind,
      getText: (value) =>
        isBezierCurve(value)
          ? `cubic-bezier(${pointText(value[0], value[1])}, ${pointText(value[2], value[3])})`
          : (value as CurveKey[]).map((key) => `(${pointText(key.x, key.y)})`).join(', '),
    }).shell.field;
  }

  const plotGeometry = createCurvePlot(xRules, yRules);
  const { xSize, ySize, toFx, toFy } = plotGeometry;
  const xMin = xRules.min!;
  const yMin = yRules.min!;
  const minKeys = Math.max(1, props.minKeys ?? 2);
  const maxKeys = Math.max(minKeys, props.maxKeys ?? 32);
  const presetNames =
    props.presets === false
      ? []
      : Array.isArray(props.presets)
        ? (props.presets as readonly CurvePresetName[])
        : CURVE_PRESET_NAMES;

  /** The selected point's index */
  let selected = 0;
  let isDisabled = false;
  let drag: PointerDrag | null = null;
  /** What the drag moves: a point (`dragIndex`), a tangent of the selected key, or nothing */
  let dragKind: 'point' | 'in' | 'out' | null = null;
  let dragIndex = -1;
  /** The plot's box, read once at the press; the grab's offset from a point's centre */
  let areaRect: DOMRect | null = null;
  let grabX = 0;
  let grabY = 0;
  /** The value a write is made in: kept, as the binding copies what it's given */
  let scratch: T | undefined;
  let shownCurve: string | null = null;
  let shownArms: string | null = null;

  // --- The plot ---
  const root = span('aekCurveEditor');
  root.setAttribute('data-mode', isBezier ? 'bezier' : 'keys');
  const plot = span('aekCurveEditor__plot');
  const area = span('aekCurveEditor__area');
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'aekCurveEditor__svg');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-hidden', 'true');
  const makePath = (className: string) => {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('class', className);
    path.setAttribute('vector-effect', 'non-scaling-stroke');
    svg.append(path);
    return path;
  };
  const arms = makePath('aekCurveEditor__arms');
  const curvePath = makePath('aekCurveEditor__curve');
  /** A tangent handle of the selected key, its place written on a change */
  const makeTangent = (side: 'in' | 'out') => {
    const elem = span('aekCurveEditor__tangent');
    elem.setAttribute('data-side', side);
    elem.setAttribute('aria-hidden', 'true');
    elem.setAttribute('hidden', '');
    return { elem, shown: false, left: NaN, top: NaN };
  };
  const tangents = { in: makeTangent('in'), out: makeTangent('out') };
  const tangentPlace: TangentPlace = { left: 0, top: 0 };
  const lane = span('aekCurveEditor__points');
  area.append(svg, tangents.in.elem, tangents.out.elem, lane);
  plot.append(area);

  // --- The row ---
  const row = span('aekCurveEditor__row');
  /** A pair of parts (X and Y, In and Out): the row wraps between pairs, not inside one */
  const makePair = () => {
    const pair = span('aekCurveEditor__pair');
    row.append(pair);
    return pair;
  };
  const makePart = (pair: HTMLElement, text: string, box: HTMLElement) => {
    const part = span('aekCurveEditor__part');
    const name = span('aekCurveEditor__partLabel');
    name.setAttribute('aria-hidden', 'true');
    name.textContent = text;
    part.append(name, box);
    pair.append(part);
  };
  const pointPair = makePair();
  makePart(pointPair, 'X', xSpin.box);
  makePart(pointPair, 'Y', ySpin.box);
  // A tangent is a slope: any value, by a hundredth
  const inSpin = isBezier ? null : createNumberInput({ step: 0.01, ariaLabel: 'In tangent' });
  const outSpin = isBezier ? null : createNumberInput({ step: 0.01, ariaLabel: 'Out tangent' });
  if (inSpin && outSpin) {
    const tangentPair = makePair();
    makePart(tangentPair, 'In', inSpin.box);
    makePart(tangentPair, 'Out', outSpin.box);
  }
  const spins = [xSpin, ySpin, inSpin, outSpin].filter(
    (spin): spin is NumberInput => spin !== null
  );
  const makeIconButton = (label: string, icon: string, className: string, onClick: () => void) =>
    createButton({
      label,
      variant: 'ghost',
      size: 'sm',
      icon,
      iconOnly: true,
      class: className,
      onClick,
    });
  const addButton = isBezier
    ? null
    : makeIconButton('Add key', ADD_ICON, 'aekCurveEditor__add', () => insertAfter(selected));
  const removeButton = isBezier
    ? null
    : makeIconButton('Remove key', REMOVE_ICON, 'aekCurveEditor__remove', () =>
        removeKey(selected)
      );
  const presetsButton =
    presetNames.length > 0
      ? createButton({ label: 'Presets', size: 'sm', class: 'aekCurveEditor__presets' })
      : null;
  for (const button of [addButton, removeButton, presetsButton]) {
    if (button) row.append(button.cmp.elem);
  }
  root.append(plot, row);

  // --- Reading the value ---
  const keysOf = (value: T) => value as unknown as CurveKey[];
  const getCount = (value: T) => (isBezier ? 2 : keysOf(value).length);
  const getX = (value: T, index: number) =>
    isBezier ? (value as unknown as CurveBezier)[index * 2] : keysOf(value)[index].x;
  const getY = (value: T, index: number) =>
    isBezier ? (value as unknown as CurveBezier)[index * 2 + 1] : keysOf(value)[index].y;

  // --- The points ---
  type Handle = {
    elem: HTMLElement;
    left: number;
    top: number;
    x: number;
    y: number;
    selected: boolean;
    dispose: () => void;
  };
  const handles: Handle[] = [];

  /** A point's handle: made and removed at the end of the list, so its index is fixed */
  const createHandle = () => {
    const index = handles.length;
    const elem = span('aekCurveEditor__point');
    elem.setAttribute('role', 'slider');
    elem.setAttribute('aria-label', `${noun} ${index + 1}`);
    elem.setAttribute('aria-valuemin', String(yRules.min));
    elem.setAttribute('aria-valuemax', String(yRules.max));
    if (isDisabled) elem.setAttribute('aria-disabled', 'true');
    else elem.setAttribute('tabindex', '0');
    const keys = listenStepKeys(elem, {
      getStep: (e) => {
        const move = POINT_KEYS[e.key];
        if (!move) return null;
        const [axis, sign] = move;
        const modifier = getStepModifier(e);
        return () => {
          const value = binding.peek();
          const x = getX(value, index);
          const y = getY(value, index);
          if (axis === 0) {
            const to = xSpin.steps.constrain(x + sign * xRules.step! * modifier, modifier);
            binding.step(withPoint(index, to, y));
          } else {
            const to = ySpin.steps.constrain(y + sign * yRules.step! * modifier, modifier);
            binding.step(withPoint(index, x, to));
          }
        };
      },
      commit: () => binding.commit(),
      // The first draw makes the handles while the shell is made
      isDisabled: () => isDisabled,
    });
    const onKeyDown = (e: KeyboardEvent) => {
      if (isBezier || e.ctrlKey || e.metaKey || e.altKey || isDisabled) return;
      if (e.key === 'Delete' || e.key === 'Backspace') removeKey(index);
      else if (e.key === 'Insert' || e.key === '+') insertAfter(index);
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    const onFocus = () => select(index);
    elem.addEventListener('keydown', onKeyDown);
    elem.addEventListener('focus', onFocus);
    lane.append(elem);
    handles.push({
      elem,
      left: NaN,
      top: NaN,
      x: NaN,
      y: NaN,
      selected: false,
      dispose: () => {
        keys.dispose();
        elem.removeEventListener('keydown', onKeyDown);
        elem.removeEventListener('focus', onFocus);
        elem.remove();
      },
    });
  };

  // --- Drawing ---
  /** A tangent handle shown or not and placed; returns its arm's path */
  const drawTangent = (side: 'in' | 'out', key: CurveKey | null, slope: number) => {
    const tangent = tangents[side];
    const show = key !== null;
    if (show !== tangent.shown) {
      tangent.shown = show;
      tangent.elem.toggleAttribute('hidden', !show);
    }
    if (!key) return '';
    const arm = plotGeometry.placeTangent(
      key.x,
      key.y,
      slope,
      side === 'in' ? -1 : 1,
      tangentPlace
    );
    if (tangentPlace.left !== tangent.left) {
      tangent.left = tangentPlace.left;
      tangent.elem.style.left = `${tangent.left}%`;
    }
    if (tangentPlace.top !== tangent.top) {
      tangent.top = tangentPlace.top;
      tangent.elem.style.top = `${tangent.top}%`;
    }
    return arm;
  };

  /** An easing's arms, or the selected key's tangent handles and arms: a tangent acts only
   * towards a key, so the first key's in and the last's out have none */
  const drawArms = (value: T) => {
    if (isBezier) return plotGeometry.getBezierArms(value as unknown as CurveBezier);
    const keys = keysOf(value);
    const key = keys[selected] ?? null;
    if (!key) return drawTangent('in', null, 0) + drawTangent('out', null, 0);
    const [before, after] = plotGeometry.findNeighbours(selected);
    const hasBefore = before >= 0;
    const hasAfter = after >= 0;
    return (
      drawTangent(
        'in',
        hasBefore ? key : null,
        hasBefore ? plotGeometry.getInTangent(keys, selected) : 0
      ) +
      drawTangent(
        'out',
        hasAfter ? key : null,
        hasAfter ? plotGeometry.getOutTangent(keys, selected) : 0
      )
    );
  };

  let shownAdd: boolean | null = null;
  let shownRemove: boolean | null = null;
  /** The buttons at the keys' limits, or disabled with the field (written on a change) */
  const setButtonsDisabled = (count: number) => {
    const noAdd = isDisabled || count >= maxKeys;
    const noRemove = isDisabled || count <= minKeys;
    if (addButton && noAdd !== shownAdd) addButton.setDisabled((shownAdd = noAdd));
    if (removeButton && noRemove !== shownRemove)
      removeButton.setDisabled((shownRemove = noRemove));
  };

  /** The points, the curve, the selected point's handles and row, drawn at a value */
  const draw = (value: T) => {
    const count = getCount(value);
    while (handles.length < count) createHandle();
    while (handles.length > count) handles.pop()!.dispose();
    if (selected >= count) selected = Math.max(0, count - 1);
    if (!isBezier) plotGeometry.sortKeys(keysOf(value));
    for (let i = 0; i < count; i++) {
      const handle = handles[i];
      const x = getX(value, i);
      const y = getY(value, i);
      const isSelected = i === selected;
      if (isSelected !== handle.selected) {
        handle.selected = isSelected;
        handle.elem.toggleAttribute('data-selected', isSelected);
      }
      // Each written only on a change: a draw runs on every write of a drag
      if (x === handle.x && y === handle.y) continue;
      handle.x = x;
      handle.y = y;
      const left = plotGeometry.getLeft(x);
      const top = plotGeometry.getTop(y);
      if (left !== handle.left) {
        handle.left = left;
        handle.elem.style.left = `${left}%`;
      }
      if (top !== handle.top) {
        handle.top = top;
        handle.elem.style.top = `${top}%`;
      }
      handle.elem.setAttribute('aria-valuenow', String(y));
      handle.elem.setAttribute(
        'aria-valuetext',
        `X ${xSpin.formatter.getText(x)}, Y ${ySpin.formatter.getText(y)}`
      );
    }
    const curve = isBezier
      ? plotGeometry.getBezierPath(value as unknown as CurveBezier)
      : plotGeometry.getKeysPath(keysOf(value));
    if (curve !== shownCurve) {
      shownCurve = curve;
      curvePath.setAttribute('d', curve);
    }
    const armPath = drawArms(value);
    if (armPath !== shownArms) {
      shownArms = armPath;
      arms.setAttribute('d', armPath);
    }
    if (count > 0) {
      xSpin.draw(getX(value, selected));
      ySpin.draw(getY(value, selected));
      if (inSpin && outSpin) {
        const keys = keysOf(value);
        inSpin.draw(plotGeometry.getInTangent(keys, selected));
        outSpin.draw(plotGeometry.getOutTangent(keys, selected));
      }
    }
    setButtonsDisabled(count);
  };

  const shell = createField<T>(props, {
    kind: 'curve',
    valueKind,
    control: root,
    isGroup: true,
    labelFor: xSpin.input,
    messageFor: spins.map((spin) => spin.input),
    flashElem: plot,
    draw,
    applyDisabled: (on) => {
      isDisabled = on;
      for (const { elem } of handles) {
        // Not native controls: out of the tab order while disabled
        if (on) {
          elem.setAttribute('aria-disabled', 'true');
          elem.removeAttribute('tabindex');
        } else {
          elem.removeAttribute('aria-disabled');
          elem.setAttribute('tabindex', '0');
        }
      }
      if (on) drag?.end();
      for (const spin of spins) spin.applyDisabled(on);
      presetsButton?.setDisabled(on);
      setButtonsDisabled(handles.length);
    },
    onRemove: () => {
      drag?.dispose();
      for (const handle of handles) handle.dispose();
      for (const spin of spins) spin.dispose();
      menu?.cmp.remove();
      addButton?.cmp.remove();
      removeButton?.cmp.remove();
      presetsButton?.cmp.remove();
    },
  });
  const { binding } = shell;

  // --- Writing ---
  /** The bound value copied into the kept scratch, to be changed and written */
  const editable = () => (scratch = valueKind.copy(binding.peek(), scratch));

  /** The value with point `index` at (x, y) */
  function withPoint(index: number, x: number, y: number) {
    const next = editable();
    if (isBezier) {
      const bezier = next as unknown as CurveBezier;
      bezier[index * 2] = x;
      bezier[index * 2 + 1] = y;
    } else {
      const key = keysOf(next)[index];
      if (key) {
        key.x = x;
        key.y = y;
      }
    }
    return next;
  }

  /** The value with the selected key's in or out tangent set */
  const withTangent = (side: 'in' | 'out', slope: number) => {
    const next = editable();
    const key = keysOf(next)[selected];
    if (key) {
      if (side === 'in') key.inTangent = slope;
      else key.outTangent = slope;
    }
    return next;
  };

  /** Selects point `index`: the row shows it (typed text in the row was written by its blur) */
  function select(index: number) {
    if (index < 0 || index === selected) return;
    selected = index;
    draw(binding.peek());
  }

  const focusPoint = (index: number) => handles[index]?.elem.focus({ preventScroll: true });

  const segment: [number, number] = [-1, -1];
  /** A new key at x: on the curve unless `y` is given, its tangents the curve's slope there when
   * the segment it splits has a tangent (so a straight segment stays straight) */
  const makeKey = (keys: readonly CurveKey[], x: number, y: number | null): CurveKey => {
    const [low, high] = findCurveSegment(keys, x, segment);
    const key: CurveKey = { x, y: y ?? ySpin.steps.constrain(evaluateCurve(keys, x)) };
    const isCurved =
      (low >= 0 && keys[low].outTangent !== undefined) ||
      (high >= 0 && keys[high].inTangent !== undefined);
    if (isCurved) {
      const h = (xSize || 1) * 1e-4;
      const slope = (evaluateCurve(keys, x + h) - evaluateCurve(keys, x - h)) / (2 * h);
      key.inTangent = key.outTangent = inSpin!.steps.constrain(slope);
    }
    return key;
  };

  /** Removes key `index` (one `last: true`), selecting and focusing its place's key */
  function removeKey(index: number) {
    const keys = keysOf(binding.peek());
    if (isBezier || shell.isDisabled() || keys.length <= minKeys || !keys[index]) return;
    const hadFocus = handles[index]?.elem === document.activeElement;
    const next = editable();
    keysOf(next).splice(index, 1);
    selected = Math.min(index, keys.length - 2);
    binding.change(next);
    if (hadFocus) focusPoint(selected);
  }

  /** Adds a key after key `index` (one `last: true`): halfway along x to the next key, else to
   * the end, else back to the one before; selected, and focused when a point had the focus */
  function insertAfter(index: number) {
    const keys = keysOf(binding.peek());
    if (isBezier || shell.isDisabled() || keys.length >= maxKeys || !keys[index]) return;
    const hadFocus = handles.some((handle) => handle.elem === document.activeElement);
    plotGeometry.sortKeys(keys);
    const [before, after] = plotGeometry.findNeighbours(index);
    const from = keys[index].x;
    const xMax = xRules.max!;
    const x =
      after >= 0
        ? (from + keys[after].x) / 2
        : from < xMax
          ? (from + xMax) / 2
          : before >= 0
            ? (from + keys[before].x) / 2
            : from;
    const key = makeKey(keys, xSpin.steps.constrain(x), null);
    const next = editable();
    keysOf(next).splice(index + 1, 0, key);
    selected = index + 1;
    binding.change(next);
    if (hadFocus) focusPoint(selected);
  }

  /** A preset (one `last: true`), in the axes' ranges (keys) or as it is (an easing: CSS's 0-1) */
  const applyPreset = (name: CurvePresetName) => {
    if (shell.isDisabled()) return;
    const preset = getCurvePreset(name, isBezier ? 'bezier' : 'keys');
    if (!isBezier) {
      const scale = xSize > 0 ? ySize / xSize : 1;
      for (const key of preset as CurveKey[]) {
        key.x = xMin + key.x * xSize;
        key.y = yMin + key.y * ySize;
        if (key.inTangent !== undefined) key.inTangent *= scale;
        if (key.outTangent !== undefined) key.outTangent *= scale;
      }
    }
    selected = 0;
    binding.change(valueKind.copy(preset as T, editable()));
  };
  const menu = presetsButton
    ? createMenu({
        anchor: presetsButton.cmp.elem,
        label: `${props.label} presets`,
        items: () =>
          presetNames.map((name) => {
            const count = isBezier ? 2 : getCurvePreset(name, 'keys').length;
            return {
              label: PRESET_LABELS[name],
              disabled: count < minKeys || count > maxKeys,
              onSelect: () => applyPreset(name),
            };
          }),
      })
    : null;

  // --- The row's targets ---
  const pointTarget = (axis: 0 | 1): NumberTarget => {
    const write = (n: number) => {
      const value = binding.peek();
      return axis === 0
        ? withPoint(selected, n, getY(value, selected))
        : withPoint(selected, getX(value, selected), n);
    };
    return {
      peek: () => {
        const value = binding.peek();
        if (getCount(value) === 0) return 0;
        return axis === 0 ? getX(value, selected) : getY(value, selected);
      },
      step: (n) => binding.step(write(n)),
      commit: () => binding.commit(),
      change: (n) => binding.change(write(n)),
      isInGesture: () => binding.isInGesture(),
    };
  };
  xSpin.attach(pointTarget(0), shell.setOwnError);
  ySpin.attach(pointTarget(1), shell.setOwnError);
  const tangentTarget = (side: 'in' | 'out'): NumberTarget => ({
    peek: () => {
      const keys = keysOf(binding.peek());
      if (!keys[selected]) return 0;
      plotGeometry.sortKeys(keys);
      return side === 'in'
        ? plotGeometry.getInTangent(keys, selected)
        : plotGeometry.getOutTangent(keys, selected);
    },
    step: (n) => binding.step(withTangent(side, n)),
    commit: () => binding.commit(),
    change: (n) => binding.change(withTangent(side, n)),
    isInGesture: () => binding.isInGesture(),
  });
  inSpin?.attach(tangentTarget('in'), shell.setOwnError);
  outSpin?.attach(tangentTarget('out'), shell.setOwnError);
  // Its first draw came before the parts were attached
  draw(binding.peek());

  // --- The drag ---
  /** The pointer as shares of the plot (from the left and the bottom), less the grab's offset */
  const shares: [fx: number, fy: number] = [0, 0];
  const getShares = (e: PointerEvent) => {
    const rect = areaRect!;
    shares[0] = rect.width > 0 ? (e.clientX - grabX - rect.left) / rect.width : 0;
    shares[1] = rect.height > 0 ? 1 - (e.clientY - grabY - rect.top) / rect.height : 0;
    return shares;
  };
  /** Point `index` moved under the pointer, clamped to the plot and constrained */
  const withPointAt = (e: PointerEvent, index: number) => {
    const [fx, fy] = getShares(e);
    const modifier = e.altKey ? 0.1 : 1;
    return withPoint(
      index,
      xSpin.steps.constrain(xMin + clamp01(fx) * xSize, modifier),
      ySpin.steps.constrain(yMin + clamp01(fy) * ySize, modifier)
    );
  };
  /** The selected key's slope towards the pointer, kept on its own side of the key */
  const withSlopeAt = (e: PointerEvent, side: 'in' | 'out') => {
    const key = keysOf(binding.peek())[selected];
    const [fx, fy] = getShares(e);
    let dx = fx - toFx(key.x);
    dx = side === 'out' ? Math.max(dx, TANGENT_MIN_DX) : Math.min(dx, -TANGENT_MIN_DX);
    const slope = ((fy - toFy(key.y)) / dx) * (xSize > 0 ? ySize / xSize : 1);
    return withTangent(side, inSpin!.steps.constrain(slope, e.altKey ? 0.1 : 1));
  };

  /** A press: on a tangent handle drags it; on a point drags it from where it was grabbed; on
   * the plot adds a key there (keys) or brings the nearer handle (an easing) */
  const onPress = (e: PointerEvent) => {
    // The pointer takes over: typed text goes back, a key's gesture ends
    for (const spin of spins) spin.interrupt();
    const rect = area.getBoundingClientRect();
    areaRect = rect;
    grabX = 0;
    grabY = 0;
    dragKind = null;
    const value = binding.peek();
    const hit = e.target as Node;
    const side = tangents.in.elem.contains(hit)
      ? 'in'
      : tangents.out.elem.contains(hit)
        ? 'out'
        : null;
    if (side) {
      dragKind = side;
      focusPoint(selected);
      binding.step(withSlopeAt(e, side));
      return;
    }
    let index = handles.findIndex((handle) => handle.elem.contains(hit));
    if (index >= 0) {
      const box = handles[index].elem.getBoundingClientRect();
      grabX = e.clientX - (box.left + box.width / 2);
      grabY = e.clientY - (box.top + box.height / 2);
    } else if (isBezier) {
      const [fx, fy] = getShares(e);
      const distance = (i: number) => {
        const dx = (toFx(getX(value, i)) - fx) * rect.width;
        const dy = (toFy(getY(value, i)) - fy) * rect.height;
        return dx * dx + dy * dy;
      };
      index = distance(1) < distance(0) ? 1 : 0;
    } else {
      if (getCount(value) >= maxKeys) return;
      const keys = keysOf(value);
      const [fx, fy] = getShares(e);
      const modifier = e.altKey ? 0.1 : 1;
      const key = makeKey(
        keys,
        xSpin.steps.constrain(xMin + clamp01(fx) * xSize, modifier),
        ySpin.steps.constrain(yMin + clamp01(fy) * ySize, modifier)
      );
      const next = editable();
      keysOf(next).push(key);
      index = keys.length;
      selected = index;
      dragKind = 'point';
      dragIndex = index;
      binding.step(next);
      focusPoint(index);
      return;
    }
    dragKind = 'point';
    dragIndex = index;
    // Focusing it selects it (and a blur before writes the row's typed text)
    focusPoint(index);
    binding.step(withPointAt(e, index));
  };

  drag = createPointerDrag(plot, {
    canPress: () => !shell.isDisabled(),
    onPress,
    onMove: (e) => {
      if (dragKind === 'point') binding.step(withPointAt(e, dragIndex));
      else if (dragKind) binding.step(withSlopeAt(e, dragKind));
    },
    onEnd: () => {
      areaRect = null;
      if (!dragKind) return;
      dragKind = null;
      binding.commit();
    },
  });

  return shell.field;
};
