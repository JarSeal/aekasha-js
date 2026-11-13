// The `sandFlat` surface generator (p304 D3, SAND): a flat beach, a fine grain over a soft,
// low-contrast mottling, with sparse dark mineral specks.
import { float, mix, smoothstep } from 'three/tsl';
// The real generic `Node<T>` typings (the `three/tsl` `Node` is a loose local shim)
import type { Node } from 'three/webgpu';
import { hash12 } from '../../nodes/noise/Hash';
import { fbm, valueNoise } from '../../nodes/noise/Noise';
import { defineSurfaceGenerator } from '../SurfaceGenerator';
import { toUnit } from '../SurfaceNodes';

/** The grains per metre (about 3 mm grains), and the specks' cells per metre. */
const GRAINS_PER_METRE = 320;
const SPECKS_PER_METRE = 140;

/**
 * Flat beach sand: a fine `grain` over a soft `mottling` of `mottleSize` metres, with sparse dark
 * mineral specks.
 */
export const generator = defineSurfaceGenerator({
  id: 'sandFlat',
  category: 'SAND',
  description:
    'Flat beach sand: a fine grain over a soft, low-contrast mottling, with dark specks.',
  physicalSize: [2, 2],
  heightScale: 0.008,
  params: {
    grain: { default: 0.5, min: 0, max: 1, step: 0.05, label: 'Grain' },
    mottling: { default: 0.45, min: 0, max: 1, step: 0.05, label: 'Mottling' },
    mottleSize: { default: 0.6, min: 0.1, max: 2, step: 0.05, label: 'Mottle size (m)' },
    specks: { default: 0.4, min: 0, max: 1, step: 0.05, label: 'Specks' },
    light: { type: 'color', default: '#e2d2a9', label: 'Light colour' },
    dark: { type: 'color', default: '#bba377', label: 'Dark colour' },
  },
  build: (ctx, params) => {
    const mottleCells = ctx.cells(ctx.tileSize.x.div(params.mottleSize) as Node<'float'>);
    const mottle = toUnit(
      fbm(mottleCells.p, { period: mottleCells.period, octaves: 4, seed: ctx.seed(1) })
    );
    const grains = ctx.cells(ctx.tileSize.x.mul(GRAINS_PER_METRE) as Node<'float'>);
    const grain = toUnit(valueNoise(grains.p, { period: grains.period, seed: ctx.seed(2) }));
    const speckCells = ctx.cells(ctx.tileSize.x.mul(SPECKS_PER_METRE) as Node<'float'>);
    const speckHash = hash12(speckCells.p, { period: speckCells.period, seed: ctx.seed(3) });
    // The share of the cells holding a speck: up to 4 %
    const speck = smoothstep(
      float(1).sub(params.specks.mul(0.04)),
      float(1.001).sub(params.specks.mul(0.035)),
      speckHash
    );

    const shade = mottle
      .sub(0.5)
      .mul(params.mottling)
      .add(0.5)
      .add(grain.sub(0.5).mul(params.grain).mul(0.35))
      .clamp(0, 1);
    const albedo = mix(params.dark, params.light, shade).mul(float(1).sub(speck.mul(0.55)));
    const height = mottle
      .mul(0.4)
      .add(grain.mul(params.grain).mul(0.6))
      .clamp(0, 1) as unknown as Node<'float'>;
    return {
      albedo: albedo as unknown as Node<'vec3'>,
      height,
      roughness: float(0.92).add(grain.sub(0.5).mul(0.06)) as unknown as Node<'float'>,
    };
  },
});
