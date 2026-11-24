import { describe, expect, it } from 'vitest';
import { getCpuBenchmarkChecksum, runCpuBenchmark } from './CpuBenchmark';

// A clock that advances 1 ms per read: each round reads it once
const createStepClock = () => {
  let time = 0;
  return () => time++;
};

describe('runCpuBenchmark', () => {
  it('scores the multiplies per ms over the measured time, after the warm-up', () => {
    // 64 multiplies a round, one round per clock ms
    expect(runCpuBenchmark({ durationMs: 100, warmUpMs: 10, now: createStepClock() })).toBe(64);
  });

  it('runs the work (the checksum moves) and scores a real clock above zero', () => {
    const before = getCpuBenchmarkChecksum();
    expect(runCpuBenchmark({ durationMs: 5, warmUpMs: 1 })).toBeGreaterThan(0);
    expect(getCpuBenchmarkChecksum()).not.toBe(before);
  });
});
