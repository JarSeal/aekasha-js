import { describe, expect, test } from 'vitest';
import * as THREE from 'three/webgpu';
import { createArrayWriteTarget, FLOATS_PER_SEGMENT, LineWriter } from './LineWriter';
import {
  BOX_EDGE_SEGMENT_COUNT,
  box3EdgesToSegments,
  boxEdgesToSegments,
  flattenSegmentGeometry,
  geometryEdgesToSegments,
  polylineSegmentCount,
  polylineToSegments,
  segmentCountOf,
  writeBox3Edges,
  writePolyline,
} from './LineBuilders';
import { hashLinePhase } from './LinePulse';

/** A FIXED line's target: room for `segmentCount` segments, never more. */
const createWriter = (segmentCount: number) => {
  const target = createArrayWriteTarget(segmentCount);
  return { target, writer: new LineWriter(target) };
};

/** Each segment's two endpoints, as [[ax, ay, az], [bx, by, bz]]. */
const segmentsOf = (positions: Float32Array) =>
  Array.from({ length: segmentCountOf(positions) }, (_, i) => {
    const p = positions.subarray(i * FLOATS_PER_SEGMENT, (i + 1) * FLOATS_PER_SEGMENT);
    return [Array.from(p.subarray(0, 3)), Array.from(p.subarray(3))];
  });

describe('LineWriter', () => {
  test('appends segments and counts them', () => {
    const { target, writer } = createWriter(2);
    writer.segment(0, 1, 2, 3, 4, 5).vec({ x: 6, y: 7, z: 8 }, { x: 9, y: 10, z: 11 });

    expect(writer.segmentCount).toBe(2);
    expect(Array.from(target.positions)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  test('drops what overflows a fixed target', () => {
    const { target, writer } = createWriter(1);
    writer.segment(1, 1, 1, 2, 2, 2).segment(3, 3, 3, 4, 4, 4);

    expect(writer.segmentCount).toBe(1);
    expect(Array.from(target.positions)).toEqual([1, 1, 1, 2, 2, 2]);
  });

  test('starts over after a reset', () => {
    const { target, writer } = createWriter(1);
    writer.segment(1, 1, 1, 2, 2, 2).reset().segment(3, 3, 3, 4, 4, 4);

    expect(writer.segmentCount).toBe(1);
    expect(Array.from(target.positions)).toEqual([3, 3, 3, 4, 4, 4]);
  });

  test("raw ignores a trailing partial segment and reads from 'start'", () => {
    const { target, writer } = createWriter(2);
    writer.raw([9, 0, 0, 0, 1, 1, 1, 7, 7]);
    expect(writer.segmentCount).toBe(1);
    writer.raw([9, 9, 2, 2, 2, 3, 3, 3], 2, 6);

    expect(writer.segmentCount).toBe(2);
    expect(Array.from(target.positions)).toEqual([9, 0, 0, 0, 1, 1, 2, 2, 2, 3, 3, 3]);
  });

  test('raw writes only the segments that still fit a fixed target', () => {
    for (const src of [
      [0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 5],
      new Float32Array([0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 5]),
    ]) {
      const { target, writer } = createWriter(2);
      writer.segment(9, 9, 9, 9, 9, 9).raw(src);

      expect(writer.segmentCount).toBe(2);
      expect(Array.from(target.positions)).toEqual([9, 9, 9, 9, 9, 9, 0, 0, 0, 1, 1, 1]);
    }
  });
});

describe('line builders', () => {
  test('counts a polyline’s segments', () => {
    expect(polylineSegmentCount(0)).toBe(0);
    expect(polylineSegmentCount(1, true)).toBe(0);
    expect(polylineSegmentCount(2)).toBe(1);
    expect(polylineSegmentCount(4)).toBe(3);
    expect(polylineSegmentCount(4, true)).toBe(4);
  });

  test('closes a polyline back to its first point', () => {
    const points = [
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(1, 1, 0),
    ];

    expect(segmentsOf(polylineToSegments(points, true))).toEqual([
      [
        [0, 0, 0],
        [1, 0, 0],
      ],
      [
        [1, 0, 0],
        [1, 1, 0],
      ],
      [
        [1, 1, 0],
        [0, 0, 0],
      ],
    ]);
    expect(segmentCountOf(polylineToSegments(points.slice(0, 1)))).toBe(0);
  });

  test('outlines a Box3 with its 12 axis-aligned edges', () => {
    const box = new THREE.Box3(new THREE.Vector3(-1, -2, -3), new THREE.Vector3(1, 2, 3));
    const segments = segmentsOf(box3EdgesToSegments(box));

    expect(segments).toHaveLength(BOX_EDGE_SEGMENT_COUNT);
    const lengths = segments.map(([a, b]) => Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]));
    expect(lengths.sort()).toEqual([2, 2, 2, 2, 4, 4, 4, 4, 6, 6, 6, 6]);
    expect(box3EdgesToSegments(new THREE.Box3())).toHaveLength(0);
  });

  test('rotates a box outline about its centre', () => {
    const quarterTurnY = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0),
      Math.PI / 2
    );
    const positions = boxEdgesToSegments({ x: 10, y: 0, z: 0 }, { x: 2, y: 1, z: 4 }, quarterTurnY);
    const bounds = new THREE.Box3().setFromArray(positions);

    expect(bounds.min.x).toBeCloseTo(8);
    expect(bounds.max.x).toBeCloseTo(12);
    expect(bounds.min.z).toBeCloseTo(-1);
    expect(bounds.max.z).toBeCloseTo(1);
  });

  test('the writers fit a per-frame refill: no room, no write', () => {
    const { writer } = createWriter(BOX_EDGE_SEGMENT_COUNT + 1);
    writeBox3Edges(writer, new THREE.Box3(new THREE.Vector3(), new THREE.Vector3(1, 1, 1)));
    writePolyline(writer, [
      new THREE.Vector3(),
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(2, 0, 0),
    ]);

    expect(writer.segmentCount).toBe(BOX_EDGE_SEGMENT_COUNT + 1);
  });

  test('a box geometry’s feature edges are its 12 edges', () => {
    expect(segmentCountOf(geometryEdgesToSegments(new THREE.BoxGeometry()))).toBe(12);
  });

  test('expands an indexed segment geometry through its index', () => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 1, 1, 0], 3)
    );
    geometry.setIndex([0, 1, 1, 2]);

    expect(Array.from(flattenSegmentGeometry(geometry))).toEqual([
      0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 1, 0,
    ]);
  });
});

describe('hashLinePhase', () => {
  test('is a stable phase in [0, 1)', () => {
    expect(hashLinePhase('box_1')).toBe(hashLinePhase('box_1'));
    for (let i = 0; i < 100; i++) {
      const phase = hashLinePhase(`line_${i}`);
      expect(phase).toBeGreaterThanOrEqual(0);
      expect(phase).toBeLessThan(1);
    }
  });

  test('spreads ids differing only in their last characters over the whole cycle', () => {
    const bins = new Array<number>(10).fill(0);
    for (let i = 0; i < 1000; i++) bins[Math.floor(hashLinePhase(`box_${i}`) * 10)]++;

    // 100 expected per bin; the bounds are far outside what a uniform spread misses by
    for (const count of bins) {
      expect(count).toBeGreaterThan(60);
      expect(count).toBeLessThan(140);
    }
    // Neighbours land apart, not ~0.004 cycles from each other
    expect(Math.abs(hashLinePhase('box_1') - hashLinePhase('box_2'))).toBeGreaterThan(0.01);
  });
});
