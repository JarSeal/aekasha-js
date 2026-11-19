// The `decalMudSplatter` decal generator (p309 D5): a splat of mud lying on the ground, its main
// blob reaching out in fingers (a value noise over the angle) and droplets around it (each Worley
// cell's point a drop of its own size, fewer further out), raised and glossy where it's wet.
import { float, length, max, mix, step, vec2 } from 'three/tsl';
// The real generic `Node<T>` typings (the `three/tsl` `Node` is a loose local shim)
import type { Node } from 'three/webgpu';
import { fbm, valueNoise } from '../../nodes/noise/Noise';
import { worley } from '../../nodes/noise/Worley';
import { perCell, toUnit } from '../../procedural/SurfaceNodes';
import { defineDecalGenerator } from '../DecalGenerator';
import { angleOf, centredPoint, edgeGuard, under } from './DecalShapes';

/** The blob's fingers around its centre (a whole number: the noise's period over the angle). */
const FINGERS = 14;

/**
 * A blob `size` decal widths from its centre with fingers, and drops over `drops` Worley cells
 * across, `dropSize` of a cell at most, out to `spread`: mud (`mud`, wetter `wetMud` in the blob)
 * raised by `relief`.
 */
export const decalMudSplatter = defineDecalGenerator({
  id: 'decalMudSplatter',
  description:
    'A splat of mud: a blob reaching out in fingers with drops around it, raised and glossier where it lies thick.',
  physicalSize: [1, 1],
  heightScale: 0.008,
  params: {
    drops: { default: 9, min: 3, max: 20, isStatic: true, isInteger: true, label: 'Drop cells' },
    size: { default: 0.2, min: 0.05, max: 0.3, step: 0.01, label: 'Blob radius' },
    fingers: { default: 0.6, min: 0, max: 1, step: 0.05, label: 'Fingers' },
    dropSize: { default: 0.2, min: 0.05, max: 0.4, step: 0.01, label: 'Drop size (cells)' },
    spread: { default: 0.42, min: 0.2, max: 0.45, step: 0.01, label: 'Spread' },
    relief: { default: 0.6, min: 0, max: 1, step: 0.05, label: 'Relief' },
    roughness: { default: 0.55, min: 0, max: 1, step: 0.05, label: 'Roughness' },
    mud: { type: 'color', default: '#4f3c29', label: 'Mud colour' },
    wetMud: { type: 'color', default: '#2d2219', label: 'Wet mud colour' },
  },
  build: (ctx, params) => {
    const point = centredPoint(ctx);
    const distance = length(point) as unknown as Node<'float'>;
    const around = vec2(angleOf(point).mul(FINGERS), 0.5) as unknown as Node<'vec2'>;
    const finger = toUnit(valueNoise(around, { period: [FINGERS, 4], seed: ctx.seed(1) }));
    const blobRadius = params.size.mul(
      float(1).add(params.fingers.mul(finger.mul(finger).mul(1.2).sub(0.25)))
    ) as unknown as Node<'float'>;
    const wobbleCells = ctx.cells(5);
    const wobble = fbm(wobbleCells.p, {
      period: wobbleCells.period,
      octaves: 3,
      seed: ctx.seed(2),
    });
    const blob = under(distance.add(wobble.mul(0.025)) as Node<'float'>, blobRadius, 0.01);

    // A drop per Worley point: its own size, kept with a chance falling off out to `spread`
    const dropCells = ctx.cells(params.drops);
    const cells = worley(dropCells.p, { period: dropCells.period, seed: ctx.seed(3), jitter: 0.8 });
    const dropRadius = params.dropSize.mul(perCell(cells.cellId, 5.3).mul(0.7).add(0.3));
    const drop = under(cells.f1, dropRadius.mul(0.85), dropRadius.mul(0.15));
    const chance = under(
      distance,
      params.size.add(params.spread).mul(0.5),
      params.spread.sub(params.size).mul(0.5)
    );
    const keep = step(perCell(cells.cellId, 9.1), chance.mul(0.7));
    const splat = max(blob, drop.mul(keep)) as unknown as Node<'float'>;

    const fine = ctx.cells(14);
    const detail = toUnit(fbm(fine.p, { period: fine.period, octaves: 3, seed: ctx.seed(4) }));
    return {
      albedo: mix(
        params.mud,
        params.wetMud,
        blob.mul(0.6).add(detail.mul(0.2))
      ) as unknown as Node<'vec3'>,
      opacity: splat.mul(edgeGuard(point)) as unknown as Node<'float'>,
      height: float(0.5).add(
        splat.mul(params.relief).mul(detail.mul(0.15).add(0.3))
      ) as unknown as Node<'float'>,
      roughness: mix(
        params.roughness.add(0.25).min(1),
        params.roughness,
        blob
      ) as unknown as Node<'float'>,
    };
  },
});
