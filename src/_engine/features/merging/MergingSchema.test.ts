import { describe, expect, test } from 'vitest';
import { createMeshAssetSchema } from '../../schemas/MeshSchema';
import { createSceneAssetSchema } from '../../schemas/SceneSchema';
import { mergingSchemaPart } from './MergingSchema';

const MeshSchema = createMeshAssetSchema([mergingSchemaPart]);
const SceneSchema = createSceneAssetSchema([mergingSchemaPart]);

const isMergeValid = (merge: unknown) =>
  MeshSchema.safeParse({ id: 'm', props: { geo: 'g', mat: 'm', merge } }).success;
const isGroupsValid = (mergeGroups: unknown) =>
  SceneSchema.safeParse({ id: 's', sceneFile: 's.ts', mergeGroups }).success;

describe("a mesh's merge", () => {
  test('takes a group id, AUTO or the options', () => {
    for (const merge of ['ruins', 'AUTO', {}, { group: 'ruins' }, { cellSize: 48 }]) {
      expect(isMergeValid(merge)).toBe(true);
    }
    expect(isMergeValid({ group: 'AUTO', cellSize: 64, maxVertices: 65536 })).toBe(true);
  });

  test("refuses an empty or an 'auto:' id, sizes of 0 or less, and an unknown field", () => {
    for (const merge of ['', 'auto:x', { group: 'auto:x' }, { group: '' }]) {
      expect(isMergeValid(merge)).toBe(false);
    }
    for (const merge of [{ cellSize: 0 }, { maxVertices: -1 }, { maxVertices: 1.5 }]) {
      expect(isMergeValid(merge)).toBe(false);
    }
    expect(isMergeValid({ groupId: 'ruins' })).toBe(false);
    expect(isMergeValid(true)).toBe(false);
  });
});

describe('the mode (p375)', () => {
  test("a mesh's merge takes BAKED or BATCHED", () => {
    expect(isMergeValid({ mode: 'BATCHED' })).toBe(true);
    expect(isMergeValid({ group: 'props', mode: 'BAKED' })).toBe(true);
    expect(isMergeValid({ mode: 'MERGED' })).toBe(false);
  });

  test("a group's entry takes it, perMemberCulling only with BATCHED, no palette with BATCHED", () => {
    expect(isGroupsValid([{ id: 'props', mode: 'BATCHED', perMemberCulling: false }])).toBe(true);
    expect(isGroupsValid([{ id: 'props', mode: 'BAKED', palette: 'ruinsPalette' }])).toBe(true);
    expect(isGroupsValid([{ id: 'props', perMemberCulling: true }])).toBe(false);
    expect(isGroupsValid([{ id: 'props', mode: 'BATCHED', palette: 'ruinsPalette' }])).toBe(false);
    expect(isGroupsValid([{ id: 'AUTO', mode: 'BATCHED' }])).toBe(false);
  });

  test('geometryReserve only with BATCHED, its counts positive integers (Phase 3 S1)', () => {
    const reserve = { vertices: 64, indices: 192 };
    expect(isGroupsValid([{ id: 'decals', mode: 'BATCHED', geometryReserve: reserve }])).toBe(true);
    expect(
      isGroupsValid([{ id: 'decals', mode: 'BATCHED', geometryReserve: { vertices: 64 } }])
    ).toBe(true);
    expect(isGroupsValid([{ id: 'decals', geometryReserve: reserve }])).toBe(false);
    for (const geometryReserve of [{ vertices: 0 }, { vertices: 2.5 }, { indices: 6 }, {}]) {
      expect(isGroupsValid([{ id: 'decals', mode: 'BATCHED', geometryReserve }])).toBe(false);
    }
    expect(
      isGroupsValid([{ id: 'decals', mode: 'BATCHED', geometryReserve: { ...reserve, extra: 1 } }])
    ).toBe(false);
  });

  test('transparentOrder only with BATCHED, DEPTH or JOIN (Phase 3 S2)', () => {
    expect(isGroupsValid([{ id: 'decals', mode: 'BATCHED', transparentOrder: 'JOIN' }])).toBe(true);
    expect(isGroupsValid([{ id: 'glass', mode: 'BATCHED', transparentOrder: 'DEPTH' }])).toBe(true);
    expect(isGroupsValid([{ id: 'decals', transparentOrder: 'JOIN' }])).toBe(false);
    expect(isGroupsValid([{ id: 'decals', mode: 'BATCHED', transparentOrder: 'SPAWN' }])).toBe(
      false
    );
  });
});

describe("a scene's mergeMaterials (p374)", () => {
  const parse = (mergeMaterials: unknown) =>
    SceneSchema.safeParse({ id: 's', sceneFile: 's.ts', mergeMaterials });

  test('takes palette ids, each once', () => {
    expect(parse(['ruinsPalette', 'propsPalette']).success).toBe(true);
    expect(parse([]).success).toBe(true);
    expect(parse(['']).success).toBe(false);
    const twice = parse(['ruinsPalette', 'ruinsPalette']);
    expect(twice.success).toBe(false);
    expect(twice.error?.issues[0].message).toMatch(/"ruinsPalette" is listed twice/);
  });
});

describe("a scene's mergeGroups", () => {
  test("takes groups' shadow flags and AUTO's defaults", () => {
    expect(
      isGroupsValid([
        { id: 'ruins', castShadow: true },
        { id: 'AUTO', cellSize: 48, maxVertices: 131072 },
      ])
    ).toBe(true);
  });

  test("refuses AUTO with a group's fields, a group with AUTO's, an 'auto:' id, and an id twice", () => {
    expect(isGroupsValid([{ id: 'AUTO', castShadow: true }])).toBe(false);
    expect(isGroupsValid([{ id: 'ruins', cellSize: 32 }])).toBe(false);
    expect(isGroupsValid([{ id: 'auto:x' }])).toBe(false);
    const twice = SceneSchema.safeParse({
      id: 's',
      sceneFile: 's.ts',
      mergeGroups: [{ id: 'ruins' }, { id: 'AUTO' }, { id: 'ruins', castShadow: true }],
    });
    expect(twice.success).toBe(false);
    expect(twice.error?.issues[0].message).toMatch(/"ruins" is listed twice/);
  });

  test("an inline mesh's merge is checked too", () => {
    const parse = (merge: unknown) =>
      SceneSchema.safeParse({
        id: 's',
        sceneFile: 's.ts',
        meshes: [{ props: { geo: 'g', mat: 'm', merge } }],
      }).success;
    expect(parse('AUTO')).toBe(true);
    expect(parse('auto:x')).toBe(false);
  });
});
