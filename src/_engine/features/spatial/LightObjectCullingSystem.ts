import * as THREE from 'three/webgpu';
import { APP_RENDER_SYNC_ORDER, ECSSystemStage } from '../../kernel/loop/SystemStages';
import type { ECSWorld } from '../../kernel/ecs/ECS';
import type { FeatureContext } from '../../kernel/init/Features';
import { getMainCamera } from '../../kernel/camera/Camera';
import { ComponentType } from '../../kernel/ecs/ECSCoreComponents';
import { reconcileObject3DVisibility } from '../../kernel/ecs/ECSCoreSystems';
import { getMeshWorldBoundingSphere } from '../../kernel/ecs/ObjectFrustumCullingSystem';
import type { SpatialGrid } from './SpatialGrid';
import {
  computeLightInfluenceRadius,
  DEFAULT_SPATIAL_DOMAIN,
  getSpatialDomain,
  validateSpatialGridQuery,
} from './SpatialIndexSystem';

// --- NEARBY-MESH TEST ---
// Candidates come from the spatial index (docs/plans/_DONE_p050_spatial-index.md);
// this system does the exact test the index's own contract requires (§7 —
// "candidates, not results").

const _frustum = new THREE.Frustum();
const _projScreenMatrix = new THREE.Matrix4();
const _lightSphere = new THREE.Sphere();

function meshIsVisibleReceiver(entityId: number, world: ECSWorld): boolean {
  // Shared with ObjectFrustumCullingSystem.ts's mesh bounding-volume provider
  // (docs/plans/_DONE_p080_object3d-frustum-culling.md §2.2) — same world-space
  // bounding-sphere approximation, one implementation.
  const meshSphere = getMeshWorldBoundingSphere(entityId, world);
  if (!meshSphere) return false; // the index also holds lights, cameras, etc.

  // A mesh only counts if it both receives this light AND would actually be
  // drawn — a mesh lit but itself off-screen contributes nothing to the
  // rendered frame either (§1).
  return _lightSphere.intersectsSphere(meshSphere) && _frustum.intersectsSphere(meshSphere);
}

// The query's light and world, for the visitor (one function, not a closure per light)
let _visitLightId = 0;
let _visitWorld: ECSWorld | null = null;

/** Stops the query (true) at the first visible receiver: one is enough to keep the light on. */
const receiverVisitor = (candidateId: number): boolean =>
  candidateId !== _visitLightId && meshIsVisibleReceiver(candidateId, _visitWorld!);

/**
 * Whether `lightId` has at least one nearby, in-frustum mesh that could
 * receive its light. The caller doesn't need to know this queries a spatial index rather than
 * scanning every mesh.
 */
function testLightAgainstMeshList(
  lightId: number,
  world: ECSWorld,
  grid: SpatialGrid,
  light: THREE.PointLight | THREE.SpotLight
): boolean {
  const radius = computeLightInfluenceRadius(light);
  // One world matrix update (getWorldPosition would do it again)
  light.updateWorldMatrix(true, false);
  _lightSphere.center.setFromMatrixPosition(light.matrixWorld);
  _lightSphere.radius = radius;

  validateSpatialGridQuery(world, _lightSphere.center, radius);

  _visitLightId = lightId;
  _visitWorld = world;
  const found = grid.queryVisit(_lightSphere.center, radius, receiverVisitor);
  _visitWorld = null;
  return found;
}

// --- THE SYSTEM ---

/**
 * Culls each object-culled point and spot light that lights no visible mesh in its influence
 * sphere (the `DEFAULT` domain's members), every frame. Registered by the feature's install.
 * @internal
 */
export const lightObjectCullingSystem = (world: ECSWorld) => {
  const storage = world.getStorage(ComponentType.OBJECT_CULLING_ENABLED);
  if (storage.size === 0) return; // nothing opted in — skip the frustum build entirely

  const camera = getMainCamera();
  if (!camera) return;

  // Read, never built here: every SPATIAL_INDEXED entity builds DEFAULT's grid, so a scene
  // without one has no indexed receivers, the same result as an empty grid (p349 §3.6)
  const grid = getSpatialDomain(world, DEFAULT_SPATIAL_DOMAIN);

  camera.updateMatrixWorld();
  _frustum.setFromProjectionMatrix(
    _projScreenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
  );

  // Read once per frame; adding and removing TAG_OBJECT_CULLED below keeps the same storage
  const object3Ds = world.getStorage(ComponentType.OBJECT3D);
  const frustumCulled = world.getStorage(ComponentType.TAG_FRUSTUM_CULLED);
  const objectCulled = world.getStorage(ComponentType.TAG_OBJECT_CULLED);

  for (const [entityId] of storage) {
    if (world.isDisabled(entityId)) continue; // already invisible; don't fight over .visible
    // Already known to have nothing looking at it this frame — skip the (more expensive) mesh scan.
    if (frustumCulled.has(entityId)) continue;

    const objComp = object3Ds.get(entityId);
    if (!objComp) continue;
    const light = objComp.value as THREE.PointLight | THREE.SpotLight;

    const hasNearbyVisibleMesh = grid
      ? testLightAgainstMeshList(entityId, world, grid, light)
      : false;
    const isCulled = objectCulled.has(entityId);
    if (hasNearbyVisibleMesh && isCulled) {
      world.removeComponent(entityId, ComponentType.TAG_OBJECT_CULLED);
    } else if (!hasNearbyVisibleMesh && !isCulled) {
      world.addComponent(entityId, ComponentType.TAG_OBJECT_CULLED, true);
    }
  }
};

/**
 * Installs light (contribution) culling (the `spatial()` feature's install, SpatialFeature.ts):
 * the visibility hook and the culling system.
 * @internal
 */
export const installLightObjectCulling = (ctx: FeatureContext) => {
  // The object (contribution) culling visibility hook: a third, independent cull reason
  // alongside DISABLED and TAG_FRUSTUM_CULLED, reconciled through the shared helper rather than
  // another pairwise visibility guard.
  ctx.registerComponentHooks(ComponentType.TAG_OBJECT_CULLED, {
    onAddComponent: (entityId, world) => {
      reconcileObject3DVisibility(entityId, world, { isObjectCulled: true });
    },
    onRemoveComponent: (entityId, world) => {
      reconcileObject3DVisibility(entityId, world, { isObjectCulled: false });
    },
  });

  ctx.registerPlugin((world) => {
    // LIGHT_CULLING (-2), one below objectFrustumCullingSystem's FRUSTUM_CULLING (-1) —
    // runs after frustum culling has updated TAG_FRUSTUM_CULLED for this
    // frame, so the skip above sees this frame's result, not last frame's.
    world.addSystem(
      ECSSystemStage.APP_RENDER_SYNC,
      'lightObjectCullingSystem',
      lightObjectCullingSystem,
      APP_RENDER_SYNC_ORDER.LIGHT_CULLING
    );
  });
};
