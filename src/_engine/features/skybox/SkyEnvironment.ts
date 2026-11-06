import * as THREE from 'three/webgpu';
import { pmremTexture } from 'three/tsl';
import { getRenderer } from '../../kernel/render/Renderer';
import { runWithClearRenderState } from '../../kernel/render/CompileQueue';
import type { SkyBoxEnvSize } from './SkyBoxTypes';

/**
 * The sky box's PMREMs: a texture base's (getPMREMTexture, disposed with its source texture) and
 * the composite path's env bake (one target re-rendered by every bake). Internal to the sky box
 * (its activation, the day-night step) and its debug tools (the bake stats, GPU memory).
 */

/** Baked PMREMs by source texture, disposed with the source texture. */
const pmrems = new WeakMap<THREE.Texture, { target: THREE.CubeRenderTarget; version: number }>();

/**
 * Whether a texture can be baked into a PMREM yet: PMREMNode's own checks
 * (isEquirectangularMapReady / isCubeMapReady).
 * @internal
 */
export const isPMREMSourceReady = (texture: THREE.Texture) => {
  const image = texture.image as { height?: number; [index: number]: unknown } | null | undefined;
  if (!image) return false;
  if ((texture as THREE.CubeTexture).isCubeTexture) {
    for (let i = 0; i < 6; i++) if (image[i] === undefined) return false;
    return true;
  }
  return (image.height || 0) > 0;
};

/**
 * The texture to give pmremTexture(): a PMREM baked here (once per source texture and PMREM
 * version), disposed when its source texture is disposed. A PMREMNode given the source texture
 * itself bakes it with a PMREMGenerator of its own, and nothing ever disposes either. A source
 * that isn't ready (eg. a failed load) is returned as is, for PMREMNode to bake once it is.
 * Without an initialized renderer, the source is returned as is too (three r187's generator
 * throws before `renderer.init()`; r186 baked asynchronously).
 * @internal
 */
export const getPMREMTexture = (texture: THREE.Texture) => {
  const renderer = getRenderer();
  if (!renderer?.hasInitialized() || !isPMREMSourceReady(texture)) return texture;
  const cached = pmrems.get(texture);
  if (cached?.version === texture.pmremVersion) return cached.target.texture;

  // A generator per bake, disposed right after: its working set (a source cube target as large
  // as the PMREM, its box mesh and materials) would otherwise stay on the GPU.
  const generator = new THREE.PMREMGenerator(renderer);
  // Outside a frame (a sky box's registration): without the target and MRT an engine compile
  // may hold (kernel/render/CompileQueue.ts)
  const target = runWithClearRenderState(renderer, () =>
    (texture as THREE.CubeTexture).isCubeTexture
      ? generator.fromCubemap(texture, cached?.target)
      : generator.fromEquirectangular(texture, cached?.target)
  );
  generator.dispose();
  if (!cached) {
    const onDispose = () => {
      texture.removeEventListener('dispose', onDispose);
      pmrems.get(texture)?.target.dispose();
      pmrems.delete(texture);
    };
    texture.addEventListener('dispose', onDispose);
  }
  pmrems.set(texture, { target, version: texture.pmremVersion });
  return target.texture;
};

// Env bake: a composite sky box's environment (fromScene into a fixed target, p112)

/**
 * The active composite sky box's bake resources. The target and generator live as long as the
 * activation (and its size); the scene is replaced on every node rebuild. GPU memory lists it.
 * @internal
 */
export type EnvBake = {
  size: SkyBoxEnvSize;
  /** The PMREM (a cube target with its prefiltered mips) every bake re-renders. */
  target: THREE.CubeRenderTarget;
  /** `pmremTexture(target.texture)`: the root scene's environmentNode. Created with the target,
   * and never re-pointed (a `.value` swap to a new target left stale bindings on WebGL2). */
  environmentNode: THREE.Node;
  /** Long-lived: its working set (the source cube target, its box mesh, the GGX materials) is
   * reused while the size stays the same. */
  generator: THREE.PMREMGenerator;
  /** Private: holds only the ENV_BAKE composite as its backgroundNode. */
  scene: THREE.Scene;
};

let envBake: EnvBake | null = null;
let isBakeRequested = false;

/**
 * Debug hooks around every bake (the Environment folder's stats).
 * @internal
 */
export type EnvBakeHooks = { onBakeStart: () => void; onBakeEnd: (cpuMs: number) => void };
let bakeHooks: EnvBakeHooks | null = null;
/**
 * Sets (or with null, removes) the hooks every env bake calls: the Environment folder's bake
 * stats set them when their module loads (debug env). Without hooks, a bake reads no wall clock.
 * @internal
 */
export const _setEnvBakeHooks = (hooks: EnvBakeHooks | null) => {
  bakeHooks = hooks;
};

/**
 * three's smallest PMREM face (`MIN_SIZE` in PMREMGenerator.js, three r187): `fromScene` bakes a
 * smaller `size` at this one, so the sky box never asks for less (getEnvSize).
 * @internal
 */
export const ENV_BAKE_MIN_SIZE = 256;
/** The face size of a PMREM's smallest prefiltered mip, as a power of two (`LOD_MIN`, r187). */
const PMREM_LOD_MIN = 3;

/**
 * A PMREM target like the one `PMREMGenerator.fromScene` allocates for `faceSize`
 * (`_allocateTarget` and `_createRenderTarget` in PMREMGenerator.js, three r187: a cube target
 * with only the prefiltered mips, down to 8 texels; `faceSize` is at least ENV_BAKE_MIN_SIZE).
 * Allocated here, not by the first bake, so the environment node exists from activation on:
 * activation runs while the scene loads, and bakes never do.
 */
const createEnvBakeTarget = (faceSize: SkyBoxEnvSize) => {
  const target = new THREE.CubeRenderTarget(faceSize, {
    minFilter: THREE.LinearMipmapLinearFilter,
    generateMipmaps: false,
    type: THREE.HalfFloatType,
    colorSpace: THREE.LinearSRGBColorSpace,
    depthBuffer: false,
  });
  // Size-only entries, as three's: they allocate the mips, which the bakes render (the types
  // declare only image mipmaps)
  const mipmaps = target.texture.mipmaps as unknown as { width: number; height: number }[];
  const maxLod = Math.log2(faceSize) - PMREM_LOD_MIN;
  for (let lod = 0; lod <= maxLod; lod++)
    mipmaps.push({ width: faceSize >> lod, height: faceSize >> lod });
  target.texture.name = 'SkyBox.envBake';
  // What makes pmremTexture() sample it as is (the types don't declare the flag)
  (target.texture as THREE.Texture & { isPMREMTexture: boolean }).isPMREMTexture = true;
  return target;
};

/**
 * Sets up a new target's GPU texture now, by clearing it (a clear runs three's render target
 * setup, as a render would). Without it, the target is first sampled (by every lit material,
 * for the whole scene load: bakes wait for it to end) before anything renders into it, so three
 * gives it a placeholder GPU texture, and the first bake's render target setup destroys that
 * one in place (Textures.updateTexture) without invalidating the bind groups that sample it: a
 * "Destroyed texture used in a submit" on every frame after that (WebGPU). Still needed with
 * three r187: its fix (#35204, a sampled render target texture is created with its target) goes
 * through `texture.renderTarget`, which a `CubeRenderTarget`'s cube texture doesn't have (its
 * constructor swaps the texture in through the setter, which sets no back-link; p057 Phase 3
 * measured the error without this clear on r187). Reported in
 * docs/issues/three-cube-render-target-texture-link.md: this clear can go once three links the
 * texture.
 */
const initEnvBakeTarget = (renderer: THREE.Renderer, target: THREE.RenderTarget) => {
  if (!renderer.hasInitialized()) return;
  const prevTarget = renderer.getRenderTarget();
  renderer.setRenderTarget(target);
  renderer.clear();
  renderer.setRenderTarget(prevTarget);
};

const disposeBakeScene = (scene: THREE.Scene) => {
  // Background.js disposes the scene's background mesh (material and geometry) when the node
  // it was built with is disposed. Each bake scene only ever has one node.
  scene.backgroundNode?.dispose();
  scene.backgroundNode = null;
};

/**
 * The env bake for `size` (getEnvSize's face size, at least ENV_BAKE_MIN_SIZE), with `source` (the ENV_BAKE composite) as what it bakes, and a bake
 * requested (the activation and every composite rebuild). Keeps the current target, generator
 * and environment node when the size is the same; a new size replaces all three (one
 * lit-material rebuild).
 * @internal
 * @remarks
 * A new target is cleared right away (initEnvBakeTarget): every lit material samples it for
 * the whole scene load, before the first bake, and three (r186, r187: a cube target's texture has
 * no `renderTarget` link) destroys a target's placeholder GPU texture in place on its first
 * render without invalidating the bind groups that sample it (WebGPU: "Destroyed texture used in
 * a submit" on every frame). That needs an initialized
 * renderer: activated before `createRenderer` has resolved, the clear is skipped and the
 * generator gets no renderer. No path does (the boot and `mountAekasha` create the renderer
 * before the first scene loads), so it isn't guarded.
 */
export const setEnvBake = (size: SkyBoxEnvSize, source: THREE.Node): EnvBake => {
  const renderer = getRenderer();
  if (envBake && envBake.size !== size) disposeEnvBake();
  if (!envBake) {
    const target = createEnvBakeTarget(size);
    if (renderer) initEnvBakeTarget(renderer as THREE.Renderer, target);
    envBake = {
      size,
      target,
      environmentNode: pmremTexture(target.texture),
      generator: new THREE.PMREMGenerator(renderer as THREE.Renderer),
      scene: new THREE.Scene(),
    };
  } else {
    disposeBakeScene(envBake.scene);
    envBake.scene = new THREE.Scene();
  }
  envBake.scene.name = 'SkyBox.envBakeScene';
  envBake.scene.backgroundNode = source;
  isBakeRequested = true;
  return envBake;
};

/**
 * Disposes the env bake's target, generator and bake scene, and drops a requested bake (the
 * direct path, a clear). Texture PMREMs (getPMREMTexture) are not touched: they belong to their
 * source textures.
 * @internal
 */
export const disposeEnvBake = () => {
  isBakeRequested = false;
  if (!envBake) return;
  disposeBakeScene(envBake.scene);
  envBake.generator.dispose();
  envBake.target.dispose();
  envBake = null;
};

/**
 * The active env bake, or null (direct path, or no sky box).
 * @internal
 */
export const getEnvBake = () => envBake;

/**
 * Asks for a bake on the next sky box system tick (at most one per frame, never while a scene
 * loads). A no-op without an env bake.
 * @internal
 */
export const requestEnvBake = () => {
  if (envBake) isBakeRequested = true;
};

/**
 * Whether a bake waits for the next sky box system tick (the system checks it before it freezes
 * the bake's clouds at the sky clock and bakes).
 * @internal
 */
export const isEnvBakeRequested = () => isBakeRequested;

/**
 * Bakes the environment now, if one is requested (called by skyBoxSystem). The request is
 * dropped either way: without an env bake or an initialized renderer, nothing bakes.
 * @internal
 * @returns whether it baked
 */
export const runRequestedEnvBake = () => {
  isBakeRequested = false;
  const renderer = getRenderer();
  if (!envBake || !renderer?.hasInitialized()) return false;
  bakeHooks?.onBakeStart();
  // The debug stats' CPU time: a measurement, read only while they're on
  const start = bakeHooks ? performance.now() : 0;
  envBake.generator.fromScene(envBake.scene, 0, 0.1, 100, {
    size: envBake.size,
    renderTarget: envBake.target,
  });
  bakeHooks?.onBakeEnd(performance.now() - start);
  return true;
};
