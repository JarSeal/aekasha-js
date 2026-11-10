import * as THREE from 'three/webgpu';
import { createGeometry, createMeshEntity, getGeometry, registerMergedGeometry } from 'aekasha';
import type { Vector3Like } from 'aekasha';
import { createPhysicsEntity } from 'aekasha/physics';

/** The stairs' steps: each a 4 × 0.2 × 4 m box, 0.2 m above and 0.4 m behind the one before. */
const STEP = { count: 10, rise: 0.2, run: 0.4, width: 4, depth: 4 };

/**
 * The stairs' colliders, in the stairs' own space (step 0 centred at the origin): a ramp along the
 * steps' fronts, so a character walks up instead of stepping (the dynamic controller's stairs
 * handling reads `isStairs` and `stairsColliderIndex`, the ramp, from the body's user data), and
 * the landing on the top step. The ramp's angle (-π / 6.8, about 26.5°) and its placement were
 * fitted by hand to the steps' 0.2 / 0.4 slope (26.6°); the landing's top is the top step's
 * (y = 1.9). Kept as fitted: they shape the characters' paths, which the scene runner hashes.
 */
const createStairsColliders = () => {
  const rampRotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 6.8, 0, 0));
  return [
    {
      type: 'BOX' as const,
      friction: 1,
      hx: 2,
      hy: 0.1,
      hz: 2.2,
      translation: { x: 0, y: 0.83, z: -0.32 },
      rotation: { x: rampRotation.x, y: rampRotation.y, z: rampRotation.z, w: rampRotation.w },
    },
    {
      type: 'BOX' as const,
      friction: 1,
      hx: 2,
      hy: 0.1,
      hz: 2,
      translation: { x: 0, y: 1.8, z: 3.6 },
    },
  ];
};

/**
 * The steps merged into one geometry (`stairsGeo`): one box placed ten times, without groups (the
 * stairs have one material). The registered one on a later visit.
 */
const getStairsGeometry = () => {
  const existing = getGeometry('stairsGeo');
  if (existing) return existing;
  const step = new THREE.BoxGeometry(STEP.width, STEP.rise, STEP.depth);
  const steps = Array.from({ length: STEP.count }, (_, i) => ({
    geo: step,
    matrix: new THREE.Matrix4().makeTranslation(0, STEP.rise * i, STEP.run * i),
  }));
  // Registered, so the mesh's ref count disposes it with the scene; the step is only read
  const stairs = registerMergedGeometry(steps, { id: 'stairsGeo' });
  step.dispose();
  return stairs;
};

/**
 * The gym's built stairs (a flight of ten steps with a ramp collider, `stairsMesh`) and a
 * 10 m box wall to run into (`bigBoxWallMesh`), both FIXED bodies, the stairs first.
 * @param params the material both use and where each goes
 */
export const createGymStairsAndWallAsync = async ({
  material,
  stairsPosition,
  wallPosition,
}: {
  material: THREE.Material;
  /** Step 0's centre. */
  stairsPosition: Vector3Like;
  /** The wall's centre. */
  wallPosition: Vector3Like;
}) => {
  const stairsEntityId = createMeshEntity(
    {
      geo: getStairsGeometry(),
      mat: material,
      castShadow: true,
      receiveShadow: true,
      position: stairsPosition,
    },
    { appId: 'stairsMesh' }
  );
  await createPhysicsEntity({
    colliders: createStairsColliders(),
    body: { rigidType: 'FIXED', userData: { isStairs: true, stairsColliderIndex: 0 } },
    target: stairsEntityId,
  });

  const wallEntityId = createMeshEntity(
    {
      geo: createGeometry({
        id: 'bigBoxWallGeo',
        type: 'BOX',
        params: { width: 10, height: 10, depth: 10 },
      }),
      mat: material,
      castShadow: true,
      receiveShadow: true,
      position: wallPosition,
    },
    { appId: 'bigBoxWallMesh' }
  );
  await createPhysicsEntity({
    colliders: { type: 'BOX', friction: 1 },
    body: { rigidType: 'FIXED' },
    target: wallEntityId,
  });
};
