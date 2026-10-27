// The radio group and the segmented control (p804 D7): one value of a few, as native radios in a
// `radiogroup` the label names, so the arrows, Space and the group's one tab stop are the
// browser's. The segmented control is the same radios drawn as a row of segments: a value, not
// actions (a row of tool buttons is the button group's).
import { createTooltip, type Tooltip } from '../overlays/Tooltip';
import { getPrimitiveValueKind } from './binding/Binding';
import { createField, getChoiceClipboard, type Field, type FieldProps } from './Field';
import { buildMonitor } from './Monitor';
import './RadioGroup.scss';
import '../styles/kit.scss';

/** A radio's value: compared with `===`. */
export type RadioValue = string | number | boolean;

/**
 * One of a radio group's options.
 * @template T the value's type
 */
export type RadioOption<T extends RadioValue> = {
  /** What's written when it's picked. */
  value: T;
  /** Its text, and its accessible name. */
  label: string;
  /** Can't be picked (default false). */
  disabled?: boolean;
};

/**
 * One of a segmented control's options: a radio's, with an icon.
 * @template T the value's type
 */
export type SegmentOption<T extends RadioValue> = RadioOption<T> & {
  /** Raw HTML of an icon before the label (eg. `getSvgIcon('pause')`). */
  icon?: string;
  /** Shows the icon alone: the label is then its accessible name and its tooltip (default
   * false). */
  iconOnly?: boolean;
};

/**
 * What {@link createRadioGroup} makes a radio group from.
 * @template T the value's type
 */
export type RadioGroupProps<T extends RadioValue> = FieldProps<T> & {
  /** The options, in their order. */
  options: readonly RadioOption<T>[];
  /** A column (default) or a wrapping row. */
  orientation?: 'vertical' | 'horizontal';
};

/**
 * A radio group {@link createRadioGroup} made: the field's handle.
 * @template T the value's type
 */
export type RadioGroup<T extends RadioValue> = Field<T>;

/**
 * What {@link createSegmentedControl} makes a segmented control from.
 * @template T the value's type
 */
export type SegmentedControlProps<T extends RadioValue> = FieldProps<T> & {
  /** The segments, in their order. */
  options: readonly SegmentOption<T>[];
  /** The segments share the field's whole width (default false: each as wide as its content). */
  fill?: boolean;
};

/**
 * A segmented control {@link createSegmentedControl} made: the field's handle.
 * @template T the value's type
 */
export type SegmentedControl<T extends RadioValue> = Field<T>;

/** Each group's radios share a name of their own */
let groupCount = 0;

const span = (className: string, text?: string) => {
  const elem = document.createElement('span');
  elem.className = className;
  if (text !== undefined) elem.textContent = text;
  return elem;
};

/** `readonly`: a monitor of the picked option's label (none: empty) */
const buildChoiceMonitor = <T extends RadioValue>(
  props: FieldProps<T> & { options: readonly RadioOption<T>[] }
) =>
  buildMonitor(props, {
    valueKind: getPrimitiveValueKind<T>(),
    getText: (value) => props.options.find((option) => option.value === value)?.label ?? '',
  }).shell.field;

/** The radios in their group, the field around them, and the change that writes */
const createChoiceField = <T extends RadioValue>(
  props: FieldProps<T> & { options: readonly SegmentOption<T>[] },
  kind: 'radio' | 'segmented',
  group: HTMLElement,
  /** An option's element around its radio */
  buildOption: (option: SegmentOption<T>, input: HTMLInputElement) => HTMLElement,
  /** Runs when the field is removed: the options' own parts (a segment's tooltip) */
  onRemove?: () => void
) => {
  const { options } = props;
  const name = `aekRadio${++groupCount}`;
  const inputs = options.map((option, index) => {
    const input = document.createElement('input');
    input.setAttribute('type', 'radio');
    input.setAttribute('name', name);
    input.setAttribute('value', String(index));
    if (option.disabled) input.setAttribute('disabled', '');
    group.append(buildOption(option, input));
    return input;
  });

  // A pick (a click, the arrows, Space): one write with last: true
  const onChange = (e: Event) => {
    const index = inputs.indexOf(e.target as HTMLInputElement);
    if (index !== -1 && inputs[index].checked) shell.binding.change(options[index].value);
  };

  const shell = createField<T>(props, {
    kind,
    valueKind: getPrimitiveValueKind<T>(),
    control: group,
    isGroup: true,
    groupRole: 'radiogroup',
    clipboard: getChoiceClipboard(() => options),
    // The group is what the message describes and an error marks: a radio takes no aria-invalid
    messageFor: [group],
    flashElem: group,
    draw: (value) => {
      for (let i = 0; i < inputs.length; i++) {
        const on = options[i].value === value;
        if (inputs[i].checked !== on) inputs[i].checked = on;
      }
    },
    applyDisabled: (on) => {
      for (let i = 0; i < inputs.length; i++) {
        if (on || options[i].disabled) inputs[i].setAttribute('disabled', '');
        else inputs[i].removeAttribute('disabled');
      }
    },
    onRemove: () => {
      group.removeEventListener('change', onChange);
      onRemove?.();
    },
  });
  group.addEventListener('change', onChange);
  // Each radio's id: the field's `id` (else its control id) and its place
  const baseId = props.id ?? `${shell.cmp.id}__control`;
  inputs.forEach((input, index) => (input.id = `${baseId}-${index}`));
  // The focus goes where Tab would: the checked radio, else the first one that can be picked
  shell.field.focus = () =>
    (inputs.find((input) => input.checked) ?? inputs.find((input) => !input.disabled))?.focus();
  return shell;
};

/**
 * Creates a radio group (p804 D7): native radios in a `radiogroup` named by the label, one value
 * of a few from its binding (`{ target, key }`, `{ get, set }` or `{ value }`), written on each
 * pick (one `onChange` with `last: true`). A value none of the options has checks none.
 * - Keys: the browser's: Tab and Shift+Tab reach the group once (at the checked radio), the arrows
 *   move to the next or previous radio and pick it (wrapping), Space picks the focused one.
 * - Parts: `.aekField` (`data-kind="radio"`, with the shell's parts; its label a `<span>` naming
 *   the group) with `.aekRadioGroup` (`role="radiogroup"`, `data-orientation`, `data-flash`) of
 *   `<label class="aekRadio">`s, each an `.aekRadio__input` (`:checked`, `:disabled`: the ring is
 *   its `::before`, the dot its `::after`) and its `.aekRadio__label`.
 * - Custom properties: `--aek-radio-size` (the ring, default 16 px), the fields'
 *   `--aek-field-control-bg`, `--aek-field-control-border-color`, `--aek-field-flash-color`.
 * - ARIA: native radios, each named by its label; the hint or the error describes the group, which
 *   an error marks `aria-invalid`. Each radio is a 24 px target in both densities.
 * - Motion: a change from outside flashes a ring around the group once.
 * - `readonly`: a monitor (`createMonitor`) of the picked option's label.
 * @template T the value's type
 * @example
 * ```ts
 * const difficulty = createRadioGroup({
 *   label: 'Difficulty',
 *   target: settings,
 *   key: 'difficulty',
 *   options: [
 *     { value: 'easy', label: 'Easy' },
 *     { value: 'normal', label: 'Normal' },
 *     { value: 'hard', label: 'Hard' },
 *   ],
 *   onChange: (value) => setDifficulty(value),
 * });
 * settingsPanel.add(difficulty.cmp);
 * ```
 */
export const createRadioGroup = <T extends RadioValue>(
  props: RadioGroupProps<T>
): RadioGroup<T> => {
  if (props.readonly) return buildChoiceMonitor(props);
  const group = document.createElement('div');
  group.className = 'aekRadioGroup';
  group.setAttribute('data-orientation', props.orientation ?? 'vertical');
  return createChoiceField(props, 'radio', group, (option, input) => {
    const label = document.createElement('label');
    label.className = 'aekRadio';
    input.className = 'aekRadio__input';
    label.append(input, span('aekRadio__label', option.label));
    return label;
  }).field;
};

/**
 * Creates a segmented control (p804 D7): the radio group's native radios drawn as a row of
 * segments, each its text, an icon and its text, or an icon alone; one value of a few from its
 * binding, written on each pick (one `onChange` with `last: true`). A value, not actions: a row of
 * tool buttons is `createButtonGroup`.
 * - Keys: the radios' (the browser's): one tab stop at the picked segment, the arrows move and pick
 *   (wrapping), Space picks.
 * - Parts: `.aekField` (`data-kind="segmented"`) with `.aekSegmented` (`role="radiogroup"`,
 *   `data-fill`, `data-flash`) of `<label class="aekSegmented__segment">`s (`:has(:checked)` is the
 *   picked one), each a transparent `.aekSegmented__input` over the segment (its ring is the
 *   segment's) with `.aekSegmented__icon` and `.aekSegmented__label` (visually hidden with
 *   `iconOnly`).
 * - Custom properties: `--aek-segmented-selected-bg`, `--aek-segmented-selected-color` (the picked
 *   segment), the fields' `--aek-field-control-bg`, `--aek-field-control-border-color`,
 *   `--aek-field-radius`, `--aek-field-flash-color`.
 * - ARIA: native radios, each named by its label (an icon-only one's label is visually hidden, and
 *   a tooltip shows it); the hint or the error describes the group. Each segment is a 24 px target
 *   in both densities.
 * - Motion: the picked segment's colour changes over `--aek-motion-fast` (at once under reduced
 *   motion); a change from outside flashes a ring around the row once.
 * - `readonly`: a monitor (`createMonitor`) of the picked segment's label.
 * @template T the value's type
 * @example
 * ```ts
 * const view = createSegmentedControl({
 *   label: 'Camera',
 *   target: settings,
 *   key: 'camera',
 *   options: [
 *     { value: 'orbit', label: 'Orbit' },
 *     { value: 'follow', label: 'Follow' },
 *     { value: 'free', label: 'Free' },
 *   ],
 *   onChange: (value) => setCameraMode(value),
 * });
 * settingsPanel.add(view.cmp);
 * ```
 */
export const createSegmentedControl = <T extends RadioValue>(
  props: SegmentedControlProps<T>
): SegmentedControl<T> => {
  if (props.readonly) return buildChoiceMonitor(props);
  const group = document.createElement('div');
  group.className = 'aekSegmented';
  if (props.fill) group.setAttribute('data-fill', '');
  const tooltips: Tooltip[] = [];
  const buildSegment = (option: SegmentOption<T>, input: HTMLInputElement) => {
    const segment = document.createElement('label');
    segment.className = 'aekSegmented__segment';
    input.className = 'aekSegmented__input';
    segment.append(input);
    if (option.icon) {
      const icon = span('aekSegmented__icon');
      icon.setAttribute('aria-hidden', 'true');
      icon.innerHTML = option.icon;
      segment.append(icon);
    }
    const iconOnly = Boolean(option.icon && option.iconOnly);
    segment.append(
      span(iconOnly ? 'aekSegmented__label aekVisuallyHidden' : 'aekSegmented__label', option.label)
    );
    // An icon alone says what it is on hover and focus
    if (iconOnly) tooltips.push(createTooltip({ anchor: segment, text: option.label }));
    return segment;
  };
  return createChoiceField(props, 'segmented', group, buildSegment, () => {
    for (const tooltip of tooltips) tooltip.cmp.remove();
  }).field;
};
