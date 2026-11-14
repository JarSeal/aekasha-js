// The `snowDrift` surface generator (p304 D3, SNOW): soft snow drifts (a smooth, low-gain fbm),
// a faint blue in the hollows, and sparse glints where the roughness drops (`sparkle`).
import { float, mix, smoothstep } from 'three/tsl';
// The real generic `Node<T>` typings (the `three/tsl` `Node` is a loose local shim)
import type { Node } from 'three/webgpu';
import { hash12 } from '../../nodes/noise/Hash';
import { fbm } from '../../nodes/noise/Noise';
import { defineSurfaceGenerator } from '../SurfaceGenerator';
import { toUnit } from '../SurfaceNodes';

/** The glint cells per metre (about 5 mm). */
const GLINTS_PER_METRE = 200;

/**
 * Drifted snow: soft drifts about `driftSize` metres across, the hollows tinted `shadow`, with
 * `sparkle` glints of low roughness.
 */
export const generator = defineSurfaceGenerator({
  id: 'snowDrift',
  category: 'SNOW',
  description: 'Snow drifts: soft rounded drifts, a faint blue in the hollows, sparse glints.',
  physicalSize: [4, 4],
  heightScale: 0.12,
  cavity: { radius: 0.15, strength: 1.5 },
  params: {
    driftSize: { default: 2.5, min: 0.5, max: 8, step: 0.1, label: 'Drift size (m)' },
    sparkle: { default: 0.5, min: 0, max: 1, step: 0.05, label: 'Sparkle' },
    snow: { type: 'color', default: '#f3f6fa', label: 'Snow colour' },
    shadow: { type: 'color', default: '#b6c7dc', label: 'Hollow colour' },
  },
  build: (ctx, params) => {
    const drifts = ctx.cells(ctx.tileSize.x.div(params.driftSize) as Node<'float'>);
    const drift = smoothstep(
      0.15,
      0.85,
      toUnit(
        fbm(drifts.p, { period: drifts.period, octaves: 5, gain: 0.42, seed: ctx.seed(1) }).mul(
          1.5
        ) as Node<'float'>
      )
    );
    const fine = ctx.cells(ctx.tileSize.x.mul(5) as Node<'float'>);
    const detail = toUnit(fbm(fine.p, { period: fine.period, octaves: 3, seed: ctx.seed(2) }));
    const height = drift.mul(0.92).add(detail.mul(0.08)) as unknown as Node<'float'>;

    const glintCells = ctx.cells(ctx.tileSize.x.mul(GLINTS_PER_METRE) as Node<'float'>);
    const glintHash = hash12(glintCells.p, { period: glintCells.period, seed: ctx.seed(3) });
    const glint = smoothstep(float(1).sub(params.sparkle.mul(0.05)), float(1.001), glintHash);
    const albedo = mix(params.shadow, params.snow, smoothstep(0, 0.55, height).mul(0.75).add(0.25));
    return {
      albedo: albedo as unknown as Node<'vec3'>,
      height,
      roughness: float(0.72)
        .add(detail.sub(0.5).mul(0.1))
        .sub(glint.mul(0.55)) as unknown as Node<'float'>,
    };
  },
});
