import { beforeAll, describe, expect, it } from 'vitest';
import { stubKitDomAsync } from '../../testing/KitDom';
import { createSparkline } from './Sparkline';

const part = (elem: HTMLElement, name: string) =>
  elem.querySelector(`.aekSparkline__${name}`) as Element;
const getLine = (elem: HTMLElement) => part(elem, 'line').getAttribute('d');
const getDot = (elem: HTMLElement) => {
  const dot = part(elem, 'dot');
  return dot.getAttribute('display') === 'none'
    ? null
    : [dot.getAttribute('x1'), dot.getAttribute('y1')];
};

beforeAll(async () => {
  await stubKitDomAsync();
});

describe('sparkline (p805 D9)', () => {
  it('is hidden from assistive tech without a label, an image named by one', () => {
    const plain = createSparkline({ values: [1, 2] });
    expect(plain.cmp.elem.getAttribute('aria-hidden')).toBe('true');
    expect(plain.cmp.elem.hasAttribute('role')).toBe(false);
    const named = createSparkline({ values: [1, 2], label: 'Draw calls, 120 to 340' });
    expect(named.cmp.elem.getAttribute('role')).toBe('img');
    expect(named.cmp.elem.getAttribute('aria-label')).toBe('Draw calls, 120 to 340');
    expect(named.cmp.elem.hasAttribute('aria-hidden')).toBe(false);
    const svg = named.cmp.elem.querySelector('svg');
    expect(svg?.getAttribute('viewBox')).toBe('0 0 100 100');
    expect(svg?.getAttribute('preserveAspectRatio')).toBe('none');
    plain.cmp.remove();
    named.cmp.remove();
  });

  it('spreads the values across its width, scaled from the smallest to the largest', () => {
    const spark = createSparkline({ values: [0, 5, 10] });
    expect(getLine(spark.cmp.elem)).toBe('M0 100L50 50L100 0');
    expect(getDot(spark.cmp.elem)).toEqual(['100', '0']);
    // No area without `area`
    expect(part(spark.cmp.elem, 'area')).toBe(null);
    spark.cmp.remove();
  });

  it('breaks the line at a gap, a lone point a segment of no length (the round cap draws it)', () => {
    const spark = createSparkline({ values: [1, NaN, 2, 3] });
    expect(getLine(spark.cmp.elem)).toBe('M0 100L0 100M66.67 50L100 0');
    spark.push(NaN);
    // The last value a gap: no dot
    expect(getDot(spark.cmp.elem)).toBe(null);
    spark.cmp.remove();
  });

  it('pushes into a ring: fewer values sit at the right, past the capacity the oldest goes', () => {
    const spark = createSparkline({ capacity: 4, min: 0, max: 10 });
    expect(getLine(spark.cmp.elem)).toBe('');
    expect(getDot(spark.cmp.elem)).toBe(null);
    spark.push(2);
    spark.push(4);
    expect(getLine(spark.cmp.elem)).toBe('M66.67 80L100 60');
    spark.push(6);
    spark.push(8);
    spark.push(10);
    // 2 dropped: 4, 6, 8, 10 across the whole width
    expect(getLine(spark.cmp.elem)).toBe('M0 60L33.33 40L66.67 20L100 0');
    spark.setValues([1, 2, 3, 4, 5, 6]);
    // Only the newest four kept
    expect(getLine(spark.cmp.elem)).toBe('M0 70L33.33 60L66.67 50L100 40');
    spark.clear();
    expect(getLine(spark.cmp.elem)).toBe('');
    spark.cmp.remove();
  });

  it('clamps to a fixed range, and draws one value repeated across the middle', () => {
    const fixed = createSparkline({ values: [-5, 5, 15], min: 0, max: 10 });
    expect(getLine(fixed.cmp.elem)).toBe('M0 100L50 50L100 0');
    const flat = createSparkline({ values: [3, 3, 3] });
    expect(getLine(flat.cmp.elem)).toBe('M0 50L50 50L100 50');
    fixed.cmp.remove();
    flat.cmp.remove();
  });

  it('fills the area under each run down to the bottom', () => {
    const spark = createSparkline({ values: [0, 10, NaN, 10], area: true });
    expect(spark.cmp.elem.hasAttribute('data-area')).toBe(true);
    expect(part(spark.cmp.elem, 'area').getAttribute('d')).toBe(
      'M0 100L0 100L33.33 0L33.33 100ZM100 100L100 0L100 100Z'
    );
    spark.cmp.remove();
  });

  it('takes a capacity of its values, else 60', () => {
    const spark = createSparkline();
    for (let i = 0; i < 61; i++) spark.push(i);
    // 60 held: the first at the left is 1
    expect(getLine(spark.cmp.elem)?.startsWith('M0 100L1.69 98.31')).toBe(true);
    spark.cmp.remove();
  });
});
