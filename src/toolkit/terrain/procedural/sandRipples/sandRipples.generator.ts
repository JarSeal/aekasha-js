// The `sandRipples` surface generator (p304 D3, SAND): wind ripples, a ridge profile along a
// direction with a gentle windward slope and a steep lee, its crests bent by a periodic warp and
// its height varied by a broad swell, over a fine grain. Baked, the waves fit the tile in whole
// numbers along each axis (the direction and wavelength rounded to the nearest that tile).
import { cos, dot, float, fract, mix, round, sin, smoothstep, vec2 } from 'three/tsl';
// The real generic `Node<T>` typings (the `three/tsl` `Node` is a loose local shim)
import type { Node } from 'three/webgpu';
import { fbm, valueNoise } from '../../nodes/noise/Noise';
import { defineSurfaceGenerator } from '../SurfaceGenerator';
import { toUnit } from '../SurfaceNodes';

/** Where the crest sits in a ripple's cycle: the windward slope is this share of the wavelength. */
const CREST = 0.72;
/** The grains per metre (about 4 mm grains). */
const GRAINS_PER_METRE = 250;

/**
 * Wind-rippled sand: parallel ridges across the wind (`angle`, degrees from +u), `wavelength`
 * metres apart, gently sloped upwind and steep downwind, bent by `warp` and over a fine `grain`.
 */
export const generator = defineSurfaceGenerator({
  id: 'sandRipples',
  category: 'SAND',
  description:
    'Wind ripples: ridges across the wind with a gentle windward slope and a steep lee, bent by a warp, over a fine grain.',
  physicalSize: [2, 2],
  heightScale: 0.02,
  cavity: { radius: 0.012, strength: 1.2 },
  params: {
    angle: { default: 30, min: 0, max: 180, step: 1, label: 'Direction (°)' },
    wavelength: { default: 0.09, min: 0.03, max: 0.4, step: 0.005, label: 'Wavelength (m)' },
    warp: { default: 0.35, min: 0, max: 1.5, step: 0.05, label: 'Warp' },
    grain: { default: 0.35, min: 0, max: 1, step: 0.05, label: 'Grain' },
    light: { type: 'color', default: '#d8c393', label: 'Crest colour' },
    dark: { type: 'color', default: '#a98d61', label: 'Trough colour' },
  },
  build: (ctx, params) => {
    const radians = params.angle.mul(Math.PI / 180);
    // The waves across the tile along u and v; baked, whole numbers, so the ridges tile
    const waves = vec2(cos(radians), sin(radians)).mul(ctx.tileSize).div(params.wavelength);
    const k = ctx.isLive ? waves : round(waves);

    const broad = ctx.cells(3);
    const warp = fbm(broad.p, { period: broad.period, octaves: 3, seed: ctx.seed(1) });
    const swell = toUnit(fbm(broad.p, { period: broad.period, octaves: 2, seed: ctx.seed(2) }));
    const phase = fract(dot(ctx.uv, k).add(warp.mul(params.warp).mul(3)));
    // Up the windward slope to the crest, down the lee: 0 at both ends of the cycle
    const ridge = smoothstep(0, CREST, phase).mul(float(1).sub(smoothstep(CREST, 1, phase)));

    const grains = ctx.cells(ctx.tileSize.x.mul(GRAINS_PER_METRE) as Node<'float'>);
    const grain = toUnit(valueNoise(grains.p, { period: grains.period, seed: ctx.seed(3) }));
    const relief = ridge.mul(swell.mul(0.4).add(0.6));
    const height = relief
      .mul(0.85)
      .add(grain.mul(params.grain).mul(0.15)) as unknown as Node<'float'>;

    const shade = smoothstep(0.1, 0.9, ridge)
      .mul(0.6)
      .add(0.2)
      .add(grain.sub(0.5).mul(params.grain).mul(0.5))
      .clamp(0, 1);
    return {
      albedo: mix(params.dark, params.light, shade) as unknown as Node<'vec3'>,
      height,
      roughness: float(0.9)
        .sub(ridge.mul(0.04))
        .add(grain.sub(0.5).mul(0.08)) as unknown as Node<'float'>,
    };
  },
});
