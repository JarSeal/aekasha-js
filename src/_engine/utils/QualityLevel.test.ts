import { describe, expect, it } from 'vitest';
import { compareQualityLevels, minQualityLevel, QUALITY_LEVELS } from './QualityLevel';

describe('QualityLevel', () => {
  it('orders the levels lowest first', () => {
    expect(QUALITY_LEVELS).toEqual(['LOW', 'MEDIUM', 'HIGH', 'ULTRA']);
    const shuffled = ['ULTRA', 'LOW', 'HIGH', 'MEDIUM'] as const;
    expect([...shuffled].sort(compareQualityLevels)).toEqual(QUALITY_LEVELS);
  });

  it('compares two levels', () => {
    expect(compareQualityLevels('LOW', 'ULTRA')).toBeLessThan(0);
    expect(compareQualityLevels('HIGH', 'HIGH')).toBe(0);
    expect(compareQualityLevels('ULTRA', 'MEDIUM')).toBeGreaterThan(0);
  });

  it('returns the lowest level and skips the unknown ones', () => {
    expect(minQualityLevel('HIGH', 'MEDIUM', 'ULTRA')).toBe('MEDIUM');
    expect(minQualityLevel(null, 'HIGH', undefined)).toBe('HIGH');
    expect(minQualityLevel(null, undefined)).toBeNull();
    expect(minQualityLevel()).toBeNull();
  });
});
