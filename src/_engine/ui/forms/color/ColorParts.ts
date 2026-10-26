// A colour's parts (p804 D8), out of the colour field so the gradient editor edits a stop's colour
// with them: the swatch that opens the colour panel in a popover (the picker, the palette, the
// recent colours and the eyedropper), the colour as text, and with alpha and an intensity their
// number parts. They're built first and attached to a target once the field holding them exists,
// as the number input is (NumberInput.ts).
import type { CMPHandle } from '../../core/CMPTypes';
import { CMP } from '../../core/CMP';
import { createButton } from '../../components/Button';
import { createPopover } from '../../overlays/Popover';
import { createTooltip, type Tooltip } from '../../overlays/Tooltip';
import { createBinding, getPrimitiveValueKind, type Binding } from '../binding/Binding';
import { createFlash } from '../binding/BindingScheduler';
import { createNumberInput, type NumberInput, type NumberTarget } from '../NumberInput';
import { createTypedText } from '../TypedText';
import type { ColorIntensityProps } from './ColorField';
import {
  createColorPicker,
  isColorPickerLoaded,
  loadColorPickerAsync,
  type ColorPicker,
} from './ColorPicker';
import {
  formatColorHex,
  hsvaToRgba,
  parseColorText,
  rgbaToHsva,
  type ColorCodec,
  type ColorFieldValue,
  type Hsva,
  type Rgba,
} from './ColorValue';
import { getRecentColors } from './RecentColors';
import './ColorField.scss';
import '../../styles/kit.scss';

/**
 * What a colour's parts write through: a field's binding, or a part of one (a gradient's stop).
 * @internal
 */
export type ColorTarget<T> = Pick<
  Binding<T>,
  'peek' | 'step' | 'commit' | 'change' | 'isInGesture'
>;

/**
 * What a colour's parts are made from.
 * @internal
 */
export type ColorPartsProps = {
  /** The colour's name: the panel's, and in the parts' names ("{label} alpha") */
  label: string;
  /** How the value is read and written (its form, space and alpha) */
  codec: ColorCodec;
  intensity?: ColorIntensityProps;
  palette?: readonly string[];
  /** Shows the page's recent colours in the panel (default true) */
  recent?: boolean;
  eyeDropper?: boolean;
  onInput?: (text: string) => void;
  /** The text input's name where no `<label for>` gives one (a gradient's stop colour) */
  ariaLabel?: string;
  /** The swatch's name (default "Pick {label}") */
  pickLabel?: string;
};

/**
 * What the parts get from the field holding them, at `attach`.
 * @internal
 */
export type ColorPartsHost = {
  /** Shows the field's own error (an invalid typed colour), or clears it */
  setError: (text: string | null) => void;
  isDisabled: () => boolean;
  /** A prefix for the panel's ids (the field's CMP id) */
  idPrefix: string;
};

/** The browser's EyeDropper API (Chromium's), not in TypeScript's DOM types */
type EyeDropperConstructor = new () => {
  open: (options?: { signal?: AbortSignal }) => Promise<{ sRGBHex: string }>;
};

const getEyeDropper = () =>
  (globalThis as { EyeDropper?: EyeDropperConstructor }).EyeDropper ?? null;

const EYE_DROPPER_ICON =
  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.5 2.5a1.8 1.8 0 0 1 3 3l-1.5 1.5-3-3z"/><path d="M9 4l3 3-6.5 6.5H2.5v-3z"/></svg>';

const NO_SWATCHES_TEXT = 'Type a colour: #rrggbb, rgb(), hsl() or three numbers 0-1.';

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
 * Makes a colour's parts (`.aekColorField`: the swatch, the text's box, the alpha's and the
 * intensity's parts, and the panel's popover on the swatch). They draw at once; `attach` binds the
 * typed text, the parts' keys, the panel and the clipboard to a target, once the field exists.
 * @internal
 */
export const createColorParts = <T extends ColorFieldValue>(props: ColorPartsProps) => {
  const { codec } = props;
  /** The value drawn, in sRGB: kept, so a draw makes nothing but its text */
  const shown: Rgba = { r: 0, g: 0, b: 0, a: 1 };
  /** A read for anything else (a part's peek, the text's redraw) */
  const scratch: Rgba = { r: 0, g: 0, b: 0, a: 1 };
  const getText = (value: T, into = shown) =>
    formatColorHex(codec.read(value, into), codec.hasAlpha);

  /** The text last drawn: a draw that makes the same writes nothing */
  let shownText: string | null = null;
  let isRemoved = false;
  let eyeDropperAbort: AbortController | null = null;
  /** The open panel's marks, while it's open */
  let markCurrent: ((text: string) => void) | null = null;
  /** The target and its field, once attached */
  let target: ColorTarget<T> | null = null;
  let host: ColorPartsHost | null = null;
  let typed: ReturnType<typeof createTypedText<T>> | null = null;
  /** The open panel's picker, once it's loaded */
  let picker: ColorPicker | null = null;
  /** While the picker writes: its own value isn't drawn back into it (it rounds to whole units,
   * and a colour at black or grey has no hue to give it back) */
  let isPickerWriting = false;
  /** What had the focus right after the panel opened: the picker takes it once it's loaded, unless
   * the user moved it meanwhile */
  let focusAtOpen: Element | null = null;

  const row = document.createElement('span');
  row.className = 'aekColorField';
  const swatch = document.createElement('button');
  swatch.className = 'aekColorField__swatch';
  swatch.setAttribute('type', 'button');
  swatch.setAttribute('aria-label', props.pickLabel ?? `Pick ${props.label}`);
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
  if (props.ariaLabel) input.setAttribute('aria-label', props.ariaLabel);
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

  /** Sets a colour the user chose (a swatch, the eyedropper): one write with `last: true` */
  const setColor = (color: Rgba) => {
    if (!target) return;
    typed?.end();
    target.change(codec.write(color) as T);
    drawText(target.peek());
  };

  /** The browser's eyedropper: the colour under the pointer, the alpha kept */
  const pickFromScreenAsync = async () => {
    const EyeDropper = getEyeDropper();
    if (!EyeDropper || eyeDropperAbort || !target) return;
    const abort = new AbortController();
    eyeDropperAbort = abort;
    try {
      const { sRGBHex } = await new EyeDropper().open({ signal: abort.signal });
      // The field may have gone, or been disabled, while the eyedropper was open
      if (isRemoved || !target || host?.isDisabled()) return;
      const color = parseColorText(sRGBHex).value;
      if (!color) return;
      color.a = codec.read(target.peek(), scratch).a;
      setColor(color);
    } catch {
      // Escape, or aborted by the removal: nothing picked
    } finally {
      if (eyeDropperAbort === abort) eyeDropperAbort = null;
    }
  };

  /** A move of the picker: a step of its gesture (D3), the alpha the value's where it has none */
  const onPickerStep = (hsva: Hsva) => {
    if (!target || host?.isDisabled()) return;
    const color = hsvaToRgba(hsva);
    if (!codec.hasAlpha) color.a = codec.read(target.peek(), scratch).a;
    typed?.end();
    isPickerWriting = true;
    try {
      target.step(codec.write(color) as T);
    } finally {
      isPickerWriting = false;
    }
  };

  /** Puts the picker in its slot at the panel's top, showing the value */
  const attachPicker = (slot: HTMLElement) => {
    picker = createColorPicker({
      alpha: codec.hasAlpha,
      onStep: onPickerStep,
      onEnd: () => target?.commit(),
    });
    if (target) picker.setColor(rgbaToHsva(codec.read(target.peek(), scratch)));
    slot.removeAttribute('data-loading');
    slot.append(picker.elem);
  };

  /** The popover's content, built on every open: the picker and the swatches as they are now */
  const buildPanel = (): CMPHandle => {
    const tooltips: Tooltip[] = [];
    const swatches: HTMLElement[] = [];
    const panel = CMP({
      class: 'aekColorPanel',
      onRemoveCmp: () => {
        for (const tooltip of tooltips) tooltip.cmp.remove();
        markCurrent = null;
        if (!picker) return;
        picker.dispose();
        picker = null;
        // A drag the close cut short (Escape) ends with the value it reached; a removed field
        // writes nothing more
        if (!isRemoved) target?.commit();
      },
    });
    const slot = panel.add({ class: 'aekColorPanel__picker' }).elem;
    if (isColorPickerLoaded()) {
      attachPicker(slot);
    } else {
      // Its size kept, so the panel doesn't jump when it comes
      slot.setAttribute('data-loading', '');
      void loadColorPickerAsync().then((isLoaded) => {
        // The panel may have closed (and opened again), or the field gone, meanwhile
        if (isRemoved || !slot.isConnected) return;
        if (!isLoaded) {
          slot.remove();
          if (swatches.length === 0 && !hasEyeDropper) {
            panel.add({ tag: 'p', class: 'aekColorPanel__empty', text: NO_SWATCHES_TEXT });
          }
          return;
        }
        attachPicker(slot);
        if (document.activeElement === focusAtOpen) picker?.focus();
      });
    }
    const idPrefix = host?.idPrefix ?? panel.id;
    const addGroup = (title: string, colors: readonly string[]) => {
      const parsed = colors
        .map((text) => parseColorText(text).value)
        .filter((color): color is Rgba => Boolean(color));
      if (parsed.length === 0) return;
      const headingId = `${idPrefix}__${title.toLowerCase()}`;
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
    if (props.recent !== false) addGroup('Recent', getRecentColors());
    const hasEyeDropper = props.eyeDropper !== false && Boolean(getEyeDropper());
    if (hasEyeDropper) {
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
    onOpen: () => {
      focusAtOpen = document.activeElement;
      picker?.focus();
    },
  });

  /** Copies the colour's text when no text is selected (D6); otherwise the input copies its
   * selection */
  const onCopy = (e: ClipboardEvent) => {
    if (!target || input.selectionStart !== input.selectionEnd || !e.clipboardData) return;
    e.preventDefault();
    e.clipboardData.setData('text/plain', getText(target.peek(), scratch));
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
    if (e.key === 'Enter' && !e.isComposing) typed?.commit();
    // Outside a HUD root (the overlay stack takes it first under one)
    else if (e.key === 'Escape') typed?.onEscape(e);
  };

  const listeners: [string, (e: never) => void][] = [
    ['input', () => typed?.onInput()],
    ['keydown', onKeyDown],
    ['blur', () => typed?.settle()],
    ['copy', onCopy],
    ['paste', onPaste],
  ];

  return {
    row,
    input,
    box,
    swatch,
    /** The inputs a message describes and an error marks */
    messageFor: [input, alphaInput?.input, intensityInput?.input].filter(
      (part): part is HTMLInputElement => Boolean(part)
    ),
    /** The colour's text */
    getText: (value: T) => getText(value, scratch),
    /** Draws a value: the chip, the text (unless there's typed text), the alpha, the open panel's
     * marks and its picker (unless the picker wrote it) */
    draw: (value: T) => {
      const text = getText(value);
      alphaInput?.draw(shown.a);
      if (text === shownText) return;
      shownText = text;
      chip.style.setProperty('--aek-color-field-value', text);
      // Typed text stays until it's written or put back
      if (!typed?.isDirty() && input.value !== text) input.value = text;
      markCurrent?.(text);
      if (picker && !isPickerWriting) picker.setColor(rgbaToHsva(shown, picker.getColor()));
    },
    applyDisabled: (on: boolean) => {
      if (on) {
        input.setAttribute('disabled', '');
        swatch.setAttribute('disabled', '');
        typed?.settle();
        popover.close();
      } else {
        input.removeAttribute('disabled');
        swatch.removeAttribute('disabled');
      }
      alphaInput?.applyDisabled(on);
      intensityInput?.applyDisabled(on);
    },
    /** Reads the intensity's own binding (a field's `onRead`), flashing its box on a refresh */
    onRead: (fromRefresh: boolean) => {
      if (!intensityBinding?.sync()) return;
      intensityInput?.draw(intensityBinding.peek());
      if (fromRefresh) intensityFlash?.flash();
    },
    /** Binds the typed text, the parts, the panel and the clipboard to `to`, in `field` */
    attach: (to: ColorTarget<T>, field: ColorPartsHost) => {
      target = to;
      host = field;
      typed = createTypedText<T>({
        input,
        binding: to,
        parse: (text) => {
          const result = parseColorText(text);
          return result.value ? { value: codec.write(result.value) as T } : result;
        },
        drawText,
        setError: field.setError,
        onInput: props.onInput,
      });
      if (alphaInput) {
        const alphaTarget: NumberTarget = {
          peek: () => codec.read(to.peek(), scratch).a,
          step: (alpha) => to.step(codec.withAlpha(to.peek(), alpha) as T),
          commit: () => to.commit(),
          change: (alpha) => to.change(codec.withAlpha(to.peek(), alpha) as T),
          isInGesture: () => to.isInGesture(),
        };
        alphaInput.attach(alphaTarget, field.setError);
      }
      if (intensityInput && intensityBinding) {
        intensityInput.attach(intensityBinding, field.setError);
        intensityInput.draw(intensityBinding.peek());
      }
      for (const [type, fn] of listeners) input.addEventListener(type, fn as EventListener);
    },
    /** Puts typed text aside (another part took over) */
    endTyping: () => typed?.end(),
    /** Opens the colour panel (the gradient's Enter on a stop) */
    openPanel: () => popover.open(),
    closePanel: () => popover.close(),
    dispose: () => {
      isRemoved = true;
      eyeDropperAbort?.abort();
      typed?.dispose();
      popover.cmp.remove();
      alphaInput?.dispose();
      intensityInput?.dispose();
      intensityFlash?.dispose();
      for (const [type, fn] of listeners) input.removeEventListener(type, fn as EventListener);
    },
  };
};

/**
 * A colour's parts `createColorParts` made.
 * @internal
 */
export type ColorParts<T extends ColorFieldValue> = ReturnType<typeof createColorParts<T>>;
