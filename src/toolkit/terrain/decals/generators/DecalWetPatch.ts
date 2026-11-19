// The `decalWetPatch` decal generator (p309 D5): a damp patch with a soft fbm edge, darker and
// glossier than the ground, its puddle mask deepest at its centre, so the surface conditions'
// puddles fill it first (a leak, a hollow that holds water).
import { float, length, mix, vec3 } from 'three/tsl';
// The real generic `Node<T>` typings (the `three/tsl` `Node` is a loose local shim)
import type { Node } from 'three/webgpu';
import { fbm } from '../../nodes/noise/Noise';
import { defineDecalGenerator } from '../DecalGenerator';
import { centredPoint, edgeGuard, under } from './DecalShapes';

/**
 * A patch `radius` decal widths from its centre with a `softness` wide edge, `darkening` opaque
 * in `color`, `roughness` rough, its puddle mask up to `puddle` towards the centre.
 */
export const decalWetPatch = defineDecalGenerator({
  id: 'decalWetPatch',
  description:
    'A damp patch with a soft edge, darker and glossier than the ground, its puddle mask deepest at its centre.',
  physicalSize: [2, 2],
  heightScale: 0.002,
  params: {
    radius: { default: 0.36, min: 0.1, max: 0.42, step: 0.01, label: 'Radius' },
    softness: { default: 0.12, min: 0.02, max: 0.3, step: 0.01, label: 'Edge softness' },
    wobble: { default: 0.08, min: 0, max: 0.15, step: 0.01, label: 'Edge wobble' },
    darkening: { default: 0.55, min: 0, max: 1, step: 0.05, label: 'Darkening' },
    roughness: { default: 0.15, min: 0, max: 1, step: 0.05, label: 'Roughness' },
    puddle: { default: 0.8, min: 0, max: 1, step: 0.05, label: 'Puddle mask' },
    color: { type: 'color', default: '#2f2922', label: 'Colour' },
  },
  build: (ctx, params) => {
    const point = centredPoint(ctx);
    const coarse = ctx.cells(3);
    const fine = ctx.cells(9);
    const wobble = fbm(coarse.p, { period: coarse.period, octaves: 3, seed: ctx.seed(1) })
      .mul(params.wobble)
      .add(fbm(fine.p, { period: fine.period, octaves: 3, seed: ctx.seed(2) }).mul(0.015));
    const distance = length(point).add(wobble) as unknown as Node<'float'>;
    const half = params.softness.mul(0.5);
    const mask = under(distance, params.radius.sub(half), half);
    // 1 at the centre, 0 at the patch's edge
    const depth = float(1).sub(distance.div(params.radius).clamp(0, 1));

    return {
      albedo: params.color,
      opacity: mask.mul(params.darkening).mul(edgeGuard(point)) as unknown as Node<'float'>,
      height: float(0.5) as unknown as Node<'float'>,
      roughness: params.roughness,
      puddle: mask
        .mul(mix(float(0.35), float(1), depth))
        .mul(params.puddle) as unknown as Node<'float'>,
      normal: vec3(0, 0, 1) as unknown as Node<'vec3'>,
    };
  },
});
