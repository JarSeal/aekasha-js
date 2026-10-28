import { beforeAll, describe, expect, it } from 'vitest';
import { stubKitDomAsync } from '../../testing/KitDom';
import { createStackedBar } from './StackedBar';

const getSegments = (elem: HTMLElement) =>
  [...elem.querySelectorAll('.aekStackedBar__segment')].map((segment) => {
    const s = segment as HTMLElement;
    return s.hasAttribute('hidden') ? null : [s.style.width, s.getAttribute('title')];
  });

beforeAll(async () => {
  await stubKitDomAsync();
});

describe('stacked bar (p805 D9)', () => {
  it('is an image named by its label and each part, a segment per part as its share', () => {
    const bar = createStackedBar({
      label: 'Frame by stage',
      parts: [
        { label: 'Physics', value: 2 },
        { label: 'Render', value: 6 },
        { label: 'Logic', value: 0 },
      ],
    });
    const elem = bar.cmp.elem;
    expect(elem.getAttribute('role')).toBe('img');
    expect(elem.getAttribute('aria-label')).toBe(
      'Frame by stage: Physics 25 %, Render 75 %, Logic 0 %'
    );
    // A part of nothing is hidden
    expect(getSegments(elem)).toEqual([['25%', 'Physics: 25 %'], ['75%', 'Render: 75 %'], null]);
    const segment = elem.querySelector('.aekStackedBar__segment') as HTMLElement;
    expect(segment.style.getPropertyValue('--aek-stacked-bar-color')).toBe('var(--aek-chart-1)');
    expect(elem.hasAttribute('data-over')).toBe(false);
    expect(elem.querySelector('.aekGraphLegend')).toBe(null);
    bar.cmp.remove();
  });

  it('against a total: the rest is the track, past it the bar is cut and marked over', () => {
    const bar = createStackedBar({
      label: 'GPU memory',
      parts: [{ label: 'Used', value: 128, color: 'var(--aek-info)' }],
      total: 512,
      format: (megabytes) => `${megabytes} MB`,
      legend: true,
    });
    const elem = bar.cmp.elem;
    expect(getSegments(elem)).toEqual([['25%', 'Used: 128 MB']]);
    expect(elem.getAttribute('aria-label')).toBe('GPU memory: Used 128 MB');
    const legend = elem.querySelector('.aekGraphLegend');
    expect(legend?.getAttribute('aria-hidden')).toBe('true');
    expect(legend?.textContent).toBe('Used128 MB');
    // The total is kept
    bar.setParts([
      { label: 'Used', value: 400 },
      { label: 'Spike', value: 200 },
    ]);
    expect(getSegments(elem)).toEqual([
      ['78.1%', 'Used: 400 MB'],
      ['21.9%', 'Spike: 200 MB'],
    ]);
    expect(elem.hasAttribute('data-over')).toBe(true);
    bar.setParts([{ label: 'Used', value: 100 }], 0);
    // No total: the bar is full, the second segment hidden
    expect(getSegments(elem)).toEqual([['100%', 'Used: 100 MB'], null]);
    expect(elem.hasAttribute('data-over')).toBe(false);
    expect(elem.querySelectorAll('.aekGraphLegend__item')).toHaveLength(1);
    bar.cmp.remove();
  });

  it('writes a width only when its share to a thousandth changed', () => {
    const bar = createStackedBar({
      label: 'Load',
      parts: [{ label: 'Busy', value: 1 }],
      total: 4,
    });
    const segment = bar.cmp.elem.querySelector('.aekStackedBar__segment') as HTMLElement;
    // A mark the bar would overwrite: no write leaves it
    segment.style.width = '1px';
    bar.setParts([{ label: 'Busy', value: 1.0001 }]);
    expect(segment.style.width).toBe('1px');
    bar.setParts([{ label: 'Busy', value: 2 }]);
    expect(segment.style.width).toBe('50%');
    bar.cmp.remove();
  });
});
