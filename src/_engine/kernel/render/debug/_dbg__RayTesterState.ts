// The ray testers' state (p806 D11: out of _dbg__RayTester.ts): the params' types and defaults,
// each kind's state for the current scene, the last fire's results, and the per-scene saves in LS.
import { getCurrentSceneId } from '../../scene/Scene';
import { updateDraggableWindow } from '../../../ui/overlays/windows/DraggableWindow';
import { lsGetItem, lsRemoveItem, lsSetItem } from '../../../utils/LocalAndSessionStorage';
import { confirmClearScope } from '../../../debug/_dbg__ClearLSButtons';
import { QueryFilterFlags } from '../../../features/physics/types/PhysicsQueryTypes';
import type { RayHelperKind } from '../RayDebugTypes';

export type RayTesterKind = RayHelperKind;

export type Vec3 = { x: number; y: number; z: number };

/** DIRECTION: origin + dir (normalized on fire). TARGET_POINT: origin → point. CAMERA_FORWARD:
 * origin and dir are taken from the active camera at fire time. Every mode keeps its own
 * values, so switching modes loses nothing. */
export type RayAimMode = 'DIRECTION' | 'TARGET_POINT' | 'CAMERA_FORWARD';
type RayAim = { mode: RayAimMode; dir: Vec3; point: Vec3 };
/** The part of the ray params every kind has */
export type AimedRay = { origin: Vec3; aim: RayAim };

/** KIND follows the kind's "Respect depth" setting (Ray cast controls tab) */
export type RayTesterDepthTest = 'KIND' | 'ON' | 'OFF';

export type RayTesterHelperParams = {
  color: string;
  inactiveColor: string;
  width: number;
  holdMs: number;
  depthTest: RayTesterDepthTest;
};

export type ThreeRayTargetType = 'CURRENT_SCENE' | 'ENTITY';

export type ThreeRayParams = AimedRay & {
  near: number;
  far: number;
  recursive: boolean;
  target: { type: ThreeRayTargetType; appId: string };
  helper: RayTesterHelperParams;
};

export type PhysicsRayQuery = 'CAST_RAY' | 'CAST_RAY_AND_GET_NORMAL' | 'INTERSECTIONS_WITH_RAY';

/** One checkbox per QueryFilterFlags bit (the ONLY_* flags are combinations of these) */
export type PhysicsRayFilterFlags = {
  excludeFixed: boolean;
  excludeKinematic: boolean;
  excludeDynamic: boolean;
  excludeSensors: boolean;
  excludeSolids: boolean;
};

export type PhysicsRayParams = AimedRay & {
  query: PhysicsRayQuery;
  maxToi: number;
  solid: boolean;
  filterFlags: PhysicsRayFilterFlags;
  useFilterGroups: boolean;
  filterGroups: number;
  /** An entity whose rigid body (or single collider) the ray ignores, empty for none */
  excludeAppId: string;
  helper: RayTesterHelperParams;
};

type RayTesterState<P> = { version: 1; rays: P[]; activeIndex: number };

/** The entity a hit resolved to, as plain data */
export type HitEntityInfo = {
  entityId: number | null;
  appId: string | null;
  /** False for generated app ids, which change on every reload */
  appIdIsFixed: boolean;
};

/** One hit as plain data (no object references), ready to show and to copy as JSON */
export type ThreeHitRow = HitEntityInfo & {
  distance: number;
  point: Vec3;
  /** Face normal in world space */
  normal: Vec3 | null;
  objectName: string;
  objectType: string;
  instanceId: number | null;
};

export type PhysicsHitRow = HitEntityInfo & {
  /** Time of impact: the distance, as the tester's ray direction is normalized */
  toi: number;
  point: Vec3;
  /** Null for CAST_RAY, which returns no normal */
  normal: Vec3 | null;
  colliderId: number;
  bodyId: number | null;
};

export type RayTesterResult<H> = {
  error?: string;
  /** The ray as cast (null when its aim couldn't be resolved) */
  ray: { origin: Vec3; dir: Vec3 } | null;
  hits: H[];
};

export const WINDOW_IDS: Record<RayTesterKind, string> = {
  THREE: 'debugRayTesterThree',
  PHYSICS: 'debugRayTesterPhysics',
};
export const WINDOW_TITLES: Record<RayTesterKind, string> = {
  THREE: 'Three.js ray tester',
  PHYSICS: 'Physics ray tester',
};

/** Every membership and filter bit: interacts with every group */
export const ALL_INTERACTION_GROUPS = 0xffffffff;

export const FILTER_FLAG_BITS: Record<keyof PhysicsRayFilterFlags, QueryFilterFlags> = {
  excludeFixed: QueryFilterFlags.EXCLUDE_FIXED,
  excludeKinematic: QueryFilterFlags.EXCLUDE_KINEMATIC,
  excludeDynamic: QueryFilterFlags.EXCLUDE_DYNAMIC,
  excludeSensors: QueryFilterFlags.EXCLUDE_SENSORS,
  excludeSolids: QueryFilterFlags.EXCLUDE_SOLIDS,
};

// Defaults: straight down from above the origin. Apart from the kinds' default helper colors,
// so tester rays stand out from gameplay rays.
const createAim = (): AimedRay => ({
  origin: { x: 0, y: 5, z: 0 },
  aim: { mode: 'DIRECTION', dir: { x: 0, y: -1, z: 0 }, point: { x: 0, y: 0, z: 0 } },
});

const createHelperParams = (color: string, inactiveColor: string): RayTesterHelperParams => ({
  color,
  inactiveColor,
  width: 4,
  holdMs: 3000,
  depthTest: 'KIND',
});

const createThreeRayParams = (): ThreeRayParams => ({
  ...createAim(),
  near: 0,
  far: 100,
  recursive: true,
  target: { type: 'CURRENT_SCENE', appId: '' },
  helper: createHelperParams('#ffd60a', '#7a6a1f'),
});

const createPhysicsRayParams = (): PhysicsRayParams => ({
  ...createAim(),
  query: 'CAST_RAY_AND_GET_NORMAL',
  maxToi: 100,
  solid: true,
  filterFlags: {
    excludeFixed: false,
    excludeKinematic: false,
    excludeDynamic: false,
    excludeSensors: false,
    excludeSolids: false,
  },
  useFilterGroups: false,
  filterGroups: ALL_INTERACTION_GROUPS,
  excludeAppId: '',
  helper: createHelperParams('#bf5af2', '#5b2d73'),
});

const createState = <P>(createParams: () => P): RayTesterState<P> => ({
  version: 1,
  rays: [createParams()],
  activeIndex: 0,
});

type RayTesterParamsByKind = { THREE: ThreeRayParams; PHYSICS: PhysicsRayParams };
type LoadedState<P> = { sceneId: string | null; state: RayTesterState<P> };

const CREATE_PARAMS: { [K in RayTesterKind]: () => RayTesterParamsByKind[K] } = {
  THREE: createThreeRayParams,
  PHYSICS: createPhysicsRayParams,
};

/** Each kind's state, and the scene it was loaded for */
const loadedStates: { [K in RayTesterKind]: LoadedState<RayTesterParamsByKind[K]> | null } = {
  THREE: null,
  PHYSICS: null,
};

/**
 * A kind's state for the current scene: loaded from LS (merged over the defaults) the first
 * time it's read in a scene. The first scene is entered before the debug GUIs exist, so this
 * lazy check, not only the scene enter hook, is what applies each scene's saved params.
 */
const getTesterState = <K extends RayTesterKind>(
  kind: K
): RayTesterState<RayTesterParamsByKind[K]> => {
  const sceneId = getCurrentSceneId() ?? null;
  const loaded = loadedStates[kind];
  if (loaded && loaded.sceneId === sceneId) return loaded.state;
  const next = { sceneId, state: readTesterState(kind, sceneId) };
  loadedStates[kind] = next as (typeof loadedStates)[K];
  return next.state;
};
export const getThreeState = () => getTesterState('THREE');
export const getPhysicsState = () => getTesterState('PHYSICS');

/** The last fire's results per kind (not persisted), and whether the physics queries are in
 * flight (≥1 frame in WORKER_THREAD mode). A scene enter clears them. */
export const testerResults: {
  three: RayTesterResult<ThreeHitRow>[] | null;
  physics: RayTesterResult<PhysicsHitRow>[] | null;
  isPhysicsFiring: boolean;
} = { three: null, physics: null, isPhysicsFiring: false };

// ----------------------------------------------------------------------------
// Per-scene persistence
// ----------------------------------------------------------------------------

export const RAY_TESTER_LS_KEY = 'AEK_debugRayTester';
const LS_FIELDS = { THREE: 'three', PHYSICS: 'physics' } as const satisfies Record<
  RayTesterKind,
  string
>;
type RayTesterSceneLSData = {
  three?: RayTesterState<ThreeRayParams>;
  physics?: RayTesterState<PhysicsRayParams>;
};
type RayTesterLSData = { [sceneId: string]: RayTesterSceneLSData };

const readLS = () => (lsGetItem(RAY_TESTER_LS_KEY, {}) as RayTesterLSData | null) || {};

const writeLS = (data: RayTesterLSData) => {
  if (Object.keys(data).length) lsSetItem(RAY_TESTER_LS_KEY, data);
  else lsRemoveItem(RAY_TESTER_LS_KEY);
};

/** A kind's saved state for a scene, merged over the defaults, or the defaults. */
const readTesterState = <K extends RayTesterKind>(
  kind: K,
  sceneId: string | null
): RayTesterState<RayTesterParamsByKind[K]> => {
  const createParams = CREATE_PARAMS[kind] as () => RayTesterParamsByKind[K];
  const saved = sceneId ? readLS()[sceneId]?.[LS_FIELDS[kind]] : undefined;
  if (saved?.version !== 1 || !Array.isArray(saved.rays) || !saved.rays.length) {
    return createState(createParams);
  }
  const rays = saved.rays.map((ray: unknown) => mergeOverDefaults(createParams(), ray));
  const activeIndex = Number.isInteger(saved.activeIndex) ? saved.activeIndex : 0;
  return { version: 1, rays, activeIndex: Math.min(Math.max(activeIndex, 0), rays.length - 1) };
};

/** Copies the saved values whose type matches the default's, recursing into objects: fields
 * added later get their defaults, and removed or retyped ones are dropped. */
const mergeOverDefaults = <T extends object>(defaults: T, saved: unknown): T => {
  if (!isPlainObject(saved)) return defaults;
  const target = defaults as Record<string, unknown>;
  for (const key of Object.keys(target)) {
    const def = target[key];
    const value = saved[key];
    if (isPlainObject(def)) {
      target[key] = mergeOverDefaults(def, value);
    } else if (typeof value === typeof def && value !== null) {
      target[key] = value;
    }
  }
  return defaults;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Saves a kind's state under the scene it was loaded for (not saved without a scene). */
export const persistTesterState = (kind: RayTesterKind) => {
  const loaded = loadedStates[kind];
  if (!loaded?.sceneId) return;
  const data = readLS();
  data[loaded.sceneId] = { ...data[loaded.sceneId], [LS_FIELDS[kind]]: loaded.state };
  writeLS(data);
};

/** The scenes that have saved params of any of the kinds */
export const getScenesWithData = (kinds: RayTesterKind[]) => {
  const data = readLS();
  return Object.keys(data).filter((sceneId) =>
    kinds.some((kind) => data[sceneId][LS_FIELDS[kind]] !== undefined)
  );
};

/** Clears the kinds' saved params: asks for the scope when more than one scene has some. */
export const clearTesterLSWithConfirm = (kinds: RayTesterKind[]) => {
  if (getScenesWithData(kinds).length > 1) {
    confirmClearScope({
      onClearAllScenes: () => clearTesterLS(kinds, 'ALL'),
      onClearThisScene: () => clearTesterLS(kinds, 'THIS_SCENE'),
    });
  } else {
    clearTesterLS(kinds, 'ALL');
  }
};

/** Clears the kinds' saved params, then resets the current scene's to the defaults (both
 * scopes include the current scene). */
const clearTesterLS = (kinds: RayTesterKind[], scope: 'ALL' | 'THIS_SCENE') => {
  const data = readLS();
  const currentSceneId = getCurrentSceneId();
  for (const sceneId of Object.keys(data)) {
    if (scope === 'THIS_SCENE' && sceneId !== currentSceneId) continue;
    for (const kind of kinds) delete data[sceneId][LS_FIELDS[kind]];
    if (!Object.keys(data[sceneId]).length) delete data[sceneId];
  }
  writeLS(data);
  for (const kind of kinds) {
    loadedStates[kind] = null;
    updateDraggableWindow(WINDOW_IDS[kind]);
  }
};
