import { describe, expect, it } from 'vitest';
import { type BuildModule, type EmittedAsset, MAIN_BUILD } from '../sbp/bundleModel';
import { findDebugCodeInBuild } from './debugInProduction';

const MAIN = 'assets/index.js';

/** A module of the main build */
const main = (id: string, chunks: Record<string, number>): BuildModule => ({
  id,
  build: MAIN_BUILD,
  chunks,
});

const find = (files: string[], modules: BuildModule[], assets: EmittedAsset[] = []) =>
  findDebugCodeInBuild({ files, modules, assets });

describe('findDebugCodeInBuild', () => {
  it('passes a build without debug code', () => {
    expect(
      find(
        [MAIN, 'assets/rapier.js'],
        [
          main('/src/_engine/kernel/loop/MainLoop.ts', { [MAIN]: 900 }),
          main('/src/_engine/kernel/config/DebugModules.ts', { [MAIN]: 300 }),
          main('/src/_engine/features/debugDraw/Lines.ts', { [MAIN]: 20 }),
          main('/src/app/debug/Tools.ts', { [MAIN]: 30 }),
          main('/node_modules/debug/src/browser.js', { [MAIN]: 40 }),
          main('/node_modules/three/build/three.core.js', { [MAIN]: 9000 }),
        ]
      )
    ).toEqual([]);
  });

  it('ignores tree-shaken debug modules and the debug entry', () => {
    expect(
      find(
        [MAIN],
        [
          main('/src/_engine/debug/_dbg__Stats.ts', {}),
          main('/src/_engine/debug/Profiler.ts', { [MAIN]: 0 }),
          main('/src/_engine/debug/index.ts', { [MAIN]: 12 }),
        ]
      )
    ).toEqual([]);
  });

  it('reports debug chunks and _dbg__ modules', () => {
    expect(
      find(
        [MAIN, 'assets/_dbg__Profiler.js', 'assets/_dbg__Profiler.css'],
        [
          main('/src/_engine/debug/profiler/_dbg__Profiler.ts', { 'assets/x.js': 40 }),
          main('/src/app/_dbg__demo.ts', { [MAIN]: 5, 'assets/space.js': 7 }),
        ]
      )
    ).toEqual([
      'debug chunk assets/_dbg__Profiler.css',
      'debug chunk assets/_dbg__Profiler.js',
      'debug module src/_engine/debug/profiler/_dbg__Profiler.ts in assets/x.js',
      'debug module src/app/_dbg__demo.ts in assets/index.js, assets/space.js',
    ]);
  });

  it('reports a debug module in a worker build (p619 V7), naming the worker', () => {
    expect(
      find(
        [MAIN, 'assets/PhysicsWorker.js@PhysicsWorker'],
        [
          {
            id: '/src/_engine/features/physics/debug/_dbg__WorkerStats.ts',
            build: 'PhysicsWorker',
            chunks: { 'assets/PhysicsWorker.js@PhysicsWorker': 120 },
          },
        ]
      )
    ).toEqual([
      'debug module src/_engine/features/physics/debug/_dbg__WorkerStats.ts in assets/PhysicsWorker.js@PhysicsWorker (the PhysicsWorker worker)',
    ]);
  });

  it('reports any module under an engine folder named debug, in any case', () => {
    expect(
      find(
        [MAIN],
        [
          main('/src/_engine/kernel/render/Debug/Panel.module.scss', { [MAIN]: 10 }),
          main('/src/_engine/debug/Profiler.ts', { [MAIN]: 459 }),
          main('/src/_engine/debug/symbols/3DSymbols.ts', { [MAIN]: 8 }),
          main('/src/_engine/kernel/ecs/debug/ECSStressTest.ts', { [MAIN]: 6 }),
          main('/src/_engine/features/lod/debug/LodHelpers.ts', { [MAIN]: 4 }),
        ]
      )
    ).toEqual([
      'debug module src/_engine/debug/Profiler.ts in assets/index.js',
      'debug module src/_engine/debug/symbols/3DSymbols.ts in assets/index.js',
      'debug module src/_engine/features/lod/debug/LodHelpers.ts in assets/index.js',
      'debug module src/_engine/kernel/ecs/debug/ECSStressTest.ts in assets/index.js',
      'debug module src/_engine/kernel/render/Debug/Panel.module.scss in assets/index.js',
    ]);
  });

  it('reports a file emitted for a debug module', () => {
    const shipped = main('/src/_engine/kernel/assets/Basis.ts', { [MAIN]: 50 });
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

  it('reports a feature debug hook call left in a script, not the context', () => {
    const code =
      'const c={addSceneHooks:Xe,onDebug:r=>{},onDebugAfterStart:r=>{}};' +
      'install:n=>{n.addSceneHooks(use),n.onDebug(Qte),n.onDebugAfterStart(()=>Gae())}';
    expect(
      findDebugCodeInBuild({
        files: [MAIN, 'assets/space.js'],
        modules: [],
        assets: [],
        scripts: [
          { file: MAIN, code },
          { file: 'assets/space.js', code: 'if(!1)ctx.onDebugger(x);const onDebug=1;' },
        ],
      })
    ).toEqual([
      'ungated debug hook call in assets/index.js: n.onDebug(Qte),n.onDebugAfterStart(()=>Ga…',
      'ungated debug hook call in assets/index.js: n.onDebugAfterStart(()=>Gae())}…',
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
