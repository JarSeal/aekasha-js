// The `decalFootprint` decal generator (p309 D5): a print pressed into soft ground, its toe up the
// decal (+v). The shape is a signed distance (`shape`: a boot's sole, a bare foot, a dog's paw, a
// snow boot's sole), pressed deepest where the weight goes (the heel and the ball, the pads), its
// tread's lugs deeper still, the ground it pushed aside a rim around it. The normal comes from that
// height, so a print shows by its shading; the puddle mask is its depressions (not in snow), so
// the surface conditions' puddles fill the heel and the toe first.
import { abs, float, fract, length, max, mix, smoothstep, vec2 } from 'three/tsl';
// The real generic `Node<T>` typings (the `three/tsl` `Node` is a loose local shim)
import type { Node } from 'three/webgpu';
import { fbm } from '../../nodes/noise/Noise';
import { toUnit } from '../../procedural/SurfaceNodes';
import { defineDecalGenerator } from '../DecalGenerator';
import {
  centredPoint,
  edgeGuard,
  insideOf,
  sdCapsule,
  sdEllipse,
  smoothUnion,
  under,
  union,
} from './DecalShapes';

type Float = Node<'float'>;
type Vec2 = Node<'vec2'>;

/** The shapes, each a print's signed distance (decal widths), where it presses, and its lugs. */
type Print = { distance: Float; pressure: Float; lugs: Float };

/** 1 at a point, 0 from `radius` out: where a print presses deepest. */
const pressedAt = (point: Vec2, c: readonly [number, number], radius: number) =>
  under(length(point.sub(vec2(c[0], c[1]))) as unknown as Float, radius * 0.5, radius * 0.5);

/** 0 under `edge − width`, 1 over `edge + width`. */
const smoothStepAt = (value: Float, edge: number, width: number) =>
  smoothstep(edge - width, edge + width, value) as unknown as Float;

/** A boot's sole: a forefoot and a heel joined at the waist; chevron lugs ahead, bars at the heel. */
const bootPrint = (point: Vec2): Print => {
  const distance = smoothUnion(
    sdEllipse(point, [0, 0.13], [0.145, 0.19]),
    sdEllipse(point, [0, -0.25], [0.11, 0.125]),
    0.1
  );
  const pressure = max(pressedAt(point, [0, -0.25], 0.12), pressedAt(point, [0, 0.16], 0.16));
  const chevron = abs(fract(point.y.mul(16).sub(abs(point.x).mul(4))).sub(0.5));
  const bar = abs(fract(point.y.mul(18)).sub(0.5));
  // Chevrons ahead of the waist, bars behind it, none across it
  const ahead = smoothStepAt(point.y, -0.1, 0.02);
  const behind = float(1).sub(smoothStepAt(point.y, -0.16, 0.02));
  const lugs = under(chevron as unknown as Float, 0.2, 0.05)
    .mul(ahead)
    .add(under(bar as unknown as Float, 0.22, 0.05).mul(behind)) as unknown as Float;
  return { distance, pressure, lugs };
};

/** A snow boot's sole: a boot's, a little wider, with round square lugs on a grid. */
const snowBootPrint = (point: Vec2): Print => {
  const distance = smoothUnion(
    sdEllipse(point, [0, 0.13], [0.155, 0.195]),
    sdEllipse(point, [0, -0.25], [0.12, 0.13]),
    0.1
  );
  const pressure = max(pressedAt(point, [0, -0.25], 0.12), pressedAt(point, [0, 0.16], 0.16));
  const local = abs(fract(point.mul(vec2(9, 11))).sub(0.5));
  const lugs = under(max(local.x, local.y) as unknown as Float, 0.27, 0.06);
  return { distance, pressure, lugs };
};

/** A bare (left) foot: heel, outer edge and ball joined, the big toe and four others apart. */
const barePrint = (point: Vec2): Print => {
  const sole = smoothUnion(
    smoothUnion(
      sdEllipse(point, [0.02, -0.27], [0.09, 0.11]),
      sdCapsule(point, [0.06, -0.2], [0.07, 0.08], 0.045),
      0.06
    ),
    sdEllipse(point, [-0.01, 0.12], [0.13, 0.085]),
    0.06
  );
  const toes = union(
    sdEllipse(point, [-0.085, 0.29], [0.05, 0.06]),
    sdEllipse(point, [-0.01, 0.305], [0.034, 0.038]),
    sdEllipse(point, [0.045, 0.285], [0.03, 0.034]),
    sdEllipse(point, [0.09, 0.255], [0.027, 0.03]),
    sdEllipse(point, [0.125, 0.215], [0.024, 0.027])
  );
  const distance = union(sole, toes);
  const pressure = max(
    max(pressedAt(point, [0.02, -0.27], 0.12), pressedAt(point, [-0.02, 0.12], 0.14)),
    under(toes, -0.01, 0.01)
  ) as unknown as Float;
  return { distance, pressure, lugs: float(0) as unknown as Float };
};

/** A dog's paw: the main pad (three circles' smooth union), four toe pads and their claws. */
const pawPrint = (point: Vec2): Print => {
  const pad = smoothUnion(
    smoothUnion(
      sdEllipse(point, [0, -0.17], [0.16, 0.15]),
      sdEllipse(point, [-0.11, -0.09], [0.09, 0.09]),
      0.08
    ),
    sdEllipse(point, [0.11, -0.09], [0.09, 0.09]),
    0.08
  );
  const toes = union(
    sdEllipse(point, [-0.23, 0.09], [0.07, 0.085]),
    sdEllipse(point, [-0.08, 0.24], [0.075, 0.095]),
    sdEllipse(point, [0.08, 0.24], [0.075, 0.095]),
    sdEllipse(point, [0.23, 0.09], [0.07, 0.085])
  );
  const claws = union(
    sdEllipse(point, [-0.27, 0.22], [0.018, 0.025]),
    sdEllipse(point, [-0.095, 0.375], [0.018, 0.025]),
    sdEllipse(point, [0.095, 0.375], [0.018, 0.025]),
    sdEllipse(point, [0.27, 0.22], [0.018, 0.025])
  );
  const distance = union(pad, toes, claws);
  const pressure = max(pressedAt(point, [0, -0.15], 0.16), under(toes, -0.02, 0.02));
  return { distance, pressure: pressure as unknown as Float, lugs: float(0) as unknown as Float };
};

const PRINTS = { BOOT: bootPrint, BARE: barePrint, PAW: pawPrint, SNOW_BOOT: snowBootPrint };

/**
 * A footprint of `shape` (`BOOT`, `BARE`, a left foot, `PAW`, `SNOW_BOOT`), its toe up the decal,
 * pressed `depth` deep (deepest at the heel and ball), its lugs `tread` deeper, a `rim` of pushed
 * ground around it. In mud (`mud`, `mudRim`) its puddle mask (`puddle`) is its depressions; a
 * `SNOW_BOOT` print is snow (`snow`, `snowPacked`) and holds no water.
 */
export const decalFootprint = defineDecalGenerator({
  id: 'decalFootprint',
  description:
    'A print pressed into soft ground (a boot, a bare foot, a paw, a snow boot): deepest at the heel and ball, its tread deeper, a rim of pushed ground, its depressions a puddle mask.',
  physicalSize: [0.35, 0.35],
  heightScale: 0.05,
  params: {
    shape: {
      type: 'choice',
      options: ['BOOT', 'BARE', 'PAW', 'SNOW_BOOT'],
      default: 'BOOT',
      label: 'Shape',
    },
    depth: { default: 0.6, min: 0, max: 1, step: 0.05, label: 'Depth' },
    tread: { default: 0.6, min: 0, max: 1, step: 0.05, label: 'Tread depth' },
    rim: { default: 0.5, min: 0, max: 1, step: 0.05, label: 'Rim' },
    puddle: { default: 0.9, min: 0, max: 1, step: 0.05, label: 'Puddle mask' },
    mud: { type: 'color', default: '#33261b', label: 'Mud colour (in the print)' },
    mudRim: { type: 'color', default: '#57442f', label: 'Mud colour (the rim)' },
    snow: { type: 'color', default: '#f0f4f9', label: 'Snow colour (the rim)' },
    snowPacked: { type: 'color', default: '#cfdbe6', label: 'Snow colour (in the print)' },
  },
  build: (ctx, params) => {
    const point = centredPoint(ctx);
    const isSnow = params.shape === 'SNOW_BOOT';
    const { distance, pressure, lugs } = PRINTS[params.shape](point);
    const inside = insideOf(distance, 0.012);
    // The pushed ground: a band just outside the print
    const rim = under(distance, 0.035, 0.03).mul(smoothstep(-0.01, 0.01, distance));
    const fine = ctx.cells(10);
    const grain = toUnit(fbm(fine.p, { period: fine.period, octaves: 3, seed: ctx.seed(1) }));
    const press = inside.mul(params.depth).mul(pressure.mul(0.25).add(0.4));
    const height = float(0.5)
      .add(rim.mul(params.rim).mul(0.15))
      .sub(press)
      .sub(inside.mul(lugs).mul(params.tread).mul(0.15))
      .add(grain.mul(0.02)) as unknown as Float;
    const puddle = isSnow
      ? (float(0) as unknown as Float)
      : (inside
          .mul(mix(float(0.3), float(1), pressure).add(lugs.mul(0.3)))
          .clamp(0, 1)
          .mul(params.puddle) as unknown as Float);
    const albedo = isSnow
      ? mix(params.snow, params.snowPacked, inside)
      : mix(params.mudRim, params.mud, inside);
    const roughness = isSnow
      ? mix(float(0.75), float(0.55), inside)
      : mix(float(0.85), float(0.5), inside);

    return {
      albedo: albedo as unknown as Node<'vec3'>,
      // The print and its rim; the ground shows through more on the rim
      opacity: under(distance, 0.05, 0.04)
        .mul(inside.mul(0.4).add(0.6))
        .mul(edgeGuard(point)) as unknown as Float,
      height,
      roughness: roughness as unknown as Float,
      puddle,
    };
  },
});
