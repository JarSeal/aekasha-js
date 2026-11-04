import * as THREE from 'three/webgpu';
import { createMeshEntity, existsOrThrow, getMaterial, getMeshByAppId } from 'aekasha';
import { createPhysicsEntity } from 'aekasha/physics';

// The game HUD example's arena: a walled floor, four dynamic crates to shoot at, three NPCs
// (Mara, whom the player talks to, and two who say a line as the player passes), the beacon in
// the north-west corner the waypoint leads to, and a fire pit that burns the player's health.

type Vec3 = [x: number, y: number, z: number];

/** A crate of the level: its entity, its mesh (the fire raycast's target) and its material */
export type GameHudCrate = {
  entityId: number;
  mesh: THREE.Mesh;
  material: THREE.MeshStandardMaterial;
};

/** An NPC: its entity (its nameplate's), where it stands and its name's colour */
export type GameHudNpc = {
  id: 'mara' | 'ivo' | 'pell';
  name: string;
  color: string;
  entityId: number;
  position: THREE.Vector3;
};

/** What the level made, for the HUD and the game's logic */
export type GameHudLevel = {
  crates: GameHudCrate[];
  npcs: GameHudNpc[];
  beacon: { entityId: number; position: THREE.Vector3; material: THREE.MeshStandardMaterial };
  /** The fire pit's square on the ground: x and z from its centre, each `halfSize` out */
  firePit: { x: number; z: number; halfSize: number };
};

const GREY = '#59606e';
const DARK = '#474d59';
const CRATE = '#b5793f';
const NPCS: { id: GameHudNpc['id']; name: string; color: string; at: Vec3 }[] = [
  { id: 'mara', name: 'Mara', color: '#e8833a', at: [-3, 0, 0] },
  { id: 'ivo', name: 'Ivo', color: '#6bb3e8', at: [8, 0, -6] },
  { id: 'pell', name: 'Pell', color: '#b37be0', at: [-8, 0, 7] },
];
const CRATES: Vec3[] = [
  [3, 0.5, -4],
  [4.2, 0.5, -4.6],
  [-6, 0.5, -3],
  [10, 0.5, 2],
];
const BEACON_AT: Vec3 = [-11, 0, -11];
const FIRE_PIT = { x: 7, z: 6, halfSize: 1.5 };

const getStandardMaterial = (id: string) =>
  existsOrThrow(getMaterial(id), `No material ${id}`) as THREE.MeshStandardMaterial;

/** A box mesh with a FIXED box body of its size */
const createWall = async (size: Vec3, at: Vec3, color: string) => {
  const [width, height, depth] = size;
  const [x, y, z] = at;
  const entityId = createMeshEntity({
    geo: {
      id: `exampleGameHudBox_${width}_${height}_${depth}`,
      type: 'BOX',
      params: { width, height, depth },
    },
    mat: { id: `exampleGameHud_${color}`, type: 'STANDARD', params: { color } },
    position: { x, y, z },
    castShadow: true,
    receiveShadow: true,
  });
  await createPhysicsEntity(
    { type: 'BOX', hx: width / 2, hy: height / 2, hz: depth / 2 },
    { rigidType: 'FIXED', translation: { x, y, z } },
    entityId
  );
};

/** A crate: a DYNAMIC body the player pushes and the shots knock, a material each (a broken
 * one goes dark) */
const createCrate = async ([x, y, z]: Vec3, index: number): Promise<GameHudCrate> => {
  const appId = `exampleGameHudCrate${index}`;
  const entityId = createMeshEntity(
    {
      geo: { id: 'exampleGameHudCrate', type: 'BOX', params: { width: 1, height: 1, depth: 1 } },
      mat: { id: appId, type: 'STANDARD', params: { color: CRATE } },
      position: { x, y, z },
      castShadow: true,
      receiveShadow: true,
    },
    { appId }
  );
  await createPhysicsEntity(
    { type: 'BOX', hx: 0.5, hy: 0.5, hz: 0.5 },
    { rigidType: 'DYNAMIC', translation: { x, y, z } },
    entityId
  );
  const material = getStandardMaterial(appId);
  // A material outlives a visit: each one starts whole
  material.color.set(CRATE);
  return {
    entityId,
    mesh: existsOrThrow(getMeshByAppId(appId), `No crate mesh ${appId}`) as THREE.Mesh,
    material,
  };
};

/** An NPC: a capsule with a FIXED box body round it, so the player walks round it */
const createNpc = async ({ id, name, color, at: [x, , z] }: (typeof NPCS)[number]) => {
  const entityId = createMeshEntity({
    geo: {
      id: 'exampleGameHudNpc',
      type: 'CAPSULE',
      params: { radius: 0.45, height: 0.8, capSegments: 8, radialSegments: 20 },
    },
    mat: { id: `exampleGameHudNpc_${id}`, type: 'STANDARD', params: { color } },
    position: { x, y: 0.85, z },
    castShadow: true,
    receiveShadow: true,
  });
  await createPhysicsEntity(
    { type: 'BOX', hx: 0.45, hy: 0.85, hz: 0.45 },
    { rigidType: 'FIXED', translation: { x, y: 0.85, z } },
    entityId
  );
  return { id, name, color, entityId, position: new THREE.Vector3(x, 0, z) };
};

/** The beacon: a pillar whose top lights up when the player reaches it */
const createBeacon = async () => {
  const [x, , z] = BEACON_AT;
  const entityId = createMeshEntity({
    geo: {
      id: 'exampleGameHudBeacon',
      type: 'CYLINDER',
      params: { radiusTop: 0.35, radiusBottom: 0.6, height: 3, radialSegments: 8 },
    },
    mat: {
      id: 'exampleGameHudBeacon',
      type: 'STANDARD',
      params: { color: '#d9c27a', emissive: '#000000' },
    },
    position: { x, y: 1.5, z },
    castShadow: true,
  });
  await createPhysicsEntity(
    { type: 'BOX', hx: 0.6, hy: 1.5, hz: 0.6 },
    { rigidType: 'FIXED', translation: { x, y: 1.5, z } },
    entityId
  );
  const material = getStandardMaterial('exampleGameHudBeacon');
  material.emissive.set('#000000');
  return { entityId, position: new THREE.Vector3(x, 0, z), material };
};

/** The fire pit: drawn only (the game reads the player's position against its square) */
const createFirePit = () =>
  createMeshEntity({
    geo: {
      id: 'exampleGameHudFirePit',
      type: 'BOX',
      params: { width: FIRE_PIT.halfSize * 2, height: 0.04, depth: FIRE_PIT.halfSize * 2 },
    },
    mat: {
      id: 'exampleGameHudFirePit',
      type: 'STANDARD',
      params: { color: '#c2410c', emissive: '#7c2d12' },
    },
    position: { x: FIRE_PIT.x, y: 0.02, z: FIRE_PIT.z },
    receiveShadow: true,
  });

/**
 * Builds the arena. Every body is requested at once and awaited together: a create sends its
 * body before its first await, so the bodies are made in this order on every visit.
 */
export const createGameHudLevelAsync = async (): Promise<GameHudLevel> => {
  createFirePit();
  const [crates, npcs, beacon] = await Promise.all([
    Promise.all(CRATES.map(createCrate)),
    Promise.all(NPCS.map(createNpc)),
    createBeacon(),
    createWall([30, 0.5, 30], [0, -0.25, 0], GREY),
    createWall([31, 1, 0.5], [0, 0.5, -15.25], DARK),
    createWall([31, 1, 0.5], [0, 0.5, 15.25], DARK),
    createWall([0.5, 1, 30], [-15.25, 0.5, 0], DARK),
    createWall([0.5, 1, 30], [15.25, 0.5, 0], DARK),
  ]);
  return { crates, npcs, beacon, firePit: FIRE_PIT };
};
