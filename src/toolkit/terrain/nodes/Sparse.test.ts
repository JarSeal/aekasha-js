import { describe, expect, it } from 'vitest';
import { float, int } from 'three/tsl';
import type { Node } from 'three/webgpu';
import {
  insertTopLayers,
  pickByLayer,
  selectTopLayers,
  spreadSlotWeights,
  type TopLayerOps,
} from './Sparse';

/** The network on numbers */
const NUMBER_OPS: TopLayerOps<number, number, boolean> = {
  isHeavier: (a, b) => a > b,
  pick: (is, a, b) => (is ? a : b),
  max: Math.max,
  min: Math.min,
  keep: (value) => value,
};

const topOf = (weights: number[], count: number) =>
  insertTopLayers(
    weights.map((weight, layer) => ({ layer, weight })),
    count,
    NUMBER_OPS
  );

/** The reference: a stable sort by weight, heaviest first */
const sortTop = (weights: number[], count: number) =>
  weights
    .map((weight, layer) => ({ layer, weight }))
    .sort((a, b) => b.weight - a.weight || a.layer - b.layer)
    .slice(0, count);

/** A seeded stream of numbers in [0, 1) (mulberry32) */
const createRandom = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

describe('insertTopLayers', () => {
  it('keeps the heaviest layers sorted, as many as there are slots', () => {
    expect(topOf([0.1, 0.5, 0.2, 0.3], 2)).toEqual([
      { layer: 1, weight: 0.5 },
      { layer: 3, weight: 0.3 },
    ]);
    expect(topOf([0.3, 0.7], 4)).toEqual([
      { layer: 1, weight: 0.7 },
      { layer: 0, weight: 0.3 },
    ]);
  });

  it('agrees with a sort on random weights, few of them non-zero as on a terrain', () => {
    const random = createRandom(305);
    for (let run = 0; run < 2000; run++) {
      const count = 2 + Math.floor(random() * 15);
      const weights = Array.from({ length: count }, () =>
        random() < 0.6 ? 0 : Math.round(random() * 8) / 8
      );
      const kept = 2 + Math.floor(random() * 3);
      const top = topOf(weights, kept);
      const message = JSON.stringify(weights);
      // The weights the sort keeps, each slot a distinct layer of its weight (ties in any order)
      expect(
        top.map((slot) => slot.weight),
        message
      ).toEqual(sortTop(weights, kept).map((slot) => slot.weight));
      expect(new Set(top.map((slot) => slot.layer)).size, message).toBe(top.length);
      for (const slot of top) expect(weights[slot.layer], message).toBe(slot.weight);
    }
  });
});

describe('selectTopLayers', () => {
  it('makes a var of every step, the slots as many as asked', () => {
    const weights = Array.from({ length: 5 }, (_, i) => float(i) as unknown as Node<'float'>);
    const slots = selectTopLayers(weights, 3);
    expect(slots).toHaveLength(3);
    for (const { layer, weight } of slots) {
      expect((layer as unknown as { isVarNode?: boolean }).isVarNode).toBe(true);
      expect((weight as unknown as { isVarNode?: boolean }).isVarNode).toBe(true);
    }
  });
});

describe('pickByLayer', () => {
  it("chains a select per layer but the last, which is the chain's end", () => {
    const values = [float(1), float(2), float(3)];
    const picked = pickByLayer(int(2) as unknown as Node<'int'>, values) as unknown as {
      condNode: unknown;
      ifNode: unknown;
      elseNode: { ifNode: unknown; elseNode: unknown };
    };
    expect(picked.ifNode).toBe(values[0]);
    expect(picked.elseNode.ifNode).toBe(values[1]);
    expect(picked.elseNode.elseNode).toBe(values[2]);
    expect(pickByLayer(int(0) as unknown as Node<'int'>, [values[0]])).toBe(values[0]);
  });
});

describe('spreadSlotWeights', () => {
  it('gives each layer a sum over the slots', () => {
    const slots = selectTopLayers(
      [float(0.2), float(0.5), float(0.3)] as unknown as Node<'float'>[],
      2
    );
    const weights = spreadSlotWeights(
      slots,
      slots.map((slot) => slot.weight),
      3
    );
    expect(weights).toHaveLength(3);
  });
});
