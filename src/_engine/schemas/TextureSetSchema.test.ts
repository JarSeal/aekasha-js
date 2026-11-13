import { describe, expect, it } from 'vitest';
import { TEXTURE_SET_PACKINGS, TextureSetAssetSchema } from './TextureSetSchema';

const valid = {
  id: 'sand01',
  category: 'SAND',
  physicalSize: [3, 3],
  heightScale: 0.03,
  defaultPacking: 'LITE',
  packings: {
    LITE: { albedoRough: 'sand01_albedoRough', normalHeight: 'sand01_normalHeight' },
    FULL: { albedoHeight: 'sand01_albedoHeight', normal: 'sand01_normal', orm: 'sand01_orm' },
    MINIMAL: { albedoHeight: 'sand01_albedoHeightAO' },
  },
  surface: { tint: '#ffffff', porosity: 0.85, wetDarkening: 0.55, wetRoughness: 0.4 },
  debugData: { name: 'Sand 01', description: 'ambientCG Ground080, CC0' },
};

/** The issues' paths of a value, or [] when it's valid */
const issuePaths = (value: unknown) => {
  const result = TextureSetAssetSchema.safeParse(value);
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join('.'));
};

describe('TextureSetAssetSchema', () => {
  it("takes the plan's example, and a set of one packing without defaults", () => {
    expect(issuePaths(valid)).toEqual([]);
    expect(
      issuePaths({
        category: 'OTHER',
        physicalSize: [1.1, 0.55],
        heightScale: 0,
        packings: { MINIMAL: { albedoHeight: 'a' } },
      })
    ).toEqual([]);
  });

  it.each([
    ['an unknown category', { ...valid, category: 'LAVA' }, 'category'],
    ['a physicalSize of one number', { ...valid, physicalSize: [3] }, 'physicalSize'],
    ['a zero physicalSize', { ...valid, physicalSize: [3, 0] }, 'physicalSize.1'],
    ['a negative heightScale', { ...valid, heightScale: -1 }, 'heightScale'],
    ['an unknown default packing', { ...valid, defaultPacking: 'HUGE' }, 'defaultPacking'],
    ['no packing', { ...valid, packings: {} }, 'packings'],
    ['an unknown packing', { ...valid, packings: { HUGE: { a: 'b' } } }, 'packings'],
    [
      "a slot the packing doesn't have",
      { ...valid, packings: { LITE: { ...valid.packings.LITE, orm: 'x' } } },
      'packings.LITE',
    ],
    [
      'a missing slot',
      { ...valid, packings: { LITE: { albedoRough: 'x' } } },
      'packings.LITE.normalHeight',
    ],
    [
      'an empty slot id',
      { ...valid, packings: { MINIMAL: { albedoHeight: '' } } },
      'packings.MINIMAL.albedoHeight',
    ],
    ['an unknown surface field', { ...valid, surface: { shininess: 1 } }, 'surface'],
    ['a porosity over 1', { ...valid, surface: { porosity: 2 } }, 'surface.porosity'],
  ])('fails on %s', (_name, value, path) => {
    expect(issuePaths(value)).toContain(path);
  });

  describe('a procedural set (p304 D3)', () => {
    const { packings: _p, defaultPacking: _d, ...facts } = valid;
    const procedural = {
      ...facts,
      procedural: {
        generator: 'sandRipples',
        params: { wavelength: 0.12, light: '#d8c393', isSeamed: true },
        seed: 7,
        size: [1024, 512],
        packing: 'FULL',
      },
    };

    it('takes a generator in place of packings, its other fields optional', () => {
      expect(issuePaths(procedural)).toEqual([]);
      expect(issuePaths({ ...facts, procedural: { generator: 'mudCracked' } })).toEqual([]);
      expect(issuePaths({ ...procedural, defaultPacking: 'FULL' })).toEqual([]);
      expect(
        issuePaths({ ...facts, defaultPacking: 'LITE', procedural: { generator: 'x' } })
      ).toEqual([]);
    });

    it.each([
      ['both packings and procedural', { ...procedural, packings: valid.packings }, 'procedural'],
      ['neither', facts, 'packings'],
      [
        'a defaultPacking other than its packing',
        { ...procedural, defaultPacking: 'LITE' },
        'defaultPacking',
      ],
      ['an empty generator', { ...facts, procedural: { generator: '' } }, 'procedural.generator'],
      [
        'a fractional seed',
        { ...facts, procedural: { generator: 'x', seed: 1.5 } },
        'procedural.seed',
      ],
      ['a size of 0', { ...facts, procedural: { generator: 'x', size: 0 } }, 'procedural.size'],
      [
        'a size over 8192',
        { ...facts, procedural: { generator: 'x', size: [16384, 8] } },
        'procedural.size.0',
      ],
      [
        'a colour param not #rrggbb',
        { ...facts, procedural: { generator: 'x', params: { light: 'red' } } },
        'procedural.params.light',
      ],
      [
        'a param that is an object',
        { ...facts, procedural: { generator: 'x', params: { range: [0, 1] } } },
        'procedural.params.range',
      ],
      ['an unknown field', { ...facts, procedural: { generator: 'x', octaves: 4 } }, 'procedural'],
    ])('fails on %s', (_name, value, path) => {
      expect(issuePaths(value)).toContain(path);
    });
  });

  it("names each packing's slots as its schema does", () => {
    const packings = TextureSetAssetSchema.shape.packings.unwrap().shape;
    for (const [packing, slots] of Object.entries(TEXTURE_SET_PACKINGS)) {
      const schema = packings[packing as keyof typeof packings].unwrap();
      expect(Object.keys(schema.shape)).toEqual([...slots]);
    }
  });
});
