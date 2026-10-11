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

  it('reports debug chunks, modules and wrappers', () => {
    expect(
      findDebugCodeInBuild(
        [MAIN, 'assets/_dbg__Profiler.js', 'assets/_dbg__Profiler.css'],
        [
          { id: '/src/_engine/core/Debug/_dbg__Profiler.ts', chunks: { 'assets/x.js': 40 } },
          { id: '/src/_engine/core/Debug/About.module.scss', chunks: { [MAIN]: 10 } },
          { id: '/src/app/_dbg__spaceDemo.ts', chunks: { [MAIN]: 5, 'assets/space.js': 7 } },
          { id: '/src/_engine/debug/Profiler.ts', chunks: { [MAIN]: 459 } },
        ]
      )
    ).toEqual([
      'debug chunk assets/_dbg__Profiler.css',
      'debug chunk assets/_dbg__Profiler.js',
      'debug module src/_engine/core/Debug/About.module.scss in assets/index.js',
      'debug module src/_engine/core/Debug/_dbg__Profiler.ts in assets/x.js',
      'debug module src/app/_dbg__spaceDemo.ts in assets/index.js, assets/space.js',
      'debug wrapper src/_engine/debug/Profiler.ts in assets/index.js',
    ]);
  });
});
