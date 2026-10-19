import { describe, expect, it } from 'vitest';
import type { SkyBoxDef } from './SkyBoxTypes';
import { getCompositeSignature, hasProceduralLayer } from './SkyComposite';

const BASE: SkyBoxDef['base'] = { type: 'COLOR', color: '#000000' };

/** Every layer on, with a value set in each (the cases below change one thing). */
const FULL: SkyBoxDef = {
  id: 'sky',
  base: BASE,
  atmosphere: { turbidity: 2 },
  suns: [{ elevation: 30, light: {} }, { elevation: 10 }],
  moons: [{ phase: 0.5, light: {} }],
  stars: { density: 0.5, milkyWay: {} },
  clouds: { coverage: 0.4 },
  ground: { color: '#333333' },
  nebulae: [{ seed: 1, octaves: 5 }],
  env: { nebulaSize: 512 },
};

const signatureWith = (change: Partial<SkyBoxDef>) => getCompositeSignature({ ...FULL, ...change });

describe('getCompositeSignature', () => {
  it.each<[string, Partial<SkyBoxDef>]>([
    ['the base', { base: { type: 'EQUIRECTANGULAR', file: 'sky.hdr' } }],
    ['an atmosphere value', { atmosphere: { turbidity: 8 } }],
    ['a sun position', { suns: [{ elevation: -10, light: {} }, { elevation: 70 }] }],
    ["a sun light's value", { suns: [{ elevation: 30, light: { intensity: 1 } }, {}] }],
    ['a moon phase', { moons: [{ phase: 0.1, light: {} }] }],
    ['a star value', { stars: { density: 0.9, milkyWay: { intensity: 1 } } }],
    ['a cloud value', { clouds: { coverage: 0.9 } }],
    ['the ground colour', { ground: { color: '#ffffff' } }],
    ["a nebula's values but its octaves", { nebulae: [{ seed: 9, size: 40, octaves: 5 }] }],
    ['day-night', { dayNight: {} }],
    ['the env values', { env: { nebulaSize: 512, backgroundRoughness: 0.5, size: 128 } }],
  ])('stays the same for %s', (_, change) => {
    expect(signatureWith(change)).toBe(getCompositeSignature(FULL));
  });

  it.each<[string, Partial<SkyBoxDef>]>([
    ['a sun added', { suns: [...FULL.suns!, {}] }],
    ['a sun turned off', { suns: [FULL.suns![0], { enabled: false }] }],
    ['a sun light turned off', { suns: [{ light: { enabled: false } }, {}] }],
    ['a sun light added', { suns: [FULL.suns![0], { light: {} }] }],
    ['a moon removed', { moons: [] }],
    ['a moon light removed', { moons: [{ phase: 0.5 }] }],
    ['a moon texture added', { moons: [{ light: {}, texture: { file: 'moon.png' } }] }],
    ['the stars turned off', { stars: { enabled: false, milkyWay: {} } }],
    ['the Milky Way turned off', { stars: { milkyWay: { enabled: false } } }],
    ['the atmosphere removed', { atmosphere: undefined }],
    ['the clouds turned off', { clouds: { enabled: false } }],
    ['the ground removed', { ground: undefined }],
    ['a nebula added', { nebulae: [...FULL.nebulae!, {}] }],
    ['a nebula turned off', { nebulae: [{ enabled: false }] }],
    ["a nebula's octaves", { nebulae: [{ seed: 1, octaves: 3 }] }],
    ['the nebula cube size', { env: { nebulaSize: 256 } }],
  ])('changes with %s', (_, change) => {
    expect(signatureWith(change)).not.toBe(getCompositeSignature(FULL));
  });

  it('counts at most MAX_SUNS suns and MAX_MOONS moons', () => {
    const suns = [{}, {}, {}, {}];
    const moons = [{}, {}];
    expect(signatureWith({ suns: [...suns, {}], moons: [...moons, {}] })).toBe(
      signatureWith({ suns, moons })
    );
  });

  it('leaves out clouds without an atmosphere, and the cube size without nebulae', () => {
    const plain = { ...FULL, atmosphere: undefined, nebulae: undefined };
    expect(getCompositeSignature({ ...plain, clouds: undefined })).toBe(
      getCompositeSignature(plain)
    );
    expect(getCompositeSignature({ ...plain, env: { nebulaSize: 256 } })).toBe(
      getCompositeSignature(plain)
    );
  });
});

describe('hasProceduralLayer', () => {
  it('is false for a base alone, or with every layer off', () => {
    expect(hasProceduralLayer({ id: 'sky', base: BASE })).toBe(false);
    expect(
      hasProceduralLayer({
        id: 'sky',
        base: BASE,
        atmosphere: { enabled: false },
        suns: [{ enabled: false }],
        moons: [{ enabled: false }],
        stars: { enabled: false },
        ground: { enabled: false },
        nebulae: [{ enabled: false }],
        dayNight: {},
      })
    ).toBe(false);
  });

  it.each<[string, Partial<SkyBoxDef>]>([
    ['an atmosphere', { atmosphere: {} }],
    ['a sun', { suns: [{ enabled: false }, {}] }],
    ['a moon', { moons: [{}] }],
    ['stars', { stars: {} }],
    ['a ground', { ground: {} }],
    ['a nebula', { nebulae: [{}] }],
  ])('is true with %s', (_, change) => {
    expect(hasProceduralLayer({ id: 'sky', base: BASE, ...change })).toBe(true);
  });
});
