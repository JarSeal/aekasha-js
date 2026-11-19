// The `decalLeafPatch` decal generator: fallen leaves in a patch (p309 Phase 1 named it for the
// ground atlas's `leafPatch`; D5's table lacked it). Two layers of a hashed grid, a leaf per cell
// (jittered, turned, sized and coloured by the cell's hashes), each an egg-shaped ellipse with a
// midrib and side veins, curled up at its edges; a cell keeps its leaf with a chance falling off
// towards the patch's edge, so no leaf is cut by it.
import { abs, float, floor, fract, length, max, mix, step, vec2 } from 'three/tsl';
// The real generic `Node<T>` typings (the `three/tsl` `Node` is a loose local shim)
import type { Node } from 'three/webgpu';
import { hash12, hash22 } from '../../nodes/noise/Hash';
import type { NoisePeriod } from '../../nodes/noise/Period';
import type { DecalBuildContext } from '../DecalGenerator';
import { defineDecalGenerator } from '../DecalGenerator';
import { centredPoint, edgeGuard, insideOf, rotatePoint, under } from './DecalShapes';

type Float = Node<'float'>;
type Vec3 = Node<'vec3'>;

/** One layer's leaves at the point: the leaf's coverage, colour, veins and curl. */
type LeafLayer = { leaf: Float; color: Vec3; veins: Float; curl: Float };

type LeafColors = { colorA: Vec3; colorB: Vec3; colorC: Vec3 };

/** A layer of leaves, a leaf per cell of a `count` grid shifted by `shift` cells. */
const leafLayer = (
  ctx: DecalBuildContext,
  opts: {
    count: number;
    shift: number;
    seedIndex: number;
    density: Float;
    radius: Float;
    colors: LeafColors;
  }
): LeafLayer => {
  const { count, shift, seedIndex, colors } = opts;
  const grid = ctx.cells(count);
  const period: NoisePeriod = grid.period;
  const p = grid.p.add(shift) as Node<'vec2'>;
  const cell = floor(p) as unknown as Node<'vec2'>;
  const jitter = hash22(cell, { seed: ctx.seed(seedIndex), period });
  const look = hash22(cell, { seed: ctx.seed(seedIndex + 1), period });
  const local = fract(p).sub(0.5).sub(jitter.sub(0.5).mul(0.3)) as Node<'vec2'>;
  const q = rotatePoint(local, look.x.mul(Math.PI * 2) as unknown as Float);
  const size = look.y.mul(0.3).add(0.7);
  const rx = size.mul(0.42);
  // Egg-shaped: wider at the stem (−x) than at the tip
  const ry = size.mul(0.17).mul(float(1).sub(q.x.div(rx).mul(0.35)));
  const distance = length(vec2(q.x.div(rx), q.y.div(ry)))
    .sub(1)
    .mul(ry) as unknown as Float;
  const inside = insideOf(distance, 0.02);
  // Kept by its cell's centre's distance from the patch's: every leaf whole
  const centre = cell.add(0.5).sub(shift).div(count).sub(0.5) as Node<'vec2'>;
  const chance = under(length(centre) as unknown as Float, opts.radius, 0.06).mul(opts.density);
  const keep = step(hash12(cell, { seed: ctx.seed(seedIndex + 2), period }), chance);
  const leaf = inside.mul(keep) as unknown as Float;
  const midrib = under(abs(q.y) as unknown as Float, 0.012, 0.006);
  const side = under(
    abs(fract(q.x.add(abs(q.y).mul(1.3)).mul(9)).sub(0.5)) as unknown as Float,
    0.07,
    0.04
  );
  const color = mix(
    mix(colors.colorA, colors.colorB, jitter.x),
    colors.colorC,
    look.y.mul(look.y)
  ) as unknown as Vec3;
  return {
    leaf,
    color,
    veins: max(midrib, side.mul(0.5)).mul(leaf) as unknown as Float,
    curl: abs(q.y).div(ry).clamp(0, 1).mul(leaf) as unknown as Float,
  };
};

/**
 * Fallen leaves over a patch `radius` decal widths from its centre: two layers of leaves about a
 * `cells`-th of the decal long, `density` of the cells holding one, coloured between `colorA`,
 * `colorB` and `colorC`, their veins darker.
 */
export const decalLeafPatch = defineDecalGenerator({
  id: 'decalLeafPatch',
  description:
    'Fallen leaves in a patch: two layers of veined, curled leaves, jittered, turned and coloured per leaf.',
  physicalSize: [1.5, 1.5],
  heightScale: 0.006,
  params: {
    cells: {
      default: 14,
      min: 4,
      max: 32,
      isStatic: true,
      isInteger: true,
      label: 'Leaves across',
    },
    density: { default: 0.8, min: 0, max: 1, step: 0.05, label: 'Density' },
    radius: { default: 0.36, min: 0.1, max: 0.4, step: 0.01, label: 'Patch radius' },
    roughness: { default: 0.65, min: 0, max: 1, step: 0.05, label: 'Roughness' },
    colorA: { type: 'color', default: '#8c4a1c', label: 'Colour A' },
    colorB: { type: 'color', default: '#b5852e', label: 'Colour B' },
    colorC: { type: 'color', default: '#4e3a20', label: 'Colour C' },
  },
  build: (ctx, params) => {
    const point = centredPoint(ctx);
    const colors = { colorA: params.colorA, colorB: params.colorB, colorC: params.colorC };
    const common = { count: params.cells, density: params.density, radius: params.radius, colors };
    const lower = leafLayer(ctx, { ...common, shift: 0, seedIndex: 1 });
    const over = leafLayer(ctx, { ...common, shift: 0.5, seedIndex: 4 });
    const leaf = max(lower.leaf, over.leaf) as unknown as Float;
    const veins = mix(lower.veins, over.veins, over.leaf);
    const color = mix(lower.color, over.color, over.leaf).mul(
      float(1).sub(veins.mul(0.25))
    ) as unknown as Vec3;
    // The upper layer lies on the lower one; each leaf curls up at its edges
    const height = float(0.5)
      .add(lower.leaf.mul(0.2).add(lower.curl.mul(0.15)))
      .add(over.leaf.mul(0.3).add(over.curl.mul(0.15))) as unknown as Float;

    return {
      albedo: color,
      opacity: leaf.mul(edgeGuard(point)) as unknown as Float,
      height,
      roughness: params.roughness,
    };
  },
});
