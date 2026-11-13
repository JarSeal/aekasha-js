// Small TSL helpers the toolkit's surface generators share (p304 D3).
import { float, fract, smoothstep } from 'three/tsl';
// The real generic `Node<T>` typings (the `three/tsl` `Node` is a loose local shim)
import type { Node } from 'three/webgpu';

/**
 * A −1..1 noise as 0..1.
 * @internal
 */
export const toUnit = (n: Node<'float'>) => n.mul(0.5).add(0.5) as Node<'float'>;

/**
 * Another random number in [0, 1) of the same cell, from its Worley `cellId` (`k` a constant of
 * its own per use, eg. 13.7): per-cell variation beyond the id.
 * @internal
 */
export const perCell = (cellId: Node<'float'>, k: number) =>
  fract(cellId.mul(k).add(k * 0.618)) as Node<'float'>;

/**
 * 1 below `edge − width`, 0 above `edge + width`, smooth between: a mask of the values under a
 * threshold (`smoothstep` takes its edges in order, so the inverse is spelled out).
 * @internal
 */
export const below = (value: Node<'float'>, edge: Node<'float'> | number, width: number) => {
  const at = (typeof edge === 'number' ? float(edge) : edge) as Node<'float'>;
  return float(1).sub(smoothstep(at.sub(width), at.add(width), value)) as unknown as Node<'float'>;
};
