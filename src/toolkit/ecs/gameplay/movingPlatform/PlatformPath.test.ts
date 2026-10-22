import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import {
  createPlatformPath,
  hasMoveAndTurn,
  playPlatformPath,
  playPlatformPathSegment,
  setPlatformPathOptions,
  stepPlatformPath,
  stopPlatformPath,
  validateMovingPlatform,
  type MovingPlatformPoint,
  type PlatformPath,
  type PlatformPathOptions,
  type PlatformStepResult,
} from './PlatformPath';

// Three points, a second between each: 0 → 1 → 2 → back to 0
const POINTS: MovingPlatformPoint[] = [
  { pos: { x: 0, y: 0, z: 0 }, dur: 1000 },
  { pos: { x: 10, y: 0, z: 0 }, dur: 1000 },
  { pos: { x: 10, y: 0, z: 10 }, dur: 1000 },
];
const DT = 0.25;

const pos = new THREE.Vector3();
const rot = new THREE.Quaternion();
const step = (path: PlatformPath, dt = DT) => stepPlatformPath(path, dt, pos, rot);

// Steps until the path stops (or 1,000 steps): the point each segment ended on, in order
const runToEnd = (path: PlatformPath) => {
  const arrivals: number[] = [];
  for (let i = 0; i < 1000 && path.isPlaying; i++) {
    const result = step(path);
    if (result === 'SEGMENT' || result === 'END') arrivals.push(path.curIndex);
  }
  return arrivals;
};

const quatY = (degrees: number) =>
  new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (degrees * Math.PI) / 180);

describe('stepPlatformPath', () => {
  it('runs the closed path forward, a loop ending on each arrival at point 0', () => {
    const path = createPlatformPath(POINTS, { loopTimes: 1 });
    expect(runToEnd(path)).toEqual([1, 2, 0, 1, 2, 0]);
    expect(path.currentLoopCount).toBe(2);
    expect(path.isEnded).toBe(true);
    expect(pos.toArray()).toEqual([0, 0, 0]);
  });

  it('runs the path backward over every point, as many loops', () => {
    const path = createPlatformPath(POINTS, { loopTimes: 1, direction: 'BACKWARD' });
    expect(runToEnd(path)).toEqual([2, 1, 0, 2, 1, 0]);
    expect(path.currentLoopCount).toBe(2);
  });

  it('runs once with loopTimes 0, and on forever with -1', () => {
    expect(runToEnd(createPlatformPath(POINTS, { loopTimes: 0 }))).toEqual([1, 2, 0]);
    const forever = createPlatformPath(POINTS);
    for (let i = 0; i < 4 * 12; i++) step(forever);
    expect(forever.isPlaying).toBe(true);
    expect(forever.currentLoopCount).toBe(4);
  });

  it("times a backward segment by its forward edge's dur", () => {
    const points = POINTS.map((point, i) => ({ ...point, dur: (i + 1) * 1000 }));
    const path = createPlatformPath(points, { direction: 'BACKWARD' });
    // 0 → 2 is the edge 2 → 0, then 2 → 1 the edge 1 → 2
    expect(path.segmentDuration).toBe(3);
    for (let i = 0; i < 12; i++) step(path);
    expect([path.curIndex, path.segmentDuration]).toEqual([2, 2]);
  });

  it('lands each segment exactly on its point', () => {
    const path = createPlatformPath(POINTS);
    const results: PlatformStepResult[] = [];
    for (let i = 0; i < 4; i++) results.push(step(path, 0.3));
    expect(results).toEqual(['MOVED', 'MOVED', 'MOVED', 'SEGMENT']);
    expect(pos.toArray()).toEqual([10, 0, 0]);
    expect([path.curIndex, path.nextIndex, path.t]).toEqual([1, 2, 0]);
  });

  it("jumps a dur 0 segment in one step, holds at a speed of 0, and doesn't write NaN", () => {
    const jump = createPlatformPath([{ ...POINTS[0], dur: 0 }, POINTS[1]]);
    expect(step(jump)).toBe('SEGMENT');
    expect(pos.toArray()).toEqual([10, 0, 0]);

    for (const dur of [1000, 0]) {
      const held = createPlatformPath([{ ...POINTS[0], dur }, POINTS[1]], { speedMultiplier: 0 });
      expect(step(held)).toBe('MOVED');
      expect(held.t).toBe(0);
      expect(pos.toArray()).toEqual([0, 0, 0]);
    }
  });

  it('is IDLE and writes no pose while not playing', () => {
    const path = createPlatformPath(POINTS, {}, false);
    pos.set(7, 7, 7);
    expect(step(path)).toBe('IDLE');
    expect(pos.toArray()).toEqual([7, 7, 7]);
  });
});

describe('createPlatformPath', () => {
  it("resolves a missing rot to the point before it, point 0's to none", () => {
    const quarter = quatY(90);
    const path = createPlatformPath([
      POINTS[0],
      { ...POINTS[1], rot: { x: 0, y: 2 * quarter.y, z: 0, w: 2 * quarter.w } },
      POINTS[2],
    ]);
    expect(path.rotations[0].equals(new THREE.Quaternion())).toBe(true);
    // Normalized when read
    expect(path.rotations[1].angleTo(quarter)).toBeLessThan(1e-7);
    expect(path.rotations[2].equals(path.rotations[1])).toBe(true);
  });
});

describe('the controls', () => {
  it('playSegment plays one segment from its start, then stops on its end point', () => {
    const path = createPlatformPath(POINTS, {}, false);
    expect(playPlatformPathSegment(path, 1)).toBe(true);
    expect(runToEnd(path)).toEqual([2]);
    expect(pos.toArray()).toEqual([10, 0, 10]);
    expect([path.isPlaying, path.targetSegmentIndex]).toEqual([false, null]);
    // A bad index changes nothing
    expect(playPlatformPathSegment(path, 3)).toBe(false);
    expect(playPlatformPathSegment(path, 0.5)).toBe(false);
    expect(path.isPlaying).toBe(false);
  });

  it('play after the last loop ended starts the loops over', () => {
    const path = createPlatformPath(POINTS, { loopTimes: 0 });
    runToEnd(path);
    playPlatformPath(path);
    expect([path.isEnded, path.currentLoopCount]).toEqual([false, 0]);
    expect(runToEnd(path)).toEqual([1, 2, 0]);
  });

  it("play from an index starts that segment and drops playSegment's target", () => {
    const path = createPlatformPath(POINTS, {}, false);
    playPlatformPathSegment(path, 0);
    step(path);
    expect(playPlatformPath(path, 2)).toBe(true);
    expect([path.curIndex, path.nextIndex, path.t, path.targetSegmentIndex]).toEqual([
      2,
      0,
      0,
      null,
    ]);
    expect(playPlatformPath(path, 5)).toBe(false);
    expect(path.curIndex).toBe(2);
  });

  it('stop puts the path back at point 0 and resets the loops and the target', () => {
    const path = createPlatformPath(POINTS, { loopTimes: 1 });
    for (let i = 0; i < 16; i++) step(path);
    playPlatformPathSegment(path, 1);
    stopPlatformPath(path);
    expect(path).toMatchObject({
      isPlaying: false,
      isEnded: false,
      currentLoopCount: 0,
      targetSegmentIndex: null,
      curIndex: 0,
      nextIndex: 1,
      t: 0,
    });
  });

  it('a direction change mid-segment turns the platform round where it is', () => {
    const path = createPlatformPath(POINTS);
    step(path, 0.3);
    const before = pos.clone();
    setPlatformPathOptions(path, { direction: 'BACKWARD' });
    expect([path.curIndex, path.nextIndex]).toEqual([1, 0]);
    // No jump: a zero step lands where it was
    step(path, 0);
    expect(pos.distanceTo(before)).toBeLessThan(1e-12);
    // Back at point 0 after the 0.3 s it took to get here, then on backward
    expect(step(path, 0.29)).toBe('MOVED');
    expect(step(path, 0.02)).toBe('SEGMENT');
    expect(pos.toArray()).toEqual([0, 0, 0]);
    expect([path.curIndex, path.nextIndex]).toEqual([0, 2]);
  });

  it('a direction change at a segment start runs from the same point the other way', () => {
    const path = createPlatformPath(POINTS);
    setPlatformPathOptions(path, { direction: 'BACKWARD' });
    expect([path.curIndex, path.nextIndex, path.t]).toEqual([0, 2, 0]);
    setPlatformPathOptions(path, { direction: 'BACKWARD', loopTimes: 3, speedMultiplier: 2 });
    expect([path.curIndex, path.loopTimes, path.speedMultiplier]).toEqual([0, 3, 2]);
  });
});

describe('hasMoveAndTurn', () => {
  const at = (x: number, degrees?: number): MovingPlatformPoint => ({
    pos: { x, y: 0, z: 0 },
    rot: degrees === undefined ? undefined : quatY(degrees),
  });

  it('is true only when one segment both moves and turns', () => {
    // A carousel turning in place, a lift without a rot, a cart turning while it moves
    expect(hasMoveAndTurn(createPlatformPath([at(0, 0), at(0, 90), at(0, 180)]))).toBe(false);
    expect(hasMoveAndTurn(createPlatformPath([at(0), at(5)]))).toBe(false);
    expect(hasMoveAndTurn(createPlatformPath([at(0, 0), at(5, 90)]))).toBe(true);
    // The segment back to point 0 counts too
    expect(hasMoveAndTurn(createPlatformPath([at(0, 0), at(0, 90), at(5, 90)]))).toBe(true);
    expect(hasMoveAndTurn(createPlatformPath([at(0, 0)]))).toBe(false);
  });
});

describe('validateMovingPlatform', () => {
  const valid = {
    id: 'p',
    physicsParams: { rigidBody: { rigidType: 'POS_BASED' } },
    points: POINTS,
  };
  const expectFail = (
    change: Partial<Parameters<typeof validateMovingPlatform>[0]>,
    message: RegExp
  ) => expect(() => validateMovingPlatform({ ...valid, ...change })).toThrow(message);

  it('passes a platform it can make', () => {
    expect(() => validateMovingPlatform(valid)).not.toThrow();
    expect(() =>
      validateMovingPlatform({
        ...valid,
        shape: { geo: {}, mat: {} },
        physicsParams: [valid.physicsParams],
      })
    ).not.toThrow();
  });

  it('throws naming the platform and what is wrong', () => {
    expectFail({ shape: {} }, /"p": a shape needs a mesh, or a geo and a mat/);
    expectFail({ shape: { geo: {} } }, /a shape with a geo needs a mat/);
    expectFail({ physicsParams: [] }, /physicsParams has no entry/);
    expectFail({ physicsParams: { rigidBody: { rigidType: 'DYNAMIC' } } }, /POS_BASED/);
    expectFail({ points: [] }, /points is empty/);
    expectFail({ points: [{ ...POINTS[0], dur: -1 }] }, /point 0's dur \(-1\)/);
    expectFail({ points: [{ ...POINTS[0], dur: Number.NaN }] }, /point 0's dur/);
    const opts = (o: PlatformPathOptions) => ({ opts: o });
    expectFail(opts({ loopTimes: 1.5 }), /loopTimes \(1.5\)/);
    expectFail(opts({ loopTimes: -2 }), /loopTimes/);
    expectFail(opts({ speedMultiplier: -1 }), /speedMultiplier \(-1\)/);
  });
});
