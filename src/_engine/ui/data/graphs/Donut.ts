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
import './Donut.scss';
import '../../styles/kit.scss';

/** What {@link createDonut} draws: one value, or parts. */
export type DonutProps = {
  /** One value from 0 to 1 (how full: a load's progress, a budget's use), clamped. Ignored with
   * `parts`. Default 0. */
  value?: number;
  /** Parts of a whole, each its share of their sum (or of `total`), in order clockwise from the
   * top. */
  parts?: readonly GraphPart[];
  /** With `parts`: what they're shares of (the rest is the track); default their sum. */
  total?: number;
  /** Its accessible name: one value makes it a `role="meter"`, parts a `role="img"` whose label
   * lists them ('GPU memory: Textures 40 %, …'). Without it it's decorative, hidden from
   * assistive tech: a figure beside it says what it shows. */
  label?: string;
  /** A short text in the middle (a figure: '62 %'), hidden from assistive tech (the label says
   * it). */
  centre?: string;
  /** Its width and height: px, or any CSS length (default `--aek-donut-size`, else
   * `--aek-space-7`). */
  size?: number | string;
  /** How a part's amount reads in the label and the legend, and one value's `aria-valuetext`
   * (`(value, share) => …`, default the rounded percent: '40 %'). */
  format?: GraphPartFormat;
  /** With `parts`: shows the legend beside it (each part's swatch, name and amount). Default
   * true. */
  legend?: boolean;
  /** Extra classes for its element. */
  class?: string | string[];
  /** Extra attributes for its element. */
  attr?: CMPAttr;
  /** Its element id (default: a generated one, not written to the element). */
  id?: string;
};

/** A donut {@link createDonut} made: its CMP and its setters, each writing it in place. */
export type Donut = {
  /** Its element (`.aekDonut`): add it where it goes. */
  cmp: CMPHandle;
  /** Sets its one value (0 to 1, clamped): writes one custom property (and a meter's
   * `aria-valuenow`) only when the value to a thousandth changed, so a value set every frame is
   * fine. */
  setValue: (value: number) => void;
  /** Sets its parts, and a new `total` when given (kept until then; 0 for none: their sum): the
   * gradient, the label and the legend written again. */
  setParts: (parts: readonly GraphPart[], total?: number) => void;
  /** Sets the text in the middle (`''` none). */
  setCentre: (text: string) => void;
};

/** A share to a thousandth: what the drawing and `aria-valuenow` show */
const toThousandths = (value: number) =>
  Math.round(Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0)) * 1000);

/** A share as a gradient stop's percent, to a thousandth of one */
const toPercent = (share: number) => `${Math.round(share * 100000) / 1000}%`;

/**
 * Creates a donut (p805 D9): a ring that fills to one value, or shows the parts of a whole. A
 * conic gradient, so it costs one custom property per change.
 * - Parts: `.aekDonut` (`data-mode`: `value` or `parts`) holding `__ring` (`__disc`, the gradient
 *   with its hole, and `__centre`, the text) and, with parts and `legend`, `.aekGraphLegend` (an
 *   `__item` per part: `__swatch`, `__label`, `__value`).
 * - Custom properties (read on any ancestor): `--aek-donut-size` (default `--aek-space-7`),
 *   `--aek-donut-thickness` (the ring's share of the radius, default 35 %; 100 % is a pie),
 *   `--aek-donut-color` (one value's fill, default the text colour), `--aek-donut-track` (default
 *   the text colour at 10 %, as a table's bar track: it shows on every surface).
 * - ARIA: with `label`, one value is a `role="meter"` (`aria-valuemin` 0, `-max` 100,
 *   `aria-valuenow` the percent, `aria-valuetext` from `format`) and parts a `role="img"` whose
 *   label lists them; the legend and the centre are `aria-hidden`. Without `label` it's
 *   `aria-hidden` (p800 D8's written deviation: a figure beside it says what it shows).
 * @example
 * ```ts
 * // How far a measuring window has run, beside its figure: decorative
 * const windowProgress = createDonut({ size: 12 });
 * statRow.add(windowProgress.cmp);
 * windowProgress.setValue(elapsedMs / windowMs);
 *
 * const memory = createDonut({
 *   label: 'GPU memory',
 *   parts: [
 *     { label: 'Textures', value: 182 },
 *     { label: 'Geometry', value: 64 },
 *     { label: 'Render targets', value: 48 },
 *   ],
 *   total: 512,
 *   centre: '57 %',
 *   format: (megabytes) => `${megabytes} MB`,
 * });
 * memoryPanel.add(memory.cmp);
 * ```
 */
export const createDonut = (props: DonutProps = {}): Donut => {
  const isParts = props.parts !== undefined;
  const format = props.format ?? formatShare;
  const label = props.label;
  const cmp = CMP({
    id: props.id,
    idAttr: props.id !== undefined,
    tag: 'span',
    class: classes('aekDonut', props.class),
    attr: {
      ...props.attr,
      'data-mode': isParts ? 'parts' : 'value',
      ...(!label
        ? { 'aria-hidden': 'true' }
        : isParts
          ? { role: 'img' }
          : { role: 'meter', 'aria-label': label, 'aria-valuemin': '0', 'aria-valuemax': '100' }),
    },
  });
  const elem = cmp.elem;
  const style = elem.style;
  if (props.size !== undefined) {
    style.setProperty(
      '--aek-donut-size',
      typeof props.size === 'number' ? `${props.size}px` : props.size
    );
  }

  const ring = document.createElement('span');
  ring.className = 'aekDonut__ring';
  const disc = document.createElement('span');
  disc.className = 'aekDonut__disc';
  const centre = document.createElement('span');
  centre.className = 'aekDonut__centre';
  centre.setAttribute('aria-hidden', 'true');
  ring.append(disc, centre);
  elem.append(ring);
  const legend = isParts && props.legend !== false ? createLegend() : null;
  if (legend) elem.append(legend);

  let thousandths = -1;
  const setValue = (value: number) => {
    const next = toThousandths(value);
    if (next === thousandths) return;
    thousandths = next;
    style.setProperty('--aek-donut-value', String(next / 10));
    if (label && !isParts) {
      elem.setAttribute('aria-valuenow', String(next / 10));
      elem.setAttribute('aria-valuetext', format(next / 1000, next / 1000));
    }
  };

  let total = props.total;
  const setParts = (parts: readonly GraphPart[], nextTotal?: number) => {
    if (nextTotal !== undefined) total = nextTotal;
    const whole = getPartsWhole(parts, total);
    let stops = '';
    let at = 0;
    for (let i = 0; i < parts.length; i++) {
      const share = whole > 0 ? Math.min(1 - at, readPartValue(parts[i].value) / whole) : 0;
      if (share <= 0) continue;
      const end = at + share;
      stops += `${stops ? ', ' : ''}${getPartColor(parts[i], i)} ${toPercent(at)} ${toPercent(end)}`;
      at = end;
    }
    // The rest of the whole is the track
    stops += `${stops ? ', ' : ''}transparent ${toPercent(at)} 100%`;
    style.setProperty('--aek-donut-parts', stops);
    if (label) elem.setAttribute('aria-label', describeParts(label, parts, whole, format));
    if (legend) writeLegend(legend, parts, whole, format);
  };

  const setCentre = (text: string) => {
    if (centre.textContent !== text) centre.textContent = text;
  };

  if (isParts) setParts(props.parts ?? []);
  else setValue(props.value ?? 0);
  setCentre(props.centre ?? '');

  return {
    cmp,
    setValue: (value) => {
      if (!isParts) setValue(value);
    },
    setParts: (parts, total) => {
      if (isParts) setParts(parts, total);
    },
    setCentre,
  };
};
