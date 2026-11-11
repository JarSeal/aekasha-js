import { describe, expect, test } from 'vitest';
import { MAX_MERGE_MATERIAL_ENTRIES, MergeMaterialAssetSchema } from './MergeMaterialSchema';

const SIZE = [256, 256];

const parse = (fields: Record<string, unknown>) =>
  MergeMaterialAssetSchema.safeParse({
    materials: ['a', 'b'],
    slots: { map: { size: SIZE } },
    ...fields,
  });

const getIssues = (fields: Record<string, unknown>) => {
  const result = parse(fields);
  return result.success ? [] : result.error.issues.map((issue) => issue.message);
};

describe('a merge material palette', () => {
  test('takes the plan’s example', () => {
    const result = MergeMaterialAssetSchema.safeParse({
      id: 'ruinsPalette',
      materials: ['ruinStone', 'ruinBrick', 'ruinMoss', 'ruinPlaster'],
      slots: {
        map: { size: [1024, 1024] },
        normalMap: { size: [1024, 1024], missing: 'SKIP' },
        orm: { size: [1024, 1024], from: ['aoMap', 'roughnessMap', 'metalnessMap'] },
      },
      optimize: { profile: 'prop' },
    });
    expect(result.success).toBe(true);
  });

  test('needs 2-256 materials, each once', () => {
    expect(parse({ materials: ['a'] }).success).toBe(false);
    const many = Array.from({ length: MAX_MERGE_MATERIAL_ENTRIES + 1 }, (_, i) => `m${i}`);
    expect(parse({ materials: many }).success).toBe(false);
    expect(parse({ materials: many.slice(1) }).success).toBe(true);
    expect(getIssues({ materials: ['a', 'b', 'a'] })).toEqual(['"a" is listed twice (also at 0)']);
  });

  test('needs a slot, each with its size, and knows only the merge material’s slots', () => {
    expect(getIssues({ slots: {} })).toEqual(['no slots']);
    expect(parse({ slots: { map: {} } }).success).toBe(false);
    expect(parse({ slots: { bumpMap: { size: SIZE } } }).success).toBe(false);
    expect(parse({ slots: { map: { size: SIZE, missing: 'BLACK' } } }).success).toBe(false);
  });

  test('takes from only on orm: its three maps, each once', () => {
    expect(parse({ slots: { orm: { size: SIZE, from: ['roughnessMap'] } } }).success).toBe(true);
    expect(parse({ slots: { orm: { size: SIZE, from: [] } } }).success).toBe(false);
    expect(parse({ slots: { orm: { size: SIZE, from: ['normalMap'] } } }).success).toBe(false);
    expect(getIssues({ slots: { orm: { size: SIZE, from: ['aoMap', 'aoMap'] } } })).toEqual([
      'a map is listed twice',
    ]);
    expect(parse({ slots: { map: { size: SIZE, from: ['aoMap'] } } }).success).toBe(false);
  });

  test('implies each array’s optimize slot', () => {
    expect(parse({ optimize: { profile: 'prop' } }).success).toBe(true);
    expect(parse({ optimize: { slot: 'baseColor' } }).success).toBe(false);
  });
});
