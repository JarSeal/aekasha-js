import { describe, expect, it } from 'vitest';
import { findDebugCodeInBuild } from './debugInProduction';

const MAIN = 'assets/index.js';

describe('findDebugCodeInBuild', () => {
  it('passes a build without debug code', () => {
    expect(
      findDebugCodeInBuild(
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
      findDebugCodeInBuild(
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
      findDebugCodeInBuild(
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
      findDebugCodeInBuild(
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
});
