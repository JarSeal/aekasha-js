import { pushOverlay, swallowNextKeyUp } from '../overlays/OverlayStack';
import { getPrimitiveValueKind } from './binding/Binding';
import { evaluateValueExpression } from './binding/ValueExpression';
import {
  constrainNumber,
  getSpokenValueText,
  getValueText,
  type NumberRules,
  type ValueTextOptions,
} from './binding/ValueText';
import { createField, type Field, type FieldProps } from './Field';
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

/** A key's step, as a count of `step`s */
const STEP_KEYS: Record<string, number> = { ArrowUp: 1, ArrowDown: -1, PageUp: 10, PageDown: -10 };
/** A drag's distance before a press on the label scrubs, so a click still focuses the input */
const SCRUB_THRESHOLD_PX = 3;
const NUMBER_TEXT_REGEX = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i;

/** Shift is ×10, Alt ×0.1 (p804 D6) */
const getModifier = (e: { shiftKey: boolean; altKey: boolean }) =>
  e.shiftKey ? 10 : e.altKey ? 0.1 : 1;

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
 *   `.aekNumberField` (`data-flash` while a change from outside shows) with
 *   `.aekNumberField__input` and `.aekNumberField__unit`, and `.aekField__message`
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
export const createNumberField = (props: NumberFieldProps): NumberField => {
  const { onInput, expressionUnits } = props;
  const textOptions: ValueTextOptions = props;
  let isDirty = false;
  /** The value when the typing started: what Escape puts back after live writes */
  let textStartValue = 0;
  /** The overlay stack entry while there's typed text, so Escape reverts it first */
  let removeTypingEntry: ((returnFocus?: boolean) => void) | null = null;
  /** The key whose keyup ends the key gesture */
  let stepKey: string | null = null;
  let scrub: {
    startX: number;
    lastX: number;
    raw: number;
    /** Per pixel, from the value at the press */
    scale: number;
    isMoving: boolean;
  } | null = null;
  let isClickAfterScrub = false;
  /** Ends what's in progress (set below: disabling can run while the shell is made) */
  let endInteractions = () => {};

  const box = document.createElement('span');
  box.className = 'aekNumberField';
  const input = document.createElement('input');
  input.className = 'aekNumberField__input';
  for (const [name, value] of [
    ['type', 'text'],
    ['inputmode', 'decimal'],
    ['role', 'spinbutton'],
    ['autocomplete', 'off'],
    ['spellcheck', 'false'],
  ]) {
    input.setAttribute(name, value);
  }
  if (props.min !== undefined) input.setAttribute('aria-valuemin', String(props.min));
  if (props.max !== undefined) input.setAttribute('aria-valuemax', String(props.max));
  box.append(input);
  if (props.unit) {
    const unit = document.createElement('span');
    unit.className = 'aekNumberField__unit';
    // Said with the value (aria-valuetext)
    unit.setAttribute('aria-hidden', 'true');
    unit.textContent = props.unit;
    box.append(unit);
  }

  const drawText = (value: number) => {
    const text = getValueText(value, textOptions);
    if (input.value !== text) input.value = text;
  };

  const shell = createField<number>(props, {
    kind: 'number',
    valueKind: getPrimitiveValueKind<number>(),
    control: box,
    labelFor: input,
    draw: (value) => {
      input.setAttribute('aria-valuenow', String(value));
      input.setAttribute('aria-valuetext', getSpokenValueText(value, textOptions));
      // Typed text stays until it's written or put back
      if (!isDirty) drawText(value);
    },
    applyDisabled: (on) => {
      if (on) input.setAttribute('disabled', '');
      else input.removeAttribute('disabled');
      if (on) endInteractions();
    },
    onRemove: () => {
      removeTypingEntry?.(false);
      removeTypingEntry = null;
      for (const [elem, type, fn] of listeners) elem.removeEventListener(type, fn as EventListener);
    },
  });
  const { binding, field, labelElem } = shell;

  /** A key's or a scrub's value: Alt's finer steps leave the grid for a tenth of the step */
  const constrain = (value: number, modifier = 1) =>
    constrainNumber(
      value,
      modifier < 1 && props.step !== undefined ? { ...props, step: props.step * modifier } : props
    );

  const endTyping = () => {
    isDirty = false;
    shell.setOwnError(null);
    removeTypingEntry?.(false);
    removeTypingEntry = null;
  };

  /** Puts the value's text back (Escape, an invalid text's blur); live writes are undone */
  const revertText = () => {
    if (!isDirty) return;
    const isLive = Boolean(props.live) && binding.isInGesture();
    endTyping();
    if (isLive) binding.change(textStartValue);
    drawText(binding.peek());
  };

  /** Writes the typed text; false (the error shown, the text kept) when it isn't a number */
  const commitText = () => {
    if (!isDirty) return true;
    const result = evaluateValueExpression(input.value, expressionUnits);
    if (result.value === undefined) {
      shell.setOwnError(result.error);
      return false;
    }
    endTyping();
    binding.change(constrain(result.value));
    drawText(binding.peek());
    return true;
  };

  /** Ends a key's or a scrub's gesture, with its `last: true` */
  const endGesture = () => {
    stepKey = null;
    shell.cmp.elem.removeAttribute('data-scrubbing');
    scrub = null;
    binding.commit();
  };

  // Everything in progress ends: a blur, disabling
  endInteractions = () => {
    if (stepKey !== null || scrub !== null) endGesture();
    if (isDirty && !commitText()) revertText();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || input.hasAttribute('disabled')) return;
    let target: number | null = null;
    const steps = STEP_KEYS[e.key];
    if (steps !== undefined) {
      const modifier = getModifier(e);
      // From the typed text when it's a number, else from the value
      const typed = isDirty
        ? evaluateValueExpression(input.value, expressionUnits).value
        : undefined;
      const from = typed ?? binding.peek();
      target = constrain(from + steps * (props.step ?? 1) * modifier, modifier);
    } else if (e.key === 'Home' && props.min !== undefined) {
      target = props.min;
    } else if (e.key === 'End' && props.max !== undefined) {
      target = props.max;
    } else if (e.key === 'Enter') {
      // Not stopped: in a form, Enter submits after the value is written
      commitText();
      return;
    } else if (e.key === 'Escape') {
      // Outside a HUD root (the overlay stack takes it first under one)
      if (!isDirty) return;
      e.preventDefault();
      e.stopPropagation();
      swallowNextKeyUp('Escape');
      revertText();
      return;
    } else {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    if (isDirty) endTyping();
    if (stepKey !== null && stepKey !== e.key) endGesture();
    stepKey = e.key;
    binding.step(target);
    drawText(binding.peek());
  };

  const onKeyUp = (e: KeyboardEvent) => {
    if (e.key !== stepKey) return;
    // The keydown was used: so is its keyup
    e.stopPropagation();
    endGesture();
  };

  const onInputEvent = () => {
    if (!isDirty) {
      isDirty = true;
      textStartValue = binding.peek();
      removeTypingEntry = pushOverlay({ elem: input, close: revertText });
    }
    onInput?.(input.value);
    if (!props.live) return;
    const result = evaluateValueExpression(input.value, expressionUnits);
    if (result.value !== undefined) binding.step(constrain(result.value));
  };

  /** Copies the value when no text is selected (D6); otherwise the input copies its selection */
  const onCopy = (e: ClipboardEvent) => {
    if (input.selectionStart !== input.selectionEnd || !e.clipboardData) return;
    e.preventDefault();
    e.clipboardData.setData('text/plain', String(binding.peek()));
  };

  /** A pasted number is the value (D6); any other text pastes into the input */
  const onPaste = (e: ClipboardEvent) => {
    const text = e.clipboardData?.getData('text/plain').trim() ?? '';
    if (!NUMBER_TEXT_REGEX.test(text)) return;
    e.preventDefault();
    if (isDirty) endTyping();
    binding.change(constrain(Number(text)));
    drawText(binding.peek());
  };

  // The label's scrub: pointer capture, no pointer lock (it prompts, and loses the cursor in an
  // embed); the keyboard path is the keys
  const onLabelPointerDown = (e: PointerEvent) => {
    if (e.button !== 0 || shell.isDisabled() || props.labelHidden) return;
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
      revertText();
    }
    const modifier = getModifier(e);
    scrub.raw += (e.clientX - scrub.lastX) * scrub.scale * modifier;
    scrub.lastX = e.clientX;
    binding.step(constrain(scrub.raw, modifier));
    drawText(binding.peek());
  };

  const onLabelPointerEnd = () => {
    if (!scrub) return;
    // A scrub's release is no click: the label would focus the input
    isClickAfterScrub = scrub.isMoving;
    if (scrub.isMoving) endGesture();
    else scrub = null;
  };

  const onLabelClick = (e: Event) => {
    if (!isClickAfterScrub) return;
    isClickAfterScrub = false;
    e.preventDefault();
  };

  const listeners: [HTMLElement, string, (e: never) => void][] = [
    [input, 'keydown', onKeyDown],
    [input, 'keyup', onKeyUp],
    [input, 'input', onInputEvent],
    [input, 'blur', () => endInteractions()],
    [input, 'copy', onCopy],
    [input, 'paste', onPaste],
    [labelElem, 'pointerdown', onLabelPointerDown],
    [labelElem, 'pointermove', onLabelPointerMove],
    [labelElem, 'pointerup', onLabelPointerEnd],
    [labelElem, 'pointercancel', onLabelPointerEnd],
    [labelElem, 'lostpointercapture', onLabelPointerEnd],
    [labelElem, 'click', onLabelClick],
  ];
  for (const [elem, type, fn] of listeners) elem.addEventListener(type, fn as EventListener);

  return field;
};
