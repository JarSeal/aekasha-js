import { afterEach, describe, expect, it, vi } from 'vitest';

// The generated data and the current scene are this test's
const scene = vi.hoisted(() => ({ id: 'sceneA' as string | null }));
vi.mock(import('../../../kernel/scene/Scene'), async (importOriginal) => ({
  ...(await importOriginal()),
  getCurrentSceneId: () => scene.id,
  getGeneratedAppData: () =>
    ({
      scenes: {
        // The file's material with the scene's latest entry in it
        sceneA: {
          materials: [
            {
              id: 'glow',
              type: 'STANDARDNODEMATERIAL',
              tslFile: 'glow.tsl.ts',
              inputs: { color: '#ff0000', strength: 2 },
              debugData: { name: 'Glow' },
            },
            // Inline, another type under a registry id
            { id: 'plain', type: 'BASICMATERIAL', params: { color: '#0000ff' } },
          ],
        },
        sceneB: { materials: [] },
      },
      materials: {
        glow: {
          id: 'glow',
          type: 'STANDARDNODEMATERIAL',
          tslFile: 'glow.tsl.ts',
          inputs: { color: '#ff0000', strength: 1 },
          debugData: { name: 'Glow' },
          __sourcePath: 'src/app/materials/glow.material.json',
          __saveData: { sceneA: [{ inputs: { strength: 2 }, __meta: {} }] },
        },
        plain: {
          id: 'plain',
          type: 'STANDARDMATERIAL',
          params: { color: '#00ff00' },
          __sourcePath: 'src/app/materials/plain.material.json',
        },
      },
    }) as never,
}));

import { getMaterialAssets, getMaterialBase } from './_dbg__MaterialEditorAssets';

afterEach(() => {
  scene.id = 'sceneA';
});

describe('getMaterialBase', () => {
  it('is the material as the current scene has it, with its file path', () => {
    const base = getMaterialBase('glow');
    expect(base).toMatchObject({
      inputs: { color: '#ff0000', strength: 2 },
      __sourcePath: 'src/app/materials/glow.material.json',
    });
    expect(base).not.toHaveProperty('__saveData');
    // The registry's own stays as its file
    expect(getMaterialAssets().glow).toMatchObject({ inputs: { strength: 1 } });
  });

  it('is the file in a scene that does not list the material, or without a scene', () => {
    scene.id = 'sceneB';
    expect(getMaterialBase('glow')).toBe(getMaterialAssets().glow);
    scene.id = null;
    expect(getMaterialBase('glow')).toBe(getMaterialAssets().glow);
  });

  it('is the file when the scene has another type under the id', () => {
    expect(getMaterialBase('plain')).toBe(getMaterialAssets().plain);
  });

  it('is undefined for a material the project has not', () => {
    expect(getMaterialBase('missing')).toBeUndefined();
  });
});
