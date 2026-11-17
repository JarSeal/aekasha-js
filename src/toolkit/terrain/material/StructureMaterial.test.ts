import { describe, expect, it } from 'vitest';
import { getStructureMaterialConfig } from './StructureMaterial';
import { TerrainMaterialConfigSchema } from './TerrainMaterialConfig';

describe('getStructureMaterialConfig', () => {
  it("gives a structure's defaults: object space, triplanar, dual scale, a 12 m macro", () => {
    const config = getStructureMaterialConfig('concrete01', { id: 'wall' });
    expect(config).toEqual({
      id: 'wall',
      layers: [{ set: 'concrete01' }],
      space: 'OBJECT',
      projection: { mode: 'TRIPLANAR' },
      antiTiling: { mode: 'DUAL_SCALE' },
      macro: { texture: 'macroNoise', scale: 12 },
    });
    expect(TerrainMaterialConfigSchema.safeParse(config).success).toBe(true);
  });

  it('takes any field over the defaults, and painted wear layers', () => {
    const wear = getStructureMaterialConfig(
      [{ set: 'concrete01' }, { set: 'concrete02' }, { set: 'mud01' }],
      {
        id: 'bunker',
        space: 'WORLD',
        macro: undefined,
        blend: { source: 'VERTEX_COLOR', vertexColor: { layout: 'RGBA' } },
      }
    );
    expect(wear).toMatchObject({ space: 'WORLD', macro: undefined, layers: { length: 3 } });
    expect(TerrainMaterialConfigSchema.safeParse(wear).success).toBe(true);
  });
});
