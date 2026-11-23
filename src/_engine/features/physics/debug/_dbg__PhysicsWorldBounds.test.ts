import { describe, expect, it } from 'vitest';
import { formatWorldBoundsBox } from './_dbg__PhysicsWorldBounds';

// p102 Phase 3: the Physics API tab's world bounds folder writes the box an axis per part

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
