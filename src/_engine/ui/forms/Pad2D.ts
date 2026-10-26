// The 2D pad (p804 D8): a box with a point for an `{ x, y }` offset or direction, dragged or moved
// with the arrows, over the vector field's two parts (VectorField.ts' `buildPartsField`), which are
// its accessible editor: the APG has no 2D pattern.
import { createObjectValueKind, type BindingValueKind } from './binding/Binding';
import { createValueFormatter, type NumberRules } from './binding/ValueText';
import type { Field, FieldProps } from './Field';
import { buildMonitor } from './Monitor';
import { getStepModifier, listenStepKeys } from './NumberSteps';
import { createPointerDrag, type PointerDrag } from './PointerDrag';
import { buildPartsField, type NumberPart, type VectorAxisProps } from './VectorField';
import './Pad2D.scss';
import './VectorField.scss';
import '../styles/kit.scss';

/** A 2D pad's value: an `{ x, y }` object (a `THREE.Vector2`, written in place). */
export type Pad2DValue = { x: number; y: number };

/**
 * What {@link createPad2D} makes a 2D pad from.
 * @template T the value: an `{ x, y }` object
 */
export type Pad2DProps<T extends Pad2DValue = Pad2DValue> = FieldProps<T> &
  NumberRules & {
    /** Each axis' own rules and name, over the shared ones (`{ y: { min: 0 } }`). The pad spans
     * each axis' `min` to `max` (default -1 to 1, by 0.01). */
    axes?: Partial<Record<'x' | 'y', VectorAxisProps>>;
    /** Each axis' text (Tweakpane's `format`), in place of the decimals'. */
    format?: (value: number) => string;
    /** A unit shown after each axis. */
    unit?: string;
    /** The units a typed expression may use, each its factor. */
    expressionUnits?: Readonly<Record<string, number>>;
    /** Y grows downwards on the pad (screen coordinates, Tweakpane's `y: { inverted: true }`);
     * default upwards. */
    invertY?: boolean;
    /** Writes each valid keystroke in an axis (`last: false`), not only on Enter or a blur
     * (default false). */
    live?: boolean;
    /** Each keystroke's text in an axis, before it's written. */
    onInput?: (text: string) => void;
  };

/**
 * A 2D pad {@link createPad2D} made: the field's handle.
 * @template T the value
 */
export type Pad2D<T extends Pad2DValue = Pad2DValue> = Field<T>;

const KEYS = ['x', 'y'] as const;
const RULE_KEYS = ['min', 'max', 'step', 'precision', 'wrap'] as const;
/** The pad's range when none is given: an offset or a direction */
const DEFAULT_RULES: NumberRules = { min: -1, max: 1, step: 0.01 };
/** The arrows: the axis each moves and which way on the pad (y's flipped with `invertY`) */
const PAD_KEYS: Readonly<Record<string, readonly [index: number, sign: number]>> = {
  ArrowLeft: [0, -1],
  ArrowRight: [0, 1],
  ArrowUp: [1, 1],
  ArrowDown: [1, -1],
};
const SVG_NS = 'http://www.w3.org/2000/svg';

const span = (className: string) => {
  const elem = document.createElement('span');
  elem.className = className;
  return elem;
};

/**
 * Creates a 2D pad (p804 D8): a box with a point at an `{ x, y }` value (a `THREE.Vector2` written
 * in place) over its two axes' spin buttons, from its binding (`{ target, key }`, `{ get, set }` or
 * `{ value }`). For offsets and directions: the pad spans each axis' `min` to `max` (default -1
 * to 1, by 0.01), y upwards unless `invertY`.
 * - Pointer: a press puts the point under it and drags it (`last: false` per move, `last: true`
 *   on the release); a press on the point drags it from where it was grabbed. Alt drags on a
 *   tenth of the steps.
 * - Keys: the pad is a tab stop whose arrows move the point by each axis' `step` (Shift ×10,
 *   Alt ×0.1), each keyup writing `last: true`. The axes are the vector field's parts (typed
 *   expressions, ArrowUp / ArrowDown, PageUp / PageDown, Home / End, Enter, Escape; Ctrl/⌘+C and
 *   Ctrl/⌘+V the whole value): the pad's accessible editor.
 * - Parts: the vector field's (`.aekVectorField.aekPad2D`, `data-kind="pad2d"`) with, before the
 *   axes, `.aekPad2D__pad` (`data-dragging`) holding `.aekPad2D__axis` lines through 0 (when 0 is
 *   inside the range), `.aekPad2D__line` (an SVG from 0 to the point) and `.aekPad2D__point`.
 * - Custom properties: `--aek-pad2d-size` (default `--aek-space-7` × 4),
 *   `--aek-pad2d-point-color`, and the vector field's and the fields' (`--aek-vector-x-color`,
 *   `--aek-field-*`).
 * - ARIA: the row is a group named by the label; the pad a `role="group"` with
 *   `aria-roledescription="2D pad"`, named by the label and described by its value's text
 *   ("X 0.25, Y -0.50", rewritten on a change; not a live region); each axis a spin button named
 *   by its letter. While disabled the pad is `aria-disabled` and out of the tab order.
 * - Motion: a change from outside flashes the pad and the axes' boxes.
 * - `readonly`: a monitor of the axes' text (`0.25, -0.50`).
 * @template T the value
 * @example
 * ```ts
 * const wind = createPad2D({
 *   label: 'Wind',
 *   target: weather,
 *   key: 'wind',
 *   min: -10,
 *   max: 10,
 *   step: 0.5,
 *   unit: 'm/s',
 * });
 * settingsPanel.add(wind.cmp);
 * ```
 */
export const createPad2D = <T extends Pad2DValue>(props: Pad2DProps<T>): Pad2D<T> => {
  const valueKind = createObjectValueKind<T>(KEYS) as BindingValueKind<T>;
  const parts: NumberPart[] = KEYS.map((key) => {
    const own = props.axes?.[key];
    const rules: NumberRules = {};
    for (const rule of RULE_KEYS) {
      const value = own?.[rule] ?? props[rule] ?? DEFAULT_RULES[rule];
      if (value !== undefined) (rules as Record<string, unknown>)[rule] = value;
    }
    return {
      ...rules,
      axis: key,
      label: own?.label ?? key.toUpperCase(),
      format: props.format,
      unit: props.unit,
      expressionUnits: props.expressionUnits,
    };
  });
  const formatters = parts.map((part) => createValueFormatter(part));
  const getText = (value: T, spoken: boolean) =>
    KEYS.map((key, i) => {
      const text = formatters[i].getText(value[key]);
      return spoken ? `${parts[i].label} ${formatters[i].getSpokenText(text)}` : text;
    }).join(', ');

  if (props.readonly) {
    return buildMonitor(props, { valueKind, getText: (value) => getText(value, false) }).shell
      .field;
  }

  const invertY = Boolean(props.invertY);
  const ranges = parts.map(({ min = 0, max = 0 }) => ({ min, max, size: max - min }));
  const toFraction = (index: number, value: number) => {
    const { min, size } = ranges[index];
    return size > 0 ? Math.min(1, Math.max(0, (value - min) / size)) : 0;
  };
  /** Where a value is on the pad, percents to a thousandth from the left and the top */
  const getLeft = (x: number) => Math.round(toFraction(0, x) * 1e5) / 1e3;
  const getTop = (y: number) => {
    const fraction = toFraction(1, y);
    return Math.round((invertY ? fraction : 1 - fraction) * 1e5) / 1e3;
  };
  // Strictly inside: a line along the pad's edge, or from its corner, says nothing
  const hasZero = ranges.map(({ min, max }) => min < 0 && max > 0);

  const pad = span('aekPad2D__pad');
  pad.setAttribute('role', 'group');
  pad.setAttribute('aria-roledescription', '2D pad');
  pad.setAttribute('tabindex', '0');
  // The lines through 0, placed once (the ranges don't change)
  const axisX = span('aekPad2D__axis');
  axisX.setAttribute('data-axis', 'x');
  axisX.style.top = `${getTop(0)}%`;
  if (!hasZero[1]) axisX.setAttribute('hidden', '');
  const axisY = span('aekPad2D__axis');
  axisY.setAttribute('data-axis', 'y');
  axisY.style.left = `${getLeft(0)}%`;
  if (!hasZero[0]) axisY.setAttribute('hidden', '');
  // From 0 to the point: a direction's arrow (none when the range has no 0)
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'aekPad2D__line');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-hidden', 'true');
  const line = document.createElementNS(SVG_NS, 'line');
  line.setAttribute('x1', String(getLeft(0)));
  line.setAttribute('y1', String(getTop(0)));
  line.setAttribute('vector-effect', 'non-scaling-stroke');
  svg.append(line);
  if (!hasZero[0] || !hasZero[1]) svg.setAttribute('hidden', '');
  const point = span('aekPad2D__point');
  pad.append(axisX, axisY, svg, point);
  // The pad's description: its value as text (the parts are the editor)
  const valueText = span('aekVisuallyHidden aekPad2D__text');
  // The parts on a line of their own under the pad
  const lineBreak = span('aekPad2D__break');
  lineBreak.setAttribute('aria-hidden', 'true');

  let shownLeft = NaN;
  let shownTop = NaN;
  let shownText: string | null = null;
  let drag: PointerDrag | null = null;
  /** The pad's keys (set below: disabling can run while the shell is made) */
  let keys: ReturnType<typeof listenStepKeys> | null = null;

  const copyWith = (from: T, x: number, y: number) => {
    const next = valueKind.copy(from);
    next.x = x;
    next.y = y;
    return next;
  };

  const { shell, spins } = buildPartsField<T>(props, {
    kind: 'pad2d',
    valueKind,
    className: 'aekPad2D',
    parts,
    readPart: (value, index) => value[KEYS[index]],
    writePart: (from, index, value) =>
      index === 0 ? copyWith(from, value, from.y) : copyWith(from, from.x, value),
    writeAll: (from, values) => copyWith(from, values[0], values[1]),
    leading: [pad, valueText, lineBreak],
    draw: (value) => {
      const left = getLeft(value.x);
      const top = getTop(value.y);
      if (left !== shownLeft) {
        shownLeft = left;
        point.style.left = `${left}%`;
        line.setAttribute('x2', String(left));
      }
      if (top !== shownTop) {
        shownTop = top;
        point.style.top = `${top}%`;
        line.setAttribute('y2', String(top));
      }
      const text = getText(value, true);
      if (text !== shownText) {
        shownText = text;
        valueText.textContent = text;
      }
    },
    applyDisabled: (on) => {
      // Not a native control: out of the tab order while disabled
      if (on) {
        pad.setAttribute('aria-disabled', 'true');
        pad.removeAttribute('tabindex');
        keys?.end();
        drag?.end();
      } else {
        pad.removeAttribute('aria-disabled');
        pad.setAttribute('tabindex', '0');
      }
    },
    onRemove: () => {
      keys?.dispose();
      drag?.dispose();
    },
  });
  const { binding } = shell;
  valueText.id = `${shell.cmp.id}__padValue`;
  pad.setAttribute('aria-labelledby', shell.labelElem.id);
  pad.setAttribute('aria-describedby', valueText.id);
  const constrain = (index: number, value: number, modifier: number) =>
    spins[index].steps.constrain(value, modifier);

  keys = listenStepKeys(pad, {
    getStep: (e) => {
      const move = PAD_KEYS[e.key];
      if (!move) return null;
      const [index, sign] = move;
      const delta = (index === 1 && invertY ? -sign : sign) * parts[index].step!;
      const modifier = getStepModifier(e);
      return () => {
        const from = binding.peek();
        const value = constrain(index, from[KEYS[index]] + delta * modifier, modifier);
        binding.step(index === 0 ? copyWith(from, value, from.y) : copyWith(from, from.x, value));
      };
    },
    commit: () => binding.commit(),
    isDisabled: shell.isDisabled,
  });

  /** Where the pointer is from the point's centre at a press on it: a drag without a jump */
  let offsetX = 0;
  let offsetY = 0;
  const getValueAt = (e: PointerEvent) => {
    const rect = pad.getBoundingClientRect();
    const fx = rect.width > 0 ? (e.clientX - offsetX - rect.left) / rect.width : 0;
    const fy = rect.height > 0 ? (e.clientY - offsetY - rect.top) / rect.height : 0;
    const across = Math.min(1, Math.max(0, fx));
    const down = Math.min(1, Math.max(0, fy));
    const [x, y] = ranges;
    const modifier = e.altKey ? 0.1 : 1;
    return copyWith(
      binding.peek(),
      constrain(0, x.min + across * x.size, modifier),
      constrain(1, invertY ? y.min + down * y.size : y.max - down * y.size, modifier)
    );
  };

  drag = createPointerDrag(pad, {
    canPress: () => !shell.isDisabled(),
    onPress: (e) => {
      // The pointer takes over: typed text goes back, a key's gesture ends
      for (const spin of spins) spin.interrupt();
      keys?.end();
      // The press focuses the pad, as a click on a focusable element does
      pad.focus({ preventScroll: true });
      offsetX = 0;
      offsetY = 0;
      if (point.contains(e.target as Node)) {
        const rect = point.getBoundingClientRect();
        offsetX = e.clientX - (rect.left + rect.width / 2);
        offsetY = e.clientY - (rect.top + rect.height / 2);
      }
      binding.step(getValueAt(e));
    },
    onMove: (e) => binding.step(getValueAt(e)),
    onEnd: () => binding.commit(),
  });

  return shell.field;
};
