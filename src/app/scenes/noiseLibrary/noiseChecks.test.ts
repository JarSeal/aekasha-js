import { describe, expect, it } from 'vitest';
import type { ChannelStats } from '../../shared/channelStats';
import { checkNoiseRow } from './noiseChecks';

const stats = (overrides: Partial<ChannelStats>): ChannelStats => ({
  mean: 0.5,
  std: 0.2,
  min: 0,
  max: 1,
  neighbourStep: 0.05,
  wrapStep: 0.04,
  ...overrides,
});

describe('checkNoiseRow', () => {
  it('passes a periodic bake that tiles, repeats and matches the plain one', () => {
    expect(checkNoiseRow(stats({}), stats({ mean: 0.52, std: 0.21 }), 1).failures).toEqual([]);
  });

  it('names each failure', () => {
    const { failures } = checkNoiseRow(
      stats({ wrapStep: 0.3 }),
      stats({ mean: 0.6, std: 0.3 }),
      40
    );
    expect(failures).toHaveLength(4);
    expect(failures[0]).toMatch(/a seam/);
    expect(failures[1]).toMatch(/not periodic/);
    expect(failures[2]).toMatch(/the means differ/);
    expect(failures[3]).toMatch(/the spreads differ/);
  });
});
