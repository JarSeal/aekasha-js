// What the graphs share (p805 D9): a part's type, its colour and share, the text that says the
// parts (a role="img" label, a legend's lines) and the legend. No listeners, nothing at load.
import './GraphParts.scss';

/** A part of a donut or a stacked bar: what it is and how much. */
export type GraphPart = {
  /** Its name, in the legend and the accessible label ('Textures'). */
  label: string;
  /** Its amount; not finite or below 0 counts as 0. */
  value: number;
  /** Its colour, any CSS colour (default the chart series in order, `--aek-chart-1` to `-6`, then
   * again): a status role only for a status (a budget's over part). */
  color?: string;
};

/**
 * How a part's amount reads: its value and its share of the whole (0..1). The default is the share
 * as a rounded percent ('40 %').
 */
export type GraphPartFormat = (value: number, share: number) => string;

/**
 * A part's amount, not finite or below 0 read as 0
 * @internal
 */
export const readPartValue = (value: number) => (Number.isFinite(value) && value > 0 ? value : 0);

/**
 * The parts' sum, or `total` when it's given and positive: what each part is a share of
 * @internal
 */
export const getPartsWhole = (parts: readonly GraphPart[], total?: number) => {
  if (total !== undefined && Number.isFinite(total) && total > 0) return total;
  let sum = 0;
  for (const part of parts) sum += readPartValue(part.value);
  return sum;
};

/**
 * A share as a rounded percent ('40 %'), the parts' default format
 * @internal
 */
export const formatShare: GraphPartFormat = (_value, share) => `${Math.round(share * 100)} %`;

/**
 * A part's colour: its own, else the chart series by its place (six, then again)
 * @internal
 */
export const getPartColor = (part: GraphPart, index: number) =>
  part.color ?? `var(--aek-chart-${(index % 6) + 1})`;

/**
 * What a label says of the parts: 'Memory: Textures 40 %, Geometry 25 %'
 * @internal
 */
export const describeParts = (
  label: string,
  parts: readonly GraphPart[],
  whole: number,
  format: GraphPartFormat
) => {
  const lines = parts.map((part) => {
    const value = readPartValue(part.value);
    return `${part.label} ${format(value, whole > 0 ? value / whole : 0)}`;
  });
  return lines.length ? `${label}: ${lines.join(', ')}` : label;
};

/**
 * Writes a legend's lines (`.aekGraphLegend`, `aria-hidden`: the graph's label says the same):
 * a swatch, the name and the amount per part, the lines made or removed to match
 * @internal
 */
export const writeLegend = (
  legend: HTMLElement,
  parts: readonly GraphPart[],
  whole: number,
  format: GraphPartFormat
) => {
  while (legend.children.length > parts.length) legend.lastElementChild?.remove();
  while (legend.children.length < parts.length) {
    const item = document.createElement('li');
    item.className = 'aekGraphLegend__item';
    const swatch = document.createElement('span');
    swatch.className = 'aekGraphLegend__swatch';
    const name = document.createElement('span');
    name.className = 'aekGraphLegend__label';
    const amount = document.createElement('span');
    amount.className = 'aekGraphLegend__value';
    item.append(swatch, name, amount);
    legend.append(item);
  }
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const [swatch, name, amount] = legend.children[i].children as unknown as HTMLElement[];
    const value = readPartValue(part.value);
    const text = format(value, whole > 0 ? value / whole : 0);
    swatch.style.setProperty('--aek-graph-swatch', getPartColor(part, i));
    if (name.textContent !== part.label) name.textContent = part.label;
    if (amount.textContent !== text) amount.textContent = text;
  }
};

/**
 * A legend's list, `aria-hidden`
 * @internal
 */
export const createLegend = () => {
  const legend = document.createElement('ul');
  legend.className = 'aekGraphLegend';
  legend.setAttribute('aria-hidden', 'true');
  return legend;
};
