import { getPrimitiveValueKind } from './binding/Binding';
import { evaluateValueExpression } from './binding/ValueExpression';
import { createValueFormatter, type NumberRules } from './binding/ValueText';
import { createField, type Field, type FieldProps, type FieldShell } from './Field';
import { createNumberSteps, getStepModifier, type NumberSteps } from './NumberSteps';
import { createTypedText } from './TypedText';
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
  formatter: ReturnType<typeof createValueFormatter>;
  /** Puts typed text back and ends a key's gesture: a pointer took over (a slider's track) */
  interrupt: () => void;
};

/** A drag's distance before a press on the label scrubs, so a click still focuses the input */
const SCRUB_THRESHOLD_PX = 3;
const NUMBER_TEXT_REGEX = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i;

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
  const { onInput, expressionUnits } = props;
  const formatter = createValueFormatter(props);
  const steps = createNumberSteps(props);
  /** The text last drawn (its aria-valuetext written): a draw that makes the same skips it */
  let shownText: string | null = null;
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
  /** Whether there's typed text (set below: the shell draws while it's made) */
  let isTyping = () => false;
  /** Ends what's in progress (set below: disabling can run while the shell is made) */
  let endInteractions = () => {};

  const box = document.createElement('span');
  box.className = 'aekField__box aekNumberField';
  const input = document.createElement('input');
  input.className = 'aekField__input aekNumberField__input';
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
    const text = formatter.getText(value);
    if (input.value !== text) input.value = text;
  };

  const shell = createField<number>(props, {
    kind: parts.kind,
    valueKind: getPrimitiveValueKind<number>(),
    control: parts.wrapBox?.(box) ?? box,
    labelFor: input,
    flashElem: box,
    draw: (value) => {
      // A draw is a change: the number is new, its text may not be (rounded to the same)
      input.setAttribute('aria-valuenow', String(value));
      const text = formatter.getText(value);
      if (text !== shownText) {
        shownText = text;
        input.setAttribute('aria-valuetext', formatter.getSpokenText(text));
      }
      // Typed text stays until it's written or put back
      if (!isTyping() && input.value !== text) input.value = text;
      parts.draw?.(value, text);
    },
    applyDisabled: (on) => {
      if (on) input.setAttribute('disabled', '');
      else input.removeAttribute('disabled');
      if (on) endInteractions();
      parts.applyDisabled?.(on);
    },
    onRemove: () => {
      typed.dispose();
      for (const [elem, type, fn] of listeners) elem.removeEventListener(type, fn as EventListener);
      parts.onRemove?.();
    },
  });
  const { binding, labelElem } = shell;
  const { constrain } = steps;

  /** A key's or a scrub's step: a write redraws through the shell, an equal value (at an end)
   * doesn't, and typed text it ended still shows */
  const stepTo = (value: number) => {
    const before = binding.peek();
    binding.step(value);
    if (binding.peek() === before) drawText(before);
  };

  const typed = createTypedText<number>({
    input,
    binding,
    parse: (text) => {
      const result = evaluateValueExpression(text, expressionUnits);
      return result.value === undefined ? result : { value: constrain(result.value) };
    },
    drawText,
    setError: shell.setOwnError,
    live: props.live,
    onInput,
  });
  isTyping = typed.isDirty;

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
    typed.settle();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || input.hasAttribute('disabled')) return;
    // A step from the typed text when it's a number, else from the value
    const target = steps.getKeyTarget(
      e,
      () =>
        (typed.isDirty()
          ? evaluateValueExpression(input.value, expressionUnits).value
          : undefined) ?? binding.peek()
    );
    if (target === null) {
      // Not stopped: in a form, Enter submits after the value is written
      if (e.key === 'Enter') typed.commit();
      // Outside a HUD root (the overlay stack takes it first under one)
      else if (e.key === 'Escape') typed.onEscape(e);
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    typed.end();
    if (stepKey !== null && stepKey !== e.key) endGesture();
    stepKey = e.key;
    stepTo(target);
  };

  const onKeyUp = (e: KeyboardEvent) => {
    if (e.key !== stepKey) return;
    // The keydown was used: so is its keyup
    e.stopPropagation();
    endGesture();
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
    typed.end();
    binding.change(constrain(Number(text)));
    drawText(binding.peek());
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
      typed.revert();
    }
    const modifier = getStepModifier(e);
    scrub.raw += (e.clientX - scrub.lastX) * scrub.scale * modifier;
    scrub.lastX = e.clientX;
    stepTo(constrain(scrub.raw, modifier));
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
    [input, 'input', typed.onInput],
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

  const interrupt = () => {
    if (stepKey !== null) endGesture();
    typed.revert();
  };
  return { shell, steps, formatter, interrupt };
};
