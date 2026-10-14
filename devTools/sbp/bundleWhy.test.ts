import { describe, expect, it } from 'vitest';
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
import { DATA, FILE_KEYS, MANIFEST } from './testBuild';

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
