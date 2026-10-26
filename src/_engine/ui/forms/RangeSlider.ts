// The range slider (p804 D7): the APG multi-thumb slider on the slider's track (SliderTrack.ts),
// its value `{ min, max }`, with a third stop on the span between the thumbs that moves both. With
// `showInputs` a spin button at each end (NumberInput.ts) is the keyboard's and assistive tech's
// control instead, as the slider's is, and the track is for the pointer only.
import { createObjectValueKind } from './binding/Binding';
import { createValueFormatter, type NumberRules } from './binding/ValueText';
import { createField, type Field, type FieldProps } from './Field';
import { buildMonitor } from './Monitor';
import { createNumberInput, type NumberInput, type NumberTarget } from './NumberInput';
import { createNumberSteps, getStepModifier } from './NumberSteps';
import { createPointerDrag, type PointerDrag } from './PointerDrag';
import { createSliderTrack, type SliderThumb, type SliderTick } from './SliderTrack';
import './RangeSlider.scss';
import '../styles/kit.scss';

/** A range slider's value: where the picked range starts and ends. */
export type RangeValue = {
  /** The range's start. */
  min: number;
  /** The range's end. */
  max: number;
};

/** What {@link createRangeSlider} makes a range slider from. */
export type RangeSliderProps = FieldProps<RangeValue> &
  Pick<NumberRules, 'step' | 'precision'> & {
    /** The track's start. */
    min: number;
    /** The track's end. */
    max: number;
    /** The least the range spans: neither thumb comes nearer the other (default 0: they may
     * meet). */
    minGap?: number;
    /** A value's text, in place of the decimals': also what assistive tech says. */
    format?: (value: number) => string;
    /** A unit shown after a value (in the bubbles and the spin buttons), and said after it. */
    unit?: string;
    /** Shows a spin button at each end of the track (default false): an exact value typed, an
     * expression included, or stepped with the number field's keys. They're then the controls
     * the keyboard and assistive tech use, and the track is for the pointer only. */
    showInputs?: boolean;
    /** The units an expression typed into a spin button may use, as the number field's (with
     * `showInputs`). */
    expressionUnits?: Readonly<Record<string, number>>;
    /** Marks on the track, as the slider's: a count spread from `min` to `max`, or values with
     * optional labels. */
    ticks?: number | readonly SliderTick[];
    /** Bars drawn behind the rail, spread evenly from `min` to `max` (how many items each part of
     * the range holds); those between the thumbs in the fill's colour. */
    histogram?: readonly number[];
  };

/** A range slider {@link createRangeSlider} made: the field's handle. */
export type RangeSlider = Field<RangeValue>;

/** What a key or a drag moves: a thumb, or the span (both) */
type Part = 'low' | 'high' | 'both';

const RANGE_KIND = createObjectValueKind<RangeValue>(['min', 'max']);

const setAttr = (elem: Element, name: string, value: string) => {
  if (elem.getAttribute(name) !== value) elem.setAttribute(name, value);
};

/**
 * Creates a range slider (p804 D7): two thumbs on a track from `min` to `max`, the APG
 * multi-thumb slider, its value `{ min, max }` from its binding (`{ target, key }`, written in
 * place, `{ get, set }` or `{ value }`) and written there. The span between the thumbs is a third
 * stop that moves both. Neither thumb passes the other, and `minGap` keeps them apart.
 * - Pointer: a press on the rail moves the nearer thumb there and drags it; a press on a thumb
 *   drags it from where it was grabbed (two thumbs at one value: the first move's side picks
 *   one); a press on the span drags both. Each move writes `last: false`, the release `last:
 *   true`; the press focuses what it moves. Alt drags on a tenth of the step's grid. A bubble over
 *   each moving thumb shows its value.
 * - Keys: on a thumb, the APG slider's (the four arrows step, Shift ×10, Alt ×0.1, PageUp /
 *   PageDown ×10, Home / End to the thumb's own ends: the track's, or the other thumb's less
 *   `minGap`); on the span the same keys move both, Home and End to the track's ends. Each keyup
 *   writes `last: true`.
 * - Spin buttons (`showInputs`): one before the track for the start and one after it for the end,
 *   each the number field's (a typed expression written on Enter or a blur, the arrows, PageUp /
 *   PageDown, Home / End, copy and paste), kept on its side of the other with the gap. They're
 *   then the controls: the thumbs and the span aren't stops, the track is `aria-hidden`, and a
 *   press on it leaves the focus where it was and puts typed text back.
 * - Ticks and histogram: `ticks` as the slider's; `histogram: number[]` draws bars over the rail,
 *   the range's in the fill's colour.
 * - Parts: `.aekField` (`data-kind="range"`, with the shell's parts; its label a `<span>` naming
 *   the group), its `.aekField__control` holding `.aekSlider` (`role="group"`, `data-dragging`,
 *   `data-tick-labels`, `data-histogram`) with `.aekSlider__histogram` (two `.aekSlider__bars`,
 *   `_active` clipped to the range) and `.aekSlider__rail` holding `.aekSlider__ticks`, the two
 *   `.aekSlider__thumb`s (`data-dragging`) with their `.aekSlider__bubble`s and
 *   `.aekSlider__fill.aekRangeSlider__span` (`data-flash`); with `showInputs`, the control is a
 *   `.aekSlider__row` (the group) holding the two number fields' `.aekField__box`es around the
 *   track.
 * - Custom properties: the slider's `--aek-slider-rail-color`, `--aek-slider-fill-color`,
 *   `--aek-slider-thumb-color`, `--aek-slider-histogram-height` (default 32 px) and
 *   `--aek-field-flash-color`.
 * - ARIA: the track (or the row with the spin buttons) is a `group` labelled by the label; each
 *   spin button a `spinbutton` ("Minimum {label}", "Maximum {label}") whose `aria-valuemin` /
 *   `-max` are its own ends; without them, each thumb a `slider` ("Minimum {label}",
 *   "Maximum {label}") whose `aria-valuemin` / `-max` are its own ends (the other thumb's value ∓
 *   `minGap`), with `aria-valuetext`; the span a `slider` with `aria-roledescription="range"`,
 *   named by the label, its value the range's start and its text "{start} to {end}". Disabled,
 *   the group and each stop are `aria-disabled`, the stops out of the tab order. The ticks, the
 *   histogram and the bubbles are `aria-hidden`. Each stop is a 24 px target in both densities.
 * - Motion: a bubble fades and rises in over `--aek-motion-fast` (at once under reduced motion,
 *   with no rise); a change from outside flashes the span once.
 * - `readonly`: a monitor (`createMonitor`) of "{start} to {end}" and `unit`; no track.
 * @example
 * ```ts
 * const price = createRangeSlider({
 *   label: 'Price',
 *   target: filters,
 *   key: 'price',
 *   min: 0,
 *   max: 500,
 *   step: 10,
 *   minGap: 20,
 *   unit: '€',
 *   histogram: priceCounts,
 *   onChange: (value, { last }) => {
 *     if (last) applyFilters();
 *   },
 * });
 * filterPanel.add(price.cmp);
 * ```
 */
export const createRangeSlider = (props: RangeSliderProps): RangeSlider => {
  const formatter = createValueFormatter(props);
  if (props.readonly) {
    return buildMonitor(props, {
      valueKind: RANGE_KIND,
      getText: (value) => `${formatter.getText(value.min)} to ${formatter.getText(value.max)}`,
    }).shell.field;
  }
  const { min, max, label } = props;
  const gap = Math.max(0, props.minGap ?? 0);
  const steps = createNumberSteps(props, { horizontal: true });
  const parts = createSliderTrack(props);
  const low = parts.createThumb();
  const high = parts.createThumb();
  // The fill is the span: after the thumbs, so the tab order is minimum, maximum, range
  const span = parts.fill;
  span.classList.add('aekRangeSlider__span');
  parts.rail.append(span);
  const stops: Record<Part, HTMLElement> = { low: low.thumb, high: high.thumb, both: span };

  // With `showInputs`, a spin button at each end is the control; the track is for the pointer
  const spinRules = {
    min,
    max,
    step: props.step,
    precision: props.precision,
    format: props.format,
    unit: props.unit,
    expressionUnits: props.expressionUnits,
  };
  const spins: Record<'low' | 'high', NumberInput> | null = props.showInputs
    ? {
        low: createNumberInput({ ...spinRules, ariaLabel: `Minimum ${label}` }),
        high: createNumberInput({ ...spinRules, ariaLabel: `Maximum ${label}` }),
      }
    : null;
  let control = parts.track;
  if (spins) {
    parts.track.setAttribute('aria-hidden', 'true');
    control = document.createElement('span');
    control.className = 'aekSlider__row';
    control.append(spins.low.box, parts.track, spins.high.box);
  } else {
    for (const [elem, name] of [
      [low.thumb, `Minimum ${label}`],
      [high.thumb, `Maximum ${label}`],
      [span, label],
    ] as const) {
      elem.setAttribute('role', 'slider');
      elem.setAttribute('tabindex', '0');
      elem.setAttribute('aria-label', name);
    }
    span.setAttribute('aria-roledescription', 'range');
    low.thumb.setAttribute('aria-valuemin', String(min));
    high.thumb.setAttribute('aria-valuemax', String(max));
    span.setAttribute('aria-valuemin', String(min));
  }

  /** The span's place last drawn */
  let spanLeft = -1;
  let spanRight = -1;
  /** The key whose keyup ends the key's gesture */
  let stepKey: string | null = null;
  let drag: PointerDrag | null = null;

  /** A thumb at its value with its bubble; its ARIA when it's the control */
  const drawThumb = (thumb: SliderThumb, value: number) => {
    thumb.place(value);
    const text = formatter.getText(value);
    thumb.setText(text);
    if (!spins) {
      setAttr(thumb.thumb, 'aria-valuenow', String(value));
      setAttr(thumb.thumb, 'aria-valuetext', formatter.getSpokenText(text));
    }
    return text;
  };

  const draw = (value: RangeValue) => {
    const lowText = drawThumb(low, value.min);
    const highText = drawThumb(high, value.max);
    // Each end's own limits: the other's value, the gap kept
    if (spins) {
      spins.low.draw(value.min);
      spins.high.draw(value.max);
      setAttr(spins.low.input, 'aria-valuemax', String(value.max - gap));
      setAttr(spins.high.input, 'aria-valuemin', String(value.min + gap));
    } else {
      setAttr(low.thumb, 'aria-valuemax', String(value.max - gap));
      setAttr(high.thumb, 'aria-valuemin', String(value.min + gap));
      setAttr(span, 'aria-valuenow', String(value.min));
      setAttr(span, 'aria-valuemax', String(max - (value.max - value.min)));
      setAttr(
        span,
        'aria-valuetext',
        `${formatter.getSpokenText(lowText)} to ${formatter.getSpokenText(highText)}`
      );
    }
    const left = parts.toPercent(value.min);
    const right = parts.toPercent(value.max);
    if (left === spanLeft && right === spanRight) return;
    spanLeft = left;
    spanRight = right;
    span.style.left = `${left}%`;
    span.style.width = `${Math.max(0, Math.round((right - left) * 1e3) / 1e3)}%`;
    parts.setActiveRange(value.min, value.max);
  };

  const endKeyGesture = () => {
    if (stepKey === null) return;
    stepKey = null;
    shell.binding.commit();
  };

  const shell = createField<RangeValue>(props, {
    kind: 'range',
    valueKind: RANGE_KIND,
    control,
    labelFor: spins ? spins.low.input : low.thumb,
    isGroup: true,
    messageFor: spins ? [spins.low.input, spins.high.input] : Object.values(stops),
    flashElem: span,
    draw,
    applyDisabled: (on) => {
      if (spins) {
        spins.low.applyDisabled(on);
        spins.high.applyDisabled(on);
      } else {
        // Not native controls: out of the tab order while disabled
        for (const elem of Object.values(stops)) {
          if (on) {
            elem.setAttribute('aria-disabled', 'true');
            elem.removeAttribute('tabindex');
          } else {
            elem.removeAttribute('aria-disabled');
            elem.setAttribute('tabindex', '0');
          }
        }
      }
      if (on) {
        endKeyGesture();
        drag?.end();
      }
    },
    onRemove: () => {
      drag?.dispose();
      spins?.low.dispose();
      spins?.high.dispose();
      for (const [elem, type, fn] of listeners) elem.removeEventListener(type, fn);
    },
  });
  const { binding } = shell;
  const baseId = props.id ?? `${shell.cmp.id}__control`;
  for (const [elem, part] of [
    [spins?.low.input ?? low.thumb, 'min'],
    [spins?.high.input ?? high.thumb, 'max'],
    [span, 'range'],
  ] as const) {
    elem.id = `${baseId}-${part}`;
  }

  /** A thumb moved to `value`, kept on its side of the other with the gap */
  const moveThumb = (part: 'low' | 'high', value: number, from: RangeValue): RangeValue =>
    part === 'low'
      ? { min: Math.max(min, Math.min(value, from.max - gap)), max: from.max }
      : { min: from.min, max: Math.min(max, Math.max(value, from.min + gap)) };

  /** Both moved by `delta`, kept in the track (its width kept), each on the grid */
  const shiftRange = (from: RangeValue, delta: number, modifier: number): RangeValue => {
    const d = Math.min(Math.max(delta, min - from.min), max - from.max);
    return {
      min: steps.constrain(from.min + d, modifier),
      max: steps.constrain(from.max + d, modifier),
    };
  };

  // A spin button writes its end of the range, kept on its side of the other
  if (spins) {
    for (const part of ['low', 'high'] as const) {
      const target: NumberTarget = {
        peek: () => (part === 'low' ? binding.peek().min : binding.peek().max),
        step: (value) => binding.step(moveThumb(part, value, binding.peek())),
        change: (value) => binding.change(moveThumb(part, value, binding.peek())),
        commit: () => binding.commit(),
        isInGesture: () => binding.isInGesture(),
      };
      spins[part].attach(target, shell.setOwnError);
    }
  }

  const getKeyValue = (part: Part, e: KeyboardEvent): RangeValue | null => {
    const from = binding.peek();
    if (part === 'both') {
      // End takes the range's end to the track's
      if (e.key === 'End') return shiftRange(from, max - from.max, 1);
      const target = steps.getKeyTarget(e, () => from.min);
      return target === null ? null : shiftRange(from, target - from.min, getStepModifier(e));
    }
    const target = steps.getKeyTarget(e, () => (part === 'low' ? from.min : from.max));
    return target === null ? null : moveThumb(part, target, from);
  };

  const onKeyDown = (part: Part) => (e: Event) => {
    const key = e as KeyboardEvent;
    if (key.ctrlKey || key.metaKey || shell.isDisabled()) return;
    const next = getKeyValue(part, key);
    if (next === null) return;
    e.preventDefault();
    e.stopPropagation();
    if (stepKey !== null && stepKey !== key.key) endKeyGesture();
    stepKey = key.key;
    binding.step(next);
  };

  const onKeyUp = (e: Event) => {
    if ((e as KeyboardEvent).key !== stepKey) return;
    // The keydown was used: so is its keyup
    e.stopPropagation();
    endKeyGesture();
  };

  // The stops' keys, when they're the control
  const listeners: [HTMLElement, string, EventListener][] = [];
  if (!spins) {
    for (const part of ['low', 'high', 'both'] as const) {
      listeners.push(
        [stops[part], 'keydown', onKeyDown(part)],
        [stops[part], 'keyup', onKeyUp],
        [stops[part], 'blur', endKeyGesture]
      );
    }
  }
  for (const [elem, type, fn] of listeners) elem.addEventListener(type, fn);

  // The drag: what the press is on decides what moves
  let dragPart: Part | 'either' = 'low';
  let offset = 0;
  let startX = 0;
  let start: RangeValue = { min, max };

  /** The bubbles of what moves show (none: `null`) */
  const markDragging = (part: Part | 'either' | null) => {
    low.thumb.toggleAttribute('data-dragging', part === 'low' || part === 'both');
    high.thumb.toggleAttribute('data-dragging', part === 'high' || part === 'both');
  };

  /** The press focuses what it moves, as a click on a native slider does; with the spin buttons
   * the focus stays where it was (a phone's keyboard stays down), as the slider's */
  const focusPart = (part: Part) => {
    if (!spins) stops[part].focus({ preventScroll: true });
  };

  const dragTo = (e: PointerEvent) => {
    const modifier = e.altKey ? 0.1 : 1;
    if (dragPart === 'both') {
      binding.step(shiftRange(start, parts.getValueDelta(e.clientX - startX), modifier));
    } else if (dragPart !== 'either') {
      const value = steps.constrain(parts.getValueAt(e.clientX, offset), modifier);
      binding.step(moveThumb(dragPart, value, binding.peek()));
    }
  };

  /** What a press moves: the thumb or the span it's on, else the thumb nearer it */
  const getPressedPart = (e: PointerEvent, from: RangeValue): Part | 'either' => {
    const target = e.target as Node;
    for (const part of ['low', 'high'] as const) {
      if (!stops[part].contains(target)) continue;
      offset = parts.getGrabOffset(stops[part], e.clientX);
      // At one value, the first move's side picks the thumb (else one couldn't leave the end)
      return from.min === from.max ? 'either' : part;
    }
    if (span.contains(target)) return 'both';
    const value = parts.getValueAt(e.clientX);
    if (value <= from.min) return 'low';
    if (value >= from.max) return 'high';
    return value - from.min < from.max - value ? 'low' : 'high';
  };

  drag = createPointerDrag(parts.track, {
    canPress: () => !shell.isDisabled(),
    onPress: (e) => {
      endKeyGesture();
      // Typed text is put back: the pointer took over
      spins?.low.interrupt();
      spins?.high.interrupt();
      const from = binding.peek();
      start = { min: from.min, max: from.max };
      startX = e.clientX;
      offset = 0;
      dragPart = getPressedPart(e, from);
      focusPart(dragPart === 'either' ? 'low' : dragPart);
      markDragging(dragPart);
      dragTo(e);
    },
    onMove: (e) => {
      if (dragPart === 'either') {
        const dx = e.clientX - startX;
        if (dx === 0) return;
        dragPart = dx < 0 ? 'low' : 'high';
        focusPart(dragPart);
        markDragging(dragPart);
      }
      dragTo(e);
    },
    onEnd: () => {
      markDragging(null);
      binding.commit();
    },
  });

  return shell.field;
};
