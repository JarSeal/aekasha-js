import { beforeAll, describe, expect, it } from 'vitest';
import { stubKitDomAsync } from '../testing/KitDom';
import { createSkeleton } from './Skeleton';

beforeAll(async () => {
  await stubKitDomAsync();
});

describe('skeleton (p803 D10)', () => {
  it('draws three hidden text lines by default', () => {
    const { cmp } = createSkeleton();
    expect(cmp.elem.className).toBe('aekSkeleton');
    expect(cmp.elem.getAttribute('data-shape')).toBe('lines');
    expect(cmp.elem.getAttribute('aria-hidden')).toBe('true');
    expect(cmp.elem.querySelectorAll('.aekSkeleton__line')).toHaveLength(3);
    cmp.remove();
  });

  it('draws a block or a circle in its size, with no lines', () => {
    const block = createSkeleton({ shape: 'block', width: '160px', height: '90px', lines: 5 });
    expect(block.cmp.elem.getAttribute('data-shape')).toBe('block');
    expect(block.cmp.elem.style.width).toBe('160px');
    expect(block.cmp.elem.style.height).toBe('90px');
    expect(block.cmp.elem.children).toHaveLength(0);
    const circle = createSkeleton({ shape: 'circle', id: 'avatarSkeleton' });
    expect(circle.cmp.elem.id).toBe('avatarSkeleton');
    expect(circle.cmp.elem.getAttribute('data-shape')).toBe('circle');
    expect(circle.cmp.elem.style.width).toBe('');
    block.cmp.remove();
    circle.cmp.remove();
  });

  it('draws at least one line', () => {
    const { cmp } = createSkeleton({ lines: 0 });
    expect(cmp.elem.querySelectorAll('.aekSkeleton__line')).toHaveLength(1);
    cmp.remove();
  });
});
