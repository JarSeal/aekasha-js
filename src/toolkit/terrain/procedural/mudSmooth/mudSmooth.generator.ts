// The `mudSmooth` surface generator (p304 D3, MUD): wet, smooth mud, a lumpy fbm whose low spots
// below `wetLevel` hold water: darker and glossy (it pairs with p307's puddles).
import { float, mix } from 'three/tsl';
// The real generic `Node<T>` typings (the `three/tsl` `Node` is a loose local shim)
import type { Node } from 'three/webgpu';
import { fbm } from '../../nodes/noise/Noise';
import { defineSurfaceGenerator } from '../SurfaceGenerator';
import { below, toUnit } from '../SurfaceNodes';

/**
 * Smooth mud: lumps about `scale` metres across (`lumpiness`: the fbm's gain), its low spots
 * under `wetLevel` dark and glossy.
 */
export const generator = defineSurfaceGenerator({
  id: 'mudSmooth',
  category: 'MUD',
  description: 'Smooth mud: soft lumps, the low spots dark and glossy with standing water.',
  physicalSize: [3, 3],
  heightScale: 0.04,
  cavity: { radius: 0.06, strength: 2 },
  params: {
    scale: { default: 0.9, min: 0.2, max: 3, step: 0.05, label: 'Lump size (m)' },
    lumpiness: { default: 0.5, min: 0.3, max: 0.7, step: 0.01, label: 'Lumpiness' },
    wetLevel: { default: 0.3, min: 0, max: 1, step: 0.01, label: 'Wet level' },
    light: { type: 'color', default: '#7b6047', label: 'Light colour' },
    dark: { type: 'color', default: '#4d3a29', label: 'Wet colour' },
  },
  build: (ctx, params) => {
    const lumps = ctx.cells(ctx.tileSize.x.div(params.scale) as Node<'float'>);
    const lump = toUnit(
      fbm(lumps.p, {
        period: lumps.period,
        octaves: 5,
        gain: params.lumpiness,
        seed: ctx.seed(1),
      }).mul(1.6) as Node<'float'>
    ).clamp(0, 1) as Node<'float'>;
    const fine = ctx.cells(ctx.tileSize.x.mul(6) as Node<'float'>);
    const detail = toUnit(fbm(fine.p, { period: fine.period, octaves: 3, seed: ctx.seed(2) }));
    const height = lump.mul(0.9).add(detail.mul(0.1)) as Node<'float'>;
    const wet = below(height, params.wetLevel, 0.07);
    const albedo = mix(params.light, params.dark, wet.mul(0.6).add(float(1).sub(lump).mul(0.3)));
    return {
      albedo: albedo as unknown as Node<'vec3'>,
      height,
      roughness: mix(float(0.82), float(0.12), wet).add(
        detail.sub(0.5).mul(0.06)
      ) as unknown as Node<'float'>,
    };
  },
});
