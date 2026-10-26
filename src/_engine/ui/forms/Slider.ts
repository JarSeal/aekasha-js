// The slider (p804 D7): a number field with a track. The track is a pointer convenience
// (`aria-hidden`), the spin button the one keyboard and screen reader control; with
// `showInput: false` the thumb is the APG slider itself (a compact control). The track is
// SliderTrack.ts', which the range slider shares.
import { getPrimitiveValueKind, type Binding } from './binding/Binding';
import { createValueFormatter } from './binding/ValueText';
import { createField, type Field } from './Field';
import { buildNumberField, type NumberFieldProps } from './NumberField';
import { createNumberSteps, type NumberSteps } from './NumberSteps';
import { createSliderTrack, createTrackDrag, type SliderTick } from './SliderTrack';
import '../styles/kit.scss';

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

/** What the track's drag writes through, once the field exists */
type SingleTrackDrag = {
  binding: Binding<number>;
  steps: NumberSteps;
  isDisabled: () => boolean;
  /** A press on the track: the spin button's typed text and key's gesture end, or the thumb
   * takes the focus */
  onPress: () => void;
};

/** The slider's track with its one thumb: drawn at a value, and its drag */
const createSingleTrack = (props: SliderProps) => {
  const parts = createSliderTrack(props);
  const thumb = parts.createThumb();
  let fillPercent = -1;
  return {
    track: parts.track,
    thumb: thumb.thumb,
    /** The thumb and the fill at the value, the bubble's text */
    draw: (value: number, text: string) => {
      thumb.place(value);
      const percent = parts.toPercent(value);
      if (percent !== fillPercent) {
        fillPercent = percent;
        parts.fill.style.width = `${percent}%`;
      }
      thumb.setText(text);
    },
    /** The drag: a press on the track is a drag without a move (D3: the press writes, the
     * release commits); a press on the thumb keeps where it was grabbed, so it doesn't jump */
    listen: (drag: SingleTrackDrag) => {
      const { binding, steps } = drag;
      let offset = 0;
      // Alt: a tenth of the step's grid, as the keys
      const getValue = (e: PointerEvent) =>
        steps.constrain(parts.getValueAt(e.clientX, offset), e.altKey ? 0.1 : 1);
      return createTrackDrag(parts.track, {
        canPress: () => !drag.isDisabled(),
        onPress: (e) => {
          drag.onPress();
          offset = thumb.thumb.contains(e.target as Node)
            ? parts.getGrabOffset(thumb.thumb, e.clientX)
            : 0;
          thumb.thumb.setAttribute('data-dragging', '');
          binding.step(getValue(e));
        },
        onMove: (e) => binding.step(getValue(e)),
        onEnd: () => {
          thumb.thumb.removeAttribute('data-dragging');
          binding.commit();
        },
      });
    },
  };
};

type SingleTrack = ReturnType<typeof createSingleTrack>;
type TrackDrag = ReturnType<typeof createTrackDrag>;

/** The slider with the spin button: the number field with the track before its box */
const createInputSlider = (props: SliderProps, track: SingleTrack): Slider => {
  // The spin button is the control: the track is for the pointer only
  track.track.setAttribute('aria-hidden', 'true');
  let drag: TrackDrag | null = null;
  const build = buildNumberField(props, {
    kind: 'slider',
    wrapBox: (box) => {
      const row = document.createElement('span');
      row.className = 'aekSlider__row';
      row.append(track.track, box);
      return row;
    },
    draw: track.draw,
    applyDisabled: (on) => {
      if (on) drag?.end();
    },
    onRemove: () => drag?.dispose(),
  });
  const { shell } = build;
  drag = track.listen({
    binding: shell.binding,
    steps: build.steps,
    isDisabled: shell.isDisabled,
    onPress: build.interrupt,
  });
  return shell.field;
};

/** The slider without the spin button: the thumb is the APG slider */
const createThumbSlider = (props: SliderProps, track: SingleTrack): Slider => {
  const { thumb } = track;
  const formatter = createValueFormatter(props);
  const steps = createNumberSteps(props, { horizontal: true });
  /** The text last drawn (its aria-valuetext written) */
  let shownText: string | null = null;
  /** The key whose keyup ends the key's gesture */
  let stepKey: string | null = null;
  let drag: TrackDrag | null = null;

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
        drag?.end();
      } else {
        thumb.removeAttribute('aria-disabled');
        thumb.setAttribute('tabindex', '0');
      }
    },
    onRemove: () => {
      drag?.dispose();
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

  drag = track.listen({
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
 *   `.aekSlider__tickLabel`) and `.aekSlider__thumb` (`data-dragging`, `data-flash` without the input) with its
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
  const track = createSingleTrack(props);
  return props.showInput === false
    ? createThumbSlider(props, track)
    : createInputSlider(props, track);
};
