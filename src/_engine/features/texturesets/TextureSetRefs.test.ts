import { describe, expect, it } from 'vitest';
import {
  getTextureSetInputDependencies,
  isTextureSetArrayInputRef,
  isTextureSetInputRef,
  type TextureSetLookup,
} from './TextureSetRefs';

const sets: Record<string, ReturnType<TextureSetLookup>> = {
  sand: {
    defaultPacking: 'LITE',
    packings: {
      FULL: { albedoHeight: 'sandAH', normal: 'sandN', orm: 'sandORM' },
      LITE: { albedoRough: 'sandAR', normalHeight: 'sandNH' },
    },
  },
};
const getSet: TextureSetLookup = (id) => sets[id];
const ids = (value: unknown) => getTextureSetInputDependencies(value, getSet).map((dep) => dep.id);

describe('isTextureSetInputRef', () => {
  it('matches an object with a textureSet string, nothing else', () => {
    expect(isTextureSetInputRef({ textureSet: 'sand' })).toBe(true);
    expect(isTextureSetInputRef({ textureSet: 'sand', packing: 'FULL' })).toBe(true);
    for (const value of [
      'sand',
      null,
      [{ textureSet: 'sand' }],
      { textureSet: 1 },
      { texture: 'x' },
    ]) {
      expect(isTextureSetInputRef(value)).toBe(false);
    }
  });
});

describe('getTextureSetInputDependencies', () => {
  it("names the default packing's textures, or the input's packing's, in slot order", () => {
    expect(ids({ textureSet: 'sand' })).toEqual(['sandAR', 'sandNH']);
    expect(ids({ textureSet: 'sand', packing: 'FULL' })).toEqual(['sandAH', 'sandN', 'sandORM']);
    expect(getTextureSetInputDependencies({ textureSet: 'sand' }, getSet)[0]).toEqual({
      type: 'texture',
      id: 'sandAR',
    });
  });

  it('names none for a procedural set: the feature bakes its textures (p304 D3)', () => {
    const procedural: TextureSetLookup = () => ({
      defaultPacking: 'LITE',
      packings: { LITE: { albedoRough: 'dunes.albedoRough', normalHeight: 'dunes.normalHeight' } },
      procedural: { generator: 'sandRipples' },
    });
    expect(getTextureSetInputDependencies({ textureSet: 'dunes' }, procedural)).toEqual([]);
  });

  it('names none for an unknown set, a packing it lacks, or another value', () => {
    expect(ids({ textureSet: 'nope' })).toEqual([]);
    expect(ids({ textureSet: 'sand', packing: 'MINIMAL' })).toEqual([]);
    expect(ids('sandAR')).toEqual([]);
    expect(ids({ texture: 'sandAR' })).toEqual([]);
  });
});

describe('isTextureSetArrayInputRef (p303 D4)', () => {
  it('matches an object with a textureSetArray list or id, nothing else', () => {
    expect(isTextureSetArrayInputRef({ textureSetArray: ['sand'], packing: 'LITE' })).toBe(true);
    expect(isTextureSetArrayInputRef({ textureSetArray: 'gallery' })).toBe(true);
    for (const value of [{ textureSet: 'sand' }, { textureSetArray: 2 }, ['sand'], 'sand', null]) {
      expect(isTextureSetArrayInputRef(value)).toBe(false);
    }
    // Its sets aren't textures: no dependencies of the set form
    expect(ids({ textureSetArray: ['sand'], packing: 'LITE' })).toEqual([]);
  });
});
