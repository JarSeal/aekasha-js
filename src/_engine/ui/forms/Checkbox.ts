import { getPrimitiveValueKind } from './binding/Binding';
import { createField, type Field, type FieldProps, type FieldShell } from './Field';
import { buildMonitor } from './Monitor';
import './Checkbox.scss';
import '../styles/kit.scss';

/** What {@link createCheckbox} makes a checkbox from. */
export type CheckboxProps = FieldProps<boolean> & {
  /** Shows it as mixed (some of what it stands for on, some off) until it's clicked or set
   * (default false). */
  indeterminate?: boolean;
};

/** A checkbox {@link createCheckbox} made: the field's handle and its mixed state. */
export type Checkbox = Field<boolean> & {
  /** Shows it as mixed, or not; a click clears it. */
  setIndeterminate: (indeterminate: boolean) => void;
  /** Whether it shows as mixed */
  isIndeterminate: () => boolean;
};

/** What {@link createSwitch} makes a switch from. */
export type SwitchProps = FieldProps<boolean> & {
  /** Text shown after the switch while it's on (eg. 'On'); its state is said by the switch. */
  onText?: string;
  /** Text shown after the switch while it's off (eg. 'Off'). */
  offText?: string;
};

/** A switch {@link createSwitch} made: the field's handle. */
export type Switch = Field<boolean>;

/** The checkbox and the switch: one native checkbox, `role="switch"` for the switch */
const createToggleField = (
  props: FieldProps<boolean>,
  kind: 'checkbox' | 'switch',
  stateTexts?: { on?: string; off?: string }
) => {
  const input = document.createElement('input');
  input.setAttribute('type', 'checkbox');
  input.className = kind === 'switch' ? 'aekSwitch' : 'aekCheckbox';
  if (kind === 'switch') input.setAttribute('role', 'switch');
  const hasStateText = stateTexts?.on !== undefined || stateTexts?.off !== undefined;
  const control = hasStateText ? document.createElement('span') : input;
  const stateText = hasStateText ? document.createElement('span') : null;
  if (stateText) {
    control.className = 'aekSwitch__row';
    stateText.className = 'aekSwitch__text';
    // The switch says its state; the text is for the eye
    stateText.setAttribute('aria-hidden', 'true');
    control.append(input, stateText);
  }

  const shell: FieldShell<boolean> = createField<boolean>(props, {
    kind,
    valueKind: getPrimitiveValueKind<boolean>(),
    control,
    labelFor: input,
    flashElem: input,
    draw: (value) => {
      input.checked = value;
      if (stateText) stateText.textContent = (value ? stateTexts?.on : stateTexts?.off) ?? '';
    },
    applyDisabled: (on) => {
      if (on) input.setAttribute('disabled', '');
      else input.removeAttribute('disabled');
    },
    onRemove: () => input.removeEventListener('change', onChange),
  });

  // A click or Space (the browser's): one write with last: true
  const onChange = (): void => shell.binding.change(input.checked);
  input.addEventListener('change', onChange);
  return { shell, input };
};

/** `readonly`: a monitor of the state's text, 'Mixed' while it's indeterminate */
const createCheckboxMonitor = (props: CheckboxProps): Checkbox => {
  let isMixed = Boolean(props.indeterminate);
  const build = buildMonitor(props, {
    valueKind: getPrimitiveValueKind<boolean>(),
    getText: (on) => (isMixed ? 'Mixed' : on ? 'On' : 'Off'),
  });
  return Object.assign(build.shell.field, {
    setIndeterminate: (on: boolean) => {
      isMixed = on;
      build.redraw();
    },
    isIndeterminate: () => isMixed,
  });
};

/**
 * Creates a checkbox (p804 D7): a native `<input type="checkbox">` (drawn with `appearance:
 * none`) beside its label, its value a boolean from its binding (`{ target, key }`,
 * `{ get, set }` or `{ value }`), written there on each click (one `onChange` with `last: true`).
 * - Keys: Space flips it (the browser's); a click on the label does too.
 * - Mixed: `indeterminate` (and `setIndeterminate`) shows a bar, which a click clears; assistive
 *   tech hears "mixed".
 * - Parts: `.aekField` (`data-kind="checkbox"`, the control before the label row) with the
 *   shell's parts, its `.aekField__control` holding `.aekCheckbox` (`:checked`,
 *   `:indeterminate`, `data-flash`; the box is its `::before`, the mark its `::after`).
 * - Custom properties: `--aek-checkbox-size` (the box, default 16 px at the defaults), the
 *   fields' `--aek-field-control-bg`, `--aek-field-control-border-color`.
 * - A 24 px target in both densities (WCAG 2.5.8), the box drawn inside it.
 * - `readonly`: a monitor (`createMonitor`) of 'On', 'Off' or, mixed, 'Mixed'.
 * @example
 * ```ts
 * const shadows = createCheckbox({
 *   label: 'Shadows',
 *   target: settings,
 *   key: 'shadows',
 *   onChange: (on) => setShadowsEnabled(on),
 * });
 * settingsPanel.add(shadows.cmp);
 * ```
 */
export const createCheckbox = (props: CheckboxProps): Checkbox => {
  if (props.readonly) return createCheckboxMonitor(props);
  const { shell, input } = createToggleField(props, 'checkbox');
  input.indeterminate = Boolean(props.indeterminate);
  // The same object as onChange's `field`
  const checkbox: Checkbox = Object.assign(shell.field, {
    setIndeterminate: (on: boolean) => {
      input.indeterminate = on;
    },
    isIndeterminate: () => input.indeterminate,
  });
  return checkbox;
};

/**
 * Creates a switch (p804 D7): the APG switch on a native checkbox (`role="switch"`), a track and
 * a thumb after its label, for a setting that takes effect at once. Its value is a boolean from
 * its binding, written on each click (one `onChange` with `last: true`).
 * - Keys: Space flips it (the browser's); a click on the label does too.
 * - Parts: `.aekField` (`data-kind="switch"`, the label row before the control) with the shell's
 *   parts, its `.aekField__control` holding `.aekSwitch` (`:checked`, `data-flash`; the track is
 *   its `::before`, the thumb its `::after`), in a `.aekSwitch__row` with `.aekSwitch__text`
 *   when `onText` / `offText` are given.
 * - Custom properties: `--aek-switch-width`, `--aek-switch-height` (the track), the fields'
 *   `--aek-field-control-bg`, `--aek-field-control-border-color`.
 * - ARIA: `role="switch"`, its state the checkbox's (on / off); the state text is
 *   `aria-hidden`. A 24 px target in both densities.
 * - Motion: the thumb slides over `--aek-motion-fast` (at once under reduced motion).
 * - `readonly`: a monitor (`createMonitor`) of `onText` / `offText` (default 'On' / 'Off').
 * @example
 * ```ts
 * const vsync = createSwitch({
 *   label: 'V-sync',
 *   get: () => renderSettings.vsync,
 *   set: (on) => setVsync(on),
 *   onText: 'On',
 *   offText: 'Off',
 * });
 * settingsPanel.add(vsync.cmp);
 * ```
 */
export const createSwitch = (props: SwitchProps): Switch =>
  props.readonly
    ? buildMonitor(props, {
        valueKind: getPrimitiveValueKind<boolean>(),
        getText: (on) => (on ? props.onText ?? 'On' : props.offText ?? 'Off'),
      }).shell.field
    : createToggleField(props, 'switch', { on: props.onText, off: props.offText }).shell.field;
