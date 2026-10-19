import type * as THREE from 'three/webgpu';
import { normalWorldGeometry, pmremTexture } from 'three/tsl';
import { lerror, lwarn } from '../../utils/Logger';
import { getCurrentSceneId, getRootScene } from '../../kernel/scene/Scene';
import { getNextSceneId, isCurrentlyLoading } from '../../kernel/scene/SceneLoader';
import { IS_DEBUG_ENV } from '../../kernel/config/Config';
import { lsGetItem } from '../../utils/LocalAndSessionStorage';
import type { DebugModuleRef } from '../../kernel/config/DebugModules';
import { loadDebugModuleAsync, useDebug } from '../../kernel/config/DebugModules';
import { deepMerge, isIndexObject } from '../../utils/DeepMerge';
import type { SkyBoxBaseDef, SkyBoxDef, SkyBoxEnvDef, SkyBoxOverrides } from './SkyBoxTypes';
import { fromLegacySkyBoxProps, isLegacySkyBoxProps, type LegacySkyBoxProps } from './LegacySkyBox';
import {
  BASE_DEFAULTS,
  BASE_STRUCTURAL_KEYS,
  buildBaseLayer,
  ENV_DEFAULTS,
  loadBaseTexture,
} from './layers/Base';
import {
  applySkyUniforms,
  buildSkyComposite,
  createSkyUniforms,
  getCompositeSignature,
  getEnvSize,
  getMoonCount,
  getStaticLayersSourceOf,
  hasProceduralLayer,
  isAtmosphereEnabled,
  isDayNightEnabled,
  isOn,
  type SkyUniforms,
} from './SkyComposite';
import { disposeEnvBake, getPMREMTexture, requestEnvBake, setEnvBake } from './SkyEnvironment';
import { disposeStaticLayers, requestStaticLayersBake, setStaticLayers } from './SkyStaticLayers';
import { deleteSkyLights, syncSkyLights } from './SkyLights';
import { loadMoonTexture, MAX_MOONS } from './layers/Moon';
import { MAX_SUNS } from './layers/Sun';
import {
  applyDayNightChange,
  createSkyTimeState,
  resetSkyTimeState,
  setSkyTimeMoonPhase,
  type SkyTimeState,
} from './SkyTime';

/**
 * The sky box the root scene shows, as the API hands it out: which one, the scene it belongs to,
 * and its definition with every change made since its activation merged in (`updateSkyBox`, and
 * in the debug env the debug tab's overrides). Every change makes a new one, and none changes in
 * place: a kept one is the sky box as it was then.
 */
export type SkyBoxState = Readonly<{
  /** The sky box's id (its definition's). */
  id: string;
  /** The scene it's registered in. */
  sceneId: string;
  /** Its definition, with the changes made since its activation. */
  def: SkyBoxDef;
}>;

/**
 * The one sky box the root scene shows, with its internals (uniforms, nodes, textures, the running
 * time): the feature's own state, read by its debug tab, the env ball, GPU memory and the tests.
 * The API hands out its {@link SkyBoxState} part.
 * @internal
 */
export type ActiveSkyBox = {
  /** As {@link SkyBoxState}'s. */
  id: string;
  /** As {@link SkyBoxState}'s. */
  sceneId: string;
  /** The definition with the debug overrides (debug env only) and updateSkyBox changes merged in. */
  def: SkyBoxDef;
  /** Every layer's uniforms, created on activation and kept across node rebuilds. */
  uniforms: SkyUniforms;
  /** Whether it's on the composite path (SkyComposite.ts), whose environment is an env bake,
   * or on the direct path (a texture or colour base only, sampled as is). */
  isComposite: boolean;
  /** The root scene's `backgroundNode` and `environmentNode` (null: a colour base on the direct
   * path has no environment). */
  nodes: { background: THREE.Node; environment: THREE.Node | null };
  /** The base's source texture, the PMREM the environment samples (the texture's, or the env
   * bake's target), and each moon's texture (by index). */
  textures: {
    source: THREE.Texture | null;
    environment: THREE.Texture | null;
    moons: (THREE.Texture | null)[];
  };
  /** The day-night cycle's runtime time (used while `def.dayNight` is on). Games drive it
   * through setTimeOfDay etc.; it's never written to the definition. */
  time: SkyTimeState;
};

/** A change to the active sky box: any subset of its layers' values. */
export type SkyBoxUpdate = {
  /** The base's values (its `type` can't change: another type is another definition). A change
   * to file, fileNames, path, textureId, texture, colorSpace or flipY reloads the sky box. */
  base?: NonNullable<SkyBoxOverrides['base']> & { texture?: THREE.Texture };
  /** A change to `size`, or `backgroundRoughness` crossing 0, rebuilds the nodes. */
  env?: SkyBoxEnvDef;
  /** Adding or removing it (or `enabled`) rebuilds the nodes, as for every layer below. */
  atmosphere?: SkyBoxOverrides['atmosphere'];
  /** An array replaces the suns; an index object (`{ 0: { ... } }`) changes those entries.
   * Adding or removing one rebuilds the nodes. */
  suns?: SkyBoxOverrides['suns'];
  /** As `suns`. A change to a moon's texture reloads the sky box; one to its phase also sets
   * its running phase. */
  moons?: SkyBoxOverrides['moons'];
  /** As `suns`. A change re-bakes the nebula cube (throttled: at most every 150 ms). */
  nebulae?: SkyBoxOverrides['nebulae'];
  /** The managed ambient light's values. */
  ambientLight?: SkyBoxOverrides['ambientLight'];
  /** The clouds' values (they need the atmosphere). */
  clouds?: SkyBoxOverrides['clouds'];
  /** The ground's values. */
  ground?: SkyBoxOverrides['ground'];
  /** Its runtime keys (timeOfDay, speed, cycleDurationSec, playing) also set the running
   * cycle's; turning it on starts the cycle from the definition's values. */
  dayNight?: SkyBoxOverrides['dayNight'];
};

/**
 * Why the active sky box changed: `'activate'` (another sky box, or the same one loaded again
 * after a structural update), `'update'` (an `updateSkyBox` that kept its nodes or rebuilt them)
 * or `'clear'` (none shows, eg. on a scene's exit).
 */
export type SkyBoxChangeReason = 'activate' | 'update' | 'clear';
/**
 * A listener for {@link onSkyBoxChange}: the active sky box (null once cleared) and why it changed.
 */
export type SkyBoxChangeListener = (skyBox: SkyBoxState | null, reason: SkyBoxChangeReason) => void;

/**
 * The debug tab's override store: `{ [sceneId]: { [skyBoxId]: SkyBoxOverrides } }`.
 * @internal
 */
export const SKYBOX_DEBUG_OVERRIDES_LS_KEY = 'AEK_debugSkyBox';

/** Definitions by scene, in registration order. */
const registry = new Map<string, Map<string, SkyBoxDef>>();
/** Per scene, the last sky box registered with `isDefault: true`. */
const sceneDefaultIds = new Map<string, string>();
let active: ActiveSkyBox | null = null;
/** Every activation and clear takes the next number; an activation that finds a newer one when
 * its texture has loaded was superseded, and drops its result. */
let activationSeq = 0;
/** The latest activation, while its textures load: an updateSkyBox waits for it. */
let activationInFlight: Promise<ActiveSkyBox | null> | null = null;
/** The updates made while an activation is in flight, by sky box id: each one's changes merged
 * in call order, and the callers to settle once it's applied. */
const queuedUpdates = new Map<
  string,
  { update: SkyBoxUpdate; settle: ((active: SkyBoxState | null) => void)[] }
>();
const listeners = new Set<SkyBoxChangeListener>();
/** Run by every clear: the sky clock's restart (SkyDayNight.ts, which imports this module). */
let onClear: (() => void) | null = null;

/**
 * Sets what every clear runs: SkyDayNight.ts' install restarts the sky clock with it, so a
 * scene's clouds start from the same place on every visit.
 * @internal
 */
export const _setSkyBoxClearHook = (hook: (() => void) | null) => {
  onClear = hook;
};

const notify = (reason: SkyBoxChangeReason) => {
  for (const listener of listeners) listener(active, reason);
  // An update keeps the tab's panes (a rebuild would drop a slider mid-drag)
  createSkyBoxDebugGUI({ rebuild: reason !== 'update' });
};

/** The scene a sky box without an explicit one belongs to: the loading scene, else the current. */
const resolveSceneId = (sceneId?: string) =>
  sceneId || (isCurrentlyLoading() ? getNextSceneId() : getCurrentSceneId());

// Registry

/**
 * Registers (or replaces, by id) a sky box definition without showing it. Without a sceneId,
 * it belongs to the loading scene, or else the current one. Used by `createSkyBox` and the
 * feature's `sceneRegistered` hook (a scene's JSON sky boxes); apps call `createSkyBox`.
 * @internal
 * @returns the scene id it was registered in
 */
export const registerSkyBox = (def: SkyBoxDef, sceneId?: string) => {
  const targetSceneId = resolveSceneId(sceneId || def.sceneId);
  if (!targetSceneId) {
    const msg = `Could not find a scene to register sky box "${def.id}" in (no current or loading scene).`;
    lerror(msg);
    throw new Error(msg);
  }
  if ('preset' in def && IS_DEBUG_ENV) {
    lwarn(
      `Sky box "${def.id}" still has a preset, which is ignored here: pass the definition through resolveSkyBoxPreset (aekasha/skybox) first (JSON sky boxes are resolved at build time).`
    );
  }
  let sceneDefs = registry.get(targetSceneId);
  if (!sceneDefs) {
    sceneDefs = new Map();
    registry.set(targetSceneId, sceneDefs);
  }
  sceneDefs.set(def.id, def);
  if (def.isDefault) {
    sceneDefaultIds.set(targetSceneId, def.id);
  } else if (sceneDefaultIds.get(targetSceneId) === def.id) {
    sceneDefaultIds.delete(targetSceneId);
  }
  createSkyBoxDebugGUI();
  return targetSceneId;
};

/**
 * The sky box a scene starts with: the last registered with `isDefault: true`, else the first
 * registered. Read by the feature's `created` hook and the debug tab.
 * @internal
 */
export const getSceneDefaultSkyBoxId = (sceneId: string) => {
  const sceneDefs = registry.get(sceneId);
  if (!sceneDefs?.size) return null;
  const defaultId = sceneDefaultIds.get(sceneId);
  if (defaultId && sceneDefs.has(defaultId)) return defaultId;
  return sceneDefs.keys().next().value ?? null;
};

/**
 * Debug accessor: the registry (read it, don't change it).
 * @internal
 */
export const _getSkyBoxRegistry = (): ReadonlyMap<string, ReadonlyMap<string, SkyBoxDef>> =>
  registry;

// Activation

/** The definition with its debug overrides merged in (debug env only: production never reads LS). */
const resolveSkyBoxDef = (def: SkyBoxDef, sceneId: string): SkyBoxDef => {
  if (!IS_DEBUG_ENV) return def;
  const allOverrides = lsGetItem(SKYBOX_DEBUG_OVERRIDES_LS_KEY, {}) as {
    [sceneId: string]: { [id: string]: SkyBoxOverrides } | undefined;
  } | null;
  const overrides = allOverrides?.[sceneId]?.[def.id];
  return overrides ? mergeSkyBoxDef(def, overrides) : def;
};

/** An index object left where an array goes (nothing to merge into), as the array. */
const toArray = <T extends object>(value: T[] | Record<string, T>): T[] => {
  if (!isIndexObject(value)) return value as T[];
  const entries: T[] = [];
  for (const [index, entry] of Object.entries(value)) entries[Number(index)] = entry;
  return Array.from(entries, (entry) => entry ?? ({} as T));
};

/** A definition with a change merged in. An index object merges into the suns (or moons,
 * nebulae) array, and one with none to merge into becomes the array (eg. a debug override
 * turning suns[0] on). */
const mergeSkyBoxDef = (def: SkyBoxDef, change: unknown): SkyBoxDef => {
  const merged = deepMerge(def, change);
  if (merged.suns) merged.suns = toArray(merged.suns);
  if (merged.moons) merged.moons = toArray(merged.moons);
  if (merged.nebulae) merged.nebulae = toArray(merged.nebulae);
  return merged;
};

const applySceneProperties = (def: SkyBoxDef, isComposite: boolean) => {
  const rootScene = getRootScene() as THREE.Scene;
  rootScene.environmentIntensity =
    def.env?.environmentIntensity ?? ENV_DEFAULTS.environmentIntensity;
  rootScene.backgroundIntensity = def.env?.backgroundIntensity ?? ENV_DEFAULTS.backgroundIntensity;
  // Direct path: PMREMNode applies it to the environment; the background applies it itself
  // (layers/Base.ts). Composite path: the rotation is baked into the environment already.
  const rotate =
    isComposite || def.base.type === 'COLOR' ? 0 : def.base.rotate ?? BASE_DEFAULTS.rotate;
  rootScene.environmentRotation.set(0, rotate, 0);
};

const resetSceneProperties = () => {
  const rootScene = getRootScene() as THREE.Scene | undefined;
  if (!rootScene) return;
  rootScene.backgroundNode = null;
  rootScene.environmentNode = null;
  rootScene.environmentIntensity = ENV_DEFAULTS.environmentIntensity;
  rootScene.backgroundIntensity = ENV_DEFAULTS.backgroundIntensity;
  rootScene.environmentRotation.set(0, 0, 0);
};

/** On the composite path, a blurred background samples the env bake (switching is a rebuild). */
const isBackgroundFromBake = (def: SkyBoxDef) =>
  (def.env?.backgroundRoughness ?? ENV_DEFAULTS.backgroundRoughness) > 0;

/**
 * Whether a value change re-bakes the environment (`env.dynamic`): for updates here and the
 * day-night bake schedule (SkyDayNight.ts).
 * @internal
 */
export const isBakeDynamic = (def: SkyBoxDef) => def.env?.dynamic ?? ENV_DEFAULTS.dynamic;

type SkyBoxBuild = Pick<ActiveSkyBox, 'isComposite' | 'nodes' | 'textures'>;

/** Builds a definition's nodes (and, on the composite path, its env bake, with a bake requested). */
const buildNodes = (
  def: SkyBoxDef,
  u: SkyUniforms,
  texture: THREE.Texture | null,
  moonTextures: (THREE.Texture | null)[]
): SkyBoxBuild => {
  if (!hasProceduralLayer(def)) {
    disposeEnvBake();
    disposeStaticLayers();
    const layer = buildBaseLayer(def.base, u.base, texture);
    return {
      isComposite: false,
      nodes: { background: layer.backgroundNode, environment: layer.environmentNode },
      textures: { source: layer.texture, environment: layer.environmentTexture, moons: [] },
    };
  }
  // Before the composites: they sample its cube
  const staticSource = getStaticLayersSourceOf(def, u);
  const staticLayers = staticSource ? setStaticLayers(staticSource).target.texture : null;
  if (!staticSource) disposeStaticLayers();
  const sources = {
    basePMREM: texture ? getPMREMTexture(texture) : null,
    moonTextures,
    staticLayers,
  };
  const bake = setEnvBake(
    getEnvSize(def),
    buildSkyComposite(def, u, 'ENV_BAKE', sources, normalWorldGeometry)
  );
  const background = isBackgroundFromBake(def)
    ? pmremTexture(bake.target.texture, normalWorldGeometry, u.base.backgroundRoughness)
    : buildSkyComposite(def, u, 'VIEW', sources, normalWorldGeometry);
  return {
    isComposite: true,
    nodes: { background, environment: bake.environmentNode },
    textures: { source: texture, environment: bake.target.texture, moons: moonTextures },
  };
};

/** Whether going from `current` to `def` (same base) needs new nodes. */
const needsRebuild = (current: ActiveSkyBox, def: SkyBoxDef) => {
  if (hasProceduralLayer(def) !== current.isComposite) return true;
  if (!current.isComposite) return false;
  return (
    getCompositeSignature(def) !== getCompositeSignature(current.def) ||
    getEnvSize(def) !== getEnvSize(current.def) ||
    isBackgroundFromBake(def) !== isBackgroundFromBake(current.def)
  );
};

/** Makes `next` the active sky box and shows it. */
const show = (next: ActiveSkyBox) => {
  const rootScene = getRootScene() as THREE.Scene;
  rootScene.backgroundNode = next.nodes.background;
  // Typed vec3, but EnvironmentNode takes any PMREM-like node (as the three.js examples do)
  rootScene.environmentNode = next.nodes.environment as THREE.Node<'vec3'> | null;
  applySceneProperties(next.def, next.isComposite);
  active = next;
  syncSkyLights(next.id, next.def, next.uniforms);
};

/** Loads, builds and shows a resolved definition. `time` carries a running cycle's time over
 * (a structural update of the same sky box); without it, the cycle starts from the definition.
 * Until it has shown (or been superseded), updates wait for it. */
const activate = (sceneId: string, def: SkyBoxDef, time?: SkyTimeState) => {
  const seq = ++activationSeq;
  const run = loadAndShow(seq, sceneId, def, time);
  activationInFlight = run;
  const done = () => {
    if (activationInFlight !== run) return; // A later activation runs the queue
    activationInFlight = null;
    applyQueuedUpdates();
  };
  void run.then(done, done);
  return run;
};

const loadAndShow = async (
  seq: number,
  sceneId: string,
  def: SkyBoxDef,
  time: SkyTimeState | undefined
) => {
  const [texture, ...moonTextures] = await Promise.all([
    loadBaseTexture(def.base),
    ...Array.from({ length: getMoonCount(def) }, (_, i) => loadMoonTexture(def.moons?.[i])),
  ]);
  if (seq !== activationSeq) return active; // Superseded by a later activation or clear

  if (isOn(def.clouds) && !isAtmosphereEnabled(def) && IS_DEBUG_ENV) {
    lwarn(`Sky box "${def.id}": clouds need an enabled atmosphere, they are left out.`);
  }
  // A definition made in code isn't validated by the schema
  if ((def.suns?.length ?? 0) > MAX_SUNS && IS_DEBUG_ENV) {
    lwarn(`Sky box "${def.id}": only ${MAX_SUNS} suns are drawn, the others are ignored.`);
  }
  if ((def.moons?.length ?? 0) > MAX_MOONS && IS_DEBUG_ENV) {
    lwarn(`Sky box "${def.id}": only ${MAX_MOONS} moons are drawn, the others are ignored.`);
  }
  const skyTime = time ?? createSkyTimeState(def);
  const uniforms = createSkyUniforms(def, skyTime);
  show({
    id: def.id,
    sceneId,
    def,
    uniforms,
    time: skyTime,
    ...buildNodes(def, uniforms, texture, moonTextures),
  });
  notify('activate');
  return active;
};

/**
 * Shows a registered sky box of the current scene (with its debug overrides, in the debug env),
 * or none with null. When called again before an earlier call has loaded its texture, the
 * latest call wins. A texture that fails to load shows black (a moon's, a plain disc): it never
 * fails the call.
 * @param id one of the current scene's sky boxes (its JSON `skyboxes`, or a `createSkyBox`), or
 * null for none
 * @param sceneId the current scene's id (default); another scene's warns and changes nothing
 * @returns the active sky box once it shows (unchanged when `id` isn't registered, which warns),
 * or null
 */
export const setActiveSkyBox = async (
  id: string | null,
  sceneId?: string
): Promise<SkyBoxState | null> => {
  if (id === null) {
    clearSkyBox();
    return null;
  }
  const currentSceneId = getCurrentSceneId();
  const targetSceneId = sceneId || currentSceneId;
  if (!targetSceneId || targetSceneId !== currentSceneId) {
    lwarn(
      `Could not activate sky box "${id}": only the current scene's sky boxes can be shown (scene: "${targetSceneId}").`
    );
    return active;
  }
  const def = registry.get(targetSceneId)?.get(id);
  if (!def) {
    lwarn(`Could not find sky box "${id}" in scene "${targetSceneId}".`);
    return active;
  }
  return activate(targetSceneId, resolveSkyBoxDef(def, targetSceneId));
};

/**
 * Shows a scene's default sky box (see getSceneDefaultSkyBoxId), if it has any: the feature's
 * `created` hook, once the scene code has run and the scene is current.
 * @internal
 */
export const activateSceneDefaultSkyBox = async (sceneId: string) => {
  const id = getSceneDefaultSkyBoxId(sceneId);
  if (!id) return null;
  return setActiveSkyBox(id, sceneId);
};

/**
 * The sky box the root scene shows with its internals, or null: for the feature's debug tab, the
 * env ball, GPU memory and the tests. Apps get its {@link SkyBoxState} from the API's results and
 * {@link onSkyBoxChange}.
 * @internal
 */
export const getActiveSkyBox = () => active;

const LEGACY_WARN = (message: string) => {
  if (IS_DEBUG_ENV) lwarn(message);
};

/**
 * Registers a sky box and, when it belongs to the current scene and `isDefault` isn't false,
 * shows it. While a scene loads, a sky box without a `sceneId` belongs to the loading scene: it's
 * only registered, and the loader shows the scene's default once the scene is entered.
 * `isDefault` defaults to true here, so the last sky box created for a scene is its default. A
 * definition with a `preset` goes through
 * `resolveSkyBoxPreset` first.
 * @returns the sky box once it shows, or null when it was only registered
 * @example
 * ```ts
 * import { createSkyBox } from 'aekasha/skybox';
 *
 * // In a scene file: an HDR sky with a slightly blurred background, the scene's default
 * void createSkyBox({
 *   id: 'studio',
 *   base: { type: 'EQUIRECTANGULAR', file: 'studio.hdr', path: './textures/' },
 *   env: { backgroundRoughness: 0.2 },
 * });
 * ```
 */
export function createSkyBox(def: SkyBoxDef): Promise<SkyBoxState | null>;
/**
 * The pre-3.0 `{ type, params }` form: converted to a layered definition, with a warning in the
 * debug env; `type: ''` clears the current scene's sky box.
 * @deprecated Write a layered definition ({@link SkyBoxDef}: `base`, `env`); removed in engine
 * 6.0.0 with the legacy shape.
 */
export function createSkyBox(legacy: LegacySkyBoxProps): Promise<SkyBoxState | null>;
export async function createSkyBox(
  defOrLegacy: SkyBoxDef | LegacySkyBoxProps
): Promise<SkyBoxState | null> {
  const converted = isLegacySkyBoxProps(defOrLegacy)
    ? fromLegacySkyBoxProps(defOrLegacy, LEGACY_WARN)
    : defOrLegacy;
  if (!converted) {
    // Legacy `type: ''`: "no sky box"
    const legacy = defOrLegacy as LegacySkyBoxProps;
    if (legacy.isCurrent !== false && resolveSceneId(legacy.sceneId) === getCurrentSceneId()) {
      clearSkyBox();
    }
    return null;
  }
  const def = { ...converted, isDefault: converted.isDefault ?? true };
  const sceneId = registerSkyBox(def);
  if (def.isDefault && sceneId === getCurrentSceneId()) return setActiveSkyBox(def.id, sceneId);
  return null;
}

const isStructuralBaseUpdate = (current: SkyBoxBaseDef, update: SkyBoxUpdate['base']) => {
  if (!update) return false;
  const currentValues = current as Record<string, unknown>;
  const updateValues = update as Record<string, unknown>;
  return BASE_STRUCTURAL_KEYS.some(
    (key) =>
      key in updateValues &&
      updateValues[key] !== undefined &&
      JSON.stringify(updateValues[key]) !== JSON.stringify(currentValues[key])
  );
};

/**
 * Changes the active sky box (a no-op for any other id). Three costs, by what changes:
 * - a structural key (the base's file, fileNames, path, textureId, texture, colorSpace or flipY;
 *   a moon's texture) re-runs the activation, its texture load included;
 * - one that changes which nodes exist (on the composite path: which layers, suns, moons, their
 *   lights and nebulae exist, the nebulae's octaves, env.size, env.nebulaSize, or
 *   env.backgroundRoughness crossing 0) rebuilds the nodes;
 * - any other only writes uniforms and scene properties, and (with env.dynamic) re-bakes the
 *   environment (a nebula change re-bakes the nebula cube first).
 *
 * Changes last until the sky box is activated again, which starts from its definition.
 *
 * While an activation is loading its textures (a structural change, or setActiveSkyBox), an update
 * waits for it and then applies to what it showed: updates keep their call order, those made
 * meanwhile are applied as one (a slider drag), and one for a sky box that is no longer active
 * by then does nothing.
 * @returns the active sky box once the update is applied
 * @example
 * ```ts
 * import { updateSkyBox } from 'aekasha/skybox';
 *
 * // A storm rolls in: more clouds, a dimmer sun light (uniform writes, no reload)
 * void updateSkyBox('clearDay', {
 *   clouds: { coverage: 0.8, density: 0.7 },
 *   suns: { 0: { light: { intensity: 1 } } },
 * });
 * ```
 */
export const updateSkyBox = (id: string, update: SkyBoxUpdate): Promise<SkyBoxState | null> => {
  if (!activationInFlight) return applyUpdate(id, update);
  const queued = queuedUpdates.get(id);
  if (queued) queued.update = deepMerge(queued.update, update);
  else queuedUpdates.set(id, { update, settle: [] });
  return new Promise((resolve) => queuedUpdates.get(id)!.settle.push(resolve));
};

/** Applies the updates made while an activation was in flight, in call order (one may start
 * another activation: the ones after it wait for that). */
const applyQueuedUpdates = () => {
  const entries = [...queuedUpdates];
  queuedUpdates.clear();
  for (const [id, { update, settle }] of entries) {
    const applied = updateSkyBox(id, update);
    const resolve = (result: SkyBoxState | null) => settle.forEach((fn) => fn(result));
    void applied.then(resolve, () => resolve(active));
  }
};

const applyUpdate = async (id: string, update: SkyBoxUpdate) => {
  if (!active || active.id !== id) return active;
  const current = active;
  const def = mergeSkyBoxDef(current.def, update);
  if (update.dayNight) {
    if (isDayNightEnabled(def) && !isDayNightEnabled(current.def)) {
      resetSkyTimeState(current.time, def);
    } else {
      applyDayNightChange(current.time, update.dayNight);
    }
  }
  for (let i = 0; i < getMoonCount(def); i++) {
    const moonPhase = def.moons?.[i]?.phase;
    if (moonPhase !== undefined && moonPhase !== current.def.moons?.[i]?.phase) {
      setSkyTimeMoonPhase(current.time, i, moonPhase);
    }
  }
  // Only the moons with a texture: adding or removing a plain moon is a rebuild, not a reload
  const moonTexturesOf = (d: SkyBoxDef) =>
    JSON.stringify(
      d.moons?.slice(0, MAX_MOONS).flatMap((moon, i) => (moon.texture ? [[i, moon.texture]] : []))
    );
  if (
    isStructuralBaseUpdate(current.def.base, update.base) ||
    moonTexturesOf(def) !== moonTexturesOf(current.def)
  ) {
    return activate(current.sceneId, def, current.time);
  }

  applySkyUniforms(current.uniforms, def, current.time);
  if (needsRebuild(current, def)) {
    show({
      ...current,
      def,
      ...buildNodes(def, current.uniforms, current.textures.source, current.textures.moons),
    });
  } else {
    show({ ...current, def });
    // A drag re-bakes the nebulae at most every 150 ms; the env bake follows each of those
    if (update.nebulae) requestStaticLayersBake(true);
    // The env layer is scene properties and the view's blur, none of it baked; turning
    // `dynamic` on catches up on what changed while it was off
    const affectsBake = Object.keys(update).some((key) => key !== 'env' && key !== 'nebulae');
    const turnedDynamic = isBakeDynamic(def) && !isBakeDynamic(current.def);
    if (current.isComposite && ((affectsBake && isBakeDynamic(def)) || turnedDynamic)) {
      requestEnvBake();
    }
  }
  notify('update');
  return active;
};

/**
 * Removes the shown sky box (and resets the scene's environment intensity and rotation): the
 * feature's `exit` hook, `setActiveSkyBox(null)`, `stopSkyBox` and the legacy "no sky box".
 * @internal
 */
export const clearSkyBox = () => {
  activationSeq++;
  active = null;
  onClear?.();
  disposeEnvBake();
  disposeStaticLayers();
  deleteSkyLights();
  resetSceneProperties();
  notify('clear');
};

/**
 * Stops the sky box for good, for a mounted engine's `unmount()` (the feature's `onUnmount`): it's
 * cleared while the renderer and the ECS world still exist (its bakes disposed, its lights
 * deleted, the root scene's background and environment reset), the updates waiting for an
 * activation settle with null, and the change listeners are dropped.
 * @internal
 */
export const stopSkyBox = () => {
  const queued = [...queuedUpdates.values()];
  queuedUpdates.clear();
  clearSkyBox();
  listeners.clear();
  for (const { settle } of queued) settle.forEach((fn) => fn(null));
};

/**
 * Re-bakes the active sky box's environment on the next frame (at most one bake per frame,
 * and none while a scene loads). Only a composite sky box (procedural layers) has an env bake:
 * for any other this is a no-op. Useful with `env.dynamic: false`, which bakes only on
 * activation and rebuilds.
 */
export const bakeEnvironment = () => requestEnvBake();

/**
 * The source texture of the sky box the root scene shows, or null: the feature's
 * `retainedTextures` hook keeps it through a scene's asset release.
 * @internal
 */
export const getActiveSkyBoxTexture = () => active?.textures.source ?? null;

/**
 * The PMREM the root scene's environment samples, or null: for the env ball.
 * @internal
 */
export const getActiveEnvironmentTexture = () =>
  active?.nodes.environment ? active.textures.environment : null;

/**
 * Calls `listener` whenever the active sky box is activated, updated or cleared, after the change
 * shows. One added in scene code hears that scene's own sky box activate: the feature shows a
 * scene's default after its code has run.
 * @returns a function that removes the listener
 * @example
 * ```ts
 * import { onSkyBoxChange } from 'aekasha/skybox';
 *
 * // Keep the scene's own sun off while the sky box brings a sun light
 * const removeListener = onSkyBoxChange((skyBox) => {
 *   const sun = skyBox?.def.suns?.[0];
 *   mySunLight.visible = !(sun?.light && sun.light.enabled !== false);
 * });
 * ```
 */
export const onSkyBoxChange = (listener: SkyBoxChangeListener) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

// Debug

type SkyBoxGUIModule = typeof import('./debug/_dbg__SkyBox');
let debugGUI: DebugModuleRef<SkyBoxGUIModule> | null = null;

/**
 * Loads the sky box debug tab's module (the feature's `onDebug` hook; null outside the debug env).
 * @internal
 */
export const registerSkyBoxDebugGUI = async () => {
  debugGUI = await loadDebugModuleAsync(() => import('./debug/_dbg__SkyBox'));
};

/**
 * Builds the sky box debug tab, or rebuilds (default) or refreshes it: the feature's
 * `onDebugAfterStart` hook, and this module on every change. A no-op until its module has loaded.
 * @internal
 */
export const createSkyBoxDebugGUI = (opts?: { rebuild?: boolean }) => {
  useDebug(debugGUI)?._createSkyBoxDebugGUI(opts);
};
