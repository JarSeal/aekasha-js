import { describe, expect, it } from 'vitest';
import { type BuildModule, type EmittedAsset, findDebugCodeInBuild } from './debugInProduction';

const MAIN = 'assets/index.js';

const find = (files: string[], modules: BuildModule[], assets: EmittedAsset[] = []) =>
  findDebugCodeInBuild({ files, modules, assets });

describe('findDebugCodeInBuild', () => {
  it('passes a build without debug code', () => {
    expect(
      find(
        [MAIN, 'assets/rapier.js'],
        [
          { id: '/src/_engine/core/MainLoop.ts', chunks: { [MAIN]: 900 } },
          { id: '/src/_engine/kernel/config/DebugModules.ts', chunks: { [MAIN]: 300 } },
          { id: '/src/_engine/features/debugDraw/Lines.ts', chunks: { [MAIN]: 20 } },
          { id: '/src/app/debug/Tools.ts', chunks: { [MAIN]: 30 } },
          { id: '/node_modules/debug/src/browser.js', chunks: { [MAIN]: 40 } },
          { id: '/node_modules/three/build/three.core.js', chunks: { [MAIN]: 9000 } },
        ]
      )
    ).toEqual([]);
  });

  it('ignores tree-shaken debug modules and the debug entry', () => {
    expect(
      find(
        [MAIN],
        [
          { id: '/src/_engine/core/Debug/_dbg__Stats.ts', chunks: {} },
          { id: '/src/_engine/debug/Profiler.ts', chunks: { [MAIN]: 0 } },
          { id: '/src/_engine/debug/index.ts', chunks: { [MAIN]: 12 } },
        ]
      )
    ).toEqual([]);
  });

  it('reports debug chunks and _dbg__ modules', () => {
    expect(
      find(
        [MAIN, 'assets/_dbg__Profiler.js', 'assets/_dbg__Profiler.css'],
        [
          { id: '/src/_engine/core/Debug/_dbg__Profiler.ts', chunks: { 'assets/x.js': 40 } },
          { id: '/src/app/_dbg__demo.ts', chunks: { [MAIN]: 5, 'assets/space.js': 7 } },
        ]
      )
    ).toEqual([
      'debug chunk assets/_dbg__Profiler.css',
      'debug chunk assets/_dbg__Profiler.js',
      'debug module src/_engine/core/Debug/_dbg__Profiler.ts in assets/x.js',
      'debug module src/app/_dbg__demo.ts in assets/index.js, assets/space.js',
    ]);
  });

  it('reports any module under an engine folder named debug, in any case', () => {
    expect(
      find(
        [MAIN],
        [
          { id: '/src/_engine/core/Debug/Panel.module.scss', chunks: { [MAIN]: 10 } },
          { id: '/src/_engine/debug/Profiler.ts', chunks: { [MAIN]: 459 } },
          { id: '/src/_engine/debug/symbols/3DSymbols.ts', chunks: { [MAIN]: 8 } },
          { id: '/src/_engine/kernel/ecs/debug/ECSStressTest.ts', chunks: { [MAIN]: 6 } },
          { id: '/src/_engine/features/lod/debug/LodHelpers.ts', chunks: { [MAIN]: 4 } },
        ]
      )
    ).toEqual([
      'debug module src/_engine/core/Debug/Panel.module.scss in assets/index.js',
      'debug module src/_engine/debug/Profiler.ts in assets/index.js',
      'debug module src/_engine/debug/symbols/3DSymbols.ts in assets/index.js',
      'debug module src/_engine/features/lod/debug/LodHelpers.ts in assets/index.js',
      'debug module src/_engine/kernel/ecs/debug/ECSStressTest.ts in assets/index.js',
    ]);
  });

  it('reports a file emitted for a debug module', () => {
    const shipped = { id: '/src/_engine/kernel/assets/Basis.ts', chunks: { [MAIN]: 50 } };
    expect(
      find(
        [MAIN, 'assets/3DSymbols.glb', 'assets/logo.png', 'assets/basis_transcoder.wasm'],
        [shipped],
        [
          // In a debug folder, whoever imports it
          {
            file: 'assets/3DSymbols.glb',
            id: '/src/_engine/debug/symbols/3DSymbols.glb',
            importers: ['/src/_engine/debug/symbols/_dbg__Symbols.ts'],
          },
          // Imported only by debug modules
          {
            file: 'assets/logo.png',
            id: '/src/toolkit/textures/logo/logo.png',
            importers: ['/src/app/_dbg__Splash.ts', '/src/_engine/kernel/debug/Panel.ts'],
          },
          // A `new URL` file has no importers listed: never a finding by its importers
          {
            file: 'assets/basis_transcoder.wasm',
            id: '/node_modules/three/examples/jsm/libs/basis/basis_transcoder.wasm',
            importers: [],
          },
        ]
      )
    ).toEqual([
      'debug asset assets/3DSymbols.glb (src/_engine/debug/symbols/3DSymbols.glb)',
      'debug asset assets/logo.png (src/toolkit/textures/logo/logo.png, imported only by src/app/_dbg__Splash.ts, src/_engine/kernel/debug/Panel.ts)',
    ]);
  });

  it('passes a file a shipping module imports too', () => {
    expect(
      find(
        [MAIN, 'assets/logo.png'],
        [],
        [
          {
            file: 'assets/logo.png',
            id: '/src/toolkit/textures/logo/logo.png',
            importers: ['/src/app/_dbg__Splash.ts', '/src/app/Splash.ts'],
          },
        ]
      )
    ).toEqual([]);
  });
});
