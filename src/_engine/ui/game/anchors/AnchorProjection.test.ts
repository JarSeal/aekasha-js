import { describe, expect, it } from 'vitest';
import {
  PROJECTED_CLAMPED,
  PROJECTED_HIDDEN,
  PROJECTED_SHOWN,
  projectWorldPoint,
} from './AnchorProjection';
import type { WorldAnchorView } from './AnchorProjection';

/** A 90° perspective camera at (0, 0, cameraZ) looking down -z, as a column-major view-projection
 * (`projectionMatrix × matrixWorldInverse`, by hand: no three in the kit) */
const createTestView = (props: {
  width: number;
  height: number;
  cameraZ?: number;
}): WorldAnchorView => {
  const cameraZ = props.cameraZ ?? 0;
  const near = 0.1;
  const far = 100;
  const aspect = props.width / props.height;
  const a = -(far + near) / (far - near);
  const b = (-2 * far * near) / (far - near);
  const e = new Float64Array(16);
  e[0] = 1 / aspect;
  e[5] = 1;
  e[10] = a;
  e[11] = -1;
  // The view's translation (0, 0, -cameraZ) through the projection
  e[14] = -a * cameraZ + b;
  e[15] = cameraZ;
  return {
    viewProjection: e,
    width: props.width,
    height: props.height,
    cameraPosition: { x: 0, y: 0, z: cameraZ },
  };
};

const point = (x: number, y: number, z: number, clamp = false, maxDistance = Infinity) => ({
  x,
  y,
  z,
  clamp,
  maxDistance,
});

describe('anchor projection (p808 D7)', () => {
  const view = createTestView({ width: 200, height: 100, cameraZ: 10 });
  const out = new Float64Array(4);

  it('projects a point in front onto the screen, y down, with its distance', () => {
    expect(projectWorldPoint(view, point(0, 0, 0), 0, out)).toBe(PROJECTED_SHOWN);
    expect([out[0], out[1], out[3]]).toEqual([100, 50, 10]);
    // 90° vertical: at 10 units away the screen's half height is 10 units, the width 20
    expect(projectWorldPoint(view, point(10, 5, 0), 0, out)).toBe(PROJECTED_SHOWN);
    expect(out[0]).toBeCloseTo(150);
    expect(out[1]).toBeCloseTo(25);
    expect(out[3]).toBeCloseTo(Math.sqrt(225));
  });

  it('hides a point off the screen or behind the camera unless it clamps', () => {
    expect(projectWorldPoint(view, point(30, 0, 0), 0, out)).toBe(PROJECTED_HIDDEN);
    expect(projectWorldPoint(view, point(0, 0, 20), 0, out)).toBe(PROJECTED_HIDDEN);
    // On the camera's plane
    expect(projectWorldPoint(view, point(5, 0, 10), 0, out)).toBe(PROJECTED_HIDDEN);
  });

  it('culls by distance, clamped or not', () => {
    expect(projectWorldPoint(view, point(0, 0, -50, false, 40), 0, out)).toBe(PROJECTED_HIDDEN);
    expect(out[3]).toBe(60);
    expect(projectWorldPoint(view, point(0, 0, -50, true, 40), 0, out)).toBe(PROJECTED_HIDDEN);
    expect(projectWorldPoint(view, point(0, 0, -20, false, 40), 0, out)).toBe(PROJECTED_SHOWN);
  });

  it('clamps an off-screen point onto the padded edge toward it, with its angle', () => {
    // Right of the screen: onto the right edge, 10 px in, pointing right
    expect(projectWorldPoint(view, point(40, 0, 0, true), 10, out)).toBe(PROJECTED_CLAMPED);
    expect(out[0]).toBeCloseTo(190);
    expect(out[1]).toBeCloseTo(50);
    expect(out[2]).toBeCloseTo(0);
    // Above: the top edge, pointing up (y down: -90°)
    expect(projectWorldPoint(view, point(0, 30, 0, true), 10, out)).toBe(PROJECTED_CLAMPED);
    expect(out[0]).toBeCloseTo(100);
    expect(out[1]).toBeCloseTo(10);
    expect(out[2]).toBeCloseTo(-Math.PI / 2);
    // Down and right at 45° in screen px: the nearer edge (the bottom) limits it
    expect(projectWorldPoint(view, point(20, -20, 0, true), 10, out)).toBe(PROJECTED_CLAMPED);
    expect(out[0]).toBeCloseTo(140);
    expect(out[1]).toBeCloseTo(90);
  });

  it('clamps a point on the screen but inside the padding, and shows one inside it', () => {
    // 95 px right of the centre: on the screen, in the 10 px padding
    expect(projectWorldPoint(view, point(19, 0, 0, true), 10, out)).toBe(PROJECTED_CLAMPED);
    expect(out[0]).toBeCloseTo(190);
    expect(projectWorldPoint(view, point(10, 0, 0, true), 10, out)).toBe(PROJECTED_SHOWN);
    expect(out[0]).toBeCloseTo(150);
  });

  it('keeps the direction of a point behind the camera the right way round', () => {
    // Behind and to the right: the right edge (dividing by the negative w would say left)
    expect(projectWorldPoint(view, point(5, 0, 20, true), 10, out)).toBe(PROJECTED_CLAMPED);
    expect(out[0]).toBeCloseTo(190);
    expect(out[1]).toBeCloseTo(50);
    // Behind and above: the top edge
    expect(projectWorldPoint(view, point(0, 5, 20, true), 10, out)).toBe(PROJECTED_CLAMPED);
    expect(out[1]).toBeCloseTo(10);
    // Straight behind: down
    expect(projectWorldPoint(view, point(0, 0, 20, true), 10, out)).toBe(PROJECTED_CLAMPED);
    expect(out[0]).toBeCloseTo(100);
    expect(out[1]).toBeCloseTo(90);
    expect(out[2]).toBeCloseTo(Math.PI / 2);
  });
});
