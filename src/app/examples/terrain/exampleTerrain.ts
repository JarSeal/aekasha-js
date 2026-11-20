import { createActionMap, createMeshEntity, getECSWorld, getRandomStream } from 'aekasha';
import { createPhysicsEntity } from 'aekasha/physics';
import { spawnTerrainBlock } from 'aekasha/terrain';
import { saveRockGeometries } from 'aekasha/toolkit/geometry';
import { createExampleHud } from '../exampleHud';

const SCENE_ID = 'exampleTerrain';
/** The oldest dropped ball is deleted past this many */
const MAX_BALLS = 40;
/** Where the balls drop from: over the block's middle, this high */
const DROP = { spread: 28, height: 24 };

// #region terrain-balls (shown in the Hub: hub/pages/examples/terrain/)
const BALL = {
  geo: { id: 'terrainBall', type: 'SPHERE', params: { radius: 0.6 } },
  mat: { id: 'terrainBall', type: 'STANDARD', params: { color: '#e8833a' } },
} as const;

/** A ball: a mesh entity with a dynamic Rapier body, which rolls down the block's collider */
const dropBall = async (position: { x: number; y: number; z: number }) => {
  const entityId = createMeshEntity({ ...BALL, position, castShadow: true });
  await createPhysicsEntity({
    colliders: { type: 'BALL', radius: 0.6, friction: 0.6 },
    body: { rigidType: 'DYNAMIC', translation: position },
    target: entityId,
  });
  return entityId;
};
// #endregion terrain-balls

// #region terrain-scene (shown in the Hub: hub/pages/examples/terrain/)
export const scene = async () => {
  // The toolkit's procedural rocks, which the block's scatter names by id
  saveRockGeometries({ kinds: ['ROCK'] });

  // The block: its generated mesh, material, collider and scatter, from its JSON
  const block = await spawnTerrainBlock('exampleTerrainBlock');
  if (!block) return; // the scene was left while it spawned

  // Balls over the block: a named stream restarts with every load, so they drop alike each visit
  const random = getRandomStream('exampleTerrain:balls');
  const randomDrop = () => ({
    x: (random() - 0.5) * DROP.spread,
    y: DROP.height,
    z: (random() - 0.5) * DROP.spread,
  });
  const balls = await Promise.all(Array.from({ length: 6 }, () => dropBall(randomDrop())));
  const dropRandomBall = async () => {
    balls.push(await dropBall(randomDrop()));
    // Deleting the entity removes its body too
    if (balls.length > MAX_BALLS) getECSWorld().deleteEntity(balls.shift()!);
  };

  const actions = createActionMap({
    id: SCENE_ID,
    sceneId: SCENE_ID,
    actions: { drop: { type: 'BUTTON', name: 'Drop a ball' } },
    bindings: {
      drop: [
        { device: 'KEYBOARD', keys: [' '] },
        { device: 'GAMEPAD', button: 'SOUTH' },
      ],
    },
  });
  actions.onPressed('drop', () => void dropRandomBall());
  createExampleHud('Space or pad A: drop a ball');
};
// #endregion terrain-scene
