import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { FeatureSchemaPart } from './FeatureSchemas';
import { createMeshAssetSchema } from './MeshSchema';
import { createSceneAssetSchema } from './SceneSchema';

const fogPart = {
  feature: 'fog',
  scene: { fogDensity: z.number().optional() },
} satisfies FeatureSchemaPart;

const wobblePart = {
  feature: 'wobble',
  scene: { wobbleScene: z.boolean().optional() },
  mesh: { wobble: z.number().optional() },
} satisfies FeatureSchemaPart;

const scene = { id: 'a', sceneFile: 'a.ts' };
const mesh = { props: { geo: 'box', mat: 'grey' } };

describe('createSceneAssetSchema', () => {
  it('adds each part’s fields after the kernel’s, in part order', () => {
    const keys = Object.keys(createSceneAssetSchema([fogPart, wobblePart]).shape);
    expect(keys.slice(keys.indexOf('importedAssets') + 1)).toEqual([
      'fogDensity',
      'wobbleScene',
      'id',
      'sceneFile',
      '__sourcePath',
      '__saveData',
    ]);
  });

  it('validates a part’s fields, in the scene and in its save entries', () => {
    const schema = createSceneAssetSchema([fogPart]);
    expect(schema.safeParse({ ...scene, fogDensity: 0.1 }).success).toBe(true);
    expect(schema.safeParse({ ...scene, fogDensity: 'thick' }).success).toBe(false);
    expect(schema.safeParse({ ...scene, __saveData: { a: [{ fogDensity: 0.2 }] } }).success).toBe(
      true
    );
    expect(schema.safeParse({ ...scene, __saveData: { a: [{ fogDensity: 'x' }] } }).success).toBe(
      false
    );
  });

  it('drops the fields of a part it wasn’t given', () => {
    const parsed = createSceneAssetSchema([]).parse({ ...scene, fogDensity: 0.1 });
    expect(parsed).not.toHaveProperty('fogDensity');
  });

  it('throws on a field two parts give, or a part gives the kernel has', () => {
    const fogAgain = { feature: 'fog2', scene: { fogDensity: z.number() } };
    expect(() => createSceneAssetSchema([fogPart, fogAgain])).toThrow(
      "The feature schema part 'fog2' gives the scene field 'fogDensity', which 'fog' already has."
    );
    expect(() => createSceneAssetSchema([{ feature: 'x', scene: { meshes: z.any() } }])).toThrow(
      "which 'kernel' already has"
    );
  });
});

describe('createMeshAssetSchema', () => {
  it('adds a part’s mesh fields to the props and the save entries (before `__meta`)', () => {
    const schema = createMeshAssetSchema([wobblePart]);
    expect(Object.keys(schema.shape.props.shape).at(-1)).toBe('wobble');
    const overrides = schema.shape.__saveData.unwrap().valueType.element;
    expect(Object.keys(overrides.shape).slice(-2)).toEqual(['wobble', '__meta']);
    expect(schema.safeParse({ props: { ...mesh.props, wobble: 2 } }).success).toBe(true);
    expect(schema.safeParse({ props: { ...mesh.props, wobble: 'lots' } }).success).toBe(false);
  });
});
