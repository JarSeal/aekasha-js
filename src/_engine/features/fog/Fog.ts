// The fog's runtime (p106 D1, D3, D6): the current scene's fogs, the one showing, the master
// switch and the API. The `fog()` feature creates it at its install: without the feature, the
// getters return null and the setters throw naming it.
import type { SceneData } from '../../kernel/scene/Scene';
import { lwarn } from '../../utils/Logger';
import { type FogInput, resolveFogDef } from './FogSchema';
import type { FogDef } from './FogTypes';

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
 * @remarks A scene's exit clears it: the next scene starts with its own default fog.
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
  notify(rt, 'set');
  return rt.current;
};

/**
 * Switches the whole fog on or off, whichever fog shows. It's kept across scenes; a fog's own
 * `enabled` switches only that fog.
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
 * A scene's exit: no fog, and none of its fogs.
 * @internal
 */
export const clearFogForScene = () => {
  const rt = runtime;
  if (!rt) return;
  rt.sceneFogs = [];
  if (!rt.current) return;
  rt.current = null;
  notify(rt, 'clear');
};

/**
 * The next scene's fogs (its data's `fogs`) and its default one, before its scene code runs.
 * @internal
 */
export const applySceneFogs = (sceneData: SceneData) => {
  const rt = runtime;
  if (!rt) return;
  rt.sceneFogs = sceneData.fogs ?? [];
  rt.current = getSceneDefaultFog(rt.sceneFogs);
  if (rt.current) notify(rt, 'set');
};

/**
 * Creates the running state (the `fog()` feature's install).
 * @internal
 */
export const installFog = () => {
  runtime = { isEnabled: true, sceneFogs: [], current: null, listeners: new Set() };
};
