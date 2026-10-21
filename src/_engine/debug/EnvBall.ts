import { IS_DEBUG_ENV } from '../kernel/config/Config';
import type { DebugModuleRef } from '../kernel/config/DebugModules';
import { loadDebugModuleAsync, useDebug } from '../kernel/config/DebugModules';

/**
 * The environment ball's settings (the Debug tools tab's `envBall` state).
 * @internal
 */
export type EnvBallOpts = {
  /** Shown while the debug camera is active */
  show: boolean;
  /** Shown while the main camera is active too */
  showInMainCamera: boolean;
  /** The roughness it samples the environment at, 0-1 */
  roughness: number;
};

type EnvBallModule = typeof import('./_dbg__EnvBall');
let debugEnvBall: DebugModuleRef<EnvBallModule> | null = null;

/**
 * Loads the environment ball module (debug environments only). The boot's.
 * @internal
 */
export const registerEnvBallModule = async () => {
  if (!IS_DEBUG_ENV) return;
  debugEnvBall = await loadDebugModuleAsync(() => import('./_dbg__EnvBall'));
};

/**
 * Creates the environment ball: a reflective sphere left of the axes gizmo, showing the
 * environment map PBR materials sample and following the active camera (debug environments
 * only). The Debug tools tab's.
 * @internal
 * @param opts (object) {@link EnvBallOpts}
 */
export const initEnvBall = (opts: EnvBallOpts) => {
  useDebug(debugEnvBall)?._initEnvBall(opts);
};

/**
 * Shows or hides the environment ball (it is only shown while the debug camera is active,
 * unless showInMainCamera is on, and only while there is an environment). The Debug tools tab's.
 * @internal
 * @param show (boolean)
 */
export const setEnvBallVisible = (show: boolean) => {
  useDebug(debugEnvBall)?._setEnvBallVisible(show);
};

/**
 * Sets whether the environment ball is also shown while the main (gameplay) camera is active. The
 * Debug tools tab's.
 * @internal
 * @param show (boolean)
 */
export const setEnvBallInMainCamera = (show: boolean) => {
  useDebug(debugEnvBall)?._setEnvBallInMainCamera(show);
};

/**
 * Sets the roughness the environment ball samples the environment at (0 = mirror, 1 = fully
 * diffuse). The Debug tools tab's.
 * @internal
 * @param roughness (number) 0-1
 */
export const setEnvBallRoughness = (roughness: number) => {
  useDebug(debugEnvBall)?._setEnvBallRoughness(roughness);
};
