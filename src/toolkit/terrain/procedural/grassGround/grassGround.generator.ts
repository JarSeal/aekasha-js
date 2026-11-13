// The `grassGround` surface generator (p304 D3, GRASS): ground seen through short grass, soft
// tufts (Worley F1 mounds, each a little greener or yellower) over a broad green mottling, the soil
// showing through where a broad fbm is low (`soilShow`), with fine streaks along v for the blades.
import { float, mix, smoothstep, vec2 } from 'three/tsl';
// The real generic `Node<T>` typings (the `three/tsl` `Node` is a loose local shim)
import type { Node } from 'three/webgpu';
import { fbm, valueNoise } from '../../nodes/noise/Noise';
import { worley } from '../../nodes/noise/Worley';
import { defineSurfaceGenerator } from '../SurfaceGenerator';
import { below, perCell, toUnit } from '../SurfaceNodes';

/** The streaks' cells per metre across and along the blades. */
const STREAKS_ACROSS = 300;
const STREAKS_ALONG = 24;

/**
 * Grassy ground: clumps about `clumpSize` metres across between two greens, soil showing through
 * by `soilShow`, blade `streaks`.
 */
export const generator = defineSurfaceGenerator({
  id: 'grassGround',
  category: 'GRASS',
  description:
    'Short grass over soil: clumps of greens, soil showing through in patches, fine blade streaks.',
  physicalSize: [2, 2],
  heightScale: 0.04,
  cavity: { radius: 0.02, strength: 3 },
  params: {
    clumpSize: { default: 0.25, min: 0.05, max: 1, step: 0.01, label: 'Clump size (m)' },
    soilShow: { default: 0.3, min: 0, max: 1, step: 0.05, label: 'Soil showing' },
    streaks: { default: 0.6, min: 0, max: 1, step: 0.05, label: 'Streaks' },
    greenDark: { type: 'color', default: '#3f6a25', label: 'Dark green' },
    greenLight: { type: 'color', default: '#7f9c3c', label: 'Light green' },
    soil: { type: 'color', default: '#594532', label: 'Soil colour' },
  },
  build: (ctx, params) => {
    // Tufts: soft, broad mounds (no gaps between them), each a little greener or yellower
    const tuftCells = ctx.cells(ctx.tileSize.x.div(params.clumpSize) as Node<'float'>);
    const tufts = worley(tuftCells.p, { period: tuftCells.period, seed: ctx.seed(1) });
    const tuft = below(tufts.f1, 0.6, 0.35);

    const broad = ctx.cells(3);
    const cover = toUnit(fbm(broad.p, { period: broad.period, octaves: 4, seed: ctx.seed(2) }));
    const grass = smoothstep(params.soilShow.sub(0.15), params.soilShow.add(0.1), cover);
    const hues = ctx.cells(ctx.tileSize.x.mul(2) as Node<'float'>);
    const hue = toUnit(fbm(hues.p, { period: hues.period, octaves: 4, seed: ctx.seed(5) }));

    const streakCells = ctx.cells(
      ctx.tileSize.mul(vec2(STREAKS_ACROSS, STREAKS_ALONG)) as unknown as Node<'vec2'>
    );
    const streak = toUnit(
      valueNoise(streakCells.p, { period: streakCells.period, seed: ctx.seed(3) })
    );

    const shade = hue
      .mul(0.65)
      .add(perCell(tufts.cellId, 4.1).mul(0.2))
      .add(streak.sub(0.5).mul(params.streaks).mul(0.5))
      .clamp(0, 1);
    const green = mix(params.greenDark, params.greenLight, shade).mul(tuft.mul(0.15).add(0.88));
    const soilFine = ctx.cells(ctx.tileSize.x.mul(8) as Node<'float'>);
    const soilNoise = toUnit(
      fbm(soilFine.p, { period: soilFine.period, octaves: 3, seed: ctx.seed(4) })
    );
    const soil = params.soil.mul(soilNoise.mul(0.4).add(0.8));
    const height = grass
      .mul(tuft.mul(0.25).add(0.45).add(streak.mul(params.streaks).mul(0.3)))
      .add(soilNoise.mul(0.1))
      .clamp(0, 1) as unknown as Node<'float'>;
    return {
      albedo: mix(soil, green, grass) as unknown as Node<'vec3'>,
      height,
      roughness: float(0.92).sub(grass.mul(0.1)) as unknown as Node<'float'>,
    };
  },
});
