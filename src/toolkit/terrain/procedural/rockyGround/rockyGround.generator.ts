// The `rockyGround` surface generator (p304 D3, ROCKS): pebbles on soil, a dome at each Worley
// cell's point (F1) where the cell holds one (`density`), each pebble its own size, height and
// colour from its cell id, the soil an fbm between them.
import { float, max, mix, smoothstep } from 'three/tsl';
// The real generic `Node<T>` typings (the `three/tsl` `Node` is a loose local shim)
import type { Node } from 'three/webgpu';
import { fbm } from '../../nodes/noise/Noise';
import { worley } from '../../nodes/noise/Worley';
import { defineSurfaceGenerator } from '../SurfaceGenerator';
import { below, perCell, toUnit } from '../SurfaceNodes';

/**
 * Rocky ground: pebbles about `pebbleSize` metres apart, a `density` share of the cells holding
 * one, their colours spread by `colourSpread` between two rock colours, on soil.
 */
export const generator = defineSurfaceGenerator({
  id: 'rockyGround',
  category: 'ROCKS',
  description:
    'Pebbles on soil: a rounded pebble in most cells, each its own size, height and colour.',
  physicalSize: [2, 2],
  heightScale: 0.06,
  cavity: { radius: 0.02, strength: 4 },
  params: {
    pebbleSize: { default: 0.12, min: 0.03, max: 0.5, step: 0.01, label: 'Pebble size (m)' },
    density: { default: 0.85, min: 0, max: 1, step: 0.05, label: 'Density' },
    colourSpread: { default: 0.5, min: 0, max: 1, step: 0.05, label: 'Colour spread' },
    rockLight: { type: 'color', default: '#7d766e', label: 'Rock colour' },
    rockDark: { type: 'color', default: '#544a42', label: 'Second rock colour' },
    soil: { type: 'color', default: '#5a4838', label: 'Soil colour' },
  },
  build: (ctx, params) => {
    const pebbleCells = ctx.cells(ctx.tileSize.x.div(params.pebbleSize) as Node<'float'>);
    const cells = worley(pebbleCells.p, {
      period: pebbleCells.period,
      seed: ctx.seed(1),
      jitter: 1,
    });
    const hasPebble = below(cells.cellId, params.density, 0.001);
    const radius = perCell(cells.cellId, 13.7).mul(0.3).add(0.25);
    const r = cells.f1.div(radius);
    const dome = max(float(0), float(1).sub(r.mul(r)))
      .sqrt()
      .mul(hasPebble);
    const pebble = dome.mul(perCell(cells.cellId, 5.3).mul(0.4).add(0.6));

    const soilCells = ctx.cells(ctx.tileSize.x.mul(3) as Node<'float'>);
    const soilNoise = toUnit(
      fbm(soilCells.p, { period: soilCells.period, octaves: 5, seed: ctx.seed(2) })
    );
    const soilHeight = soilNoise.mul(0.25);
    const height = max(pebble, soilHeight) as unknown as Node<'float'>;
    const isPebble = smoothstep(0, 0.04, pebble.sub(soilHeight));

    const spread = perCell(cells.cellId, 9.1).sub(0.5).mul(params.colourSpread).mul(0.9).add(1);
    const grainCells = ctx.cells(ctx.tileSize.x.mul(60) as Node<'float'>);
    const grain = toUnit(
      fbm(grainCells.p, { period: grainCells.period, octaves: 2, seed: ctx.seed(3) })
    );
    const rock = mix(params.rockDark, params.rockLight, perCell(cells.cellId, 3.7))
      .mul(spread)
      .mul(grain.mul(0.3).add(0.85));
    const soil = params.soil.mul(soilNoise.mul(0.4).add(0.8));
    return {
      albedo: mix(soil, rock, isPebble) as unknown as Node<'vec3'>,
      height,
      roughness: mix(
        float(0.95),
        perCell(cells.cellId, 2.9).mul(0.15).add(0.78),
        isPebble
      ) as unknown as Node<'float'>,
    };
  },
});
