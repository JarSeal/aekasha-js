// The fog's runtime (p106 D1, D3, D6): the current scene's fogs, the one showing, the master
// switch, the stable uniforms and the graph the root scene's `fogNode` holds, fogSystem (the
// transitions, the background) and the API. The `fog()` feature creates it at its install: without the feature,
// the getters return null and the setters throw naming it.
import * as THREE from 'three/webgpu';
import { type ECSWorld, getECSWorld } from '../../kernel/ecs/ECS';
import type { FeatureContext } from '../../kernel/init/Features';
import { getElapsedTime } from '../../kernel/loop/MainLoop';
import { ECSSystemStage } from '../../kernel/loop/SystemStages';
import { toThreeColor } from '../../kernel/render/ThreeMath';
import { getRootScene, type SceneData } from '../../kernel/scene/Scene';
import { isCurrentlyLoading } from '../../kernel/scene/SceneLoader';
import { deepMerge } from '../../utils/DeepMerge';
import { lwarn } from '../../utils/Logger';
import { createFogNodes, type FogNodes } from './FogNode';
import { type FogInput, type FogOverrides, resolveFogDef } from './FogSchema';
import {
  createFogTransitions,
  FOG_CHANNEL as CH,
  FOG_CHANNEL_COUNT,
  type FogTransitions,
  snapFogTransitions,
  startFogTransitions,
  stepFogTransitions,
} from './FogTransitions';
import type { FogDef, FogMode } from './FogTypes';

/** Why the fog changed: `set` (another fog, or a scene's own at its load), `update` (its values),
 * `enabled` (the master switch) or `clear` (none: a scene's exit, or `setFog(null)`). */
export type FogChangeReason = 'set' | 'update' | 'enabled' | 'clear';

/** A listener for {@link onFogChange}: the current fog (null without one) and why it changed. */
export type FogChangeListener = (fog: Readonly<FogDef> | null, reason: FogChangeReason) => void;

/** The running state, created by the feature's install. */
type FogRuntime = {
  /** The master switch (`setFogEnabled`): kept across scenes */
  isEnabled: boolean;
  /** The current scene's fogs (its data's `fogs`, resolved by the gatherer) */
  sceneFogs: readonly FogDef[];
  /** The fog showing, or null */
  current: FogDef | null;
  listeners: Set<FogChangeListener>;
  /** Made on the first fog that shows, or the first `getFogNodes()` */
  nodes: FogNodes | null;
  /** The root scene's background while `FOG_COLOR` holds it: the fog's colour, written in place */
  backgroundColor: THREE.Color;
  /** What the root scene's background was when `FOG_COLOR` took it, put back when it lets go */
  prevBackground: THREE.Scene['background'];
  /** The uniforms' numbers as they move (`updateFog`), toward the current fog's */
  transitions: FogTransitions;
  /** Scratch: the current fog's numbers, as the uniforms take them */
  targets: Float64Array;
  /** Scratch: the current fog's colour, linear */
  targetColor: THREE.Color;
  /** Last frame's `getElapsedTime()`: the transitions advance by the difference */
  lastElapsedTime: number;
};

let runtime: FogRuntime | null = null;

const assertInstalled = (caller: string): FogRuntime => {
  if (runtime) return runtime;
  throw new Error(
    `${caller}: the fog feature isn't installed. List fog() from 'aekasha/fog' in InitEngine's features.`
  );
};

const notify = (rt: FogRuntime, reason: FogChangeReason) => {
  for (const listener of rt.listeners) listener(rt.current, reason);
};

/** A scene's starting fog: the last with `isDefault`, else the first, else none. */
const getSceneDefaultFog = (fogs: readonly FogDef[]) => {
  for (let i = fogs.length - 1; i >= 0; i--) if (fogs[i].isDefault) return fogs[i];
  return fogs[0] ?? null;
};

/** Each mode's weights (`FogNodes.modeWeights`: x `LINEAR`, y `EXP2`, z `HEIGHT`). */
const MODE_WEIGHTS: Record<FogMode, readonly [number, number, number]> = {
  LINEAR: [1, 0, 0],
  EXP2: [0, 1, 0],
  HEIGHT: [0, 0, 1],
};

/** The least `far − near` the graph gets: its smoothstep divides by it. */
const MIN_LINEAR_RANGE = 1e-3;
/** The least sun glow exponent the graph gets: `pow(0, 0)` is undefined in WGSL. */
const MIN_SUN_EXPONENT = 1e-3;

const clamp01 = (value: number) => Math.min(Math.max(value, 0), 1);

/**
 * The current fog's numbers as the uniforms take them, into `rt.targets`. Kept drawable whatever a
 * debug edit or an update sets: no negative distance or density, the opacity and glow within
 * [0, 1]. A glow switched off is a strength of 0, so switching it moves like the numbers do.
 */
const computeTargets = (rt: FogRuntime, def: FogDef) => {
  const targets = rt.targets;
  const color = rt.targetColor.set(toThreeColor(def.color));
  targets[CH.COLOR_R] = color.r;
  targets[CH.COLOR_G] = color.g;
  targets[CH.COLOR_B] = color.b;
  const near = Math.max(def.linear.near, 0);
  targets[CH.NEAR] = near;
  targets[CH.FAR] = Math.max(def.linear.far, near + MIN_LINEAR_RANGE);
  targets[CH.EXP2_DENSITY] = Math.max(def.exp2.density, 0);
  const height = def.height;
  targets[CH.HEIGHT_DENSITY] = Math.max(height.density, 0);
  targets[CH.BASE_HEIGHT] = height.baseHeight;
  targets[CH.FALLOFF] = Math.max(height.falloff, 0);
  targets[CH.START_DISTANCE] = Math.max(height.startDistance, 0);
  targets[CH.MAX_OPACITY] = clamp01(height.maxOpacity);
  const sun = def.sunScattering;
  targets[CH.SUN_STRENGTH] = sun.enabled ? clamp01(sun.strength) : 0;
  targets[CH.SUN_EXPONENT] = Math.max(sun.exponent, MIN_SUN_EXPONENT);
};

/** Writes the channels' values into the uniforms. Allocates nothing. */
const writeChannels = (nodes: FogNodes, values: Float64Array) => {
  nodes.color.value.setRGB(values[CH.COLOR_R], values[CH.COLOR_G], values[CH.COLOR_B]);
  const near = values[CH.NEAR];
  nodes.near.value = near;
  // near and far move on their own clocks: keep the far past the near on the way
  nodes.far.value = Math.max(values[CH.FAR], near + MIN_LINEAR_RANGE);
  nodes.exp2Density.value = values[CH.EXP2_DENSITY];
  nodes.heightDensity.value = values[CH.HEIGHT_DENSITY];
  nodes.baseHeight.value = values[CH.BASE_HEIGHT];
  nodes.falloff.value = values[CH.FALLOFF];
  nodes.startDistance.value = values[CH.START_DISTANCE];
  nodes.maxOpacity.value = values[CH.MAX_OPACITY];
  // The sun's direction and colour come from p106 Phase 3's sun source; until then they're set
  // on the nodes by hand, and the zero direction they start with glows nowhere
  nodes.sunStrength.value = values[CH.SUN_STRENGTH];
  nodes.sunExponent.value = values[CH.SUN_EXPONENT];
};

/** Writes the current fog into the uniforms (when they exist): the switch and the mode at once,
 * the numbers where their transitions are. Runs on a change; `fogSystem` writes the numbers while
 * they move. */
const writeNodes = (rt: FogRuntime) => {
  const nodes = rt.nodes;
  if (!nodes) return;
  const def = rt.current;
  nodes.enabled.value = def && def.enabled && rt.isEnabled ? 1 : 0;
  if (!def) return;
  nodes.modeWeights.value.fromArray(MODE_WEIGHTS[def.mode]);
  writeChannels(nodes, rt.transitions.values);
};

/** Shows `def` (or none) at once: a running transition ends there (at its target, with none). */
const setCurrent = (rt: FogRuntime, def: FogDef | null) => {
  rt.current = def;
  if (def) computeTargets(rt, def);
  snapFogTransitions(rt.transitions, def ? rt.targets : rt.transitions.targets);
  writeNodes(rt);
};

const ensureNodes = (rt: FogRuntime) => {
  if (!rt.nodes) {
    rt.nodes = createFogNodes();
    writeNodes(rt);
  }
  return rt.nodes;
};

/** Puts the graph on the root scene (once a scene's materials would build without it, a
 * recompile of each); it stays until the scene's exit, so switching fogs or `setFog(null)` never
 * recompiles. */
const showFogNode = (rt: FogRuntime) => {
  const rootScene = getRootScene();
  if (rootScene) rootScene.fogNode = ensureNodes(rt).node;
};

/** Puts back the background `FOG_COLOR` took, if it holds it. */
const releaseBackground = (rt: FogRuntime, rootScene: THREE.Scene) => {
  if (rootScene.background !== rt.backgroundColor) return;
  rootScene.background = rt.prevBackground;
  rt.prevBackground = null;
};

/**
 * `FOG_COLOR`: the root scene's background is the fog's colour while the fog renders and no sky
 * box shows a background (no `backgroundNode`, no texture). It takes the scene's own background
 * colour too, and puts it back when it lets go. Allocates nothing.
 */
const syncBackground = (rt: FogRuntime) => {
  const rootScene = getRootScene();
  if (!rootScene) return;
  const def = rt.current;
  const background = rootScene.background;
  const isWanted =
    rt.nodes !== null &&
    rt.nodes.enabled.value === 1 &&
    def?.background === 'FOG_COLOR' &&
    !rootScene.backgroundNode &&
    !(background as THREE.Texture | null)?.isTexture;
  if (!isWanted) {
    releaseBackground(rt, rootScene);
    return;
  }
  if (background !== rt.backgroundColor) {
    rt.prevBackground = background;
    rootScene.background = rt.backgroundColor;
  }
  rt.backgroundColor.copy(rt.nodes!.color.value);
};

/**
 * The fog showing (read-only: copy what you keep), or null without one or without the `fog()`
 * feature.
 * @example
 * ```ts
 * import { getFog } from 'aekasha/fog';
 *
 * const isFoggy = getFog()?.mode === 'HEIGHT';
 * ```
 */
export const getFog = (): Readonly<FogDef> | null => runtime?.current ?? null;

/**
 * Shows another fog: one of the current scene's `fogs` by its id, a definition made in code (its
 * missing keys from the defaults, its sun glow from its mode), or none (null). An id the scene
 * doesn't list warns and changes nothing.
 * @returns the fog showing after the call
 * @throws when the `fog()` feature isn't installed
 * @remarks Switching fogs, and `null`, never recompile a material; the first fog in a scene that
 * started without one compiles each once more. A scene's exit clears it: the next scene starts
 * with its own default fog.
 * @example
 * ```ts
 * import { setFog } from 'aekasha/fog';
 *
 * // One of the scene's JSON `fogs`
 * setFog('valleyMorning');
 * // A fog made in code
 * setFog({ id: 'smoke', mode: 'EXP2', colorSource: 'MANUAL', color: '#3a3430', exp2: { density: 0.04 } });
 * ```
 */
export const setFog = (fog: string | FogInput | null): Readonly<FogDef> | null => {
  const rt = assertInstalled('setFog');
  if (fog === null) {
    if (!rt.current) return null;
    setCurrent(rt, null);
    notify(rt, 'clear');
    return null;
  }
  if (typeof fog === 'string') {
    const found = rt.sceneFogs.find((sceneFog) => sceneFog.id === fog);
    if (!found) {
      lwarn(`setFog: the current scene has no fog with the id '${fog}' (its JSON's fogs).`);
      return rt.current;
    }
    setCurrent(rt, found);
  } else {
    setCurrent(rt, resolveFogDef(fog));
  }
  showFogNode(rt);
  notify(rt, 'set');
  return rt.current;
};

/** The values {@link updateFog} takes: any of a fog's but its id, `isDefault` and debug data. */
export type FogUpdate = Omit<FogOverrides, '__meta'>;

/** Options of {@link updateFog}. */
export type UpdateFogOpts = {
  /** Moves each number and the colour there over this many seconds, linearly (the colour in
   * linear space). Default 0: at once. `mode`, `enabled`, `colorSource` and `background` always
   * switch at once; the sun glow's `enabled` fades its strength. */
  transitionSec?: number;
};

/** `values` without its non-finite numbers (and a colour with one), so they're ignored. */
const withoutNonFinite = (values: object) => {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    if (typeof value === 'number' && !Number.isFinite(value)) continue;
    if (key === 'color' && typeof value === 'object' && value !== null) {
      const { r, g, b } = value as { r: number; g: number; b: number };
      if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) result[key] = value;
      continue;
    }
    result[key] =
      typeof value === 'object' && value !== null && !Array.isArray(value)
        ? withoutNonFinite(value)
        : value;
  }
  return result;
};

/**
 * Changes the fog showing: any of its values, at once or over `transitionSec` (the main loop's
 * time, as the sky's day-night runs, standing still while a scene loads). What p427's weather
 * drives. A number that isn't finite is ignored; each is kept drawable (no negative distance or
 * density, the opacity and the glow's strength within [0, 1]).
 * @returns the fog after the call (what it moves to), or null when none shows (warned)
 * @throws when the `fog()` feature isn't installed
 * @remarks {@link getFog} returns the values it moves to at once; only the rendered values move.
 * The latest call wins per value: one made while a value moves starts its transition again from
 * where it is, and the values it doesn't change keep moving. Another fog (`setFog`) and a scene's
 * exit end every transition. The scene's data isn't changed: the next visit starts from its JSON.
 * `onFogChange` hears `'update'` once a call, not while the values move.
 * @example
 * ```ts
 * import { updateFog } from 'aekasha/fog';
 *
 * // The valley fills with fog over the next minute
 * updateFog({ height: { density: 0.08, maxOpacity: 0.95 }, color: '#9aa3ad' }, { transitionSec: 60 });
 * ```
 */
export const updateFog = (values: FogUpdate, opts?: UpdateFogOpts): Readonly<FogDef> | null => {
  const rt = assertInstalled('updateFog');
  const def = rt.current;
  if (!def) {
    lwarn('updateFog: no fog shows (show one with setFog, or list it in the scene JSON fogs).');
    return null;
  }
  // A new object: the one it replaces can be the scene's data
  const next = deepMerge(def, withoutNonFinite(values));
  rt.current = next;
  computeTargets(rt, next);
  startFogTransitions(rt.transitions, rt.targets, opts?.transitionSec ?? 0);
  writeNodes(rt);
  notify(rt, 'update');
  return next;
};

/**
 * Switches the whole fog on or off, whichever fog shows, without a recompile. It's kept across
 * scenes; a fog's own `enabled` switches only that fog.
 * @throws when the `fog()` feature isn't installed
 * @example
 * ```ts
 * import { isFogEnabled, setFogEnabled } from 'aekasha/fog';
 *
 * // A graphics setting
 * setFogEnabled(!isFogEnabled());
 * ```
 */
export const setFogEnabled = (isEnabled: boolean) => {
  const rt = assertInstalled('setFogEnabled');
  if (rt.isEnabled === isEnabled) return;
  rt.isEnabled = isEnabled;
  writeNodes(rt);
  notify(rt, 'enabled');
};

/**
 * Whether the fog is switched on as a whole ({@link setFogEnabled}), or null without the `fog()`
 * feature.
 */
export const isFogEnabled = () => runtime?.isEnabled ?? null;

/**
 * Calls `listener` whenever the fog changes: another one shows, its values change, the master
 * switch flips or it's cleared.
 * @returns a function that removes the listener
 * @throws when the `fog()` feature isn't installed
 * @example
 * ```ts
 * import { onFogChange } from 'aekasha/fog';
 *
 * const removeListener = onFogChange((fog, reason) => {
 *   if (reason === 'set') myHud.setWeatherLabel(fog?.id ?? 'clear');
 * });
 * ```
 */
export const onFogChange = (listener: FogChangeListener) => {
  const rt = assertInstalled('onFogChange');
  rt.listeners.add(listener);
  return () => {
    rt.listeners.delete(listener);
  };
};

/**
 * The fog's uniforms and its graph (made on the first call or the first fog shown, the same ones
 * after), or null without the `fog()` feature. The feature puts `node` on the root scene only;
 * another scene drawn on its own (a viewport's) gets the same fog by taking it too.
 * @example
 * ```ts
 * import { getFogNodes } from 'aekasha/fog';
 *
 * // The fog in a viewport's own scene too (the fog's values stay the root scene's)
 * const fogNodes = getFogNodes();
 * if (fogNodes) myViewportScene.fogNode = fogNodes.node;
 * ```
 */
export const getFogNodes = (): FogNodes | null => (runtime ? ensureNodes(runtime) : null);

/** The transitions and the background each frame (`FOG_COLOR`). The fog is global: only the
 * default world drives it. Allocates nothing. */
function fogSystem(world: ECSWorld) {
  const rt = runtime;
  if (!rt || world !== getECSWorld()) return;
  // The sky's clock (its day-night): the main loop's elapsed time, standing still while a scene
  // loads
  const elapsed = getElapsedTime();
  const dt = elapsed - rt.lastElapsedTime;
  rt.lastElapsedTime = elapsed;
  if (!isCurrentlyLoading() && stepFogTransitions(rt.transitions, dt) && rt.nodes) {
    writeChannels(rt.nodes, rt.transitions.values);
  }
  syncBackground(rt);
}

/**
 * A scene's exit: no fog, none of its fogs, the graph off the root scene (the next scene's
 * materials build without it unless it has a fog) and the background put back.
 * @internal
 */
export const clearFogForScene = () => {
  const rt = runtime;
  if (!rt) return;
  rt.sceneFogs = [];
  const rootScene = getRootScene();
  if (rootScene) {
    if (rt.nodes && rootScene.fogNode === rt.nodes.node) rootScene.fogNode = null;
    releaseBackground(rt, rootScene);
  }
  rt.prevBackground = null;
  if (!rt.current) return;
  setCurrent(rt, null);
  notify(rt, 'clear');
};

/**
 * The next scene's fogs (its data's `fogs`) and its default one, with the graph on the root
 * scene, before its scene code and its materials build.
 * @internal
 */
export const applySceneFogs = (sceneData: SceneData) => {
  const rt = runtime;
  if (!rt) return;
  rt.sceneFogs = sceneData.fogs ?? [];
  const def = getSceneDefaultFog(rt.sceneFogs);
  if (!def) return;
  setCurrent(rt, def);
  showFogNode(rt);
  notify(rt, 'set');
};

/**
 * Creates the running state and registers `fogSystem` (the `fog()` feature's install).
 * @internal
 */
export const installFog = (ctx: FeatureContext) => {
  runtime = {
    isEnabled: true,
    sceneFogs: [],
    current: null,
    listeners: new Set(),
    nodes: null,
    backgroundColor: new THREE.Color(),
    prevBackground: null,
    transitions: createFogTransitions(),
    targets: new Float64Array(FOG_CHANNEL_COUNT),
    targetColor: new THREE.Color(),
    lastElapsedTime: getElapsedTime(),
  };
  ctx.registerPlugin((world) => {
    // MAIN, order 1 like skyBoxSystem, after it by install order: p106 Phase 3's sources read
    // this frame's sky
    world.addSystem(ECSSystemStage.MAIN, 'fogSystem', fogSystem, 1);
  });
};
