import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import * as THREE from 'three/webgpu';

// The main loop's frame and the main camera, set by each step
const loop = vi.hoisted(() => ({ frame: 1, camera: undefined as unknown }));
vi.mock(import('../../kernel/loop/MainLoop'), async (importOriginal) => ({
  ...(await importOriginal()),
  getMainLoopFrame: () => loop.frame,
}));
vi.mock(import('../../kernel/camera/Camera'), async (importOriginal) => ({
  ...(await importOriginal()),
  getMainCamera: () => loop.camera as THREE.Camera | undefined,
}));

import { getConfig } from '../../kernel/config/Config';
import { ECSWorld } from '../../kernel/ecs/ECS';
import { ComponentType } from '../../kernel/ecs/ECSCoreComponents';
import { installCoreSystems } from '../../kernel/ecs/ECSCoreSystems';
import { type LodMeshDrawDelegate, setLodMeshDrawDelegate } from '../../kernel/ecs/LodTargets';
import { createFeatureHost } from '../../kernel/init/Features';
import { createGeometry } from '../../kernel/assets/Geometry';
import { createMaterial } from '../../kernel/assets/Material';
import { createMeshEntity, installMeshes, removeMeshLod } from '../../kernel/mesh/Mesh';
import { createRootScene } from '../../kernel/scene/Scene';
import { installLodSystem, lodApplySystem, lodFadeSystem, lodSelectionSystem } from './LodSystem';
import type { LodDef } from './LodTypes';

// p375 Phase 2 S2 (docs/plans/p375_batched-mesh-batches.md): the kernel's mesh draw delegate. A
// plain mesh's levels still go on the mesh, and for an entity the delegate draws, its apply, cull
// and fades go to the delegate instead of the plain path's fade copies; the plain path itself for
// comparison.

const DT = 1 / 60;
/** 6 frames at DT */
const FADE_SECONDS = 0.1;

let world: ECSWorld;
beforeAll(() => {
  world = new ECSWorld();
  createRootScene();
  const { ctx } = createFeatureHost(getConfig());
  installCoreSystems(ctx);
  installMeshes(ctx);
  installLodSystem(ctx);
  // Persistent: a deleted mesh's last ref would release them
  const box = { width: 1, height: 1, depth: 1 };
  createGeometry({ id: 'dlgBox', type: 'BOX', params: box, isPersistent: true });
  createGeometry({ id: 'dlgBoxLow', type: 'BOX', params: box, isPersistent: true });
  createMaterial({ id: 'dlgMat', type: 'BASIC', params: {}, isPersistent: true });
});

/** The delegate's calls, and the entities it draws */
const calls: unknown[][] = [];
const drawn = new Set<number>();
const delegate: LodMeshDrawDelegate = {
  isDrawing: (entityId) => drawn.has(entityId),
  applyLevel: (entityId, _world, level, fade) =>
    calls.push(['apply', entityId, level.geometry.userData.id, fade]),
  setCulled: (entityId, _world, isCulled, fade) => calls.push(['culled', entityId, isCulled, fade]),
  setFade: (entityId, _world, progress) => calls.push(['fade', entityId, progress]),
};

afterEach(() => {
  setLodMeshDrawDelegate(null);
  world.clearWorld();
  calls.length = 0;
  drawn.clear();
});

/** k = 1 (fov 90°): the box (radius ~0.87) is level 0 at 1 m, level 1 at 4 m, culled at 100 m */
const LOD: LodDef = {
  levels: [{ screenSize: 0.5 }, { screenSize: 0.1, geo: 'dlgBoxLow' }],
  cullScreenSize: 0.02,
  fadeSeconds: FADE_SECONDS,
};

/** Runs `frames` frames of the selection, the apply and the fades with the camera `distance` m
 * from the origin. */
const stepAt = (distance: number, frames = 1) => {
  const camera = new THREE.PerspectiveCamera(90);
  camera.position.set(0, 0, distance);
  loop.camera = camera;
  for (let i = 0; i < frames; i++) {
    loop.frame++;
    lodSelectionSystem(world, DT);
    lodApplySystem(world);
    lodFadeSystem(world, DT);
  }
};

/** A box at the origin with LOD, level 0 applied (the first apply never fades). */
const createLodBox = (def: LodDef = LOD) => {
  const entityId = createMeshEntity({ geo: 'dlgBox', mat: 'dlgMat', lod: def });
  stepAt(1);
  return entityId;
};

const getMesh = (entityId: number) =>
  world.getComponent(entityId, ComponentType.OBJECT3D)!.value as THREE.Mesh;

const isFading = (entityId: number) =>
  world.hasComponent(entityId, ComponentType.TAG_LOD_TRANSITIONING);

describe('without the delegate drawing the entity (the plain path)', () => {
  test('a level change fades through a child copy of the mesh, disposed at its end', () => {
    setLodMeshDrawDelegate(delegate);
    const entityId = createLodBox();
    stepAt(4);
    const mesh = getMesh(entityId);
    expect(mesh.geometry.userData.id).toBe('dlgBoxLow');
    expect(mesh.children.map((child) => child.userData.isLodFadeCopy)).toEqual([true]);
    stepAt(4, 6);
    expect(isFading(entityId)).toBe(false);
    expect(mesh.children).toEqual([]);
    expect(calls).toEqual([]);
  });
});

describe('with the delegate drawing the entity', () => {
  test('a level change goes on the mesh and to the delegate, which draws its fade', () => {
    setLodMeshDrawDelegate(delegate);
    const entityId = createLodBox();
    drawn.add(entityId);
    stepAt(4);
    const mesh = getMesh(entityId);
    expect(mesh.geometry.userData.id).toBe('dlgBoxLow');
    expect(mesh.children).toEqual([]);
    expect(calls[0]).toEqual(['apply', entityId, 'dlgBoxLow', true]);
    expect(calls[1][0]).toBe('fade');
    expect(calls[1][2]).toBeCloseTo(1 / 6, 9);

    stepAt(4, 5);
    expect(isFading(entityId)).toBe(false);
    const progress = calls.slice(1).map((call) => call[2] as number);
    expect(progress.length).toBe(6);
    expect(progress.at(-1)).toBe(1);
    expect(progress.every((p, i) => i === 0 || p > progress[i - 1])).toBe(true);
  });

  test('culling fades out and back in through the delegate', () => {
    setLodMeshDrawDelegate(delegate);
    const entityId = createLodBox();
    stepAt(4, 7);
    drawn.add(entityId);
    stepAt(100);
    expect(world.hasComponent(entityId, ComponentType.TAG_LOD_CULLED)).toBe(true);
    expect(calls[0]).toEqual(['culled', entityId, true, true]);
    stepAt(100, 6);
    expect(calls.at(-1)).toEqual(['fade', entityId, 1]);

    calls.length = 0;
    stepAt(4);
    expect(world.hasComponent(entityId, ComponentType.TAG_LOD_CULLED)).toBe(false);
    // Still level 1: it shows in it, fading in
    expect(calls[0]).toEqual(['culled', entityId, false, true]);
    expect(calls.filter((call) => call[0] === 'apply')).toEqual([]);
    expect(getMesh(entityId).visible).toBe(true);
  });

  test('without fades it switches and culls at once', () => {
    setLodMeshDrawDelegate(delegate);
    const entityId = createLodBox({ ...LOD, fadeSeconds: 0 });
    drawn.add(entityId);
    stepAt(4);
    stepAt(100);
    expect(calls).toEqual([
      ['apply', entityId, 'dlgBoxLow', false],
      ['culled', entityId, true, false],
    ]);
    expect(isFading(entityId)).toBe(false);
  });

  test('removing the LOD shows level 0 through it; deleting the entity ends its fade', () => {
    setLodMeshDrawDelegate(delegate);
    const entityId = createLodBox();
    stepAt(4, 7);
    drawn.add(entityId);
    removeMeshLod(entityId, world);
    expect(calls).toEqual([['apply', entityId, 'dlgBox', false]]);
    expect(getMesh(entityId).geometry.userData.id).toBe('dlgBox');

    calls.length = 0;
    const other = createLodBox();
    drawn.add(other);
    world.deleteEntity(other);
    expect(calls).toEqual([['fade', other, 1]]);
  });

  test('an entity it stops drawing mid-fade fades on without it, with no copy', () => {
    setLodMeshDrawDelegate(delegate);
    const entityId = createLodBox();
    drawn.add(entityId);
    stepAt(4);
    drawn.delete(entityId);
    calls.length = 0;
    stepAt(4, 5);
    expect(isFading(entityId)).toBe(false);
    expect(calls).toEqual([]);
    expect(getMesh(entityId).children).toEqual([]);
  });

  test("an entity it starts drawing mid-fade has the plain fade's copy disposed at the end", () => {
    setLodMeshDrawDelegate(delegate);
    const entityId = createLodBox();
    stepAt(4);
    const mesh = getMesh(entityId);
    const [copy] = mesh.children;
    const disposed = vi.fn();
    copy.addEventListener('dispose', disposed);
    drawn.add(entityId);
    stepAt(4, 5);
    expect(isFading(entityId)).toBe(false);
    expect(mesh.children).toEqual([]);
    expect(disposed).toHaveBeenCalledOnce();
    // The delegate is told the fade's steps: it has none of its own to draw
    expect(calls.map((call) => call[0])).toEqual(['fade', 'fade', 'fade', 'fade', 'fade']);
  });
});
