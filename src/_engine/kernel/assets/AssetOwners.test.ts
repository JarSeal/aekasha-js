import { afterEach, describe, expect, test } from 'vitest';
import {
  copyAssetOwner,
  getAssetOwner,
  getAssetOwnerScope,
  getAssetOwners,
  getCellOwnerKey,
  isSceneOwnerKey,
  recordAssetOwner,
  releaseAssetOwners,
  retagAssetOwner,
  runInAssetOwnerScope,
  setAssetOwnerScene,
} from './AssetOwners';

afterEach(() => {
  setAssetOwnerScene(null);
});

const recordFor = (owner: string | null) => {
  const asset = {};
  runInAssetOwnerScope(owner, () => recordAssetOwner(asset));
  return asset;
};

describe('owner keys', () => {
  test("a cell's key is its scene's id, '#' and the cell key", () => {
    expect(getCellOwnerKey('world', 42)).toBe('world#42');
  });

  test("a cell layer's key adds '/' and the layer, and is still its scene's", () => {
    expect(getCellOwnerKey('world', 42, 'far')).toBe('world#42/far');
    expect(isSceneOwnerKey(getCellOwnerKey('world', 42, 'kept'), 'world')).toBe(true);
  });

  test("a scene's keys are its id and its cells', not another scene's that starts the same", () => {
    expect(isSceneOwnerKey('world', 'world')).toBe(true);
    expect(isSceneOwnerKey('world#42', 'world')).toBe(true);
    expect(isSceneOwnerKey('worlds', 'world')).toBe(false);
    expect(isSceneOwnerKey('worlds#42', 'world')).toBe(false);
    expect(isSceneOwnerKey('wor', 'world')).toBe(false);
  });
});

describe('recording and re-tagging', () => {
  test("a registration takes the scene's owner, none before the first scene", () => {
    const boot = {};
    recordAssetOwner(boot);
    setAssetOwnerScene('a');
    const asset = {};
    recordAssetOwner(asset);
    expect(getAssetOwners(boot)).toEqual([]);
    expect(getAssetOwners(asset)).toEqual(['a']);
  });

  test('a cache hit adds the owner getting it as the latest, and never claims a boot asset', () => {
    const boot = {};
    recordAssetOwner(boot);
    setAssetOwnerScene('a');
    const asset = {};
    recordAssetOwner(asset);
    retagAssetOwner(boot);
    setAssetOwnerScene('b');
    retagAssetOwner(asset);
    retagAssetOwner(asset);
    expect(getAssetOwners(boot)).toEqual([]);
    expect(getAssetOwners(asset)).toEqual(['a', 'b']);
    setAssetOwnerScene('a');
    retagAssetOwner(asset);
    expect(getAssetOwners(asset)).toEqual(['b', 'a']);
    expect(getAssetOwner(asset)).toBe('a');
  });

  test('a derived asset takes a copy of its base asset owners', () => {
    setAssetOwnerScene('a');
    const base = {};
    recordAssetOwner(base);
    setAssetOwnerScene('b');
    retagAssetOwner(base);
    const level = {};
    copyAssetOwner(base, level);
    setAssetOwnerScene('c');
    retagAssetOwner(base);
    expect(getAssetOwners(level)).toEqual(['a', 'b']);
    copyAssetOwner({}, level);
    expect(getAssetOwners(level)).toEqual([]);
  });
});

describe('owner scopes', () => {
  test("a scope is over the scene's owner while its call runs, and scopes nest", () => {
    setAssetOwnerScene('a');
    const outer = {};
    const inner = {};
    const none = {};
    const scene = {};
    runInAssetOwnerScope('a#1', () => {
      expect(getAssetOwnerScope()).toBe('a#1');
      recordAssetOwner(outer);
      runInAssetOwnerScope('a#2', () => recordAssetOwner(inner));
      runInAssetOwnerScope(null, () => recordAssetOwner(none));
      runInAssetOwnerScope(undefined, () => recordAssetOwner(scene));
    });
    expect(getAssetOwnerScope()).toBeUndefined();
    expect(getAssetOwners(outer)).toEqual(['a#1']);
    expect(getAssetOwners(inner)).toEqual(['a#2']);
    expect(getAssetOwners(none)).toEqual([]);
    expect(getAssetOwners(scene)).toEqual(['a']);
  });

  test('a scope ends when its call throws', () => {
    expect(() =>
      runInAssetOwnerScope('a#1', () => {
        throw new Error('unit failed');
      })
    ).toThrow('unit failed');
    expect(getAssetOwnerScope()).toBeUndefined();
  });

  test('a scope ends at an await: what an async call registers later takes the scene owner', async () => {
    setAssetOwnerScene('a');
    const before = {};
    const after = {};
    await runInAssetOwnerScope('a#1', async () => {
      recordAssetOwner(before);
      await Promise.resolve();
      recordAssetOwner(after);
    });
    expect(getAssetOwners(before)).toEqual(['a#1']);
    expect(getAssetOwners(after)).toEqual(['a']);
  });
});

describe('releaseAssetOwners', () => {
  const isCell1 = (owner: string) => owner === 'a#1';

  test('is true for an asset the released owners alone hold, keeping them', () => {
    const asset = recordFor('a#1');
    expect(releaseAssetOwners(asset, isCell1)).toBe(true);
    expect(getAssetOwners(asset)).toEqual(['a#1']);
  });

  test('drops the released owners from an asset others hold too, and is false', () => {
    const asset = recordFor('a#1');
    runInAssetOwnerScope('a#2', () => retagAssetOwner(asset));
    runInAssetOwnerScope('a', () => retagAssetOwner(asset));
    expect(releaseAssetOwners(asset, isCell1)).toBe(false);
    expect(getAssetOwners(asset)).toEqual(['a#2', 'a']);
    expect(releaseAssetOwners(asset, (owner) => isSceneOwnerKey(owner, 'a'))).toBe(true);
  });

  test("is false for an asset they don't hold, or no one holds", () => {
    expect(releaseAssetOwners(recordFor('a#2'), isCell1)).toBe(false);
    expect(releaseAssetOwners(recordFor(null), isCell1)).toBe(false);
  });
});
