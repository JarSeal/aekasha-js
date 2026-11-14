// The noise library's height helpers (p304 D2): a surface's normal and cavity (its AO) from its
// height function, evaluated around the point, so a bake writes a normal and an AO map from the
// same graph as its height. Each costs extra evaluations of the height (4 for the normal, 8 for the
// cavity): cheap in a bake, costly live, where a material's own derivatives (`bumpNormalView`) are
// the better normal.
import { float, vec2, vec3 } from 'three/tsl';
// The real generic `Node<T>` typings (the `three/tsl` `Node` is a loose local shim)
import type { Node } from 'three/webgpu';

/**
 * A surface's height at a point: a function that builds the height's graph for any uv (eg. an
 * `fbm` of it). Called once per tap, so it must build the same surface for every uv.
 */
export type HeightFunction = (uv: Node<'vec2'>) => Node<'float'>;

/** {@link heightToNormal}'s options. */
export type HeightToNormalOptions = {
  /** The point (a baked texture's `uv`). */
  uv: Node<'vec2'>;
  /** The step the differences take: a baked texture's texel (`BakeBuildContext.texel`), so the
   * normal resolves what the texture can. */
  texel: Node<'vec2'>;
  /** The relief's depth over the tile's width, for a height in 0..1: 0.02 makes a full step of
   * the height 2 % of the tile wide. A larger value is a steeper normal. */
  heightScale: number | Node<'float'>;
};

/** {@link heightToCavity}'s options. */
export type HeightToCavityOptions = {
  /** The point (a baked texture's `uv`). */
  uv: Node<'vec2'>;
  /** The ring's radius in uv: the size of the hollows that darken (a few texels for crevices, more
   * for broad dips). */
  radius: number | Node<'float'>;
  /** How dark a hollow gets: the occlusion is `(ring's mean height − height) × strength`, so 4
   * makes a hollow a quarter of the height range deep fully dark. Default 4. */
  strength?: number | Node<'float'>;
};

/** The cavity's ring: 8 directions, evenly spaced. */
const RING = Array.from({ length: 8 }, (_, i) => {
  const angle = (i / 8) * Math.PI * 2;
  return [Math.cos(angle), Math.sin(angle)] as const;
});

/**
 * A surface's tangent-space normal from its height, by central differences: the height at a step
 * either side of the point along u and v (4 evaluations). For a bake's normal map, written from the
 * same graph as its height.
 * @param height the height function (see {@link HeightFunction}), in 0..1 for `heightScale` to
 * read as a fraction of the tile
 * @param options the point, the step and the relief's depth
 * @returns the unit normal in tangent space (OpenGL, +Y along +v: a material samples it at the same
 * uv), in −1..1: `× 0.5 + 0.5` to store it
 * @remarks The baked texture's uv is the uv a material samples it at (`bakeTexture`'s orientation),
 * so the normal's Y follows v as `transformTangentNormalToView` expects. A periodic height keeps
 * the normal periodic: the taps past the tile's edge read the height's next repeat.
 * @example
 * ```ts
 * import { vec4 } from 'three/tsl';
 * import type { Node } from 'three/webgpu';
 * import { bakeTexture } from 'aekasha';
 * import { fbm, heightToNormal } from 'aekasha/toolkit/terrain';
 *
 * const height = (at: Node<'vec2'>) =>
 *   fbm(at.mul(6), { period: 6, octaves: 5, seed: 1 }).mul(0.5).add(0.5) as Node<'float'>;
 * await bakeTexture({
 *   id: 'bumps',
 *   size: 512,
 *   outputs: [{ name: 'normalHeight' }],
 *   build: ({ uv, texel }) => {
 *     const normal = heightToNormal(height, { uv, texel, heightScale: 0.03 });
 *     return { normalHeight: vec4(normal.xy.mul(0.5).add(0.5), height(uv), 1) };
 *   },
 * });
 * ```
 */
export const heightToNormal = (
  height: HeightFunction,
  options: HeightToNormalOptions
): Node<'vec3'> => {
  const { uv, texel, heightScale } = options;
  const du = vec2(texel.x, 0);
  const dv = vec2(0, texel.y);
  // The slopes over the tile (height per uv), × the relief's depth over the tile's width
  const slopeU = height(uv.add(du) as Node<'vec2'>)
    .sub(height(uv.sub(du) as Node<'vec2'>))
    .div(texel.x.mul(2));
  const slopeV = height(uv.add(dv) as Node<'vec2'>)
    .sub(height(uv.sub(dv) as Node<'vec2'>))
    .div(texel.y.mul(2));
  return vec3(
    slopeU.mul(heightScale).negate(),
    slopeV.mul(heightScale).negate(),
    1
  ).normalize() as Node<'vec3'>;
};

/**
 * A surface's cavity from its height: how far the point sits below the mean of a ring of 8 taps
 * around it, as an ambient occlusion (crevices and hollows dark, crests and flats open). For a
 * bake's AO, or to darken an albedo where dirt collects.
 * @param height the height function (see {@link HeightFunction})
 * @param options the point, the ring's radius and the strength
 * @returns the occlusion in 0..1: 1 open, 0 fully occluded
 * @remarks 9 evaluations of the height (the point and the ring): reuse the point's height node in
 * the graph where you can, and keep the ring a few texels wide. A periodic height keeps the cavity
 * periodic.
 * @example
 * ```ts
 * import { vec4 } from 'three/tsl';
 * import type { Node } from 'three/webgpu';
 * import { bakeTexture } from 'aekasha';
 * import { heightToCavity, worley } from 'aekasha/toolkit/terrain';
 *
 * // Pebbles: domes at each cell's point, dark where they meet
 * const height = (at: Node<'vec2'>) =>
 *   worley(at.mul(14), { period: 14, seed: 6 }).f1.oneMinus() as Node<'float'>;
 * await bakeTexture({
 *   id: 'pebbleAo',
 *   size: 512,
 *   outputs: [{ name: 'ao' }],
 *   build: ({ uv, texel }) => {
 *     const ao = heightToCavity(height, { uv, radius: texel.x.mul(6), strength: 3 });
 *     return { ao: vec4(ao, ao, ao, 1) };
 *   },
 * });
 * ```
 */
export const heightToCavity = (
  height: HeightFunction,
  options: HeightToCavityOptions
): Node<'float'> => {
  const { uv, radius, strength = 4 } = options;
  if (typeof radius === 'number' && !(radius > 0)) {
    throw new Error(`[heightToCavity] radius is ${radius}; it takes a number above 0 (in uv).`);
  }
  let ring: Node<'float'> = float(0) as unknown as Node<'float'>;
  for (const [x, y] of RING) {
    const tap = uv.add(vec2(x, y).mul(radius)) as Node<'vec2'>;
    ring = ring.add(height(tap)) as Node<'float'>;
  }
  const depth = ring.div(RING.length).sub(height(uv));
  return float(1).sub(depth.mul(strength).clamp(0, 1)) as Node<'float'>;
};
