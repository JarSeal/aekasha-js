import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import type { SkyBoxDef } from './SkyBoxTypes';
import { createSkyUniforms } from './SkyComposite';
import { createSkyTimeState } from './SkyTime';
import { computeSkyHorizonColor, getSkyHorizonColor } from './SkyHorizonColor';
import { computeExtinction, computeInscatter } from './layers/Atmosphere';
import { toSkyColor } from './SkyColor';

const BLACK: SkyBoxDef['base'] = { type: 'COLOR', color: '#000000' };

/** A sky with the atmosphere and a sun at `elevation` (azimuth 0, toward +z). */
const skyWith = (change: Partial<SkyBoxDef> = {}, elevation = 20): SkyBoxDef => ({
  id: 'sky',
  base: BLACK,
  atmosphere: {},
  suns: [{ elevation, azimuth: 0 }],
  ...change,
});

const horizonOf = (def: SkyBoxDef, direction?: THREE.Vector3) => {
  const u = createSkyUniforms(def, createSkyTimeState(def));
  return { color: computeSkyHorizonColor(def, u, new THREE.Color(), direction), u };
};

const expectColor = (actual: THREE.Color | null, r: number, g: number, b: number) => {
  expect(actual).not.toBeNull();
  expect(actual!.r).toBeCloseTo(r, 6);
  expect(actual!.g).toBeCloseTo(g, 6);
  expect(actual!.b).toBeCloseTo(b, 6);
};

const AWAY_FROM_SUN = new THREE.Vector3(0, 0, -1);
const TOWARD_SUN = new THREE.Vector3(0, 0, 1);

describe('computeSkyHorizonColor', () => {
  it("reads a COLOR base's colour without the atmosphere, × the background intensity", () => {
    const base = { type: 'COLOR' as const, color: '#336699' };
    const expected = toSkyColor(base.color);
    expectColor(horizonOf({ id: 'sky', base }).color, expected.r, expected.g, expected.b);
    const dimmed = horizonOf({ id: 'sky', base, env: { backgroundIntensity: 0.5 } }).color;
    expectColor(dimmed, expected.r / 2, expected.g / 2, expected.b / 2);
  });

  it('is null for a texture base without the atmosphere, and leaves out untouched', () => {
    const def: SkyBoxDef = { id: 'sky', base: { type: 'EQUIRECTANGULAR', file: 'sky.hdr' } };
    const u = createSkyUniforms(def, createSkyTimeState(def));
    const out = new THREE.Color(0.1, 0.2, 0.3);
    expect(computeSkyHorizonColor(def, u, out)).toBeNull();
    expectColor(out, 0.1, 0.2, 0.3);
    // With the atmosphere, the texture counts as black behind it
    const withAtmosphere = { ...def, atmosphere: {}, suns: [{ elevation: 20 }] };
    expect(horizonOf(withAtmosphere).color).toEqual(horizonOf(skyWith()).color);
  });

  it("is the atmosphere's inscatter (computeInscatter) × the horizon tint × the exposure", () => {
    // A red tint and a black night floor leave the red channel's inscatter alone
    const def = skyWith({
      atmosphere: { horizonTint: '#ff0000', zenithTint: '#00ff00', nightSkyColor: '#000000' },
    });
    const { color, u } = horizonOf(def, AWAY_FROM_SUN);
    const sunDirection = u.suns[0].direction.value;
    const inscatter = computeInscatter(
      AWAY_FROM_SUN,
      u.atmosphere,
      sunDirection,
      new THREE.Vector3()
    );
    expect(inscatter.x).toBeGreaterThan(0);
    expectColor(color, inscatter.x * u.atmosphere.exposure.value, 0, 0);
  });

  it("adds the base seen through the atmosphere's extinction (computeExtinction at the horizon)", () => {
    const base = { type: 'COLOR' as const, color: '#808040' };
    const { color: black, u } = horizonOf(skyWith());
    const { color: tinted } = horizonOf(skyWith({ base }));
    const fex = computeExtinction(
      0,
      u.atmosphere.betaR.value,
      u.atmosphere.betaM.value,
      new THREE.Vector3()
    );
    const c = toSkyColor(base.color);
    expectColor(tinted, black!.r + c.r * fex.x, black!.g + c.g * fex.y, black!.b + c.b * fex.z);
  });

  it('scales the scattered light and the floor by the exposure', () => {
    const { color: one } = horizonOf(skyWith({ atmosphere: { exposure: 1 } }));
    const { color: two } = horizonOf(skyWith({ atmosphere: { exposure: 2 } }));
    expectColor(two, one!.r * 2, one!.g * 2, one!.b * 2);
  });

  it("is SkyMesh's night floor with the sun far below the horizon (AUTO)", () => {
    const { color, u } = horizonOf(skyWith({}, -60));
    expect(u.atmosphere.sunE.value).toBe(0);
    const fex = computeExtinction(
      0,
      u.atmosphere.betaR.value,
      u.atmosphere.betaM.value,
      new THREE.Vector3()
    );
    const exposure = u.atmosphere.exposure.value;
    // L0 = 0.1 · Fex and the faint blue (0, 0.0003, 0.00075), × SkyMesh's 0.04
    expectColor(
      color,
      fex.x * 0.004 * exposure,
      (fex.y * 0.004 + 0.0003) * exposure,
      (fex.z * 0.004 + 0.00075) * exposure
    );
  });

  it("reads away from the sun by default, and only the direction's horizontal part", () => {
    const def = skyWith();
    expect(horizonOf(def).color).toEqual(horizonOf(def, AWAY_FROM_SUN).color);
    expect(horizonOf(def, new THREE.Vector3(0, 5, -0.5)).color).toEqual(horizonOf(def).color);
    // Straight up: the default again
    expect(horizonOf(def, new THREE.Vector3(0, 1, 0)).color).toEqual(horizonOf(def).color);
    // By day the sun's side is brighter (its Mie lobe)
    const toward = horizonOf(def, TOWARD_SUN).color!;
    const away = horizonOf(def).color!;
    expect(toward.r + toward.g + toward.b).toBeGreaterThan(away.r + away.g + away.b);
  });

  it('reads any horizon with the sun straight up', () => {
    expect(horizonOf(skyWith({}, 90)).color).not.toBeNull();
  });

  it('takes the ground where its horizon line is above the horizon, and not at height 0', () => {
    const ground = { color: '#405020', horizonBlend: 0.01, useAtmosphereHorizon: false };
    expect(horizonOf(skyWith({ ground })).color).toEqual(horizonOf(skyWith()).color);
    // 10° up: the whole blend band is above the horizon
    const { color, u } = horizonOf(skyWith({ ground: { ...ground, height: -10 } }));
    const expected = toSkyColor(ground.color).multiplyScalar(u.ground.light.value);
    expectColor(color, expected.r, expected.g, expected.b);
  });
});

describe('getSkyHorizonColor', () => {
  it('is null without an active sky box', () => {
    expect(getSkyHorizonColor(new THREE.Color())).toBeNull();
  });
});
