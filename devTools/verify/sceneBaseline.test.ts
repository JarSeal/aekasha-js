import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  BASELINE_FORMAT_VERSION,
  type BaselineContext,
  type BaselineFile,
  findBackendHashMismatches,
  getBaseline,
  getChromiumEntry,
  getResultPaths,
  readBaseline,
  recordBaseline,
  RunAbort,
  type RunResult,
} from './sceneBaseline';

// p619 V1, V2: the scene runner's baseline files, in a temp folder (never `.cache/verify/`)

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'aek-p619-scenes-'));

beforeEach(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true });
});

afterAll(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});

const file = (name: string, content: string) => {
  const at = path.join(TMP, name);
  fs.mkdirSync(path.dirname(at), { recursive: true });
  fs.writeFileSync(at, content);
  return at;
};

const baselineOf = (entries: BaselineFile['entries']): BaselineFile => ({
  formatVersion: BASELINE_FORMAT_VERSION,
  entries,
});

const entry = (hash: string, steps = 600) => ({ hash, steps, recordedAt: 't', commit: 'c' });

describe('readBaseline', () => {
  it('reads a missing baseline as empty', () => {
    expect(readBaseline(path.join(TMP, 'none.json'), false)).toEqual({
      baseline: baselineOf({}),
      problem: null,
    });
  });

  it('reads a good one', () => {
    const good = baselineOf({ 'a|workerSab': entry('h') });
    expect(readBaseline(file('b.json', JSON.stringify(good)), false).baseline).toEqual(good);
  });

  it('stops the run on one it can read neither as JSON nor in this format', () => {
    expect(() => readBaseline(file('bad.json', '{ cut off'), false)).toThrow(RunAbort);
    expect(() =>
      readBaseline(file('old.json', JSON.stringify({ formatVersion: 0, entries: {} })), false)
    ).toThrow(/is format 0, this runner reads 1\. Record a new one/);
  });

  it('records over a bad one with --update, saying what was wrong', () => {
    const read = readBaseline(file('bad.json', 'nope'), true);
    expect(read.baseline).toEqual(baselineOf({}));
    expect(read.problem).toMatch(/isn't readable JSON: --update records a new one$/);
  });
});

describe('the baseline context', () => {
  const ctx = (baselines: Partial<Record<'webgl' | 'webgpu', BaselineFile>>): BaselineContext => ({
    isRecording: false,
    baselines: new Map(Object.entries(baselines)) as BaselineContext['baselines'],
    onProblem: () => undefined,
    cacheDir: TMP,
  });

  it('reads a backend on first use and keeps it', () => {
    const c = ctx({});
    const at = getResultPaths('webgl', TMP).baselineFile;
    file(path.relative(TMP, at), JSON.stringify(baselineOf({ 'a|workerSab': entry('h') })));
    expect(getBaseline(c, 'webgl').entries['a|workerSab'].hash).toBe('h');
    fs.rmSync(at);
    expect(getBaseline(c, 'webgl').entries['a|workerSab'].hash).toBe('h');
    expect(getBaseline(c, 'webgpu')).toEqual(baselineOf({}));
  });

  it("gives Firefox Chromium's webgl entry first, then the webgpu one", () => {
    const c = ctx({
      webgl: baselineOf({
        'a|workerSab': entry('gl'),
        'b|workerSab': { recordedAt: 't', commit: 'c' },
      }),
      webgpu: baselineOf({ 'a|workerSab': entry('gpu'), 'b|workerSab': entry('gpu-b') }),
    });
    expect(getChromiumEntry(c, 'a|workerSab')).toMatchObject({
      backend: 'webgl',
      entry: { hash: 'gl' },
    });
    expect(getChromiumEntry(c, 'b|workerSab')).toMatchObject({ backend: 'webgpu' });
    expect(getChromiumEntry(c, 'c|workerSab')).toBeNull();
  });

  it('finds the runs the two backends hashed differently at the same steps', () => {
    const c = ctx({
      webgl: baselineOf({ a: entry('1'), b: entry('2'), c: entry('3', 120) }),
      webgpu: baselineOf({ a: entry('1'), b: entry('x'), c: entry('y', 600) }),
    });
    expect(findBackendHashMismatches(c)).toEqual({
      shared: 2,
      mismatches: ['b webgl 2, webgpu x'],
    });
  });
});

describe('recordBaseline', () => {
  const result = (sceneId: string, status: RunResult['status'], extra: Partial<RunResult> = {}) =>
    ({
      sceneId,
      config: 'workerSab',
      status,
      failures: [],
      warnings: [],
      notes: [],
      errors: [],
      durationMs: 1,
      ...extra,
    }) as RunResult;

  it('merges the passed and new runs, copies their snapshots and marks them recorded', () => {
    const paths = getResultPaths('webgl', TMP);
    file(path.relative(TMP, path.join(paths.lastRunDir, 'a.workerSab.png')), 'png');
    const baseline = baselineOf({ 'old|workerSab': entry('o'), 'b|workerSab': entry('kept') });
    const results = [
      result('a', 'PASS', {
        hash: 'h',
        steps: 600,
        probeConfig: 'P',
        snapshotFile: 'a.workerSab.png',
      }),
      result('b', 'FAIL', { hash: 'bad' }),
      result('c', 'NEW', { pathHash: 'p', pathSteps: 600 }),
    ];
    recordBaseline({ paths, baseline, results, commit: 'abc', now: '2026-10-22T00:00:00Z' });

    const written = JSON.parse(fs.readFileSync(paths.baselineFile, 'utf8')) as BaselineFile;
    expect(written.entries).toEqual({
      'old|workerSab': entry('o'),
      'b|workerSab': entry('kept'),
      'a|workerSab': {
        recordedAt: '2026-10-22T00:00:00Z',
        commit: 'abc',
        hash: 'h',
        steps: 600,
        probeConfig: 'P',
        snapshot: 'a.workerSab.png',
      },
      'c|workerSab': {
        recordedAt: '2026-10-22T00:00:00Z',
        commit: 'abc',
        pathHash: 'p',
        pathSteps: 600,
      },
    });
    expect(fs.readFileSync(path.join(paths.baselineDir, 'a.workerSab.png'), 'utf8')).toBe('png');
    expect(results.map((r) => r.status)).toEqual(['UPDATED', 'FAIL', 'UPDATED']);
  });
});
