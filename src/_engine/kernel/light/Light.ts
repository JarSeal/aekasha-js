import * as THREE from 'three/webgpu';
import { ECSWorld, getECSWorld, getEntityIdByAppId } from '../ecs/ECS';
import { getCurrentSceneId, getRootScene, registerOnAllSceneEnters } from '../scene/Scene';
import type { DebugModuleRef } from '../config/DebugModules';
import { getLightCharacteristics } from './LightHelpers';
import { loadDebugModuleAsync, useDebug } from '../config/DebugModules';
import { ComponentType, Transform } from '../ecs/ECSCoreComponents';
import { loadPersistentProps } from '../scene/PropertyLoader';
import type { CoreEntityOpts } from '../../schemas/_HelperSchemas';
import { existsOrThrow } from '../../utils/Assert';
import { lerror, lwarn } from '../../utils/Logger';
import { getTexture } from '../assets/Texture';
import { retagAssetOwner } from '../assets/AssetOwners';
import { toThreeColor } from '../render/ThreeMath';
import { setFrustumCullingEnabled } from '../ecs/ObjectFrustumCullingSystem';
import type { FeatureContext } from '../init/Features';
import type { ShadowQuality } from '../../schemas/_HelperSchemas';

/**
 * Installs the lights (the kernel, p607): a light entity's deletion disposes its light (and its
 * target entity).
 * @internal
 */
export const installLights = (ctx: FeatureContext) => {
  ctx.registerComponentHooks(ComponentType.TAG_IS_LIGHT, {
    onDeleteEntity: (entityId, w) => disposeLight(entityId, w),
  });
};

/**
 * Debug env: loads the lights' debug GUI and helpers, keeps the GUI's list current, and syncs
 * the helpers from LS on every scene enter. The boot calls it before the features install.
 * @internal
 */
export const registerLightDebugGUI = async (world: ECSWorld) => {
  // Awaited, so the helpers' LATE_MAIN system registers before the debug camera's helpers' (a
  // load race before p607: the system order differed between page loads)
  lightDebugGUI = await loadDebugModuleAsync(() => import('./debug/_dbg__LightGUI'));
  await loadDebugModuleAsync(() => import('./debug/_dbg__LightHelpers'));
  if (!lightDebugGUI) return;

  registerOnAllSceneEnters('lightHelpersSceneSync', () => {
    const sceneId = getCurrentSceneId();
    if (sceneId) useDebug(lightDebugGUI)?.syncDebugVisualsFromLS(sceneId, world);

    useDebug(lightDebugGUI)?.initLightDebuggerGUI();
  });
  // After the 3D symbols' and the helpers' hooks on the tag, which attach what the list shows, and
  // a microtask later: OBJECT3D's add hook gives the light its type tag (the list's badge) after
  // this one, so a refresh at once read the last light of a load without it (p806 Phase 3)
  ECSWorld.registerComponentHooks(ComponentType.TAG_IS_LIGHT, {
    onAddComponent: () => {
      if (isLightsRefreshQueued) return;
      isLightsRefreshQueued = true;
      queueMicrotask(() => {
        isLightsRefreshQueued = false;
        useDebug(lightDebugGUI)?.updateLightsDebuggerGUI();
      });
    },
  });
};

/** A Lights tab refresh is queued for the lights added in this task (one for a scene's lights) */
let isLightsRefreshQueued = false;

/**
 * A shadow quality preset's values: what `createLightEntity` applies before a light's own
 * `shadow*` props.
 * @internal
 */
export type ShadowPreset = {
  mapSize: [number, number];
  blurSamples: number;
  radius: number;
  bias: number;
  normalBias: number;
};

/**
 * The shadow quality presets, by `shadowPreset`: `LOW` for mobile and integrated graphics,
 * `MEDIUM` (the default) for standard laptops, `HIGH` for gaming desktops, `ULTRA` for the top
 * tier.
 * @internal
 */
export const SHADOW_PRESETS: Record<ShadowQuality, ShadowPreset> = {
  LOW: {
    mapSize: [512, 512],
    blurSamples: 4,
    radius: 1,
    bias: -0.0005,
    normalBias: 0.02,
  },
  MEDIUM: {
    mapSize: [1024, 1024],
    blurSamples: 8,
    radius: 2,
    bias: -0.0002,
    normalBias: 0.04,
  },
  HIGH: {
    mapSize: [2048, 2048],
    blurSamples: 16,
    radius: 4,
    bias: -0.0001,
    normalBias: 0.05,
  },
  ULTRA: {
    mapSize: [4096, 4096],
    blurSamples: 32,
    radius: 5,
    bias: -0.00005,
    normalBias: 0.06,
  },
};

/**
 * A light's props for {@link createLightEntity}: the runtime type. It's wider than the light JSON
 * schema's `LightProps` (`aekasha/schemas`, what a `*.light.json` holds): it also takes three's
 * colour representations and, for a spot light's `map`, a texture object besides a registered
 * texture id. A colour is any of three's forms, or the JSON's `{ r, g, b }` in 0-255 (sRGB, as a
 * `'#rrggbb'` string is).
 *
 * `enabled: false` creates it disabled. The shadow-casting types (point, directional, spot) cast
 * none unless `castShadow`, and take a `shadowPreset` (`MEDIUM` by default) that the `shadow*`
 * values fine-tune; `shadowCameraFrustum` is a directional light's shadow camera's left, right,
 * top and bottom. A directional or spot light gets a target entity at `targetPos` (the origin by
 * default). A point or spot light can opt into the ECS frustum culling
 * (`frustumCullingEnabled`) and the spatial index's object culling (`objectCullingEnabled`). A
 * spot light's `map` is its cookie texture.
 */
export type LightProps = {
  enabled?: boolean;
  appId?: string;
} & (
  | {
      type: 'AMBIENT';
      color?: THREE.ColorRepresentation | { r: number; g: number; b: number };
      intensity?: number;
    }
  | {
      type: 'HEMISPHERE';
      color?: THREE.ColorRepresentation | { r: number; g: number; b: number };
      groundColor?: THREE.ColorRepresentation | { r: number; g: number; b: number };
      intensity?: number;
    }
  | {
      type: 'POINT';
      color?: THREE.ColorRepresentation | { r: number; g: number; b: number };
      intensity?: number;
      distance?: number;
      decay?: number;
      position?: { x: number; y: number; z: number };
      castShadow?: boolean;
      frustumCullingEnabled?: boolean;
      objectCullingEnabled?: boolean;
      // Shadow Tuning
      shadowPreset?: ShadowQuality;
      shadowBias?: number;
      shadowNormalBias?: number;
      shadowMapSize?: [number, number];
      shadowCameraNearFar?: [number, number];
      shadowBlurSamples?: number;
      shadowRadius?: number;
      shadowIntensity?: number;
    }
  | {
      type: 'DIRECTIONAL';
      color?: THREE.ColorRepresentation | { r: number; g: number; b: number };
      intensity?: number;
      position?: { x: number; y: number; z: number };
      targetPos?: { x: number; y: number; z: number };
      castShadow?: boolean;
      // Shadow Tuning
      shadowPreset?: ShadowQuality;
      shadowBias?: number;
      shadowNormalBias?: number;
      shadowMapSize?: [number, number];
      shadowCameraNearFar?: [number, number];
      shadowCameraFrustum?: [number, number, number, number];
      shadowBlurSamples?: number;
      shadowRadius?: number;
      shadowIntensity?: number;
    }
  | {
      type: 'SPOT';
      color?: THREE.ColorRepresentation | { r: number; g: number; b: number };
      intensity?: number;
      distance?: number;
      angle?: number;
      penumbra?: number;
      decay?: number;
      position?: { x: number; y: number; z: number };
      targetPos?: { x: number; y: number; z: number };
      castShadow?: boolean;
      frustumCullingEnabled?: boolean;
      objectCullingEnabled?: boolean;
      // Shadow Tuning
      shadowPreset?: ShadowQuality;
      shadowBias?: number;
      shadowNormalBias?: number;
      shadowMapSize?: [number, number];
      shadowCameraNearFar?: [number, number];
      shadowBlurSamples?: number;
      shadowRadius?: number;
      shadowIntensity?: number;
      map?: THREE.Texture | string;
    }
);

/**
 * Creates a light entity: an ambient, hemisphere, point, directional or spot light (in the root
 * scene unless `entityOpts.doNotAddToScene`) with an `OBJECT3D` and a transform, and for a
 * directional or spot light a target entity (deleted with it, see {@link getLightTargetId}).
 * Point and spot lights join the spatial index unless `entityOpts.spatialIndex` is `false`. In
 * the debug env the debugger's saved overrides for its app id apply, unless the light has a
 * manager (`entityOpts.managedBy`).
 * @param ecsWorld default: the default world
 * @returns the light's entity id
 * @example
 * ```ts
 * import { createLightEntity } from 'aekasha';
 *
 * createLightEntity({ type: 'AMBIENT', intensity: 0.3 }, { appId: 'ambient' });
 * createLightEntity(
 *   {
 *     type: 'DIRECTIONAL',
 *     intensity: 2,
 *     position: { x: 5, y: 10, z: 5 },
 *     castShadow: true,
 *     shadowPreset: 'HIGH',
 *   },
 *   { appId: 'sun' }
 * );
 * ```
 */
export const createLightEntity = (
  lightProps: LightProps,
  entityOpts?: CoreEntityOpts,
  ecsWorld?: ECSWorld
): number => {
  const world = ecsWorld || getECSWorld();
  const rootScene = existsOrThrow(getRootScene(), 'Could not find root scene.');

  // Load light properties. A managed light gets no persisted debug overrides: its manager
  // owns its values.
  const appId = lightProps.appId || entityOpts?.appId;
  const managedBy = entityOpts?.managedBy;
  const props = managedBy
    ? { ...lightProps, appId }
    : loadPersistentProps<LightProps>({ ...lightProps, appId }, 'LIGHT');

  let light:
    | THREE.AmbientLight
    | THREE.HemisphereLight
    | THREE.PointLight
    | THREE.DirectionalLight
    | THREE.SpotLight;

  switch (props.type) {
    case 'AMBIENT':
      light = new THREE.AmbientLight(toThreeColor(props.color), props.intensity);
      break;
    case 'HEMISPHERE':
      light = new THREE.HemisphereLight(
        toThreeColor(props.color),
        toThreeColor(props.groundColor),
        props.intensity
      );
      break;
    case 'POINT':
      light = new THREE.PointLight(
        toThreeColor(props.color),
        props.intensity,
        props.distance,
        props.decay
      );
      break;
    case 'DIRECTIONAL':
      light = new THREE.DirectionalLight(toThreeColor(props.color), props.intensity);
      break;
    case 'SPOT':
      light = new THREE.SpotLight(
        toThreeColor(props.color),
        props.intensity,
        props.distance,
        props.angle,
        props.penumbra,
        props.decay
      );
      if ('map' in props && props.map) {
        if (typeof props.map === 'string') {
          const texResource = getTexture(props.map);
          if (texResource) {
            // Claimed for this light's scene: no material uses it, so nothing else protects it
            // from the scene asset release when the scene that loaded it is left (AssetOwners)
            retagAssetOwner(texResource);
            light.map = texResource;
          } else {
            lwarn(
              `Could not locate cookie texture resource "${props.map}" for SpotLight entity "${appId}". Leaving map unassigned.`
            );
          }
        } else {
          light.map = props.map;
        }
      }
      break;
    default:
      throw new Error('Unsupported light type');
  }

  // --- Shadow Logic (Full Tuning) ---
  if (
    light instanceof THREE.PointLight ||
    light instanceof THREE.DirectionalLight ||
    light instanceof THREE.SpotLight
  ) {
    light.castShadow =
      'castShadow' in props && props.castShadow !== undefined ? props.castShadow : false;
    const s = light.shadow;

    // Apply Preset Defaults
    const preset =
      'shadowPreset' in props && props.shadowPreset
        ? SHADOW_PRESETS[props.shadowPreset]
        : SHADOW_PRESETS.MEDIUM;
    s.mapSize.set(preset.mapSize[0], preset.mapSize[1]);
    s.blurSamples = preset.blurSamples;
    s.radius = preset.radius;
    s.bias = preset.bias;
    s.normalBias = preset.normalBias;

    // Apply Developer Overrides (Fine-tuning)
    if ('shadowMapSize' in props && props.shadowMapSize)
      s.mapSize.set(props.shadowMapSize[0], props.shadowMapSize[1]);
    if ('shadowBias' in props && props.shadowBias !== undefined) s.bias = props.shadowBias;
    if ('shadowNormalBias' in props && props.shadowNormalBias !== undefined)
      s.normalBias = props.shadowNormalBias;
    if ('shadowRadius' in props && props.shadowRadius !== undefined) s.radius = props.shadowRadius;
    if ('shadowBlurSamples' in props && props.shadowBlurSamples !== undefined)
      s.blurSamples = props.shadowBlurSamples;
    if ('shadowIntensity' in props && props.shadowIntensity !== undefined)
      s.intensity = props.shadowIntensity;

    if ('shadowCameraNearFar' in props && props.shadowCameraNearFar) {
      s.camera.near = props.shadowCameraNearFar[0];
      s.camera.far = props.shadowCameraNearFar[1];
    }

    // Directional specific frustum (Ortho Camera)
    if (
      props.type === 'DIRECTIONAL' &&
      props.shadowCameraFrustum &&
      s.camera instanceof THREE.OrthographicCamera
    ) {
      const [l, r, t, b] = props.shadowCameraFrustum;
      s.camera.left = l;
      s.camera.right = r;
      s.camera.top = t;
      s.camera.bottom = b;
    }

    // Spot and point light specific aspect ratio (Perspective Camera)
    if (
      (props.type === 'SPOT' || props.type === 'POINT') &&
      s.camera instanceof THREE.PerspectiveCamera
    ) {
      const width = s.mapSize.width || 512;
      const height = s.mapSize.height || 512;
      s.camera.aspect = width / height;
    }

    s.camera.updateProjectionMatrix();
  }

  const entityId = world.createEntity(entityOpts);
  light.userData.entityId = entityId;
  world.addComponent(entityId, ComponentType.OBJECT3D, { value: light, _lastVersion: -1 });

  // --- Target Logic ---
  if (
    (props.type === 'DIRECTIONAL' || props.type === 'SPOT') &&
    (light instanceof THREE.DirectionalLight || light instanceof THREE.SpotLight)
  ) {
    const targetId = world.createEntity({
      userData: { name: 'LightTarget' },
      ...(managedBy ? { managedBy: { ...managedBy, role: `${managedBy.role}_TARGET` } } : {}),
    });
    if (entityOpts?.persistent) {
      world.addComponent(targetId, ComponentType.PERSISTENT, true);
    }
    const tPos = props.targetPos || { x: 0, y: 0, z: 0 };

    world.addComponent(targetId, ComponentType.TRANSFORM, new Transform({ pos: tPos }));

    const targetObj = new THREE.Object3D();
    targetObj.userData.entityId = targetId;
    world.addComponent(targetId, ComponentType.OBJECT3D, { value: targetObj, _lastVersion: -1 });

    light.target = targetObj;
    rootScene.add(targetObj);
    world.addComponent(entityId, ComponentType.TARGET_LINK, { targetId });
  }

  const pos =
    'position' in props && props.position
      ? props.position
      : { x: light.position.x, y: light.position.y, z: light.position.z };
  light.position.set(pos.x, pos.y, pos.z);

  // --- Transform Logic ---
  world.addComponent(
    entityId,
    ComponentType.TRANSFORM,
    new Transform({
      pos,
      rot: {
        x: light.quaternion.x,
        y: light.quaternion.y,
        z: light.quaternion.z,
        w: light.quaternion.w,
      },
    })
  );

  if (!entityOpts?.doNotAddToScene) {
    rootScene.add(light);
  }

  if (props.enabled === false) {
    setLightEnabled(entityId, false, world);
  }

  if ('frustumCullingEnabled' in props && props.frustumCullingEnabled) {
    setLightFrustumCullingEnabled(entityId, true, world);
  }

  if ('objectCullingEnabled' in props && props.objectCullingEnabled) {
    setLightObjectCullingEnabled(entityId, true, world);
  }

  // Opt-in, not opt-out (docs/plans/_DONE_p050_spatial-index.md §3): ambient/hemisphere lights are
  // simply never opted in, by construction, rather than filtered out downstream.
  if (entityOpts?.spatialIndex !== false && getLightCharacteristics(light).canBeSpatiallyIndexed) {
    world.addComponent(entityId, ComponentType.SPATIAL_INDEXED, true);
  }

  if ('position' in props && props.position) {
    world.setTransform(entityId, { pos });
  }

  return entityId;
};

/**
 * Returns the entity id of a directional or spot light's target: move its transform to aim the
 * light.
 * @returns the target's entity id, or `undefined` for a light without one
 * @example
 * ```ts
 * import { getECSWorld, getEntityIdByAppId, getLightTargetId } from 'aekasha';
 *
 * const world = getECSWorld();
 * const sunId = getEntityIdByAppId('sun');
 * const targetId = sunId !== undefined ? getLightTargetId(sunId, world) : undefined;
 * if (targetId !== undefined) world.setTransform(targetId, { pos: { x: 0, y: 0, z: -5 } });
 * ```
 */
export const getLightTargetId = (lightId: number, world: ECSWorld): number | undefined =>
  world.getComponent(lightId, ComponentType.TARGET_LINK)?.targetId;

/**
 * Enables or disables a light entity (`DISABLED`): a disabled light, and its target, are hidden.
 * @example
 * ```ts
 * import { getECSWorld, getEntityIdByAppId, setLightEnabled } from 'aekasha';
 *
 * const lampId = getEntityIdByAppId('lamp');
 * if (lampId !== undefined) setLightEnabled(lampId, false, getECSWorld());
 * ```
 */
export const setLightEnabled = (lightId: number, enabled: boolean, world: ECSWorld) => {
  if (enabled) {
    world.removeComponent(lightId, ComponentType.DISABLED);
  } else {
    world.addComponent(lightId, ComponentType.DISABLED, true);
  }
};

/**
 * Opts a light entity into the ECS frustum culling, or out of it (`setFrustumCullingEnabled`,
 * which isn't light specific).
 * @internal
 */
// A function, not an alias (`= setFrustumCullingEnabled`): Light.ts → ObjectFrustumCullingSystem.ts
// → ECSCoreSystems.ts → Light.ts is an import cycle, and an alias would read the import while
// this module loads, possibly before ObjectFrustumCullingSystem.ts has defined it
export const setLightFrustumCullingEnabled = (
  entityId: number,
  enabled: boolean,
  world: ECSWorld
) => setFrustumCullingEnabled(entityId, enabled, world);

/**
 * Opts a point or spot light entity into the spatial index's object culling (`spatial()`), or out
 * of it, which also shows it if it was culled.
 * @internal
 */
export const setLightObjectCullingEnabled = (
  lightId: number,
  enabled: boolean,
  world: ECSWorld
) => {
  if (enabled) {
    world.addComponent(lightId, ComponentType.OBJECT_CULLING_ENABLED, true);
  } else {
    world.removeComponent(lightId, ComponentType.OBJECT_CULLING_ENABLED);
    // Opting out must also clear any current culled state — otherwise a light
    // that was invisible when culling was turned off would stay invisible forever.
    if (world.hasComponent(lightId, ComponentType.TAG_OBJECT_CULLED)) {
      world.removeComponent(lightId, ComponentType.TAG_OBJECT_CULLED);
    }
  }
};

/**
 * A light entity's deletion hook: deletes its target entity, detaches and disposes its light.
 * @internal
 */
export const disposeLight = (entityId: number, ecsWorld?: ECSWorld) => {
  const world = ecsWorld || getECSWorld();

  const targetLink = world.getComponent(entityId, ComponentType.TARGET_LINK);
  if (targetLink) {
    world.deleteEntity(targetLink.targetId);
  }

  const objComp = world.getComponent(entityId, ComponentType.OBJECT3D);
  if (!objComp) {
    useDebug(lightDebugGUI)?._onLightDeleted(entityId, world);
    return;
  }

  const light = objComp.value as THREE.Light;

  if (light instanceof THREE.DirectionalLight || light instanceof THREE.SpotLight) {
    light.target.removeFromParent();
  }
  light.removeFromParent();
  light.dispose();

  useDebug(lightDebugGUI)?._onLightDeleted(entityId, world);
};

// --- DEBUG LIGHT HELPERS ---

type LightGUIModule = typeof import('./debug/_dbg__LightGUI');

/** The lights' debug GUI, loaded by the boot's debug step (debug env only; `null` otherwise) */
let lightDebugGUI: DebugModuleRef<LightGUIModule> | null = null;

/**
 * What the Lights tab saved for a light in a scene (debug env; `undefined` otherwise, or when
 * nothing is saved), for the property loader to merge over its creation props. Typed `object`,
 * so no exported type names the debug module's.
 * @internal
 */
export const getSavedLightDebugProps = (
  appId: string,
  sceneId: string | null
): object | undefined => useDebug(lightDebugGUI)?.loadLightDebugData(appId, sceneId);

/**
 * Whether the light helpers show (debug env; `false` otherwise).
 * @internal
 */
export const isAnyLightHelperVisible = (): boolean =>
  Boolean(useDebug(lightDebugGUI)?.globalHelpersVisible);

/**
 * Shows or hides the light helpers, toggling them without `show` (debug env; nothing otherwise).
 * @internal
 */
export const toggleAllLightHelpers = (show?: boolean) =>
  useDebug(lightDebugGUI)?._toggleAllLightHelpers(show);

/**
 * Returns the light of the entity with this app id.
 * @param ecsWorld default: the default world
 * @returns the light, or `undefined` when no entity has the id (or it has no object)
 * @throws when the entity's object isn't a light
 * @example
 * ```ts
 * import { getLightByAppId } from 'aekasha';
 *
 * const lamp = getLightByAppId('lamp');
 * if (lamp) lamp.intensity = 4;
 * ```
 */
export const getLightByAppId = (appId: string, ecsWorld?: ECSWorld) => {
  const world = ecsWorld || getECSWorld();
  const entityId = getEntityIdByAppId(appId, world);
  let light: THREE.Light | undefined = undefined;
  if (entityId !== undefined) {
    const obj = world.getComponent(entityId, ComponentType.OBJECT3D)?.value;
    if (obj && !(obj as THREE.Light).isLight) {
      const msg = `Found Object3D is not a light (type: ${obj.type}).`;
      lerror(msg);
      throw new Error(msg);
    }
    light = obj as THREE.Light | undefined;
  }
  return light;
};
