import { describe, expect, it } from 'vitest';
import type { RunResult } from './sceneBaseline';
import {
  appliesTo,
  buildSceneUrl,
  checkCrossTargetHashes,
  getSceneConfigs,
  getSceneTargets,
  getTargetSceneId,
  parseSceneRunArgs,
  selectTargets,
} from './sceneSelect';
import { SCENE_VERIFY_CONFIG, VERIFY_CONFIGS } from './scenes.config';

// p619 V1: the scene runner's pure parts, apart from its CLI

const parse = (...argv: string[]) => parseSceneRunArgs(argv);
const args = (...argv: string[]) => {
  const result = parse(...argv);
  if ('error' in result) throw new Error(result.error);
  return result.args;
};

describe('parseSceneRunArgs', () => {
  it('defaults to every configuration on Chromium', () => {
    expect(args()).toEqual({
      only: [],
      configs: ['workerSab', 'workerMsg', 'mainThread', 'prodTest', 'debugger'],
      update: false,
      url: null,
      webgl: false,
      headed: false,
      browser: 'chromium',
    });
  });

  it('reads the options, a set and configurations together, without duplicates', () => {
    expect(
      args('--only', 'a,b*', '--only', 'c', '--config', 'quick,workerSab,prodTest', '--update')
    ).toMatchObject({
      only: ['a', 'b*', 'c'],
      configs: ['workerSab', 'prodTest'],
      update: true,
    });
    expect(args('--url', 'http://x', '--webgl', '--headed')).toMatchObject({
      url: 'http://x',
      webgl: true,
      headed: true,
    });
  });

  it('refuses an unknown argument, configuration or browser, and a missing value', () => {
    expect(parse('--nope')).toEqual({ error: 'Unknown argument: --nope' });
    expect(parse('--config', 'fast')).toMatchObject({
      error: expect.stringMatching(/^Unknown configuration or set "fast" \(all, quick, /),
    });
    expect(parse('--browser', 'safari')).toEqual({
      error: 'Unknown browser "safari" (chromium, firefox)',
    });
    expect(parse('--only')).toEqual({ error: '--only needs a value' });
  });

  it('runs Firefox on the debug configurations only, never recording', () => {
    expect(args('--browser', 'firefox').configs).toEqual(['workerSab', 'workerMsg', 'mainThread']);
    expect(parse('--browser', 'firefox', '--config', 'prodTest,debugger')).toEqual({
      error:
        "--browser firefox runs the debug configurations' hashes only (not prodTest, debugger)",
    });
    expect(parse('--browser', 'firefox', '--update')).toMatchObject({
      error: expect.stringContaining('no --update'),
    });
  });
});

describe('selectTargets', () => {
  const ids = ['scene01', 'space', 'scene02', 'lodShowcase'];
  const plain = ids.map((id) => getSceneTargets(id, undefined)[0]);
  const runIds = (r: ReturnType<typeof selectTargets>) =>
    'targets' in r ? r.targets.map((t) => t.id) : r;

  it('keeps the data order, matching ids and globs once each', () => {
    expect(runIds(selectTargets(plain, []))).toEqual(ids);
    expect(runIds(selectTargets(plain, ['scene*', 'scene01']))).toEqual(['scene01', 'scene02']);
    expect(runIds(selectTargets(plain, ['lod*', 'space']))).toEqual(['space', 'lodShowcase']);
  });

  it('takes a glob character literally but for *', () => {
    const dotted = ['a.b', 'axb'].map((id) => getSceneTargets(id, undefined)[0]);
    expect(runIds(selectTargets(dotted, ['a.b']))).toEqual(['a.b']);
  });

  it('refuses a pattern that matches nothing, naming the scenes', () => {
    expect(selectTargets(plain, ['scene01', 'nope'])).toEqual({
      error: '--only "nope" matches no scene (scene01, space, scene02, lodShowcase)',
    });
  });

  it("matches a scene's every variant by its id, or one by its run name", () => {
    const targets = [
      ...plain,
      ...getSceneTargets('stress', {
        variants: [
          { id: 'a', params: {}, reason: 'a' },
          { id: 'b', params: {}, reason: 'b' },
        ],
      }),
    ];
    expect(runIds(selectTargets(targets, ['stress']))).toEqual(['stress@a', 'stress@b']);
    expect(runIds(selectTargets(targets, ['stress@b']))).toEqual(['stress@b']);
    expect(runIds(selectTargets(targets, ['*@a', 'space']))).toEqual(['space', 'stress@a']);
  });
});

describe('getSceneTargets', () => {
  it('is one run of the scene, with its params, without variants', () => {
    expect(getSceneTargets('space', undefined)).toEqual([
      { id: 'space', sceneId: 'space', params: {} },
    ]);
    expect(getSceneTargets('space', { params: { x: '1' } })).toEqual([
      { id: 'space', sceneId: 'space', params: { x: '1' } },
    ]);
  });

  it("is a run per variant, its params over the scene's", () => {
    expect(
      getSceneTargets('stress', {
        params: { count: '20', path: 'cpu' },
        variants: [
          { id: 'pools', params: {}, reason: 'pools' },
          { id: 'set', params: { path: 'gpu' }, reason: 'set' },
        ],
      })
    ).toEqual([
      { id: 'stress@pools', sceneId: 'stress', params: { count: '20', path: 'cpu' } },
      { id: 'stress@set', sceneId: 'stress', params: { count: '20', path: 'gpu' } },
    ]);
    expect(getTargetSceneId('stress@set')).toBe('stress');
    expect(getTargetSceneId('space')).toBe('space');
  });

  it("refuses a bad or repeated variant id, and the runner's own parameters", () => {
    const variant = (id: string) => ({ id, params: {}, reason: id });
    expect(() => getSceneTargets('s', { variants: [variant('a@b')] })).toThrow('variant id');
    expect(() => getSceneTargets('s', { variants: [variant('a'), variant('a')] })).toThrow(
      'repeats'
    );
    expect(() => getSceneTargets('s', { params: { startScene: 'x' } })).toThrow('startScene');
  });

  it("gives every configured scene's runs without an error", () => {
    for (const [id, config] of Object.entries(SCENE_VERIFY_CONFIG)) {
      expect(getSceneTargets(id, config).length).toBeGreaterThan(0);
    }
  });
});

describe('appliesTo', () => {
  it('matches every run without filters, and a run its filters name', () => {
    expect(appliesTo({}, 'workerSab', 'chromium')).toBe(true);
    expect(appliesTo({ configs: ['mainThread'] }, 'mainThread', 'chromium')).toBe(true);
    expect(appliesTo({ configs: ['mainThread'] }, 'workerSab', 'chromium')).toBe(false);
    expect(appliesTo({ browsers: ['firefox'] }, 'workerSab', 'chromium')).toBe(false);
    expect(
      appliesTo({ configs: ['workerSab'], browsers: ['firefox'] }, 'workerSab', 'firefox')
    ).toBe(true);
  });

  it('matches a configuration filter never without a configuration', () => {
    expect(appliesTo({ configs: ['workerSab'] }, null, 'chromium')).toBe(false);
    expect(appliesTo({ browsers: ['chromium'] }, null, 'chromium')).toBe(true);
  });
});

describe('getSceneConfigs', () => {
  it('runs the debugger configuration only on a scene with debugger settings', () => {
    const all = args().configs;
    expect(getSceneConfigs(all, undefined)).toEqual([
      'workerSab',
      'workerMsg',
      'mainThread',
      'prodTest',
    ]);
    expect(getSceneConfigs(all, { debugger: { tabs: 'ALL' } })).toEqual(all);
  });
});

describe('buildSceneUrl', () => {
  it('arms the probe in the debug env, and not in prod test', () => {
    const space = { sceneId: 'space', params: {} };
    expect(buildSceneUrl('http://localhost:8092/', space, VERIFY_CONFIGS.workerSab, 600)).toBe(
      'http://localhost:8092/?isDebug=true&aekTest=true&startScene=space&physicsProbe=600'
    );
    expect(buildSceneUrl('http://localhost:8092', space, VERIFY_CONFIGS.prodTest, 600)).toBe(
      'http://localhost:8092/?isProdTest=true&aekTest=true&startScene=space'
    );
  });

  it("adds a run's params after the start scene", () => {
    const stress = { sceneId: 'stress', params: { stressPath: 'gpu' } };
    expect(buildSceneUrl('http://localhost:8092', stress, VERIFY_CONFIGS.prodTest, 600)).toBe(
      'http://localhost:8092/?isProdTest=true&aekTest=true&startScene=stress&stressPath=gpu'
    );
  });
});

describe('checkCrossTargetHashes', () => {
  const result = (config: RunResult['config'], hash?: string): RunResult => ({
    sceneId: 's',
    config,
    status: 'PASS',
    failures: [],
    warnings: [],
    notes: [],
    errors: [],
    durationMs: 0,
    ...(hash ? { hash } : {}),
  });

  it('is null when every hashed configuration agrees', () => {
    expect(
      checkCrossTargetHashes([
        result('workerSab', 'a'),
        result('mainThread', 'a'),
        result('prodTest'),
      ])
    ).toBeNull();
  });

  it('lists the hashes per configuration when they differ', () => {
    expect(checkCrossTargetHashes([result('workerSab', 'a'), result('mainThread', 'b')])).toBe(
      'workerSab a, mainThread b'
    );
  });
});
