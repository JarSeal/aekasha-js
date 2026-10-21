/**
 * The feature view (p611 D3): each engine feature's group (`_engine/features/<name>`) with its
 * initial and lazy sizes, why it's in the initial chunks (the shortest static import chain from
 * the entry), and the scenes whose data needs it (their `__features`, the gathered manifest).
 *
 * Only the features with a schema part can be in a manifest (`ENGINE_SCHEMA_PARTS`: the sky box,
 * PostFX, spatial, LOD); the rest are used by code alone, which the manifest doesn't see. A
 * feature with a part in the initial chunks that no scene's data needs is marked: code may still
 * use it, but it's the first place to look.
 */
import type { SplitGroupSize } from './bundleSplit';
import { type ImportChain, type ModuleGraph, findBestImportChain } from './bundleWhy';

/** The start of an engine feature's group (`getModuleGroup`) */
export const FEATURE_GROUP_PREFIX = '_engine/features/';

/** An engine feature in the build: a row of the feature view */
export type FeatureRow = {
  /** The feature's folder and id (`physics`, `skybox`) */
  feature: string;
  initialGzip: number;
  lazyGzip: number;
  /** The static chain to its nearest module with code in the initial chunks; null when it has
   * none there */
  why: ImportChain | null;
  /** Whether scene data can name it (it has a schema part) */
  hasDataPart: boolean;
  /** The scenes whose `__features` list it, sorted */
  scenes: string[];
  /** In the initial chunks with a schema part, and no scene's data needs it */
  isUnneededByData: boolean;
};

/**
 * A row per engine feature: its sizes, why it's in the initial chunks and the scenes needing it.
 * @param opts.groups every group's split sizes (`measureSplitGroups`)
 * @param opts.scenes each scene's `__features` (the profile's production scenes)
 * @param opts.dataFeatures the features a manifest can name (the schema parts' `feature`)
 * @returns a row per feature with code anywhere in the build, by name
 */
export const buildFeatureView = (opts: {
  graph: ModuleGraph;
  from: string;
  groups: Record<string, SplitGroupSize>;
  scenes: Record<string, string[]>;
  dataFeatures: readonly string[];
}): FeatureRow[] =>
  Object.entries(opts.groups)
    .filter(([group]) => group.startsWith(FEATURE_GROUP_PREFIX))
    .map(([group, size]): FeatureRow => {
      const feature = group.slice(FEATURE_GROUP_PREFIX.length);
      const prefix = `/src/${group}/`;
      const why = size.initial.gzip
        ? findBestImportChain(
            opts.graph,
            opts.from,
            (id) => id.startsWith(prefix) && opts.graph.load.get(id) === 'initial',
            { dynamic: false }
          )
        : null;
      const hasDataPart = opts.dataFeatures.includes(feature);
      const scenes = Object.entries(opts.scenes)
        .filter(([, features]) => features.includes(feature))
        .map(([id]) => id)
        .sort();
      return {
        feature,
        initialGzip: size.initial.gzip,
        lazyGzip: size.lazy.gzip,
        why,
        hasDataPart,
        scenes,
        isUnneededByData: !!size.initial.gzip && hasDataPart && !scenes.length,
      };
    })
    .sort((a, b) => a.feature.localeCompare(b.feature));

/** Each production scene's `__features` from the gathered data: debug scenes (`isDebugScene`,
 * which a production gather leaves out) and scenes without a manifest skipped
 * @param only the profile's scene ids; all when omitted */
export const readSceneFeatures = (
  appData: { scenes?: Record<string, { isDebugScene?: boolean; __features?: string[] }> },
  only?: readonly string[]
): Record<string, string[]> =>
  Object.fromEntries(
    Object.entries(appData.scenes ?? {})
      .filter(
        ([id, scene]) => !scene.isDebugScene && scene.__features && (!only || only.includes(id))
      )
      .map(([id, scene]) => [id, scene.__features!])
  );
