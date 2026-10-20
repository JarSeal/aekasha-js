import { describe, expect, test } from 'vitest';
import { DEFAULT_LOD_CHAIN_OPTIONS, resolveLodChainOptions } from './LodChainOptions';

describe('resolveLodChainOptions', () => {
  test('fills in every default', () => {
    expect(resolveLodChainOptions()).toEqual(DEFAULT_LOD_CHAIN_OPTIONS);
    expect(resolveLodChainOptions({})).toEqual(DEFAULT_LOD_CHAIN_OPTIONS);
  });

  test('drops ratios outside (0, 1) and sorts the rest from the most detailed level down', () => {
    expect(resolveLodChainOptions({ ratios: [0.1, 1, 0.5, 0, -0.2, 0.25, 1.5] }).ratios).toEqual([
      0.5, 0.25, 0.1,
    ]);
  });

  test('defaults each attribute weight on its own', () => {
    expect(resolveLodChainOptions({ attributeWeights: { uv: 0 } }).attributeWeights).toEqual({
      normal: DEFAULT_LOD_CHAIN_OPTIONS.attributeWeights.normal,
      uv: 0,
    });
  });

  test('keeps the given flags and error', () => {
    expect(
      resolveLodChainOptions({
        maxError: 0.2,
        compactVertices: true,
        lockBorder: true,
        permissive: true,
      })
    ).toMatchObject({ maxError: 0.2, compactVertices: true, lockBorder: true, permissive: true });
  });

  test('never hands out the defaults themselves', () => {
    const resolved = resolveLodChainOptions();
    resolved.ratios.push(0.05);
    resolved.attributeWeights.normal = 0;

    expect(DEFAULT_LOD_CHAIN_OPTIONS.ratios).toEqual([0.5, 0.25, 0.1]);
    expect(DEFAULT_LOD_CHAIN_OPTIONS.attributeWeights.normal).toBe(0.5);
  });
});
