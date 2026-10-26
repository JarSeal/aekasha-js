// The quaternion field (p804 D8): a quaternion edited as Euler angles in degrees, or as an axis
// and an angle, on the vector field's parts (VectorField.ts' `buildPartsField`), normalised on
// write, with its raw components as text when asked. The numbers shown are the user's own while
// the quaternion is the one they made: equivalent angles don't jump on a refresh.
import { createObjectValueKind, type BindingValueKind } from '../binding/Binding';
import { createValueFormatter } from '../binding/ValueText';
import type { Field, FieldProps } from '../Field';
import { buildMonitor } from '../Monitor';
import { buildPartsField, type NumberPart } from '../VectorField';
import { getAnglePart } from './RotationField';
import {
  axisAngleToQuaternion,
  DEG_TO_RAD,
  eulerToQuaternion,
  normalizeQuaternion,
  quaternionToAxisAngle,
  quaternionToEuler,
  RAD_TO_DEG,
  type EulerOrder,
  type Quat,
} from './RotationMath';
import '../VectorField.scss';
import '../../styles/kit.scss';

/** A quaternion field's value: a `THREE.Quaternion`'s shape (written in place). */
export type QuaternionValue = { x: number; y: number; z: number; w: number };

/**
 * What {@link createQuaternionField} makes a quaternion field from.
 * @template T the value: a quaternion's shape
 */
export type QuaternionFieldProps<T extends QuaternionValue = QuaternionValue> = FieldProps<T> & {
  /** How it's edited: `'euler'`, three angles in degrees (default), or `'axisAngle'`, an axis
   * (normalised on write) and an angle in degrees. */
  edit?: 'euler' | 'axisAngle';
  /** The Euler angles' order (default 'XYZ', three's). */
  order?: EulerOrder;
  /** The angles' step, in radians (as a rotation field's), shown in degrees (default 1°). */
  step?: number;
  /** The angles' decimals, in place of the step's. */
  precision?: number;
  /** Shows the raw components after the parts as text (default false). */
  showRaw?: boolean;
  /** Writes each valid keystroke (`last: false`), not only on Enter or a blur (default false). */
  live?: boolean;
  /** Each keystroke's text in a part, before it's written. */
  onInput?: (text: string) => void;
};

/**
 * A quaternion field {@link createQuaternionField} made: the field's handle.
 * @template T the value
 */
export type QuaternionField<T extends QuaternionValue = QuaternionValue> = Field<T>;

const KEYS = ['x', 'y', 'z', 'w'] as const;

const AXIS_PART: Omit<NumberPart, 'axis' | 'label'> = { min: -1, max: 1, step: 0.01 };

const isSameQuaternion = (a: Quat, b: Quat) =>
  a.x === b.x && a.y === b.y && a.z === b.z && a.w === b.w;

/**
 * Creates a quaternion field (p804 D8): a quaternion (a `THREE.Quaternion` written in place) from
 * its binding (`{ target, key }`, `{ get, set }` or `{ value }`), edited as Euler angles in
 * degrees (`order`, default XYZ) or, with `edit: 'axisAngle'`, an axis and an angle, and
 * normalised on write.
 * - The parts are the vector field's (its keys, typed expressions, an angle's `deg`, `°`, `rad`
 *   and `turn`); the angles wrap at ±180°, an axis' components are -1 to 1 by 0.01.
 * - The numbers shown are the user's own while the bound quaternion is the one they made: an Euler
 *   at the gimbal lock or an axis with no rotation stays as typed, not re-derived into an
 *   equivalent one. A quaternion changed from outside is shown derived (three's conventions).
 * - `showRaw`: the components as text after the parts (`x 0.000, y 0.383, z 0.000, w 0.924`),
 *   read with the group.
 * - Ctrl/⌘+C copies the parts' numbers; a pasted list of as many sets them.
 * - Parts: the vector field's (`.aekVectorField.aekQuaternionField`, with `showRaw`
 *   `.aekQuaternionField__raw`), `data-kind="quaternion"`.
 * - `readonly`: a monitor of the derived parts (`0°, 45°, 0°`).
 * @template T the value
 * @example
 * ```ts
 * const facing = createQuaternionField({
 *   label: 'Facing',
 *   target: body,
 *   key: 'quaternion',
 *   order: 'YXZ',
 *   showRaw: true,
 * });
 * settingsPanel.add(facing.cmp);
 * ```
 */
export const createQuaternionField = <T extends QuaternionValue>(
  props: QuaternionFieldProps<T>
): QuaternionField<T> => {
  const isAxisAngle = props.edit === 'axisAngle';
  const order = props.order ?? 'XYZ';
  const valueKind = createObjectValueKind<T & object>(KEYS) as BindingValueKind<T>;
  const parts: NumberPart[] = isAxisAngle
    ? [
        { ...AXIS_PART, axis: 'x', label: 'X' },
        { ...AXIS_PART, axis: 'y', label: 'Y' },
        { ...AXIS_PART, axis: 'z', label: 'Z' },
        getAnglePart('angle', 'Angle', props),
      ]
    : ['x', 'y', 'z'].map((axis) => getAnglePart(axis, axis.toUpperCase(), props));

  /** The parts' numbers, and the quaternion they show (made or derived) */
  let shown: number[] = [];
  let shownFor: Quat | null = null;

  /** A quaternion's parts: Euler degrees, or the axis and the angle in degrees (the axis shown
   * kept where the quaternion has none) */
  const derive = (q: Quat) => {
    const unit = normalizeQuaternion(q);
    if (!isAxisAngle) return quaternionToEuler(unit, order).map((angle) => angle * RAD_TO_DEG);
    const previous = shownFor ? (shown.slice(0, 3) as [number, number, number]) : undefined;
    const [ax, ay, az, angle] = quaternionToAxisAngle(unit, previous);
    return [ax, ay, az, angle * RAD_TO_DEG];
  };

  /** The parts' numbers as a unit quaternion */
  const compose = (numbers: readonly number[]): Quat =>
    isAxisAngle
      ? axisAngleToQuaternion(numbers[0], numbers[1], numbers[2], numbers[3] * DEG_TO_RAD)
      : eulerToQuaternion(
          numbers[0] * DEG_TO_RAD,
          numbers[1] * DEG_TO_RAD,
          numbers[2] * DEG_TO_RAD,
          order
        );

  const readPart = (value: T, index: number) => {
    if (!shownFor || !isSameQuaternion(value, shownFor)) {
      shown = derive(value);
      shownFor = { x: value.x, y: value.y, z: value.z, w: value.w };
    }
    return shown[index];
  };

  /** The numbers made the shown ones and the value, before it's written (the draw then keeps
   * them) */
  const write = (from: T, numbers: number[]): T => {
    const q = compose(numbers);
    shown = numbers;
    shownFor = q;
    const next = valueKind.copy(from) as QuaternionValue;
    next.x = q.x;
    next.y = q.y;
    next.z = q.z;
    next.w = q.w;
    return next as T;
  };

  if (props.readonly) {
    const formatters = parts.map((part) => createValueFormatter(part));
    return buildMonitor(props, {
      valueKind,
      getText: (value) =>
        parts
          .map((part, i) => `${formatters[i].getText(readPart(value, i))}${part.unit ?? ''}`)
          .join(', '),
    }).shell.field;
  }

  const raw = props.showRaw ? document.createElement('span') : null;
  let rawText: string | null = null;
  const rawNumber = createValueFormatter({ precision: 3 });
  if (raw) raw.className = 'aekQuaternionField__raw';

  const { shell } = buildPartsField<T>(props, {
    kind: 'quaternion',
    valueKind,
    className: 'aekQuaternionField',
    parts,
    readPart,
    writePart: (from, index, value) => {
      // The shown numbers are `from`'s: read before the change
      readPart(from, index);
      const numbers = [...shown];
      numbers[index] = value;
      return write(from, numbers);
    },
    writeAll: (from, values) => write(from, [...values]),
    extras: raw ? [raw] : [],
    draw: (value) => {
      if (!raw) return;
      const text = KEYS.map((key) => `${key} ${rawNumber.getText(value[key])}`).join(', ');
      if (text === rawText) return;
      rawText = text;
      raw.textContent = text;
    },
  });
  return shell.field;
};
