// Small TSL helpers the procedural decal generators share (p309 D5): the point centred on the
// decal, 2D signed distances (negative inside, in the point's units), their soft masks, and the
// guard that keeps every decal transparent at its cell's edge.
import { atan, clamp, cos, dot, float, length, min, mix, sin, smoothstep, vec2 } from 'three/tsl';
// The real generic `Node<T>` typings (the `three/tsl` `Node` is a loose local shim)
import type { Node } from 'three/webgpu';
import type { DecalBuildContext } from '../DecalGenerator';

type Float = Node<'float'>;
type Vec2 = Node<'vec2'>;
type Pair = readonly [number, number];

/**
 * The point from the decal's centre in decal widths: x across, y up the decal (its v), −0.5..0.5
 * at its edges.
 * @internal
 */
export const centredPoint = (ctx: DecalBuildContext) => ctx.uv.sub(0.5) as Vec2;

/**
 * 1 where `value` is under `edge − width`, 0 over `edge + width`, smooth between (`smoothstep`
 * takes its edges in order, so the inverse is spelled out).
 * @internal
 */
export const under = (value: Float, edge: number | Float, width: number | Float): Float => {
  const at = (typeof edge === 'number' ? float(edge) : edge) as Float;
  return float(1).sub(smoothstep(at.sub(width), at.add(width), value)) as unknown as Float;
};

/**
 * 1 inside a shape (its signed distance under 0), 0 outside, soft over `soft` either side.
 * @internal
 */
export const insideOf = (distance: Float, soft: number | Float) => under(distance, 0, soft);

/**
 * The guard every decal's opacity is multiplied by: 1 within `inner` decal widths of its centre,
 * 0 from 0.5 (the cell's edge) out, so the atlas's padding stays transparent whatever the noise.
 * @internal
 */
export const edgeGuard = (point: Vec2, inner = 0.44): Float =>
  float(1).sub(smoothstep(inner, 0.5, length(point))) as unknown as Float;

/**
 * The same for a decal that fills its square (a wall's marks): 1 from `width` decal widths in
 * from every edge, 0 at the edges.
 * @internal
 */
export const boxEdgeGuard = (point: Vec2, width: number | Float): Float => {
  const fromEdge = float(0.5).sub(point.abs().x.max(point.abs().y)) as unknown as Float;
  return smoothstep(0, width, fromEdge) as unknown as Float;
};

/**
 * The angle around the decal's centre, 0..1 from −x counter-clockwise (seamless where it wraps:
 * × a whole number of cells, with that period).
 * @internal
 */
export const angleOf = (point: Vec2): Float =>
  atan(point.y, point.x)
    .div(Math.PI * 2)
    .add(0.5) as unknown as Float;

/**
 * An ellipse's signed distance, approximate (exact on a circle): centre `c`, radii `r`.
 * @internal
 */
export const sdEllipse = (point: Vec2, c: Pair, r: Pair): Float =>
  length(point.sub(vec2(c[0], c[1])).div(vec2(r[0], r[1])))
    .sub(1)
    .mul(Math.min(r[0], r[1])) as unknown as Float;

/**
 * A capsule's signed distance: the segment `a`–`b` grown by `radius`.
 * @internal
 */
export const sdCapsule = (point: Vec2, a: Pair, b: Pair, radius: number): Float => {
  const pa = point.sub(vec2(a[0], a[1])) as Vec2;
  const ba = vec2(b[0] - a[0], b[1] - a[1]) as unknown as Vec2;
  const h = clamp(dot(pa, ba).div(dot(ba, ba)), 0, 1);
  return length(pa.sub(ba.mul(h))).sub(radius) as unknown as Float;
};

/**
 * Two shapes' smooth union (a polynomial smooth minimum), their seam rounded over `k`.
 * @internal
 */
export const smoothUnion = (a: Float, b: Float, k: number): Float => {
  const h = clamp(b.sub(a).div(k).mul(0.5).add(0.5), 0, 1);
  return mix(b, a, h).sub(h.mul(float(1).sub(h)).mul(k)) as unknown as Float;
};

/**
 * Several shapes' union (the nearest one's distance).
 * @internal
 */
export const union = (...distances: Float[]): Float =>
  distances.reduce((all, d) => min(all, d) as unknown as Float);

/**
 * The point turned by `angle` radians, counter-clockwise (a number or a node).
 * @internal
 */
export const rotatePoint = (point: Vec2, angle: number | Float): Vec2 => {
  const c = typeof angle === 'number' ? float(Math.cos(angle)) : cos(angle);
  const s = typeof angle === 'number' ? float(Math.sin(angle)) : sin(angle);
  return vec2(
    point.x.mul(c).sub(point.y.mul(s)),
    point.x.mul(s).add(point.y.mul(c))
  ) as unknown as Vec2;
};
