import { describe, expect, it } from 'vitest';
import { describeEntityWorldBounds, formatWorldBoundsBox } from './_dbg__WorldBoundsDraw';

// p102 Phase 3: the world bounds' folder and edit window write the box an axis per part

describe('formatWorldBoundsBox', () => {
  it('writes each closed axis, leaving out the open ones', () => {
    expect(formatWorldBoundsBox({ min: { y: -50 } })).toBe('y ≥ -50');
    expect(formatWorldBoundsBox({ min: { x: -10, y: -5 }, max: { x: 10, z: 2.5 } })).toBe(
      '-10 ≤ x ≤ 10, y ≥ -5, z ≤ 2.5'
    );
    expect(formatWorldBoundsBox({ min: { x: 0.123456 } })).toBe('x ≥ 0.123');
  });

  it('reads an infinite side as open, and says when every side is', () => {
    expect(formatWorldBoundsBox({})).toBe('Open on every side');
    expect(formatWorldBoundsBox({ min: { y: -Infinity }, max: { y: Infinity } })).toBe(
      'Open on every side'
    );
  });
});

describe('describeEntityWorldBounds', () => {
  it("names an entity's own box, ignore, or the scene's box with its own action", () => {
    expect(describeEntityWorldBounds(undefined)).toBe("None: the scene's box and action");
    expect(describeEntityWorldBounds({ ignore: true, min: { y: 0 } })).toBe(
      'Ignored: never taken out'
    );
    expect(describeEntityWorldBounds({ min: { y: -5 }, action: 'DISABLE' })).toBe(
      'y ≥ -5, DISABLE'
    );
    expect(describeEntityWorldBounds({ max: { x: 3 } })).toBe("x ≤ 3, the scene's action");
    expect(describeEntityWorldBounds({ action: 'CALLBACK', min: {} })).toBe(
      "The scene's box, CALLBACK"
    );
  });
});
