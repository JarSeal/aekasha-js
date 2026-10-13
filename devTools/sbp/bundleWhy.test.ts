import { describe, expect, it } from 'vitest';
import type { Manifest, VisualizerData } from './bundleModel';
import { buildFeatureView, readSceneFeatures } from './bundleFeatures';
import { measureSplitGroups, splitBundle } from './bundleSplit';
import {
  answerWhy,
  findBestImportChain,
  findImportChain,
  formatImportChain,
  getEntryModuleId,
  indexModuleGraph,
} from './bundleWhy';

const MAIN = 'assets/index-AAAAAAAA.js';
const LAZY = 'assets/GLTFLoader-BBBBBBBB.js';
const MANIFEST: Manifest = {
  'index.html': { file: MAIN, src: 'index.html', isEntry: true },
};
const FILE_KEYS = { [MAIN]: 'assets/index.js', [LAZY]: 'assets/GLTFLoader.js' };

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

const DATA: VisualizerData = (() => {
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

const split = splitBundle(MANIFEST, FILE_KEYS);
const graph = indexModuleGraph(DATA, split.initialFiles);
const FROM = getEntryModuleId(MANIFEST);

describe('indexModuleGraph', () => {
  it('says where each module’s code is', () => {
    expect(FROM).toBe('/src/index.html');
    expect(graph.load.get('/src/_engine/features/physics/PhysicsAPI.ts')).toBe('initial');
    expect(graph.load.get('/node_modules/three/GLTFLoader.js')).toBe('lazy');
    expect(graph.load.get('/src/_engine/features/physics/PhysicsTiers.ts')).toBe('none');
    expect(graph.load.get('/src/_engine/index.ts')).toBe('none');
  });
});

describe('findImportChain', () => {
  it('finds the shortest static chain', () => {
    const chain = findImportChain(graph, FROM, (id) => id.endsWith('PhysicsAPI.ts'), {
      dynamic: false,
    });
    expect(formatImportChain(chain!)).toBe(
      'src/index.ts → aekasha/physics (features/physics/index.ts) → PhysicsFeature.ts → PhysicsAPI.ts'
    );
  });

  it('skips import() edges unless asked', () => {
    const isTarget = (id: string) =>
      id.endsWith('GLTFSource.ts') || id.endsWith('ImportRegistry.ts');
    expect(findImportChain(graph, FROM, isTarget, { dynamic: false })).not.toBeNull();
    const through = (id: string) => !id.endsWith('Symbols.ts');
    const toLoader = (id: string) => id.endsWith('GLTFLoader.js');
    expect(findImportChain(graph, FROM, toLoader, { dynamic: false, through })).toBeNull();
    expect(findImportChain(graph, FROM, toLoader, { dynamic: true, through })?.dynamic).toEqual([
      false,
      false,
      false,
      false,
      false,
      true,
    ]);
  });
});

describe('findBestImportChain', () => {
  it('passes modules whose code ships before a shorter chain through a tree-shaken one', () => {
    const chain = findBestImportChain(graph, FROM, (id) => id.endsWith('GLTFLoader.js'));
    expect(formatImportChain(chain!)).toBe(
      'src/index.ts → aekasha (_engine/index.ts) → kernel/init/InitEngine.ts → kernel/assets/ImportRegistry.ts → GLTFSource.ts ⇢ node_modules/three/GLTFLoader.js'
    );
  });

  it('falls back to any chain', () => {
    const chain = findBestImportChain(graph, FROM, (id) => id.endsWith('Symbols.ts'));
    expect(chain?.ids.at(-2)).toBe('/src/_engine/kernel/init/InitEngine.ts');
  });
});

describe('answerWhy', () => {
  it('answers a group by its short name, to its nearest module in the initial chunks', () => {
    const { results } = answerWhy(graph, FROM, 'physics');
    expect(results).toHaveLength(1);
    expect(results[0].target).toBe('_engine/features/physics');
    expect(results[0].load).toBe('initial');
    expect(results[0].chain?.ids.at(-1)).toBe('/src/_engine/features/physics/PhysicsFeature.ts');
  });

  it('answers a path with each module it matches, and a tree-shaken one as none', () => {
    const { results } = answerWhy(graph, FROM, 'features/physics/PhysicsTiers.ts');
    expect(results.map((r) => [r.target, r.load])).toEqual([
      ['/src/_engine/features/physics/PhysicsTiers.ts', 'none'],
    ]);
    expect(answerWhy(graph, FROM, 'Physics').results.map((r) => r.load)).toEqual([
      'initial',
      'initial',
      'none',
    ]);
  });

  it('answers nothing for an unknown name', () => {
    expect(answerWhy(graph, FROM, 'Nope.ts')).toEqual({ results: [], tooMany: [] });
  });
});

describe('the feature view', () => {
  it('lists each feature with its sizes, chain and scenes', () => {
    const scenes = readSceneFeatures({
      scenes: {
        a: { __features: ['skybox'] },
        b: { __features: [] },
        debug: { isDebugScene: true, __features: ['physics'] },
      },
    });
    expect(scenes).toEqual({ a: ['skybox'], b: [] });
    const [row] = buildFeatureView({
      graph,
      from: FROM,
      groups: measureSplitGroups(DATA, split),
      scenes,
      dataFeatures: ['physics'],
    });
    expect(row).toMatchObject({
      feature: 'physics',
      initialGzip: 25,
      lazyGzip: 0,
      hasDataPart: true,
      scenes: [],
      isUnneededByData: true,
    });
    expect(row.why?.ids.at(-1)).toBe('/src/_engine/features/physics/PhysicsFeature.ts');
  });
});
