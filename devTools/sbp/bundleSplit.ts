/**
 * The initial / lazy split (p611 Phase 1): what loads before the first frame and what loads on
 * demand. Initial is the entry chunk, every chunk it imports statically (the manifest's `imports`,
 * transitively) and their CSS; everything else in `dist/assets/` is lazy: the `import()`ed chunks,
 * the workers and their chunks (which the manifest doesn't list), and the files code reaches by
 * URL (`?url`, the GLBs and images).
 */
import {
  type GroupSize,
  type Manifest,
  type ModuleSizesFile,
  type Size,
  addGroupSize,
  sortKeys,
} from './bundleModel';

/** When a file loads: before the first frame, or on demand */
export type ChunkLoad = 'initial' | 'lazy';

/** A build's files split by when they load */
export type BundleSplit = {
  /** Keys (`assets/index.js`) of what loads before the first frame, sorted */
  initial: string[];
  /** Keys of the rest, sorted */
  lazy: string[];
  /** The hashed names of the initial files (`assets/index-Bd_fo_yS.js`): the module sizes and
   * the visualizer's `moduleParts` name chunks so */
  initialFiles: Set<string>;
};

/** A group's modules in the initial chunks and in the lazy ones, each chunk's gzip summed (a
 * module in both counts twice: a worker's copy is bytes loaded again) */
export type SplitGroupSize = Record<ChunkLoad, GroupSize>;

/**
 * Splits a build's files into initial and lazy.
 * @param manifest Vite's manifest
 * @param fileKeys every file in `dist/assets/`: hashed name → key (`keyBuildFiles`)
 * @throws when the manifest names no entry, or an entry's file isn't in `fileKeys`
 */
export const splitBundle = (manifest: Manifest, fileKeys: Record<string, string>): BundleSplit => {
  const entries = Object.keys(manifest).filter((key) => manifest[key].isEntry);
  if (!entries.length) throw new Error('The manifest names no entry chunk');
  const seen = new Set<string>();
  const queue = [...entries];
  while (queue.length) {
    const key = queue.shift()!;
    if (seen.has(key)) continue;
    seen.add(key);
    queue.push(...(manifest[key]?.imports ?? []));
  }
  const initialFiles = new Set<string>();
  for (const key of seen) {
    const chunk = manifest[key];
    if (!chunk) continue;
    initialFiles.add(chunk.file);
    for (const css of chunk.css ?? []) initialFiles.add(css);
  }
  for (const file of initialFiles) {
    if (!fileKeys[file]) throw new Error(`The manifest's ${file} isn't in the build`);
  }
  const initial: string[] = [];
  const lazy: string[] = [];
  for (const [file, key] of Object.entries(fileKeys)) {
    (initialFiles.has(file) ? initial : lazy).push(key);
  }
  return { initial: initial.sort(), lazy: lazy.sort(), initialFiles };
};

/** The files' sizes summed */
export const sumSizes = (keys: string[], sizes: Record<string, Size>): Size =>
  keys.reduce(
    (sum, key) => ({ bytes: sum.bytes + sizes[key].bytes, gzip: sum.gzip + sizes[key].gzip }),
    { bytes: 0, gzip: 0 }
  );

/** Every group's modules summed in the initial chunks and in the lazy ones (the workers' chunks
 * are lazy), from the module sizes */
export const measureSplitGroups = (
  sizes: ModuleSizesFile,
  split: Pick<BundleSplit, 'initialFiles'>
): Record<string, SplitGroupSize> => {
  const groups: Record<string, SplitGroupSize> = {};
  for (const [file, chunk] of Object.entries(sizes.chunks)) {
    for (const [name, size] of Object.entries(chunk.groups)) {
      const group = (groups[name] ??= {
        initial: { modules: 0, minified: 0, gzip: 0 },
        lazy: { modules: 0, minified: 0, gzip: 0 },
      });
      addGroupSize(group[split.initialFiles.has(file) ? 'initial' : 'lazy'], size);
    }
  }
  return sortKeys(groups);
};
