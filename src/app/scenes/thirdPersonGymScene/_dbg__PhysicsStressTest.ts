import {
  createActionMap,
  getCurrentSceneId,
  getECSWorld,
  getLogger,
  getRandomStream,
  lwarn,
  createGeometry,
  createMaterial,
  createMeshEntity,
} from 'aekasha';
import { createPhysicsEntity } from 'aekasha/physics';

/**
 * The gym's physics stress test (debug env only: the scene `import()`s it behind
 * `IS_DEBUG_ENV`): J spawns a batch of dynamic boxes and balls above the start, to load the
 * physics world.
 */

// Shared by each shape's mesh geometry and its collider, so the two always match
const BOX_SIZE = 0.5;
const SPHERE_RADIUS = 0.3;

/** The spawned bodies this visit (their app ids); the scene's exit deletes them. */
let spawnedCount = 0;

// Shared by every spawned mesh, by id
const getAssets = () => ({
  geoBox: createGeometry({
    id: 'stress-box-geo',
    type: 'BOX',
    params: { width: BOX_SIZE, height: BOX_SIZE, depth: BOX_SIZE },
  }),
  geoSphere: createGeometry({
    id: 'stress-sphere-geo',
    type: 'SPHERE',
    params: { radius: SPHERE_RADIUS },
  }),
  mat: createMaterial({
    id: 'stress-mat',
    type: 'PHONG',
    params: { color: '#ff4400' },
  }),
});

/** A uniformly random rotation (Shoemake's method), from three draws of `random`. */
const getRandomRotation = (random: () => number) => {
  const u1 = random();
  const a = 2 * Math.PI * random();
  const b = 2 * Math.PI * random();
  const s1 = Math.sqrt(1 - u1);
  const s2 = Math.sqrt(u1);
  return { x: s1 * Math.sin(a), y: s1 * Math.cos(a), z: s2 * Math.sin(b), w: s2 * Math.cos(b) };
};

/**
 * Binds J, in `sceneId` only, to spawn `batchSize` (default 50) dynamic boxes and balls. They're
 * placed from the `gym:stress` random stream, which every scene load restarts, so the Nth batch
 * of a visit is the same on every visit.
 */
export const initPhysicsStressTest = ({
  sceneId,
  batchSize = 50,
}: {
  sceneId: string;
  batchSize?: number;
}) => {
  spawnedCount = 0;
  // Created now, so the first batch doesn't create them
  getAssets();

  const spawnBatch = () => {
    // Resolved per batch (cache hits by id), so a batch never holds a released asset
    const { geoBox, geoSphere, mat } = getAssets();
    const random = getRandomStream('gym:stress');
    const creates: Promise<unknown>[] = [];
    for (let i = 0; i < batchSize; i++) {
      spawnedCount++;
      const isBox = random() > 0.5;
      // 20 × 20 m around the origin, 10 to 30 m up
      const position = {
        x: (random() - 0.5) * 20,
        y: 10 + random() * 20,
        z: (random() - 0.5) * 20,
      };

      const entityId = createMeshEntity(
        {
          geo: isBox ? geoBox : geoSphere,
          mat: mat,
          castShadow: true,
          receiveShadow: true,
          position,
        },
        { appId: `stress-mesh-${spawnedCount}` }
      );

      // Created in parallel, not awaited one by one (WORKER_THREAD round-trips to the worker). A
      // body that isn't created (eg. the world's maxBodies) takes its mesh with it
      const create = createPhysicsEntity(
        {
          type: isBox ? 'BOX' : 'BALL',
          ...(isBox
            ? { hx: BOX_SIZE / 2, hy: BOX_SIZE / 2, hz: BOX_SIZE / 2 }
            : { radius: SPHERE_RADIUS }),
          friction: 0.5,
          restitution: 0.5, // Bounciness makes them settle slower (more CPU usage)
          density: 1.0,
        },
        {
          rigidType: 'DYNAMIC',
          translation: position,
          // Tumbling boxes make the collisions complex
          rotation: getRandomRotation(random),
        },
        entityId
      ).catch((error: unknown) => {
        const world = getECSWorld();
        if (world.isAlive(entityId)) world.deleteEntity(entityId);
        throw error;
      });
      creates.push(create);
    }

    getLogger().log(`Stress Test: Spawned ${batchSize} objects. Total: ${spawnedCount}`);
    // One warning per batch; none once the scene is left (its exit deleted the meshes)
    void Promise.allSettled(creates).then((results) => {
      const failed = results.filter(
        (result): result is PromiseRejectedResult => result.status === 'rejected'
      );
      if (!failed.length || getCurrentSceneId() !== sceneId) return;
      lwarn(
        `Stress Test: ${failed.length} of ${batchSize} bodies weren't created (their meshes were deleted).`,
        failed[0].reason
      );
    });
  };

  // J for "junk": a scene map (replaced on the next visit, by its id), also with the debug camera
  // on
  createActionMap({
    id: 'physicsStressTest',
    sceneId,
    enabledInDebugCam: 'ENABLED_IN_DEBUG',
    actions: { spawn: { type: 'BUTTON', name: 'Spawn a stress test batch' } },
    bindings: { spawn: [{ device: 'KEYBOARD', keys: ['j'] }] },
  }).onPressed('spawn', spawnBatch);

  getLogger().log(`Physics Stress Test Initialized. Press 'J' to spawn ${batchSize} objects.`);
};
