import {
  createGeometry,
  createMaterial,
  createMeshEntity,
  getECSWorld,
  existsOrThrow,
  IS_DEBUG_ENV,
  llog,
  lerror,
  createSceneAppLooper,
  deleteSceneAppLooper,
  registerOnSceneExit,
} from 'aekasha';
import {
  createPhysicsEntity,
  createJoint,
  getPhysicsSimClock,
  getPhysicsWorld,
  JointAxesMask,
} from 'aekasha/physics';
import type { PhysVector } from 'aekasha/physics';
import { addToast } from 'aekasha/ui';

const PHYSICS_TEST_SCENE_ID = 'physicsTest';

/** The joint demos' row: x from -21 to 21, 7 m apart, at this z. */
const JOINT_DEMO_Z = -15;

/** A body's RigidBodyAPI id, read back from the entity createPhysicsEntity attached it to. */
const getRigidBodyId = (entityId: number, label: string) =>
  existsOrThrow(
    getECSWorld().getRigidBody(entityId),
    `Could not find a rigid body on entity ${entityId} (${label}) in physicsTest scene.`
  ).id;

/** A dynamic body's mesh and body. */
interface DynamicBodyParams {
  /** The geometry's and the material's id, and the mesh's app id without `appId`. */
  id: string;
  appId?: string;
  position: PhysVector;
  color: number;
  /** The start spin. */
  angvel?: PhysVector;
  /** The collider's user data `name`, which the sensor's toast shows. */
  name?: string;
}

/** A small dark static anchor box: every joint demo's fixed attachment point. */
const createAnchorBodyAsync = async (id: string, position: PhysVector) => {
  const geo = createGeometry({
    id,
    type: 'BOX',
    params: { width: 0.4, height: 0.4, depth: 0.4 },
  });
  const mat = createMaterial({ id, type: 'STANDARD', params: { color: 0x2a2a2a } });
  const entityId = createMeshEntity(
    { geo, mat, position, castShadow: true, receiveShadow: true },
    { appId: id }
  );
  await createPhysicsEntity(
    { type: 'BOX', hx: 0.2, hy: 0.2, hz: 0.2 },
    { rigidType: 'FIXED', translation: position },
    entityId
  );
  return getRigidBodyId(entityId, id);
};

/** A dynamic coloured box, half-extents (`hx`, `hy`, `hz`) 0.4 by default. */
// #region dynamic-box (shown in the Hub: hub/pages/project/aekasha/code-blocks/)
const createDynamicBoxAsync = async (
  params: DynamicBodyParams & { hx?: number; hy?: number; hz?: number; restitution?: number }
) => {
  const { id, appId = id, position, color, angvel, name, restitution } = params;
  const { hx = 0.4, hy = 0.4, hz = 0.4 } = params;
  const geo = createGeometry({
    id,
    type: 'BOX',
    params: { width: hx * 2, height: hy * 2, depth: hz * 2 },
  });
  const mat = createMaterial({ id, type: 'STANDARD', params: { color } });
  const entityId = createMeshEntity(
    { geo, mat, position, castShadow: true, receiveShadow: true },
    { appId }
  );
  await createPhysicsEntity(
    { type: 'BOX', hx, hy, hz, restitution, userData: name ? { name } : undefined },
    { rigidType: 'DYNAMIC', translation: position, angvel },
    entityId
  );
  return getRigidBodyId(entityId, id);
};
// #endregion dynamic-box

/** A dynamic coloured ball, radius 0.4 by default. */
const createDynamicBallAsync = async (params: DynamicBodyParams & { radius?: number }) => {
  const { id, appId = id, position, color, angvel, name, radius = 0.4 } = params;
  const geo = createGeometry({ id, type: 'SPHERE', params: { radius } });
  const mat = createMaterial({ id, type: 'STANDARD', params: { color } });
  const entityId = createMeshEntity(
    { geo, mat, position, castShadow: true, receiveShadow: true },
    { appId }
  );
  await createPhysicsEntity(
    { type: 'BALL', radius, userData: name ? { name } : undefined },
    { rigidType: 'DYNAMIC', translation: position, angvel },
    entityId
  );
  return getRigidBodyId(entityId, id);
};

/** The ground: a 50 × 50 m static box, its top face at y = 0.25. */
const createGroundAsync = async () => {
  const groundEntityId = createMeshEntity(
    {
      geo: createGeometry({
        id: 'physicsTestGround',
        type: 'BOX',
        params: { width: 50, height: 0.5, depth: 50 },
      }),
      mat: createMaterial({
        id: 'physicsTestGround',
        type: 'STANDARD',
        params: { color: 0x666666 },
      }),
      position: { x: 0, y: 0, z: 0 },
      castShadow: true,
      receiveShadow: true,
    },
    { appId: 'physicsTestGroundMesh' }
  );
  await createPhysicsEntity(
    { type: 'BOX', hx: 25, hy: 0.25, hz: 25 },
    { rigidType: 'FIXED', translation: { x: 0, y: 0, z: 0 } },
    groundEntityId
  );
};

/** The two shape casts against the ground box, each result in a toast (debug env). */
const runShapeCasts = async (visit: { isLeft: boolean }) => {
  // The UI kit's toaster may not exist yet when this is the start scene: a log then
  const report = (title: string, message: string) => {
    if (!IS_DEBUG_ENV) return;
    try {
      addToast({ title, message });
    } catch {
      llog(`[physicsTest] ${title}: ${message}`);
    }
  };

  const castOrigin: PhysVector = { x: 0, y: 5, z: 20 };
  const noRotation = { x: 0, y: 0, z: 0, w: 1 };
  const castShapeParams = { type: 'BALL' as const, radius: 0.5 };

  const groundHit = await getPhysicsWorld().castShape(
    castOrigin,
    noRotation,
    { x: 0, y: -1, z: 0 },
    castShapeParams,
    0,
    10,
    true
  );
  if (visit.isLeft) return;
  report(
    'Shape-cast toward ground',
    groundHit
      ? `Hit, TOI ${groundHit.timeOfImpact.toFixed(2)}, normal (${groundHit.normal1.x.toFixed(2)}, ${groundHit.normal1.y.toFixed(2)}, ${groundHit.normal1.z.toFixed(2)})`
      : 'No hit (unexpected)'
  );

  const emptyHit = await getPhysicsWorld().castShape(
    castOrigin,
    noRotation,
    { x: 0, y: 1, z: 0 },
    castShapeParams,
    0,
    10,
    true
  );
  if (visit.isLeft) return;
  report('Shape-cast away from ground', emptyHit ? 'Hit (unexpected)' : 'No hit, as expected');
};

/**
 * Two casts of a small ball shape from the same point: one straight down into the ground box
 * (expects a hit with a sane normal and TOI), one straight up into open air (expects no hit).
 * The async castShape works in both worker targets (castShapeSync throws in WORKER_THREAD).
 * Rapier's query pipeline indexes a collider only once the world has stepped, and physics is held
 * for the whole load, so the casts wait for the first step of this visit's world (the sim clock
 * counts the steps issued to it; the worker runs them before the casts). Not awaited by the load,
 * so the scene's exit stops them after their next await.
 */
const startShapeCasts = () => {
  const visit = { isLeft: false };
  registerOnSceneExit(PHYSICS_TEST_SCENE_ID, () => {
    visit.isLeft = true;
  });
  const castLooperIndex = createSceneAppLooper(() => {
    if (getPhysicsSimClock() < 1) return;
    deleteSceneAppLooper(castLooperIndex, PHYSICS_TEST_SCENE_ID);
    runShapeCasts(visit).catch((error) => {
      if (!visit.isLeft) lerror('[physicsTest] The shape casts failed', error);
    });
  }, PHYSICS_TEST_SCENE_ID);
};

/** A spinning ball and box dropped onto a sensor, which toasts each one's name as it enters. */
const createFallingBodiesAsync = async () => {
  await createDynamicBallAsync({
    id: 'physicsTestBall',
    appId: 'physicsTestBallMesh',
    position: { x: -1, y: 5, z: 10 },
    color: 0xff4444,
    angvel: { x: 0, y: 0, z: -3 },
    name: 'Ball',
    radius: 0.5,
  });
  await createDynamicBoxAsync({
    id: 'physicsTestBox',
    appId: 'physicsTestBoxMesh',
    position: { x: 1, y: 7, z: 10 },
    color: 0x4488ff,
    angvel: { x: 1, y: 7, z: 0 },
    name: 'Box',
    hx: 0.5,
    hy: 0.5,
    hz: 0.5,
  });

  // Invisible, just above the ground's top face (y = 0.25), under the ball and the box
  await createPhysicsEntity(
    {
      type: 'BOX',
      hx: 5,
      hy: 0.25,
      hz: 5,
      isSensor: true,
      collisionEventFn: (_sensor, other, started) => {
        if (!started) return;
        const otherName = other.getUserDataSync().name;
        const name = typeof otherName === 'string' ? otherName : String(other.id);
        if (IS_DEBUG_ENV) {
          addToast({ title: 'Physics sensor', message: `${name} entered` });
        }
      },
    },
    { rigidType: 'FIXED', translation: { x: 0, y: 0.5, z: 10 } },
    // No mesh to hang off, so this one creates its own entity: an explicit appId, or it gets a
    // fresh UUID on every load and its debug settings (eg. a wireframe toggle) can't survive one
    undefined,
    { appId: 'physicsTestSensor' }
  );
};

/** FIXED (orange): a dynamic box rigidly locked to a static anchor: no relative motion at all, it
 * just floats in place next to it. */
const createFixedJointDemoAsync = async (x: number) => {
  const anchorId = await createAnchorBodyAsync('physicsJointFixedAnchor', {
    x,
    y: 6,
    z: JOINT_DEMO_Z,
  });
  const boxId = await createDynamicBoxAsync({
    id: 'physicsJointFixedBox',
    position: { x, y: 5, z: JOINT_DEMO_Z },
    color: 0xff8844,
  });
  const joint = await createJoint({
    type: 'FIXED',
    body1Id: anchorId,
    body2Id: boxId,
    anchor1: { x: 0, y: -1, z: 0 },
    frame1: { x: 0, y: 0, z: 0, w: 1 },
    anchor2: { x: 0, y: 0, z: 0 },
    frame2: { x: 0, y: 0, z: 0, w: 1 },
  });
  joint.setContactsEnabled(false);
};

/** REVOLUTE (yellow): a thin arm hinged on its static anchor's Y axis, spun continuously by a
 * velocity motor. */
const createRevoluteJointDemoAsync = async (x: number) => {
  const anchorPos = { x, y: 6, z: JOINT_DEMO_Z };
  const armHalfLength = 1;
  const anchorId = await createAnchorBodyAsync('physicsJointRevoluteAnchor', anchorPos);
  const armId = await createDynamicBoxAsync({
    id: 'physicsJointRevoluteArm',
    position: { x: anchorPos.x + armHalfLength, y: anchorPos.y, z: anchorPos.z },
    color: 0xffee44,
    hx: armHalfLength,
    hy: 0.2,
    hz: 0.2,
  });
  const joint = await createJoint({
    type: 'REVOLUTE',
    body1Id: anchorId,
    body2Id: armId,
    anchor1: { x: 0, y: 0, z: 0 },
    anchor2: { x: -armHalfLength, y: 0, z: 0 },
    axis: { x: 0, y: 1, z: 0 },
  });
  joint.setContactsEnabled(false);
  joint.configureMotorModel('ACCELERATION_BASED');
  joint.configureMotorVelocity(2, 1);
};

/** PRISMATIC (teal): a block sliding vertically along its static anchor's Y axis, bounded by
 * setLimits, with some restitution so it bounces between the two limits. */
const createPrismaticJointDemoAsync = async (x: number) => {
  const anchorPos = { x, y: 8, z: JOINT_DEMO_Z };
  const anchorId = await createAnchorBodyAsync('physicsJointPrismaticAnchor', anchorPos);
  const blockId = await createDynamicBoxAsync({
    id: 'physicsJointPrismaticBlock',
    position: { ...anchorPos },
    color: 0x44ffaa,
    restitution: 0.7,
  });
  const joint = await createJoint({
    type: 'PRISMATIC',
    body1Id: anchorId,
    body2Id: blockId,
    anchor1: { x: 0, y: 0, z: 0 },
    anchor2: { x: 0, y: 0, z: 0 },
    axis: { x: 0, y: 1, z: 0 },
  });
  joint.setContactsEnabled(false);
  joint.setLimits(-4, 0);
};

/** SPHERICAL (purple): a ball swinging freely on all rotational axes (unlike REVOLUTE's single
 * axis), started off-centre on two axes for a conical pendulum. */
const createSphericalJointDemoAsync = async (x: number) => {
  const anchorPos = { x, y: 8, z: JOINT_DEMO_Z };
  const ballPos = { x: x + 2, y: 6, z: JOINT_DEMO_Z + 1 };
  const anchorId = await createAnchorBodyAsync('physicsJointSphericalAnchor', anchorPos);
  const ballId = await createDynamicBallAsync({
    id: 'physicsJointSphericalBall',
    position: ballPos,
    color: 0xaa44ff,
  });
  const joint = await createJoint({
    type: 'SPHERICAL',
    body1Id: anchorId,
    body2Id: ballId,
    anchor1: { x: 0, y: 0, z: 0 },
    anchor2: {
      x: anchorPos.x - ballPos.x,
      y: anchorPos.y - ballPos.y,
      z: anchorPos.z - ballPos.z,
    },
  });
  joint.setContactsEnabled(false);
};

/** ROPE (blue): a ball started closer to its static anchor than the rope's length, so it falls
 * slack before the rope pulls taut. */
const createRopeJointDemoAsync = async (x: number) => {
  const anchorPos = { x, y: 8, z: JOINT_DEMO_Z };
  const anchorId = await createAnchorBodyAsync('physicsJointRopeAnchor', anchorPos);
  const ballId = await createDynamicBallAsync({
    id: 'physicsJointRopeBall',
    position: { x, y: 7, z: JOINT_DEMO_Z },
    color: 0x44aaff,
  });
  const joint = await createJoint({
    type: 'ROPE',
    body1Id: anchorId,
    body2Id: ballId,
    length: 4,
    anchor1: { x: 0, y: 0, z: 0 },
    anchor2: { x: 0, y: 0, z: 0 },
  });
  joint.setContactsEnabled(false);
};

/** SPRING (pink): a ball started well below the spring's rest length, so gravity and the spring
 * bounce it before it settles at the equilibrium. */
const createSpringJointDemoAsync = async (x: number) => {
  const anchorPos = { x, y: 8, z: JOINT_DEMO_Z };
  const anchorId = await createAnchorBodyAsync('physicsJointSpringAnchor', anchorPos);
  const ballId = await createDynamicBallAsync({
    id: 'physicsJointSpringBall',
    position: { x, y: 3, z: JOINT_DEMO_Z },
    color: 0xff44aa,
  });
  const joint = await createJoint({
    type: 'SPRING',
    body1Id: anchorId,
    body2Id: ballId,
    restLength: 2,
    stiffness: 30,
    damping: 2,
    anchor1: { x: 0, y: 0, z: 0 },
    anchor2: { x: 0, y: 0, z: 0 },
  });
  joint.setContactsEnabled(false);
};

/** GENERIC (lime): the joint the others (FIXED, REVOLUTE, PRISMATIC, SPHERICAL) are special cases
 * of. `axesMask` names the axes it locks, in a frame whose x axis is `axis` (world Y here): LinY
 * locks one horizontal translation, and the fall, the other horizontal axis and every rotation
 * stay free. Falling from rest, the box drops straight onto the ground. */
const createGenericJointDemoAsync = async (x: number) => {
  const anchorPos = { x, y: 6, z: JOINT_DEMO_Z };
  const anchorId = await createAnchorBodyAsync('physicsJointGenericAnchor', anchorPos);
  const boxId = await createDynamicBoxAsync({
    id: 'physicsJointGenericBox',
    position: { ...anchorPos },
    color: 0x88ff44,
  });
  const joint = await createJoint({
    type: 'GENERIC',
    body1Id: anchorId,
    body2Id: boxId,
    anchor1: { x: 0, y: 0, z: 0 },
    anchor2: { x: 0, y: 0, z: 0 },
    axis: { x: 0, y: 1, z: 0 },
    axesMask: JointAxesMask.LinY,
  });
  joint.setContactsEnabled(false);
};

/** The joint demos, left to right along the row. */
const JOINT_DEMOS = [
  createFixedJointDemoAsync,
  createRevoluteJointDemoAsync,
  createPrismaticJointDemoAsync,
  createSphericalJointDemoAsync,
  createRopeJointDemoAsync,
  createSpringJointDemoAsync,
  createGenericJointDemoAsync,
];

/**
 * The Physics API's test scene: a static ground box, a falling ball and box over a sensor, one
 * worked example per impulse joint type in a row behind them, and two shape casts against the
 * ground. Built in that order (the order the bodies are created in, which the scene runner's hash
 * depends on).
 */
export const scene = async () => {
  await createGroundAsync();
  startShapeCasts();
  await createFallingBodiesAsync();
  for (const [i, createJointDemoAsync] of JOINT_DEMOS.entries()) {
    await createJointDemoAsync(-21 + 7 * i);
  }
};
