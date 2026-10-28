import { describe, expect, it } from 'vitest';
import { isInPointerPath } from './MenuItems';

describe('isInPointerPath (p805 D11)', () => {
  const box = { left: 200, right: 300, top: 0, bottom: 100 };

  it('is true for a move toward the submenu’s near edge, inside the triangle', () => {
    expect(isInPointerPath({ x: 100, y: 50 }, { x: 150, y: 50 }, box)).toBe(true);
    expect(isInPointerPath({ x: 100, y: 50 }, { x: 150, y: 30 }, box)).toBe(true);
  });

  it('is false for a move away from it, or past its top or bottom', () => {
    expect(isInPointerPath({ x: 100, y: 50 }, { x: 90, y: 50 }, box)).toBe(false);
    expect(isInPointerPath({ x: 100, y: 50 }, { x: 110, y: 120 }, box)).toBe(false);
    expect(isInPointerPath({ x: 100, y: 50 }, { x: 105, y: -20 }, box)).toBe(false);
  });

  it('heads for a submenu flipped to the left the same way', () => {
    expect(isInPointerPath({ x: 400, y: 50 }, { x: 350, y: 60 }, box)).toBe(true);
    expect(isInPointerPath({ x: 400, y: 50 }, { x: 450, y: 60 }, box)).toBe(false);
  });

  it('is false for no move at all', () => {
    expect(isInPointerPath({ x: 100, y: 50 }, { x: 100, y: 50 }, box)).toBe(false);
  });
});
