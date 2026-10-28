import { beforeAll, describe, expect, it, vi } from 'vitest';
import { stubKitDomAsync } from '../../testing/KitDom';
import { createDonut } from './Donut';

const getProp = (elem: HTMLElement, name: string) => elem.style.getPropertyValue(name);
const getLegend = (elem: HTMLElement) =>
  [...elem.querySelectorAll('.aekGraphLegend__item')].map((item) => item.textContent);

beforeAll(async () => {
  await stubKitDomAsync();
});

describe('donut (p805 D9)', () => {
  it('without a label is decorative: hidden, no role (a figure beside it says what it shows)', () => {
    const donut = createDonut({ value: 0.25, size: 12 });
    const elem = donut.cmp.elem;
    expect(elem.getAttribute('aria-hidden')).toBe('true');
    expect(elem.hasAttribute('role')).toBe(false);
    expect(elem.getAttribute('data-mode')).toBe('value');
    expect(getProp(elem, '--aek-donut-value')).toBe('25');
    expect(getProp(elem, '--aek-donut-size')).toBe('12px');
    expect(elem.hasAttribute('aria-valuenow')).toBe(false);
    expect(elem.querySelector('.aekGraphLegend')).toBe(null);
    donut.cmp.remove();
  });

  it('one value with a label is a meter, its value written only when it changed', () => {
    const donut = createDonut({ label: 'Budget used', value: 0.4, size: '3em' });
    const elem = donut.cmp.elem;
    expect(elem.getAttribute('role')).toBe('meter');
    expect(elem.getAttribute('aria-label')).toBe('Budget used');
    expect(elem.getAttribute('aria-valuemin')).toBe('0');
    expect(elem.getAttribute('aria-valuemax')).toBe('100');
    expect(elem.getAttribute('aria-valuenow')).toBe('40');
    expect(elem.getAttribute('aria-valuetext')).toBe('40 %');
    expect(getProp(elem, '--aek-donut-size')).toBe('3em');
    const setProperty = vi.spyOn(elem.style, 'setProperty');
    donut.setValue(0.4002);
    expect(setProperty).not.toHaveBeenCalled();
    donut.setValue(0.4126);
    expect(setProperty).toHaveBeenCalledTimes(1);
    expect(getProp(elem, '--aek-donut-value')).toBe('41.3');
    expect(elem.getAttribute('aria-valuenow')).toBe('41.3');
    expect(elem.getAttribute('aria-valuetext')).toBe('41 %');
    donut.setValue(3);
    expect(elem.getAttribute('aria-valuenow')).toBe('100');
    donut.setValue(NaN);
    expect(elem.getAttribute('aria-valuenow')).toBe('0');
    // Parts aren't this donut's
    donut.setParts([{ label: 'A', value: 1 }]);
    expect(getProp(elem, '--aek-donut-parts')).toBe('');
    setProperty.mockRestore();
    donut.cmp.remove();
  });

  it('parts are an image whose label lists them, in the chart series by default, with a legend', () => {
    const donut = createDonut({
      label: 'GPU memory',
      parts: [
        { label: 'Textures', value: 3 },
        { label: 'Geometry', value: 1 },
        { label: 'Buffers', value: 0 },
      ],
    });
    const elem = donut.cmp.elem;
    expect(elem.getAttribute('role')).toBe('img');
    expect(elem.getAttribute('data-mode')).toBe('parts');
    expect(elem.getAttribute('aria-label')).toBe(
      'GPU memory: Textures 75 %, Geometry 25 %, Buffers 0 %'
    );
    expect(getProp(elem, '--aek-donut-parts')).toBe(
      'var(--aek-chart-1) 0% 75%, var(--aek-chart-2) 75% 100%, transparent 100% 100%'
    );
    const legend = elem.querySelector('.aekGraphLegend');
    expect(legend?.getAttribute('aria-hidden')).toBe('true');
    expect(getLegend(elem)).toEqual(['Textures75 %', 'Geometry25 %', 'Buffers0 %']);
    const swatch = elem.querySelector('.aekGraphLegend__swatch') as HTMLElement;
    expect(getProp(swatch, '--aek-graph-swatch')).toBe('var(--aek-chart-1)');
    donut.cmp.remove();
  });

  it('takes shares of a total (the rest the track), its own colours and format, and new parts', () => {
    const donut = createDonut({
      label: 'Memory',
      parts: [
        { label: 'Used', value: 128, color: 'var(--aek-warning)' },
        { label: 'Cache', value: 64 },
      ],
      total: 512,
      format: (megabytes, share) => `${megabytes} MB (${Math.round(share * 100)} %)`,
      centre: '38 %',
    });
    const elem = donut.cmp.elem;
    expect(getProp(elem, '--aek-donut-parts')).toBe(
      'var(--aek-warning) 0% 25%, var(--aek-chart-2) 25% 37.5%, transparent 37.5% 100%'
    );
    expect(elem.getAttribute('aria-label')).toBe('Memory: Used 128 MB (25 %), Cache 64 MB (13 %)');
    const centre = elem.querySelector('.aekDonut__centre');
    expect(centre?.textContent).toBe('38 %');
    expect(centre?.getAttribute('aria-hidden')).toBe('true');
    donut.setCentre('');
    expect(centre?.textContent).toBe('');
    // Past the total: cut at the end
    donut.setParts([{ label: 'Used', value: 600 }], 512);
    expect(getProp(elem, '--aek-donut-parts')).toBe(
      'var(--aek-chart-1) 0% 100%, transparent 100% 100%'
    );
    expect(getLegend(elem)).toEqual(['Used600 MB (117 %)']);
    // The total kept: no parts, the track alone
    donut.setParts([]);
    expect(getProp(elem, '--aek-donut-parts')).toBe('transparent 0% 100%');
    expect(elem.getAttribute('aria-label')).toBe('Memory');
    // No total: their sum
    donut.setParts([{ label: 'Used', value: 2 }], 0);
    expect(getLegend(elem)).toEqual(['Used2 MB (100 %)']);
    donut.cmp.remove();
  });

  it('leaves the legend out with `legend: false`, and is decorative without a label', () => {
    const donut = createDonut({ parts: [{ label: 'A', value: 1 }], legend: false });
    expect(donut.cmp.elem.querySelector('.aekGraphLegend')).toBe(null);
    expect(donut.cmp.elem.getAttribute('aria-hidden')).toBe('true');
    expect(donut.cmp.elem.hasAttribute('aria-label')).toBe(false);
    donut.cmp.remove();
  });
});
