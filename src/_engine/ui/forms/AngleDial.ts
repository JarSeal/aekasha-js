// The angle dial (p804 D8): a circle with a hand pointing at the angle, dragged round, beside an
// angle part in degrees (rotation/AnglePart.ts, the rotation field's). As the slider's track, the
// dial is for the pointer (`aria-hidden`) while the spin button shows, and with `showInput: false`
// it's the APG slider itself.
import { getPrimitiveValueKind } from './binding/Binding';
import { createValueFormatter } from './binding/ValueText';
import { createField, type Field, type FieldProps } from './Field';
import { buildMonitor } from './Monitor';
import { createNumberInput, type NumberTarget } from './NumberInput';
import { createNumberSteps, listenStepKeys } from './NumberSteps';
import { createPointerDrag, type PointerDrag } from './PointerDrag';
import { getAnglePart } from './rotation/AnglePart';
import { RAD_TO_DEG } from './rotation/RotationMath';
import './AngleDial.scss';
import '../styles/kit.scss';

/** What {@link createAngleDial} makes an angle dial from. */
export type AngleDialProps = FieldProps<number> & {
  /** The bound value's unit: `'radians'` (default, three's) or `'degrees'` (a sun's azimuth). The
   * dial and its text are in degrees either way. */
  angleUnit?: 'radians' | 'degrees';
  /** The range's start, in the value's unit (default a half turn back: -π, or -180). */
  min?: number;
  /** The range's end, in the value's unit (default a half turn on: π, or 180). */
  max?: number;
  /** Wraps at the range's ends, `[min, max)` (default true); false clamps: a drag past an end
   * holds the hand there until the pointer comes back round, rather than jump to the other. */
  wrap?: boolean;
  /** The step, in the value's unit (Tweakpane's `Math.PI / 8` shows as 22.5°) (default 1°). */
  step?: number;
  /** The decimals shown, in place of the step's. */
  precision?: number;
  /** The angle's text, given its degrees, in place of the decimals'. */
  format?: (degrees: number) => string;
  /** Where 0 is and which way the angle grows: `'math'` (default) from the right,
   * anticlockwise, as three's rotation about an axis seen from its positive end; `'compass'`
   * from the top, clockwise (a heading, an azimuth). */
  convention?: 'math' | 'compass';
  /** Shows the angle's spin button after the dial (default true). Without it the dial is the
   * slider itself (`role="slider"`), a compact control that takes no typed value. */
  showInput?: boolean;
  /** Writes each valid keystroke (`last: false`), not only on Enter or a blur (default false). */
  live?: boolean;
  /** Each keystroke's text, before it's written. */
  onInput?: (text: string) => void;
};

/** An angle dial {@link createAngleDial} made: the field's handle. */
export type AngleDial = Field<number>;

/** Shift's snap while dragging (D8) */
const SNAP_DEGREES = 15;

/** An angle's difference made the shortest turn: `[-180, 180)` */
const getTurn = (degrees: number) => ((((degrees + 180) % 360) + 360) % 360) - 180;

/**
 * Creates an angle dial (p804 D8): a circle with a hand at the angle and, by default, the angle's
 * spin button after it in degrees, its value a number from its binding (`{ target, key }`,
 * `{ get, set }` or `{ value }`), in radians unless `angleUnit` is `'degrees'`.
 * - Pointer: a press turns the hand to the pointer (the shortest way from the angle) and drags
 *   it round (`last: false` per move, `last: true` on the release), across the range's ends as it
 *   wraps (or stopping at an end without `wrap`). Shift snaps to 15°, Alt drags on a tenth of the
 *   step.
 * - Keys: the spin button's (ArrowUp / ArrowDown step, Shift ×10, Alt ×0.1, PageUp / PageDown ×10,
 *   Home / End to the ends, typed angles with `deg`, `°`, `rad` or `turn`, Enter, Escape); without
 *   the input the dial's, the APG slider's: the four arrows step, PageUp / PageDown, Home / End,
 *   Shift / Alt, each keyup writing `last: true`.
 * - Parts: `.aekField` (`data-kind="angle"`) with the shell's parts, its `.aekField__control`
 *   holding `.aekAngleDial__row` (the dial and the number field's `.aekField__box`, `data-flash`),
 *   or without the input the dial alone; `.aekAngleDial` (`data-convention`, `data-dragging`,
 *   `data-flash` without the input) with `.aekAngleDial__zero` (the mark at 0) and
 *   `.aekAngleDial__hand` (turned to the angle, its knob at the rim).
 * - Custom properties: `--aek-angle-dial-size` (default `--aek-space-7` × 2, at least 24 px),
 *   `--aek-angle-dial-face-color`, `--aek-angle-dial-hand-color`,
 *   `--aek-angle-dial-input-width` (5em), and the fields' `--aek-field-*`.
 * - ARIA: with the input, its spin button in degrees (`aria-valuetext` "45 °", the unit said as
 *   "degrees") and an `aria-hidden` dial; without, the dial is `role="slider"` with the same
 *   values, labelled by the label (a click on it focuses the dial), `aria-disabled` and out of
 *   the tab order while disabled. The dial is at least 24 px in both densities.
 * - Motion: a change from outside flashes the box (or the dial) once.
 * - `readonly`: a monitor of the angle in degrees (`45°`).
 * @example
 * ```ts
 * const heading = createAngleDial({
 *   label: 'Sun azimuth',
 *   target: sun,
 *   key: 'azimuth',
 *   angleUnit: 'degrees',
 *   min: 0,
 *   max: 360,
 *   convention: 'compass',
 *   onChange: (azimuth, { last }) => {
 *     placeSun(azimuth);
 *     if (last) saveSettings();
 *   },
 * });
 * settingsPanel.add(heading.cmp);
 * ```
 */
export const createAngleDial = (props: AngleDialProps): AngleDial => {
  const toDegrees = props.angleUnit === 'degrees' ? 1 : RAD_TO_DEG;
  const part = getAnglePart('angle', props.label, { ...props, toDegrees });
  /** A value in degrees, rounded off the radians' float noise (45, not 45.00000000000001) */
  const inDegrees = (value: number) => Math.round(value * toDegrees * 1e10) / 1e10;

  if (props.readonly) {
    const formatter = createValueFormatter(part);
    return buildMonitor(props, {
      valueKind: getPrimitiveValueKind<number>(),
      getText: (value) => `${formatter.getText(inDegrees(value))}°`,
    }).shell.field;
  }

  const showInput = props.showInput !== false;
  const convention = props.convention ?? 'math';
  const steps = createNumberSteps(part, { horizontal: true });
  const snapSteps = createNumberSteps({ ...part, step: SNAP_DEGREES });
  const spin = showInput
    ? createNumberInput({ ...part, live: props.live, onInput: props.onInput })
    : null;
  const formatter = spin?.formatter ?? createValueFormatter(part);

  const dial = document.createElement('span');
  dial.className = 'aekAngleDial';
  dial.setAttribute('data-convention', convention);
  const zero = document.createElement('span');
  zero.className = 'aekAngleDial__zero';
  const hand = document.createElement('span');
  hand.className = 'aekAngleDial__hand';
  dial.append(zero, hand);

  let control: HTMLElement = dial;
  if (spin) {
    // The spin button is the control: the dial is for the pointer only
    dial.setAttribute('aria-hidden', 'true');
    control = document.createElement('span');
    control.className = 'aekAngleDial__row';
    control.append(dial, spin.box);
  } else {
    dial.setAttribute('role', 'slider');
    dial.setAttribute('tabindex', '0');
    dial.setAttribute('aria-valuemin', String(part.min));
    dial.setAttribute('aria-valuemax', String(part.max));
  }

  /** The hand's turn last drawn, in CSS degrees (clockwise from the right) */
  let shownTurn = NaN;
  /** The text last drawn (the dial's aria-valuetext written) */
  let shownText: string | null = null;
  let drag: PointerDrag | null = null;
  /** The dial's keys (set below: disabling can run while the shell is made) */
  let keys: ReturnType<typeof listenStepKeys> | null = null;

  const drawDial = (degrees: number) => {
    const turn = Math.round((convention === 'compass' ? degrees - 90 : -degrees) * 1e3) / 1e3;
    if (turn === shownTurn) return;
    shownTurn = turn;
    hand.style.transform = `rotate(${turn}deg)`;
  };

  const shell = createField<number>(props, {
    kind: 'angle',
    valueKind: getPrimitiveValueKind<number>(),
    control,
    labelFor: spin?.input ?? dial,
    isLabelledBy: !spin,
    flashElem: spin?.box ?? dial,
    draw: (value) => {
      const degrees = inDegrees(value);
      drawDial(degrees);
      if (spin) {
        spin.draw(degrees);
        return;
      }
      dial.setAttribute('aria-valuenow', String(degrees));
      const text = formatter.getText(degrees);
      if (text !== shownText) {
        shownText = text;
        dial.setAttribute('aria-valuetext', formatter.getSpokenText(text));
      }
    },
    applyDisabled: (on) => {
      spin?.applyDisabled(on);
      if (on) {
        keys?.end();
        drag?.end();
      }
      if (spin) return;
      // Not a native control: out of the tab order while disabled
      if (on) {
        dial.setAttribute('aria-disabled', 'true');
        dial.removeAttribute('tabindex');
      } else {
        dial.removeAttribute('aria-disabled');
        dial.setAttribute('tabindex', '0');
      }
    },
    onRemove: () => {
      spin?.dispose();
      keys?.dispose();
      drag?.dispose();
    },
  });
  const { binding } = shell;

  /** The binding in degrees: what the spin button, the keys and the drag write through */
  const target: NumberTarget = {
    peek: () => inDegrees(binding.peek()),
    step: (degrees) => binding.step(degrees / toDegrees),
    commit: () => binding.commit(),
    change: (degrees) => binding.change(degrees / toDegrees),
    isInGesture: () => binding.isInGesture(),
  };
  if (spin) {
    spin.attach(target, shell.setOwnError);
  } else {
    keys = listenStepKeys(dial, {
      getStep: (e) => {
        const to = steps.getKeyTarget(e, target.peek);
        return to === null ? null : () => target.step(to);
      },
      commit: target.commit,
      isDisabled: shell.isDisabled,
    });
  }

  /** The dial's centre, read once at the press (a move reads no layout) */
  let centreX = 0;
  let centreY = 0;
  /** The pointer's angle round the dial's centre, in degrees; null at the centre */
  const getPointerAngle = (e: PointerEvent) => {
    const dx = e.clientX - centreX;
    const dy = e.clientY - centreY;
    if (dx === 0 && dy === 0) return null;
    const radians = convention === 'compass' ? Math.atan2(dx, -dy) : Math.atan2(-dy, dx);
    return radians * RAD_TO_DEG;
  };

  /** The drag's angle, unwrapped (it turns past the range's ends, which the constraint wraps or
   * clamps), and the pointer's last */
  let raw = 0;
  let lastAngle: number | null = null;
  /** Follows the pointer by its turn since the last move, so the hand crosses ±180° smoothly */
  const follow = (angle: number | null) => {
    if (angle === null) return;
    raw += getTurn(angle - (lastAngle ?? raw));
    lastAngle = angle;
  };
  const getDragValue = (e: PointerEvent) =>
    e.shiftKey ? snapSteps.constrain(raw) : steps.constrain(raw, e.altKey ? 0.1 : 1);

  drag = createPointerDrag(dial, {
    canPress: () => !shell.isDisabled(),
    onPress: (e) => {
      if (spin) {
        // The pointer takes over: typed text goes back, a key's gesture ends
        spin.interrupt();
      } else {
        keys?.end();
        // The press focuses the slider, as a click on a native one does
        dial.focus({ preventScroll: true });
      }
      const rect = dial.getBoundingClientRect();
      centreX = rect.left + rect.width / 2;
      centreY = rect.top + rect.height / 2;
      raw = target.peek();
      lastAngle = null;
      follow(getPointerAngle(e));
      target.step(getDragValue(e));
    },
    onMove: (e) => {
      follow(getPointerAngle(e));
      target.step(getDragValue(e));
    },
    onEnd: () => target.commit(),
  });

  return shell.field;
};
