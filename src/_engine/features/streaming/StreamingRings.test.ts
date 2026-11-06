import { describe, expect, test } from 'vitest';
import { decideStreamingLevel, getCellEdgeDistance, StreamingLevel } from './StreamingRings';
import { resolveStreamingSettings } from './StreamingSettings';

const { RESIDENT, NEARBY, FAR, UNLOADED } = StreamingLevel;
// Rings 1, 2, 5; margin 16 m
const settings = resolveStreamingSettings({ cellSize: 64 });

describe('getCellEdgeDistance', () => {
  test('is 0 inside the cell and the larger gap along x or z outside it', () => {
    expect(getCellEdgeDistance(0, 0, 64, 10, 60)).toBe(0);
    expect(getCellEdgeDistance(2, 0, 64, 10, 60)).toBe(118);
    expect(getCellEdgeDistance(-1, 1, 64, 10, 60)).toBe(10);
    expect(getCellEdgeDistance(-1, 3, 64, 10, 60)).toBe(132);
  });
});

describe('decideStreamingLevel', () => {
  test('promotes to the nearest level whose ring holds the cell', () => {
    expect(decideStreamingLevel(UNLOADED, 0, 0, settings)).toBe(RESIDENT);
    expect(decideStreamingLevel(UNLOADED, 1, 10, settings)).toBe(RESIDENT);
    expect(decideStreamingLevel(UNLOADED, 2, 70, settings)).toBe(NEARBY);
    expect(decideStreamingLevel(NEARBY, 1, 50, settings)).toBe(RESIDENT);
    expect(decideStreamingLevel(UNLOADED, 5, 300, settings)).toBe(FAR);
    expect(decideStreamingLevel(UNLOADED, 6, 330, settings)).toBe(UNLOADED);
  });

  test('demotes only past the ring plus the margin, measured to the edge', () => {
    // A RESIDENT cell now in ring 2: kept until the focus is more than 64 + 16 m from its edge
    expect(decideStreamingLevel(RESIDENT, 2, 64, settings)).toBe(RESIDENT);
    expect(decideStreamingLevel(RESIDENT, 2, 80, settings)).toBe(RESIDENT);
    expect(decideStreamingLevel(RESIDENT, 2, 80.5, settings)).toBe(NEARBY);
    // A NEARBY cell now in ring 3: kept to 144 m
    expect(decideStreamingLevel(NEARBY, 3, 144, settings)).toBe(NEARBY);
    expect(decideStreamingLevel(NEARBY, 3, 145, settings)).toBe(FAR);
    // A jump goes to the nearest level that still keeps it
    expect(decideStreamingLevel(RESIDENT, 4, 200, settings)).toBe(FAR);
    expect(decideStreamingLevel(RESIDENT, 9, 600, settings)).toBe(UNLOADED);
  });

  test('a focus moving back and forth over a boundary changes nothing', () => {
    // The cell at cx = 3 ([192, 256)) seen from a focus walking over x = 128, where it's ring 2
    // on one side and ring 1 on the other
    let level: StreamingLevel = UNLOADED;
    const levels: StreamingLevel[] = [];
    for (const x of [100, 129, 127, 129, 127, 113, 111]) {
      const ring = Math.abs(3 - Math.floor(x / 64));
      level = decideStreamingLevel(level, ring, getCellEdgeDistance(3, 0, 64, x, 32), settings);
      levels.push(level);
    }
    // Promoted on crossing, kept back over it (65 m <= 64 + 16), demoted only past 80 m
    expect(levels).toEqual([NEARBY, RESIDENT, RESIDENT, RESIDENT, RESIDENT, RESIDENT, NEARBY]);
  });

  test('equal rings give the state between them no cells', () => {
    const noNearby = resolveStreamingSettings({ cellSize: 64, rings: { resident: 2, nearby: 2 } });
    expect(decideStreamingLevel(UNLOADED, 2, 70, noNearby)).toBe(RESIDENT);
    expect(decideStreamingLevel(RESIDENT, 3, 150, noNearby)).toBe(FAR);
  });
});
