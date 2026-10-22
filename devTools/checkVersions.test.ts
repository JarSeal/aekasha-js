import { describe, expect, it } from 'vitest';
import { checkAlwaysRules, checkBumps, type PartKey, type Pkg } from './checkVersions';

// package.json's keys (computed below: they aren't camel case)
const ENGINE: PartKey = 'engine_metadata';
const TOOLKIT: PartKey = 'toolkit_metadata';
const APP: PartKey = 'app_metadata';

// p619 D14: the versioning rules of `.claude/CLAUDE.md`, without git

const pkg = (
  engine: string,
  toolkit: string,
  app: string,
  codenames = ['Dawn', 'Crescent', 'Kid']
): Pkg => ({
  version: engine,
  [ENGINE]: { version: engine, codename: codenames[0] },
  [TOOLKIT]: { version: toolkit, codename: codenames[1] },
  [APP]: { version: app, codename: codenames[2] },
});

const REF = pkg('5.9.0', '2.3.1', '4.0.2');

const check = (current: Pkg, changed: Partial<Record<'engine' | 'toolkit' | 'app', string[]>>) =>
  checkBumps({
    pkg: current,
    refPkg: REF,
    changedFiles: {
      [ENGINE]: changed.engine,
      [TOOLKIT]: changed.toolkit,
      [APP]: changed.app,
    },
    ref: 'main',
  });

describe('checkAlwaysRules', () => {
  it('passes a valid package.json', () => {
    expect(checkAlwaysRules(REF)).toEqual([]);
  });

  it('needs semver, a codename, and the project version equal to the engine’s', () => {
    const bad = { ...pkg('5.9', '2.3.1', '4.0.2', ['Dawn', '', 'Kid']), version: '5.8.0' };
    expect(checkAlwaysRules(bad)).toEqual([
      'Engine: engine_metadata.version "5.9" is not MAJOR.MINOR.PATCH.',
      'Toolkit: toolkit_metadata.codename is missing.',
      'The project version (5.8.0) must equal engine_metadata.version (5.9).',
    ]);
  });
});

describe('checkBumps', () => {
  it('accepts one bump per changed part, resetting the lower parts', () => {
    const result = check(pkg('5.10.0', '2.3.1', '4.0.3'), { engine: ['a.ts'], app: ['b.ts'] });
    expect(result).toEqual({ errors: [], notes: [] });
  });

  it('needs a bump for a part whose files changed', () => {
    const { errors } = check(REF, { toolkit: ['src/toolkit/x.ts'] });
    expect(errors).toEqual([
      'Toolkit: 1 file(s) changed since main (eg. src/toolkit/x.ts), but the version is still 2.3.1. Bump it.',
    ]);
  });

  it('refuses a skip, a missing reset and a lower version', () => {
    expect(check(pkg('5.11.0', '2.3.1', '4.0.2'), { engine: ['a'] }).errors).toEqual([
      "Engine: 5.9.0 → 5.11.0 skips or doesn't reset the lower parts. Expected 5.10.0.",
    ]);
    expect(check(pkg('5.10.1', '2.3.1', '4.0.2'), { engine: ['a'] }).errors).toEqual([
      "Engine: 5.9.0 → 5.10.1 skips or doesn't reset the lower parts. Expected 5.10.0.",
    ]);
    expect(check(pkg('5.8.0', '2.3.1', '4.0.2'), { engine: ['a'] }).errors).toEqual([
      "Engine: 5.8.0 is lower than main's 5.9.0.",
    ]);
  });

  it('ties a codename change to a major bump', () => {
    expect(check(pkg('6.0.0', '2.3.1', '4.0.2'), { engine: ['a'] }).errors).toEqual([
      'Engine: a major bump needs a new codename (still "Dawn").',
    ]);
    expect(
      check(pkg('6.0.0', '2.3.1', '4.0.2', ['Sunrise', 'Crescent', 'Kid']), { engine: ['a'] })
    ).toEqual({ errors: [], notes: [] });
    expect(
      check(pkg('5.10.0', '2.3.1', '4.0.2', ['Sunrise', 'Crescent', 'Kid']), { engine: ['a'] })
        .errors
    ).toEqual(['Engine: the codename changed ("Dawn" → "Sunrise") without a major bump.']);
  });

  it('notes a bump without changed files, and a part new on the branch', () => {
    expect(check(pkg('5.9.0', '2.4.0', '4.0.2'), {}).notes).toEqual([
      'Toolkit: bumped to 2.4.0, but none of its files changed since main.',
    ]);
    const result = checkBumps({
      pkg: REF,
      refPkg: { ...REF, [APP]: undefined },
      changedFiles: {},
      ref: 'main',
    });
    expect(result.notes).toEqual(['App: new on this branch, starts at 4.0.2.']);
  });
});
