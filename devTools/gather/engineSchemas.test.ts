import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import * as schemasEntry from '../../src/_engine/schemas';
import { ENGINE_SCHEMA_PARTS, getSceneFeatureIds } from './engineSchemas';

const ENGINE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/_engine');

describe('ENGINE_SCHEMA_PARTS (p619 G8: zod strips the fields of a part missing from it)', () => {
  it('holds every schema part the engine declares', () => {
    const declared = (fs.readdirSync(ENGINE_DIR, { recursive: true }) as string[])
      .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
      .flatMap((file) => [
        ...fs
          .readFileSync(path.join(ENGINE_DIR, file), 'utf8')
          .matchAll(/^export const (\w+SchemaPart)\b/gm),
      ])
      .map((match) => match[1])
      .sort();
    const listed = Object.entries(schemasEntry)
      .filter(([, value]) => (ENGINE_SCHEMA_PARTS as readonly unknown[]).includes(value))
      .map(([name]) => name)
      .sort();
    expect(declared.length).toBeGreaterThan(0);
    expect(listed).toEqual(declared);
  });
});

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
