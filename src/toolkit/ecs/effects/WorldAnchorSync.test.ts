import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { ComponentType, ECSSystemStage, ECSWorld } from 'aekasha';
import type { Compass, WorldAnchor, WorldAnchorLayer, WorldAnchorView } from 'aekasha/ui';
import {
  WorldAnchorComponentType,
  getCompassBearing,
  registerWorldAnchorSync,
  unregisterWorldAnchorSync,
} from './WorldAnchorSync';

const worldIds: string[] = [];
afterEach(() => {
  for (const id of worldIds.splice(0)) ECSWorld.deleteWorld(id);
});

// Stand-ins for the kit's pieces: the sync calls only these
const createAnchor = () => ({ setPosition: vi.fn(), remove: vi.fn() });
const createLayer = () => {
  const views: { matrix: number[]; width: number; height: number; camera: number[] }[] = [];
  const update = vi.fn((view: WorldAnchorView) => {
    views.push({
      matrix: Array.from(view.viewProjection),
      width: view.width,
      height: view.height,
      camera: [view.cameraPosition.x, view.cameraPosition.y, view.cameraPosition.z],
    });
  });
  return { layer: { update } as unknown as WorldAnchorLayer, update, views };
};

const createCamera = (lookAt: [number, number, number]) => {
  const camera = new THREE.PerspectiveCamera(60, 2, 0.1, 100);
  camera.position.set(1, 2, 3);
  camera.lookAt(new THREE.Vector3(...lookAt));
  camera.updateMatrixWorld();
  return camera;
};

// A world with the sync's system, captured from its registration
const createWorld = (options: Partial<Parameters<typeof registerWorldAnchorSync>[1]> = {}) => {
  const id = `anchorSync-${worldIds.length}`;
  worldIds.push(id);
  const world = new ECSWorld({ id, maxEntities: 16 });
  const addSystem = vi.spyOn(world, 'addSystem');
  const { layer, update, views } = createLayer();
  const camera = createCamera([1, 2, -10]);
  registerWorldAnchorSync(world, {
    layer,
    camera: () => camera,
    size: () => ({ width: 800, height: 400 }),
    ...options,
  });
  const [stage, , systemFn] = addSystem.mock.calls[0];
  return { world, stage, camera, update, views, run: () => systemFn(world, 1 / 60) };
};

const addAnchored = (world: ECSWorld, position: [number, number, number], offsetY?: number) => {
  const entityId = world.createEntity();
  const object = new THREE.Object3D();
  object.position.set(...position);
  object.updateMatrixWorld();
  world.addComponent(entityId, ComponentType.OBJECT3D, { value: object, _lastVersion: 0 });
  const anchor = createAnchor();
  world.addComponent(entityId, WorldAnchorComponentType.WORLD_ANCHOR, {
    anchor: anchor as unknown as WorldAnchor,
    offsetY,
  });
  return { entityId, anchor, object };
};

describe('world anchor sync (p808 D7)', () => {
  it('runs at LATE_MAIN, moving each anchor to its object plus offsetY, then the layer', () => {
    const { world, stage, run, update, views, camera } = createWorld();
    expect(stage).toBe(ECSSystemStage.LATE_MAIN);
    const npc = addAnchored(world, [4, 0, -6], 2);
    const crate = addAnchored(world, [-1, 1, 0]);
    run();
    expect(npc.anchor.setPosition).toHaveBeenCalledWith(4, 2, -6);
    expect(crate.anchor.setPosition).toHaveBeenCalledWith(-1, 1, 0);
    expect(update).toHaveBeenCalledTimes(1);
    const expected = new THREE.Matrix4().multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse
    );
    expect(views[0].matrix).toEqual(expected.elements);
    expect([views[0].width, views[0].height]).toEqual([800, 400]);
    expect(views[0].camera).toEqual([1, 2, 3]);
  });

  it('passes the same view object every frame', () => {
    const { world, run, update } = createWorld();
    addAnchored(world, [0, 0, 0]);
    run();
    run();
    expect(update.mock.calls[0][0]).toBe(update.mock.calls[1][0]);
  });

  it('leaves an anchor without an object, and updates nothing without a camera', () => {
    const { world, run, update } = createWorld({ camera: () => undefined });
    const { anchor } = addAnchored(world, [0, 0, 0]);
    run();
    expect(anchor.setPosition).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    const other = createWorld();
    const lone = other.world.createEntity();
    const loneAnchor = createAnchor();
    other.world.addComponent(lone, WorldAnchorComponentType.WORLD_ANCHOR, {
      anchor: loneAnchor as unknown as WorldAnchor,
    });
    other.run();
    expect(loneAnchor.setPosition).not.toHaveBeenCalled();
    expect(other.update).toHaveBeenCalledTimes(1);
  });

  it('removes the anchor with its component or its entity', () => {
    const { world } = createWorld();
    const removed = addAnchored(world, [0, 0, 0]);
    const deleted = addAnchored(world, [0, 0, 0]);
    world.removeComponent(removed.entityId, WorldAnchorComponentType.WORLD_ANCHOR);
    expect(removed.anchor.remove).toHaveBeenCalledTimes(1);
    world.deleteEntity(deleted.entityId);
    expect(deleted.anchor.remove).toHaveBeenCalledTimes(1);
  });

  it('turns the compass to the camera heading: north -z, east +x, a top-down camera by its up', () => {
    const setHeading = vi.fn();
    const compass = { setHeading } as unknown as Compass;
    let camera = createCamera([1, 2, -10]);
    const { world, run } = createWorld({ compass, camera: () => camera });
    addAnchored(world, [0, 0, 0]);
    run();
    expect(setHeading.mock.calls[0][0]).toBeCloseTo(0);
    camera = createCamera([10, 2, 3]);
    run();
    expect(setHeading.mock.calls[1][0]).toBeCloseTo(Math.PI / 2);
    // Straight down with its up toward -x: west is the screen's top
    camera = new THREE.PerspectiveCamera();
    camera.position.set(0, 10, 0);
    camera.up.set(-1, 0, 0);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    run();
    expect(setHeading.mock.calls[2][0]).toBeCloseTo(-Math.PI / 2);
  });

  it('replaces its options on a second call, and stops when unregistered', () => {
    const { world, run, update } = createWorld();
    const next = createLayer();
    // The spy createWorld made, with its first call
    const addSystem = vi.spyOn(world, 'addSystem');
    addSystem.mockClear();
    registerWorldAnchorSync(world, {
      layer: next.layer,
      camera: () => createCamera([0, 0, -1]),
      size: () => ({ width: 1, height: 1 }),
    });
    expect(addSystem).not.toHaveBeenCalled();
    run();
    expect(update).not.toHaveBeenCalled();
    expect(next.update).toHaveBeenCalledTimes(1);
    const removeSystem = vi.spyOn(world, 'removeSystem');
    unregisterWorldAnchorSync(world);
    expect(removeSystem).toHaveBeenCalledWith('worldAnchorSync');
    run();
    expect(next.update).toHaveBeenCalledTimes(1);
  });

  it('gives a direction its bearing clockwise from north', () => {
    expect(getCompassBearing(0, -1)).toBeCloseTo(0);
    expect(getCompassBearing(1, 0)).toBeCloseTo(Math.PI / 2);
    expect(getCompassBearing(0, 1)).toBeCloseTo(Math.PI);
    expect(getCompassBearing(-1, 0)).toBeCloseTo(-Math.PI / 2);
  });
});
