// The terrain material's sparse sampling (p305 D6): the layers weighing most at a pixel, sorted by
// weight, so a material samples a few slots at a per-pixel layer index (the `ARRAY` storage's
// `.depth(layer)`) instead of every layer. The selection is an insertion network of
// compare-exchanges, each result a var (an expression would be built once per path to it,
// exponential over the steps), written over its operations so its test runs it on numbers; a
// layer's uniforms are picked by the slot's layer with a `select` chain, so each stays the uniform
// the material editor edits.
import { float, int, max, min, select } from 'three/tsl';
// The real generic `Node<T>` typings (the `three/tsl` `Node` is a loose local shim)
import type { Node } from 'three/webgpu';

/** A slot: the layer kept there, and its weight (before the blend's normalization) */
export type KeptLayer = { layer: Node<'int'>; weight: Node<'float'> };

/**
 * The operations the selection network takes: TSL nodes in the graph, numbers in its test
 * @template W a weight
 * @template L a layer index
 * @template C a comparison's result
 * @internal
 */
export type TopLayerOps<W, L, C> = {
  isHeavier: (a: W, b: W) => C;
  /** `a` where the comparison holds, else `b` */
  pick: (is: C, a: L, b: L) => L;
  max: (a: W, b: W) => W;
  min: (a: W, b: W) => W;
  /** Keeps a step's result (a var), so later steps read it rather than rebuild it */
  keep: <T extends W | L>(value: T) => T;
};

/**
 * The `count` heaviest of the weighed layers, sorted from the heaviest: each layer is inserted
 * through the slots so far, a compare-exchange each (the lighter going on), the one past the last
 * slot dropped. Tied layers may come in any order (they weigh alike, so the blend is the same).
 * @template W a weight
 * @template L a layer index
 * @template C a comparison's result
 * @internal
 * @param layers each layer's index and weight, in the layers' order
 * @param count the slots
 * @param ops the comparison, the picks and how a step's result is kept
 */
export const insertTopLayers = <W, L, C>(
  layers: { layer: L; weight: W }[],
  count: number,
  ops: TopLayerOps<W, L, C>
) => {
  const slots: { layer: L; weight: W }[] = [];
  for (let candidate of layers) {
    for (let s = 0; s < slots.length; s++) {
      const slot = slots[s];
      const isHeavier = ops.isHeavier(candidate.weight, slot.weight);
      slots[s] = {
        layer: ops.keep(ops.pick(isHeavier, candidate.layer, slot.layer)),
        weight: ops.keep(ops.max(candidate.weight, slot.weight)),
      };
      candidate = {
        layer: ops.keep(ops.pick(isHeavier, slot.layer, candidate.layer)),
        weight: ops.keep(ops.min(candidate.weight, slot.weight)),
      };
    }
    if (slots.length < count) slots.push(candidate);
  }
  return slots;
};

/** The network's operations on TSL nodes, each step's result a var */
const NODE_OPS: TopLayerOps<Node<'float'>, Node<'int'>, Node<'bool'>> = {
  isHeavier: (a, b) => a.greaterThan(b) as unknown as Node<'bool'>,
  pick: (is, a, b) => select(is, a, b) as unknown as Node<'int'>,
  max: (a, b) => max(a, b) as unknown as Node<'float'>,
  min: (a, b) => min(a, b) as unknown as Node<'float'>,
  keep: (value) => (value as unknown as { toVar: () => typeof value }).toVar(),
};

/**
 * The `count` layers weighing most at the pixel, sorted from the heaviest (tied layers in any
 * order): `insertTopLayers` on the weights' nodes.
 * @internal
 * @param weights each layer's weight, in the layers' order
 * @param count the slots, at most the layers
 */
export const selectTopLayers = (weights: Node<'float'>[], count: number): KeptLayer[] =>
  insertTopLayers(
    weights.map((weight, i) => ({ layer: int(i) as unknown as Node<'int'>, weight })),
    count,
    NODE_OPS
  );

/**
 * A value of the layer a slot keeps, from one value per layer: a `select` chain on the layer's
 * index (the values stay the nodes they are, eg. the layers' uniforms).
 * @internal
 * @param layer the slot's layer
 * @param values one per layer, in the layers' order
 */
export const pickByLayer = <T>(layer: Node<'int'>, values: T[]): T =>
  values
    .slice(0, -1)
    .reduceRight<T>(
      (rest, value, i) => select(layer.equal(i), value as never, rest as never) as unknown as T,
      values[values.length - 1]
    );

/**
 * Each layer's weight from the slots' (a layer no slot keeps weighs 0): the debug views read the
 * weights per layer.
 * @internal
 * @param slots the slots' layers
 * @param weights each slot's final weight
 * @param layerCount the material's layers
 */
export const spreadSlotWeights = (
  slots: KeptLayer[],
  weights: Node<'float'>[],
  layerCount: number
): Node<'float'>[] =>
  Array.from({ length: layerCount }, (_, i) =>
    slots.reduce(
      (sum, slot, s) =>
        sum.add(select(slot.layer.equal(i), weights[s], float(0))) as unknown as Node<'float'>,
      float(0) as unknown as Node<'float'>
    )
  );
