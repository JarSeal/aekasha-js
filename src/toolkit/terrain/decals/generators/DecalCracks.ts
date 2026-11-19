// The `decalCracks` decal generator (p309 D5): cracks along a few warped Worley cell edges (F2 −
// F1), the edges kept by a low noise (the branching) and tapering out towards the decal's rim, a
// grooved dark line with a faint dusty band along it. The ground atlas's `crack` and the structure
// atlas's `crack01` / `crack02` (other seeds and widths).
import { float, length, max, mix, smoothstep } from 'three/tsl';
// The real generic `Node<T>` typings (the `three/tsl` `Node` is a loose local shim)
import type { Node } from 'three/webgpu';
import { domainWarp, fbm } from '../../nodes/noise/Noise';
import { worley } from '../../nodes/noise/Worley';
import { toUnit } from '../../procedural/SurfaceNodes';
import { defineDecalGenerator } from '../DecalGenerator';
import { centredPoint, edgeGuard, under } from './DecalShapes';

/**
 * Cracks over `cells` Worley cells across the decal, `width` cells wide, `branching` of the cell
 * edges kept, fading out by `reach` of the decal's half width: dark grooves (`color`) with a dusty
 * band (`dust`) along them.
 */
export const decalCracks = defineDecalGenerator({
  id: 'decalCracks',
  description:
    'Cracks along warped cell edges, branching and tapering out towards the rim: dark grooves with a dusty band along them.',
  physicalSize: [1, 1],
  heightScale: 0.01,
  params: {
    cells: { default: 5, min: 2, max: 16, isStatic: true, isInteger: true, label: 'Cells across' },
    width: { default: 0.04, min: 0.005, max: 0.15, step: 0.005, label: 'Width (cells)' },
    branching: { default: 0.55, min: 0, max: 1, step: 0.05, label: 'Branching' },
    reach: { default: 0.85, min: 0.2, max: 1, step: 0.05, label: 'Reach' },
    depth: { default: 0.6, min: 0, max: 1, step: 0.05, label: 'Groove depth' },
    dust: { default: 0.35, min: 0, max: 1, step: 0.05, label: 'Dusty band' },
    puddle: { default: 0, min: 0, max: 1, step: 0.05, label: 'Puddle mask' },
    color: { type: 'color', default: '#24201d', label: 'Crack colour' },
    dustColor: { type: 'color', default: '#6b645c', label: 'Dust colour' },
  },
  build: (ctx, params) => {
    const point = centredPoint(ctx);
    const radius = length(point).mul(2) as unknown as Node<'float'>;
    const plates = ctx.cells(params.cells);
    const warped = domainWarp(plates.p, {
      period: plates.period,
      strength: 0.35,
      octaves: 2,
      seed: ctx.seed(1),
    });
    const cells = worley(warped, { period: plates.period, seed: ctx.seed(2), jitter: 0.9 });
    const edge = cells.f2.sub(cells.f1) as Node<'float'>;
    // The edges a low noise keeps: about `branching` of them
    const low = ctx.cells(3);
    const keepNoise = toUnit(fbm(low.p, { period: low.period, octaves: 3, seed: ctx.seed(3) }));
    const threshold = mix(float(0.72), float(0.28), params.branching);
    const keep = smoothstep(threshold.sub(0.05), threshold.add(0.05), keepNoise);
    const fade = under(radius, params.reach.mul(0.75), params.reach.mul(0.25));
    const strength = keep.mul(fade) as unknown as Node<'float'>;
    // The crack tapers where it fades (never 0 wide: `smoothstep`'s edges would meet)
    const lineWidth = max(params.width.mul(strength), 0.001) as unknown as Node<'float'>;
    const line = under(edge, lineWidth.mul(0.75), lineWidth.mul(0.25)).mul(strength);
    const band = under(edge, lineWidth.mul(2).add(0.04), 0.03).mul(strength).mul(params.dust);

    const guard = edgeGuard(point);
    return {
      albedo: mix(params.dustColor, params.color, line) as unknown as Node<'vec3'>,
      opacity: max(line, band).mul(guard) as unknown as Node<'float'>,
      height: float(0.5).sub(line.mul(params.depth).mul(0.5)) as unknown as Node<'float'>,
      roughness: mix(float(0.8), float(0.92), line) as unknown as Node<'float'>,
      puddle: line.mul(params.puddle) as unknown as Node<'float'>,
    };
  },
});
