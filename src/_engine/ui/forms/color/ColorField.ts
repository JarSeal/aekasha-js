// The colour field (p804 D8): a swatch that opens the colour panel in a popover (the palette, the
// recent colours and the eyedropper; the picker joins them in Phase 5 section 2), the colour as
// text, and with alpha and an intensity their number parts. The value keeps its bound form and
// space (ColorValue.ts); the panel's recent colours are the page's (RecentColors.ts).
import type { CMPHandle } from '../../core/CMPTypes';
import { CMP } from '../../core/CMP';
import { createButton } from '../../components/Button';
import { createPopover } from '../../overlays/Popover';
import { createTooltip, type Tooltip } from '../../overlays/Tooltip';
import { lwarn } from '../../../utils/Logger';
import {
  createBinding,
  createObjectValueKind,
  getPrimitiveValueKind,
  type BindingChange,
  type BindingSource,
  type BindingValueKind,
} from '../binding/Binding';
import { createFlash } from '../binding/BindingScheduler';
import type { NumberRules } from '../binding/ValueText';
import { createField, type AnyFieldProps, type Field, type FieldProps } from '../Field';
import { buildMonitor } from '../Monitor';
import { createNumberInput, type NumberInput, type NumberTarget } from '../NumberInput';
import { createTypedText } from '../TypedText';
import {
  createColorCodec,
  formatColorHex,
  getColorForm,
  parseColorText,
  type ColorFieldValue,
  type Rgba,
} from './ColorValue';
import { addRecentColor, getRecentColors } from './RecentColors';
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

/** The browser's EyeDropper API (Chromium's), not in TypeScript's DOM types */
type EyeDropperConstructor = new () => {
  open: (options?: { signal?: AbortSignal }) => Promise<{ sRGBHex: string }>;
};

const getEyeDropper = () =>
  (globalThis as { EyeDropper?: EyeDropperConstructor }).EyeDropper ?? null;

const EYE_DROPPER_ICON =
  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.5 2.5a1.8 1.8 0 0 1 3 3l-1.5 1.5-3-3z"/><path d="M9 4l3 3-6.5 6.5H2.5v-3z"/></svg>';

const NO_SWATCHES_TEXT = 'Type a colour: #rrggbb, rgb(), hsl() or three numbers 0-1.';

/** The value at creation: a `{ value }`'s, a getter's or the target's */
const readFirstValue = <T>(props: AnyFieldProps<T>): T => {
  if (props.get) return props.get();
  if (props.target) return (props.target as Record<string, unknown>)[props.key] as T;
  return props.value as T;
};

/** A number part after the colour (the alpha, the intensity): its visible name and its box */
const addPart = (row: HTMLElement, name: string, spin: NumberInput) => {
  const part = document.createElement('span');
  part.className = 'aekColorField__part';
  const label = document.createElement('span');
  label.className = 'aekColorField__partLabel';
  // Said by the input's own name, which holds it
  label.setAttribute('aria-hidden', 'true');
  label.textContent = name;
  part.append(label, spin.box);
  row.append(part);
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
  /** The value drawn, in sRGB: kept, so a draw makes nothing but its text */
  const shown: Rgba = { r: 0, g: 0, b: 0, a: 1 };
  /** A read for anything else (a part's peek, a recent colour) */
  const scratch: Rgba = { r: 0, g: 0, b: 0, a: 1 };
  const getText = (value: T, into = shown) =>
    formatColorHex(codec.read(value, into), codec.hasAlpha);

  if (props.readonly) {
    return buildMonitor(props, { valueKind, getText: (value) => getText(value) }).shell.field;
  }

  const showsRecent = props.recent !== false;
  /** The text last drawn: a draw that makes the same writes nothing */
  let shownText: string | null = null;
  let isRemoved = false;
  let eyeDropperAbort: AbortController | null = null;
  /** The open panel's marks, while it's open */
  let markCurrent: ((text: string) => void) | null = null;
  /** Whether there's typed text (set below: the shell draws while it's made) */
  let isTyping = () => false;
  /** Ends what's in progress (set below: disabling can run while the shell is made) */
  let settle = () => {};
  /** Closes the panel (set below, as `settle`) */
  let closePanel = () => {};

  const row = document.createElement('span');
  row.className = 'aekColorField';
  const swatch = document.createElement('button');
  swatch.className = 'aekColorField__swatch';
  swatch.setAttribute('type', 'button');
  swatch.setAttribute('aria-label', `Pick ${props.label}`);
  const chip = document.createElement('span');
  chip.className = 'aekColorField__chip';
  chip.setAttribute('aria-hidden', 'true');
  swatch.append(chip);
  const box = document.createElement('span');
  box.className = 'aekField__box aekColorField__box';
  const input = document.createElement('input');
  input.className = 'aekField__input aekColorField__input';
  for (const [name, value] of [
    ['type', 'text'],
    ['autocomplete', 'off'],
    ['autocapitalize', 'off'],
    ['spellcheck', 'false'],
  ]) {
    input.setAttribute(name, value);
  }
  box.append(input);
  row.append(swatch, box);

  const alphaInput = codec.hasAlpha
    ? createNumberInput({
        min: 0,
        max: 1,
        step: 0.01,
        expressionUnits: { '%': 0.01 },
        ariaLabel: `${props.label} alpha`,
      })
    : null;
  if (alphaInput) addPart(row, 'Alpha', alphaInput);

  const intensityProps = props.intensity;
  const intensityLabel = intensityProps?.label ?? 'Intensity';
  const intensityInput = intensityProps
    ? createNumberInput({ ...intensityProps, ariaLabel: `${props.label} ${intensityLabel}` })
    : null;
  if (intensityInput) addPart(row, intensityLabel, intensityInput);
  const intensityBinding =
    intensityProps && intensityInput
      ? createBinding<number>({
          ...intensityProps,
          kind: getPrimitiveValueKind<number>(),
          onChange: (value, change) => {
            intensityInput.draw(value);
            intensityProps.onChange?.(value, change);
          },
        })
      : null;
  const intensityFlash = intensityInput ? createFlash(intensityInput.box) : null;

  const drawText = (value: T) => {
    const text = getText(value, scratch);
    if (input.value !== text) input.value = text;
  };

  const shell = createField<T>(
    {
      ...props,
      onChange: (value, change) => {
        // A colour the user set is a recent one (a step isn't: only its gesture's end)
        if (showsRecent && change.last && change.source === 'user') {
          addRecentColor(getText(value, scratch));
        }
        props.onChange?.(value, change);
      },
    },
    {
      kind: 'color',
      valueKind,
      control: row,
      labelFor: input,
      messageFor: [input, alphaInput?.input, intensityInput?.input].filter(
        (part): part is HTMLInputElement => Boolean(part)
      ),
      flashElem: box,
      draw: (value) => {
        const text = getText(value);
        alphaInput?.draw(shown.a);
        if (text === shownText) return;
        shownText = text;
        chip.style.setProperty('--aek-color-field-value', text);
        // Typed text stays until it's written or put back
        if (!isTyping() && input.value !== text) input.value = text;
        markCurrent?.(text);
      },
      applyDisabled: (on) => {
        if (on) {
          input.setAttribute('disabled', '');
          swatch.setAttribute('disabled', '');
          settle();
          closePanel();
        } else {
          input.removeAttribute('disabled');
          swatch.removeAttribute('disabled');
        }
        alphaInput?.applyDisabled(on);
        intensityInput?.applyDisabled(on);
      },
      onRead: (fromRefresh) => {
        if (!intensityBinding?.sync()) return;
        intensityInput?.draw(intensityBinding.peek());
        if (fromRefresh) intensityFlash?.flash();
      },
      onRemove: () => {
        isRemoved = true;
        eyeDropperAbort?.abort();
        typed.dispose();
        popover.cmp.remove();
        alphaInput?.dispose();
        intensityInput?.dispose();
        intensityFlash?.dispose();
        for (const [type, fn] of listeners) input.removeEventListener(type, fn as EventListener);
      },
    }
  );
  const { binding } = shell;

  const typed = createTypedText<T>({
    input,
    binding,
    parse: (text) => {
      const result = parseColorText(text);
      return result.value ? { value: codec.write(result.value) as T } : result;
    },
    drawText,
    setError: shell.setOwnError,
    onInput: props.onInput,
  });
  isTyping = typed.isDirty;
  settle = typed.settle;

  if (alphaInput) {
    const alphaTarget: NumberTarget = {
      peek: () => codec.read(binding.peek(), scratch).a,
      step: (alpha) => binding.step(codec.withAlpha(binding.peek(), alpha) as T),
      commit: () => binding.commit(),
      change: (alpha) => binding.change(codec.withAlpha(binding.peek(), alpha) as T),
      isInGesture: () => binding.isInGesture(),
    };
    alphaInput.attach(alphaTarget, shell.setOwnError);
  }
  if (intensityInput && intensityBinding) {
    intensityInput.attach(intensityBinding, shell.setOwnError);
    intensityInput.draw(intensityBinding.peek());
  }

  /** Sets a colour the user chose (a swatch, the eyedropper): one write with `last: true` */
  const setColor = (color: Rgba) => {
    typed.end();
    binding.change(codec.write(color) as T);
    drawText(binding.peek());
  };

  /** The browser's eyedropper: the colour under the pointer, the alpha kept */
  const pickFromScreenAsync = async () => {
    const EyeDropper = getEyeDropper();
    if (!EyeDropper || eyeDropperAbort) return;
    const abort = new AbortController();
    eyeDropperAbort = abort;
    try {
      const { sRGBHex } = await new EyeDropper().open({ signal: abort.signal });
      // The field may have gone, or been disabled, while the eyedropper was open
      if (isRemoved || shell.isDisabled()) return;
      const color = parseColorText(sRGBHex).value;
      if (!color) return;
      color.a = codec.read(binding.peek(), scratch).a;
      setColor(color);
    } catch {
      // Escape, or aborted by the removal: nothing picked
    } finally {
      if (eyeDropperAbort === abort) eyeDropperAbort = null;
    }
  };

  /** The popover's content, built on every open: the swatches as they are now */
  const buildPanel = (): CMPHandle => {
    const tooltips: Tooltip[] = [];
    const swatches: HTMLElement[] = [];
    const panel = CMP({
      class: 'aekColorPanel',
      onRemoveCmp: () => {
        for (const tooltip of tooltips) tooltip.cmp.remove();
        markCurrent = null;
      },
    });
    const addGroup = (title: string, colors: readonly string[]) => {
      const parsed = colors
        .map((text) => parseColorText(text).value)
        .filter((color): color is Rgba => Boolean(color));
      if (parsed.length === 0) return;
      const headingId = `${shell.cmp.id}__${title.toLowerCase()}`;
      const group = panel.add({
        class: 'aekColorPanel__group',
        attr: { role: 'group', 'aria-labelledby': headingId },
      });
      group.add({
        tag: 'p',
        class: 'aekColorPanel__heading',
        text: title,
        attr: { id: headingId },
      });
      const list = group.add({ class: 'aekColorPanel__swatches' });
      for (const color of parsed) {
        const text = formatColorHex(color, codec.hasAlpha);
        const button = list.add({
          tag: 'button',
          class: 'aekColorPanel__swatch',
          attr: { type: 'button', 'aria-label': text, 'data-color': text },
          style: { '--aek-color-field-value': text },
          onClick: () => setColor(color),
        });
        tooltips.push(createTooltip({ anchor: button.elem, text }));
        swatches.push(button.elem);
      }
    };
    addGroup('Palette', props.palette ?? []);
    if (showsRecent) addGroup('Recent', getRecentColors());
    if (props.eyeDropper !== false && getEyeDropper()) {
      panel.add(
        createButton({
          label: 'Pick from the screen',
          icon: EYE_DROPPER_ICON,
          size: 'sm',
          class: 'aekColorPanel__eyeDropper',
          onClick: () => void pickFromScreenAsync(),
        }).cmp
      );
    }
    if (panel.elem.childElementCount === 0) {
      panel.add({ tag: 'p', class: 'aekColorPanel__empty', text: NO_SWATCHES_TEXT });
    }
    markCurrent = (text) => {
      for (const elem of swatches) {
        if (elem.getAttribute('data-color') === text) elem.setAttribute('aria-current', 'true');
        else elem.removeAttribute('aria-current');
      }
    };
    if (shownText !== null) markCurrent(shownText);
    return panel;
  };

  const popover = createPopover({
    anchor: swatch,
    label: props.label,
    class: 'aekColorPopover',
    content: buildPanel,
  });
  closePanel = popover.close;

  /** Copies the colour's text when no text is selected (D6); otherwise the input copies its
   * selection */
  const onCopy = (e: ClipboardEvent) => {
    if (input.selectionStart !== input.selectionEnd || !e.clipboardData) return;
    e.preventDefault();
    e.clipboardData.setData('text/plain', getText(binding.peek(), scratch));
  };

  /** A pasted colour is the value (D6); any other text pastes into the input */
  const onPaste = (e: ClipboardEvent) => {
    const color = parseColorText(e.clipboardData?.getData('text/plain') ?? '').value;
    if (!color) return;
    e.preventDefault();
    setColor(color);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    // Not stopped: in a form, Enter submits after the value is written
    if (e.key === 'Enter' && !e.isComposing) typed.commit();
    // Outside a HUD root (the overlay stack takes it first under one)
    else if (e.key === 'Escape') typed.onEscape(e);
  };

  const listeners: [string, (e: never) => void][] = [
    ['input', () => typed.onInput()],
    ['keydown', onKeyDown],
    ['blur', () => typed.settle()],
    ['copy', onCopy],
    ['paste', onPaste],
  ];
  for (const [type, fn] of listeners) input.addEventListener(type, fn as EventListener);

  return shell.field;
};
