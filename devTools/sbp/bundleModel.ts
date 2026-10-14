/**
 * The production build's bundle model (p611 D1), shared by `yarn verify:baselines` (its
 * `bundle.json`) and `yarn sbp`: every file in `dist/assets/` by its name without the content
 * hash, and the visualizer's modules (`dist-stats/bundle-stats.html`: rendered and gzip sizes per
 * chunk, before minification, as p600 §2.4 counts) summed per group. An embed profile's build
 * (`dist-embed/<id>/`, `embedBuild.ts`) is measured the same way, every file of its folder counted.
 *
 * It only reads a build; making one is the caller's. A missing or mismatched build throws.
 */
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { ROOT } from '../assetPipeline/sources';
import type { BuildModule, EmittedAsset } from '../verify/debugInProduction';

/** Bump when `bundle.json`'s shape changes: an old one is then read as missing */
export const BUNDLE_FORMAT_VERSION = 1;
export const VISUALIZER_FILE = path.join(ROOT, 'dist-stats/bundle-stats.html');

/** Where a build is: its output folder, its visualizer report, and which of its files count */
export type BuildLocation = {
  outDir: string;
  statsFile: string;
  /** Only `assets/` (the app: `dist/` also holds the public folder's copy and `index.html`), or
   * every file but `.vite/` (an embed: its entry, its data's files and its decoders too) */
  isAssetsOnly: boolean;
};

/** The template app's `yarn build` */
export const APP_BUILD: BuildLocation = {
  outDir: path.join(ROOT, 'dist'),
  statsFile: VISUALIZER_FILE,
  isAssetsOnly: true,
};

export type Size = { bytes: number; gzip: number };
export type GroupSize = { modules: number; rendered: number; gzip: number };
export type BundleBaseline = {
  formatVersion: number;
  chunks: Record<string, Size>;
  main: { chunk: string; modules: number; rendered: number; gzip: number };
  mainGroups: Record<string, GroupSize>;
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

/** `assets/index-Hx4K2rfZ.js` → `assets/index.js` (Vite's 8-character content hash) */
export const stripHash = (file: string) => file.replace(/-[A-Za-z0-9_-]{8}(\.[a-z0-9]+)$/, '$1');

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
 * Each file's key: its name without the hash (`assets/index.js`), a second file of the same name
 * `#2` and so on, in sorted order of the hashed names
 * @param files hashed names (`assets/index-Bd_fo_yS.js`)
 * @returns hashed name → key
 */
export const keyFiles = (files: string[]): Record<string, string> => {
  const keys: Record<string, string> = {};
  const taken = new Set<string>();
  for (const file of [...files].sort()) {
    let key = stripHash(file);
    for (let n = 2; taken.has(key); n++) key = `${stripHash(file)}#${n}`;
    taken.add(key);
    keys[file] = key;
  }
  return keys;
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

/** Every file of a build that counts by its key ({@link keyFiles}) with its bytes and gzip
 * (level 9), and the hashed name → key map */
export const measureFiles = (build: BuildLocation = APP_BUILD) => {
  const fileKeys = keyFiles(listBuildFiles(build));
  const chunks: Record<string, Size> = {};
  for (const [file, key] of Object.entries(fileKeys)) {
    const data = fs.readFileSync(path.join(build.outDir, file));
    chunks[key] = { bytes: data.length, gzip: zlib.gzipSync(data, { level: 9 }).length };
  }
  return { chunks, fileKeys };
};

/** Every module the visualizer lists with its rendered length per chunk (for the debug check) */
export const listBuildModules = (data: VisualizerData): BuildModule[] =>
  Object.values(data.nodeMetas).map((meta) => ({
    id: meta.id,
    chunks: Object.fromEntries(
      Object.entries(meta.moduleParts).map(([file, id]) => [
        stripHash(file),
        data.nodeParts[id].renderedLength,
      ])
    ),
  }));

/**
 * The files Vite emitted for modules (the manifest's entries that aren't chunks or CSS: `?url`
 * imports, `new URL(…, import.meta.url)` files), each with its source's module id and the modules
 * that import it (none for a `new URL` file: the visualizer lists no module for it)
 * @param fileKeys hashed name → key ({@link keyFiles})
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
 * The main chunk: the largest of the entry's chunk and the chunks it imports statically (the
 * modules' gzip). The app's is its entry's; an embed's entry only re-exports what a shared chunk
 * holds, which the scenes' and materials' chunks import too.
 */
export const findMainChunkFile = (manifest: Manifest, data: VisualizerData) => {
  const entry = Object.values(manifest).find((m) => m.isEntry);
  if (!entry) return null;
  const gzipOf = (file: string) =>
    Object.values(data.nodeMetas).reduce(
      (n, meta) =>
        n + (meta.moduleParts[file] ? data.nodeParts[meta.moduleParts[file]].gzipLength : 0),
      0
    );
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

/** The main (entry) chunk's totals and its modules summed per group */
export const measureMainChunk = (entryFile: string, data: VisualizerData) => {
  const groups: Record<string, GroupSize> = {};
  const main = { chunk: stripHash(entryFile), modules: 0, rendered: 0, gzip: 0 };
  for (const meta of Object.values(data.nodeMetas)) {
    const partId = meta.moduleParts[entryFile];
    if (!partId) continue;
    const part = data.nodeParts[partId];
    const group = (groups[getModuleGroup(meta.id)] ??= { modules: 0, rendered: 0, gzip: 0 });
    group.modules++;
    group.rendered += part.renderedLength;
    group.gzip += part.gzipLength;
    main.modules++;
    main.rendered += part.renderedLength;
    main.gzip += part.gzipLength;
  }
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
  data: VisualizerData;
};

/**
 * Measures the last build of the app (`dist/` and `dist-stats/`) or of an embed profile.
 * @throws when there is no build, its manifest names no entry, or the visualizer's data is
 *   missing or from another build
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
  const { chunks, fileKeys } = measureFiles(build);
  const rawData = readVisualizerData(build.statsFile);
  if (!rawData) {
    throw new Error(`No visualizer data in ${path.relative(ROOT, build.statsFile)}`);
  }
  const data = keepPartsIn(rawData, new Set(Object.keys(fileKeys)));
  const mainFile = findMainChunkFile(manifest, data)!;
  const { main, mainGroups } = measureMainChunk(mainFile, data);
  if (!main.modules) {
    throw new Error(
      `The visualizer data has no modules in ${mainFile}: ${path.relative(ROOT, build.statsFile)} is from another build`
    );
  }
  return {
    bundle: { formatVersion: BUNDLE_FORMAT_VERSION, chunks, main, mainGroups },
    modules: listBuildModules(data),
    assets: listEmittedAssets(manifest, data, fileKeys),
    fileKeys,
    manifest,
    data,
  };
};
