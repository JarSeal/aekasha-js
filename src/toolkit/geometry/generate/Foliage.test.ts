import { describe, expect, it } from 'vitest';
import { generateBushGeometry } from './Foliage';

// The `it.fails` case is a known bug, failing on its assertion: p620 Phase 1 fixes it and turns
// it into an `it` (docs/plans/p620_review-toolkit-and-app-code.md, T3).

describe('generateBushGeometry', () => {
  it.fails('a bush of 0 clusters builds', () => {
    expect(() => generateBushGeometry({ clusterCount: 0 })).not.toThrow();
  });
});
