import { describe, expect, it } from 'vitest';
import { uniform, vec2 } from 'three/tsl';
import { Vector2, type Node } from 'three/webgpu';
import { domainWarp, fbm, getOctavePeriods, gradientNoise, valueNoise } from './Noise';

type CallNode = {
  isShaderCallNodeInternal: true;
  shaderNode: { layout: { name: string; inputs: { name: string }[] } };
  rawInputs: unknown[];
};

/** Every layout function call in a graph, in the order the walk finds them */
const findCalls = (node: unknown): CallNode[] => {
  const calls: CallNode[] = [];
  const seen = new Set<unknown>();
  const walk = (value: unknown) => {
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    if ((value as CallNode).isShaderCallNodeInternal) calls.push(value as CallNode);
    for (const [key, child] of Object.entries(value)) {
      // The function's own body isn't the graph's
      if (key === 'shaderNode' || key === 'parents') continue;
      if (Array.isArray(child)) child.forEach(walk);
      else walk(child);
    }
  };
  walk(node);
  return calls;
};

const callNames = (node: unknown) => findCalls(node).map((call) => call.shaderNode.layout.name);

/** A periodic call's period, when it's a constant vec2 */
const constantPeriod = (call: CallNode) => {
  const index = call.shaderNode.layout.inputs.findIndex((input) => input.name === 'period');
  const period = call.rawInputs[index] as { value?: Vector2 };
  return period.value ? [period.value.x, period.value.y] : null;
};

const p = vec2(0.25, 0.75) as unknown as Node<'vec2'>;

describe('getOctavePeriods', () => {
  it('doubles the period per octave at lacunarity 2', () => {
    expect(getOctavePeriods(4, 5, 2)).toEqual([4, 8, 16, 32, 64]);
  });

  it('rounds each octave to a whole number at any lacunarity, at least 1', () => {
    expect(getOctavePeriods(4, 4, 2.5)).toEqual([4, 10, 25, 63]);
    expect(getOctavePeriods(1, 3, 1.3)).toEqual([1, 1, 2]);
  });
});

describe('value and gradient noise', () => {
  it('call the plain function without a period, the periodic one with', () => {
    expect(callNames(valueNoise(p))[0]).toBe('aekValueNoise');
    expect(callNames(gradientNoise(p, { seed: 2 }))[0]).toBe('aekGradientNoise');
    const periodic = findCalls(valueNoise(p, { period: [3, 5] }))[0];
    expect(periodic.shaderNode.layout.name).toBe('aekValueNoisePeriodic');
    expect(constantPeriod(periodic)).toEqual([3, 5]);
    expect(callNames(gradientNoise(p, { period: 4 }))[0]).toBe('aekGradientNoisePeriodic');
  });
});

describe('fbm', () => {
  it('calls the noise once per octave, each periodic octave at its own whole period', () => {
    const calls = findCalls(fbm(p, { period: 4, octaves: 3, lacunarity: 2.5 })).filter(
      (call) => call.shaderNode.layout.name === 'aekGradientNoisePeriodic'
    );
    const periods = calls.map(constantPeriod).sort((a, b) => (a?.[0] ?? 0) - (b?.[0] ?? 0));
    expect(periods).toEqual([
      [4, 4],
      [10, 10],
      [25, 25],
    ]);
  });

  it('builds the plain noise without a period', () => {
    const names = callNames(fbm(p, { octaves: 4 })).filter((name) =>
      name.startsWith('aekGradient')
    );
    expect(names).toEqual(Array(4).fill('aekGradientNoise'));
  });

  it('rounds a node period per octave in the shader', () => {
    const period = uniform(new Vector2(4, 4)) as unknown as Node<'vec2'>;
    const calls = findCalls(fbm(p, { period, octaves: 2 })).filter(
      (call) => call.shaderNode.layout.name === 'aekGradientNoisePeriodic'
    );
    expect(calls).toHaveLength(2);
    // No constant: each octave's period is a node built from the uniform
    expect(calls.map(constantPeriod)).toEqual([null, null]);
  });

  it('refuses octaves and lacunarity out of range', () => {
    expect(() => fbm(p, { octaves: 0 })).toThrow(/octaves is 0/);
    expect(() => fbm(p, { octaves: 13 })).toThrow(/octaves is 13/);
    expect(() => fbm(p, { octaves: 2.5 })).toThrow(/octaves is 2.5/);
    expect(() => fbm(p, { octaves: 3, lacunarity: 0.5 })).toThrow(/lacunarity is 0.5/);
  });
});

describe('domainWarp', () => {
  it('warps with two fbms of the period, 3 octaves by default', () => {
    const calls = findCalls(domainWarp(p, { period: 2, strength: 0.5 })).filter(
      (call) => call.shaderNode.layout.name === 'aekGradientNoisePeriodic'
    );
    expect(calls).toHaveLength(6);
    expect(() => domainWarp(p, { strength: 1, octaves: 20 })).toThrow(/octaves is 20/);
  });
});
