// A field's typed text (p804 D3, D6): what the number field's and the text field's inputs share.
// Typing makes the text dirty: it's written on a commit (Enter, a blur) or on each valid keystroke
// with `live`, and Escape puts the value's text back through the overlay stack, so it goes no
// further (a dialog stays open).
import { pushOverlay, swallowNextKeyUp } from '../overlays/OverlayStack';
import type { Binding } from './binding/Binding';

/**
 * What `createTypedText` works on.
 * @internal
 */
export type TypedTextProps<T> = {
  input: HTMLInputElement | HTMLTextAreaElement;
  binding: Binding<T>;
  /** The typed text as a value, or the error to show (the value is kept) */
  parse: (text: string) => { value: T; error?: undefined } | { value?: undefined; error: string };
  /** Writes a value's text into the input */
  drawText: (value: T) => void;
  /** Shows the field's own error, or clears it */
  setError: (text: string | null) => void;
  /** Writes each valid keystroke (`last: false`) */
  live?: boolean;
  /** Each keystroke's text */
  onInput?: (text: string) => void;
};

/**
 * Tracks an input's typed text (p804 D3, D6): the `input` event makes it dirty (an overlay stack
 * entry, so Escape reverts it first), `commit()` writes it (`change`: one `last: true`, or the
 * end of the live writes), `revert()` puts the value's text back (and the value from before the
 * typing, after live writes), `end()` drops it without either (a key step, a paste took over).
 * The caller adds `onInput` as the input's `input` listener and calls `onEscape` from its keydown
 * (a key pressed outside a HUD root, where the stack doesn't listen).
 * @internal
 */
export const createTypedText = <T>(props: TypedTextProps<T>) => {
  const { input, binding, live } = props;
  let isDirty = false;
  /** The value when the typing started: what a revert writes back after live writes */
  let start: { value: T } | null = null;
  let removeEntry: ((returnFocus?: boolean) => void) | null = null;

  const end = () => {
    isDirty = false;
    start = null;
    props.setError(null);
    removeEntry?.(false);
    removeEntry = null;
  };

  const revert = () => {
    if (!isDirty) return;
    const before = start;
    const wasLive = Boolean(live) && binding.isInGesture();
    end();
    if (wasLive && before) binding.change(before.value);
    props.drawText(binding.peek());
  };

  /** Writes the text; false (its error shown, the text kept) when it doesn't parse */
  const commit = () => {
    if (!isDirty) return true;
    const result = props.parse(input.value);
    if (result.error !== undefined) {
      props.setError(result.error);
      return false;
    }
    end();
    binding.change(result.value as T);
    props.drawText(binding.peek());
    return true;
  };

  const onInput = () => {
    if (!isDirty) {
      isDirty = true;
      start = { value: binding.peek() };
      removeEntry = pushOverlay({ elem: input, close: revert });
    }
    props.onInput?.(input.value);
    if (!live) return;
    const result = props.parse(input.value);
    if (result.value !== undefined) binding.step(result.value);
  };

  /** Escape on dirty text outside a HUD root: reverts it and stops it; whether it did */
  const onEscape = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || !isDirty) return false;
    e.preventDefault();
    e.stopPropagation();
    swallowNextKeyUp('Escape');
    revert();
    return true;
  };

  return {
    isDirty: () => isDirty,
    commit,
    revert,
    end,
    onInput,
    onEscape,
    /** A blur's, or disabling's: the text is written, or put back when it doesn't parse */
    settle: () => {
      if (isDirty && !commit()) revert();
    },
    dispose: () => {
      removeEntry?.(false);
      removeEntry = null;
    },
  };
};
