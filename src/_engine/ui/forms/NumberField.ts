import { getPrimitiveValueKind } from './binding/Binding';
import type { NumberRules } from './binding/ValueText';
import { createField, type Field, type FieldProps, type FieldShell } from './Field';
import { createNumberInput, type NumberInput } from './NumberInput';
import { getStepModifier, type NumberSteps } from './NumberSteps';
import './NumberField.scss';
import '../styles/kit.scss';

/** What {@link createNumberField} makes a number field from. */
export type NumberFieldProps = FieldProps<number> &
  NumberRules & {
    /** The value's text (Tweakpane's `format`), in place of the decimals': also what assistive
     * tech says (`aria-valuetext`). Only what's shown: the value written is the number. */
    format?: (value: number) => string;
    /** A unit shown after the value (`'ms'`, `'°'`), and said after it. */
    unit?: string;
    /** The units a typed expression may use, each the factor it multiplies by: a field in
     * degrees `{ deg: 1, rad: 180 / Math.PI }`, a 0-1 field `{ '%': 0.01 }` (default none). */
    expressionUnits?: Readonly<Record<string, number>>;
    /** Writes each valid keystroke (`last: false`), not only on Enter or a blur (default false). */
    live?: boolean;
    /** Each keystroke's text, before it's written: a live preview, a search as you type. */
    onInput?: (text: string) => void;
  };

/** A number field {@link createNumberField} made: the field's handle. */
export type NumberField = Field<number>;

/**
 * What a field built on the number field's spin button adds to it (the slider's track).
 * @internal
 */
export type NumberFieldParts = {
  /** `data-kind` on the field's element */
  kind: string;
  /** The control around the spin button's box (a slider's track and the box); default the box,
   * which an outside change flashes either way */
  wrapBox?: (box: HTMLElement) => HTMLElement;
  /** Draws a value into the field's own parts too, with its shown text */
  draw?: (value: number, text: string) => void;
  /** Sets the own parts' disabled state too */
  applyDisabled?: (disabled: boolean) => void;
  /** Runs when the field is removed: the own parts' listeners */
  onRemove?: () => void;
  /** A horizontal drag on the label changes the value (the number field's; a slider's track is
   * its drag) */
  scrub?: boolean;
};

/**
 * A field built on the number field's spin button: what `buildNumberField` gives back.
 * @internal
 */
export type NumberFieldBuild = {
  shell: FieldShell<number>;
  steps: NumberSteps;
  formatter: NumberInput['formatter'];
  /** Puts typed text back and ends a key's gesture: a pointer took over (a slider's track) */
  interrupt: () => void;
};

/** A drag's distance before a press on the label scrubs, so a click still focuses the input */
const SCRUB_THRESHOLD_PX = 3;

/** A scrub's change per pixel: Tweakpane's, a tenth of the step's (or the value's) decade */
const getPointerScale = (step: number | undefined, value: number) => {
  const base = Math.abs(step ?? value);
  return base === 0 ? 0.1 : 10 ** (Math.floor(Math.log10(base)) - 1);
};

/**
 * Creates a number field (p804 D7): a text input that is a spin button, its value from its
 * binding (`{ target, key }`, `{ get, set }` or `{ value }`) and written there. Not
 * `type="number"`, which takes no expressions, formats by locale and changes on the wheel.
 * - Typing: an expression (`1/2`, `2 ** 3`, `pi / 4`, the field's `expressionUnits`, `90deg`) is
 *   written on Enter or a blur, or on each valid keystroke with `live`; an invalid one shows its
 *   error and keeps the value. A written value snaps to the `step`'s grid (from `min`, else 0),
 *   stays in the range (or wraps at it with `wrap`) and is rounded to the decimals the step and
 *   the ends have, so `1 + 0.1` writes `1.1`. The text shows `precision`'s decimals, else the
 *   step's, else the value's own (at least 2), or `format`'s text, in tabular figures.
 * - Keys: ArrowUp / ArrowDown step by `step` (default 1), Shift ×10, Alt ×0.1 (off the grid);
 *   PageUp / PageDown ×10; Home / End go to `min` / `max` when set; Enter writes the typed text,
 *   Escape puts the value's text back (and goes no further, so a dialog stays open). A held key
 *   writes on every repeat (`last: false`) and once with `last: true` on its keyup.
 *   Ctrl/⌘+C with no text selected copies the value; Ctrl/⌘+V of a number sets it.
 * - Scrub: a horizontal drag on the label changes the value (a 3 px threshold, so a click still
 *   focuses the input; Shift ×10, Alt ×0.1), `last: true` on the release.
 * - Parts: `.aekField` (`data-kind="number"`, `data-disabled`, `data-invalid`, `data-scrubbing`)
 *   with `.aekField__head` (`.aekField__label`, `.aekField__reset`), `.aekField__control` holding
 *   `.aekField__box.aekNumberField` (`data-flash` while a change from outside shows)
 *   with `.aekField__input.aekNumberField__input` and `.aekNumberField__unit`, and `.aekField__message`
 *   (`data-type="hint" | "error"`).
 * - Custom properties: `--aek-field-control-bg`, `--aek-field-control-border-color`,
 *   `--aek-field-radius`, `--aek-field-flash-color`.
 * - ARIA: the input is a `spinbutton` with `aria-valuenow`, `-min`, `-max` and `-valuetext` (its
 *   text and unit), labelled by the `<label>`; an error sets `aria-invalid` and is its description,
 *   as the hint is. The reset button ("Reset {label}") shows only while the value isn't the
 *   default.
 * - Motion: a change from outside (a refresh that reads a new value) flashes the box once, a
 *   static tint under reduced motion.
 * @example
 * ```ts
 * const scheduler = createBindingScheduler();
 * const speed = createNumberField({
 *   label: 'Speed',
 *   target: spinner,
 *   key: 'speed',
 *   min: 0,
 *   step: 0.1,
 *   unit: 'rad/s',
 *   scheduler,
 *   onChange: (value, { last }) => {
 *     if (last) saveSettings();
 *   },
 * });
 * settingsPanel.add(speed.cmp);
 * ```
 */
export const createNumberField = (props: NumberFieldProps): NumberField =>
  buildNumberField(props, { kind: 'number', scrub: true }).shell.field;

/**
 * Builds a field on the number field's spin button (its typed text, keys, clipboard and, with
 * `scrub`, the label's drag), with `parts` around it: the number field, and the slider with its
 * track.
 * @internal
 */
export const buildNumberField = (
  props: NumberFieldProps,
  parts: NumberFieldParts
): NumberFieldBuild => {
  let scrub: {
    startX: number;
    lastX: number;
    raw: number;
    /** Per pixel, from the value at the press */
    scale: number;
    isMoving: boolean;
  } | null = null;
  let isClickAfterScrub = false;
  /** Ends the scrub (set below: disabling can run while the shell is made) */
  let endScrub = () => {};

  const spin = createNumberInput(props);
  const { input, box } = spin;

  const shell = createField<number>(props, {
    kind: parts.kind,
    valueKind: getPrimitiveValueKind<number>(),
    control: parts.wrapBox?.(box) ?? box,
    labelFor: input,
    flashElem: box,
    draw: (value) => {
      const text = spin.draw(value);
      parts.draw?.(value, text);
    },
    applyDisabled: (on) => {
      spin.applyDisabled(on);
      if (on) endScrub();
      parts.applyDisabled?.(on);
    },
    onRemove: () => {
      spin.dispose();
      for (const [type, fn] of listeners) labelElem.removeEventListener(type, fn as EventListener);
      parts.onRemove?.();
    },
  });
  const { binding, labelElem } = shell;
  spin.attach(binding, shell.setOwnError);

  endScrub = () => {
    if (!scrub) return;
    shell.cmp.elem.removeAttribute('data-scrubbing');
    scrub = null;
    binding.commit();
  };

  // The label's scrub: pointer capture, no pointer lock (it prompts, and loses the cursor in an
  // embed); the keyboard path is the keys
  const onLabelPointerDown = (e: PointerEvent) => {
    if (e.button !== 0 || shell.isDisabled() || props.labelHidden || !parts.scrub) return;
    labelElem.setPointerCapture?.(e.pointerId);
    const raw = binding.peek();
    const scale = getPointerScale(props.step, raw);
    scrub = { startX: e.clientX, lastX: e.clientX, raw, scale, isMoving: false };
  };

  const onLabelPointerMove = (e: PointerEvent) => {
    if (!scrub) return;
    if (!scrub.isMoving) {
      if (Math.abs(e.clientX - scrub.startX) < SCRUB_THRESHOLD_PX) return;
      scrub.isMoving = true;
      scrub.lastX = scrub.startX;
      shell.cmp.elem.setAttribute('data-scrubbing', '');
      spin.revertTyping();
    }
    const modifier = getStepModifier(e);
    scrub.raw += (e.clientX - scrub.lastX) * scrub.scale * modifier;
    scrub.lastX = e.clientX;
    spin.stepTo(spin.steps.constrain(scrub.raw, modifier));
  };

  const onLabelPointerEnd = () => {
    if (!scrub) return;
    // A scrub's release is no click: the label would focus the input
    isClickAfterScrub = scrub.isMoving;
    if (scrub.isMoving) endScrub();
    else scrub = null;
  };

  const onLabelClick = (e: Event) => {
    if (!isClickAfterScrub) return;
    isClickAfterScrub = false;
    e.preventDefault();
  };

  const listeners: [string, (e: never) => void][] = [
    ['pointerdown', onLabelPointerDown],
    ['pointermove', onLabelPointerMove],
    ['pointerup', onLabelPointerEnd],
    ['pointercancel', onLabelPointerEnd],
    ['lostpointercapture', onLabelPointerEnd],
    ['click', onLabelClick],
  ];
  for (const [type, fn] of listeners) labelElem.addEventListener(type, fn as EventListener);

  return {
    shell,
    steps: spin.steps,
    formatter: spin.formatter,
    interrupt: () => {
      endScrub();
      spin.interrupt();
    },
  };
};
