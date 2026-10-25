import { beforeAll, describe, expect, it } from 'vitest';
import { stubKitDomAsync } from '../testing/KitDom';
import { createDivider } from './Divider';

beforeAll(async () => {
  await stubKitDomAsync();
});

describe('divider (p803 D10)', () => {
  it('is an hr across, a separator by its own role', () => {
    const { cmp } = createDivider();
    expect(cmp.elem.tagName).toBe('HR');
    expect(cmp.elem.className).toBe('aekDivider');
    expect(cmp.elem.getAttribute('data-orientation')).toBe('horizontal');
    expect(cmp.elem.hasAttribute('role')).toBe(false);
    expect(cmp.elem.hasAttribute('aria-hidden')).toBe(false);
    cmp.remove();
  });

  it('is a vertical separator down a row, and hidden when decorative', () => {
    const vertical = createDivider({ orientation: 'vertical' });
    expect(vertical.cmp.elem.tagName).toBe('DIV');
    expect(vertical.cmp.elem.getAttribute('role')).toBe('separator');
    expect(vertical.cmp.elem.getAttribute('aria-orientation')).toBe('vertical');
    const decorative = createDivider({ orientation: 'vertical', decorative: true });
    expect(decorative.cmp.elem.hasAttribute('role')).toBe(false);
    expect(decorative.cmp.elem.getAttribute('aria-hidden')).toBe('true');
    vertical.cmp.remove();
    decorative.cmp.remove();
  });
});
