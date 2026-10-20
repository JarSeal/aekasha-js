import { lerror } from '../../utils/Logger';
import { IS_DEBUG_ENV, IS_PROD_TEST_MODE } from './Config';

/**
 * A debug module that loads asynchronously: `current` is null until it has loaded (and stays null
 * outside the debug env). Read it through {@link useDebug}.
 * @template T the module's shape (`typeof import('./debug/_dbg__X')`)
 */
export interface DebugModuleRef<T> {
  /** The loaded module, or null. */
  current: T | null;
}

/**
 * Starts loading a debug module (debug env only) and returns its ref at once; `current` is set
 * when the import resolves. Returns null in production and outside the debug env, where the
 * importer and its chunk fold away.
 * @template T the module's shape, inferred from the importer
 */
export function loadDebugModule<T>(
  importer: () => Promise<T>,
  debugId?: string
): DebugModuleRef<T> | null {
  // A production build drops the importer, and with it the debug chunk (the module is still
  // loaded: a `?url` import in it still emits its file, see `debug/symbols/3DSymbols.ts`)
  if (!__AEK_DEBUG__) return null;
  if (!IS_DEBUG_ENV) return null;
  const ref: DebugModuleRef<T> = { current: null };
  importer()
    .then((module) => {
      ref.current = module;
    })
    .catch((err) => {
      const msg = `Debug module loading failed${debugId ? `: ${debugId}` : ''}.`;
      lerror(msg);
      throw new Error(`${msg} ${err.message}`);
    });
  return ref;
}

/**
 * Loads a debug module (debug env; prod test mode too with `includeInProdTestMode`) and resolves
 * with its ref once it's loaded, or with null in production and other modes, where the importer and
 * its chunk fold away.
 * @template T the module's shape, inferred from the importer
 */
export async function loadDebugModuleAsync<T>(
  importer: () => Promise<T>,
  // No default value: Rollup drops a call's arguments only when every parameter is unused, and a
  // default counts as a use, so `true` would keep the importer and its chunk
  includeInProdTestMode?: boolean,
  debugId?: string
): Promise<DebugModuleRef<T> | null> {
  // A production build drops the importer, and with it the debug chunk
  if (!__AEK_DEBUG__) return null;
  if (!IS_DEBUG_ENV && !(includeInProdTestMode && IS_PROD_TEST_MODE)) return null;
  const ref: DebugModuleRef<T> = { current: null };
  return importer()
    .then((module) => {
      ref.current = module;
      return ref;
    })
    .catch((err) => {
      const msg = `Debug module async loading failed${debugId ? `: ${debugId}` : ''}.`;
      lerror(msg);
      throw new Error(`${msg} ${err.message}`);
    });
}

/**
 * Whether the debug env is on and the module has loaded (narrows `ref.current` to the module).
 * @template T the module's shape
 * @example
 * ```ts
 * if (isDebugReady(debugHelpers)) debugHelpers.current.update();
 * ```
 */
export const isDebugReady = <T>(ref: DebugModuleRef<T>): ref is { current: T } =>
  // `__AEK_DEBUG__` first: a production build folds the check to false, and its callers' code out
  __AEK_DEBUG__ && !!(IS_DEBUG_ENV && ref?.current);

/**
 * The module when it's loaded and its mode is on (the debug env, or prod test mode with
 * `includeInProdTestMode`), else undefined: call through it as `useDebug(ref)?.fn()`.
 * @template T the module's shape
 */
export const useDebug = <T>(
  ref: DebugModuleRef<T> | null,
  includeInProdTestMode: boolean = false
): T | undefined =>
  // `__AEK_DEBUG__` first: a production build folds the result to undefined, so a wrapper's
  // `useDebug(ref)?.fn()` and the wrapper itself leave the bundle
  __AEK_DEBUG__ && (IS_DEBUG_ENV || (includeInProdTestMode && IS_PROD_TEST_MODE)) && ref?.current
    ? ref.current
    : undefined;
