// The colour field (p804 D8): a swatch that opens the colour panel in a popover (the picker, the
// palette, the recent colours and the eyedropper), the colour as text, and with alpha and an
// intensity their number parts: ColorParts.ts' parts in the field's shell. The value keeps its
// bound form and space (ColorValue.ts); the panel's recent colours are the page's
// (RecentColors.ts).
import { lwarn } from '../../../utils/Logger';
import {
  createObjectValueKind,
  getPrimitiveValueKind,
  type BindingChange,
  type BindingSource,
  type BindingValueKind,
} from '../binding/Binding';
import { roundToDecimals, type NumberRules } from '../binding/ValueText';
import { createField, type Field, type FieldClipboard, type FieldProps } from '../Field';
import { buildMonitor, readFirstValue } from '../Monitor';
import { createColorParts } from './ColorParts';
import {
  createColorCodec,
  formatColorHex,
  getColorForm,
  parseColorText,
  type ColorCodec,
  type ColorFieldValue,
  type Rgba,
} from './ColorValue';
import { addRecentColor } from './RecentColors';
import './ColorField.scss';
import '../../styles/kit.scss';

/**
 * A colour field's intensity (p804 D8's HDR): a number part after the colour, bound on its own
 * (a light's `intensity`, an emissive strength), with a number's rules.
 */
export type ColorIntensityProps = BindingSource<number> &
  NumberRules & {
    /** Its name, shown before it and said after the field's label (default 'Intensity'). */
    label?: string;
    /** A unit shown after it. */
    unit?: string;
    /** Every write of the intensity (p804 D3), as a field's `onChange`. */
    onChange?: (value: number, change: BindingChange<number>) => void;
  };

/**
 * What {@link createColorField} makes a colour field from.
 * @template T the bound value's form: a number, a hex string or an `{ r, g, b, a? }` object
 */
export type ColorFieldProps<T extends ColorFieldValue = ColorFieldValue> = FieldProps<T> & {
  /** Edits the alpha too: a number part after the text (0-1), and the text's alpha digits. A hex
   * string written with them, or an object's `a` (default false; a hex string bound with alpha
   * digits has it either way, a number never). */
  alpha?: boolean;
  /** The space an object's floats are in: `'srgb'` (default) or `'linear'`, three's working
   * space (a `THREE.Color`'s `r`, `g`, `b`). The text and the swatches are sRGB either way. */
  colorSpace?: 'srgb' | 'linear';
  /** An intensity after the colour, bound on its own (a light's). */
  intensity?: ColorIntensityProps;
  /** Swatches in the panel, any colour text each (`'#3fd8f2'`, `'rgb(…)'`). */
  palette?: readonly string[];
  /** Shows the page's recent colours in the panel and adds the colours set here to them (default
   * true). */
  recent?: boolean;
  /** Offers the browser's eyedropper in the panel, where it has one (default true). */
  eyeDropper?: boolean;
  /** Each keystroke's text, before it's written. */
  onInput?: (text: string) => void;
};

/**
 * A colour field {@link createColorField} made: the field's handle.
 * @template T the bound value's form
 */
export type ColorField<T extends ColorFieldValue = ColorFieldValue> = Field<T>;

/** An sRGB channel as `rgb()` writes it: 0-255 */
const toByte = (channel: number) => Math.round(Math.min(1, Math.max(0, channel)) * 255);

/**
 * A colour field's value as text for the fields' context menu (p805 D11): its text, a pasted colour
 * as a typed one, and Copy as hex, `rgb()` and sRGB floats.
 */
const getColorClipboard = <T extends ColorFieldValue>(codec: ColorCodec): FieldClipboard<T> => {
  const shown: Rgba = { r: 0, g: 0, b: 0, a: 1 };
  const read = (value: T) => codec.read(value, shown);
  const withAlpha = (parts: number[], color: Rgba) =>
    codec.hasAlpha ? [...parts, color.a] : parts;
  return {
    getText: (value) => formatColorHex(read(value), codec.hasAlpha),
    parse: (text) => {
      const result = parseColorText(text);
      return result.value ? { value: codec.write(result.value) as T } : { error: result.error };
    },
    copyAs: [
      { label: 'Hex', getText: (value) => formatColorHex(read(value), codec.hasAlpha) },
      {
        label: 'rgb()',
        getText: (value) => {
          const color = read(value);
          const bytes = [toByte(color.r), toByte(color.g), toByte(color.b)];
          return codec.hasAlpha
            ? `rgba(${bytes.join(', ')}, ${roundToDecimals(color.a, 3)})`
            : `rgb(${bytes.join(', ')})`;
        },
      },
      {
        label: 'sRGB floats',
        getText: (value) => {
          const color = read(value);
          return withAlpha([color.r, color.g, color.b], color)
            .map((channel) => roundToDecimals(channel, 4))
            .join(', ');
        },
      },
    ],
  };
};

/**
 * Creates a colour field (p804 D8): a swatch that opens the colour panel, and the colour as text,
 * its value from its binding (`{ target, key }`, `{ get, set }` or `{ value }`) and written back
 * in its form: a 24-bit number (`0xrrggbb`, a `THREE.Color`'s `getHex()`), a hex string
 * (`'#rrggbb'`, `'#rrggbbaa'`) or an `{ r, g, b, a? }` object of 0-1 floats, written in place (a
 * `THREE.Color` stays the instance; its linear floats with `colorSpace: 'linear'`).
 * - Text: typed hex (`#rgb` to `#rrggbbaa`, `0x…`), `rgb()`, `hsl()` or three numbers 0-1 is
 *   written on Enter or a blur (one `last: true`); an invalid one shows its error and keeps the
 *   value; Escape puts the value's text back (and goes no further). Shown as `#rrggbb`
 *   (`#rrggbbaa` with alpha). Ctrl/⌘+C with no text selected copies it; Ctrl/⌘+V of a colour
 *   sets it.
 * - The panel (a popover on the swatch): `palette`'s swatches, the page's recent colours (the
 *   ones the user set in any colour field, newest first: `getRecentColors`), and the browser's
 *   eyedropper ("Pick from the screen", where it has one). A swatch sets its colour (one
 *   `last: true`) and stays open, marking it as the current one.
 * - `alpha`: a number part (0-1, `%` typed as a hundredth) after the text. `intensity`: a number
 *   part of its own binding after that, read and refreshed with the field.
 * - Parts: `.aekField` (`data-kind="color"`) with the shell's parts, its `.aekField__control`
 *   holding `.aekColorField` (wrapping) with `button.aekColorField__swatch` (its
 *   `.aekColorField__chip` over a checkerboard), `.aekField__box.aekColorField__box` (`data-flash`)
 *   with `.aekField__input.aekColorField__input`, and each `.aekColorField__part`
 *   (`.aekColorField__partLabel` and a number's box); the panel `.aekPopover.aekColorPopover` with
 *   `.aekColorPanel` (`__group`, `__heading`, `__swatches`, `__swatch` with `aria-current` on the
 *   value's, `__eyeDropper`, `__empty`).
 * - Custom properties: the fields' `--aek-field-control-bg`, `--aek-field-control-border-color`,
 *   `--aek-field-radius`, `--aek-field-flash-color`; `--aek-color-field-checker` (the
 *   checkerboard's dark squares).
 * - ARIA: the text input is labelled by the `<label>`; the swatch is a button "Pick {label}"
 *   with the popover's `aria-haspopup="dialog"` and `aria-expanded`; the panel is a dialog named
 *   by the label, its swatches buttons named by their colour (`#3fd8f2`, with a tooltip) in
 *   groups named "Palette" and "Recent"; the parts' inputs are spin buttons named "{label} alpha"
 *   and "{label} {intensity's label}". An error marks every input.
 * - Motion: a change from outside flashes the text's box (and the intensity's box for its own).
 * - `readonly`: a monitor (`createMonitor`) of the colour's text.
 * @template T the bound value's form
 * @example
 * ```ts
 * const scheduler = createBindingScheduler();
 * const fog = createColorField({
 *   label: 'Fog colour',
 *   get: () => fogSettings.color.getHex(),
 *   set: (hex) => fogSettings.color.setHex(hex),
 *   palette: ['#9fb4c7', '#d7c4a3', '#3a4a5c'],
 *   scheduler,
 * });
 * const sun = createColorField({
 *   label: 'Sun',
 *   target: sunLight,
 *   key: 'color',
 *   colorSpace: 'linear',
 *   intensity: { target: sunLight, key: 'intensity', min: 0, step: 0.1 },
 *   scheduler,
 * });
 * settingsPanel.add(fog.cmp);
 * settingsPanel.add(sun.cmp);
 * ```
 */
export const createColorField = <T extends ColorFieldValue>(
  props: ColorFieldProps<T>
): ColorField<T> => {
  const first = readFirstValue<T>(props);
  const firstForm = getColorForm(first);
  if (firstForm === null) {
    lwarn(
      `Colour field "${props.label}": its value isn't a colour (a number, a string or { r, g, b }); it's read as a string.`
    );
  } else if (props.alpha && firstForm === 'number') {
    lwarn(`Colour field "${props.label}": a 24-bit number has no alpha; it's left out.`);
  }
  const codec = createColorCodec(firstForm ?? 'hex', {
    space: props.colorSpace,
    alpha: props.alpha,
    first,
  });
  const valueKind = (
    codec.form === 'float' ? createObjectValueKind<object>(codec.keys) : getPrimitiveValueKind()
  ) as BindingValueKind<T>;
  if (props.readonly) {
    const shown: Rgba = { r: 0, g: 0, b: 0, a: 1 };
    return buildMonitor(props, {
      valueKind,
      getText: (value) => formatColorHex(codec.read(value, shown), codec.hasAlpha),
    }).shell.field;
  }

  const parts = createColorParts<T>({
    label: props.label,
    codec,
    intensity: props.intensity,
    palette: props.palette,
    recent: props.recent,
    eyeDropper: props.eyeDropper,
    onInput: props.onInput,
  });

  const shell = createField<T>(
    {
      ...props,
      onChange: (value, change) => {
        // A colour the user set is a recent one (a step isn't: only its gesture's end)
        if (props.recent !== false && change.last && change.source === 'user') {
          addRecentColor(parts.getText(value));
        }
        props.onChange?.(value, change);
      },
    },
    {
      kind: 'color',
      valueKind,
      control: parts.row,
      labelFor: parts.input,
      messageFor: parts.messageFor,
      flashElem: parts.box,
      draw: parts.draw,
      applyDisabled: parts.applyDisabled,
      onRead: parts.onRead,
      onRemove: parts.dispose,
      clipboard: getColorClipboard(codec),
    }
  );
  parts.attach(shell.binding, {
    setError: shell.setOwnError,
    isDisabled: shell.isDisabled,
    idPrefix: shell.cmp.id,
  });

  return shell.field;
};
