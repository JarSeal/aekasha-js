// The select field (p804 D7): the drop-down (DropDown.ts, its API as it is) on a binding, with
// Tweakpane's two `options` forms, so a ported list is a rename.
import { getPrimitiveValueKind } from './binding/Binding';
import { createDropDown, type DropDownOption } from './DropDown';
import { createField, type Field, type FieldProps } from './Field';
import { buildMonitor } from './Monitor';
import type { RadioValue } from './RadioGroup';
import './SelectField.scss';
import '../styles/kit.scss';

/** A select's value: compared with `===` (a radio's). */
export type SelectValue = RadioValue;

/**
 * One option of a select's array form: its text (Tweakpane's `text`, or the kit's `label`) and
 * value.
 * @template T the value's type
 */
export type SelectOption<T extends SelectValue> = { value: T } & (
  | {
      /** Its text (Tweakpane's name). */
      text: string;
      label?: never;
    }
  | {
      /** Its text (the kit's name, as a radio's). */
      label: string;
      text?: never;
    }
);

/**
 * A select's options, in Tweakpane's two forms: an array of `{ text, value }` (or `{ label,
 * value }`), or an object of `{ [text]: value }` in its keys' order.
 * @template T the value's type
 */
export type SelectOptions<T extends SelectValue> =
  | readonly SelectOption<T>[]
  | Readonly<Record<string, T>>;

/**
 * What {@link createSelectField} makes a select field from.
 * @template T the value's type
 */
export type SelectFieldProps<T extends SelectValue> = FieldProps<T> & {
  /** The options, or a getter re-read on every open and refresh (a list that changes). */
  options: SelectOptions<T> | (() => SelectOptions<T>);
  /** The trigger's text when no option has the value. */
  placeholder?: string;
  /** A filter field over the list (the drop-down's `searchable`, default false). */
  searchable?: boolean;
  /** The filter field's placeholder and name, with `searchable` (default 'Search'). */
  searchPlaceholder?: string;
  /** Which side the list opens on when it fits there (default 'bottom'). */
  placement?: 'top' | 'bottom';
};

/**
 * A select field {@link createSelectField} made: the field's handle.
 * @template T the value's type
 */
export type SelectField<T extends SelectValue> = Field<T>;

/** The options as `{ label, value }`, either form */
const normalizeOptions = <T extends SelectValue>(options: SelectOptions<T>) => {
  if (Array.isArray(options)) {
    return (options as readonly SelectOption<T>[]).map((option) => ({
      label: option.text ?? option.label ?? '',
      value: option.value,
    }));
  }
  return Object.entries(options as Readonly<Record<string, T>>).map(([label, value]) => ({
    label,
    value,
  }));
};

/** `readonly`: a monitor of the option's text, a getter's list read at each draw */
const buildSelectMonitor = <T extends SelectValue>(props: SelectFieldProps<T>) => {
  const { options } = props;
  const isGetter = typeof options === 'function';
  const fixed = isGetter ? null : normalizeOptions(options);
  return buildMonitor(props, {
    valueKind: getPrimitiveValueKind<T>(),
    getText: (value) => {
      const entries = fixed ?? normalizeOptions((options as () => SelectOptions<T>)());
      return entries.find((entry) => entry.value === value)?.label ?? props.placeholder ?? '';
    },
    // A getter's labels may change while the value doesn't
    redrawOnRefresh: isGetter,
  }).shell.field;
};

/**
 * Creates a select field (p804 D7): the drop-down on a binding (`{ target, key }`, `{ get, set }`
 * or `{ value }`), one value of a list, written on each pick (one `onChange` with `last: true`).
 * `options` takes Tweakpane's two forms, `[{ text, value }]` and `{ [text]: value }` (and the
 * kit's `{ label, value }`), or a getter re-read on each open and refresh. A value no option has
 * shows `placeholder`.
 * - Keys: the drop-down's: Enter or Space on the trigger opens the list; in it the arrows, Home and
 *   End move, Enter or Space picks, Escape, Tab or a click outside closes it without a change and
 *   gives the focus back. With `searchable`, typing filters the list. A click on the label focuses
 *   the trigger.
 * - Parts: `.aekField` (`data-kind="select"`, with the shell's parts; its label a `<span>`) with
 *   the drop-down's (`.aekDropDown`, its `.aekDropDownTrigger` (`data-flash`, `data-placeholder`
 *   while no option has the value, its text then muted) with
 *   `.aekDropDownLabel` and `.aekDropDownCaret`; open, its list) filling the control's width.
 * - Custom properties: the fields' `--aek-field-flash-color`; the drop-down's look is its own
 *   (DropDown.scss).
 * - ARIA: the trigger's name is the label and the current option's text (`aria-labelledby`), its
 *   `aria-haspopup="listbox"` and `aria-expanded` the drop-down's; the list is named by the label;
 *   the hint or the error describes the trigger, which an error marks `aria-invalid`.
 * - Motion: a change from outside flashes the trigger once.
 * - `readonly`: a monitor (`createMonitor`) of the option's text (`placeholder` when none has the
 *   value), a getter's list read again on each refresh.
 * @template T the value's type
 * @example
 * ```ts
 * const shadowMapSize = createSelectField({
 *   label: 'Shadow map',
 *   target: light.shadow.mapSize,
 *   key: 'x',
 *   options: { '512': 512, '1024': 1024, '2048': 2048 },
 *   onChange: (size) => setShadowMapSize(size),
 * });
 * settingsPanel.add(shadowMapSize.cmp);
 * ```
 */
export const createSelectField = <T extends SelectValue>(
  props: SelectFieldProps<T>
): SelectField<T> => {
  if (props.readonly) return buildSelectMonitor(props);
  const fixed = typeof props.options === 'function' ? null : normalizeOptions(props.options);
  /** The options now: a getter's read when the drop-down asks (on open and refresh) */
  let entries = fixed ?? [];
  const readEntries = () => {
    if (!fixed) entries = normalizeOptions((props.options as () => SelectOptions<T>)());
    return entries;
  };
  /** The drop-down's option values are the indices: a value may be a number or a boolean */
  const getDropDownOptions = (): DropDownOption[] =>
    readEntries().map((entry, index) => ({ value: String(index), label: entry.label }));
  let shell: ReturnType<typeof createField<T>> | null = null;

  const dropDown = createDropDown({
    options: fixed ? getDropDownOptions() : getDropDownOptions,
    value: () => {
      if (!shell) return null;
      const value = shell.binding.peek();
      // The drop-down's refresh reads the value before the options: a getter's list is read here
      const index = readEntries().findIndex((entry) => entry.value === value);
      return index === -1 ? null : String(index);
    },
    // A pick: one write with last: true
    onChange: (index) => {
      const entry = entries[Number(index)];
      if (entry && shell) shell.binding.change(entry.value);
    },
    placeholder: props.placeholder,
    // The list's name
    title: props.label,
    searchable: props.searchable,
    searchPlaceholder: props.searchPlaceholder,
    placement: props.placement,
  });
  const trigger = dropDown.cmp.elem.querySelector<HTMLButtonElement>('.aekDropDownTrigger')!;
  const valueText = dropDown.cmp.elem.querySelector<HTMLElement>('.aekDropDownLabel')!;
  // The label names it, not a tooltip of its own
  trigger.removeAttribute('title');

  /** The trigger's text, and whether it's the placeholder (shown muted) */
  const drawValue = () => {
    dropDown.refresh();
    const value = shell?.binding.peek();
    const isPlaceholder = !entries.some((entry) => entry.value === value);
    if (isPlaceholder !== trigger.hasAttribute('data-placeholder')) {
      trigger.toggleAttribute('data-placeholder', isPlaceholder);
    }
  };

  shell = createField<T>(props, {
    kind: 'select',
    valueKind: getPrimitiveValueKind<T>(),
    control: dropDown.cmp.elem,
    labelFor: trigger,
    isLabelledBy: true,
    flashElem: trigger,
    draw: drawValue,
    // A getter's list may change while the value doesn't
    onRefresh: fixed ? undefined : drawValue,
    applyDisabled: (on) => {
      if (on) {
        dropDown.close();
        trigger.setAttribute('disabled', '');
      } else {
        trigger.removeAttribute('disabled');
      }
    },
    // The drop-down is in the field's DOM, not its CMP tree: its own removal closes its list
    onRemove: () => dropDown.cmp.remove(),
  });
  // Its name: the label, then the value it shows ("Quality, High")
  valueText.id = `${shell.cmp.id}__value`;
  trigger.setAttribute('aria-labelledby', `${shell.labelElem.id} ${valueText.id}`);
  // The first draw ran before `shell` was set: the value's text now
  drawValue();
  return shell.field;
};
