// The slider (p804 D7): a number field with a track. The track is a pointer convenience
// (`aria-hidden`), the spin button the one keyboard and screen reader control; with
// `showInput: false` the thumb is the APG slider itself (a compact control).
import { getPrimitiveValueKind, type Binding } from './binding/Binding';
import { createValueFormatter } from './binding/ValueText';
import { createField, type Field } from './Field';
import { buildNumberField, type NumberFieldProps } from './NumberField';
import { createNumberSteps, type NumberSteps } from './NumberSteps';
import './Slider.scss';
import '../styles/kit.scss';

/** A slider's tick: its value, or its value with a label shown under it. */
export type SliderTick = number | { value: number; label?: string };

/** What {@link createSlider} makes a slider from. */
export type SliderProps = NumberFieldProps & {
  /** The track's start. */
  min: number;
  /** The track's end. */
  max: number;
  /** Shows the spin button after the track (default true). Without it the thumb is the slider
   * itself (`role="slider"`), a compact control that takes no typed value. */
  showInput?: boolean;
  /** Marks on the track: a count spread evenly from `min` to `max` (both ends included), or the
   * values to mark, each with an optional label shown under it. Marks only: a value snaps to the
   * `step`'s grid, not to them. */
  ticks?: number | readonly SliderTick[];
};

/** A slider {@link createSlider} made: the field's handle. */
export type Slider = Field<number>;

/** The track's parts and what moves them */
type Track = {
  track: HTMLElement;
  thumb: HTMLElement;
  /** Puts the thumb and the fill at a value, and its shown text (the unit added) in the bubble */
  draw: (value: number, text: string) => void;
  /** Adds the pointer listeners, once the binding exists; returns their remover */
  attach: (props: TrackAttach) => () => void;
  /** Ends a drag (`last: true`): disabling */
  endDrag: () => void;
};

type TrackAttach = {
  binding: Binding<number>;
  steps: NumberSteps;
  isDisabled: () => boolean;
  /** A press on the track: typed text and a key's gesture end (the spin button's) */
  onPress: () => void;
};

/** The ticks as values in the range, with their labels */
const getTicks = (ticks: SliderProps['ticks'], min: number, max: number) => {
  if (ticks === undefined) return [];
  if (typeof ticks === 'number') {
    const count = Math.max(2, Math.floor(ticks));
    return Array.from({ length: count }, (_, i) => ({
      value: min + ((max - min) * i) / (count - 1),
      label: undefined as string | undefined,
    }));
  }
  return ticks
    .map((tick) => (typeof tick === 'number' ? { value: tick, label: undefined } : tick))
    .filter((tick) => tick.value >= min && tick.value <= max);
};

const span = (className: string) => {
  const elem = document.createElement('span');
  elem.className = className;
  return elem;
};

/** Builds the track: the rail with its fill and ticks, the thumb and its bubble */
const createTrack = (props: SliderProps): Track => {
  const { min, max } = props;
  const range = max - min;
  const toFraction = (value: number) =>
    range > 0 ? Math.min(1, Math.max(0, (value - min) / range)) : 0;
  // To a thousandth of a percent: no float noise in the style (0.55 * 100 is 55.00000000000001)
  const toPercent = (value: number) => `${Math.round(toFraction(value) * 1e5) / 1e3}%`;

  const track = span('aekSlider');
  const rail = span('aekSlider__rail');
  const fill = span('aekSlider__fill');
  rail.append(fill);
  const ticks = getTicks(props.ticks, min, max);
  if (ticks.length) {
    const marks = span('aekSlider__ticks');
    // The value says where it is; the marks are for the eye
    marks.setAttribute('aria-hidden', 'true');
    for (const tick of ticks) {
      const mark = span('aekSlider__tick');
      mark.style.left = toPercent(tick.value);
      if (tick.label !== undefined) {
        const label = span('aekSlider__tickLabel');
        label.textContent = tick.label;
        mark.append(label);
        track.setAttribute('data-tick-labels', '');
      }
      marks.append(mark);
    }
    rail.append(marks);
  }
  const thumb = span('aekSlider__thumb');
  const bubble = span('aekSlider__bubble');
  bubble.setAttribute('aria-hidden', 'true');
  thumb.append(bubble);
  rail.append(thumb);
  track.append(rail);

  let shownPercent = '';
  let shownText = '';
  let drag: { offset: number; pointerId: number } | null = null;
  let attached: TrackAttach | null = null;

  /** The value under the pointer, the grab's offset taken off */
  const getValueAt = (clientX: number, altKey: boolean) => {
    const rect = rail.getBoundingClientRect();
    const fraction =
      rect.width > 0
        ? Math.min(1, Math.max(0, (clientX - drag!.offset - rect.left) / rect.width))
        : 0;
    // Alt: a tenth of the step's grid, as the keys
    return attached!.steps.constrain(min + fraction * range, altKey ? 0.1 : 1);
  };

  const endDrag = () => {
    if (!drag) return;
    drag = null;
    track.removeAttribute('data-dragging');
    attached?.binding.commit();
  };

  // A press on the track is a drag without a move (D3): the press writes, the release commits.
  // A press on the thumb keeps where it was grabbed, so it doesn't jump to the pointer.
  const onPointerDown = (e: PointerEvent) => {
    if (!attached || e.button !== 0 || attached.isDisabled() || drag) return;
    // No text selection, and the focus stays (a phone's keyboard stays down)
    e.preventDefault();
    attached.onPress();
    let offset = 0;
    if (thumb.contains(e.target as Node)) {
      const rect = thumb.getBoundingClientRect();
      offset = e.clientX - (rect.left + rect.width / 2);
    }
    drag = { offset, pointerId: e.pointerId };
    track.setPointerCapture?.(e.pointerId);
    track.setAttribute('data-dragging', '');
    attached.binding.step(getValueAt(e.clientX, e.altKey));
  };

  const onPointerMove = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    attached!.binding.step(getValueAt(e.clientX, e.altKey));
  };

  const listeners: [string, (e: never) => void][] = [
    ['pointerdown', onPointerDown],
    ['pointermove', onPointerMove],
    ['pointerup', endDrag],
    ['pointercancel', endDrag],
    ['lostpointercapture', endDrag],
  ];

  return {
    track,
    thumb,
    draw: (value, text) => {
      const percent = toPercent(value);
      if (percent !== shownPercent) {
        shownPercent = percent;
        thumb.style.left = percent;
        fill.style.width = percent;
      }
      if (text !== shownText) {
        shownText = text;
        bubble.textContent = props.unit ? `${text} ${props.unit}` : text;
      }
    },
    attach: (props) => {
      attached = props;
      for (const [type, fn] of listeners) track.addEventListener(type, fn as EventListener);
      return () => {
        if (drag && track.hasPointerCapture?.(drag.pointerId)) {
          track.releasePointerCapture(drag.pointerId);
        }
        drag = null;
        for (const [type, fn] of listeners) track.removeEventListener(type, fn as EventListener);
      };
    },
    endDrag,
  };
};

/** The slider with the spin button: the number field with the track before its box */
const createInputSlider = (props: SliderProps, track: Track): Slider => {
  // The spin button is the control: the track is for the pointer only
  track.track.setAttribute('aria-hidden', 'true');
  let detach = () => {};
  const build = buildNumberField(props, {
    kind: 'slider',
    wrapBox: (box) => {
      const row = span('aekSlider__row');
      row.append(track.track, box);
      return row;
    },
    draw: track.draw,
    applyDisabled: (on) => {
      if (on) track.endDrag();
    },
    onRemove: () => detach(),
  });
  const { shell } = build;
  detach = track.attach({
    binding: shell.binding,
    steps: build.steps,
    isDisabled: shell.isDisabled,
    onPress: build.interrupt,
  });
  return shell.field;
};

/** The slider without the spin button: the thumb is the APG slider */
const createThumbSlider = (props: SliderProps, track: Track): Slider => {
  const { thumb } = track;
  const formatter = createValueFormatter(props);
  const steps = createNumberSteps(props, { horizontal: true });
  /** The text last drawn (its aria-valuetext written) */
  let shownText: string | null = null;
  /** The key whose keyup ends the key's gesture */
  let stepKey: string | null = null;
  let detach = () => {};

  thumb.setAttribute('role', 'slider');
  thumb.setAttribute('tabindex', '0');
  thumb.setAttribute('aria-valuemin', String(props.min));
  thumb.setAttribute('aria-valuemax', String(props.max));

  const endKeyGesture = () => {
    if (stepKey === null) return;
    stepKey = null;
    shell.binding.commit();
  };

  const shell = createField<number>(props, {
    kind: 'slider',
    valueKind: getPrimitiveValueKind<number>(),
    control: track.track,
    labelFor: thumb,
    isLabelledBy: true,
    flashElem: thumb,
    draw: (value) => {
      thumb.setAttribute('aria-valuenow', String(value));
      const text = formatter.getText(value);
      if (text !== shownText) {
        shownText = text;
        thumb.setAttribute('aria-valuetext', formatter.getSpokenText(text));
      }
      track.draw(value, text);
    },
    applyDisabled: (on) => {
      // Not a native control: out of the tab order while disabled
      if (on) {
        thumb.setAttribute('aria-disabled', 'true');
        thumb.removeAttribute('tabindex');
        endKeyGesture();
        track.endDrag();
      } else {
        thumb.removeAttribute('aria-disabled');
        thumb.setAttribute('tabindex', '0');
      }
    },
    onRemove: () => {
      detach();
      for (const [type, fn] of listeners) thumb.removeEventListener(type, fn as EventListener);
    },
  });
  const { binding } = shell;

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || shell.isDisabled()) return;
    const target = steps.getKeyTarget(e, binding.peek);
    if (target === null) return;
    e.preventDefault();
    e.stopPropagation();
    if (stepKey !== null && stepKey !== e.key) endKeyGesture();
    stepKey = e.key;
    binding.step(target);
  };

  const onKeyUp = (e: KeyboardEvent) => {
    if (e.key !== stepKey) return;
    // The keydown was used: so is its keyup
    e.stopPropagation();
    endKeyGesture();
  };

  const listeners: [string, (e: never) => void][] = [
    ['keydown', onKeyDown],
    ['keyup', onKeyUp],
    ['blur', endKeyGesture],
  ];
  for (const [type, fn] of listeners) thumb.addEventListener(type, fn as EventListener);

  detach = track.attach({
    binding,
    steps,
    isDisabled: shell.isDisabled,
    // The press focuses the slider, as a click on a native one does
    onPress: () => {
      endKeyGesture();
      thumb.focus({ preventScroll: true });
    },
  });
  return shell.field;
};

/**
 * Creates a slider (p804 D7): a track from `min` to `max` and, by default, a number field's spin
 * button after it, its value a number from its binding (`{ target, key }`, `{ get, set }` or
 * `{ value }`) and written there. The track is for the pointer only (`aria-hidden`): the spin
 * button is the one keyboard and screen reader control, with everything the number field does
 * (typed expressions, the keys, copy and paste; not the label's scrub, which the track is). With
 * `showInput: false` the thumb is the slider itself, a compact control that takes no typed value.
 * - Pointer: a press on the track moves the thumb there and drags it (`last: false` per move,
 *   `last: true` on the release), a click is a drag without a move; a press on the thumb drags it
 *   from where it was grabbed. Alt drags on a tenth of the step's grid. A bubble over the thumb
 *   shows the value while it's dragged.
 * - Keys: the spin button's (ArrowUp / ArrowDown step, Shift ×10, Alt ×0.1, PageUp / PageDown
 *   ×10, Home / End to `min` / `max`, Enter writes typed text, Escape puts it back); without the
 *   input the thumb's, the APG slider's: the four arrows step, PageUp / PageDown, Home / End,
 *   Shift / Alt, each keyup writing `last: true`.
 * - Ticks: `ticks: 5` marks five even places from `min` to `max`; `ticks: [0, { value: 50,
 *   label: 'Half' }, 100]` marks values, with labels under the track. Marks only (`step` makes
 *   the grid).
 * - Parts: `.aekField` (`data-kind="slider"`, with the shell's parts), its `.aekField__control`
 *   holding `.aekSlider__row` (the track and the number field's `.aekField__box`, `data-flash`),
 *   or without the input the track alone; `.aekSlider` (`data-dragging`, `data-tick-labels`) with
 *   `.aekSlider__rail` holding `.aekSlider__fill`, `.aekSlider__ticks` (`.aekSlider__tick`,
 *   `.aekSlider__tickLabel`) and `.aekSlider__thumb` (`data-flash` without the input) with its
 *   `.aekSlider__bubble`.
 * - Custom properties: `--aek-slider-rail-color`, `--aek-slider-fill-color`,
 *   `--aek-slider-thumb-color`, `--aek-slider-input-width` (the spin button's box, default 5em),
 *   and the fields' `--aek-field-control-bg`, `--aek-field-control-border-color`,
 *   `--aek-field-radius`, `--aek-field-flash-color`.
 * - ARIA: with the input, the spin button's (`aria-valuenow`, `-min`, `-max`, `-valuetext`) and
 *   an `aria-hidden` track; without, the thumb is `role="slider"` with the same values, labelled
 *   by the label (`aria-labelledby`; a click on it focuses the thumb), `aria-disabled` and out of
 *   the tab order while disabled. The ticks and the bubble are `aria-hidden`: the value text says
 *   it. The thumb's target is 24 px in both densities.
 * - Motion: the bubble fades and rises in over `--aek-motion-fast` (at once under reduced motion,
 *   with no slide); a change from outside flashes the box (or the thumb) once.
 * @example
 * ```ts
 * const volume = createSlider({
 *   label: 'Volume',
 *   target: audio,
 *   key: 'volume',
 *   min: 0,
 *   max: 1,
 *   step: 0.01,
 *   format: (value) => `${Math.round(value * 100)} %`,
 *   ticks: [0, { value: 0.5, label: '50 %' }, 1],
 *   onChange: (value, { last }) => {
 *     setVolume(value);
 *     if (last) saveSettings();
 *   },
 * });
 * settingsPanel.add(volume.cmp);
 * ```
 */
export const createSlider = (props: SliderProps): Slider => {
  const track = createTrack(props);
  return props.showInput === false
    ? createThumbSlider(props, track)
    : createInputSlider(props, track);
};
