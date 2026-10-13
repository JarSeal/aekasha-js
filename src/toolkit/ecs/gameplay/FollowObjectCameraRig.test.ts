import { afterEach, describe, expect, it } from 'vitest';
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

// The shared system, captured from a stub world (the rig needs no renderer)
let systemFn: ((world: ECSWorld, dt: number) => void) | null = null;
const stubWorld = {
  addSystem: (_stage: unknown, _name: string, fn: (world: ECSWorld, dt: number) => void) => {
    systemFn = fn;
  },
} as unknown as ECSWorld;
registerFollowObjectCameraRigSystem(stubWorld);

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
});
