// LOD cross-fades (docs/plans/_DONE_p351_impostor-billboard-lod.md §2.4): a level change, or hiding
// and showing, dissolves over `fadeSeconds` (LodFade.ts). The entity gets TAG_LOD_TRANSITIONING and
// `_fade` (its progress) and lodFadeSystem (LodSystem.ts) drives it; a change while a fade runs
// finishes that fade first. The first apply after the LOD is added never fades (the load), nor
// does removing the LOD; an entity LOD culled at its first selection fades in when it's first
// shown. Targets fade when they have `setFade`; plain meshes always can (see PLAIN MESH FADES),
// except skinned ones.
import * as THREE from 'three/webgpu';
import type { ECSWorld } from '../../kernel/ecs/ECS';
import { ComponentType } from '../../kernel/ecs/ECSCoreComponents';
import { setMeshGeometry, setMeshMaterial } from '../../kernel/mesh/Mesh';
import { clearLodObjectFade, LOD_FADE_OPAQUE, setLodObjectFade } from '../../kernel/render/LodFade';
import { getLodFadeSeconds } from './LodSettings';
import type { LodData, LodResolvedLevel } from './LodTypes';

const getFadeSeconds = (lod: LodData) => lod.def.fadeSeconds ?? getLodFadeSeconds();

/** Set while a LOD component is removed: everything it does then is instant. */
let areFadesSuppressed = false;

/**
 * Removes the entity's TAG_LOD_CULLED without a fade: the `LOD` remove hook's, which shows the
 * entity at once.
 * @internal
 */
export const removeLodCulledInstantly = (entityId: number, world: ECSWorld) => {
  areFadesSuppressed = true;
  try {
    world.removeComponent(entityId, ComponentType.TAG_LOD_CULLED);
  } finally {
    areFadesSuppressed = false;
  }
};

// --- PLAIN MESHES ---

/**
 * The entity's plain mesh (its `OBJECT3D` when that's a Mesh), for the LOD hooks and the fades.
 * @internal
 */
export const getLodMesh = (entityId: number, world: ECSWorld) => {
  const obj = world.getComponent(entityId, ComponentType.OBJECT3D)?.value;
  return obj instanceof THREE.Mesh ? obj : undefined;
};

/**
 * Shows a resolved level on a plain mesh at once.
 * @internal
 */
export const setMeshLevel = (mesh: THREE.Mesh, level: LodResolvedLevel) => {
  setMeshGeometry(mesh, level.geometry);
  setMeshMaterial(mesh, level.material);
  mesh.castShadow = level.castShadow;
};

/**
 * A mesh that compiles to the pipelines `mesh` would draw `level` with: an InstancedMesh's shares
 * its instance attributes. Never frustum culled, as compileAsync culls against its own camera.
 * For the levels' pre-warm and a fade's outgoing copy.
 * @internal
 */
export const createStandIn = (mesh: THREE.Mesh, level: LodResolvedLevel) => {
  let standIn: THREE.Mesh;
  if ((mesh as THREE.InstancedMesh).isInstancedMesh) {
    const instanced = mesh as THREE.InstancedMesh;
    const standInInstanced = new THREE.InstancedMesh(level.geometry, level.material, 0);
    standInInstanced.instanceMatrix = instanced.instanceMatrix;
    standInInstanced.instanceColor = instanced.instanceColor;
    standInInstanced.count = instanced.count;
    standIn = standInInstanced;
  } else {
    standIn = new THREE.Mesh(level.geometry, level.material);
  }
  standIn.castShadow = level.castShadow;
  standIn.receiveShadow = mesh.receiveShadow;
  standIn.frustumCulled = false;
  return standIn;
};

// --- PLAIN MESH FADES ---
//
// A level change draws the previous level through a temporary copy of the mesh: a child of it, so
// it follows the mesh and hides with it (frustum culling, DISABLED). The copy is disposed when the
// fade ends, as three r186 keeps an object's render objects until it is. A plain mesh's copy shares
// the mesh's shader builds; an InstancedMesh's builds its own (three keys its builds by uuid).
// Hiding and showing fade the mesh itself: a LOD-culled mesh stays visible while it fades out
// (reconcileObject3DVisibility). Both copies take the per-object fade (setLodObjectFade).

/** A copy of what `mesh` shows now, for a fade's outgoing level: added to the mesh, never picked by
 * raycasts, holding no registry refs (the LOD component holds every level's). */
const createFadeOutCopy = (mesh: THREE.Mesh) => {
  const copy = createStandIn(mesh, {
    geometry: mesh.geometry,
    material: mesh.material,
    castShadow: mesh.castShadow,
  });
  copy.frustumCulled = mesh.frustumCulled;
  copy.renderOrder = mesh.renderOrder;
  copy.layers.mask = mesh.layers.mask;
  copy.raycast = () => {};
  copy.userData.isLodFadeCopy = true;
  mesh.add(copy);
  return copy;
};

const applyMeshLevel = (
  entityId: number,
  world: ECSWorld,
  lod: LodData,
  level: number,
  fade: boolean
) => {
  const mesh = getLodMesh(entityId, world);
  const resolved = lod._levels[level];
  if (!mesh || !resolved) return;
  if (fade) {
    lod._fadeOut = createFadeOutCopy(mesh);
    lod._fadeIn = mesh;
    setLodObjectFade(lod._fadeOut, -LOD_FADE_OPAQUE);
    setLodObjectFade(mesh, 0);
  }
  setMeshLevel(mesh, resolved);
};

/** Without a fade, TAG_LOD_CULLED's visibility reconcile already hid or showed the mesh. */
const setMeshCulled = (
  entityId: number,
  world: ECSWorld,
  lod: LodData,
  isCulled: boolean,
  fade: boolean
) => {
  const mesh = fade ? getLodMesh(entityId, world) : undefined;
  if (!mesh) return;
  if (isCulled) {
    lod._fadeOut = mesh;
    setLodObjectFade(mesh, -LOD_FADE_OPAQUE);
  } else {
    lod._fadeIn = mesh;
    setLodObjectFade(mesh, 0);
  }
};

/**
 * Draws a plain mesh's fade at `progress`; 1 ends it (the copy goes, the mesh is drawn whole).
 * @internal
 */
export const setMeshFade = (lod: LodData, progress: number) => {
  const fadeIn = lod._fadeIn;
  const fadeOut = lod._fadeOut;
  if (progress < 1) {
    if (fadeIn) setLodObjectFade(fadeIn, progress);
    if (fadeOut) setLodObjectFade(fadeOut, progress - 1);
    return;
  }
  lod._fadeIn = undefined;
  lod._fadeOut = undefined;
  if (fadeIn) clearLodObjectFade(fadeIn);
  if (!fadeOut) return;
  clearLodObjectFade(fadeOut);
  if (fadeOut.userData.isLodFadeCopy) {
    fadeOut.removeFromParent();
    fadeOut.dispose();
  }
};

// --- FADES BY KIND: a target's, or a plain mesh's ---

/**
 * Shows `level` on the entity: through its LodTarget, or on its plain mesh.
 * @internal
 */
export const applyLevelTo = (
  entityId: number,
  world: ECSWorld,
  lod: LodData,
  level: number,
  fade: boolean
) => {
  if (lod._target) lod._target.applyLevel(entityId, world, level, fade);
  else applyMeshLevel(entityId, world, lod, level, fade);
};

/**
 * Hides or shows the entity at its cull threshold: through its LodTarget, or on its plain mesh.
 * @internal
 */
export const setCulledTo = (
  entityId: number,
  world: ECSWorld,
  lod: LodData,
  isCulled: boolean,
  fade: boolean
) => {
  if (lod._target) lod._target.setCulled(entityId, world, isCulled, fade);
  else setMeshCulled(entityId, world, lod, isCulled, fade);
};

/**
 * Draws the entity's running fade at `progress` (1 ends it).
 * @internal
 */
export const drawFade = (entityId: number, world: ECSWorld, lod: LodData, progress: number) => {
  if (lod._target) lod._target.setFade?.(entityId, world, progress);
  else setMeshFade(lod, progress);
};

/** A target fades when it has `setFade`, a plain mesh unless it's skinned (a copy wouldn't be). */
const canFade = (entityId: number, world: ECSWorld, lod: LodData) => {
  if (lod._target) return lod._target.setFade !== undefined;
  const mesh = getLodMesh(entityId, world);
  return mesh !== undefined && !(mesh as THREE.SkinnedMesh).isSkinnedMesh;
};

/**
 * Ends the entity's running fade, if any: only the incoming copy stays, drawn whole.
 * @internal
 */
export const endFade = (entityId: number, world: ECSWorld, lod: LodData) => {
  if (!world.hasComponent(entityId, ComponentType.TAG_LOD_TRANSITIONING)) return;
  drawFade(entityId, world, lod, 1);
  lod._fade = undefined;
  lod._fadeFrom = undefined;
  world.removeComponent(entityId, ComponentType.TAG_LOD_TRANSITIONING);
};

/**
 * Before a change of what the entity shows: finishes a running fade, and says whether the change
 * fades (not the first apply, unless it shows an entity LOD culled since its first selection; not
 * while the LOD is removed; not for an entity that can't).
 * @internal
 */
export const prepareChange = (
  entityId: number,
  world: ECSWorld,
  lod: LodData,
  isShowing = false
) => {
  endFade(entityId, world, lod);
  return (
    !areFadesSuppressed &&
    (lod.applied >= 0 || isShowing) &&
    getFadeSeconds(lod) > 0 &&
    canFade(entityId, world, lod)
  );
};

/**
 * Starts the entity's fade. `from`: the level shown until now, -1 from LOD culled
 * (LodData._fadeFrom).
 * @internal
 */
export const startFade = (entityId: number, world: ECSWorld, lod: LodData, from: number) => {
  lod._fade = 0;
  lod._fadeFrom = from;
  world.addComponent(entityId, ComponentType.TAG_LOD_TRANSITIONING, true);
};
