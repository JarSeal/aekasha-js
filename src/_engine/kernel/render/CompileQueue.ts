import type { Renderer } from 'three/webgpu';

// The engine's pipeline compiles and the renderer state they hold (p057 Phase 3 step 3).
//
// three's `compileAsync` reads the renderer's render target and MRT (the node builds read the
// global target: `MRTNode.setup`, `NodeBuilder.getOutputType`) and yields to the next frame
// every 8 ms, putting back the MRT that was set when it was called. So a compile for a target
// other than the canvas (a PostFX scene pass: `RenderPipelineCompiler`) keeps that target and its
// MRT set on the renderer until it ends, across frames. Two consequences:
// - Engine compiles run one at a time (`runCompileAsync`): one started while another holds a
//   target would compile for that target, and put its MRT back after the other had cleared it.
// - Every engine render runs with no target and no MRT set (`runWithClearRenderState`): a
//   frame, a snapshot, a bake. A render that sets its own target still reads the MRT, so a bake
//   during a pre-pass compile would write normals into its colour.

let compileTail: Promise<void> = Promise.resolve();

/**
 * Runs `job` once the engine's earlier compiles have ended (each one's rejection included), so
 * compiles never overlap. Returns the job's promise.
 * @internal
 * @param job a compile: `renderer.compileAsync` in the renderer state it needs
 */
export const runCompileAsync = (job: () => Promise<void>): Promise<void> => {
  const run = compileTail.then(job);
  compileTail = run.catch(() => undefined);
  return run;
};

// What runWithClearRenderState took off the renderer. Module-level: a nested call finds the
// state clear and holds nothing, so one slot serves every depth.
let isHolding = false;
let heldTarget: ReturnType<Renderer['getRenderTarget']> = null;
let heldCubeFace = 0;
let heldMipmapLevel = 0;
let heldMRT: ReturnType<Renderer['getMRT']> | null = null;

/**
 * Runs `render` with no render target and no MRT set on the renderer, and puts back what was set
 * (an engine compile in flight holds its target's: `runCompileAsync`), even when it throws. Free
 * when nothing is set, so the main loop wraps every frame in it.
 * @internal
 * @param render what renders: a frame, a snapshot, a bake
 * @returns what `render` returns
 */
export const runWithClearRenderState = <T>(renderer: Renderer, render: () => T): T => {
  const target = renderer.getRenderTarget();
  const mrt = renderer.getMRT() as ReturnType<Renderer['getMRT']> | null;
  if (isHolding || (target === null && mrt === null)) return render();

  isHolding = true;
  heldTarget = target;
  heldCubeFace = renderer.getActiveCubeFace();
  heldMipmapLevel = renderer.getActiveMipmapLevel();
  heldMRT = mrt;
  renderer.setRenderTarget(null);
  renderer.setMRT(null);
  try {
    return render();
  } finally {
    renderer.setRenderTarget(heldTarget, heldCubeFace, heldMipmapLevel);
    renderer.setMRT(heldMRT);
    heldTarget = null;
    heldMRT = null;
    isHolding = false;
  }
};
