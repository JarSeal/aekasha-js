// What every synchronous bake between frames shares (p304 D1; moved from the impostor bakes,
// `features/lod/impostors/ImpostorBake.ts`, p351): the renderer or a throw, the renderer state
// saved and put back around the bake, and the clear a new target gets before anything samples it.
// The kernel's texture baker, the impostor bakes and the Assets tab's texture preview use them.
//
// The scissor test is never touched: a leaked scissor breaks PMREM (three #31777; the viewports'
// rule, `features/viewports/Viewports.ts`).
import * as THREE from 'three/webgpu';
import { getRenderer } from './Renderer';
import { runWithClearRenderState } from './CompileQueue';

/**
 * The renderer, or a throw: a bake needs an initialized one.
 * For the texture baker, the impostor bakes and the texture preview.
 * @internal
 * @param caller the function named in the error
 */
export const getBakeRenderer = (caller: string) => {
  const renderer = getRenderer() as THREE.Renderer | undefined;
  if (!renderer?.hasInitialized()) {
    throw new Error(`${caller}: the renderer isn't initialized (bakes run after InitEngine).`);
  }
  return renderer;
};

/**
 * Runs `fn` with the renderer's target (with its cube face and mip level), clear colour and auto
 * clear put back afterwards, and without the target and MRT an engine compile in flight holds
 * (`runWithClearRenderState`, `kernel/render/CLAUDE.md`'s renderer state trap).
 * For the texture baker, the impostor bakes and the texture preview.
 * @internal
 */
export const withBakeRendererState = <T>(renderer: THREE.Renderer, fn: () => T): T =>
  runWithClearRenderState(renderer, () => {
    const prevTarget = renderer.getRenderTarget();
    const prevFace = renderer.getActiveCubeFace();
    const prevLevel = renderer.getActiveMipmapLevel();
    const prevAutoClear = renderer.autoClear;
    const prevClearColor = renderer.getClearColor(new THREE.Color());
    const prevClearAlpha = renderer.getClearAlpha();
    try {
      return fn();
    } finally {
      renderer.setRenderTarget(prevTarget, prevFace, prevLevel);
      renderer.autoClear = prevAutoClear;
      renderer.setClearColor(prevClearColor, prevClearAlpha);
    }
  });

/**
 * Clears a target to transparent black, which also sets up its GPU texture before anything
 * samples it (the destroyed-texture trap, `features/skybox/CLAUDE.md`). Call it inside
 * {@link withBakeRendererState}: it leaves the target and clear colour set.
 * For the texture baker, the impostor bakes and the texture preview.
 * @internal
 */
export const clearBakeTarget = (renderer: THREE.Renderer, target: THREE.RenderTarget) => {
  renderer.setRenderTarget(target);
  renderer.setClearColor(0x000000, 0);
  renderer.clear();
};
