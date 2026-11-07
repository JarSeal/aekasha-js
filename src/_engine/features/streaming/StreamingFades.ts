// World streaming's fades (docs/plans/_DONE_p353_macro-streaming-grid.md §3.3, Phase 5 D4-D6): a layer
// streamed in during play dithers in once it's shown, and a shown layer dithers out before it's
// taken down, through the kernel's visibility fade (kernel/render/LodFade.ts), the second
// per-object fade every dither-enabled material reads, ANDed with the LOD's, so a LOD cross-fade
// during it stays split right. The materials are dithered when a unit's entities arrive, before
// any draw (`prepare`): a material that changes is new to the priming (`onMaterialDithered`), so
// its dithered build is compiled before it's drawn. An entity without its own Object3D (an
// instanced LOD pool's instance) isn't faded. The machine (StreamingLayers.ts) drives it; loaded
// on demand with the machine.
import type * as THREE from 'three/webgpu';
import type { ECSWorld } from '../../kernel/ecs/ECS';
import { ComponentType } from '../../kernel/ecs/ECSCoreComponents';
import {
  clearObjectVisibilityFade,
  enableLodDither,
  setObjectVisibilityFade,
} from '../../kernel/render/LodFade';
import type { StreamingFader } from './StreamingCells';

type FadeJob = {
  world: ECSWorld;
  entityIds: readonly number[];
  /** The entities' meshes, collected at the start (a LOD fade copy reads its mesh's fade) */
  meshes: THREE.Object3D[];
  direction: 'IN' | 'OUT';
};

/** The meshes an entity draws (its Object3D and its children), LOD fade copies left out. */
const forEachEntityMesh = (world: ECSWorld, entityId: number, fn: (mesh: THREE.Mesh) => void) => {
  if (!world.isAlive(entityId)) return;
  const object = world.getComponent(entityId, ComponentType.OBJECT3D)?.value;
  object?.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.isMesh && !mesh.userData.isLodFadeCopy) fn(mesh);
  });
};

const forEachMaterial = (mesh: THREE.Mesh, fn: (material: THREE.Material) => void) => {
  const { material } = mesh;
  if (Array.isArray(material)) material.forEach(fn);
  else if (material) fn(material);
};

/**
 * The installed fader. `onMaterialDithered` is told of every material `prepare` changes (the
 * priming then compiles it again before showing it).
 * @internal
 */
export const createStreamingFader = (
  onMaterialDithered: (material: THREE.Material) => void
): StreamingFader => ({
  prepare: (world, entityIds, hidden) => {
    for (let i = 0; i < entityIds.length; i++) {
      forEachEntityMesh(world, entityIds[i], (mesh) => {
        forEachMaterial(mesh, (material) => {
          if (enableLodDither(material)) onMaterialDithered(material);
        });
        // Invisible until its layer's fade in (the priming shows it a group at a time)
        if (hidden) setObjectVisibilityFade(mesh, 0);
      });
    }
  },

  start: (world, entityIds, direction, progress) => {
    const job: FadeJob = { world, entityIds: entityIds.slice(), meshes: [], direction };
    for (let i = 0; i < entityIds.length; i++) {
      const id = entityIds[i];
      forEachEntityMesh(world, id, (mesh) => job.meshes.push(mesh));
      // A fade in starts once the layer is primed: a hold left is another fade's end (a body
      // handed over from a layer that faded out)
      if (direction === 'IN' && world.isAlive(id)) releaseHold(world, id);
    }
    drawJob(job, progress);
    return job;
  },

  draw: (handle, progress) => drawJob(handle as FadeJob, progress),

  release: (world, entityIds) => {
    for (let i = 0; i < entityIds.length; i++) {
      const id = entityIds[i];
      forEachEntityMesh(world, id, clearObjectVisibilityFade);
      if (world.isAlive(id)) releaseHold(world, id);
    }
  },
});

const releaseHold = (world: ECSWorld, entityId: number) => {
  if (world.hasComponent(entityId, ComponentType.TAG_DRAW_HELD)) {
    world.removeComponent(entityId, ComponentType.TAG_DRAW_HELD);
  }
};

/** Writes the job's fade at `progress` on its meshes: in at `progress`, out at `progress - 1`
 * (LodFade.ts' encoding). At 1 an in fade draws them whole, an out fade holds its entities from
 * drawing (the kernel's draw hold) until they're taken down. */
const drawJob = (job: FadeJob, progress: number) => {
  const { meshes } = job;
  if (progress < 1) {
    const fade = job.direction === 'IN' ? progress : progress - 1;
    for (let i = 0; i < meshes.length; i++) setObjectVisibilityFade(meshes[i], fade);
    return;
  }
  for (let i = 0; i < meshes.length; i++) clearObjectVisibilityFade(meshes[i]);
  if (job.direction === 'IN') return;
  const { world, entityIds } = job;
  for (let i = 0; i < entityIds.length; i++) {
    const id = entityIds[i];
    if (world.isAlive(id) && world.hasComponent(id, ComponentType.OBJECT3D)) {
      world.addComponent(id, ComponentType.TAG_DRAW_HELD, true);
    }
  }
};
