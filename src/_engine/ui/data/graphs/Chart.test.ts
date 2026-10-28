import { beforeAll, describe, expect, it } from 'vitest';
import { countListeners, stubKitDomAsync } from '../../testing/KitDom';
import { CMP } from '../../core/CMP';
import { createChart } from './Chart';

const all = (elem: HTMLElement, selector: string) => [...elem.querySelectorAll(selector)];
const texts = (elem: HTMLElement, selector: string) =>
  all(elem, selector).map((e) => e.textContent);
const attrs = (elem: HTMLElement, selector: string, names: string[]) =>
  all(elem, selector).map((e) => names.map((name) => e.getAttribute(name)));
const tableRows = (elem: HTMLElement) =>
  all(elem, '.aekChart__table tr').map((row) => [...row.children].map((cell) => cell.textContent));

beforeAll(async () => {
  await stubKitDomAsync();
});

describe('chart (p805 D9)', () => {
  it('is an image named by its title and described by its description, its values a table', () => {
    const chart = createChart({
      type: 'bar',
      title: 'Frame time by scene',
      description: 'The gym spends most of its frame in physics.',
      categories: ['Space', 'Gym'],
      series: [{ label: 'Frame', values: [8, 12] }],
      yFormat: (ms) => `${ms} ms`,
    });
    const elem = chart.cmp.elem;
    expect(elem.getAttribute('data-type')).toBe('bar');
    const figure = elem.querySelector('.aekChart__figure') as HTMLElement;
    expect(figure.getAttribute('role')).toBe('img');
    const title = elem.querySelector(`#${figure.getAttribute('aria-labelledby')}`);
    expect(title?.textContent).toBe('Frame time by scene');
    const description = elem.querySelector(`#${figure.getAttribute('aria-describedby')}`);
    expect(description?.textContent).toBe('The gym spends most of its frame in physics.');
    const caption = elem.querySelector('.aekChart__table caption');
    expect(caption?.textContent).toBe('Frame time by scene');
    expect(tableRows(elem)).toEqual([
      ['Category', 'Frame'],
      ['Space', '8 ms'],
      ['Gym', '12 ms'],
    ]);
    expect(all(elem, '.aekChart__table tbody th').map((th) => th.getAttribute('scope'))).toEqual([
      'row',
      'row',
    ]);
    // One series: no legend
    expect(elem.querySelector('.aekGraphLegend')).toBe(null);
    chart.cmp.remove();
  });

  it('draws grouped bars in bands from 0, with nice ticks and their grid lines', () => {
    const chart = createChart({
      type: 'bar',
      title: 'Draw calls',
      categories: ['A', 'B'],
      series: [
        { label: 'Opaque', values: [40, 90] },
        { label: 'Transparent', values: [10, null] },
      ],
    });
    const elem = chart.cmp.elem;
    // 0 to 100 by 20, top to bottom
    expect(texts(elem, '.aekChart__yAxis .aekChart__tick')).toEqual([
      '100',
      '80',
      '60',
      '40',
      '20',
      '0',
    ]);
    expect(attrs(elem, '.aekChart__grid[data-zero]', ['y1'])).toEqual([['100']]);
    const groups = all(elem, '.aekChart__series');
    expect(groups.map((g) => g.getAttribute('style'))).toEqual([
      '--aek-chart-color: var(--aek-chart-1)',
      '--aek-chart-color: var(--aek-chart-2)',
    ]);
    // Bands of 50, the bars 70 % of a band side by side; the null value has no bar
    expect(attrs(elem, '.aekChart__bar', ['x', 'width', 'y', 'height'])).toEqual([
      ['7.5', '17.5', '60', '40'],
      ['57.5', '17.5', '10', '90'],
      ['25', '17.5', '90', '10'],
    ]);
    expect(texts(elem, '.aekChart__xAxis .aekChart__tick')).toEqual(['A', 'B']);
    expect(
      all(elem, '.aekChart__xAxis .aekChart__tick').map((t) => (t as HTMLElement).style.left)
    ).toEqual(['25%', '75%']);
    expect(texts(elem, '.aekGraphLegend__label')).toEqual(['Opaque', 'Transparent']);
    expect(tableRows(elem)[2]).toEqual(['B', '90', '–']);
    chart.cmp.remove();
  });

  it('piles stacked bars up from 0, negatives down', () => {
    const chart = createChart({
      type: 'bar',
      title: 'Balance',
      stacked: true,
      series: [
        { label: 'In', values: [30, 20] },
        { label: 'Out', values: [-10, 20] },
      ],
    });
    const elem = chart.cmp.elem;
    // -10 to 40 by 10: 50 tall, 0 at 80
    expect(texts(elem, '.aekChart__yAxis .aekChart__tick')).toEqual([
      '40',
      '30',
      '20',
      '10',
      '0',
      '-10',
    ]);
    expect(attrs(elem, '.aekChart__bar', ['x', 'width', 'y', 'height'])).toEqual([
      ['7.5', '35', '20', '60'],
      ['57.5', '35', '40', '40'],
      ['7.5', '35', '80', '20'],
      ['57.5', '35', '0', '40'],
    ]);
    // No categories: their places
    expect(tableRows(elem).map((row) => row[0])).toEqual(['Category', '1', '2']);
    chart.cmp.remove();
  });

  it('draws a line per series broken at a gap, a dot per point, on a numeric x', () => {
    const chart = createChart({
      type: 'line',
      title: 'Frame time over a run',
      x: [0, 5, 10],
      xLabel: 'Seconds',
      xFormat: (s) => `${s} s`,
      series: [
        { label: 'Frame', values: [10, null, 20] },
        { label: 'Physics', values: [0, 5, 10], color: 'var(--aek-warning)' },
      ],
      yMin: 0,
    });
    const elem = chart.cmp.elem;
    expect(attrs(elem, '.aekChart__line', ['d'])).toEqual([
      ['M0 50M100 0'],
      ['M0 100L50 75L100 50'],
    ]);
    expect(attrs(elem, '.aekChart__points', ['d'])[0]).toEqual(['M0 50L0 50M100 0L100 0']);
    expect(all(elem, '.aekChart__series')[1].getAttribute('style')).toBe(
      '--aek-chart-color: var(--aek-warning)'
    );
    // The x axis' own ticks, the ends aligned inside
    const ticks = all(elem, '.aekChart__xAxis .aekChart__tick');
    expect(ticks.map((t) => t.textContent)).toEqual(['0 s', '2 s', '4 s', '6 s', '8 s', '10 s']);
    expect(ticks.map((t) => t.getAttribute('data-edge'))).toEqual([
      'start',
      null,
      null,
      null,
      null,
      'end',
    ]);
    expect(tableRows(elem)).toEqual([
      ['Seconds', 'Frame', 'Physics'],
      ['0 s', '10', '0'],
      ['5 s', '–', '5'],
      ['10 s', '20', '10'],
    ]);
    chart.cmp.remove();
  });

  it('shows every k-th category label past the most, and no dots on a long line', () => {
    const values = Array.from({ length: 50 }, (_, i) => i);
    const chart = createChart({ type: 'line', title: 'Load', series: [{ label: 'Load', values }] });
    const elem = chart.cmp.elem;
    // 50 categories, 8 at most: every 7th
    expect(texts(elem, '.aekChart__xAxis .aekChart__tick')).toEqual([
      '1',
      '8',
      '15',
      '22',
      '29',
      '36',
      '43',
      '50',
    ]);
    expect(elem.querySelector('.aekChart__points')).toBe(null);
    chart.cmp.remove();
  });

  it('shows and hides its table with the toggle, which a screen reader has either way', () => {
    const host = CMP();
    const chart = createChart({ type: 'bar', title: 'A', series: [{ label: 'A', values: [1] }] });
    host.add(chart.cmp);
    const elem = chart.cmp.elem;
    const toggle = elem.querySelector('.aekChart__toggle') as HTMLButtonElement;
    const box = elem.querySelector('.aekChart__tableBox') as HTMLElement;
    expect(toggle.getAttribute('aria-controls')).toBe(box.id);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(box.classList.contains('aekVisuallyHidden')).toBe(true);
    toggle.click();
    expect(chart.isTableShown()).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.textContent).toBe('Hide the table');
    expect(box.classList.contains('aekVisuallyHidden')).toBe(false);
    expect(box.hasAttribute('data-shown')).toBe(true);
    chart.setTableShown(false);
    expect(toggle.textContent).toBe('Show as table');
    expect(box.classList.contains('aekVisuallyHidden')).toBe(true);
    chart.cmp.remove();
    expect(countListeners(toggle)).toBe(0);
    host.remove();
  });

  it('draws again with new series, categories and a legend', () => {
    const chart = createChart({
      type: 'bar',
      title: 'Memory',
      categories: ['Mon'],
      series: [{ label: 'Textures', values: [5] }],
      legend: true,
    });
    const elem = chart.cmp.elem;
    expect(texts(elem, '.aekGraphLegend__label')).toEqual(['Textures']);
    chart.setSeries(
      [
        { label: 'Textures', values: [5, 6] },
        { label: 'Geometry', values: [2, 3] },
      ],
      { categories: ['Mon', 'Tue'] }
    );
    expect(texts(elem, '.aekGraphLegend__label')).toEqual(['Textures', 'Geometry']);
    expect(all(elem, '.aekChart__bar')).toHaveLength(4);
    expect(texts(elem, '.aekChart__xAxis .aekChart__tick')).toEqual(['Mon', 'Tue']);
    // Nothing to show: a 0 to 1 axis, no bars
    chart.setSeries([]);
    expect(all(elem, '.aekChart__bar')).toHaveLength(0);
    expect(texts(elem, '.aekChart__yAxis .aekChart__tick')[0]).toBe('1.0');
    chart.cmp.remove();
  });
});
