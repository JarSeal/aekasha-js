import { describe, expect, it } from 'vitest';
import {
  type Manifest,
  type VisualizerData,
  findMainChunkFile,
  listEmittedAssets,
} from './bundleModel';

describe('listEmittedAssets', () => {
  it('lists the manifest’s emitted files with their source and importers, not the chunks', () => {
    const manifest: Manifest = {
      'index.html': { file: 'assets/index-AAAAAAAA.js', src: 'index.html', isEntry: true },
      'style.css': { file: 'assets/style-BBBBBBBB.css', src: 'style.css' },
      '_engine/debug/symbols/3DSymbols.glb': {
        file: 'assets/3DSymbols-CCCCCCCC.glb',
        src: '_engine/debug/symbols/3DSymbols.glb',
      },
      '../node_modules/three/examples/jsm/libs/basis/basis_transcoder.wasm': {
        file: 'assets/basis_transcoder-DDDDDDDD.wasm',
        src: '../node_modules/three/examples/jsm/libs/basis/basis_transcoder.wasm',
      },
    };
    const meta = (id: string, importedBy: string[]) => ({
      id,
      moduleParts: {},
      imported: [],
      importedBy: importedBy.map((uid) => ({ uid })),
    });
    const data: VisualizerData = {
      nodeParts: {},
      nodeMetas: {
        a: meta('/src/_engine/debug/symbols/_dbg__Symbols.ts', []),
        b: meta('/src/_engine/debug/symbols/3DSymbols.glb?url', ['a']),
        // Another query of the same file counts too
        c: meta('/src/_engine/debug/symbols/3DSymbols.glb?url&inline', ['d']),
        d: meta('/src/app/Splash.ts', []),
      },
    };
    expect(
      listEmittedAssets(manifest, data, {
        'assets/3DSymbols-CCCCCCCC.glb': 'assets/3DSymbols.glb',
        'assets/basis_transcoder-DDDDDDDD.wasm': 'assets/basis_transcoder.wasm',
      })
    ).toEqual([
      {
        file: 'assets/3DSymbols.glb',
        id: '/src/_engine/debug/symbols/3DSymbols.glb',
        importers: ['/src/_engine/debug/symbols/_dbg__Symbols.ts', '/src/app/Splash.ts'],
      },
      {
        file: 'assets/basis_transcoder.wasm',
        id: '/node_modules/three/examples/jsm/libs/basis/basis_transcoder.wasm',
        importers: [],
      },
    ]);
  });
});

describe('findMainChunkFile', () => {
  const meta = (id: string, moduleParts: Record<string, string>) => ({
    id,
    moduleParts,
    imported: [],
    importedBy: [],
  });
  const data: VisualizerData = {
    nodeParts: {
      p1: { renderedLength: 10, gzipLength: 5 },
      p2: { renderedLength: 90, gzipLength: 50 },
    },
    nodeMetas: {
      a: meta('/src/a.ts', { 'assets/small-AAAAAAAA.js': 'p1' }),
      b: meta('/src/b.ts', { 'assets/big-BBBBBBBB.js': 'p2' }),
    },
  };

  it('is the entry’s chunk when it’s the largest', () => {
    const manifest: Manifest = {
      'index.html': { file: 'assets/big-BBBBBBBB.js', isEntry: true, imports: ['_small'] },
      _small: { file: 'assets/small-AAAAAAAA.js' },
    };
    expect(findMainChunkFile(manifest, data)).toBe('assets/big-BBBBBBBB.js');
  });

  it('is the largest static import of an entry that re-exports it (an embed’s facade)', () => {
    const manifest: Manifest = {
      'x.embed.ts': { file: 'assets/small-AAAAAAAA.js', isEntry: true, imports: ['_big'] },
      _big: { file: 'assets/big-BBBBBBBB.js' },
    };
    expect(findMainChunkFile(manifest, data)).toBe('assets/big-BBBBBBBB.js');
  });
});
