/**
 * A synthetic build for the `yarn sbp` tests: a main chunk and a lazy one, its manifest, the
 * visualizer's graph and the module sizes (a module's minified size is its rendered length, its
 * gzip half that, and a group's gzip its modules' summed).
 */
import {
  BUNDLE_FORMAT_VERSION,
  type CollectedBundle,
  MAIN_BUILD,
  type Manifest,
  type ModuleSizesFile,
  type VisualizerData,
  addGroupSize,
  getModuleGroup,
  listBuildModules,
  listEmittedAssets,
  measureMainChunk,
} from './bundleModel';

export const MAIN = 'assets/index-AAAAAAAA.js';
export const LAZY = 'assets/GLTFLoader-BBBBBBBB.js';
export const MANIFEST: Manifest = {
  'index.html': { file: MAIN, src: 'index.html', isEntry: true },
};
export const FILE_KEYS = { [MAIN]: 'assets/index.js', [LAZY]: 'assets/GLTFLoader.js' };

/**
 * index.html → src/index.ts → aekasha/physics (re-exports, no code) → PhysicsFeature.ts →
 * PhysicsAPI.ts; src/index.ts → aekasha → InitEngine.ts → Symbols.ts (tree-shaken) → GLTFLoader
 * (static, shorter); InitEngine.ts → ImportRegistry.ts → GLTFSource.ts ⇢ GLTFLoader (lazy chunk).
 * PhysicsTiers.ts is imported but tree-shaken.
 */
const MODULES: [
  id: string,
  imports: [id: string, dynamic?: true][],
  parts: Record<string, number>,
][] = [
  ['/src/index.html', [['/src/index.ts']], {}],
  [
    '/src/index.ts',
    [['/src/_engine/index.ts'], ['/src/_engine/features/physics/index.ts']],
    { [MAIN]: 10 },
  ],
  ['/src/_engine/index.ts', [['/src/_engine/kernel/init/InitEngine.ts']], {}],
  [
    '/src/_engine/features/physics/index.ts',
    [
      ['/src/_engine/features/physics/PhysicsFeature.ts'],
      ['/src/_engine/features/physics/PhysicsTiers.ts'],
    ],
    {},
  ],
  [
    '/src/_engine/features/physics/PhysicsFeature.ts',
    [['/src/_engine/features/physics/PhysicsAPI.ts']],
    { [MAIN]: 20 },
  ],
  ['/src/_engine/features/physics/PhysicsAPI.ts', [], { [MAIN]: 30 }],
  ['/src/_engine/features/physics/PhysicsTiers.ts', [], { [MAIN]: 0 }],
  [
    '/src/_engine/kernel/init/InitEngine.ts',
    [['/src/_engine/debug/Symbols.ts'], ['/src/_engine/kernel/assets/ImportRegistry.ts']],
    { [MAIN]: 40 },
  ],
  ['/src/_engine/debug/Symbols.ts', [['/node_modules/three/GLTFLoader.js']], {}],
  [
    '/src/_engine/kernel/assets/ImportRegistry.ts',
    [['/src/_engine/kernel/assets/GLTFSource.ts']],
    { [MAIN]: 5 },
  ],
  [
    '/src/_engine/kernel/assets/GLTFSource.ts',
    [['/node_modules/three/GLTFLoader.js', true]],
    { [MAIN]: 5 },
  ],
  ['/node_modules/three/GLTFLoader.js', [], { [LAZY]: 50 }],
];

export const DATA: VisualizerData = (() => {
  const uid = new Map(MODULES.map(([id], i) => [id, `m${i}`]));
  const data: VisualizerData = { nodeParts: {}, nodeMetas: {} };
  MODULES.forEach(([id, imports, parts], i) => {
    const moduleParts: Record<string, string> = {};
    for (const [file, length] of Object.entries(parts)) {
      const part = `p${i}-${file}`;
      data.nodeParts[part] = { renderedLength: length, gzipLength: length / 2 };
      moduleParts[file] = part;
    }
    data.nodeMetas[`m${i}`] = {
      id,
      moduleParts,
      imported: imports.map(([to, dynamic]) => ({
        uid: uid.get(to)!,
        ...(dynamic && { dynamic }),
      })),
      importedBy: [],
    };
  });
  return data;
})();

export const SIZES: ModuleSizesFile = (() => {
  const sizes: ModuleSizesFile = { formatVersion: 1, chunks: {}, modules: [] };
  for (const [id, , parts] of MODULES) {
    const chunks = Object.entries(parts).filter(([, length]) => length > 0);
    if (!chunks.length) continue;
    sizes.modules.push({
      id,
      build: MAIN_BUILD,
      chunks: Object.fromEntries(
        chunks.map(([file, length]) => [
          file,
          { rendered: length, minified: length, gzip: length / 2 },
        ])
      ),
    });
    for (const [file, length] of chunks) {
      const chunk = (sizes.chunks[file] ??= { build: MAIN_BUILD, groups: {} });
      const group = (chunk.groups[getModuleGroup(id)] ??= { modules: 0, minified: 0, gzip: 0 });
      addGroupSize(group, { modules: 1, minified: length, gzip: length / 2 });
    }
  }
  return sizes;
})();

/** The fixture as `collectBundle` returns a build: each file's gzip is its key's length */
export const createTestBundle = (): CollectedBundle => ({
  bundle: {
    formatVersion: BUNDLE_FORMAT_VERSION,
    chunks: Object.fromEntries(
      Object.values(FILE_KEYS).map((key) => [key, { bytes: key.length * 3, gzip: key.length }])
    ),
    ...measureMainChunk(SIZES, MAIN, FILE_KEYS[MAIN]),
  },
  modules: listBuildModules(SIZES, FILE_KEYS),
  assets: listEmittedAssets(MANIFEST, DATA, FILE_KEYS),
  fileKeys: FILE_KEYS,
  manifest: MANIFEST,
  data: DATA,
  sizes: SIZES,
});
