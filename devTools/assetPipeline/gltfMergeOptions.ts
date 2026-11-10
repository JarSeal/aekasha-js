import type { ImportedAssetMerge } from '../../src/_engine/schemas';

/**
 * A GLB's `merge` (p371 D3) as the pipeline keys and records it: its options, its version and
 * its stats. Apart from `gltfMerge.ts`, which loads gltf-transform: the pipeline computes a key
 * without loading it.
 */

/**
 * Bump when what the step writes changes for the same file and options: the cache key has it
 * (only for a JSON with `merge`).
 */
export const GLTF_MERGE_VERSION = 1;

/** `merge` with its defaults */
export type ResolvedMergeOptions = { mode: 'BY_MATERIAL' | 'ALL'; exclude: string[] };

/** A merged node, as the lock records it */
export type MergedNodeStats = {
  /** The node's name in the file: the import's geometry id is `<importId>/<name>` */
  name: string;
  /** The glTF material's name (`material<index>` when it has none), null for none; `ALL`'s is
   * its first piece's */
  material: string | null;
  /** The primitives joined (a mesh two nodes use counts twice) */
  parts: number;
  vertices: number;
  triangles: number;
};

/** What the step did, as the lock records it */
export type GLTFMergeStats = {
  mode: ResolvedMergeOptions['mode'];
  merged: MergedNodeStats[];
  /** Mesh nodes kept as they are, by reason (a kept node's descendants count as kept too) */
  kept: { excluded: number; physics: number; unsupported: number };
};

/** A merge's line in the run's output: `merged 20 pieces into __merged (kept 2 excluded)` */
export const describeMerge = ({ merged, kept }: GLTFMergeStats) => {
  const parts = merged.reduce((sum, node) => sum + node.parts, 0);
  const into = merged.length ? merged.map((node) => node.name).join(', ') : 'nothing';
  const keptList = Object.entries(kept)
    .filter(([, count]) => count)
    .map(([reason, count]) => `${count} ${reason}`);
  const keptText = keptList.length ? ` (kept ${keptList.join(', ')})` : '';
  return `merged ${parts} piece${parts === 1 ? '' : 's'} into ${into}${keptText}`;
};

/** The defaults of `merge` (`true`, or an object's missing keys) */
export const resolveMergeOptions = (merge: ImportedAssetMerge): ResolvedMergeOptions =>
  merge === true
    ? { mode: 'BY_MATERIAL', exclude: [] }
    : { mode: merge.mode ?? 'BY_MATERIAL', exclude: merge.exclude ?? [] };
