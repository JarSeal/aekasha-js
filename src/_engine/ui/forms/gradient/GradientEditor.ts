// The gradient editor (p804 D8): a preview bar with a handle per stop under it, each an APG slider
// for its place, and the selected stop's position and colour (the colour field's parts,
// ColorParts.ts) in a row under them. The value's stops keep their order in the array: a stop
// dragged past another stays itself (its index, its handle, its focus).
import { createButton } from '../../components/Button';
import type { BindingValueKind } from '../binding/Binding';
import { createField, type Field, type FieldProps } from '../Field';
import { buildMonitor, readFirstValue } from '../Monitor';
import { createNumberInput, type NumberTarget } from '../NumberInput';
import { createNumberSteps, listenStepKeys } from '../NumberSteps';
import { createPointerDrag, type PointerDrag } from '../PointerDrag';
import { createColorParts, type ColorTarget } from '../color/ColorParts';
import { createColorCodec, formatColorHex } from '../color/ColorValue';
import {
  evaluateGradient,
  getGradientCss,
  type GradientColor,
  type GradientStop,
  type GradientValue,
} from './Gradient';
import './GradientEditor.scss';
import '../../styles/kit.scss';

/**
 * What {@link createGradientEditor} makes a gradient editor from.
 * @template T the value: `{ stops: { t, color }[] }`
 */
export type GradientEditorProps<T extends GradientValue = GradientValue> = FieldProps<T> & {
  /** Edits each stop's alpha too (`'#rrggbbaa'`; default false, unless a stop has alpha digits). */
  alpha?: boolean;
  /** A stop's position step, on 0-1 (default 0.01: 1 %). */
  step?: number;
  /** The fewest stops: removing stops there (default 2). */
  minStops?: number;
  /** The most stops: adding stops there (default 16). */
  maxStops?: number;
  /** Swatches in the colour panel, any colour text each. */
  palette?: readonly string[];
  /** Shows the page's recent colours in the colour panel (default true). */
  recent?: boolean;
  /** Offers the browser's eyedropper in the colour panel, where it has one (default true). */
  eyeDropper?: boolean;
};

/**
 * A gradient editor {@link createGradientEditor} made: the field's handle.
 * @template T the value
 */
export type GradientEditor<T extends GradientValue = GradientValue> = Field<T>;

/** Compared stop by stop; copied into the object and the stops that are there (in place) */
const GRADIENT_KIND: BindingValueKind<GradientValue> = {
  equals: (a, b) => {
    const x = a.stops;
    const y = b.stops;
    if (x.length !== y.length) return false;
    for (let i = 0; i < x.length; i++) {
      if (x[i].t !== y[i].t || x[i].color !== y[i].color) return false;
    }
    return true;
  },
  copy: (from, into) => {
    const out = into ?? { stops: [] };
    if (!Array.isArray(out.stops)) out.stops = [];
    const stops = out.stops;
    for (let i = 0; i < from.stops.length; i++) {
      const { t, color } = from.stops[i];
      if (stops[i]) {
        stops[i].t = t;
        stops[i].color = color;
      } else {
        stops[i] = { t, color };
      }
    }
    stops.length = from.stops.length;
    return out;
  },
};

const ADD_ICON =
  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M8 3v10M3 8h10"/></svg>';
const REMOVE_ICON =
  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M3 8h10"/></svg>';

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
/** A place as a percent, off the float noise (0.07 is 7, not 7.000000000000001) */
const toPercent = (t: number) => Math.round(clamp01(t) * 1e12) / 1e10;

/** Where a stop added after stop `index` goes: halfway to the next one along, else to the end,
 * else halfway back to the one before */
const getInsertT = (stops: readonly GradientStop[], index: number) => {
  const t = clamp01(stops[index].t);
  let next = Infinity;
  let before = -Infinity;
  for (const stop of stops) {
    const place = clamp01(stop.t);
    if (place > t && place < next) next = place;
    if (place < t && place > before) before = place;
  }
  if (next !== Infinity) return (t + next) / 2;
  if (t < 1) return (t + 1) / 2;
  return before !== -Infinity ? (t + before) / 2 : t;
};

/**
 * Creates a gradient editor (p804 D8): a preview bar with a handle under it per colour stop, and
 * the selected stop's position and colour, its value `{ stops: { t, color }[] }` (`t` 0-1, `color`
 * hex) from its binding (`{ target, key }`, `{ get, set }` or `{ value }`), written in place (the
 * object and its stops stay the instances). {@link evaluateGradient} reads a colour from it.
 * - Pointer: a press on a handle selects it and drags it along the bar (`last: false` per move,
 *   `last: true` on the release); a press on the bar or under it adds a stop there, its colour the
 *   gradient's at that place, and drags it. Alt drags on a tenth of the step.
 * - Keys on a handle (each a tab stop, in the array's order): the APG slider's (the arrows by
 *   `step`, Shift ×10, Alt ×0.1, PageUp / PageDown ×10, Home / End to the ends; each keyup
 *   `last: true`); Delete or Backspace removes the stop (not below `minStops`), Insert or `+`
 *   adds one after it, halfway to the next (not past `maxStops`), Enter opens its colour panel.
 *   Focusing a handle selects its stop.
 * - The row under the bar: the selected stop's position (a spin button in %, typed or stepped),
 *   its colour (the colour field's swatch with the panel, its text and, with `alpha`, its alpha),
 *   and the "Add stop" and "Remove stop" buttons (the pointer's and every keyboard's way to them).
 * - Parts: `.aekField` (`data-kind="gradient"`) with the shell's parts, its `.aekField__control`
 *   holding `.aekGradientEditor` (the group) with `.aekGradientEditor__track` (`data-dragging`):
 *   `.aekGradientEditor__bar` (`data-flash`; the gradient over a checkerboard) and
 *   `.aekGradientEditor__stops` with a `.aekGradientEditor__stop` per stop (`data-selected`), and
 *   `.aekGradientEditor__row` (`.aekGradientEditor__position`, the colour's `.aekColorField`,
 *   `.aekGradientEditor__add`, `.aekGradientEditor__remove`).
 * - Custom properties: `--aek-gradient-editor-bar-height` (24 px), the colour field's
 *   `--aek-color-field-checker` and the fields' `--aek-field-*`.
 * - ARIA: the editor is a group named by the label; each handle a `role="slider"` named "Stop
 *   {n}", its value the place in % (`aria-valuetext` "25 %, #ff8800"); the position a spin button
 *   "Stop position"; the colour's text "Stop colour", its swatch "Pick the stop’s colour". While
 *   disabled the handles are `aria-disabled` and out of the tab order.
 * - Motion: a change from outside flashes the bar.
 * - `readonly`: a monitor of the stops (`#0b1d3a 0 %, #f2a65a 50 %`).
 * @template T the value
 * @example
 * ```ts
 * const sky = createGradientEditor({
 *   label: 'Sky ramp',
 *   target: skySettings,
 *   key: 'ramp',
 *   palette: ['#0b1d3a', '#f2a65a', '#9fd3ff'],
 *   onChange: (ramp, { last }) => {
 *     if (last) saveSettings();
 *   },
 * });
 * settingsPanel.add(sky.cmp);
 * ```
 */
export const createGradientEditor = <T extends GradientValue>(
  props: GradientEditorProps<T>
): GradientEditor<T> => {
  const valueKind = GRADIENT_KIND as unknown as BindingValueKind<T>;
  const step = props.step ?? 0.01;
  const posRules = { min: 0, max: 100, step: step * 100 };
  const describeStop = (stop: Readonly<GradientStop>, text: string) => `${stop.color} ${text} %`;

  if (props.readonly) {
    const formatter = createNumberInput(posRules).formatter;
    return buildMonitor(props, {
      valueKind,
      getText: (value) =>
        value.stops
          .map((stop) => describeStop(stop, formatter.getText(toPercent(stop.t))))
          .join(', '),
    }).shell.field;
  }

  const first = readFirstValue<T>(props);
  const hasAlpha =
    Boolean(props.alpha) ||
    (first?.stops ?? []).some((stop) => stop.color.length === 5 || stop.color.length === 9);
  const codec = createColorCodec('hex', { alpha: hasAlpha });
  const minStops = Math.max(1, props.minStops ?? 2);
  const maxStops = Math.max(minStops, props.maxStops ?? 16);
  const steps = createNumberSteps({ min: 0, max: 1, step }, { horizontal: true });
  /** A colour evaluated for a new stop */
  const scratch: GradientColor = { r: 0, g: 0, b: 0, a: 1 };

  /** The selected stop's index */
  let selected = 0;
  let drag: PointerDrag | null = null;
  /** The stop the drag moves (-1: none, a press that added nothing), and the grab's offset */
  let dragIndex = -1;
  let grabOffset = 0;
  let shownCss: string | null = null;
  let isDisabled = false;

  const root = document.createElement('span');
  root.className = 'aekGradientEditor';
  const track = document.createElement('span');
  track.className = 'aekGradientEditor__track';
  const bar = document.createElement('span');
  bar.className = 'aekGradientEditor__bar';
  bar.setAttribute('aria-hidden', 'true');
  const lane = document.createElement('span');
  lane.className = 'aekGradientEditor__stops';
  track.append(bar, lane);

  const row = document.createElement('span');
  row.className = 'aekGradientEditor__row';
  const position = createNumberInput({
    ...posRules,
    unit: '%',
    expressionUnits: { '%': 1 },
    ariaLabel: 'Stop position',
  });
  const positionPart = document.createElement('span');
  positionPart.className = 'aekGradientEditor__position';
  positionPart.append(position.box);
  const color = createColorParts<string>({
    label: `${props.label} stop`,
    codec,
    palette: props.palette,
    recent: props.recent,
    eyeDropper: props.eyeDropper,
    ariaLabel: 'Stop colour',
    pickLabel: 'Pick the stop’s colour',
  });
  const addButton = createButton({
    label: 'Add stop',
    variant: 'ghost',
    size: 'sm',
    icon: ADD_ICON,
    iconOnly: true,
    class: 'aekGradientEditor__add',
    onClick: () => insertAfter(selected),
  });
  const removeButton = createButton({
    label: 'Remove stop',
    variant: 'ghost',
    size: 'sm',
    icon: REMOVE_ICON,
    iconOnly: true,
    class: 'aekGradientEditor__remove',
    onClick: () => removeStop(selected),
  });
  row.append(positionPart, color.row, addButton.cmp.elem, removeButton.cmp.elem);
  root.append(track, row);

  /** The handles, one per stop, with what each last drew and its listeners' removers */
  const handles: {
    elem: HTMLElement;
    t: number;
    color: string | null;
    selected: boolean;
    dispose: () => void;
  }[] = [];

  /** A stop's handle: made and removed at the end of the list, so its index is fixed */
  const createHandle = () => {
    const elem = document.createElement('span');
    elem.className = 'aekGradientEditor__stop';
    elem.setAttribute('role', 'slider');
    elem.setAttribute('aria-label', `Stop ${handles.length + 1}`);
    elem.setAttribute('aria-valuemin', '0');
    elem.setAttribute('aria-valuemax', '100');
    if (isDisabled) elem.setAttribute('aria-disabled', 'true');
    else elem.setAttribute('tabindex', '0');
    const indexOf = () => handles.findIndex((handle) => handle.elem === elem);
    const keys = listenStepKeys(elem, {
      getStep: (e) => {
        const index = indexOf();
        const to = steps.getKeyTarget(e, () => binding.peek().stops[index].t);
        return to === null ? null : () => binding.step(withStop(index, to, null));
      },
      commit: () => binding.commit(),
      // The first draw makes the handles while the shell is made
      isDisabled: () => isDisabled,
    });
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isDisabled) return;
      const index = indexOf();
      if (e.key === 'Delete' || e.key === 'Backspace') removeStop(index);
      else if (e.key === 'Insert' || e.key === '+') insertAfter(index);
      else if (e.key === 'Enter') color.openPanel();
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    const onFocus = () => select(indexOf());
    elem.addEventListener('keydown', onKeyDown);
    elem.addEventListener('focus', onFocus);
    lane.append(elem);
    handles.push({
      elem,
      t: NaN,
      color: null,
      selected: false,
      dispose: () => {
        keys.dispose();
        elem.removeEventListener('keydown', onKeyDown);
        elem.removeEventListener('focus', onFocus);
        elem.remove();
      },
    });
  };

  let shownNoAdd: boolean | null = null;
  let shownNoRemove: boolean | null = null;
  /** The buttons at the stops' limits, or disabled with the field (written on a change) */
  const setButtonsDisabled = () => {
    const noAdd = isDisabled || handles.length >= maxStops;
    const noRemove = isDisabled || handles.length <= minStops;
    if (noAdd !== shownNoAdd) addButton.setDisabled((shownNoAdd = noAdd));
    if (noRemove !== shownNoRemove) removeButton.setDisabled((shownNoRemove = noRemove));
  };

  /** The row's stop as last drawn: a write that moved another stop leaves the row alone */
  let rowIndex = -1;
  let rowT = NaN;
  let rowColor: string | null = null;

  /** The handles, the selection and the row drawn at a value */
  const draw = (value: T) => {
    const { stops } = value;
    while (handles.length < stops.length) createHandle();
    while (handles.length > stops.length) handles.pop()!.dispose();
    if (selected >= stops.length) selected = Math.max(0, stops.length - 1);
    for (let i = 0; i < stops.length; i++) {
      const handle = handles[i];
      const stop = stops[i];
      const isSelected = i === selected;
      if (isSelected !== handle.selected) {
        handle.selected = isSelected;
        handle.elem.toggleAttribute('data-selected', isSelected);
      }
      // Each written only on a change: a draw runs on every write of a drag
      const moved = stop.t !== handle.t;
      const recoloured = stop.color !== handle.color;
      if (!moved && !recoloured) continue;
      const percent = toPercent(stop.t);
      if (moved) {
        handle.t = stop.t;
        handle.elem.style.left = `${percent}%`;
        handle.elem.setAttribute('aria-valuenow', String(percent));
      }
      if (recoloured) {
        handle.color = stop.color;
        handle.elem.style.setProperty('--aek-color-field-value', stop.color);
      }
      handle.elem.setAttribute(
        'aria-valuetext',
        `${position.formatter.getText(percent)} %, ${stop.color}`
      );
    }
    const css = getGradientCss(value);
    if (css !== shownCss) {
      shownCss = css;
      bar.style.setProperty('--aek-gradient-editor-value', css);
    }
    const current = stops[selected];
    if (current) {
      if (selected !== rowIndex || current.t !== rowT) position.draw(toPercent(current.t));
      if (selected !== rowIndex || current.color !== rowColor) color.draw(current.color);
      rowIndex = selected;
      rowT = current.t;
      rowColor = current.color;
    }
    setButtonsDisabled();
  };

  const shell = createField<T>(props, {
    kind: 'gradient',
    valueKind,
    control: root,
    isGroup: true,
    labelFor: position.input,
    messageFor: [position.input, ...color.messageFor],
    flashElem: bar,
    draw,
    applyDisabled: (on) => {
      isDisabled = on;
      for (const { elem } of handles) {
        // Not native controls: out of the tab order while disabled
        if (on) {
          elem.setAttribute('aria-disabled', 'true');
          elem.removeAttribute('tabindex');
        } else {
          elem.removeAttribute('aria-disabled');
          elem.setAttribute('tabindex', '0');
        }
      }
      if (on) drag?.end();
      position.applyDisabled(on);
      color.applyDisabled(on);
      setButtonsDisabled();
    },
    onRemove: () => {
      drag?.dispose();
      for (const handle of handles) handle.dispose();
      position.dispose();
      color.dispose();
      addButton.cmp.remove();
      removeButton.cmp.remove();
    },
  });
  const { binding } = shell;

  /** The value a write is made in: kept, as the binding copies what it's given */
  let written: T | undefined;
  const editable = () => (written = valueKind.copy(binding.peek(), written));

  /** The value with stop `index` moved to `t` and coloured `stopColor` (each when given) */
  function withStop(index: number, t: number | null, stopColor: string | null) {
    const next = editable();
    const stop = next.stops[index];
    if (stop) {
      if (t !== null) stop.t = t;
      if (stopColor !== null) stop.color = stopColor;
    }
    return next;
  }

  /** Selects stop `index`: the row shows it (typed text in the row was written by its blur) */
  function select(index: number) {
    if (index < 0 || index === selected) return;
    selected = index;
    draw(binding.peek());
  }

  const focusStop = (index: number) => handles[index]?.elem.focus({ preventScroll: true });

  /** Removes stop `index` (one `last: true`), selecting and focusing its place's stop */
  function removeStop(index: number) {
    const { stops } = binding.peek();
    if (shell.isDisabled() || stops.length <= minStops || !stops[index]) return;
    const hadFocus = handles[index]?.elem === document.activeElement;
    const next = editable();
    next.stops.splice(index, 1);
    selected = Math.min(index, next.stops.length - 1);
    binding.change(next);
    if (hadFocus) focusStop(selected);
  }

  /** Adds a stop after stop `index` (one `last: true`), its colour the gradient's there,
   * selecting it and focusing it when a handle had the focus */
  function insertAfter(index: number) {
    const { stops } = binding.peek();
    if (shell.isDisabled() || stops.length >= maxStops || !stops[index]) return;
    const hadFocus = handles.some((handle) => handle.elem === document.activeElement);
    const t = steps.constrain(getInsertT(stops, index));
    const next = editable();
    next.stops.splice(index + 1, 0, { t, color: getColorAt(t) });
    selected = index + 1;
    binding.change(next);
    if (hadFocus) focusStop(selected);
  }

  const getColorAt = (t: number) =>
    formatColorHex(evaluateGradient(binding.peek(), t, scratch), hasAlpha);

  const positionTarget: NumberTarget = {
    peek: () => toPercent(binding.peek().stops[selected]?.t ?? 0),
    step: (percent) => binding.step(withStop(selected, percent / 100, null)),
    commit: () => binding.commit(),
    change: (percent) => binding.change(withStop(selected, percent / 100, null)),
    isInGesture: () => binding.isInGesture(),
  };
  position.attach(positionTarget, shell.setOwnError);
  const colorTarget: ColorTarget<string> = {
    peek: () => binding.peek().stops[selected]?.color ?? '#000000',
    step: (stopColor) => binding.step(withStop(selected, null, stopColor)),
    commit: () => binding.commit(),
    change: (stopColor) => binding.change(withStop(selected, null, stopColor)),
    isInGesture: () => binding.isInGesture(),
  };
  color.attach(colorTarget, {
    setError: shell.setOwnError,
    isDisabled: shell.isDisabled,
    idPrefix: shell.cmp.id,
  });
  // Its first draw came before the parts were attached
  draw(binding.peek());

  /** The bar's box, read once at the press (a move reads no layout) */
  let barRect: DOMRect | null = null;
  /** The place under the pointer on the bar, less the grab's offset, constrained */
  const getTAt = (e: PointerEvent) => {
    const rect = barRect ?? bar.getBoundingClientRect();
    const fraction = rect.width > 0 ? (e.clientX - grabOffset - rect.left) / rect.width : 0;
    return steps.constrain(clamp01(fraction), e.altKey ? 0.1 : 1);
  };

  drag = createPointerDrag(track, {
    canPress: () => !shell.isDisabled(),
    onPress: (e) => {
      barRect = bar.getBoundingClientRect();
      grabOffset = 0;
      dragIndex = handles.findIndex((handle) => handle.elem.contains(e.target as Node));
      if (dragIndex >= 0) {
        const rect = handles[dragIndex].elem.getBoundingClientRect();
        grabOffset = e.clientX - (rect.left + rect.width / 2);
        // Focusing it selects it (and a blur before writes the row's typed text)
        focusStop(dragIndex);
        binding.step(withStop(dragIndex, binding.peek().stops[dragIndex].t, null));
        return;
      }
      const { stops } = binding.peek();
      if (stops.length >= maxStops) return;
      const t = getTAt(e);
      const next = editable();
      next.stops.push({ t, color: getColorAt(t) });
      dragIndex = next.stops.length - 1;
      selected = dragIndex;
      binding.step(next);
      focusStop(dragIndex);
    },
    onMove: (e) => {
      if (dragIndex < 0) return;
      binding.step(withStop(dragIndex, getTAt(e), null));
    },
    onEnd: () => {
      barRect = null;
      if (dragIndex < 0) return;
      dragIndex = -1;
      binding.commit();
    },
  });

  return shell.field;
};
