// The field shell (p804 D5): the label, the control a field puts in it, the reset button and the
// message line, around the field's binding (binding/Binding.ts) and its scheduler entry
// (binding/BindingScheduler.ts). Every field is made with it; its props and handle types are
// public through the fields, `createField` isn't.
import type { CMPAttr, CMPHandle } from '../core/CMPTypes';
import { CMP, classes } from '../core/CMP';
import { createButton } from '../components/Button';
import { createTooltip } from '../overlays/Tooltip';
import {
  createBinding,
  type Binding,
  type BindingChange,
  type BindingSource,
  type BindingValueKind,
} from './binding/Binding';
import {
  addScheduledBinding,
  createFlash,
  type BindingScheduler,
} from './binding/BindingScheduler';
import './Field.scss';
import '../styles/kit.scss';

/**
 * A field prop that is a value, or a function re-read on every refresh (Tweakpane's and the
 * debugger's `hidden` and `disabled`).
 * @template T the value's type
 */
export type FieldDyn<T> = T | (() => T);

/**
 * What a field's `onChange` gets with its value: the binding's event (`prev`, `last`, `source`)
 * and the field's handle.
 * @template T the value's type
 */
export type FieldChange<T> = BindingChange<T> & {
  /** The field that changed. */
  field: Field<T>;
};

/**
 * The props every field takes (p804 D5): the binding (one of `{ target, key }`, `{ get, set }`
 * and `{ value }`), the label and the rest of the shell.
 * @template T the value's type
 */
export type FieldProps<T> = BindingSource<T> & {
  /** The field's name: shown, and its accessible name. */
  label: string;
  /** Keeps the label as the accessible name only, not shown (default false). */
  labelHidden?: boolean;
  /** A line of help under the control, which it's described by. */
  hint?: string;
  /** What the reset button and `reset()` write (default: the value at creation). */
  default?: T;
  /** Disables the field: a value, or a function re-read on every refresh (default false). */
  disabled?: FieldDyn<boolean>;
  /** Hides the field: a value, or a function re-read on every refresh (default false). A hidden
   * field isn't read; it's read once when it shows. */
  hidden?: FieldDyn<boolean>;
  /** Every write of the value (p804 D3): each step of a drag or a held key with `last: false`,
   * then once with `last: true` on the release, Enter, a blur or the keyup; a click, a pick, a
   * typed value or a reset once with `last: true`. A refresh from the bound value never calls it;
   * `setValue` does with `source: 'api'`. */
  onChange?: (value: T, change: FieldChange<T>) => void;
  /** The host's scheduler (`createBindingScheduler`), whose `refresh()` reads the field. Without
   * one, the field is read by its own `refresh()` only. */
  scheduler?: BindingScheduler;
  /** Also reads the bound value on the scheduler's tick, every this many ms (0: every frame):
   * an edit field that follows a value changing on its own. */
  interval?: number;
  /** Extra classes for the field's element. */
  class?: string | string[];
  /** Extra attributes for the field's element. */
  attr?: CMPAttr;
  /** The control's element id (default: a generated one). */
  id?: string;
};

/**
 * A field's handle, which each field's own extends (p804 D5).
 * @template T the value's type
 */
export type Field<T> = {
  /** The field's element: add it where it goes. `cmp.remove()` disposes of it (its scheduler
   * entry, listeners, timers and tooltip). */
  cmp: CMPHandle;
  /** The bound value, read now (a copy for an object). */
  getValue: () => T;
  /** Writes the value: `onChange` gets `source: 'api'`, or nothing with `silent` (an undo's). A
   * value equal to the bound one writes nothing. */
  setValue: (value: T, options?: { silent?: boolean }) => void;
  /** Reads the bound value and the `hidden` and `disabled` functions; a value changed from
   * outside flashes. Never calls `onChange`. */
  refresh: () => void;
  /** Writes the default as the user's change (`source: 'user'`, so an undo records it). */
  reset: () => void;
  /** Disables or enables the field (in place of a `disabled` function). */
  setDisabled: (disabled: boolean) => void;
  /** Hides or shows the field (in place of a `hidden` function). */
  setHidden: (hidden: boolean) => void;
  /** Shows an error under the control (`aria-invalid`, the danger colour and its mark), or with
   * `null` takes it away. */
  setError: (text: string | null) => void;
  /** Focuses the control. */
  focus: () => void;
};

/**
 * What a field gives the shell: its control and how it draws.
 * @internal
 */
export type FieldSpec<T> = {
  /** `data-kind` on the field's element (`number`, `text`, `checkbox`) */
  kind: string;
  /** How the value is compared and copied */
  valueKind: BindingValueKind<T>;
  /** The control, added after the label row: one labelled element (`<label for>` its focusable
   * part, `labelFor`), or with `isGroup` a group named by the label (`aria-labelledby`) */
  control: HTMLElement;
  /** The focusable part the label is for and the message describes (default `control`) */
  labelFor?: HTMLElement;
  /** A group of parts (a vector's axes): the label is a `<span>` naming the control */
  isGroup?: boolean;
  /** The focusable part isn't labelable (a `role="slider"` thumb): the label is a `<span>` it's
   * `aria-labelledby`, and a click on it focuses the part */
  isLabelledBy?: boolean;
  /** The element an outside change flashes (default `control`) */
  flashElem?: HTMLElement;
  /** Draws the value into the control: after every write and every read that changed it */
  draw: (value: T) => void;
  /** Sets the control's own disabled state */
  applyDisabled: (disabled: boolean) => void;
  /** Never flashes (a monitor) */
  isMonitor?: boolean;
  /** Runs when the field is removed: the control's own listeners, timers, overlay entries */
  onRemove?: () => void;
};

/**
 * What `createField` gives back to the field.
 * @internal
 */
export type FieldShell<T> = {
  cmp: CMPHandle;
  binding: Binding<T>;
  /** The handle the field returns (or spreads into its own) */
  field: Field<T>;
  /** The label element (a number's scrub reads its pointer) */
  labelElem: HTMLElement;
  /** Whether the field is disabled now */
  isDisabled: () => boolean;
  /** Shows the field's own error (an invalid typed expression) over `setError`'s, or clears it */
  setOwnError: (text: string | null) => void;
};

const RESET_ICON =
  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 8.5a4.5 4.5 0 1 0 1.3-3.7"/><path d="M3.5 2.5v3h3"/></svg>';

const resolveDyn = <T>(value: FieldDyn<T> | undefined, fallback: T) =>
  value === undefined ? fallback : typeof value === 'function' ? (value as () => T)() : value;

const setAttrIf = (elem: Element, name: string, on: boolean, value = '') => {
  if (on) elem.setAttribute(name, value);
  else elem.removeAttribute(name);
};

/**
 * Makes a field's shell (p804 D5) around the control a field built: the label (a `<label for>`
 * its part, or a group's name), the reset button (shown while the value isn't the default), the
 * message line (the hint, or an error with `aria-invalid`), `hidden` / `disabled`, the binding
 * with the field's `onChange`, and the scheduler entry (an outside change flashes).
 * @internal
 */
export const createField = <T>(props: FieldProps<T>, spec: FieldSpec<T>): FieldShell<T> => {
  const { valueKind } = spec;
  const labelFor = spec.labelFor ?? spec.control;
  let hiddenProp = props.hidden;
  let disabledProp = props.disabled;
  let isHidden = false;
  let isDisabled = false;
  let appError: string | null = null;
  let ownError: string | null = null;
  let removeEntry: (() => void) | null = null;

  const cmp = CMP({
    class: classes('aekField', props.class),
    attr: { ...props.attr, 'data-kind': spec.kind },
    onRemoveCmp: () => {
      removeEntry?.();
      removeEntry = null;
      flash.dispose();
      labelTooltip.cmp.remove();
      labelElem.removeEventListener('click', onLabelClick);
      spec.onRemove?.();
    },
  });
  const root = cmp.elem;
  const controlId = props.id ?? `${cmp.id}__control`;
  const labelId = `${cmp.id}__label`;
  const messageId = `${cmp.id}__message`;

  // The label row: the label and the reset button
  const head = cmp.add({ class: 'aekField__head' });
  const labelElem = document.createElement(spec.isGroup || spec.isLabelledBy ? 'span' : 'label');
  labelElem.className = classes(
    'aekField__label',
    props.labelHidden ? 'aekVisuallyHidden' : null
  ).join(' ');
  labelElem.id = labelId;
  labelElem.textContent = props.label;
  head.elem.append(labelElem);
  // A `<label for>` focuses its control on a click; a span naming a part does it here
  const onLabelClick = () => {
    if (!isDisabled) labelFor.focus();
  };
  if (spec.isGroup) {
    spec.control.setAttribute('role', 'group');
    spec.control.setAttribute('aria-labelledby', labelId);
  } else {
    labelFor.id = controlId;
    if (spec.isLabelledBy) {
      labelFor.setAttribute('aria-labelledby', labelId);
      labelElem.addEventListener('click', onLabelClick);
    } else {
      labelElem.setAttribute('for', controlId);
    }
  }
  // A cut label's whole text (a long name in a narrow column)
  const labelTooltip = createTooltip({
    anchor: labelElem,
    text: props.label,
    onlyWhenTruncated: true,
  });

  // Its handle comes after the binding: `reset` reads both
  const resetButton = createButton({
    label: `Reset ${props.label}`,
    variant: 'ghost',
    size: 'sm',
    icon: RESET_ICON,
    iconOnly: true,
    class: 'aekField__reset',
    onClick: () => {
      // The value is the default again, which hides the button: the focus goes to the control
      const hadFocus = document.activeElement === resetButton.cmp.elem;
      field.reset();
      if (hadFocus) labelFor.focus();
    },
  });
  resetButton.cmp.elem.setAttribute('hidden', '');
  head.add(resetButton.cmp);

  const controlRow = cmp.add({ class: 'aekField__control' });
  controlRow.elem.append(spec.control);

  const message = document.createElement('p');
  message.className = 'aekField__message';
  message.id = messageId;
  message.setAttribute('hidden', '');
  root.append(message);

  const flash = createFlash(spec.flashElem ?? spec.control);

  const drawMessage = () => {
    const error = ownError ?? appError;
    const text = error ?? props.hint ?? '';
    message.textContent = text;
    setAttrIf(message, 'hidden', !text);
    setAttrIf(message, 'data-type', Boolean(text), error ? 'error' : 'hint');
    setAttrIf(root, 'data-invalid', Boolean(error));
    setAttrIf(labelFor, 'aria-invalid', Boolean(error), 'true');
    setAttrIf(labelFor, 'aria-describedby', Boolean(text), messageId);
  };

  // Its onChange runs only after the creation, when `draw` and `field` exist
  const binding = createBinding<T>({
    ...(props as BindingSource<T>),
    kind: valueKind,
    onChange: (value, change) => {
      draw();
      props.onChange?.(value, { ...change, field });
    },
  });
  const defaultValue = valueKind.copy(props.default ?? binding.peek());

  /** Whether the reset button is hidden: written on a change only (a draw runs every frame for a
   * live field whose value changes, D4) */
  let isResetHidden = true;
  const draw = () => {
    spec.draw(binding.peek());
    // Shown (a tab stop) only while the value isn't the default
    const isDefault = valueKind.equals(binding.peek(), defaultValue);
    if (isDefault === isResetHidden) return;
    isResetHidden = isDefault;
    setAttrIf(resetButton.cmp.elem, 'hidden', isDefault);
  };

  const applyDisabled = (on: boolean) => {
    if (on === isDisabled) return;
    isDisabled = on;
    setAttrIf(root, 'data-disabled', on);
    spec.applyDisabled(on);
    resetButton.setDisabled(on);
  };

  const applyHidden = (on: boolean) => {
    if (on === isHidden) return;
    isHidden = on;
    setAttrIf(root, 'hidden', on);
    // Read once when it shows: it wasn't read while hidden
    if (!on) read(false);
  };

  const readState = () => {
    applyHidden(resolveDyn(hiddenProp, false));
    applyDisabled(resolveDyn(disabledProp, false));
  };

  const read = (fromRefresh: boolean) => {
    if (!binding.sync()) return;
    draw();
    if (fromRefresh && !spec.isMonitor) flash.flash();
  };

  const field: Field<T> = {
    cmp,
    getValue: () => binding.getValue(),
    setValue: (value, options) => {
      binding.setValue(value, options);
      // A silent write fires nothing, so nothing drew it
      if (options?.silent) draw();
    },
    refresh: () => {
      readState();
      if (!isHidden) read(true);
    },
    reset: () => binding.change(valueKind.copy(defaultValue)),
    setDisabled: (on) => {
      disabledProp = on;
      applyDisabled(on);
    },
    setHidden: (on) => {
      hiddenProp = on;
      applyHidden(on);
    },
    setError: (text) => {
      appError = text;
      drawMessage();
    },
    focus: () => labelFor.focus(),
  };

  readState();
  drawMessage();
  draw();
  if (props.scheduler) {
    removeEntry = addScheduledBinding(props.scheduler, {
      read,
      readState,
      isShown: () => root.isConnected && !root.closest('[hidden]'),
      interval: props.interval,
    });
  }

  return {
    cmp,
    binding,
    field,
    labelElem,
    isDisabled: () => isDisabled,
    setOwnError: (text) => {
      if (text === ownError) return;
      ownError = text;
      drawMessage();
    },
  };
};
