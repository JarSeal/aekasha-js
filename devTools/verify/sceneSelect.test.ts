import { describe, expect, it } from 'vitest';
import type { RunResult } from './sceneBaseline';
import {
  appliesTo,
  buildSceneUrl,
  checkCrossTargetHashes,
  getSceneConfigs,
  parseSceneRunArgs,
  selectScenes,
} from './sceneSelect';
import { VERIFY_CONFIGS } from './scenes.config';

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

describe('selectScenes', () => {
  const ids = ['scene01', 'space', 'scene02', 'lodShowcase'];

  it('keeps the data order, matching ids and globs once each', () => {
    expect(selectScenes(ids, [])).toEqual({ ids });
    expect(selectScenes(ids, ['scene*', 'scene01'])).toEqual({ ids: ['scene01', 'scene02'] });
    expect(selectScenes(ids, ['lod*', 'space'])).toEqual({ ids: ['space', 'lodShowcase'] });
  });

  it('takes a glob character literally but for *', () => {
    expect(selectScenes(['a.b', 'axb'], ['a.b'])).toEqual({ ids: ['a.b'] });
  });

  it('refuses a pattern that matches nothing, naming the scenes', () => {
    expect(selectScenes(ids, ['scene01', 'nope'])).toEqual({
      error: '--only "nope" matches no scene (scene01, space, scene02, lodShowcase)',
    });
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
    expect(buildSceneUrl('http://localhost:8092/', 'space', VERIFY_CONFIGS.workerSab, 600)).toBe(
      'http://localhost:8092/?isDebug=true&aekTest=true&startScene=space&physicsProbe=600'
    );
    expect(buildSceneUrl('http://localhost:8092', 'space', VERIFY_CONFIGS.prodTest, 600)).toBe(
      'http://localhost:8092/?isProdTest=true&aekTest=true&startScene=space'
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
