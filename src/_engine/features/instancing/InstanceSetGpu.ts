import type { CreateInstanceSetBackend } from './InstanceSetTypes';

// An instance set's GPU backend (docs/plans/p354_gpu-driven-culling.md D4-D8): the front's
// `import()` (InstanceSet.ts), so only a WebGPU device downloads it.
// TODO(docs/plans/p354_gpu-driven-culling.md Phase 1 step 5): the buffers, the select, cull and
// finalize passes, the variants and the indirect draws. Until then it draws nothing.

/**
 * Creates a set's GPU backend.
 * @internal
 */
export const createGpuInstanceSetBackend: CreateInstanceSetBackend = () => ({
  writeInstances: () => {},
  dispose: () => {},
});
