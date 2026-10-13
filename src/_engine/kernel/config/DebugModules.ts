import { lerror } from '../../utils/Logger';
import { IS_DEBUG_ENV } from './Config';

/** A container for a module that will be loaded asynchronously.
 */
export interface DebugModuleRef<T> {
  current: T | null;
}

/**
 * Loads a lazy debug module.
 * TypeScript infers the module shape 'T' directly from the importer.
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
 * Loads a lazy debug module.
 * TypeScript infers the module shape 'T' directly from the importer.
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
  if (!IS_DEBUG_ENV && !includeInProdTestMode) return null;
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
 * Type Guard: Checks if we are in Debug mode AND the module is loaded.
 *
 * Usage: if (isDebugReady(debugHelpers)) {
 *   const { current } = debugHelpers;
 * }
 */
export const isDebugReady = <T>(ref: DebugModuleRef<T>): ref is { current: T } =>
  // `__AEK_DEBUG__` first: a production build folds the check to false, and its callers' code out
  __AEK_DEBUG__ && !!(IS_DEBUG_ENV && ref?.current);

/**
 * Accessor: Returns the module if debug is active and loaded, otherwise undefined.
 * Usage: useDebug(debugHelpers)?.attach(...)
 */
export const useDebug = <T>(
  ref: DebugModuleRef<T> | null,
  includeInProdTestMode: boolean = false
): T | undefined =>
  // `__AEK_DEBUG__` first: a production build folds the result to undefined, so a wrapper's
  // `useDebug(ref)?.fn()` and the wrapper itself leave the bundle
  __AEK_DEBUG__ && (IS_DEBUG_ENV || includeInProdTestMode) && ref?.current
    ? ref.current
    : undefined;
