import * as THREE from 'three/webgpu';
import {
  APP_RENDER_SYNC_ORDER,
  ComponentType,
  ECSSystemStage,
  createMaterial,
  createMeshEntity,
  createSceneAppLooper,
  createSeededRandom,
  existsOrThrow,
  getECSWorld,
  getEntityIdByAppId,
  getGeometry,
  getLightByAppId,
  getRootScene,
  lwarn,
  registerOnSceneEnter,
  registerOnSceneExit,
  saveBufferGeometry,
} from 'aekasha';
import type { ECSWorld } from 'aekasha';
import { loadDebugModuleAsync } from 'aekasha/debug';
import { addToMergeGroup, createMergeGroup, updateMergeMember } from 'aekasha/merging';
import { createPhysicsEntity } from 'aekasha/physics';
import { SunShadowFitComponentType } from 'aekasha/toolkit/ecs';

// p375 Phase 0's spike (docs/plans/p375_batched-mesh-batches.md §2): the same field of members,
// 20 geometries and one material, drawn three ways:
// - SEPARATE: a mesh entity per member (the engine's object sync and culling, three's render list);
// - BAKED: the same mesh entities in one p372 merge group (`updateMergeMember` when one moves);
// - BATCHED: one `BatchedMesh`, each member an entity with only a Transform, its matrix written by
//   this scene's sync system in `APP_RENDER_SYNC` when its Transform's version changed (what
//   p375 §3's sync would do, `MAP` storage only: the spike warns in `TYPED_ARRAY` mode);
// - ENGINE (p375 Phase 1's exit, D2): the mesh entities of SEPARATE in one engine batched merge
//   group (`merge: { group, mode: 'BATCHED' }`), which groups them by geometry and draws unsorted
//   whatever `?bmsOrder` and `?bmsSort` say (`?bmsCull` is its `perMemberCulling`).
// The members are placed the same way in every case (seeded); `?bmsOrder=grouped` only changes
// the order they're added in, so a batch's instance ids run by geometry (r187's merged draws).
// `?bmsBodies=kinematic` (SEPARATE and ENGINE) gives each member a kinematic body (a ball),
// moved in `APP_PHYSICS_STEP` by `?bmsMove`'s share per step: deterministic, so the scene
// runner's probe and snapshot cover it.
// The measuring (`_dbg__batchedMeshSpike.ts`) and the page calls (`churn…`) are the debug module's.

export const BMS_SCENE_ID = 'batchedMeshSpike';
const CAMERA_APP_ID = 'bmsCamera';
const SUN_APP_ID = 'bmsSun';
const MATERIAL_ID = 'bmsMaterial';
const GROUP_ID = 'bmsGroup';
/** Metres between two members on the grid, and how far one moves off its grid point */
const SPACING = 3;
const JITTER = 0.8;

export type BmsWay = 'SEPARATE' | 'BAKED' | 'BATCHED' | 'ENGINE';
/** The members' bodies: none, or a kinematic one each (SEPARATE and ENGINE) */
export type BmsBodies = 'NONE' | 'KINEMATIC';
/** The order the members are added in: the grid's (geometries interleaved) or by geometry */
export type BmsOrder = 'RANDOM' | 'GROUPED';
/** A batch's sort: three's depth sort (the default), none, or by geometry range then depth */
export type BmsSort = 'DEPTH' | 'NONE' | 'RANGE';
/** Over the whole field, or inside it looking along it (most members out of view) */
export type BmsCamera = 'OVER' | 'INSIDE';

/** The settings, from the URL at every load */
export const bmsSettings = {
  way: 'SEPARATE' as BmsWay,
  count: 2000,
  geometries: 20,
  order: 'RANDOM' as BmsOrder,
  sort: 'DEPTH' as BmsSort,
  /** A batch's `perObjectFrustumCulled` */
  cull: true,
  /** The share of members moved each frame (0 to 1), a block of them round-robin */
  move: 0,
  shadow: false,
  bodies: 'NONE' as BmsBodies,
  camera: 'OVER' as BmsCamera,
  /** A batch's members coloured by geometry (`setColorAt`) */
  colors: false,
  /** A batch's every Nth member hidden (`setVisibleAt`); 0: none */
  hidden: 0,
};

/** A member: its entity, its geometry's index, its place, and in a batch its instance id */
export type BmsMember = {
  entityId: number;
  geometry: number;
  base: THREE.Vector3;
  yaw: number;
  scale: number;
  instanceId: number;
  /** The Transform version last written to the batch (-1: write it) */
  lastVersion: number;
};

/** What the last load built, for the debug module */
export const bmsState = {
  members: [] as BmsMember[],
  batch: null as THREE.BatchedMesh | null,
  /** The batch's geometry id per geometry index */
  batchGeometryIds: [] as number[],
  geometries: [] as THREE.BufferGeometry[],
  /** The members' sync's last frame: matrices written */
  synced: 0,
  /** Frames the mover waited for a baked group's first build */
  moveWaitFrames: 0,
};

const exitTasks: (() => void)[] = [];
/** Runs `fn` when this load of the scene exits (registerOnSceneExit keeps one function a scene). */
export const onBmsExit = (fn: () => void) => {
  exitTasks.push(fn);
};

const pick = <T extends string>(value: string | null | undefined, options: readonly T[]) =>
  options.find((option) => option === value?.toUpperCase());

const readUrlOverrides = () => {
  const params = new URLSearchParams(window.location.search);
  const s = bmsSettings;
  s.way =
    pick(params.get('bmsWay'), ['SEPARATE', 'BAKED', 'BATCHED', 'ENGINE'] as const) ?? 'SEPARATE';
  s.order = pick(params.get('bmsOrder'), ['RANDOM', 'GROUPED'] as const) ?? 'RANDOM';
  s.sort = pick(params.get('bmsSort'), ['DEPTH', 'NONE', 'RANGE'] as const) ?? 'DEPTH';
  s.camera = pick(params.get('bmsCamera'), ['OVER', 'INSIDE'] as const) ?? 'OVER';
  const count = Number(params.get('bmsCount'));
  s.count = count > 0 ? Math.min(Math.round(count), 50_000) : 2000;
  s.cull = params.get('bmsCull') !== 'false';
  const move = Number(params.get('bmsMove'));
  s.move = move > 0 ? Math.min(move, 1) : 0;
  s.shadow = params.get('bmsShadow') === 'true';
  s.colors = params.get('bmsColors') === 'true';
  const hidden = Number(params.get('bmsHidden'));
  s.hidden = hidden > 1 ? Math.round(hidden) : 0;
  s.bodies = pick(params.get('bmsBodies'), ['NONE', 'KINEMATIC'] as const) ?? 'NONE';
  if (s.bodies !== 'NONE' && s.way !== 'SEPARATE' && s.way !== 'ENGINE') {
    lwarn(`BatchedMesh spike: ?bmsBodies is for the separate and engine ways, not ${s.way}.`);
    s.bodies = 'NONE';
  }
};

/** A lathe's profile: a vase */
const VASE = [0.3, 0.45, 0.5, 0.35, 0.2, 0.25, 0.35, 0.3].map(
  (r, i) => new THREE.Vector2(r, i * 0.2 - 0.7)
);

/** 20 indexed geometries of 400 to 1,100 triangles, each about a metre, with the same attributes
 * (position, normal, uv): a batch takes them all */
const GEOMETRY_MAKERS: (() => THREE.BufferGeometry)[] = [
  () => new THREE.BoxGeometry(1, 1, 1, 8, 8, 8),
  () => new THREE.BoxGeometry(1.4, 0.6, 0.8, 10, 6, 6),
  () => new THREE.SphereGeometry(0.6, 24, 16),
  () => new THREE.SphereGeometry(0.5, 32, 12),
  () => new THREE.CylinderGeometry(0.5, 0.5, 1.2, 24, 8),
  () => new THREE.CylinderGeometry(0.3, 0.6, 1.4, 32, 6),
  () => new THREE.ConeGeometry(0.6, 1.3, 32, 8),
  () => new THREE.ConeGeometry(0.4, 1.6, 20, 12),
  () => new THREE.TorusGeometry(0.5, 0.18, 12, 32),
  () => new THREE.TorusGeometry(0.45, 0.1, 8, 48),
  () => new THREE.TorusKnotGeometry(0.4, 0.12, 64, 8),
  () => new THREE.TorusKnotGeometry(0.35, 0.1, 48, 8, 3, 4),
  () => new THREE.CapsuleGeometry(0.35, 0.7, 8, 16),
  () => new THREE.CapsuleGeometry(0.25, 1.0, 6, 24),
  () => new THREE.CylinderGeometry(0.6, 0.6, 0.4, 40, 4),
  () => new THREE.SphereGeometry(0.6, 20, 20, 0, Math.PI * 2, 0, Math.PI / 2),
  () => new THREE.LatheGeometry(VASE, 24),
  () => new THREE.BoxGeometry(0.5, 1.6, 0.5, 4, 12, 4),
  () => new THREE.ConeGeometry(0.7, 0.8, 6, 16),
  () => new THREE.TorusGeometry(0.4, 0.25, 16, 24),
];

/** The geometries, registered once (a reload finds them) */
const createGeometries = () =>
  GEOMETRY_MAKERS.slice(0, bmsSettings.geometries).map((make, i) => {
    const id = `bmsGeo${i}`;
    return getGeometry(id) ?? saveBufferGeometry(make(), { id });
  });

/** The members' places and geometries, the same on every load; in the order they're added */
const createPlacements = () => {
  const { count, geometries, order } = bmsSettings;
  const side = Math.ceil(Math.sqrt(count));
  const half = ((side - 1) * SPACING) / 2;
  const random = createSeededRandom(375);
  const members: BmsMember[] = [];
  for (let i = 0; i < count; i++) {
    const base = new THREE.Vector3(
      (i % side) * SPACING - half + (random() * 2 - 1) * JITTER,
      0.8,
      Math.floor(i / side) * SPACING - half + (random() * 2 - 1) * JITTER
    );
    members.push({
      entityId: -1,
      geometry: Math.floor(random() * geometries),
      base,
      yaw: random() * Math.PI * 2,
      scale: 0.8 + random() * 0.4,
      instanceId: -1,
      lastVersion: -1,
    });
  }
  // A stable sort: the grid's order within each geometry
  if (order === 'GROUPED') members.sort((a, b) => a.geometry - b.geometry);
  return members;
};

const UP = new THREE.Vector3(0, 1, 0);
const _quaternion = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _matrix = new THREE.Matrix4();

/** SEPARATE, BAKED and ENGINE: a mesh entity per member (BAKED: all in one merge group; ENGINE:
 * each joining one batched group by its `merge`, at the scene step) */
const createMeshMembers = (members: BmsMember[], material: THREE.Material) => {
  const { shadow, way, cull } = bmsSettings;
  const geometries = bmsState.geometries;
  if (way === 'ENGINE') {
    createMergeGroup({
      id: GROUP_ID,
      mode: 'BATCHED',
      perMemberCulling: cull,
      castShadow: shadow,
      receiveShadow: shadow,
    });
  }
  for (const m of members) {
    m.entityId = createMeshEntity({
      geo: geometries[m.geometry],
      mat: material,
      position: m.base,
      rotation: { y: m.yaw },
      scale: { x: m.scale, y: m.scale, z: m.scale },
      castShadow: shadow,
      receiveShadow: shadow,
      ...(way === 'ENGINE' ? { merge: { group: GROUP_ID, mode: 'BATCHED' as const } } : {}),
    });
  }
  if (way === 'BAKED') {
    createMergeGroup({ id: GROUP_ID, castShadow: shadow, receiveShadow: shadow });
    addToMergeGroup(
      GROUP_ID,
      members.map((m) => m.entityId)
    );
  }
};

/** The batch's custom sort (`?bmsSort=range`): by geometry range, then front to back, so equal
 * ranges are adjacent and merge into one draw (r187) */
const sortByRange = (list: { start: number; count: number; z: number }[]) => {
  list.sort((a, b) => a.start - b.start || a.z - b.z);
};

/** Colours a batch member by its geometry (`?bmsColors=true`) */
const _color = new THREE.Color();
export const colorBmsMember = (batch: THREE.BatchedMesh, m: BmsMember) => {
  _color.setHSL(m.geometry / bmsSettings.geometries, 0.6, 0.55);
  batch.setColorAt(m.instanceId, _color);
};

/** Writes a member's place into the batch from its Transform */
export const writeBmsMatrix = (world: ECSWorld, batch: THREE.BatchedMesh, m: BmsMember) => {
  const t = world.getComponent(m.entityId, ComponentType.TRANSFORM);
  if (!t) return;
  _matrix.compose(t.position, t.quaternion, t.scale);
  batch.setMatrixAt(m.instanceId, _matrix);
  m.lastVersion = t.version;
};

/** BATCHED: one BatchedMesh with room for a tenth more members and geometries (the churn's) */
const createBatchMembers = (world: ECSWorld, members: BmsMember[], material: THREE.Material) => {
  const { shadow, sort, cull, colors, hidden } = bmsSettings;
  const geometries = bmsState.geometries;
  let vertices = 0;
  let indices = 0;
  for (const g of geometries) {
    vertices += g.getAttribute('position').count;
    indices += g.getIndex()!.count;
  }
  const batch = new THREE.BatchedMesh(
    Math.ceil(members.length * 1.1),
    Math.ceil(vertices * 1.5),
    Math.ceil(indices * 1.5),
    material
  );
  batch.name = 'bmsBatch';
  batch.castShadow = shadow;
  batch.receiveShadow = shadow;
  // Its members move: three's whole-mesh culling would need its bounds kept (p375 §3's job)
  batch.frustumCulled = false;
  batch.perObjectFrustumCulled = cull;
  batch.sortObjects = sort !== 'NONE';
  if (sort === 'RANGE') batch.setCustomSort(sortByRange);
  bmsState.batchGeometryIds = geometries.map((g) => batch.addGeometry(g));
  for (let i = 0; i < members.length; i++) {
    const m = members[i];
    m.entityId = world.createEntity();
    const t = world.getComponent(m.entityId, ComponentType.TRANSFORM)!;
    t.position.copy(m.base);
    t.quaternion.setFromAxisAngle(UP, m.yaw);
    t.scale.setScalar(m.scale);
    t.setDirty();
    world.commitTransform(m.entityId, t);
    m.instanceId = batch.addInstance(bmsState.batchGeometryIds[m.geometry]);
    writeBmsMatrix(world, batch, m);
    if (colors) colorBmsMember(batch, m);
    if (hidden && i % hidden === 0) batch.setVisibleAt(m.instanceId, false);
  }
  getRootScene()?.add(batch);
  bmsState.batch = batch;
  onBmsExit(() => {
    batch.removeFromParent();
    batch.dispose();
  });
  startBatchSync(world, batch, members);
};

const SYNC_SYSTEM_ID = 'bmsBatchSync';

/** The batch's members' sync (`APP_RENDER_SYNC`, a pose producer: after the interpolated poses
 * would be final): a matrix per member whose Transform's version changed. No allocation. */
const startBatchSync = (world: ECSWorld, batch: THREE.BatchedMesh, members: BmsMember[]) => {
  if (world.getTypedTransformStore()) {
    lwarn('BatchedMesh spike: TYPED_ARRAY storage: the batch sync reads MAP versions only.');
  }
  world.addSystem(
    ECSSystemStage.APP_RENDER_SYNC,
    SYNC_SYSTEM_ID,
    () => {
      const transforms = world.getStorage(ComponentType.TRANSFORM);
      let synced = 0;
      for (let i = 0; i < members.length; i++) {
        const m = members[i];
        if (m.instanceId < 0) continue;
        const t = transforms.get(m.entityId);
        if (!t || t.version === m.lastVersion) continue;
        _quaternion.copy(t.quaternion);
        _scale.copy(t.scale);
        _matrix.compose(t.position, _quaternion, _scale);
        batch.setMatrixAt(m.instanceId, _matrix);
        m.lastVersion = t.version;
        synced++;
      }
      bmsState.synced = synced;
    },
    APP_RENDER_SYNC_ORDER.POSE_PRODUCERS
  );
  onBmsExit(() => world.removeSystem(SYNC_SYSTEM_ID));
};

/** `?bmsMove=`: a block of members each frame, round-robin, each swaying up to half a metre
 * along x from its place by the scene's time (BAKED: rewritten in place) */
const startMoving = (world: ECSWorld, members: BmsMember[]) => {
  const perFrame = Math.max(1, Math.round(members.length * bmsSettings.move));
  const isBaked = bmsSettings.way === 'BAKED';
  const pose = { pos: { x: 0, y: 0, z: 0 } };
  let cursor = 0;
  let time = 0;
  bmsState.moveWaitFrames = 0;
  createSceneAppLooper((delta) => {
    // BAKED: not before the group's first build (an update drops a running worker build, so
    // members moved every frame from the load on kept it from ever finishing)
    if (
      isBaked &&
      !(world.getComponent(members[0].entityId, ComponentType.MERGE_MEMBER)!.partIndex >= 0)
    ) {
      bmsState.moveWaitFrames++;
      return;
    }
    time += delta;
    for (let n = 0; n < perFrame; n++) {
      const m = members[cursor];
      cursor = (cursor + 1) % members.length;
      pose.pos.x = m.base.x + Math.sin(time * 2 + cursor) * 0.5;
      pose.pos.y = m.base.y;
      pose.pos.z = m.base.z;
      world.setTransform(m.entityId, pose);
      if (isBaked) updateMergeMember(m.entityId, world);
    }
  }, BMS_SCENE_ID);
};

/** `?bmsBodies=kinematic`: a kinematic ball per member, at its place (plain data: the worker
 * target clones it). Started before any await, so an ENGINE member waits for its body to join
 * (merging keeps a mesh whose physics creation is pending queued). */
const createKinematicBodiesAsync = (members: BmsMember[]) =>
  Promise.all(
    members.map((m) => {
      _quaternion.setFromAxisAngle(UP, m.yaw);
      return createPhysicsEntity({
        colliders: { type: 'BALL', radius: 0.5 * m.scale },
        body: {
          rigidType: 'POS_BASED',
          translation: { x: m.base.x, y: m.base.y, z: m.base.z },
          rotation: { x: _quaternion.x, y: _quaternion.y, z: _quaternion.z, w: _quaternion.w },
        },
        target: m.entityId,
      });
    })
  );

const BODY_MOVER_ID = 'bmsBodyMover';

/** `?bmsBodies=kinematic` with `?bmsMove=`: a block of bodies each fixed step, round-robin, each
 * swaying up to half a metre along x by the steps' time (deterministic: step time, no frame time) */
const startMovingBodies = (world: ECSWorld, members: BmsMember[]) => {
  const perStep = Math.max(1, Math.round(members.length * bmsSettings.move));
  const bodies = members.map((m) =>
    existsOrThrow(world.getRigidBody(m.entityId), `BatchedMesh spike: no body for ${m.entityId}.`)
  );
  const target = { x: 0, y: 0, z: 0 };
  let cursor = 0;
  let time = 0;
  world.addSystem(ECSSystemStage.APP_PHYSICS_STEP, BODY_MOVER_ID, (_world, dt) => {
    time += dt;
    for (let n = 0; n < perStep; n++) {
      const m = members[cursor];
      const body = bodies[cursor];
      cursor = (cursor + 1) % members.length;
      target.x = m.base.x + Math.sin(time * 2 + cursor) * 0.5;
      target.y = m.base.y;
      target.z = m.base.z;
      body.setNextKinematicTranslation(target);
    }
  });
  onBmsExit(() => world.removeSystem(BODY_MOVER_ID));
};

/** Over the field, or in its middle looking along +x */
const placeCamera = (world: ECSWorld) => {
  const cameraId = getEntityIdByAppId(CAMERA_APP_ID, world);
  if (cameraId === undefined) {
    lwarn(`BatchedMesh spike: no camera '${CAMERA_APP_ID}'.`);
    return;
  }
  const eye = new THREE.PerspectiveCamera();
  if (bmsSettings.camera === 'OVER') {
    eye.position.set(0, 95, 110);
    eye.lookAt(0, 0, 0);
  } else {
    eye.position.set(0, 3, 0);
    eye.lookAt(60, 1, 0);
  }
  world.setTransform(cameraId, {
    pos: { x: eye.position.x, y: eye.position.y, z: eye.position.z },
    rot: eye.quaternion,
  });
};

/** `?bmsShadow=true`: the sun's shadow fitted to the view, and a ground to catch it */
const startSunShadow = (world: ECSWorld) => {
  const sun = getLightByAppId(SUN_APP_ID, world);
  const sunId = getEntityIdByAppId(SUN_APP_ID, world);
  const rootScene = getRootScene();
  if (!sun || sunId === undefined || !rootScene) return;
  sun.castShadow = true;
  world.addComponent(sunId, SunShadowFitComponentType.SUN_SHADOW_FIT, {
    maxDistance: 200,
    casterExtension: 10,
  });
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(300, 300).rotateX(-Math.PI / 2),
    new THREE.MeshLambertNodeMaterial({ color: '#6f7d4f' })
  );
  ground.receiveShadow = true;
  rootScene.add(ground);
  onBmsExit(() => {
    ground.removeFromParent();
    ground.geometry.dispose();
    ground.material.dispose();
  });
};

export const scene = async () => {
  const world = getECSWorld();
  exitTasks.length = 0;
  registerOnSceneExit(BMS_SCENE_ID, () => {
    for (const task of exitTasks.splice(0)) task();
  });
  readUrlOverrides();
  registerOnSceneEnter(BMS_SCENE_ID, () => {
    placeCamera(world);
    if (bmsSettings.shadow) startSunShadow(world);
  });

  const material = createMaterial({
    id: MATERIAL_ID,
    type: 'STANDARD',
    params: { color: '#c9c4bb', roughness: 0.6, metalness: 0 },
  });
  bmsState.geometries = createGeometries();
  bmsState.batch = null;
  bmsState.batchGeometryIds = [];
  const members = createPlacements();
  bmsState.members = members;
  if (bmsSettings.way === 'BATCHED') createBatchMembers(world, members, material);
  else createMeshMembers(members, material);
  if (bmsSettings.bodies === 'KINEMATIC') {
    await createKinematicBodiesAsync(members);
    if (bmsSettings.move > 0) startMovingBodies(world, members);
  } else if (bmsSettings.move > 0) {
    startMoving(world, members);
  }

  // In prod test mode too, as instanceStress's probe
  const probe = await loadDebugModuleAsync(
    () => import('./_dbg__batchedMeshSpike'),
    true,
    'BatchedMesh spike probe'
  );
  await probe?.current?.installBmsProbe(world);
};
