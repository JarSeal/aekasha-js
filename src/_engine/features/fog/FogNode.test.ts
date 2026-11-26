import { describe, expect, it } from 'vitest';
import { createFogNodes, getExp2FogFactor, getLinearFogFactor } from './FogNode';

describe('the factors on the CPU', () => {
  it('LINEAR is a smoothstep from near to far', () => {
    expect(getLinearFogFactor(10, 110, 0)).toBe(0);
    expect(getLinearFogFactor(10, 110, 10)).toBe(0);
    expect(getLinearFogFactor(10, 110, 60)).toBe(0.5);
    expect(getLinearFogFactor(10, 110, 35)).toBeCloseTo(0.15625);
    expect(getLinearFogFactor(10, 110, 110)).toBe(1);
    expect(getLinearFogFactor(10, 110, 1000)).toBe(1);
  });

  it('EXP2 is 1 − exp(−(density · depth)²)', () => {
    expect(getExp2FogFactor(0.01, 0)).toBe(0);
    expect(getExp2FogFactor(0.01, 100)).toBeCloseTo(1 - Math.exp(-1));
    expect(getExp2FogFactor(0, 1e6)).toBe(0);
    expect(getExp2FogFactor(0.01, 1e4)).toBe(1);
  });
});

describe('createFogNodes', () => {
  it('starts with no fog, and its graph is three’s fog node', () => {
    const nodes = createFogNodes();
    expect(nodes.enabled.value).toBe(0);
    expect(nodes.modeWeights.value.toArray()).toEqual([0, 0, 0]);
    expect(nodes.node.isNode).toBe(true);
    // Each call makes its own: the feature keeps one a page load
    expect(createFogNodes().node).not.toBe(nodes.node);
  });
});
