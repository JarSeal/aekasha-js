import { describe, expect, it } from 'vitest';
import { SkyBoxBaseSchema } from './SkyBoxSchema';

const FACES = ['px.png', 'nx.png', 'py.png', 'ny.png', 'pz.png', 'nz.png'];

describe('the CUBE_TEXTURE base (p311)', () => {
  it('takes six images or one KTX2 cube file', () => {
    expect(SkyBoxBaseSchema.safeParse({ type: 'CUBE_TEXTURE', fileNames: FACES }).success).toBe(
      true
    );
    expect(SkyBoxBaseSchema.safeParse({ type: 'CUBE_TEXTURE', file: '/sky.ktx2' }).success).toBe(
      true
    );
    expect(
      SkyBoxBaseSchema.safeParse({ type: 'CUBE_TEXTURE', file: '/sky.KTX2?v=2' }).success
    ).toBe(true);
  });

  it('refuses both, neither, and a file that is not a .ktx2', () => {
    const both = { type: 'CUBE_TEXTURE', fileNames: FACES, file: '/sky.ktx2' };
    expect(SkyBoxBaseSchema.safeParse(both).success).toBe(false);
    expect(SkyBoxBaseSchema.safeParse({ ...both, textureId: 'sky' }).success).toBe(false);
    expect(SkyBoxBaseSchema.safeParse({ type: 'CUBE_TEXTURE' }).success).toBe(false);
    const png = SkyBoxBaseSchema.safeParse({ type: 'CUBE_TEXTURE', file: '/sky.png' });
    expect(png.success).toBe(false);
    expect(png.error?.issues[0].path).toEqual(['file']);
  });

  it('takes a lone textureId: a cube texture asset (p311 D2)', () => {
    expect(SkyBoxBaseSchema.safeParse({ type: 'CUBE_TEXTURE', textureId: 'dunes' }).success).toBe(
      true
    );
    // With a file, still the id the loaded texture is registered under
    const named = { type: 'CUBE_TEXTURE', file: '/sky.ktx2', textureId: 'dunes' };
    expect(SkyBoxBaseSchema.safeParse(named).success).toBe(true);
  });
});
