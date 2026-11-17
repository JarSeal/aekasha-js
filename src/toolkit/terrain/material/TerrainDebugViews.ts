// The terrain material's debug views' loader (p305 D10): the thin side of
// `debug/_dbg__DebugViews.ts`, which loads only through the `import()` here behind `IS_DEBUG_ENV`
// (a production build folds it away). The graph is built synchronously, so a material whose define
// names a view finds the module here once something has loaded it (the gallery's tab does).
import { IS_DEBUG_ENV } from 'aekasha';
import type * as DebugViews from '../debug/_dbg__DebugViews';

let debugViews: typeof DebugViews | null = null;

/**
 * Loads the terrain material's debug views (debug env only), so a material whose config names a
 * `debugView` builds it: the graph is built synchronously and can't wait for the module. A
 * material created before the load builds without its view (warned, the load started). Loads
 * once; resolves false outside the debug env, where the views are ignored.
 * @returns whether the debug views are loaded
 * @example
 * ```ts
 * import { createTerrainMaterial, loadTerrainDebugViewsAsync } from 'aekasha/toolkit/terrain';
 *
 * // A meadow showing its texel density (debug env)
 * if (await loadTerrainDebugViewsAsync()) {
 *   createTerrainMaterial({
 *     id: 'meadowDensity',
 *     layers: [{ set: 'grass01' }],
 *     debugView: 'TEXEL_DENSITY',
 *   });
 * }
 * ```
 */
export const loadTerrainDebugViewsAsync = async () => {
  if (IS_DEBUG_ENV) {
    debugViews ??= await import('../debug/_dbg__DebugViews');
    return true;
  }
  return false;
};

/**
 * The loaded debug views module, or null before `loadTerrainDebugViewsAsync` (or outside the
 * debug env).
 * @internal
 */
export const getLoadedTerrainDebugViews = () => debugViews;
