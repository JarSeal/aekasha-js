// The `mudCracked` surface generator (p304 D3, MUD): dried mud, plates parted by cracks along the
// Worley cell edges (F2 − F1, the cells warped so the cracks wander), each plate tilted a little
// and curled up at its rim, the cracks dark and damp.
import { float, mix, smoothstep } from 'three/tsl';
// The real generic `Node<T>` typings (the `three/tsl` `Node` is a loose local shim)
import type { Node } from 'three/webgpu';
import { domainWarp, fbm } from '../../nodes/noise/Noise';
import { worley } from '../../nodes/noise/Worley';
import { defineSurfaceGenerator } from '../SurfaceGenerator';
import { perCell, toUnit } from '../SurfaceNodes';

/**
 * Dried, cracked mud: plates about `plateSize` metres across, parted by cracks `crackWidth` cells
 * wide, their rims curled up by `curl`, with `moisture` darkening the cracks and the low plates.
 */
export const generator = defineSurfaceGenerator({
  id: 'mudCracked',
  category: 'MUD',
  description:
    'Dried mud: plates parted by wandering cracks, each tilted and curled up at its rim, the cracks dark and damp.',
  physicalSize: [2, 2],
  heightScale: 0.03,
  cavity: { radius: 0.015, strength: 3 },
  params: {
    plateSize: { default: 0.22, min: 0.05, max: 1, step: 0.01, label: 'Plate size (m)' },
    crackWidth: { default: 0.07, min: 0.01, max: 0.3, step: 0.005, label: 'Crack width (cells)' },
    curl: { default: 0.5, min: 0, max: 1, step: 0.05, label: 'Rim curl' },
    moisture: { default: 0.3, min: 0, max: 1, step: 0.05, label: 'Moisture' },
    dry: { type: 'color', default: '#a08a6c', label: 'Dry colour' },
    wet: { type: 'color', default: '#4c3a2a', label: 'Damp colour' },
  },
  build: (ctx, params) => {
    const plates = ctx.cells(ctx.tileSize.x.div(params.plateSize) as Node<'float'>);
    const warped = domainWarp(plates.p, {
      period: plates.period,
      strength: 0.3,
      octaves: 2,
      seed: ctx.seed(1),
    });
    const cells = worley(warped, { period: plates.period, seed: ctx.seed(2), jitter: 0.9 });
    const edge = cells.f2.sub(cells.f1);
    // 0 in a crack, 1 on a plate
    const plate = smoothstep(params.crackWidth.mul(0.5), params.crackWidth, edge);
    const rim = float(1)
      .sub(smoothstep(params.crackWidth, params.crackWidth.add(0.3), edge))
      .mul(params.curl);
    const tilt = perCell(cells.cellId, 7.3).sub(0.5).mul(0.2);
    const fine = ctx.cells(ctx.tileSize.x.mul(12) as Node<'float'>);
    const detail = toUnit(fbm(fine.p, { period: fine.period, octaves: 4, seed: ctx.seed(3) }));

    const height = plate
      .mul(rim.mul(0.25).add(0.6).add(tilt).add(detail.mul(0.1)))
      .clamp(0, 1) as unknown as Node<'float'>;
    const damp = float(1)
      .sub(plate)
      .mul(params.moisture.mul(0.7).add(0.3))
      .add(params.moisture.mul(0.35).mul(float(1).sub(detail)))
      .clamp(0, 1);
    const plateShade = perCell(cells.cellId, 3.1).mul(0.2).add(0.9);
    const albedo = mix(params.dry.mul(plateShade), params.wet, damp);
    return {
      albedo: albedo as unknown as Node<'vec3'>,
      height,
      roughness: mix(float(0.93), float(0.55), damp) as unknown as Node<'float'>,
    };
  },
});
