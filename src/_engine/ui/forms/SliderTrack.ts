// A slider's track (p804 D7), which the slider and the range slider share: the rail with its fill,
// the ticks, the histogram, the thumbs with their bubbles, where a value sits on the rail and which
// value is under the pointer. Its drag is PointerDrag.ts'.
import './Slider.scss';
import '../styles/kit.scss';

/** A slider's tick: its value, or its value with a label shown under it. */
export type SliderTick = number | { value: number; label?: string };

/**
 * What a track is drawn from.
 * @internal
 */
export type SliderTrackProps = {
  min: number;
  max: number;
  /** A count spread from `min` to `max`, or values with labels */
  ticks?: number | readonly SliderTick[];
  /** Bars behind the rail, spread evenly from `min` to `max` (the range slider's) */
  histogram?: readonly number[];
  /** Shown after a bubble's text */
  unit?: string;
};

/**
 * A thumb on a track: placed at a value, its bubble's text set, each written only on a change.
 * @internal
 */
export type SliderThumb = {
  thumb: HTMLElement;
  place: (value: number) => void;
  /** The bubble's text: the shown text, the unit added */
  setText: (text: string) => void;
};

const SVG_NS = 'http://www.w3.org/2000/svg';

const span = (className: string) => {
  const elem = document.createElement('span');
  elem.className = className;
  return elem;
};

/** The ticks as values in the range, with their labels */
const getTicks = (ticks: SliderTrackProps['ticks'], min: number, max: number) => {
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

/** The histogram's bars as an SVG, each value's share of the highest */
const createHistogram = (values: readonly number[], className: string) => {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', className);
  svg.setAttribute('viewBox', `0 0 ${values.length} 1`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-hidden', 'true');
  const highest = Math.max(0, ...values);
  for (let i = 0; i < values.length; i++) {
    const height = highest > 0 ? Math.max(0, values[i]) / highest : 0;
    const bar = document.createElementNS(SVG_NS, 'rect');
    bar.setAttribute('x', String(i + 0.1));
    bar.setAttribute('width', '0.8');
    bar.setAttribute('y', String(1 - height));
    bar.setAttribute('height', String(height));
    svg.append(bar);
  }
  return svg;
};

/**
 * Builds a track (`.aekSlider`): the rail with its fill, the ticks and the histogram; the thumbs
 * are added with `createThumb`.
 * @internal
 */
export const createSliderTrack = (props: SliderTrackProps) => {
  const { min, max } = props;
  const range = max - min;
  const toFraction = (value: number) =>
    range > 0 ? Math.min(1, Math.max(0, (value - min) / range)) : 0;
  // To a thousandth of a percent: no float noise in the style (0.55 * 100 is 55.00000000000001)
  const toPercent = (value: number) => Math.round(toFraction(value) * 1e5) / 1e3;

  const track = span('aekSlider');
  const rail = span('aekSlider__rail');
  /** The rail's box, kept for a drag (`measure`) */
  let railRect: DOMRect | null = null;
  const fill = span('aekSlider__fill');
  rail.append(fill);

  /** The histogram's bars in the selected range: the active copy, clipped to it */
  let activeBars: SVGElement | null = null;
  if (props.histogram?.length) {
    track.setAttribute('data-histogram', '');
    const bars = span('aekSlider__histogram');
    activeBars = createHistogram(props.histogram, 'aekSlider__bars aekSlider__bars_active');
    bars.append(createHistogram(props.histogram, 'aekSlider__bars'), activeBars);
    track.append(bars);
  }

  const ticks = getTicks(props.ticks, min, max);
  if (ticks.length) {
    const marks = span('aekSlider__ticks');
    // The value says where it is; the marks are for the eye
    marks.setAttribute('aria-hidden', 'true');
    for (const tick of ticks) {
      const mark = span('aekSlider__tick');
      mark.style.left = `${toPercent(tick.value)}%`;
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
  track.append(rail);

  return {
    track,
    rail,
    fill,
    /** A value's place on the rail, a percent to a thousandth (clamped to the range) */
    toPercent,
    /** Reads the rail's box for a drag (at its press), so its moves don't each read the layout
     * the last move's writes dirtied; `null` reads it on each call again */
    measure: (on = true) => {
      railRect = on ? rail.getBoundingClientRect() : null;
    },
    /** The value under the pointer's x, less a grab's offset: clamped to the range, not
     * constrained */
    getValueAt: (clientX: number, offset = 0) => {
      const rect = railRect ?? rail.getBoundingClientRect();
      const fraction =
        rect.width > 0 ? Math.min(1, Math.max(0, (clientX - offset - rect.left) / rect.width)) : 0;
      return min + fraction * range;
    },
    /** What a pointer's move of `dx` px is in value */
    getValueDelta: (dx: number) => {
      const width = (railRect ?? rail.getBoundingClientRect()).width;
      return width > 0 ? (dx / width) * range : 0;
    },
    /** How far from a thumb's centre the pointer is: a press there drags it without a jump */
    getGrabOffset: (thumb: HTMLElement, clientX: number) => {
      const rect = thumb.getBoundingClientRect();
      return clientX - (rect.left + rect.width / 2);
    },
    /** Clips the histogram's active bars to the range from `low` to `high` */
    setActiveRange: (low: number, high: number) => {
      if (!activeBars) return;
      activeBars.style.clipPath = `inset(0 ${100 - toPercent(high)}% 0 ${toPercent(low)}%)`;
    },
    /** Adds a thumb with its bubble, after what the rail holds */
    createThumb: (): SliderThumb => {
      const thumb = span('aekSlider__thumb');
      const bubble = span('aekSlider__bubble');
      bubble.setAttribute('aria-hidden', 'true');
      // One text node whose data is written: a replaced node is a style recalc per move
      const bubbleText = document.createTextNode('');
      bubble.append(bubbleText);
      thumb.append(bubble);
      rail.append(thumb);
      let shownPercent = -1;
      let shownText: string | null = null;
      return {
        thumb,
        place: (value) => {
          const percent = toPercent(value);
          if (percent === shownPercent) return;
          shownPercent = percent;
          thumb.style.left = `${percent}%`;
        },
        setText: (text) => {
          if (text === shownText) return;
          shownText = text;
          bubbleText.data = props.unit ? `${text} ${props.unit}` : text;
        },
      };
    },
  };
};
