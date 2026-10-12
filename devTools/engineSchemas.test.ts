import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ENGINE_SCHEMA_PARTS, getSceneFeatureIds } from './engineSchemas';

const mesh = (props: Record<string, unknown>) => ({ props: { geo: 'box', mat: 'grey', ...props } });

describe('getSceneFeatureIds (the scene manifest)', () => {
  it('lists nothing for a scene with only kernel fields', () => {
    expect(getSceneFeatureIds({ id: 'a', sceneFile: 'a.ts', meshes: [mesh({})] })).toEqual([]);
  });

  it('lists each feature whose scene fields the scene uses, in part order', () => {
    const scene = {
      id: 'a',
      impostors: [{ id: 'tree' }],
      postFx: ['bloom'],
      skyboxes: ['day'],
      spatialDomains: [{ id: 'DEFAULT' }],
    };
    expect(getSceneFeatureIds(scene)).toEqual(['skybox', 'postfx', 'spatial', 'lod']);
  });

  it('lists a feature whose mesh field one of the scene’s meshes uses', () => {
    const scene = { id: 'a', meshes: ['unresolvedId', mesh({}), mesh({ lod: 'AUTO' })] };
    expect(getSceneFeatureIds(scene)).toEqual(['lod']);
  });

  it('doesn’t count an empty list or a missing value', () => {
    expect(getSceneFeatureIds({ id: 'a', skyboxes: [], postFx: undefined })).toEqual([]);
  });

  it('reads the parts it’s given', () => {
    const fog = { feature: 'fog', scene: { fogDensity: z.number().optional() } };
    expect(getSceneFeatureIds({ fogDensity: 0 }, [fog])).toEqual(['fog']);
    expect(getSceneFeatureIds({ fogDensity: 0 })).toEqual([]);
  });

  it('covers every engine part’s fields', () => {
    const fields = ENGINE_SCHEMA_PARTS.flatMap((part) => [
      ...Object.keys(('scene' in part && part.scene) || {}),
      ...Object.keys(('mesh' in part && part.mesh) || {}),
    ]);
    expect(fields).toEqual([
      'skyboxes',
      'postFx',
      'postFxEnabled',
      'spatialDomains',
      'impostors',
      'lod',
    ]);
  });
});
