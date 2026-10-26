// The vector field (p804 D8): 2 to 4 number parts in a row, one per axis of an `{ x, y, z?, w? }`
// object or a number array, each a spin button (NumberInput.ts) writing its axis through the
// field's binding, with a link toggle that scales the others with it.
import { createButton } from '../components/Button';
import { lwarn } from '../../utils/Logger';
import { createObjectValueKind, type BindingValueKind } from './binding/Binding';
import { createValueFormatter, type NumberRules } from './binding/ValueText';
import { createField, type Field, type FieldProps } from './Field';
import { buildMonitor, getVectorKeys, readFirstValue } from './Monitor';
import { createNumberInput, type NumberInput, type NumberTarget } from './NumberInput';
import './VectorField.scss';
import '../styles/kit.scss';

/**
 * A vector field's value: an `{ x, y }` to `{ x, y, z, w }` object (a `THREE.Vector3`, written in
 * place) or an array of 2 to 4 numbers.
 */
export type VectorValue = { x: number; y: number; z?: number; w?: number } | readonly number[];

/** An axis' own rules and name, over the field's (`axes`). */
export type VectorAxisProps = NumberRules & {
  /** The axis' name: shown before its part, and the part's accessible name (default its letter,
   * 'X', 'Y', 'Z', 'W'). */
  label?: string;
};

/**
 * What {@link createVectorField} makes a vector field from.
 * @template T the value: an `{ x, y, z?, w? }` object or a number array
 */
export type VectorFieldProps<T extends VectorValue = VectorValue> = FieldProps<T> &
  NumberRules & {
    /** Each axis' own rules and name, over the shared ones (`{ y: { min: 0 } }`; an array's
     * axes are named `x` to `w` too, by their place). */
    axes?: Partial<Record<VectorAxisName, VectorAxisProps>>;
    /** Each axis' text (Tweakpane's `format`), in place of the decimals'. */
    format?: (value: number) => string;
    /** A unit shown after each axis. */
    unit?: string;
    /** The units a typed expression may use, each its factor. */
    expressionUnits?: Readonly<Record<string, number>>;
    /** Writes each valid keystroke (`last: false`), not only on Enter or a blur (default false). */
    live?: boolean;
    /** Each keystroke's text in an axis, before it's written. */
    onInput?: (text: string) => void;
    /** Shows the link toggle: while it's on, a change to one axis scales the others with it
     * (default false). */
    linkable?: boolean;
    /** Whether the axes start linked (default false). */
    linked?: boolean;
    /** The link toggled (by the user): what an owner saves. */
    onLinkedChange?: (linked: boolean) => void;
  };

/**
 * A vector field {@link createVectorField} made: the field's handle, and its link.
 * @template T the value
 */
export type VectorField<T extends VectorValue = VectorValue> = Field<T> & {
  /** Whether the axes are linked. */
  isLinked: () => boolean;
  /** Links or unlinks the axes (no `onLinkedChange`). */
  setLinked: (linked: boolean) => void;
};

/** An axis by its place: an object's key, or an array's index's name */
export type VectorAxisName = 'x' | 'y' | 'z' | 'w';

const AXIS_NAMES: readonly VectorAxisName[] = ['x', 'y', 'z', 'w'];
const RULE_KEYS = ['min', 'max', 'step', 'precision', 'wrap'] as const;

const LINK_ICON =
  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M6.5 9.5l3-3"/><path d="M7 4.5l1-1a2.8 2.8 0 0 1 4 4l-1 1"/><path d="M9 11.5l-1 1a2.8 2.8 0 0 1-4-4l1-1"/></svg>';

/** The axes' keys and how a copy is made: an array's indices, or an object's `x` to `w` */
const getAxes = (value: unknown, label: string) => {
  if (Array.isArray(value)) {
    const length = Math.min(value.length, AXIS_NAMES.length);
    if (length < 2 || value.length > AXIS_NAMES.length || !value.every(Number.isFinite)) {
      lwarn(`Vector field "${label}": its array isn't 2 to 4 numbers; it edits the first ones.`);
    }
    return {
      keys: Array.from({ length: Math.max(length, 2) }, (_, i) => String(i)),
      create: (): object => [],
    };
  }
  const keys = getVectorKeys(value);
  if (!keys) lwarn(`Vector field "${label}": its value isn't an { x, y, z?, w? } object.`);
  return { keys: (keys ?? ['x', 'y']) as string[], create: undefined };
};

/** A pasted text as numbers: `1, 2, 3`, `1 2 3`, `(1, 2, 3)` or `[1, 2, 3]`; null otherwise */
const parseNumberList = (text: string) => {
  const body = text.trim().replace(/^[[(]\s*|\s*[\])]$/g, '');
  const parts = body.split(/[\s,;]+/).filter(Boolean);
  const numbers = parts.map(Number);
  return parts.length > 0 && numbers.every(Number.isFinite) ? numbers : null;
};

/**
 * Creates a vector field (p804 D8): a spin button per axis in a row, its value an `{ x, y }` to
 * `{ x, y, z, w }` object (a `THREE.Vector3` written in place) or an array of 2 to 4 numbers, from
 * its binding (`{ target, key }`, `{ get, set }` or `{ value }`).
 * - Each axis is a number part (as `createNumberField`'s, without the label's scrub): typed
 *   expressions, the arrows (Shift ×10, Alt ×0.1), PageUp / PageDown, Home / End to its
 *   `min` / `max`, Enter, Escape; each writes the whole vector with D3's order. `min`, `max`,
 *   `step`, `precision` and `wrap` are shared, or an axis' own in `axes`.
 * - Ctrl/⌘+C in an axis with no text selected copies the whole vector (`1, 2.5, -3`); Ctrl/⌘+V
 *   of as many numbers as it has axes (`1 2 3`, `(1, 2, 3)`) sets it; a single number sets the
 *   axis.
 * - `linkable`: a toggle button ("Link axes") after the axes; while it's on, a change to one axis
 *   scales the others by the same factor, or moves them by the same amount when that axis was 0.
 * - Parts: `.aekField` (`data-kind="vector"`) with the shell's parts, its `.aekField__control`
 *   holding `.aekVectorField` (`data-flash`, the group) with an `.aekVectorField__axis`
 *   (`data-axis`) per axis (`.aekVectorField__letter` and a number's `.aekField__box`) and
 *   `.aekVectorField__link`.
 * - Custom properties: the fields' `--aek-field-*`, and `--aek-vector-x-color`, `-y-color`,
 *   `-z-color`, `-w-color` (the letters: the danger, success and info colours and the muted
 *   text; a hint, the letter says it).
 * - ARIA: the row is a `role="group"` named by the label, each axis a spin button named by its
 *   letter ("X") or its `label`; the link toggle `aria-pressed`. An error marks every axis.
 * - Motion: a change from outside flashes the axes' boxes.
 * - `readonly`: a monitor of the axes' text (`1.00, 2.50, -3.00`).
 * @template T the value
 * @example
 * ```ts
 * const scheduler = createBindingScheduler();
 * const position = createVectorField({
 *   label: 'Position',
 *   target: mesh,
 *   key: 'position',
 *   step: 0.1,
 *   scheduler,
 * });
 * const scale = createVectorField({
 *   label: 'Scale',
 *   target: mesh,
 *   key: 'scale',
 *   min: 0.01,
 *   step: 0.01,
 *   linkable: true,
 *   linked: true,
 *   scheduler,
 * });
 * settingsPanel.add(position.cmp);
 * settingsPanel.add(scale.cmp);
 * ```
 */
export const createVectorField = <T extends VectorValue>(
  props: VectorFieldProps<T>
): VectorField<T> => {
  const { keys, create } = getAxes(readFirstValue<T>(props), props.label);
  const valueKind = createObjectValueKind<T & object>(keys, create) as BindingValueKind<T>;
  const getRules = (index: number): NumberRules & { label: string } => {
    const name = AXIS_NAMES[index];
    const own = props.axes?.[name];
    const rules: NumberRules = {};
    for (const rule of RULE_KEYS) {
      const value = own?.[rule] ?? props[rule];
      if (value !== undefined) (rules as Record<string, unknown>)[rule] = value;
    }
    return { ...rules, label: own?.label ?? name.toUpperCase() };
  };

  if (props.readonly) {
    const formatters = keys.map((_, index) =>
      createValueFormatter({ ...getRules(index), format: props.format })
    );
    return Object.assign(
      buildMonitor(props, {
        valueKind,
        getText: (value) => {
          const axes = value as unknown as Record<string, number>;
          return keys.map((key, index) => formatters[index].getText(axes[key])).join(', ');
        },
      }).shell.field,
      { isLinked: () => false, setLinked: () => {} }
    );
  }

  let isLinked = Boolean(props.linked);
  /** The binding, once the shell exists (the axes' targets and clipboard read it) */
  let read: () => Record<string, number> = () => ({});

  const row = document.createElement('span');
  row.className = 'aekVectorField';
  const spins: NumberInput[] = keys.map((_, index) => {
    const { label, ...rules } = getRules(index);
    const spin = createNumberInput({
      ...rules,
      format: props.format,
      unit: props.unit,
      expressionUnits: props.expressionUnits,
      live: props.live,
      onInput: props.onInput,
      ariaLabel: label,
      clipboard: {
        getText: () => keys.map((key) => String(read()[key])).join(', '),
        paste: (text, endTyping) => pasteAll(text, endTyping),
      },
    });
    const axis = document.createElement('span');
    axis.className = 'aekVectorField__axis';
    axis.setAttribute('data-axis', AXIS_NAMES[index]);
    const letter = document.createElement('span');
    letter.className = 'aekVectorField__letter';
    // The input's name holds it
    letter.setAttribute('aria-hidden', 'true');
    letter.textContent = label;
    axis.append(letter, spin.box);
    row.append(axis);
    return spin;
  });
  const link = props.linkable
    ? createButton({
        label: 'Link axes',
        variant: 'ghost',
        size: 'sm',
        icon: LINK_ICON,
        iconOnly: true,
        pressed: isLinked,
        class: 'aekVectorField__link',
        onPressedChange: (on) => {
          isLinked = on;
          props.onLinkedChange?.(on);
        },
      })
    : null;
  if (link) row.append(link.cmp.elem);

  const shell = createField<T>(props, {
    kind: 'vector',
    valueKind,
    control: row,
    isGroup: true,
    labelFor: spins[0].input,
    messageFor: spins.map((spin) => spin.input),
    flashElem: row,
    draw: (value) => {
      const axes = value as unknown as Record<string, number>;
      // An axis a wrong value lacks (warned at creation) shows as NaN
      for (let i = 0; i < spins.length; i++) spins[i].draw(Number(axes[keys[i]]));
    },
    applyDisabled: (on) => {
      for (const spin of spins) spin.applyDisabled(on);
      link?.setDisabled(on);
    },
    onRemove: () => {
      for (const spin of spins) spin.dispose();
      link?.cmp.remove();
    },
  });
  const { binding } = shell;
  read = () => binding.peek() as unknown as Record<string, number>;

  /** The value with one axis set: linked, the others scaled with it (by its factor, or by its
   * change when it was 0), each kept to its own rules */
  const withAxis = (index: number, value: number): T => {
    const from = read();
    const next = valueKind.copy(binding.peek()) as unknown as Record<string, number>;
    const before = from[keys[index]];
    next[keys[index]] = value;
    if (isLinked && value !== before) {
      for (let i = 0; i < keys.length; i++) {
        if (i === index) continue;
        const other = from[keys[i]];
        const scaled = before !== 0 ? other * (value / before) : other + (value - before);
        next[keys[i]] = spins[i].steps.constrain(scaled);
      }
    }
    return next as unknown as T;
  };

  /** A pasted text that's every axis' number: one write; false for anything else */
  function pasteAll(text: string, endTyping: () => void) {
    const numbers = parseNumberList(text);
    if (!numbers || numbers.length !== keys.length) return false;
    endTyping();
    const next = valueKind.copy(binding.peek()) as unknown as Record<string, number>;
    for (let i = 0; i < keys.length; i++) next[keys[i]] = spins[i].steps.constrain(numbers[i]);
    binding.change(next as unknown as T);
    return true;
  }

  spins.forEach((spin, index) => {
    const target: NumberTarget = {
      peek: () => read()[keys[index]],
      step: (value) => binding.step(withAxis(index, value)),
      commit: () => binding.commit(),
      change: (value) => binding.change(withAxis(index, value)),
      isInGesture: () => binding.isInGesture(),
    };
    spin.attach(target, shell.setOwnError);
  });

  return Object.assign(shell.field, {
    isLinked: () => isLinked,
    setLinked: (on: boolean) => {
      isLinked = on;
      link?.setPressed(on);
    },
  });
};
