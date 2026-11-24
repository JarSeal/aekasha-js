import { describe, expect, it } from 'vitest';
import { fitReferenceFrame } from './_dbg__DeviceCalibration';

describe('fitReferenceFrame', () => {
  // 10 MPix-ops per ms, a million triangles per ms
  const benchmark = { fillRateMPixOpsPerMs: 10, trianglesPerMs: 1e6 };

  it('fits the fixed work and the passes from samples at several sizes', () => {
    // 1 ms of triangles, then 2 ms fixed (20 MPix-ops) and 0.5 ms a megapixel (5 passes)
    const at = (megapixels: number) => ({
      pixels: megapixels * 1e6,
      gpuMs: 1 + 2 + 0.5 * megapixels,
      triangles: 1e6,
    });
    expect(fitReferenceFrame(benchmark, [at(1), at(2), at(4)])).toEqual({
      fixedMPixOps: 20,
      fullscreenPasses: 5,
      trianglesPerFrame: 1e6,
    });
  });

  it('fits the passes alone from one size, and never below 0', () => {
    expect(fitReferenceFrame(benchmark, [{ pixels: 2e6, gpuMs: 5, triangles: 1e6 }])).toEqual({
      fixedMPixOps: 0,
      fullscreenPasses: 20,
      trianglesPerFrame: 1e6,
    });
    // Less time at the larger size (noise): a negative slope is 0
    const noisy = fitReferenceFrame(benchmark, [
      { pixels: 1e6, gpuMs: 3, triangles: 0 },
      { pixels: 2e6, gpuMs: 2.9, triangles: 0 },
    ]);
    expect(noisy.fullscreenPasses).toBe(0);
  });
});
