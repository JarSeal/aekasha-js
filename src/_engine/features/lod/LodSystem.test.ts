import { afterEach, describe, expect, test, vi } from 'vitest';
import * as THREE from 'three/webgpu';

// The main loop's frame and the main camera, set by each test
const loop = vi.hoisted(() => ({ frame: 1, camera: undefined as unknown }));
vi.mock(import('../../kernel/loop/MainLoop'), async (importOriginal) => ({
  ...(await importOriginal()),
  getMainLoopFrame: () => loop.frame,
}));
vi.mock(import('../../kernel/camera/Camera'), async (importOriginal) => ({
  ...(await importOriginal()),
  getMainCamera: () => loop.camera as THREE.Camera | undefined,
}));

import { ECSWorld } from '../../kernel/ecs/ECS';
import { ComponentType } from '../../kernel/ecs/ECSCoreComponents';
import { getLodFrameInputs } from '../../kernel/ecs/LodTargets';
import { lodSelectionSystem } from './LodSystem';
import { setLodBias, setLodDebugOptions, setLodFadeSeconds } from './LodSettings';

const DT = 1 / 60;

const world = new ECSWorld();
const secondWorld = new ECSWorld({ id: 'lodFrameInputsSecond' });

/** A camera with k = 1 (fov 90°) at `x`. */
const createCamera = (x: number) => {
  const camera = new THREE.PerspectiveCamera(90);
  camera.position.set(x, 2, 3);
  return camera;
};

afterEach(() => {
  setLodDebugOptions({ freeze: false, forceLevel: -1, fadeTimeScale: 1 });
  setLodBias(1);
  setLodFadeSeconds(0.25);
});

// p354 D3: the frame's inputs for LOD content without entities (instance sets)
describe('lodSelectionSystem: the frame inputs', () => {
  test('are written with no LOD entity in the world', () => {
    expect(world.getStorage(ComponentType.LOD).size).toBe(0);
    loop.frame = 10;
    loop.camera = createCamera(1);
    lodSelectionSystem(world, DT);

    const inputs = getLodFrameInputs();
    expect(inputs.frame).toBe(10);
    expect(inputs.hasCamera).toBe(true);
    expect(inputs.cameraPosition.toArray()).toEqual([1, 2, 3]);
    expect(inputs.k).toBeCloseTo(1, 12);
    expect(inputs.isOrtho).toBe(false);
    expect(inputs.bias).toBe(1);
    expect(inputs.fadeSeconds).toBe(0.25);
    expect(inputs.fadeStep).toBe(DT);
    expect(inputs.isFrozen).toBe(false);
    expect(inputs.forceLevel).toBe(-1);
  });

  test('are written once a frame, by its first world', () => {
    loop.frame = 20;
    loop.camera = createCamera(1);
    lodSelectionSystem(world, DT);
    // Moved within the frame: the frame's inputs hold
    loop.camera = createCamera(5);
    lodSelectionSystem(secondWorld, DT);
    expect(getLodFrameInputs().cameraPosition.x).toBe(1);

    loop.frame = 21;
    lodSelectionSystem(secondWorld, DT);
    expect(getLodFrameInputs().frame).toBe(21);
    expect(getLodFrameInputs().cameraPosition.x).toBe(5);
  });

  test('carry the debug options, the bias and the global fade seconds', () => {
    setLodDebugOptions({ freeze: true, forceLevel: 1, fadeTimeScale: 0.5 });
    setLodBias(2);
    setLodFadeSeconds(1);
    loop.frame = 30;
    loop.camera = createCamera(1);
    lodSelectionSystem(world, DT);

    const inputs = getLodFrameInputs();
    expect(inputs.isFrozen).toBe(true);
    expect(inputs.forceLevel).toBe(1);
    expect(inputs.fadeStep).toBeCloseTo(DT * 0.5, 12);
    expect(inputs.bias).toBe(2);
    expect(inputs.k).toBeCloseTo(2, 12);
    expect(inputs.fadeSeconds).toBe(1);
  });

  test('say when there is no camera to select against', () => {
    loop.frame = 40;
    loop.camera = undefined;
    lodSelectionSystem(world, DT);
    expect(getLodFrameInputs().frame).toBe(40);
    expect(getLodFrameInputs().hasCamera).toBe(false);
  });
});
