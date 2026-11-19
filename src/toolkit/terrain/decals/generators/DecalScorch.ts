// The `decalScorch` decal generator (p309 D5): a radial burn, black soot at its core fading to a
// charred brown, its reach broken into streaks around the centre (a value noise over the angle,
// periodic around it) and a soot noise.
import { float, length, mix, smoothstep, vec2, vec3 } from 'three/tsl';
// The real generic `Node<T>` typings (the `three/tsl` `Node` is a loose local shim)
import type { Node } from 'three/webgpu';
import { fbm, valueNoise } from '../../nodes/noise/Noise';
import { toUnit } from '../../procedural/SurfaceNodes';
import { defineDecalGenerator } from '../DecalGenerator';
import { angleOf, centredPoint, edgeGuard, under } from './DecalShapes';

/**
 * A burn reaching `radius` decal widths from its centre, broken into `streaks` streaks around it
 * (`streakLength` of the reach), soot (`soot`) at the core and `char` at its edge, `intensity`
 * opaque.
 */
export const decalScorch = defineDecalGenerator({
  id: 'decalScorch',
  description:
    'A radial burn: black soot at its core fading to charred brown, its reach broken into streaks around the centre.',
  physicalSize: [2, 2],
  heightScale: 0.002,
  params: {
    streaks: {
      default: 22,
      min: 6,
      max: 48,
      isStatic: true,
      isInteger: true,
      label: 'Streaks around',
    },
    radius: { default: 0.42, min: 0.2, max: 0.45, step: 0.01, label: 'Reach' },
    streakLength: { default: 0.6, min: 0, max: 1, step: 0.05, label: 'Streak length' },
    intensity: { default: 0.95, min: 0, max: 1, step: 0.05, label: 'Intensity' },
    soot: { type: 'color', default: '#0d0b0a', label: 'Soot colour' },
    char: { type: 'color', default: '#352e29', label: 'Char colour' },
  },
  build: (ctx, params) => {
    const point = centredPoint(ctx);
    const distance = length(point) as unknown as Node<'float'>;
    // Periodic around the centre (`streaks` cells over the angle's 0..1), slow out from it (long
    // streaks), sharpened
    const around = vec2(
      angleOf(point).mul(params.streaks),
      distance.mul(1.2)
    ) as unknown as Node<'vec2'>;
    const streak = smoothstep(
      0.3,
      0.7,
      toUnit(valueNoise(around, { period: [params.streaks, 4], seed: ctx.seed(1) }))
    ) as unknown as Node<'float'>;
    const soft = ctx.cells(6);
    const sootNoise = fbm(soft.p, { period: soft.period, octaves: 4, seed: ctx.seed(2) });
    const reach = params.radius.mul(
      float(1).sub(params.streakLength.mul(0.7).mul(float(1).sub(streak)))
    ) as unknown as Node<'float'>;
    const at = distance.add(sootNoise.mul(0.03)) as unknown as Node<'float'>;
    const burn = under(at, reach.mul(0.8), reach.mul(0.2));
    const core = under(at, reach.mul(0.3), reach.mul(0.3));
    const fine = ctx.cells(16);
    const grain = toUnit(fbm(fine.p, { period: fine.period, octaves: 3, seed: ctx.seed(3) }));

    return {
      // Soot along the streaks too, not only at the core
      albedo: mix(params.char, params.soot, core.max(streak.mul(0.6))) as unknown as Node<'vec3'>,
      opacity: burn
        .mul(params.intensity)
        .mul(grain.mul(0.25).add(0.75))
        .mul(edgeGuard(point)) as unknown as Node<'float'>,
      height: float(0.5) as unknown as Node<'float'>,
      roughness: float(0.95) as unknown as Node<'float'>,
      normal: vec3(0, 0, 1) as unknown as Node<'vec3'>,
    };
  },
});
