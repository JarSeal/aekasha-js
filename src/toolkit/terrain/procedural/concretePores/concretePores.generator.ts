// The `concretePores` surface generator (p304 D3, CONCRETE): cast concrete, small pores (Worley
// F1 dimples in some cells), broad fbm stains, a fine grain, and optional form-work seams (grooves
// across v, `seamCount` per tile).
import { float, fract, min, mix, smoothstep } from 'three/tsl';
// The real generic `Node<T>` typings (the `three/tsl` `Node` is a loose local shim)
import type { Node } from 'three/webgpu';
import { fbm, valueNoise } from '../../nodes/noise/Noise';
import { worley } from '../../nodes/noise/Worley';
import { defineSurfaceGenerator } from '../SurfaceGenerator';
import { below, toUnit } from '../SurfaceNodes';

/** The pore cells per metre (about 1.7 cm apart), and the grain's. */
const PORES_PER_METRE = 60;
const GRAINS_PER_METRE = 200;
/** A seam's half-width in uv. */
const SEAM_HALF_WIDTH = 0.004;

/**
 * Cast concrete: `poreDensity` pores of `poreSize` (a share of a pore cell), `stains` of the stain
 * colour, and with `seams` on, `seamCount` form-work grooves across v per tile.
 */
export const generator = defineSurfaceGenerator({
  id: 'concretePores',
  category: 'CONCRETE',
  description: 'Cast concrete: fine pores, broad stains, a fine grain, optional form-work seams.',
  physicalSize: [2, 2],
  heightScale: 0.004,
  cavity: { radius: 0.006, strength: 1.5 },
  params: {
    poreDensity: { default: 0.35, min: 0, max: 1, step: 0.05, label: 'Pore density' },
    poreSize: { default: 0.22, min: 0.05, max: 0.45, step: 0.01, label: 'Pore size' },
    stains: { default: 0.45, min: 0, max: 1, step: 0.05, label: 'Stains' },
    seams: { type: 'boolean', default: false, label: 'Form-work seams' },
    seamCount: { default: 2, min: 1, max: 8, isStatic: true, isInteger: true, label: 'Seams' },
    colour: { type: 'color', default: '#8f8c87', label: 'Concrete colour' },
    stain: { type: 'color', default: '#5e5951', label: 'Stain colour' },
  },
  build: (ctx, params) => {
    const poreCells = ctx.cells(ctx.tileSize.x.mul(PORES_PER_METRE) as Node<'float'>);
    const pores = worley(poreCells.p, { period: poreCells.period, seed: ctx.seed(1) });
    const pore = below(pores.f1, params.poreSize, 0.04).mul(
      below(pores.cellId, params.poreDensity, 0.001)
    );

    const broad = ctx.cells(2);
    const stainNoise = toUnit(
      fbm(broad.p, { period: broad.period, octaves: 5, seed: ctx.seed(2) })
    );
    const stain = smoothstep(0.4, 0.72, stainNoise).mul(params.stains);
    const grains = ctx.cells(ctx.tileSize.x.mul(GRAINS_PER_METRE) as Node<'float'>);
    const grain = toUnit(valueNoise(grains.p, { period: grains.period, seed: ctx.seed(3) }));

    let seam: Node<'float'> = float(0) as unknown as Node<'float'>;
    if (params.seams) {
      const t = fract(ctx.uv.y.mul(params.seamCount));
      const distance = min(t, float(1).sub(t)).div(params.seamCount);
      seam = below(distance, SEAM_HALF_WIDTH, SEAM_HALF_WIDTH * 0.5);
    }
    const height = float(0.7)
      .sub(pore.mul(0.45))
      .add(grain.mul(0.08))
      .sub(seam.mul(0.4))
      .clamp(0, 1) as unknown as Node<'float'>;
    const albedo = mix(params.colour, params.stain, stain)
      .mul(grain.sub(0.5).mul(0.12).add(1))
      .mul(float(1).sub(pore.mul(0.2)))
      .mul(float(1).sub(seam.mul(0.25)));
    return {
      albedo: albedo as unknown as Node<'vec3'>,
      height,
      roughness: float(0.86)
        .sub(stain.mul(0.1))
        .add(grain.sub(0.5).mul(0.06)) as unknown as Node<'float'>,
    };
  },
});
