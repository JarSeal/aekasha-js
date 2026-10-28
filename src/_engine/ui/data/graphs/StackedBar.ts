import type { CMPAttr, CMPHandle } from '../../core/CMPTypes';
import { CMP, classes } from '../../core/CMP';
import {
  createLegend,
  describeParts,
  formatShare,
  getPartColor,
  getPartsWhole,
  readPartValue,
  writeLegend,
  type GraphPart,
  type GraphPartFormat,
} from './GraphParts';
import './StackedBar.scss';
import '../../styles/kit.scss';

/** What {@link createStackedBar} draws. */
export type StackedBarProps = {
  /** The parts, in order from the start, each its share of their sum (or of `total`). */
  parts: readonly GraphPart[];
  /** What the parts are shares of (a budget): the rest is the empty track, and parts past it are
   * cut at the end and mark the bar over (`data-over`). Default their sum: the bar is full. */
  total?: number;
  /** Its accessible name (`role="img"`), followed by each part's name and amount ('Frame by
   * stage: Physics 22 %, Render 61 %, …'). */
  label: string;
  /** How a part's amount reads in the label, its tooltip and the legend (`(value, share) => …`,
   * default the rounded percent: '40 %'). */
  format?: GraphPartFormat;
  /** Shows the legend under it (each part's swatch, name and amount). Default false. */
  legend?: boolean;
  /** Extra classes for its element. */
  class?: string | string[];
  /** Extra attributes for its element. */
  attr?: CMPAttr;
  /** Its element id (default: a generated one, not written to the element). */
  id?: string;
};

/** A stacked bar {@link createStackedBar} made: its CMP and its setter. */
export type StackedBar = {
  /** Its element (`.aekStackedBar`): add it where it goes. */
  cmp: CMPHandle;
  /** Sets its parts, and a new `total` when given (kept until then; 0 for none: their sum): a
   * segment's width written only when its share to a thousandth changed, the label and the legend
   * written again. */
  setParts: (parts: readonly GraphPart[], total?: number) => void;
};

type Segment = { elem: HTMLElement; share: number; color: string; title: string };

/**
 * Creates a stacked bar (p805 D9): the parts of a whole side by side in one bar (a frame's time
 * by stage, memory by category), or one part against a budget (`total`). A segment per part, its
 * width its share; no SVG, no canvas.
 * - Parts: `.aekStackedBar` (`data-over` when the parts pass `total`) holding `__track` (a
 *   `__segment` per part, `title` its name and amount) and, with `legend`, `.aekGraphLegend` (an
 *   `__item` per part: `__swatch`, `__label`, `__value`).
 * - Custom properties (read on any ancestor): `--aek-stacked-bar-height` (default
 *   `--aek-space-3`), `--aek-stacked-bar-track` (default the text colour at 10 %),
 *   `--aek-stacked-bar-over-color` (the outline when over, default `--aek-danger`); a part's
 *   colour is its own, else the chart series in order.
 * - ARIA: a `role="img"` named by `label` and every part's amount; the legend is `aria-hidden`
 *   (the label says the same). Over is said by the amounts (a part past 100 %), and drawn as the
 *   danger outline.
 * - Motion: a width change eases over `--aek-motion-fast` (none under reduced motion).
 * @example
 * ```ts
 * const memory = createStackedBar({
 *   label: 'GPU memory against the budget',
 *   parts: [
 *     { label: 'Textures', value: 182 },
 *     { label: 'Geometry', value: 64 },
 *   ],
 *   total: 512,
 *   format: (megabytes) => `${megabytes} MB`,
 *   legend: true,
 * });
 * memoryPanel.add(memory.cmp);
 * memory.setParts([
 *   { label: 'Textures', value: 240 },
 *   { label: 'Geometry', value: 70 },
 * ]);
 * ```
 */
export const createStackedBar = (props: StackedBarProps): StackedBar => {
  const format = props.format ?? formatShare;
  let total = props.total;
  const cmp = CMP({
    id: props.id,
    idAttr: props.id !== undefined,
    class: classes('aekStackedBar', props.class),
    attr: { ...props.attr, role: 'img' },
  });
  const elem = cmp.elem;
  const track = document.createElement('span');
  track.className = 'aekStackedBar__track';
  elem.append(track);
  const legend = props.legend ? createLegend() : null;
  if (legend) elem.append(legend);
  const segments: Segment[] = [];

  const setParts = (parts: readonly GraphPart[], nextTotal?: number) => {
    if (nextTotal !== undefined) total = nextTotal;
    const whole = getPartsWhole(parts, total);
    while (segments.length < parts.length) {
      const segment = document.createElement('span');
      segment.className = 'aekStackedBar__segment';
      track.append(segment);
      segments.push({ elem: segment, share: -1, color: '', title: '' });
    }
    let used = 0;
    let sum = 0;
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const part = i < parts.length ? parts[i] : null;
      const value = part ? readPartValue(part.value) : 0;
      sum += value;
      // Each part's share to a thousandth, cut where the track ends
      const share = whole > 0 ? Math.min(1000 - used, Math.round((value / whole) * 1000)) : 0;
      used += Math.max(0, share);
      const isShown = part !== null && share > 0;
      if (segment.elem.hasAttribute('hidden') === isShown) {
        segment.elem.toggleAttribute('hidden', !isShown);
      }
      if (!part) continue;
      if (segment.share !== share) {
        segment.share = share;
        segment.elem.style.width = `${share / 10}%`;
      }
      const color = getPartColor(part, i);
      if (segment.color !== color) {
        segment.color = color;
        segment.elem.style.setProperty('--aek-stacked-bar-color', color);
      }
      const title = `${part.label}: ${format(value, whole > 0 ? value / whole : 0)}`;
      if (segment.title !== title) {
        segment.title = title;
        segment.elem.setAttribute('title', title);
      }
    }
    const isOver = total !== undefined && total > 0 && sum > total;
    if (elem.hasAttribute('data-over') !== isOver) elem.toggleAttribute('data-over', isOver);
    elem.setAttribute('aria-label', describeParts(props.label, parts, whole, format));
    if (legend) writeLegend(legend, parts, whole, format);
  };

  setParts(props.parts);
  return { cmp, setParts };
};
