import { describe, expect, it } from 'vitest';
import { type Manifest, type VisualizerData, keyFiles } from './bundleModel';
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
const FILES = [
  'assets/index-AAAAAAAA.js',
  'assets/index-CCCCCCCC.css',
  'assets/shared-BBBBBBBB.js',
  'assets/shared-EEEEEEEE.css',
  'assets/GLTFLoader-FFFFFFFF.js',
  'assets/3DSymbols-DDDDDDDD.glb',
  'assets/EngineRapier-GGGGGGGG.js',
  'assets/EngineRapier-HHHHHHHH.js',
];

describe('keyFiles', () => {
  it('strips the hash and numbers a repeated name in sorted order', () => {
    const keys = keyFiles(FILES);
    expect(keys['assets/index-AAAAAAAA.js']).toBe('assets/index.js');
    expect(keys['assets/EngineRapier-GGGGGGGG.js']).toBe('assets/EngineRapier.js');
    expect(keys['assets/EngineRapier-HHHHHHHH.js']).toBe('assets/EngineRapier.js#2');
  });
});

describe('splitBundle', () => {
  const split = splitBundle(MANIFEST, keyFiles(FILES));

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
      'assets/EngineRapier.js#2',
      'assets/GLTFLoader.js',
    ]);
  });

  it('throws without an entry', () => {
    expect(() => splitBundle({ a: { file: 'assets/a.js' } }, {})).toThrow(/no entry/);
  });

  it('throws on an entry file missing from the build', () => {
    expect(() => splitBundle(MANIFEST, {})).toThrow(/isn't in dist\/assets/);
  });

  it('sums sizes', () => {
    const sizes = { a: { bytes: 10, gzip: 4 }, b: { bytes: 5, gzip: 3 } };
    expect(sumSizes(['a', 'b'], sizes)).toEqual({ bytes: 15, gzip: 7 });
  });
});

describe('measureSplitGroups', () => {
  it('sums each group in the initial and the lazy chunks', () => {
    const data: VisualizerData = {
      nodeParts: {
        p1: { renderedLength: 100, gzipLength: 40 },
        p2: { renderedLength: 50, gzipLength: 20 },
        p3: { renderedLength: 30, gzipLength: 10 },
      },
      nodeMetas: {
        m1: {
          id: '/src/_engine/features/physics/PhysicsAPI.ts',
          moduleParts: {
            'assets/index-AAAAAAAA.js': 'p1',
            'assets/EngineRapier-GGGGGGGG.js': 'p2',
          },
          imported: [],
          importedBy: [],
        },
        m2: {
          id: '/node_modules/three/build/three.core.js',
          moduleParts: { 'assets/GLTFLoader-FFFFFFFF.js': 'p3' },
          imported: [],
          importedBy: [],
        },
      },
    };
    const groups = measureSplitGroups(data, splitBundle(MANIFEST, keyFiles(FILES)));
    expect(groups).toEqual({
      '_engine/features/physics': {
        initial: { modules: 1, rendered: 100, gzip: 40 },
        lazy: { modules: 1, rendered: 50, gzip: 20 },
      },
      three: {
        initial: { modules: 0, rendered: 0, gzip: 0 },
        lazy: { modules: 1, rendered: 30, gzip: 10 },
      },
    });
  });
});
