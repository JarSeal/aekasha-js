import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { ECSWorld } from '../../kernel/ecs/ECS';
import { ComponentType } from '../../kernel/ecs/ECSCoreComponents';
import type { StreamingStats } from './StreamingCells';
import {
  type StreamingPrimeBudgets,
  createStreamingPrimer,
  resetStreamingPrimer,
} from './StreamingPriming';

// The renderer (its initTexture and backend) and the compile are stand-ins: a compile ends when
// the test resolves it
const fns = vi.hoisted(() => ({
  initTexture: vi.fn(),
  isWebGPUBackend: false,
  compiles: [] as { objects: readonly unknown[]; resolve: () => void }[],
}));
vi.mock(import('../../kernel/render/Renderer'), async (importOriginal) => ({
  ...(await importOriginal()),
  getRenderer: (() => ({
    initTexture: fns.initTexture,
    backend: { isWebGPUBackend: fns.isWebGPUBackend },
  })) as never,
}));
vi.mock(import('../../kernel/mesh/Mesh'), async (importOriginal) => ({
  ...(await importOriginal()),
  preWarmObjectsAsync: (objects: readonly THREE.Object3D[]) =>
    new Promise<void>((resolve) => fns.compiles.push({ objects, resolve })),
}));

let world: ECSWorld;
let seq = 0;

const createStats = (): StreamingStats => ({
  loadsStarted: 0,
  loadsFinished: 0,
  loadsCancelled: 0,
  unloadsFinished: 0,
  unitErrors: 0,
  lateResults: 0,
  assetReleases: 0,
  assetsReleased: 0,
  primesFinished: 0,
  primingStalls: 0,
  texturesUploaded: 0,
  oversizedUploads: 0,
  compiles: 0,
  structuresShown: 0,
  bodiesAdopted: 0,
});

/** A mesh entity of `material` */
const meshEntity = (material: THREE.Material) => {
  const id = world.createEntity();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), material);
  world.addComponent(id, ComponentType.OBJECT3D, { value: mesh, _lastVersion: 0 });
  return id;
};

const isHeld = (id: number) => world.hasComponent(id, ComponentType.TAG_DRAW_HELD);

/** Resolves the compiles started so far, and lets their handlers run */
const finishCompilesAsync = async () => {
  for (const compile of fns.compiles.splice(0)) compile.resolve();
  await Promise.resolve();
};

const setup = (budgets: Partial<StreamingPrimeBudgets> = {}) => {
  const primer = createStreamingPrimer({
    maxPrimeMsPerFrame: 1000,
    maxNewStructuresPerFrame: null,
    ...budgets,
  });
  const stats = createStats();
  /** One frame of a job: true once it's shown */
  const frame = (job: object) => {
    primer.beginFrame();
    return primer.step(job);
  };
  return { primer, stats, frame };
};

beforeEach(() => {
  world = new ECSWorld({
    id: `priming-test-${seq++}`,
    maxEntities: 1000,
    applyGlobalPlugins: false,
  });
  fns.isWebGPUBackend = false;
  fns.initTexture.mockClear();
  fns.compiles.length = 0;
  resetStreamingPrimer();
});

afterEach(() => {
  ECSWorld.deleteWorld(world.id);
});

describe('the streaming primer', () => {
  test('holds the entities with an Object3D, and compiles them once in one call', async () => {
    const { primer, stats, frame } = setup();
    const a = meshEntity(new THREE.MeshBasicNodeMaterial());
    const b = meshEntity(new THREE.MeshBasicNodeMaterial());
    const plain = world.createEntity();
    primer.hold(world, [a, b, plain]);
    expect([a, b, plain].map(isHeld)).toEqual([true, true, false]);

    const job = primer.start(world, [a, b, plain], stats);
    expect(frame(job)).toBe(false);
    expect(fns.compiles).toHaveLength(1);
    expect(fns.compiles[0].objects).toHaveLength(2);
    expect(frame(job)).toBe(false);
    expect(stats.compiles).toBe(1);
  });

  test('shows a new material a frame on WebGL2, its meshes together, and known ones at once', async () => {
    const { primer, stats, frame } = setup();
    const shared = new THREE.MeshBasicNodeMaterial();
    const other = new THREE.MeshBasicNodeMaterial();
    const ids = [meshEntity(shared), meshEntity(shared), meshEntity(other)];
    primer.hold(world, ids);
    const job = primer.start(world, ids, stats);
    frame(job);
    await finishCompilesAsync();

    expect(frame(job)).toBe(false);
    expect(ids.map(isHeld)).toEqual([false, false, true]);
    expect(frame(job)).toBe(true);
    expect(ids.map(isHeld)).toEqual([false, false, false]);
    expect(stats.structuresShown).toBe(2);

    // Shown before: the next cell's meshes of them need no compile and show in its first frame
    const again = [meshEntity(shared), meshEntity(other)];
    primer.hold(world, again);
    const next = primer.start(world, again, stats);
    expect(frame(next)).toBe(true);
    expect(again.map(isHeld)).toEqual([false, false]);
    expect(fns.compiles).toHaveLength(0);
  });

  test('shows up to 8 new materials a frame on WebGPU, or the budget set', async () => {
    fns.isWebGPUBackend = true;
    const { primer, stats, frame } = setup();
    const ids = Array.from({ length: 10 }, () => meshEntity(new THREE.MeshBasicNodeMaterial()));
    primer.hold(world, ids);
    const job = primer.start(world, ids, stats);
    frame(job);
    await finishCompilesAsync();
    expect(frame(job)).toBe(false);
    expect(ids.filter(isHeld)).toHaveLength(2);
    expect(frame(job)).toBe(true);

    const set = setup({ maxNewStructuresPerFrame: 3 });
    const more = Array.from({ length: 4 }, () => meshEntity(new THREE.MeshBasicNodeMaterial()));
    set.primer.hold(world, more);
    const capped = set.primer.start(world, more, set.stats);
    set.frame(capped);
    await finishCompilesAsync();
    expect(set.frame(capped)).toBe(false);
    expect(more.filter(isHeld)).toHaveLength(1);
  });

  test('a material another cell showed meanwhile costs this one no frame', async () => {
    const { primer, stats, frame } = setup();
    const material = new THREE.MeshBasicNodeMaterial();
    const first = [meshEntity(material)];
    const second = [meshEntity(material), meshEntity(new THREE.MeshBasicNodeMaterial())];
    primer.hold(world, [...first, ...second]);
    const jobA = primer.start(world, first, stats);
    const jobB = primer.start(world, second, stats);
    primer.beginFrame();
    primer.step(jobA);
    primer.step(jobB);
    await finishCompilesAsync();
    primer.beginFrame();
    expect(primer.step(jobA)).toBe(true);
    expect(primer.step(jobB)).toBe(false);
    // B's group of the material A showed goes without a slot; its own new one waits a frame
    expect(second.map(isHeld)).toEqual([false, true]);
    expect(frame(jobB)).toBe(true);
    expect(stats.structuresShown).toBe(2);
  });

  test('uploads textures under the frame budget, an oversized one in a frame of its own', () => {
    const { primer, stats, frame } = setup({ maxPrimeMsPerFrame: 0 });
    const texture = (size: number) => {
      const t = new THREE.Texture();
      t.image = { width: size, height: size };
      return t;
    };
    const small = [texture(256), texture(512)];
    const big = texture(2048);
    const material = new THREE.MeshBasicNodeMaterial();
    material.map = small[0];
    const material2 = new THREE.MeshStandardNodeMaterial();
    material2.map = big;
    material2.normalMap = small[1];
    const ids = [meshEntity(material), meshEntity(material2)];
    primer.hold(world, ids);
    const job = primer.start(world, ids, stats);

    // A 0 ms budget: one upload a frame; the oversized one alone
    frame(job);
    frame(job);
    frame(job);
    expect(fns.initTexture).toHaveBeenCalledTimes(3);
    expect(stats.texturesUploaded).toBe(3);
    expect(stats.oversizedUploads).toBe(1);
    expect(fns.compiles).toHaveLength(1);
  });

  test('finish shows everything at once, primed or not', () => {
    const { primer, stats } = setup();
    const ids = [
      meshEntity(new THREE.MeshBasicNodeMaterial()),
      meshEntity(new THREE.MeshBasicNodeMaterial()),
    ];
    primer.hold(world, ids);
    const job = primer.start(world, ids, stats);
    primer.finish(job);
    expect(ids.map(isHeld)).toEqual([false, false]);
  });

  test('release lets go of held entities, and skips deleted ones', () => {
    const { primer } = setup();
    const ids = [
      meshEntity(new THREE.MeshBasicNodeMaterial()),
      meshEntity(new THREE.MeshBasicNodeMaterial()),
    ];
    primer.hold(world, ids);
    world.deleteEntity(ids[1]);
    primer.release(world, ids);
    expect(isHeld(ids[0])).toBe(false);
  });
});
