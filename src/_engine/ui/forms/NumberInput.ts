// A number part's spin button (p804 D6, D7): the text input with its typed expressions, keys and
// clipboard, writing through a target: a number field's binding, or one end of a range slider's
// (and later a vector's axis). The number field adds the shell and the label's scrub around it.
import type { Binding } from './binding/Binding';
import { evaluateValueExpression } from './binding/ValueExpression';
import { createValueFormatter, type NumberRules } from './binding/ValueText';
import { createNumberSteps } from './NumberSteps';
import { createTypedText } from './TypedText';
import './NumberField.scss';
import '../styles/kit.scss';

/**
 * What a spin button writes through: a field's binding, or a part of one (a range's end).
 * @internal
 */
export type NumberTarget = Pick<
  Binding<number>,
  'peek' | 'step' | 'commit' | 'change' | 'isInGesture'
>;

/**
 * What a spin button is made from: its rules, text and typing.
 * @internal
 */
export type NumberInputProps = NumberRules & {
  format?: (value: number) => string;
  unit?: string;
  expressionUnits?: Readonly<Record<string, number>>;
  live?: boolean;
  onInput?: (text: string) => void;
  /** Its accessible name when no `<label for>` gives one (a range's "Minimum {label}") */
  ariaLabel?: string;
  /** The field's whole value on the clipboard (a vector's axes, D6), in place of this part's
   * number: `getText` a copy's text; `paste` writes a pasted text that is the whole value (after
   * `endTyping`, which puts this part's typed text aside) and says whether it was */
  clipboard?: {
    getText: () => string;
    paste: (text: string, endTyping: () => void) => boolean;
  };
};

const NUMBER_TEXT_REGEX = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i;

/**
 * Makes a spin button (`span.aekField__box.aekNumberField` with its `<input role="spinbutton">`
 * and unit). It draws at once; `attach` binds its keys, typed text and clipboard to a target,
 * once the field holding it exists.
 * @internal
 */
export const createNumberInput = (props: NumberInputProps) => {
  const { expressionUnits } = props;
  const formatter = createValueFormatter(props);
  const steps = createNumberSteps(props);
  /** The text last drawn (its aria-valuetext written): a draw that makes the same skips it */
  let shownText: string | null = null;
  /** The value last drawn: a draw of the same skips the formatting and the attributes */
  let shownValue = NaN;
  /** The key whose keyup ends the key's gesture */
  let stepKey: string | null = null;
  let target: NumberTarget | null = null;
  let typed: ReturnType<typeof createTypedText<number>> | null = null;

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
  if (props.ariaLabel) input.setAttribute('aria-label', props.ariaLabel);
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

  /** A key's or a scrub's step: a write redraws through the field, an equal value (at an end)
   * doesn't, and typed text it ended still shows */
  const stepTo = (value: number) => {
    if (!target) return;
    const before = target.peek();
    target.step(value);
    if (target.peek() === before) drawText(before);
  };

  const endKeyGesture = () => {
    if (stepKey === null) return;
    stepKey = null;
    target?.commit();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (!target || !typed || e.ctrlKey || e.metaKey || input.hasAttribute('disabled')) return;
    const from = target;
    const typing = typed;
    // A step from the typed text when it's a number, else from the value
    const value = steps.getKeyTarget(
      e,
      () =>
        (typing.isDirty()
          ? evaluateValueExpression(input.value, expressionUnits).value
          : undefined) ?? from.peek()
    );
    if (value === null) {
      // Not stopped: in a form, Enter submits after the value is written
      if (e.key === 'Enter') typing.commit();
      // Outside a HUD root (the overlay stack takes it first under one)
      else if (e.key === 'Escape') typing.onEscape(e);
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    typing.end();
    if (stepKey !== null && stepKey !== e.key) endKeyGesture();
    stepKey = e.key;
    stepTo(value);
  };

  const onKeyUp = (e: KeyboardEvent) => {
    if (e.key !== stepKey) return;
    // The keydown was used: so is its keyup
    e.stopPropagation();
    endKeyGesture();
  };

  /** Copies the value when no text is selected (D6); otherwise the input copies its selection */
  const onCopy = (e: ClipboardEvent) => {
    if (!target || input.selectionStart !== input.selectionEnd || !e.clipboardData) return;
    e.preventDefault();
    e.clipboardData.setData('text/plain', props.clipboard?.getText() ?? String(target.peek()));
  };

  /** A pasted number is the value (D6), or the field's whole value; any other text pastes into
   * the input */
  const onPaste = (e: ClipboardEvent) => {
    const text = e.clipboardData?.getData('text/plain').trim() ?? '';
    if (target && props.clipboard?.paste(text, () => typed?.end())) {
      e.preventDefault();
      return;
    }
    if (!target || !NUMBER_TEXT_REGEX.test(text)) return;
    e.preventDefault();
    typed?.end();
    target.change(steps.constrain(Number(text)));
    drawText(target.peek());
  };

  /** Everything in progress ends: a blur, disabling */
  const endInteractions = () => {
    endKeyGesture();
    typed?.settle();
  };

  const listeners: [string, (e: never) => void][] = [
    ['keydown', onKeyDown],
    ['keyup', onKeyUp],
    ['input', () => typed?.onInput()],
    ['blur', endInteractions],
    ['copy', onCopy],
    ['paste', onPaste],
  ];

  return {
    box,
    input,
    steps,
    formatter,
    stepTo,
    /** Draws a value: `aria-valuenow`, `-valuetext` when the text changed, and the text unless
     * there's typed text; returns the text */
    draw: (value: number) => {
      // A part another part's write redraws keeps its value: nothing to format or write
      if (value !== shownValue || shownText === null) {
        shownValue = value;
        input.setAttribute('aria-valuenow', String(value));
        const text = formatter.getText(value);
        if (text !== shownText) {
          shownText = text;
          input.setAttribute('aria-valuetext', formatter.getSpokenText(text));
        }
      }
      // Typed text stays until it's written or put back (a revert redraws the same value)
      if (!typed?.isDirty() && input.value !== shownText) input.value = shownText;
      return shownText;
    },
    /** Binds the keys, typed text and clipboard to `to`; its own errors go to `setError` */
    attach: (to: NumberTarget, setError: (text: string | null) => void) => {
      target = to;
      typed = createTypedText<number>({
        input,
        binding: to,
        parse: (text) => {
          const result = evaluateValueExpression(text, expressionUnits);
          return result.value === undefined ? result : { value: steps.constrain(result.value) };
        },
        drawText,
        setError,
        live: props.live,
        onInput: props.onInput,
      });
      for (const [type, fn] of listeners) input.addEventListener(type, fn as EventListener);
    },
    applyDisabled: (on: boolean) => {
      if (on) input.setAttribute('disabled', '');
      else input.removeAttribute('disabled');
      if (on) endInteractions();
    },
    endInteractions,
    /** Puts typed text back without writing it (a scrub or a track took over) */
    revertTyping: () => typed?.revert(),
    /** Puts typed text back and ends a key's gesture: a pointer took over (a slider's track) */
    interrupt: () => {
      endKeyGesture();
      typed?.revert();
    },
    dispose: () => {
      typed?.dispose();
      for (const [type, fn] of listeners) input.removeEventListener(type, fn as EventListener);
    },
  };
};

/**
 * A spin button `createNumberInput` made.
 * @internal
 */
export type NumberInput = ReturnType<typeof createNumberInput>;
