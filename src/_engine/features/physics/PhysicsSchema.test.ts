import { describe, expect, it } from 'vitest';
import { createSceneAssetSchema } from '../../schemas/SceneSchema';
import { physicsSchemaPart, SceneWorldBoundsSchema } from './PhysicsSchema';

describe('SceneWorldBoundsSchema (p102 Phase 4)', () => {
  it('takes a kill height, a full box and an action', () => {
    expect(SceneWorldBoundsSchema.parse({ min: { y: -50 } })).toEqual({ min: { y: -50 } });
    const box = { min: { x: -10, y: -5, z: -10 }, max: { x: 10, y: 20, z: 10 }, action: 'DISABLE' };
    expect(SceneWorldBoundsSchema.parse(box)).toEqual(box);
    expect(SceneWorldBoundsSchema.parse({})).toEqual({});
  });

  it("refuses 'CALLBACK' (a callback is code), unknown keys and a min not below its max", () => {
    expect(SceneWorldBoundsSchema.safeParse({ action: 'CALLBACK' }).success).toBe(false);
    expect(SceneWorldBoundsSchema.safeParse({ min: { w: 1 } }).success).toBe(false);
    expect(SceneWorldBoundsSchema.safeParse({ ignore: true }).success).toBe(false);
    const flat = SceneWorldBoundsSchema.safeParse({ min: { y: 5 }, max: { y: 5 } });
    expect(flat.success).toBe(false);
    expect(flat.error?.issues[0].path).toEqual(['max', 'y']);
    // Another axis's max alone is fine
    expect(SceneWorldBoundsSchema.safeParse({ min: { y: 5 }, max: { x: 0 } }).success).toBe(true);
  });

  it('is a scene field, null included', () => {
    const SceneSchema = createSceneAssetSchema([physicsSchemaPart]);
    const scene = { id: 'a', sceneFile: 'a.ts' };
    expect(SceneSchema.parse({ ...scene, worldBounds: null }).worldBounds).toBeNull();
    expect(SceneSchema.parse({ ...scene, worldBounds: { min: { y: -1 } } }).worldBounds).toEqual({
      min: { y: -1 },
    });
    expect(SceneSchema.parse(scene).worldBounds).toBeUndefined();
  });
});
