/**
 * The production build's bundle model (p611 D1), shared by `yarn verify:baselines` (its
 * `bundle.json`) and `yarn sbp`: every file in `dist/assets/` by its key (`bundleKeys.ts`), and
 * the modules' sizes after minification per group and chunk (`dist-stats/module-sizes.json`,
 * `moduleSizesPlugin.ts`, p619 B1: the main and the worker builds). The visualizer's report
 * (`dist-stats/bundle-stats.html`) gives the import graph (`--why`) and the emitted files'
 * importers. An embed profile's build (`dist-embed/<id>/`, `embedBuild.ts`) is measured the same
 * way, every file of its folder counted.
 *
 * It only reads a build; making one is the caller's. A missing or mismatched build throws.
 */
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { ROOT } from '../paths';
import { keyBuildFiles, stripHash } from './bundleKeys';

/** Bump when `bundle.json`'s shape changes: an old one is then read as missing */
export const BUNDLE_FORMAT_VERSION = 2;
export const VISUALIZER_FILE = path.join(ROOT, 'dist-stats/bundle-stats.html');
export const MODULE_SIZES_FILE_NAME = 'module-sizes.json';
export const MODULE_SIZES_FILE = path.join(ROOT, 'dist-stats', MODULE_SIZES_FILE_NAME);

/** Where a build is: its output folder, its visualizer report and module sizes, and which of its
 * files count */
export type BuildLocation = {
  outDir: string;
  statsFile: string;
  sizesFile: string;
  /** Only `assets/` (the app: `dist/` also holds the public folder's copy and `index.html`), or
   * every file but `.vite/` (an embed: its entry, its data's files and its decoders too) */
  isAssetsOnly: boolean;
};

/** The template app's `yarn build` */
export const APP_BUILD: BuildLocation = {
  outDir: path.join(ROOT, 'dist'),
  statsFile: VISUALIZER_FILE,
  sizesFile: MODULE_SIZES_FILE,
  isAssetsOnly: true,
};

export type Size = { bytes: number; gzip: number };
/** A group's modules in a chunk (or summed over chunks): their minified bytes, and the gzip of
 * their minified code concatenated per chunk */
export type GroupSize = { modules: number; minified: number; gzip: number };
export type BundleBaseline = {
  formatVersion: number;
  /** Every file of the build by its key */
  chunks: Record<string, Size>;
  /** The main chunk's key, and its groups summed */
  main: { chunk: string } & GroupSize;
  mainGroups: Record<string, GroupSize>;
};

/** Bump when `module-sizes.json`'s shape changes: an old one is then read as missing */
export const MODULE_SIZES_FORMAT_VERSION = 1;
/** The main build's name in the file; a worker build is named by its entry (`PhysicsWorker`) */
export const MAIN_BUILD = 'main';

/** A module's code in one chunk: rendered (before minification), minified, and that gzipped */
export type ModuleSize = { rendered: number; minified: number; gzip: number };

/** `module-sizes.json` (`moduleSizesPlugin.ts`) */
export type ModuleSizesFile = {
  formatVersion: number;
  /** Each chunk (its hashed name from the output folder, `assets/index-Bd_fo_yS.js`): the build
   * it's from and its modules per group (`getModuleGroup`) */
  chunks: Record<string, { build: string; groups: Record<string, GroupSize> }>;
  /** Each module of each build that has code in a chunk: its id (`/src/…`, `/node_modules/…`, a
   * `\0` virtual module) and its size per chunk */
  modules: { id: string; build: string; chunks: Record<string, ModuleSize> }[];
};

/** Vite's `dist/.vite/manifest.json`: keys are sources relative to `src/` (`index.html`) or
 * shared chunks (`_three.module-CqBAFLUG.js`); `imports` and `dynamicImports` name other keys */
export type Manifest = Record<
  string,
  {
    file: string;
    src?: string;
    isEntry?: boolean;
    isDynamicEntry?: boolean;
    imports?: string[];
    dynamicImports?: string[];
    css?: string[];
    assets?: string[];
  }
>;

/** A module with code in the build: its id (`/src/…`), the build it's in (`main`, or a worker's
 * name) and its rendered length per chunk (by key) */
export type BuildModule = { id: string; build: string; chunks: Record<string, number> };

/** A file Vite emitted for a module (an image, a model, a `.wasm`), from the manifest: its key
 * (`assets/3DSymbols.glb`), its source as a module id (`/src/…`, `/node_modules/…`) and the ids
 * of the modules that import it */
export type EmittedAsset = { file: string; id: string; importers: string[] };

/** An import edge of the visualizer's graph: `dynamic` for an `import()` */
export type ModuleRef = { uid: string; dynamic?: boolean };

/** The visualizer's data (`rollup-plugin-visualizer`'s `const data = {…}`): every module of the
 * graph, tree-shaken ones included (their `moduleParts` are empty) */
export type VisualizerData = {
  nodeParts: Record<string, { renderedLength: number; gzipLength: number }>;
  nodeMetas: Record<
    string,
    {
      id: string;
      moduleParts: Record<string, string>;
      imported: ModuleRef[];
      importedBy: ModuleRef[];
    }
  >;
};

/** A module's group: a package, an engine folder (kernel's and features' subfolders apart), the
 * toolkit, or the app (`src/app/` and `src/`'s own files) */
export const getModuleGroup = (id: string) => {
  if (id.startsWith('\0')) return 'vite';
  const pkg = id.match(/^\/node_modules\/((?:@[^/]+\/)?[^/]+)\//);
  if (pkg) return pkg[1];
  const src = id.match(/^\/src\/([^?]*)/);
  if (!src) return 'other';
  const parts = src[1].split('/');
  if (parts[0] === '_engine') {
    if (parts.length <= 2) return '_engine';
    if ((parts[1] === 'kernel' || parts[1] === 'features') && parts.length > 3) {
      return `_engine/${parts[1]}/${parts[2]}`;
    }
    return `_engine/${parts[1]}`;
  }
  return parts[0] === 'toolkit' ? 'toolkit' : 'app';
};

export const sortKeys = <T>(obj: Record<string, T>) =>
  Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b)));

const readJSON = <T>(file: string): T | null => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as T;
  } catch {
    return null;
  }
};

/** The visualizer's data from its HTML report; null when it holds none */
export const parseVisualizerData = (html: string): VisualizerData | null => {
  const match = html.match(/const data = (\{.*?\});\n/s);
  return match ? (JSON.parse(match[1]) as VisualizerData) : null;
};

/** The last build's visualizer data; null without the file or the data */
export const readVisualizerData = (file = VISUALIZER_FILE) =>
  fs.existsSync(file) ? parseVisualizerData(fs.readFileSync(file, 'utf-8')) : null;

/**
 * The module sizes of a build (`moduleSizesPlugin.ts`); null without the file or of another
 * format
 */
export const readModuleSizes = (file = MODULE_SIZES_FILE): ModuleSizesFile | null => {
  const sizes = readJSON<ModuleSizesFile>(file);
  return sizes?.formatVersion === MODULE_SIZES_FORMAT_VERSION ? sizes : null;
};

/** A build's files that count, as paths from its output folder with `/` */
export const listBuildFiles = ({ outDir, isAssetsOnly }: BuildLocation) => {
  const list = (dir: string): string[] =>
    fs.readdirSync(path.join(outDir, dir), { withFileTypes: true }).flatMap((entry) => {
      const rel = dir ? `${dir}/${entry.name}` : entry.name;
      if (!entry.isDirectory()) return [rel];
      return rel === '.vite' ? [] : list(rel);
    });
  return list(isAssetsOnly ? 'assets' : '');
};

/** Each worker build's chunks (by name), from the module sizes */
export const listWorkerChunks = (sizes: ModuleSizesFile) => {
  const workers: Record<string, string[]> = {};
  for (const [file, { build }] of Object.entries(sizes.chunks)) {
    if (build !== MAIN_BUILD) (workers[build] ??= []).push(file);
  }
  return workers;
};

/**
 * Every file of a build that counts by its key (`keyBuildFiles`) with its bytes and gzip (level
 * 9), and the hashed name → key map.
 * @param workers each worker build's chunks ({@link listWorkerChunks})
 */
export const measureFiles = (
  build: BuildLocation,
  manifest: Manifest,
  workers: Record<string, string[]>
) => {
  const read = (file: string) => fs.readFileSync(path.join(build.outDir, file), 'utf-8');
  const fileKeys = keyBuildFiles({ files: listBuildFiles(build), manifest, workers, read });
  const chunks: Record<string, Size> = {};
  for (const [file, key] of Object.entries(fileKeys)) {
    const data = fs.readFileSync(path.join(build.outDir, file));
    chunks[key] = { bytes: data.length, gzip: zlib.gzipSync(data, { level: 9 }).length };
  }
  return { chunks: sortKeys(chunks), fileKeys };
};

/** Every module with code in the build, the worker builds' too, with its rendered length per
 * chunk by key (for the debug check, p619 V7)
 * @param fileKeys hashed name → key; a chunk without one (pruned) is left out */
export const listBuildModules = (
  sizes: ModuleSizesFile,
  fileKeys: Record<string, string>
): BuildModule[] =>
  sizes.modules.map(({ id, build, chunks }) => ({
    id,
    build,
    chunks: Object.fromEntries(
      Object.entries(chunks).flatMap(([file, size]) =>
        fileKeys[file] ? [[fileKeys[file], size.rendered]] : []
      )
    ),
  }));

/**
 * The files Vite emitted for modules (the manifest's entries that aren't chunks or CSS: `?url`
 * imports, `new URL(…, import.meta.url)` files), each with its source's module id and the modules
 * that import it (none for a `new URL` file: the visualizer lists no module for it)
 * @param fileKeys hashed name → key (`keyBuildFiles`)
 */
export const listEmittedAssets = (
  manifest: Manifest,
  data: VisualizerData,
  fileKeys: Record<string, string>
): EmittedAsset[] => {
  const metas = Object.values(data.nodeMetas);
  const assets: EmittedAsset[] = [];
  for (const { file, src } of Object.values(manifest)) {
    if (!src || /\.(js|css)$/.test(file)) continue;
    // `src` is relative to the Vite root `src/` (`../node_modules/…` for a package's file)
    const id = path.posix.normalize(`/src/${src}`);
    const importers = new Set<string>();
    for (const meta of metas) {
      if (meta.id !== id && !meta.id.startsWith(`${id}?`)) continue;
      for (const { uid } of meta.importedBy) {
        const importer = data.nodeMetas[uid]?.id;
        if (importer) importers.add(importer);
      }
    }
    assets.push({ file: fileKeys[file] ?? stripHash(file), id, importers: [...importers].sort() });
  }
  return assets.sort((a, b) => a.file.localeCompare(b.file));
};

/**
 * The main chunk: the largest (gzip) of the entry's chunk and the chunks it imports statically.
 * The app's is its entry's; an embed's entry only re-exports what a shared chunk holds, which the
 * scenes' and materials' chunks import too.
 * @param gzipOf a hashed file's gzip
 */
export const findMainChunkFile = (manifest: Manifest, gzipOf: (file: string) => number) => {
  const entry = Object.values(manifest).find((m) => m.isEntry);
  if (!entry) return null;
  const candidates = [
    entry.file,
    ...(entry.imports ?? []).flatMap((key) => (manifest[key] ? [manifest[key].file] : [])),
  ];
  // Stable: the entry wins a tie
  return candidates.reduce((best, file) => (gzipOf(file) > gzipOf(best) ? file : best));
};

/** Drops the visualizer's parts in files the build doesn't have (an embed's pruned files) */
const keepPartsIn = (data: VisualizerData, files: Set<string>): VisualizerData => ({
  nodeParts: data.nodeParts,
  nodeMetas: Object.fromEntries(
    Object.entries(data.nodeMetas).map(([uid, meta]) => [
      uid,
      {
        ...meta,
        moduleParts: Object.fromEntries(
          Object.entries(meta.moduleParts).filter(([file]) => files.has(file))
        ),
      },
    ])
  ),
});

/** Drops the module sizes of files the build doesn't have (an embed's pruned files) */
const keepSizesIn = (sizes: ModuleSizesFile, files: Set<string>): ModuleSizesFile => ({
  formatVersion: sizes.formatVersion,
  chunks: Object.fromEntries(Object.entries(sizes.chunks).filter(([file]) => files.has(file))),
  modules: sizes.modules.flatMap((module) => {
    const chunks = Object.entries(module.chunks).filter(([file]) => files.has(file));
    return chunks.length ? [{ ...module, chunks: Object.fromEntries(chunks) }] : [];
  }),
});

/** Adds a group's size into a sum */
export const addGroupSize = (into: GroupSize, size: GroupSize) => {
  into.modules += size.modules;
  into.minified += size.minified;
  into.gzip += size.gzip;
};

/**
 * The main chunk's groups, and their sum
 * @param mainFile its hashed name
 * @param key its key in `bundle.chunks`
 */
export const measureMainChunk = (sizes: ModuleSizesFile, mainFile: string, key: string) => {
  const groups = sizes.chunks[mainFile]?.groups ?? {};
  const main = { chunk: key, modules: 0, minified: 0, gzip: 0 };
  for (const size of Object.values(groups)) addGroupSize(main, size);
  return { main, mainGroups: sortKeys(groups) };
};

/** A measured build: the baseline's shape, its modules, and what it was read from */
export type CollectedBundle = {
  bundle: BundleBaseline;
  modules: BuildModule[];
  /** The files Vite emitted for modules, for the debug check */
  assets: EmittedAsset[];
  /** `dist/assets/`' hashed names (`assets/index-Bd_fo_yS.js`) → their keys in `bundle.chunks` */
  fileKeys: Record<string, string>;
  manifest: Manifest;
  /** The visualizer's data: the import graph */
  data: VisualizerData;
  /** The modules' sizes, the files the build has */
  sizes: ModuleSizesFile;
};

/**
 * Measures the last build of the app (`dist/` and `dist-stats/`) or of an embed profile.
 * @throws when there is no build, its manifest names no entry, two files share a key, or the
 *   visualizer's data or the module sizes are missing or from another build
 */
export const collectBundle = (build: BuildLocation = APP_BUILD): CollectedBundle => {
  const manifestFile = path.join(build.outDir, '.vite/manifest.json');
  const outDir = path.relative(ROOT, build.outDir);
  const manifest = readJSON<Manifest>(manifestFile);
  if (!manifest || !fs.existsSync(path.join(build.outDir, 'assets'))) {
    throw new Error(`No ${outDir}/ build to measure: run without --no-build`);
  }
  if (!Object.values(manifest).some((m) => m.isEntry)) {
    throw new Error(`${path.relative(ROOT, manifestFile)} names no entry chunk`);
  }
  const rawSizes = readModuleSizes(build.sizesFile);
  if (!rawSizes) {
    throw new Error(
      `No module sizes in ${path.relative(ROOT, build.sizesFile)} (or of another format): run without --no-build`
    );
  }
  const { chunks, fileKeys } = measureFiles(build, manifest, listWorkerChunks(rawSizes));
  const rawData = readVisualizerData(build.statsFile);
  if (!rawData) {
    throw new Error(`No visualizer data in ${path.relative(ROOT, build.statsFile)}`);
  }
  const files = new Set(Object.keys(fileKeys));
  const data = keepPartsIn(rawData, files);
  const sizes = keepSizesIn(rawSizes, files);
  const mainFile = findMainChunkFile(manifest, (file) => chunks[fileKeys[file]]?.gzip ?? 0)!;
  const { main, mainGroups } = measureMainChunk(sizes, mainFile, fileKeys[mainFile]);
  const fromOtherBuild = (file: string) =>
    new Error(
      `${path.relative(ROOT, file)} has no modules in ${mainFile}: it's from another build`
    );
  if (!main.modules) throw fromOtherBuild(build.sizesFile);
  if (!Object.values(data.nodeMetas).some((meta) => meta.moduleParts[mainFile])) {
    throw fromOtherBuild(build.statsFile);
  }
  return {
    bundle: { formatVersion: BUNDLE_FORMAT_VERSION, chunks, main, mainGroups },
    modules: listBuildModules(sizes, fileKeys),
    assets: listEmittedAssets(manifest, data, fileKeys),
    fileKeys,
    manifest,
    data,
    sizes,
  };
};
