// The rotation field (p804 D8): an Euler's three angles (radians: a `THREE.Euler`'s shape), shown
// and typed in degrees on the vector field's parts (VectorField.ts' `buildPartsField`), each
// wrapping at ±180°, with a select for its order.
import { createObjectValueKind, type BindingValueKind } from '../binding/Binding';
import { createValueFormatter } from '../binding/ValueText';
import { createDropDown } from '../DropDown';
import type { Field, FieldProps } from '../Field';
import { buildMonitor, readFirstValue } from '../Monitor';
import { buildPartsField, type NumberPart } from '../VectorField';
import { DEG_TO_RAD, EULER_ORDERS, RAD_TO_DEG } from './RotationMath';
import '../VectorField.scss';
import '../../styles/kit.scss';

/**
 * A rotation field's value: Euler angles in radians, and their order (a `THREE.Euler`, written in
 * place).
 */
export type EulerValue = { x: number; y: number; z: number; order?: string };

/**
 * What {@link createRotationField} makes a rotation field from.
 * @template T the value: an Euler's shape
 */
export type RotationFieldProps<T extends EulerValue = EulerValue> = FieldProps<T> & {
  /** The step, in radians (Tweakpane's `Math.PI / 8` keeps working), shown in degrees (22.5°)
   * (default 1°). */
  step?: number;
  /** The decimals shown, in place of the step's. */
  precision?: number;
  /** Each angle's text, given its degrees, in place of the decimals'. */
  format?: (degrees: number) => string;
  /** Shows a select for the Euler's `order` after the angles (default false; the value needs an
   * `order`). */
  showOrder?: boolean;
  /** Writes each valid keystroke (`last: false`), not only on Enter or a blur (default false). */
  live?: boolean;
  /** Each keystroke's text in an angle, before it's written. */
  onInput?: (text: string) => void;
};

/**
 * A rotation field {@link createRotationField} made: the field's handle.
 * @template T the value
 */
export type RotationField<T extends EulerValue = EulerValue> = Field<T>;

/**
 * The units a typed angle may use: degrees as they are, radians and turns converted.
 * @internal
 */
export const ANGLE_UNITS: Readonly<Record<string, number>> = {
  deg: 1,
  '°': 1,
  rad: RAD_TO_DEG,
  turn: 360,
};

const KEYS = ['x', 'y', 'z'] as const;

/**
 * An angle part's rules (p804 D8): degrees, wrapping at ±180°, the step given in radians.
 * @internal
 */
export const getAnglePart = (
  axis: string,
  label: string,
  props: { step?: number; precision?: number; format?: (degrees: number) => string }
): NumberPart => ({
  axis,
  label,
  min: -180,
  max: 180,
  wrap: true,
  // `Math.PI / 8` in degrees is 22.499999999999996: rounded, so its decimals are 22.5's
  step: props.step === undefined ? 1 : Number((props.step * RAD_TO_DEG).toFixed(10)),
  precision: props.precision,
  format: props.format,
  unit: '°',
  expressionUnits: ANGLE_UNITS,
});

/**
 * Creates a rotation field (p804 D8): an Euler's angles (radians, a `THREE.Euler` written in
 * place, its `order` kept), shown and typed in degrees, from its binding (`{ target, key }`,
 * `{ get, set }` or `{ value }`).
 * - Each angle is the vector field's part (its keys, typed expressions with `deg`, `°`, `rad` and
 *   `turn`, Enter, Escape), wrapping at ±180° (180° writes as -180°, the same angle). `step` is in
 *   radians (Tweakpane's `Math.PI / 8`) and shows in degrees (22.5°).
 * - `showOrder`: a select after the angles for the Euler's order (XYZ, YXZ, …), named "Order" and
 *   its value; picking one keeps the angles (three reads them in the new order).
 * - Ctrl/⌘+C copies the angles in degrees (`0, 45, 90`); a pasted list of three sets them.
 * - Parts: the vector field's (`.aekVectorField.aekRotationField`, an `.aekVectorField__axis` per
 *   angle, with `showOrder` one more holding the drop-down), `data-kind="rotation"`.
 * - ARIA: the row is a group named by the label, each angle a spin button named by its letter, its
 *   `aria-valuetext` in degrees ("45°").
 * - `readonly`: a monitor of the angles (`0°, 45°, 90°`).
 * @template T the value
 * @example
 * ```ts
 * const rotation = createRotationField({
 *   label: 'Rotation',
 *   target: mesh,
 *   key: 'rotation',
 *   step: Math.PI / 8,
 *   showOrder: true,
 * });
 * settingsPanel.add(rotation.cmp);
 * ```
 */
export const createRotationField = <T extends EulerValue>(
  props: RotationFieldProps<T>
): RotationField<T> => {
  const hasOrder = typeof readFirstValue<T>(props)?.order === 'string';
  const keys = hasOrder ? [...KEYS, 'order'] : [...KEYS];
  const valueKind = createObjectValueKind<T & object>(keys) as BindingValueKind<T>;
  const parts = KEYS.map((key) => getAnglePart(key, key.toUpperCase(), props));

  if (props.readonly) {
    const formatters = parts.map((part) => createValueFormatter(part));
    return buildMonitor(props, {
      valueKind,
      getText: (value) =>
        KEYS.map((key, i) => `${formatters[i].getText(value[key] * RAD_TO_DEG)}°`).join(', '),
    }).shell.field;
  }

  /** The binding's value, once the shell exists (the order select reads it) */
  let peek: () => T | null = () => null;
  let write: (order: string) => void = () => {};
  const order =
    props.showOrder && hasOrder
      ? createOrderSelect(
          () => peek(),
          (o) => write(o)
        )
      : null;

  const { shell } = buildPartsField<T>(props, {
    kind: 'rotation',
    valueKind,
    className: 'aekRotationField',
    parts,
    readPart: (value, index) => value[KEYS[index]] * RAD_TO_DEG,
    writePart: (from, index, degrees) => {
      const next = valueKind.copy(from);
      next[KEYS[index]] = degrees * DEG_TO_RAD;
      return next;
    },
    writeAll: (from, degrees) => {
      const next = valueKind.copy(from);
      KEYS.forEach((key, i) => (next[key] = degrees[i] * DEG_TO_RAD));
      return next;
    },
    extras: order ? [order.elem] : [],
    draw: () => order?.refresh(),
    applyDisabled: (on) => order?.setDisabled(on),
    onRemove: () => order?.remove(),
  });
  const { binding } = shell;
  peek = binding.peek;
  // Its first draw came before the binding was handed over
  order?.refresh();
  write = (picked) => {
    const next = valueKind.copy(binding.peek());
    next.order = picked;
    binding.change(next);
  };
  return shell.field;
};

/** The order's select: a drop-down in a part of its own, named "Order" and its value */
const createOrderSelect = (peek: () => EulerValue | null, write: (order: string) => void) => {
  const part = document.createElement('span');
  part.className = 'aekVectorField__axis aekRotationField__order';
  part.setAttribute('data-axis', 'order');
  const name = document.createElement('span');
  name.className = 'aekVectorField__letter';
  name.setAttribute('aria-hidden', 'true');
  name.textContent = 'Order';
  part.append(name);
  const dropDown = createDropDown({
    options: EULER_ORDERS.map((value) => ({ value, label: value })),
    value: () => peek()?.order ?? null,
    title: 'Order',
    onChange: write,
  });
  part.append(dropDown.cmp.elem);
  const trigger = dropDown.cmp.elem.querySelector<HTMLElement>('.aekDropDownTrigger');
  const valueLabel = dropDown.cmp.elem.querySelector<HTMLElement>('.aekDropDownLabel');
  if (trigger && valueLabel) {
    name.id = `${dropDown.cmp.id}__name`;
    valueLabel.id = `${dropDown.cmp.id}__value`;
    // "Order, XYZ": the drop-down's tooltip would repeat the name
    trigger.setAttribute('aria-labelledby', `${name.id} ${valueLabel.id}`);
    trigger.removeAttribute('title');
  }
  return {
    elem: part,
    refresh: () => dropDown.refresh(),
    setDisabled: (on: boolean) => {
      if (on) {
        dropDown.close();
        trigger?.setAttribute('disabled', '');
      } else {
        trigger?.removeAttribute('disabled');
      }
    },
    remove: () => dropDown.cmp.remove(),
  };
};
