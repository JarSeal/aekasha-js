import { describe, expect, it } from 'vitest';
import {
  mergeSkyBoxPreset,
  resolveSkyBoxPreset,
  SKYBOX_PRESET_NAMES,
  SKYBOX_PRESETS,
  type SkyBoxPresetDef,
} from './Presets';

describe('resolveSkyBoxPreset', () => {
  it.each(SKYBOX_PRESET_NAMES)(
    'gives %s as the template, with the id and no preset key',
    (name) => {
      const def = resolveSkyBoxPreset({ id: 'sky', preset: name });
      expect(def).toEqual({ id: 'sky', ...SKYBOX_PRESETS[name] });
      expect('preset' in def).toBe(false);
    }
  );

  it('returns a definition without a preset as it is', () => {
    const def = { id: 'sky', base: { type: 'COLOR' as const, color: '#123456' }, stars: {} };
    expect(resolveSkyBoxPreset(def)).toEqual(def);
  });

  it("merges a layer over the template's key by key", () => {
    const def = resolveSkyBoxPreset({ id: 'sky', preset: 'SPACE', stars: { density: 0.3 } });
    expect(def.stars).toEqual({ ...SKYBOX_PRESETS.SPACE.stars, density: 0.3 });
    expect(def.nebulae).toEqual(SKYBOX_PRESETS.SPACE.nebulae);
  });

  it("replaces the template's arrays and base", () => {
    const def = resolveSkyBoxPreset({
      id: 'sky',
      preset: 'DAY_NIGHT',
      base: { type: 'EQUIRECTANGULAR', file: 'night.hdr' },
      moons: [{ phase: 0 }],
      suns: [],
    });
    // Neither the template's moon light nor its COLOR base's colour survive
    expect(def.moons).toEqual([{ phase: 0 }]);
    expect(def.suns).toEqual([]);
    expect(def.base).toEqual({ type: 'EQUIRECTANGULAR', file: 'night.hdr' });
    expect(def.stars).toEqual(SKYBOX_PRESETS.DAY_NIGHT.stars);
  });

  it('never hands out the template: a change to a result leaves the next one as it was', () => {
    const first = resolveSkyBoxPreset({ id: 'a', preset: 'DAY_SKY' });
    first.suns![0].elevation = -90;
    first.base = { type: 'COLOR', color: '#ffffff' };
    const second = resolveSkyBoxPreset({ id: 'b', preset: 'DAY_SKY' });
    expect(second.suns).toEqual(SKYBOX_PRESETS.DAY_SKY.suns);
    expect(second.base).toEqual(SKYBOX_PRESETS.DAY_SKY.base);
    expect(SKYBOX_PRESETS.DAY_SKY.suns![0].elevation).toBe(45);
  });

  it('throws on a name that is no preset, listing the presets', () => {
    const def = { id: 'sky', preset: 'DUSK' } as unknown as SkyBoxPresetDef;
    expect(() => resolveSkyBoxPreset(def)).toThrow(/"DUSK".*DAY_SKY, NIGHT_SKY, DAY_NIGHT, SPACE/);
  });

  it('is mergeSkyBoxPreset, typed', () => {
    const def: SkyBoxPresetDef = { id: 'sky', preset: 'NIGHT_SKY', clouds: { coverage: 0.6 } };
    expect(resolveSkyBoxPreset(def)).toEqual(mergeSkyBoxPreset(def));
  });
});
