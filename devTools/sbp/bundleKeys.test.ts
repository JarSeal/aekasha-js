import path from 'path';
import { describe, expect, it } from 'vitest';
import { findReachableFiles, keyBuildFiles } from './bundleKeys';
import type { Manifest } from './bundleModel';

describe('findReachableFiles', () => {
  const files: Record<string, string> = {
    'x.embed.js': 'import{a}from"./assets/main-AAAAAAAA.js"',
    'assets/main-AAAAAAAA.js': 'new URL("AssetsWorker-BBBBBBBB.js",import.meta.url)',
    'assets/AssetsWorker-BBBBBBBB.js': 'import("./GLTFLoader-CCCCCCCC.js")',
    'assets/GLTFLoader-CCCCCCCC.js': 'new URL("draco-DDDDDDDD.wasm",import.meta.url)',
    'assets/draco-DDDDDDDD.wasm': 'not read: PhysicsWorker-EEEEEEEE.js',
    // Emitted for a tree-shaken importer: no kept file names them
    'assets/PhysicsWorker-EEEEEEEE.js': 'import("./rapier-FFFFFFFF.js")',
    'assets/rapier-FFFFFFFF.js': '',
    'assets/x-GGGGGGGG.css': 'url(./font-HHHHHHHH.woff2)',
    'assets/font-HHHHHHHH.woff2': '',
  };
  const read = (file: string) => files[file];

  it('follows the names in the text files from the roots, never into a binary', () => {
    const reached = findReachableFiles(
      ['x.embed.js', 'assets/x-GGGGGGGG.css'],
      Object.keys(files),
      read
    );
    expect([...reached].sort()).toEqual([
      'assets/AssetsWorker-BBBBBBBB.js',
      'assets/GLTFLoader-CCCCCCCC.js',
      'assets/draco-DDDDDDDD.wasm',
      'assets/font-HHHHHHHH.woff2',
      'assets/main-AAAAAAAA.js',
      'assets/x-GGGGGGGG.css',
      'x.embed.js',
    ]);
  });
});

describe('keyBuildFiles', () => {
  // The app's build: Rapier's facade in the main build and in the physics worker's, the worker's
  // entry next to its `?worker` wrapper, and three's two Draco decoders
  const MAIN_RAPIER = 'assets/EngineRapier-BkGvJJ1k.js';
  const WORKER_RAPIER = 'assets/EngineRapier-DtAIbq5W.js';
  const WRAPPER = 'assets/PhysicsWorker-Ezn3wxiT.js';
  const WORKER = 'assets/PhysicsWorker-CIE76409.js';
  const DRACO = 'assets/draco_decoder-C32yEggz.wasm';
  const DRACO_GLTF = 'assets/draco_decoder-Z1_iN-Ht.wasm';
  const manifest: Manifest = {
    'index.html': { file: 'assets/index-AAAAAAAA.js', isEntry: true },
    '_engine/features/physics/backends/rapier/EngineRapier.ts': {
      file: MAIN_RAPIER,
      src: '_engine/features/physics/backends/rapier/EngineRapier.ts',
    },
    '_engine/features/physics/worker/PhysicsWorker.ts?worker': {
      file: WRAPPER,
      src: '_engine/features/physics/worker/PhysicsWorker.ts?worker',
    },
    '../node_modules/three/examples/jsm/libs/draco/draco_decoder.wasm': {
      file: DRACO,
      src: '../node_modules/three/examples/jsm/libs/draco/draco_decoder.wasm',
    },
    '../node_modules/three/examples/jsm/libs/draco/gltf/draco_decoder.wasm': {
      file: DRACO_GLTF,
      src: '../node_modules/three/examples/jsm/libs/draco/gltf/draco_decoder.wasm',
    },
  };
  const texts: Record<string, string> = {
    [WRAPPER]: `new Worker("/${WORKER}")`,
    [WORKER]: `import("./${path.posix.basename(WORKER_RAPIER)}")`,
  };
  const key = (files: string[], over: Partial<Parameters<typeof keyBuildFiles>[0]> = {}) =>
    keyBuildFiles({
      files,
      manifest,
      workers: { PhysicsWorker: [WORKER] },
      read: (file) => texts[file] ?? '',
      ...over,
    });
  const ALL = [
    'assets/index-AAAAAAAA.js',
    MAIN_RAPIER,
    WORKER_RAPIER,
    WRAPPER,
    WORKER,
    DRACO,
    DRACO_GLTF,
  ];

  it('keeps a name one file has; in a collision the manifest’s file keeps it, a worker’s gets @<worker>', () => {
    expect(key(ALL)).toEqual({
      'assets/index-AAAAAAAA.js': 'assets/index.js',
      [MAIN_RAPIER]: 'assets/EngineRapier.js',
      [WORKER_RAPIER]: 'assets/EngineRapier.js@PhysicsWorker',
      [WRAPPER]: 'assets/PhysicsWorker.js',
      [WORKER]: 'assets/PhysicsWorker.js@PhysicsWorker',
      [DRACO]: 'assets/draco_decoder.wasm@draco',
      [DRACO_GLTF]: 'assets/draco_decoder.wasm@gltf',
    });
  });

  it('gives the same keys when the hashes sort the other way', () => {
    const swapped = (file: string) =>
      file.replace('BkGvJJ1k', 'zzzzzzz1').replace('DtAIbq5W', 'AAAAAAA2');
    const keys = key(ALL.map(swapped), {
      manifest: Object.fromEntries(
        Object.entries(manifest).map(([k, v]) => [k, { ...v, file: swapped(v.file) }])
      ),
      read: (file) => (texts[file] ?? '').replace('DtAIbq5W', 'AAAAAAA2'),
    });
    expect(keys[swapped(MAIN_RAPIER)]).toBe('assets/EngineRapier.js');
    expect(keys[swapped(WORKER_RAPIER)]).toBe('assets/EngineRapier.js@PhysicsWorker');
  });

  it('throws on a shared name neither rule tells apart', () => {
    // Not in the manifest, and no worker reaches it
    expect(() => key([...ALL, 'assets/EngineRapier-CCCCCCCC.js'])).toThrow(
      /assets\/EngineRapier-CCCCCCCC\.js isn't in the manifest and no worker build reaches it/
    );
    // Two workers reach it
    expect(() => key(ALL, { workers: { PhysicsWorker: [WORKER], Other: [WORKER] } })).toThrow(
      /PhysicsWorker and Other reach it/
    );
    // Two manifest files from folders of one name
    const sameFolder = {
      ...manifest,
      '../node_modules/three/examples/jsm/libs/draco/gltf/draco_decoder.wasm': {
        file: DRACO_GLTF,
        src: '../node_modules/other/draco/draco_decoder.wasm',
      },
    };
    expect(() => key(ALL, { manifest: sameFolder })).toThrow(
      /share the key assets\/draco_decoder\.wasm@draco/
    );
  });
});
