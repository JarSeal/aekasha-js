// The `decalFormwork` decal generator: the marks formwork leaves on cast concrete (p309 Phase 1
// named it for the structure atlas's `formworkMarks`; D5's table lacked it). Horizontal boards,
// each a step proud of the last and a tone of its own, a fin of concrete along each seam, a faint
// wood grain, and tie holes in rows between the seams. The marks fill the decal's square and fade
// out irregularly before its edges.
import { float, floor, fract, length, min, mix, vec2 } from 'three/tsl';
// The real generic `Node<T>` typings (the `three/tsl` `Node` is a loose local shim)
import type { Node } from 'three/webgpu';
import { hash12 } from '../../nodes/noise/Hash';
import { fbm, valueNoise } from '../../nodes/noise/Noise';
import { toUnit } from '../../procedural/SurfaceNodes';
import { defineDecalGenerator } from '../DecalGenerator';
import { boxEdgeGuard, centredPoint, insideOf, under } from './DecalShapes';

type Float = Node<'float'>;

/** The grain's streaks along a board, and across one. */
const GRAIN_ALONG = 3;
const GRAIN_ACROSS = 14;

/**
 * Formwork marks over the whole decal: `boards` boards up it, each up to `step` proud of the next
 * and its own tone, a `seam` wide fin along each seam (`seamColor`), wood grain at `grain`, and
 * tie holes (`holeColor`, `holeRadius` decal widths) `holesAcross` to a row, `holeRows` rows, all
 * fading out over `fade` of the decal at its edges, `strength` opaque.
 */
export const decalFormwork = defineDecalGenerator({
  id: 'decalFormwork',
  description:
    "Formwork marks on cast concrete: board steps and tones, fins along the seams, faint wood grain and tie holes, fading out before the decal's edges.",
  physicalSize: [2, 2],
  heightScale: 0.006,
  params: {
    boards: { default: 8, min: 2, max: 24, isStatic: true, isInteger: true, label: 'Boards' },
    holesAcross: {
      default: 3,
      min: 1,
      max: 8,
      isStatic: true,
      isInteger: true,
      label: 'Tie holes a row',
    },
    holeRows: { default: 2, min: 1, max: 8, isStatic: true, isInteger: true, label: 'Hole rows' },
    seam: { default: 0.004, min: 0.001, max: 0.02, step: 0.0005, label: 'Seam width' },
    step: { default: 0.4, min: 0, max: 1, step: 0.05, label: 'Board step' },
    grain: { default: 0.4, min: 0, max: 1, step: 0.05, label: 'Wood grain' },
    holeRadius: { default: 0.012, min: 0.004, max: 0.03, step: 0.001, label: 'Hole radius' },
    fade: { default: 0.15, min: 0.02, max: 0.4, step: 0.01, label: 'Edge fade' },
    strength: { default: 0.7, min: 0, max: 1, step: 0.05, label: 'Strength' },
    tone: { type: 'color', default: '#7a7771', label: 'Concrete colour' },
    seamColor: { type: 'color', default: '#4b4945', label: 'Seam colour' },
    holeColor: { type: 'color', default: '#2b2a28', label: 'Hole colour' },
  },
  build: (ctx, params) => {
    const point = centredPoint(ctx);
    const { uv } = ctx;
    const along = uv.y.mul(params.boards) as unknown as Float;
    const board = floor(along);
    const inBoard = fract(along);
    // The distance to the nearest seam, in decal widths
    const fromSeam = min(inBoard, float(1).sub(inBoard)).div(params.boards) as unknown as Float;
    const seam = under(fromSeam, params.seam.mul(0.75), params.seam.mul(0.25));
    // Each board's own step and tone, -0.5..0.5
    const boardHash = hash12(vec2(float(0), board) as unknown as Node<'vec2'>, {
      seed: ctx.seed(1),
      period: [1, params.boards],
    }).sub(0.5) as unknown as Float;
    const grainAt = vec2(
      uv.x.mul(GRAIN_ALONG),
      uv.y.mul(params.boards * GRAIN_ACROSS)
    ) as unknown as Node<'vec2'>;
    const grain = toUnit(
      valueNoise(grainAt, {
        period: [GRAIN_ALONG, params.boards * GRAIN_ACROSS],
        seed: ctx.seed(2),
      })
    ).mul(params.grain) as unknown as Float;
    // The holes: a row between seams (half a board up), `holesAcross` to a row
    const holeCells = vec2(
      uv.x.mul(params.holesAcross),
      uv.y.sub(0.5 / params.boards).mul(params.holeRows)
    );
    const holeLocal = fract(holeCells)
      .sub(0.5)
      .div(vec2(params.holesAcross, params.holeRows)) as unknown as Node<'vec2'>;
    const hole = insideOf(length(holeLocal).sub(params.holeRadius) as unknown as Float, 0.002);
    // The marks fade out before the edges, irregularly
    const breakup = ctx.cells(4);
    const ragged = toUnit(
      fbm(breakup.p, { period: breakup.period, octaves: 3, seed: ctx.seed(3) })
    );
    const fade = boxEdgeGuard(point, params.fade).mul(ragged.mul(0.4).add(0.6));
    const marks = seam
      .mul(0.9)
      .add(grain.mul(0.35))
      .add(boardHash.abs().mul(0.5))
      .add(hole)
      .clamp(0, 1);

    const albedo = mix(
      mix(params.tone.mul(boardHash.mul(0.2).add(1)), params.seamColor, seam),
      params.holeColor,
      hole
    );
    return {
      albedo: albedo as unknown as Node<'vec3'>,
      opacity: marks.mul(fade).mul(params.strength) as unknown as Float,
      height: float(0.5)
        .add(boardHash.mul(params.step).mul(0.3))
        .add(grain.mul(0.08))
        .add(seam.mul(0.2))
        .sub(hole.mul(0.45)) as unknown as Float,
      roughness: mix(float(0.85), float(0.92), hole) as unknown as Float,
    };
  },
});
