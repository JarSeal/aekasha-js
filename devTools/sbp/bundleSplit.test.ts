import { describe, expect, it } from 'vitest';
import type { Manifest, ModuleSizesFile } from './bundleModel';
import { measureSplitGroups, splitBundle, sumSizes } from './bundleSplit';

// The entry imports a shared chunk statically; a loader is import()ed and imports the shared
// chunk and the entry back (Vite's manifest does); a worker's chunk isn't in the manifest
const MANIFEST: Manifest = {
  'index.html': {
    file: 'assets/index-AAAAAAAA.js',
    isEntry: true,
    imports: ['_shared-BBBBBBBB.js'],
    dynamicImports: ['../node_modules/three/examples/jsm/loaders/GLTFLoader.js'],
    css: ['assets/index-CCCCCCCC.css'],
    assets: ['assets/3DSymbols-DDDDDDDD.glb'],
  },
  '_shared-BBBBBBBB.js': { file: 'assets/shared-BBBBBBBB.js', css: ['assets/shared-EEEEEEEE.css'] },
  '../node_modules/three/examples/jsm/loaders/GLTFLoader.js': {
    file: 'assets/GLTFLoader-FFFFFFFF.js',
    isDynamicEntry: true,
    imports: ['_shared-BBBBBBBB.js', 'index.html'],
  },
};
const FILE_KEYS = {
  'assets/index-AAAAAAAA.js': 'assets/index.js',
  'assets/index-CCCCCCCC.css': 'assets/index.css',
  'assets/shared-BBBBBBBB.js': 'assets/shared.js',
  'assets/shared-EEEEEEEE.css': 'assets/shared.css',
  'assets/GLTFLoader-FFFFFFFF.js': 'assets/GLTFLoader.js',
  'assets/3DSymbols-DDDDDDDD.glb': 'assets/3DSymbols.glb',
  'assets/EngineRapier-GGGGGGGG.js': 'assets/EngineRapier.js',
  'assets/EngineRapier-HHHHHHHH.js': 'assets/EngineRapier.js@PhysicsWorker',
};

describe('splitBundle', () => {
  const split = splitBundle(MANIFEST, FILE_KEYS);

  it('puts the entry, its static imports and their CSS in initial', () => {
    expect(split.initial).toEqual([
      'assets/index.css',
      'assets/index.js',
      'assets/shared.css',
      'assets/shared.js',
    ]);
  });

  it('puts the import()ed chunks, the workers and the URL assets in lazy', () => {
    expect(split.lazy).toEqual([
      'assets/3DSymbols.glb',
      'assets/EngineRapier.js',
      'assets/EngineRapier.js@PhysicsWorker',
      'assets/GLTFLoader.js',
    ]);
  });

  it('throws without an entry', () => {
    expect(() => splitBundle({ a: { file: 'assets/a.js' } }, {})).toThrow(/no entry/);
  });

  it('throws on an entry file missing from the build', () => {
    expect(() => splitBundle(MANIFEST, {})).toThrow(/isn't in the build/);
  });

  it('sums sizes', () => {
    const sizes = { a: { bytes: 10, gzip: 4 }, b: { bytes: 5, gzip: 3 } };
    expect(sumSizes(['a', 'b'], sizes)).toEqual({ bytes: 15, gzip: 7 });
  });
});

describe('measureSplitGroups', () => {
  it('sums each group in the initial and the lazy chunks, a worker’s chunks lazy', () => {
    const group = (modules: number, gzip: number) => ({ modules, minified: gzip * 2, gzip });
    const sizes: ModuleSizesFile = {
      formatVersion: 1,
      chunks: {
        'assets/index-AAAAAAAA.js': { build: 'main', groups: { physics: group(2, 40) } },
        'assets/shared-BBBBBBBB.js': {
          build: 'main',
          groups: { physics: group(1, 5), three: group(3, 100) },
        },
        'assets/EngineRapier-HHHHHHHH.js': {
          build: 'PhysicsWorker',
          groups: { physics: group(1, 20) },
        },
        'assets/GLTFLoader-FFFFFFFF.js': { build: 'main', groups: { three: group(1, 10) } },
      },
      modules: [],
    };
    expect(measureSplitGroups(sizes, splitBundle(MANIFEST, FILE_KEYS))).toEqual({
      physics: { initial: group(3, 45), lazy: group(1, 20) },
      three: { initial: group(3, 100), lazy: group(1, 10) },
    });
  });
});
