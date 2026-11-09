import { describe, expect, it } from 'vitest';
import {
  averageSamples,
  type BenchResult,
  buildBenchUrl,
  DEFAULT_BENCH_COUNTS,
  formatBenchTables,
  getNeededMaxEntities,
  parseBenchArgs,
} from './instanceStressBench';

const parse = (argv: string[]) => {
  const parsed = parseBenchArgs(argv);
  if ('error' in parsed) throw new Error(parsed.error);
  return parsed.args;
};

describe('parseBenchArgs', () => {
  it("defaults to Phase 0's counts, both paths, the debug env and its own server", () => {
    const args = parse([]);
    expect(args.counts).toEqual(DEFAULT_BENCH_COUNTS);
    expect(args.paths).toEqual(['cpu', 'gpu']);
    expect(args.mode).toBe('debug');
    expect(args.url).toBeNull();
    expect(args.build).toBe(false);
  });

  it('takes counts with k and m, the paths, the mode and the flags', () => {
    const args = parse([
      '--counts',
      '5k,20000,1m',
      '--paths',
      'gpu',
      '--mode',
      'prodTest',
      '--build',
      '--shadow',
      '--fade-seconds',
      '0',
      '--orbit-hold',
      '--frames',
      '60',
    ]);
    expect(args.counts).toEqual([5_000, 20_000, 1_000_000]);
    expect(args.paths).toEqual(['gpu']);
    expect(args.mode).toBe('prodTest');
    expect(args.build && args.shadow && args.orbitHold).toBe(true);
    expect(args.fadeSeconds).toBe(0);
    expect(args.frames).toBe(60);
  });

  it('refuses bad values and --build with --url', () => {
    expect(parseBenchArgs(['--counts', '2m'])).toEqual({
      error: '--counts: 1 to 1000000 each (2m)',
    });
    expect(parseBenchArgs(['--paths', 'cpu,webgl'])).toMatchObject({ error: /--paths/ });
    expect(parseBenchArgs(['--mode', 'production'])).toMatchObject({ error: /--mode/ });
    expect(parseBenchArgs(['--frames', '0'])).toMatchObject({ error: /--frames/ });
    expect(parseBenchArgs(['--build', '--url', 'http://x'])).toMatchObject({ error: /--build/ });
    expect(parseBenchArgs(['--frames'])).toEqual({ error: '--frames needs a value' });
    expect(parseBenchArgs(['--nope'])).toEqual({ error: 'Unknown argument: --nope' });
  });
});

describe('buildBenchUrl', () => {
  it("is the scene's page with its flags, in the mode, through the test bridge", () => {
    const args = parse(['--mode', 'prodTest', '--fade-seconds', '0.25', '--orbit-hold']);
    expect(buildBenchUrl('http://localhost:8092/', args, { count: 20_000, path: 'gpu' })).toBe(
      'http://localhost:8092/?isProdTest=true&aekTest=true&startScene=instanceStress' +
        '&stressInstances=20000&stressPath=gpu&stressCamera=ORBIT&stressFadeSeconds=0.25' +
        '&stressOrbitHold=true'
    );
  });
});

describe('getNeededMaxEntities', () => {
  it('is 0 under 90k pool trees, else room for the largest pool case', () => {
    expect(getNeededMaxEntities([{ count: 1_000_000, path: 'gpu' }])).toBe(0);
    expect(getNeededMaxEntities([{ count: 50_000, path: 'cpu' }])).toBe(0);
    expect(getNeededMaxEntities([{ count: 200_000, path: 'cpu' }])).toBe(230_000);
  });
});

describe('averageSamples', () => {
  it('averages the numbers, leaving out what the panel showed as n/a', () => {
    expect(averageSamples([1, NaN, 3])).toBe(2);
    expect(averageSamples([NaN])).toBeNaN();
  });
});

describe('formatBenchTables', () => {
  it('prints the cost and the levels per case, a dash for a figure that is n/a', () => {
    const result: BenchResult = {
      count: 20_000,
      path: 'gpu',
      gpuMs: 1.5,
      computeMs: NaN,
      errors: [],
      summary: {
        count: 20_000,
        path: 'GPU',
        backend: 'WebGPU',
        avg: { poolSyncMs: 0.01, lodMs: 0.02, renderMs: 0.5, cpuMs: 1.09, intervalMs: 16.7 },
        levels: [221, 1384, 3392],
        overflow: [0, 0, 0],
        cameras: [{ name: 'DirectionalLight shadow', drawn: [603, 1492, 0] }],
        state: { levels: [960, 5429, 13611], culled: 0, fading: 0 },
        builds: { nodeBuilds: 3, pipelines: 6, vertex: 3, fragment: 3 },
      },
    };
    const lines = formatBenchTables([result, { ...result, summary: null, failure: 'x' }]);
    expect(lines).toContain(
      '| 20,000 | GPU | 1.09 ms | 0.01 ms | 0.02 ms | 0.50 ms | 1.50 ms | — |'
    );
    expect(lines).toContain(
      '| 20,000 | GPU | 221 / 1,384 / 3,392 | DirectionalLight shadow: 603 / 1,492 / 0 | 0 / 0 / 0 | 960 / 5,429 / 13,611 | 0 | 0 | 3 nodes, 6 pipelines |'
    );
    // The failed case has no row
    expect(lines.filter((l) => l.startsWith('| 20,000'))).toHaveLength(2);
  });
});
