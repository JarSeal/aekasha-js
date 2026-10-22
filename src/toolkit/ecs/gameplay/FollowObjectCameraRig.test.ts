import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import type { ECSWorld } from 'aekasha';
import {
  createFollowObjectCameraRig,
  deleteFollowObjectCameraRig,
  registerFollowObjectCameraRigSystem,
  type FollowObjectCameraParams,
} from './FollowObjectCameraRig';

const DT = 1 / 60;
const RIG_ID = 'testRig';

// The shared system, captured from a stub world (the rig needs no renderer), which stands in for
// the default world; the scene exit listener and the current scene, stubbed
let systemFn: ((world: ECSWorld, dt: number) => void) | null = null;
const stubs = vi.hoisted(() => ({
  defaultWorld: null as unknown,
  sceneExitFn: null as (() => void) | null,
  currentSceneId: null as string | null,
}));
const stubWorld = {
  addSystem: (_stage: unknown, _name: string, fn: (world: ECSWorld, dt: number) => void) => {
    systemFn = fn;
  },
} as unknown as ECSWorld;
stubs.defaultWorld = stubWorld;
vi.mock('aekasha', async (importOriginal) => ({
  ...(await importOriginal<typeof import('aekasha')>()),
  getECSWorld: () => stubs.defaultWorld,
  getCurrentSceneId: () => stubs.currentSceneId,
  registerOnAllSceneExits: (_id: string, fn: () => void) => (stubs.sceneExitFn = fn),
}));
registerFollowObjectCameraRigSystem(stubWorld);
// The exit of the scene `sceneId`, as the scene loader runs it
const exitScene = (sceneId: string) => {
  stubs.currentSceneId = sceneId;
  stubs.sceneExitFn!();
};

const runFrames = (count: number, onFrame?: (frame: number) => void) => {
  for (let i = 0; i < count; i++) {
    onFrame?.(i);
    systemFn!(stubWorld, DT);
  }
};

const createRig = (opts: Partial<FollowObjectCameraParams> = {}) => {
  const camera = new THREE.PerspectiveCamera();
  const targetMesh = new THREE.Mesh();
  createFollowObjectCameraRig({
    id: RIG_ID,
    camera,
    targetMesh,
    offset: { x: 0, y: 10, z: 5 },
    ...opts,
  });
  return { camera, targetMesh };
};

afterEach(() => deleteFollowObjectCameraRig(RIG_ID));

describe('createFollowObjectCameraRig', () => {
  it('turns toward the target while it catches up by default', () => {
    const { camera, targetMesh } = createRig();
    runFrames(300);
    const settled = camera.quaternion.clone();

    // Moving east, the lagging camera looks a little east of straight down the offset
    runFrames(30, () => (targetMesh.position.x += 0.1));
    expect(camera.quaternion.angleTo(settled)).toBeGreaterThan(0.01);
  });

  it("never turns with orientation 'FIXED'", () => {
    const { camera, targetMesh } = createRig({ orientation: 'FIXED' });
    runFrames(1);
    const first = camera.quaternion.clone();

    runFrames(60, (i) => {
      targetMesh.position.x += 0.1;
      targetMesh.position.z -= i % 2 ? 0.2 : 0;
    });
    expect(camera.quaternion.angleTo(first)).toBeLessThan(1e-6);
    // Looking along -offset
    const forward = camera.getWorldDirection(new THREE.Vector3());
    const expected = new THREE.Vector3(0, -10, -5).normalize();
    expect(forward.distanceTo(expected)).toBeLessThan(1e-6);
    // ...and still following
    expect(camera.position.x).toBeGreaterThan(4);
  });

  it('leads a moving target by the look-ahead distance, and returns at returnSpeed', () => {
    const followed = new THREE.Vector3();
    const { targetMesh } = createRig({
      orientation: 'FIXED',
      lookAhead: { distance: 1.5, returnSpeed: 1 },
      afterLookAtFn: ({ targetPos }) => followed.copy(targetPos),
    });
    const lead = () => followed.clone().sub(targetMesh.position);

    // North (-z) at 3 m/s for 3 s: the followed point leads by 1.5 m, North
    runFrames(180, () => (targetMesh.position.z -= 3 * DT));
    expect(lead().z).toBeCloseTo(-1.5, 2);
    expect(Math.abs(lead().x)).toBeLessThan(1e-9);

    // Standing still: 1.5 m back at 1 m/s takes 1.5 s (after the travel speed decays)
    runFrames(60);
    expect(lead().z).toBeLessThan(-0.4);
    expect(lead().z).toBeGreaterThan(-1.2);
    runFrames(60);
    expect(lead().length()).toBeLessThan(1e-9);
  });

  it('keeps the lead with returnSpeed 0, and the camera settles on it', () => {
    const { camera, targetMesh } = createRig({
      orientation: 'FIXED',
      lookAhead: { distance: 1.5, returnSpeed: 0 },
    });
    // East
    runFrames(180, () => (targetMesh.position.x += 3 * DT));
    runFrames(600);
    expect(camera.position.x - targetMesh.position.x).toBeCloseTo(1.5, 2);
  });

  it('takes a teleport for no travel', () => {
    const { camera, targetMesh } = createRig({
      orientation: 'FIXED',
      lookAhead: { distance: 1.5, returnSpeed: 0 },
    });
    runFrames(10);
    targetMesh.position.set(50, 0, 0);
    runFrames(600);
    expect(camera.position.x).toBeCloseTo(50, 3);
  });

  it('skips a frame whose dt is NaN', () => {
    const { camera } = createRig();
    runFrames(1);
    systemFn!(stubWorld, NaN);
    runFrames(1);
    expect(camera.position.toArray().every(Number.isFinite)).toBe(true);
  });

  it('LERP approaches the offset by 1 - e^(-dt / smoothingTime) per frame', () => {
    const { camera } = createRig({ smoothingType: 'LERP', smoothingTime: 0.5 });
    runFrames(1);
    // From the origin toward (0, 10, 5)
    const k = 1 - Math.exp(-DT / 0.5);
    expect(camera.position.y).toBeCloseTo(10 * k, 12);
    runFrames(600);
    expect(camera.position.distanceTo(new THREE.Vector3(0, 10, 5))).toBeLessThan(1e-6);
  });

  it("orbits with the mouse, clamping the polar angle, at the offset's length", () => {
    const mouse = { x: 0, y: 0 };
    const { camera, targetMesh } = createRig({
      smoothingType: 'LERP',
      smoothingTime: 0.01,
      targetHeight: 2,
      getMouseMoveInput: () => mouse,
    });
    // Far up, then far down: phi clamps at 0.1 and π/2 - 0.1
    for (const y of [1e5, -1e5]) {
      mouse.y = y;
      runFrames(1);
      mouse.y = 0;
      runFrames(300);
      const head = targetMesh.position.clone().add(new THREE.Vector3(0, 2, 0));
      const fromHead = camera.position.clone().sub(head);
      const phi = Math.acos(fromHead.y / fromHead.length());
      expect(phi).toBeCloseTo(y > 0 ? 0.1 : Math.PI / 2 - 0.1, 6);
      expect(fromHead.length()).toBeCloseTo(Math.hypot(10, 5), 6);
    }
  });

  it('replaces the rig of an id in use', () => {
    const first = createRig();
    const second = createRig({ offset: { x: 0, y: 3, z: 0 } });
    runFrames(300);
    expect(first.camera.position.toArray()).toEqual([0, 0, 0]);
    expect(second.camera.position.y).toBeCloseTo(3, 3);
  });

  it('ticks only in the world it was created in', () => {
    const { camera } = createRig();
    systemFn!({} as ECSWorld, DT);
    expect(camera.position.toArray()).toEqual([0, 0, 0]);
  });

  it("is deleted on its scene's exit, and not on another's", () => {
    const { camera } = createRig({ sceneId: 'level1' });
    exitScene('level2');
    runFrames(1);
    const moved = camera.position.clone();
    expect(moved.length()).toBeGreaterThan(0);
    exitScene('level1');
    runFrames(10);
    expect(camera.position.toArray()).toEqual(moved.toArray());
  });
});
