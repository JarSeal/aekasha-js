// World streaming's priming (docs/plans/_DONE_p353_macro-streaming-grid.md §5, Phase 2): a cell streamed
// in during play is held from drawing (`TAG_DRAW_HELD`) while its units load, then primed and
// shown, so a new shader never compiles on a draw (100-480 ms, 1-2.4 s for four at once) and an
// upload never lands in a visible frame unannounced:
//
// 1. Textures: the held meshes' materials' textures not uploaded by a priming before, through
//    `renderer.initTexture`, one after another while the frame is under `maxPrimeMsPerFrame`
//    (shared by every cell). An uncompressed one over 1024² (35-141 ms on WebGL2, one call) gets a
//    frame of its own and is counted.
// 2. Compile: when a held mesh has a material no priming showed before, one `preWarmObjectsAsync`
//    of the held objects (the real ones: three releases a pipeline with its last render object),
//    through the render pipeline's compiler. three r187 slices it itself (8 ms), so no ms budget.
// 3. Show: the meshes of materials shown before at once, then the others a material at a time,
//    `maxNewStructuresPerFrame` a frame across the cells: WebGL2 still pays ~10 ms of GPU-process
//    work per new structure on its first draw, primed or not (Phase 2 section 3), WebGPU nothing.
//    Every held object counts too, `maxShownObjectsPerFrame` a frame across the cells (WebGL2's
//    first draw of an object costs its GPU process time even for a known shader: ~10 layers shown
//    at once took 33-37 ms frames, Phase 5 section 5), so a layer may be let go over frames. A
//    layer streamed in during play is drawn invisible until its fade in starts with its last
//    object, so a partly let go layer never shows in parts. An object let go of draws unculled
//    for its first frame: one off screen would otherwise pay its first draw when it comes into
//    view (a camera turning to a column of cells never drawn: 22 first draws, a 46 ms frame).
//
// "New" is by material object, not by shader structure (three has no public test for one): a new
// material of a known structure is compiled again (6-50 ms, no hitch) and shown at the slow rate,
// a cost in time only. The installed primer is `streamingPrimer`; StreamingCells.ts drives it.
import type * as THREE from 'three/webgpu';
import { getMaterialMapTexture } from '../../kernel/assets/Material';
import type { ECSWorld } from '../../kernel/ecs/ECS';
import { ComponentType } from '../../kernel/ecs/ECSCoreComponents';
import { preWarmObjectsAsync } from '../../kernel/mesh/Mesh';
import { getRenderer } from '../../kernel/render/Renderer';
import { textureMapKeys } from '../../utils/Constants';
import type { StreamingPrimer, StreamingStats } from './StreamingCells';

/** Uncompressed textures over this many pixels get a frame of their own (Phase 0 finding 5) */
const OVERSIZED_PIXELS = 1024 * 1024;
/** The default new structures shown a frame: WebGL2's, and WebGPU's (Phase 2 section 3) */
const NEW_STRUCTURES_PER_FRAME_WEBGL = 1;
const NEW_STRUCTURES_PER_FRAME_WEBGPU = 8;
/** The default objects first shown a frame on WebGL2 (Phase 5 section 5's flights); WebGPU's are
 * not paced */
const SHOWN_OBJECTS_PER_FRAME_WEBGL = 16;

/**
 * The priming budgets (`AppConfig.streaming`).
 * @internal
 */
export type StreamingPrimeBudgets = {
  /** The milliseconds per frame texture uploads may take, across the cells. */
  maxPrimeMsPerFrame: number;
  /** New materials first shown a frame, across the cells; null: by the backend (WebGL2 1,
   * WebGPU 8). */
  maxNewStructuresPerFrame: number | null;
  /** Held objects let go of a frame, across the cells; null: by the backend (WebGL2 16, WebGPU
   * not paced). */
  maxShownObjectsPerFrame: number | null;
};

type Stage = 'TEXTURES' | 'COMPILING' | 'SHOWING';

type PrimeJob = {
  world: ECSWorld;
  stats: StreamingStats;
  stage: Stage;
  /** The held entities with an Object3D */
  entityIds: number[];
  objects: THREE.Object3D[];
  textures: THREE.Texture[];
  nextTexture: number;
  isCompiled: boolean;
  /** Held entities by the first new material they bring, shown a group at a time */
  groups: PrimeGroup[];
  nextGroup: number;
};

type PrimeGroup = {
  materials: THREE.Material[];
  entityIds: number[];
  /** The next of `entityIds` to let go of: a group is shown over frames when its objects are
   * over the frame's */
  next: number;
};

/** Materials a priming has shown: their structures have drawn once */
let shownMaterials = new WeakSet<THREE.Material>();
/** Textures a priming has uploaded */
let uploadedTextures = new WeakSet<THREE.Texture>();

const frame = {
  start: 0,
  texturesUploaded: 0,
  hasOversized: false,
  structuresLeft: 0,
  objectsLeft: 0,
};

const now = () => performance.now();

const isWebGPUBackend = () =>
  Boolean((getRenderer()?.backend as { isWebGPUBackend?: boolean } | undefined)?.isWebGPUBackend);

const getStructuresPerFrame = (budgets: StreamingPrimeBudgets) => {
  if (budgets.maxNewStructuresPerFrame !== null) {
    return Math.max(1, Math.floor(budgets.maxNewStructuresPerFrame));
  }
  return isWebGPUBackend() ? NEW_STRUCTURES_PER_FRAME_WEBGPU : NEW_STRUCTURES_PER_FRAME_WEBGL;
};

const getObjectsPerFrame = (budgets: StreamingPrimeBudgets) => {
  if (budgets.maxShownObjectsPerFrame !== null) {
    return Math.max(1, Math.floor(budgets.maxShownObjectsPerFrame));
  }
  return isWebGPUBackend() ? Infinity : SHOWN_OBJECTS_PER_FRAME_WEBGL;
};

const forEachMaterial = (object: THREE.Object3D, fn: (material: THREE.Material) => void) => {
  object.traverse((child) => {
    const material = (child as THREE.Mesh).material as
      | THREE.Material
      | THREE.Material[]
      | undefined;
    if (!material) return;
    if (Array.isArray(material)) material.forEach(fn);
    else fn(material);
  });
};

/** A material's textures: its map slots and its TSL texture node inputs (createMaterial keeps
 * those in userData.uniforms), where the asset release looks too. */
const forEachMaterialTexture = (material: THREE.Material, fn: (texture: THREE.Texture) => void) => {
  for (let i = 0; i < textureMapKeys.length; i++) {
    const texture = getMaterialMapTexture(material, textureMapKeys[i]);
    if (texture?.isTexture) fn(texture);
  }
  const uniforms = material.userData.uniforms as Record<string, unknown> | undefined;
  for (const key in uniforms) {
    const node = uniforms[key] as { isTextureNode?: boolean; value?: THREE.Texture } | undefined;
    if (node?.isTextureNode && node.value?.isTexture) fn(node.value);
  }
};

const isUploadable = (texture: THREE.Texture) =>
  !(texture as THREE.Texture & { isRenderTargetTexture?: boolean }).isRenderTargetTexture &&
  Boolean(texture.image);

const isOversized = (texture: THREE.Texture) => {
  if ((texture as THREE.CompressedTexture).isCompressedTexture) return false;
  const image = texture.image as { width?: number; height?: number } | null;
  return (image?.width ?? 0) * (image?.height ?? 0) > OVERSIZED_PIXELS;
};

/** The objects let go of this frame that were unculled for it, culled again at the next frame */
let unculled: THREE.Object3D[] = [];

const uncull = (object: THREE.Object3D) => {
  if (!object.frustumCulled) return;
  object.frustumCulled = false;
  unculled.push(object);
};

const recullLetGo = () => {
  for (let i = 0; i < unculled.length; i++) unculled[i].frustumCulled = true;
  unculled.length = 0;
};

/** Lets go of the held entities `from` up to `to`; `drawsAll`: each draws its first frame unculled
 * (the priming's own let go, not a content's unload's). */
const release = (
  world: ECSWorld,
  entityIds: readonly number[],
  from = 0,
  to = entityIds.length,
  drawsAll = false
) => {
  for (let i = from; i < to; i++) {
    const id = entityIds[i];
    if (!world.isAlive(id) || !world.hasComponent(id, ComponentType.TAG_DRAW_HELD)) continue;
    world.removeComponent(id, ComponentType.TAG_DRAW_HELD);
    if (drawsAll) world.getComponent(id, ComponentType.OBJECT3D)?.value.traverse(uncull);
  }
};

/** Sorts the held entities: those of shown materials go at once, the rest into a group per first
 * new material. Collects the textures to upload on the way. */
const createJob = (world: ECSWorld, entityIds: readonly number[], stats: StreamingStats) => {
  const job: PrimeJob = {
    world,
    stats,
    stage: 'TEXTURES',
    entityIds: [],
    objects: [],
    textures: [],
    nextTexture: 0,
    isCompiled: false,
    groups: [],
    nextGroup: 0,
  };
  const textures = new Set<THREE.Texture>();
  const groupByMaterial = new Map<THREE.Material, PrimeGroup>();
  const shownNow: number[] = [];
  for (let i = 0; i < entityIds.length; i++) {
    const id = entityIds[i];
    if (!world.isAlive(id) || !world.hasComponent(id, ComponentType.TAG_DRAW_HELD)) continue;
    const object = world.getComponent(id, ComponentType.OBJECT3D)?.value;
    if (!object) continue;
    job.entityIds.push(id);
    job.objects.push(object);
    let firstNew: THREE.Material | null = null;
    const newMaterials: THREE.Material[] = [];
    forEachMaterial(object, (material) => {
      forEachMaterialTexture(material, (texture) => {
        if (!uploadedTextures.has(texture) && isUploadable(texture)) textures.add(texture);
      });
      if (shownMaterials.has(material)) return;
      firstNew ??= material;
      newMaterials.push(material);
    });
    if (!firstNew) {
      shownNow.push(id);
      continue;
    }
    let group = groupByMaterial.get(firstNew);
    if (!group) {
      group = { materials: [], entityIds: [], next: 0 };
      groupByMaterial.set(firstNew, group);
      job.groups.push(group);
    }
    group.entityIds.push(id);
    for (const material of newMaterials) {
      if (!group.materials.includes(material)) group.materials.push(material);
    }
  }
  job.textures = [...textures];
  // Nothing new to compile or pace: shown once its textures are up
  if (!job.groups.length) job.isCompiled = true;
  job.groups.unshift({ materials: [], entityIds: shownNow, next: 0 });
  return job;
};

/** Uploads the job's textures while the frame's budget lasts. Returns whether they're all up. */
const uploadTextures = (job: PrimeJob, budgets: StreamingPrimeBudgets) => {
  const renderer = getRenderer();
  while (job.nextTexture < job.textures.length) {
    if (frame.hasOversized) return false;
    const texture = job.textures[job.nextTexture];
    const oversized = isOversized(texture);
    if (frame.texturesUploaded > 0) {
      // An oversized one waits for a frame of its own; the others for the budget
      if (oversized || now() - frame.start >= budgets.maxPrimeMsPerFrame) return false;
    }
    job.nextTexture++;
    if (uploadedTextures.has(texture)) continue;
    renderer?.initTexture(texture);
    uploadedTextures.add(texture);
    frame.texturesUploaded++;
    job.stats.texturesUploaded++;
    if (oversized) {
      frame.hasOversized = true;
      job.stats.oversizedUploads++;
    }
  }
  return true;
};

const startCompile = (job: PrimeJob) => {
  job.stage = 'COMPILING';
  if (job.isCompiled) return;
  job.stats.compiles++;
  void preWarmObjectsAsync(job.objects, 'a streaming cell').then(() => {
    job.isCompiled = true;
  });
};

/** Shows the job's groups while the frame's new structures and objects last: a group with a
 * material not shown yet costs one structure when it starts, the others none (the first, of shown
 * materials only; one another cell showed meanwhile), and each object one. Returns whether it's
 * all shown. */
const showGroups = (job: PrimeJob) => {
  while (job.nextGroup < job.groups.length) {
    const group = job.groups[job.nextGroup];
    const count = group.entityIds.length;
    if (group.next === 0) {
      if (count && frame.objectsLeft <= 0) return false;
      // Counted when shown: another cell priming at the same time may have shown them meanwhile
      let unshown = 0;
      for (const material of group.materials) if (!shownMaterials.has(material)) unshown++;
      if (unshown && frame.structuresLeft <= 0) return false;
      if (unshown) frame.structuresLeft--;
      job.stats.structuresShown += unshown;
      for (const material of group.materials) shownMaterials.add(material);
    }
    const end = Math.min(count, group.next + frame.objectsLeft);
    release(job.world, group.entityIds, group.next, end, true);
    frame.objectsLeft -= end - group.next;
    group.next = end;
    if (end < count) return false;
    job.nextGroup++;
  }
  return true;
};

/**
 * The installed primer, its budgets read on every frame (the Streaming tab edits them).
 * @internal
 */
export const createStreamingPrimer = (budgets: StreamingPrimeBudgets): StreamingPrimer => ({
  beginFrame: () => {
    recullLetGo();
    frame.start = now();
    frame.texturesUploaded = 0;
    frame.hasOversized = false;
    frame.structuresLeft = getStructuresPerFrame(budgets);
    frame.objectsLeft = getObjectsPerFrame(budgets);
  },
  hold: (world, entityIds) => {
    for (let i = 0; i < entityIds.length; i++) {
      const id = entityIds[i];
      if (world.isAlive(id) && world.hasComponent(id, ComponentType.OBJECT3D)) {
        world.addComponent(id, ComponentType.TAG_DRAW_HELD, true);
      }
    }
  },
  release: (world, entityIds) => release(world, entityIds),
  start: (world, entityIds, stats) => createJob(world, entityIds, stats),
  step: (handle) => {
    const job = handle as PrimeJob;
    if (job.stage === 'TEXTURES') {
      if (!uploadTextures(job, budgets)) return false;
      startCompile(job);
    }
    if (job.stage === 'COMPILING') {
      if (!job.isCompiled) return false;
      job.stage = 'SHOWING';
    }
    return showGroups(job);
  },
  finish: (handle) => {
    const job = handle as PrimeJob;
    for (; job.nextGroup < job.groups.length; job.nextGroup++) {
      const group = job.groups[job.nextGroup];
      release(job.world, group.entityIds, group.next, group.entityIds.length, true);
      group.next = group.entityIds.length;
      for (const material of group.materials) shownMaterials.add(material);
    }
  },
  // Nothing to undo: the held entities go with the cell, and a compile running ends harmlessly
  cancel: () => {},
});

/**
 * Forgets that a material was shown (p353 Phase 5 D6): its build changed (the fades dithered it),
 * so the next priming that holds it compiles it again before showing it.
 * @internal
 */
export const forgetPrimedMaterial = (material: THREE.Material) => {
  shownMaterials.delete(material);
};

/**
 * Forgets which materials and textures were primed (the tests', between cases).
 * @internal
 */
export const resetStreamingPrimer = () => {
  shownMaterials = new WeakSet();
  uploadedTextures = new WeakSet();
  unculled = [];
};
