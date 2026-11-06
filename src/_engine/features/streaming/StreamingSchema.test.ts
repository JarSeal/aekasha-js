import { describe, expect, test } from 'vitest';
import { SceneStreamingSchema } from './StreamingSchema';

const isValid = (value: unknown) => SceneStreamingSchema.safeParse(value).success;

describe('SceneStreamingSchema', () => {
  test('takes a power-of-two cell size of at least 32 m', () => {
    for (const cellSize of [32, 64, 256, 1024]) expect(isValid({ cellSize })).toBe(true);
    for (const cellSize of [0, 16, 48, 100, -64, 64.5]) expect(isValid({ cellSize })).toBe(false);
    expect(isValid({})).toBe(false);
  });

  test('wants resident <= nearby <= far, a ring left out being its default (1, 2, 5)', () => {
    expect(isValid({ cellSize: 64, rings: { resident: 0, nearby: 1, far: 3 } })).toBe(true);
    // Equal rings: the state between them has no cells
    expect(isValid({ cellSize: 64, rings: { resident: 2, nearby: 2 } })).toBe(true);
    expect(isValid({ cellSize: 64, rings: { resident: 3 } })).toBe(false);
    expect(isValid({ cellSize: 64, rings: { far: 1 } })).toBe(false);
    expect(isValid({ cellSize: 64, rings: { nearby: 1.5 } })).toBe(false);
  });

  test('takes a margin of 0 or more, and no unknown field', () => {
    expect(isValid({ cellSize: 64, margin: 0 })).toBe(true);
    expect(isValid({ cellSize: 64, margin: -1 })).toBe(false);
    expect(isValid({ cellSize: 64, cellsize: 32 })).toBe(false);
    expect(isValid({ cellSize: 64, rings: { resident: 1, near: 2 } })).toBe(false);
  });
});
