// The noise library's periods (p304 D2): what a `period` option takes, its check, and the cell
// wrap every periodic function hashes through, so the noise and the hashes tile the same way.
import { floor, vec2 } from 'three/tsl';
// The real generic `Node<T>` typings (the `three/tsl` `Node` is a loose local shim)
import type { Node } from 'three/webgpu';

/**
 * A noise's period in cells: it repeats every `period` cells along x and y. A whole number for
 * both axes, a pair, or a vec2 node of whole numbers (a uniform a slider sets, without a rebuild).
 * 0, or left out, is no period: the noise never repeats (for world space).
 */
export type NoisePeriod = number | [number, number] | Node<'vec2'>;

/**
 * A period resolved at build time: none, or a vec2 node with its constant value when it has one.
 * @internal
 */
export type ResolvedPeriod = { node: Node<'vec2'>; constant: [number, number] | null } | null;

const isWholePeriod = (value: number) => Number.isInteger(value) && value >= 1;

/**
 * A period as a vec2 node, or null for none: checked here, since a period that isn't a whole
 * number would leave a seam.
 * @internal
 */
export const resolveNoisePeriod = (
  period: NoisePeriod | undefined,
  name: string
): ResolvedPeriod => {
  if (period === undefined || period === 0) return null;
  if (typeof period === 'number' || Array.isArray(period)) {
    const [x, y] = typeof period === 'number' ? [period, period] : period;
    if (x === 0 && y === 0) return null;
    if (!isWholePeriod(x) || !isWholePeriod(y)) {
      throw new Error(
        `[${name}] The period ${JSON.stringify(period)} isn't a whole number of cells (at least 1 on each axis, or 0 for none): the noise would show a seam where it repeats.`
      );
    }
    return { node: vec2(x, y) as unknown as Node<'vec2'>, constant: [x, y] };
  }
  return { node: period, constant: null };
};

/**
 * A cell wrapped into [0, period): `cell + 0.5` is never near a whole number of periods, so an
 * imprecise division (WGSL's 2.5 ULP) can't floor to the wrong one, as `mod` could.
 * @internal
 */
export const wrapCell = (cell: Node<'vec2'>, period: Node<'vec2'>): Node<'vec2'> =>
  cell.sub(period.mul(floor(cell.add(0.5).div(period)))) as Node<'vec2'>;
