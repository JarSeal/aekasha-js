// The fog's runtime (p106 D1, D3, D6): the current scene's fogs, the one showing, the master
// switch, the stable uniforms and the graph the root scene's `fogNode` holds, fogSystem (the
// background) and the API. The `fog()` feature creates it at its install: without the feature,
// the getters return null and the setters throw naming it.
import * as THREE from 'three/webgpu';
import { IS_DEBUG_ENV } from '../../kernel/config/Config';
import { type ECSWorld, getECSWorld } from '../../kernel/ecs/ECS';
import type { FeatureContext } from '../../kernel/init/Features';
import { ECSSystemStage } from '../../kernel/loop/SystemStages';
import { toThreeColor } from '../../kernel/render/ThreeMath';
import { getRootScene, type SceneData } from '../../kernel/scene/Scene';
import { lwarn } from '../../utils/Logger';
import { createFogNodes, type FogNodes } from './FogNode';
import { type FogInput, resolveFogDef } from './FogSchema';
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
  /** The debug env has warned that `HEIGHT` doesn't render yet */
  hasWarnedHeight: boolean;
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
  // p106 Phase 2 builds HEIGHT's factor: until then it renders no fog
  HEIGHT: [0, 0, 0],
};

/** The least `far − near` the graph gets: its smoothstep divides by it. */
const MIN_LINEAR_RANGE = 1e-3;

/** Writes the current fog into the uniforms (when they exist). Runs on a change, not per frame. */
const writeNodes = (rt: FogRuntime) => {
  const nodes = rt.nodes;
  if (!nodes) return;
  const def = rt.current;
  nodes.enabled.value = def && def.enabled && rt.isEnabled ? 1 : 0;
  if (!def) return;
  nodes.modeWeights.value.fromArray(MODE_WEIGHTS[def.mode]);
  nodes.color.value.set(toThreeColor(def.color));
  // Kept drawable whatever a debug edit or an update sets: no negative distance or density, and
  // a far past the near
  const near = Math.max(def.linear.near, 0);
  nodes.near.value = near;
  nodes.far.value = Math.max(def.linear.far, near + MIN_LINEAR_RANGE);
  nodes.exp2Density.value = Math.max(def.exp2.density, 0);
  if (IS_DEBUG_ENV && def.mode === 'HEIGHT' && !rt.hasWarnedHeight) {
    rt.hasWarnedHeight = true;
    lwarn(`The fog '${def.id}' is HEIGHT, which renders no fog yet (p106 Phase 2).`);
  }
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
    rt.current = null;
    writeNodes(rt);
    notify(rt, 'clear');
    return null;
  }
  if (typeof fog === 'string') {
    const found = rt.sceneFogs.find((sceneFog) => sceneFog.id === fog);
    if (!found) {
      lwarn(`setFog: the current scene has no fog with the id '${fog}' (its JSON's fogs).`);
      return rt.current;
    }
    rt.current = found;
  } else {
    rt.current = resolveFogDef(fog);
  }
  writeNodes(rt);
  showFogNode(rt);
  notify(rt, 'set');
  return rt.current;
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

/** The background each frame (`FOG_COLOR`). The fog is global: only the default world drives
 * it. Allocates nothing. */
function fogSystem(world: ECSWorld) {
  const rt = runtime;
  if (!rt || world !== getECSWorld()) return;
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
  rt.current = null;
  writeNodes(rt);
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
  rt.current = getSceneDefaultFog(rt.sceneFogs);
  if (!rt.current) return;
  writeNodes(rt);
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
    hasWarnedHeight: false,
  };
  ctx.registerPlugin((world) => {
    // MAIN, order 1 like skyBoxSystem, after it by install order: p106 Phase 3's sources read
    // this frame's sky
    world.addSystem(ECSSystemStage.MAIN, 'fogSystem', fogSystem, 1);
  });
};
