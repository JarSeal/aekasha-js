// The `cliffStrata` surface generator (p304 D3, CLIFF): rock strata, `strata` bands along v (each
// band its own shade and recess, thin bedding lines between them, undulating by a periodic fbm),
// split by mostly vertical cracks (Worley edges of cells taller than wide) over an fbm grain.
// Meant for a cliff's triplanar sides, tiling in its UV. A band's tilt is the material's (turn the
// UV): a linear tilt can't tile with bands that differ, since a tile's edge would meet another band.
import { float, floor, fract, mix, smoothstep, vec2 } from 'three/tsl';
// The real generic `Node<T>` typings (the `three/tsl` `Node` is a loose local shim)
import type { Node } from 'three/webgpu';
import { hash12 } from '../../nodes/noise/Hash';
import { fbm } from '../../nodes/noise/Noise';
import { worley } from '../../nodes/noise/Worley';
import { defineSurfaceGenerator } from '../SurfaceGenerator';
import { toUnit } from '../SurfaceNodes';

/** The bedding line's half-width, a share of a band. */
const BEDDING = 0.06;

/**
 * Cliff strata: `strata` bands of rock along v, undulating by `undulation`, their shades apart by
 * `bandContrast`, cut by vertical cracks (`crackDensity` columns of cells across the tile).
 */
export const generator = defineSurfaceGenerator({
  id: 'cliffStrata',
  category: 'CLIFF',
  description:
    'Rock strata: bands of rock along v with bedding lines, undulating, split by vertical cracks (for triplanar cliffs).',
  physicalSize: [4, 4],
  heightScale: 0.15,
  cavity: { radius: 0.05, strength: 3 },
  params: {
    strata: { default: 12, min: 2, max: 48, isStatic: true, isInteger: true, label: 'Bands' },
    undulation: { default: 0.4, min: 0, max: 1, step: 0.05, label: 'Undulation' },
    bandContrast: { default: 0.55, min: 0, max: 1, step: 0.05, label: 'Band contrast' },
    crackDensity: {
      default: 5,
      min: 1,
      max: 16,
      isStatic: true,
      isInteger: true,
      label: 'Crack columns',
    },
    rockLight: { type: 'color', default: '#9a8877', label: 'Light rock' },
    rockDark: { type: 'color', default: '#655748', label: 'Dark rock' },
  },
  build: (ctx, params) => {
    const broad = ctx.cells(2);
    const wave = fbm(broad.p, { period: broad.period, octaves: 3, seed: ctx.seed(1) });
    const phase = ctx.uv.y.mul(params.strata).add(wave.mul(params.undulation).mul(3));
    const band = floor(phase);
    const t = fract(phase);
    // A band's own number: its index wrapped by the band count, so v tiles
    const bandHash = hash12(vec2(band, 0.5) as unknown as Node<'vec2'>, {
      period: [params.strata, 1],
      seed: ctx.seed(2),
    });
    const bedding = smoothstep(0, BEDDING, t).mul(smoothstep(0, BEDDING, float(1).sub(t)));

    const crackCells = ctx.cells([
      params.crackDensity,
      Math.max(1, Math.round(params.crackDensity / 2)),
    ]);
    const cracks = worley(crackCells.p, {
      period: crackCells.period,
      seed: ctx.seed(3),
      jitter: 1,
    });
    const crack = smoothstep(0.015, 0.06, cracks.f2.sub(cracks.f1));

    const fine = ctx.cells(16);
    const grain = toUnit(fbm(fine.p, { period: fine.period, octaves: 5, seed: ctx.seed(4) }));
    const height = bandHash
      .mul(0.3)
      .add(0.45)
      .sub(float(1).sub(bedding).mul(0.18))
      .add(grain.mul(0.2))
      .mul(crack.mul(0.35).add(0.65))
      .clamp(0, 1) as unknown as Node<'float'>;
    const shade = bandHash.sub(0.5).mul(params.bandContrast).add(0.5).add(grain.sub(0.5).mul(0.3));
    const albedo = mix(params.rockDark, params.rockLight, shade.clamp(0, 1))
      .mul(bedding.mul(0.25).add(0.75))
      .mul(crack.mul(0.25).add(0.75));
    return {
      albedo: albedo as unknown as Node<'vec3'>,
      height,
      roughness: float(0.88).add(grain.sub(0.5).mul(0.1)) as unknown as Node<'float'>,
    };
  },
});
