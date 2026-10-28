import type { CMPAttr, CMPHandle } from '../core/CMPTypes';
import { CMP, classes } from '../core/CMP';
import type { Sparkline } from './graphs/Sparkline';
import './StatTile.scss';
import '../styles/kit.scss';

/** What {@link createStatTile} shows. */
export type StatTileProps = {
  /** What the figure is ('Frame time'). */
  label: string;
  /** The figure at the start: a number (through `format`), a text, or `null` for none yet ('–').
   * Default `null`. */
  value?: number | string | null;
  /** Its unit after the figure ('ms'). */
  unit?: string;
  /** A number's text (default `String(value)`). */
  format?: (value: number) => string;
  /** The change since the last period, signed (`null`, the default, shows none). */
  delta?: number | null;
  /** The size of a change, without its sign: the tile adds the sign, the arrow and the words
   * (default a percent to a tenth: '12 %', '0.5 %'). */
  formatDelta?: (size: number) => string;
  /** Which way is good: a change that way is in the success colour, the other way in the danger
   * colour. Without it a change is neutral (a count that's neither). */
  goodDirection?: 'up' | 'down';
  /** A sparkline under the figure, made by the app with `createSparkline` (the tile imports
   * none): added to the tile and removed with it. */
  sparkline?: Sparkline;
  /** Extra classes for its element. */
  class?: string | string[];
  /** Extra attributes for its element. */
  attr?: CMPAttr;
  /** Its element id (default: a generated one, not written to the element). */
  id?: string;
};

/** A stat tile {@link createStatTile} made: its CMP and its setters, each writing it in place. */
export type StatTile = {
  /** Its element (`.aekStatTile`): add it where it goes. */
  cmp: CMPHandle;
  /** Sets the figure: formatted only when it changed, its one text node written only when the
   * text did, so a figure set every frame is fine. */
  setValue: (value: number | string | null) => void;
  /** Sets the change (`null` hides it): written only when it changed. */
  setDelta: (delta: number | null) => void;
  /** Changes its label. */
  setLabel: (label: string) => void;
};

const NO_VALUE = '–';
const MINUS = '−';

const defaultFormatDelta = (size: number) => `${Math.round(size * 10) / 10} %`;

const createPart = (tag: string, className: string) => {
  const part = document.createElement(tag);
  part.className = className;
  return part;
};

/**
 * Creates a stat tile (p805 D9): one figure that matters, large, with its unit, the change since
 * the last period and, optionally, a sparkline of its recent values. A HUD's or a dashboard's
 * figure, set as often as it changes.
 * - Parts: `.aekStatTile` (`data-trend`: `up`, `down`, `flat` while a change shows; `data-tone`:
 *   `success` or `danger` with `goodDirection`) holding `__label`, `__figure` (`__value`, its
 *   text one node, and `__unit`), `__delta` (`hidden` without a change: `__arrow`, a CSS
 *   triangle, `__deltaText` with its sign, and the words for assistive tech) and `__spark` (the
 *   sparkline's place).
 * - Custom properties (read on any ancestor): `--aek-stat-tile-bg` (default transparent),
 *   `--aek-stat-tile-padding` (default `--aek-space-4`), `--aek-stat-tile-value-size` (default
 *   `--aek-font-size-2xl`).
 * - ARIA: plain text in reading order (the label, the figure and its unit, the change in words:
 *   "up 12 %"); the arrow and the signed text are `aria-hidden`. Not a live region: a figure set
 *   every frame would be read every frame.
 * - Never colour alone: the change has its sign, its arrow and its words; the colour only says
 *   whether it's good.
 * @example
 * ```ts
 * const frameTime = createStatTile({
 *   label: 'Frame time',
 *   unit: 'ms',
 *   format: (ms) => ms.toFixed(1),
 *   goodDirection: 'down',
 *   sparkline: createSparkline({ capacity: 60, min: 0 }),
 * });
 * hudPanel.add(frameTime.cmp);
 * frameTime.setValue(16.6);
 * frameTime.setDelta(-4.2); // "−4.2 %", in the success colour: down is good
 * ```
 */
export const createStatTile = (props: StatTileProps): StatTile => {
  const format = props.format ?? String;
  const formatDelta = props.formatDelta ?? defaultFormatDelta;
  const cmp = CMP({
    id: props.id,
    idAttr: props.id !== undefined,
    class: classes('aekStatTile', props.class),
    attr: props.attr,
  });
  const elem = cmp.elem;

  const label = createPart('p', 'aekStatTile__label');
  label.textContent = props.label;
  const figure = createPart('p', 'aekStatTile__figure');
  const valueElem = createPart('span', 'aekStatTile__value');
  const valueText = document.createTextNode(NO_VALUE);
  valueElem.append(valueText);
  figure.append(valueElem);
  if (props.unit) {
    const unit = createPart('span', 'aekStatTile__unit');
    unit.textContent = props.unit;
    figure.append(' ', unit);
  }
  const deltaElem = createPart('p', 'aekStatTile__delta');
  const arrow = createPart('span', 'aekStatTile__arrow');
  arrow.setAttribute('aria-hidden', 'true');
  const deltaText = createPart('span', 'aekStatTile__deltaText');
  deltaText.setAttribute('aria-hidden', 'true');
  const deltaWords = createPart('span', 'aekVisuallyHidden');
  deltaElem.append(arrow, deltaText, deltaWords);
  elem.append(label, figure, deltaElem);
  if (props.sparkline) {
    const spark = cmp.add({ class: 'aekStatTile__spark' });
    spark.add(props.sparkline.cmp);
  }

  let value: number | string | null | undefined;
  const setValue = (next: number | string | null) => {
    if (next === value) return;
    value = next;
    const text =
      next === null || (typeof next === 'number' && Number.isNaN(next))
        ? NO_VALUE
        : typeof next === 'number'
          ? format(next)
          : next;
    if (valueText.data !== text) valueText.data = text;
  };

  let delta: number | null | undefined;
  const setDelta = (next: number | null) => {
    if (next !== null && !Number.isFinite(next)) next = null;
    if (next === delta) return;
    delta = next;
    if (next === null) {
      deltaElem.setAttribute('hidden', '');
      elem.removeAttribute('data-trend');
      elem.removeAttribute('data-tone');
      return;
    }
    const trend = next > 0 ? 'up' : next < 0 ? 'down' : 'flat';
    const size = formatDelta(Math.abs(next));
    deltaElem.removeAttribute('hidden');
    elem.setAttribute('data-trend', trend);
    if (props.goodDirection && trend !== 'flat') {
      elem.setAttribute('data-tone', trend === props.goodDirection ? 'success' : 'danger');
    } else {
      elem.removeAttribute('data-tone');
    }
    deltaText.textContent =
      trend === 'up' ? `+${size}` : trend === 'down' ? `${MINUS}${size}` : size;
    deltaWords.textContent = trend === 'flat' ? 'no change' : `${trend} ${size}`;
  };

  setValue(props.value ?? null);
  setDelta(props.delta ?? null);

  return {
    cmp,
    setValue,
    setDelta,
    setLabel: (text) => {
      if (label.textContent !== text) label.textContent = text;
    },
  };
};
