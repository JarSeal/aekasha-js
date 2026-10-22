import {
  createActionMap,
  getLogger,
  createGeometry,
  createMaterial,
  createMeshEntity,
  IS_DEBUG_ENV,
} from 'aekasha';
import { createPhysicsEntity } from 'aekasha/physics';

let stressTestCount = 0;

// Shared by each shape's mesh geometry and its collider, so the two always match
const BOX_SIZE = 0.5;
const SPHERE_RADIUS = 0.3;

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

/** Binds J, in `sceneId` only, to spawn `batchSize` (default 50) dynamic boxes and balls. */
export const initPhysicsStressTest = ({
  sceneId,
  batchSize = 50,
}: {
  sceneId: string;
  batchSize?: number;
}) => {
  if (!IS_DEBUG_ENV) return;

  // 1. Pre-create assets to minimize GC during the test
  getAssets();

  // 2. The Spawner Function
  const spawnBatch = () => {
    // Resolved per batch (cache hits by id), so a batch never holds a released asset
    const { geoBox, geoSphere, mat } = getAssets();
    for (let i = 0; i < batchSize; i++) {
      stressTestCount++;
      const isBox = Math.random() > 0.5;

      // Random position above the map
      const x = (Math.random() - 0.5) * 20;
      const y = 10 + Math.random() * 20; // Height 10 to 30
      const z = (Math.random() - 0.5) * 20;

      const appId = `stress-mesh-${stressTestCount}`;

      const entityId = createMeshEntity(
        {
          geo: isBox ? geoBox : geoSphere,
          mat: mat,
          castShadow: true,
          receiveShadow: true,
          position: { x, y, z },
        },
        { appId }
      );

      // Fire-and-forget: createPhysicsEntity is async (WORKER_THREAD round-trips to the
      // physics worker), and this spawns up to `batchSize` per keypress — awaiting each one
      // in sequence would serialize the whole batch instead of letting them settle in
      // parallel, same as the legacy synchronous spawner effectively did.
      void createPhysicsEntity(
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
          translation: { x, y, z },
          // Random rotation to make collisions complex
          rotation: {
            x: Math.random(),
            y: Math.random(),
            z: Math.random(),
            w: 1,
          },
        },
        entityId
      );
    }

    getLogger().log(`Stress Test: Spawned ${batchSize} objects. Total: ${stressTestCount}`);
  };

  // 3. Bind to Key 'J' (for "Junk"): a scene map (replaced on the next visit, by its id), also
  // with the debug camera on
  createActionMap({
    id: 'physicsStressTest',
    sceneId,
    enabledInDebugCam: 'ENABLED_IN_DEBUG',
    actions: { spawn: { type: 'BUTTON', name: 'Spawn a stress test batch' } },
    bindings: { spawn: [{ device: 'KEYBOARD', keys: ['j'] }] },
  }).onPressed('spawn', spawnBatch);

  getLogger().log(`Physics Stress Test Initialized. Press 'J' to spawn ${batchSize} objects.`);
};
