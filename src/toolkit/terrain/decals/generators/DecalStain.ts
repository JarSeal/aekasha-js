// The `decalStain` decal generator (p309 D5): an fbm blotch (oil, rust, spilt liquid), darker at a
// tide mark where it dried from its edge, its roughness its own (oil glossier than the ground). The
// ground and structure atlases' `stain01` / `stain02` (other seeds and colours).
import { float, length, vec3 } from 'three/tsl';
// The real generic `Node<T>` typings (the `three/tsl` `Node` is a loose local shim)
import type { Node } from 'three/webgpu';
import { fbm } from '../../nodes/noise/Noise';
import { toUnit } from '../../procedural/SurfaceNodes';
import { defineDecalGenerator } from '../DecalGenerator';
import { centredPoint, edgeGuard, under } from './DecalShapes';

/**
 * A blotch `radius` decal widths across from its centre, its edge wobbling by `wobble` over
 * `blotches` noise cells, `density` opaque with a mottle, a darker tide mark (`rim`) inside its
 * edge, and its own `roughness`.
 */
export const decalStain = defineDecalGenerator({
  id: 'decalStain',
  description:
    'An fbm blotch with a darker tide mark inside its edge, mottled, with a roughness of its own: oil, rust or a dried spill.',
  physicalSize: [1.5, 1.5],
  heightScale: 0.002,
  params: {
    blotches: {
      default: 3,
      min: 1,
      max: 8,
      isStatic: true,
      isInteger: true,
      label: 'Wobble cells',
    },
    radius: { default: 0.34, min: 0.1, max: 0.42, step: 0.01, label: 'Radius' },
    wobble: { default: 0.1, min: 0, max: 0.2, step: 0.01, label: 'Edge wobble' },
    density: { default: 0.7, min: 0, max: 1, step: 0.05, label: 'Density' },
    mottle: { default: 0.3, min: 0, max: 1, step: 0.05, label: 'Mottle' },
    rim: { default: 0.5, min: 0, max: 1, step: 0.05, label: 'Tide mark' },
    roughness: { default: 0.4, min: 0, max: 1, step: 0.05, label: 'Roughness' },
    color: { type: 'color', default: '#2a231e', label: 'Colour' },
  },
  build: (ctx, params) => {
    const point = centredPoint(ctx);
    const coarse = ctx.cells(params.blotches);
    const wobble = fbm(coarse.p, { period: coarse.period, octaves: 4, seed: ctx.seed(1) });
    const distance = length(point).add(wobble.mul(params.wobble)) as unknown as Node<'float'>;
    const blot = under(distance, params.radius.sub(0.03), 0.03);
    // The tide mark: a band inside the edge, where the stain dried last
    const rim = under(distance, params.radius.sub(0.035), 0.025)
      .oneMinus()
      .mul(blot)
      .mul(params.rim) as unknown as Node<'float'>;
    const fine = ctx.cells(12);
    const mottle = toUnit(fbm(fine.p, { period: fine.period, octaves: 4, seed: ctx.seed(2) }));
    const body = blot.mul(params.density).mul(float(1).sub(params.mottle.mul(mottle)));

    return {
      albedo: params.color.mul(float(1).sub(rim.mul(0.45))) as unknown as Node<'vec3'>,
      opacity: body
        .add(rim.mul(0.35))
        .clamp(0, 1)
        .mul(edgeGuard(point)) as unknown as Node<'float'>,
      height: float(0.5) as unknown as Node<'float'>,
      roughness: params.roughness,
      // Flat: no relief to tap
      normal: vec3(0, 0, 1) as unknown as Node<'vec3'>,
    };
  },
});
