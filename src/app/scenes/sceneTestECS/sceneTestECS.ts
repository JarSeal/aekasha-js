import { createMeshEntity, getECSWorld } from 'aekasha';
import { HoverToolComponentType } from 'aekasha/toolkit/ecs';

/**
 * The start scene (`src/index.ts` loads it first). Its camera, lights, sky box and two meshes come
 * from `sceneTestECS.scene.json`: the sphere with the app's own TSL material (`testTslMat`) and a
 * box imported from a GLB. The code adds what the JSON doesn't: a ground and a ball that hovers
 * with the toolkit's HoverEffect, a component on its entity (the effect's system is registered in
 * `src/AppECSPlugins.ts`).
 */
export const scene = async () => {
  // Its top at y = 0, where the meshes of the JSON stand
  createMeshEntity(
    {
      geo: { type: 'BOX', params: { width: 20, height: 0.1, depth: 20 } },
      mat: { type: 'LAMBERT', params: { color: 0x429925 } },
      position: { y: -0.05 },
      receiveShadow: true,
    },
    { appId: 'ground', debugData: { name: 'Ground' } }
  );

  const ballId = createMeshEntity(
    {
      geo: { type: 'SPHERE', params: { radius: 0.5, widthSegments: 32, heightSegments: 32 } },
      mat: { type: 'LAMBERT', params: { color: 0xff0000 } },
      position: { x: 0, y: 1, z: 0 },
      castShadow: true,
    },
    { appId: 'hoverBall', debugData: { name: 'Hover ball' } }
  );
  // Bobs 0.4 m around y = 1, at 2 rad/s
  getECSWorld().addComponent(ballId, HoverToolComponentType.HOVER, {
    speed: 2,
    amplitude: 0.4,
    baseY: 1,
  });
};
