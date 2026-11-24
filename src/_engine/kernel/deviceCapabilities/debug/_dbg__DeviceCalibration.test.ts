import { describe, expect, it } from 'vitest';
import { classifyCalibrationSample, fitReferenceFrame } from './_dbg__DeviceCalibration';

describe('fitReferenceFrame', () => {
  // 10 MPix-ops per ms, a million triangles per ms
  const benchmark = { fillRateMPixOpsPerMs: 10, trianglesPerMs: 1e6 };

  it('fits the fixed work and the passes from samples at several sizes', () => {
    // 1 ms of triangles, then 2 ms fixed (20 MPix-ops) and 0.5 ms a megapixel (5 passes)
    const at = (megapixels: number) => ({
      pixels: megapixels * 1e6,
      ms: 1 + 2 + 0.5 * megapixels,
      triangles: 1e6,
    });
    expect(fitReferenceFrame(benchmark, [at(1), at(2), at(4)])).toEqual({
      fixedMPixOps: 20,
      fullscreenPasses: 5,
      trianglesPerFrame: 1e6,
    });
  });

  it('fits the passes alone from one size, at the fixed work given, and never below 0', () => {
    const one = [{ pixels: 2e6, ms: 5, triangles: 1e6 }];
    expect(fitReferenceFrame(benchmark, one)).toEqual({
      fixedMPixOps: 0,
      fullscreenPasses: 20,
      trianglesPerFrame: 1e6,
    });
    // 4 ms of fill: 20 MPix-ops fixed leave 20 over 2 megapixels
    expect(fitReferenceFrame(benchmark, one, 20)).toEqual({
      fixedMPixOps: 20,
      fullscreenPasses: 10,
      trianglesPerFrame: 1e6,
    });
    // Less time at the larger size (noise): a negative slope is 0
    const noisy = fitReferenceFrame(benchmark, [
      { pixels: 1e6, ms: 3, triangles: 0 },
      { pixels: 2e6, ms: 2.9, triangles: 0 },
    ]);
    expect(noisy.fullscreenPasses).toBe(0);
  });
});

describe('classifyCalibrationSample', () => {
  it('is held by the refresh rate up to 1.1× its interval', () => {
    expect(classifyCalibrationSample({ gpuMs: 3.4, frameMs: 6.94 }, 144)).toBe('REFRESH');
    expect(classifyCalibrationSample({ gpuMs: 70, frameMs: 18 }, 60)).toBe('REFRESH');
  });

  it("is GPU-bound under the refresh rate, an overcounted GPU time included; CPU-bound when the GPU's time is well under the interval", () => {
    // The M2's terrain showcase: 32 fps, its summed passes 124 ms
    expect(classifyCalibrationSample({ gpuMs: 123.8, frameMs: 31.25 }, 60)).toBe('GPU');
    expect(classifyCalibrationSample({ gpuMs: 28, frameMs: 31.25 }, 60)).toBe('GPU');
    expect(classifyCalibrationSample({ gpuMs: 12, frameMs: 31.25 }, 60)).toBe('CPU');
  });

  it('is null without a refresh rate', () => {
    expect(classifyCalibrationSample({ gpuMs: 10, frameMs: 30 }, null)).toBeNull();
  });
});
