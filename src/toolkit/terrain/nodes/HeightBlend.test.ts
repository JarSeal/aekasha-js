import { describe, expect, it } from 'vitest';
import { float, uniform } from 'three/tsl';
import type { Node } from 'three/webgpu';
import { blendWeightsByHeight, getBlendHeight, normalizeWeights } from './HeightBlend';

type EvalNode = {
  value?: unknown;
  op?: string;
  method?: string;
  aNode?: EvalNode;
  bNode?: EvalNode;
};

/**
 * A float graph of constants and uniforms through the operators and the `max` the blend uses,
 * evaluated in JS (no GPU): the formula's numbers, not only its shape
 */
const evaluate = (node: unknown): number => {
  const n = node as EvalNode;
  if (typeof n.value === 'number') return n.value;
  const a = evaluate(n.aNode);
  const b = evaluate(n.bNode);
  const op = n.op ?? n.method;
  if (op === '+') return a + b;
  if (op === '-') return a - b;
  if (op === '*') return a * b;
  if (op === '/') return a / b;
  if (op === 'max') return Math.max(a, b);
  throw new Error(`Can't evaluate "${String(op)}"`);
};

const floats = (values: number[]) => values.map((v) => float(v) as unknown as Node<'float'>);
const blend = (weights: number[], heights: number[], depth = 0.2) =>
  blendWeightsByHeight(
    floats(weights),
    floats(heights),
    uniform(depth) as unknown as Node<'float'>
  ).map(evaluate);

describe('normalizeWeights', () => {
  it('divides by the sum, safely', () => {
    const weights = normalizeWeights(floats([1, 3])).map(evaluate);
    expect(weights).toEqual([0.25, 0.75]);
    expect(normalizeWeights(floats([0, 0])).map(evaluate)).toEqual([0, 0]);
  });
});

describe('getBlendHeight', () => {
  it('scales the height about its middle and adds the offset', () => {
    const height = (h: number, contrast: number, offset: number) =>
      evaluate(
        getBlendHeight(
          ...(floats([h, contrast, offset]) as [Node<'float'>, Node<'float'>, Node<'float'>])
        )
      );
    expect(height(0.5, 3, 0)).toBeCloseTo(0.5);
    expect(height(0.75, 2, 0)).toBeCloseTo(1);
    expect(height(0.25, 2, 0.1)).toBeCloseTo(0.1);
  });
});

describe('blendWeightsByHeight', () => {
  it('sums to 1, the higher layer taking an even border', () => {
    const [low, high] = blend([0.5, 0.5], [0.2, 0.9]);
    expect(low + high).toBeCloseTo(1);
    // 0.9 + 0.5 is 0.5 over the other's peak: past the 0.2 depth, the high layer has it all
    expect(high).toBeCloseTo(1, 3);
  });

  it('shares a border within the depth', () => {
    const [a, b] = blend([0.5, 0.5], [0.5, 0.6]);
    expect(a + b).toBeCloseTo(1);
    // Peaks 1.0 and 1.1, top 0.9: shares 0.1 and 0.2 × the equal weights
    expect(a).toBeCloseTo(1 / 3, 3);
    expect(b).toBeCloseTo(2 / 3, 3);
  });

  it('keeps an unpainted layer out however high it is', () => {
    const [painted, unpainted] = blend([0.8, 0], [0, 1]);
    expect(unpainted).toBe(0);
    expect(painted).toBeCloseTo(1);
  });

  it('falls back to the weights when the top layer is unpainted and the rest under it', () => {
    const weights = blend([0.3, 0.2, 0], [0, 0, 1]);
    expect(weights[0]).toBeCloseTo(0.6, 3);
    expect(weights[1]).toBeCloseTo(0.4, 3);
    expect(weights[2]).toBe(0);
  });

  it('reads the depth from its uniform', () => {
    const depth = uniform(0.2);
    const nodes = blendWeightsByHeight(
      floats([0.5, 0.5]),
      floats([0.5, 0.6]),
      depth as unknown as Node<'float'>
    );
    depth.value = 0.02;
    // Peaks 1.0 and 1.1, top 1.08: only the higher layer is within the depth
    expect(evaluate(nodes[1])).toBeCloseTo(1, 3);
  });
});
