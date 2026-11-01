// The lights' undo / redo: the edit window's fields recorded per scene, their handlers (registered
// at this module's load), and the change handler the window's fields share.
import * as THREE from 'three/webgpu';
import { getECSWorld, getEntityIdByAppId, type ECSWorld } from '../../ecs/ECS';
import { ComponentType } from '../../ecs/ECSCoreComponents';
import type { FieldChange } from '../../../ui/forms/Field';
import {
  setLightEnabled,
  setLightFrustumCullingEnabled,
  setLightObjectCullingEnabled,
} from '../Light';
import { refreshSpatialRadius } from '../../../features/spatial/SpatialIndexSystem';
import { lwarn } from '../../../utils/Logger';
import {
  _recordOrCoalesceUndoRedoAction,
  _recordUndoRedoAction,
  _registerUndoRedoActionHandler,
} from '../../../debug/_dbg__UndoRedo';
import {
  reconcileDebugVisuals,
  refreshLightShadows,
  saveLightToLS,
  updateLightsDebuggerGUI,
  type LightEntityDebugState,
} from './_dbg__LightDebugState';

export type LightPos = { x: number; y: number; z: number };
export type ShadowLight = THREE.PointLight | THREE.SpotLight | THREE.DirectionalLight;

/** Edit window fields recorded to the (per-scene) undo/redo history, and their values. */
export type UndoableLightValues = {
  enabled: boolean;
  color: number;
  groundColor: number;
  intensity: number;
  distance: number;
  decay: number;
  frustumCullingEnabled: boolean;
  objectCullingEnabled: boolean;
  position: LightPos;
  targetPos: LightPos;
  castShadow: boolean;
  shadowBias: number;
  shadowNormalBias: number;
  shadowIntensity: number;
  shadowBlurSamples: number;
  shadowRadius: number;
  shadowMapSize: [number, number];
  shadowCameraNearFar: [number, number];
  shadowCameraFrustum: [number, number, number, number];
};
export type UndoableLightKey = keyof UndoableLightValues;
type LightUndoPayload<K extends UndoableLightKey> = {
  appId: string;
  prev: UndoableLightValues[K];
  next: UndoableLightValues[K];
};

const UNDOABLE_LIGHT_LABELS: Record<UndoableLightKey, string> = {
  enabled: 'enabled',
  color: 'color',
  groundColor: 'ground color',
  intensity: 'intensity',
  distance: 'distance',
  decay: 'decay',
  frustumCullingEnabled: 'frustum culling',
  objectCullingEnabled: 'object culling',
  position: 'position',
  targetPos: 'target position',
  castShadow: 'cast shadow',
  shadowBias: 'shadow bias',
  shadowNormalBias: 'shadow normal bias',
  shadowIntensity: 'shadow intensity',
  shadowBlurSamples: 'shadow blur samples',
  shadowRadius: 'shadow radius',
  shadowMapSize: 'shadow map size',
  shadowCameraNearFar: 'shadow camera near/far',
  shadowCameraFrustum: 'shadow camera frustum',
};

/** Number and colour fields: changes made in quick succession (key presses) are merged into one
 * entry. */
const COALESCED_LIGHT_KEYS: ReadonlySet<UndoableLightKey> = new Set([
  'color',
  'groundColor',
  'intensity',
  'distance',
  'decay',
  'shadowBias',
  'shadowNormalBias',
  'shadowIntensity',
  'shadowBlurSamples',
  'shadowRadius',
  'shadowCameraNearFar',
  'shadowCameraFrustum',
]);

/** Finds the light by app id at undo/redo time (never a captured reference: changing the
 * shadow map size replaces the light's Three.js object). */
const resolveLight = (appId: string) => {
  const world = getECSWorld();
  const entityId = getEntityIdByAppId(appId, world);
  const light =
    entityId !== undefined ? world.getComponent(entityId, ComponentType.OBJECT3D)?.value : null;
  if (entityId === undefined || !(light instanceof THREE.Light)) {
    lwarn(`Undo/redo: light "${appId}" no longer exists, skipping.`);
    return null;
  }
  return { world, entityId, light };
};
type ResolvedLight = NonNullable<ReturnType<typeof resolveLight>>;

const updateShadowCamHelper = ({ world, entityId }: { world: ECSWorld; entityId: number }) =>
  world.getComponent(entityId, ComponentType.DEBUG_LIGHT_HELPER)?.camHelper?.update();

/** Applies a value the same way the edit window's own control does. */
export const applyLightField: {
  [K in UndoableLightKey]: (target: ResolvedLight, value: UndoableLightValues[K]) => void;
} = {
  enabled: ({ world, entityId, light }, value) => {
    light.visible = value;
    setLightEnabled(entityId, value, world);
  },
  // For a hemisphere light `color` is the sky color
  color: ({ light }, value) => light.color.setHex(value),
  groundColor: ({ light }, value) => {
    if (light instanceof THREE.HemisphereLight) light.groundColor.setHex(value);
  },
  intensity: ({ light }, value) => {
    light.intensity = value;
  },
  distance: ({ world, entityId, light }, value) => {
    (light as THREE.PointLight | THREE.SpotLight).distance = value;
    refreshSpatialRadius(entityId, world);
  },
  decay: ({ light }, value) => {
    (light as THREE.PointLight | THREE.SpotLight).decay = value;
  },
  frustumCullingEnabled: ({ world, entityId }, value) =>
    setLightFrustumCullingEnabled(entityId, value, world),
  objectCullingEnabled: ({ world, entityId }, value) =>
    setLightObjectCullingEnabled(entityId, value, world),
  position: ({ world, entityId }, value) => {
    world.setTransform(entityId, { pos: value });
    world.getComponent(entityId, ComponentType.DEBUG_LIGHT_HELPER)?.value.update();
  },
  // The target entity is found through the light's current TARGET_LINK, so it doesn't
  // need a stable app id of its own.
  targetPos: ({ world, entityId }, value) => {
    const targetLink = world.getComponent(entityId, ComponentType.TARGET_LINK);
    if (targetLink) world.setTransform(targetLink.targetId, { pos: value });
  },
  castShadow: ({ world, entityId, light }, value) => {
    light.castShadow = value;
    reconcileDebugVisuals(entityId, world);
  },
  shadowBias: ({ light }, value) => {
    (light as ShadowLight).shadow.bias = value;
  },
  shadowNormalBias: ({ light }, value) => {
    (light as ShadowLight).shadow.normalBias = value;
  },
  shadowIntensity: ({ light }, value) => {
    (light as ShadowLight).shadow.intensity = value;
  },
  shadowBlurSamples: ({ light }, value) => {
    (light as ShadowLight).shadow.blurSamples = value;
  },
  shadowRadius: ({ light }, value) => {
    (light as ShadowLight).shadow.radius = value;
  },
  shadowMapSize: ({ world, entityId, light }, [width, height]) => {
    const l = light as ShadowLight;
    l.shadow.mapSize.set(width, height);
    refreshLightShadows(l, entityId, world);
  },
  shadowCameraNearFar: (target, [near, far]) => {
    const cam = (target.light as ShadowLight).shadow.camera;
    cam.near = near;
    cam.far = far;
    cam.updateProjectionMatrix();
    updateShadowCamHelper(target);
  },
  shadowCameraFrustum: (target, [left, right, top, bottom]) => {
    const cam = (target.light as ShadowLight).shadow.camera;
    if (!(cam instanceof THREE.OrthographicCamera)) return;
    Object.assign(cam, { left, right, top, bottom });
    cam.updateProjectionMatrix();
    updateShadowCamHelper(target);
  },
};

const setLightField = <K extends UndoableLightKey>(
  key: K,
  appId: string,
  value: UndoableLightValues[K]
) => {
  const target = resolveLight(appId);
  if (!target) return;
  applyLightField[key](target, value);
  saveLightToLS(target.entityId, key, value as LightEntityDebugState[K]);
  // refreshLightShadows rebuilds the window itself once the new light's helpers exist
  if (key !== 'shadowMapSize') updateLightsDebuggerGUI(undefined, appId);
};

/**
 * Records a light's finished change to the undo/redo history, unless nothing changed: a number's
 * or a colour's merged with the same field's changes in quick succession.
 * @param stableAppId the light's stable app id (a generated one can't be found again after a
 * reload: without one nothing is recorded)
 */
export const recordLightChange = <K extends UndoableLightKey>(
  key: K,
  stableAppId: string | undefined,
  prev: UndoableLightValues[K],
  next: UndoableLightValues[K]
) => {
  if (!stableAppId || JSON.stringify(prev) === JSON.stringify(next)) return;
  const payload: LightUndoPayload<K> = { appId: stableAppId, prev, next };
  const label = `Light ${stableAppId}: ${UNDOABLE_LIGHT_LABELS[key]}`;
  if (COALESCED_LIGHT_KEYS.has(key)) {
    _recordOrCoalesceUndoRedoAction(`light.${key}`, label, payload, `${stableAppId}.${key}`);
  } else {
    _recordUndoRedoAction(`light.${key}`, label, payload);
  }
};

const registerLightUndoHandler = <K extends UndoableLightKey>(key: K) => {
  _registerUndoRedoActionHandler<LightUndoPayload<K>>(`light.${key}`, {
    undo: ({ appId, prev }) => setLightField(key, appId, prev),
    redo: ({ appId, next }) => setLightField(key, appId, next),
  });
};
for (const key of Object.keys(UNDOABLE_LIGHT_LABELS) as UndoableLightKey[]) {
  registerLightUndoHandler(key);
}

/** What a light edit window's fields act on */
export type LightWindowContext = {
  world: ECSWorld;
  entityId: number;
  /** Its stable app id, if it has one (without one nothing is recorded) */
  stableAppId: string | undefined;
  /** Re-reads the grid (the disabled fields, the clear button) */
  refresh: () => void;
};

/**
 * A light edit window field's change handler: `apply` on every write; at the gesture's end the
 * value is saved, recorded with the gesture's `prev` (p804 D3) and the grid re-read. `toSaved`
 * makes the saved and recorded values from the field's (a tuple of several fields'), with `prev`
 * the field's own value before the gesture.
 */
export const onLightChange =
  <K extends UndoableLightKey, V = UndoableLightValues[K]>(
    ctx: LightWindowContext,
    key: K,
    apply?: (value: V) => void,
    toSaved?: (value: V) => UndoableLightValues[K]
  ) =>
  (value: unknown, change: FieldChange<unknown>) => {
    apply?.(value as V);
    if (!change.last) return;
    const read = toSaved ?? ((v: V) => v as unknown as UndoableLightValues[K]);
    const next = read(value as V);
    saveLightToLS(ctx.entityId, key, next as LightEntityDebugState[K]);
    ctx.refresh();
    recordLightChange(key, ctx.stableAppId, read(change.prev as V), next);
  };
