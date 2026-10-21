// Type-only module, so app-side PostFX pass `.tsl.ts` files can import it without pulling in runtime code.
// Uses three/webgpu's Node class type, not the loose three/tsl `Node` shim in types/three-node-material-helpers.d.ts.
import type * as THREE from 'three/webgpu';
import type { PostFxAsset } from '../../schemas/PostFxSchema';

/** Everything a PostFX pass needs from the engine to build its node: the second argument of its
 * {@link PostFxPassFn}. A new object per pass and build: keep what a build needs, not the object. */
export type PostFxPassContext = {
  /** The renderer the chain renders with. */
  renderer: THREE.WebGPURenderer;
  /** The root scene, which the scene pass renders. */
  scene: THREE.Scene;
  /** The active camera the chain was built for (a camera change rebuilds the chain). */
  camera: THREE.Camera;
  /** The shared TSL scene pass (the scene render that feeds the chain). */
  scenePass: THREE.PassNode;
  /** Output of the previous PostFX pass in the chain (the scene color for the first one), what this pass should build on. */
  colorNode: THREE.Node<'vec4'>;
  /** Unmodified scene buffers, for PostFX passes that need the raw G-buffer. */
  sceneColorNode: THREE.Node<'vec4'>;
  /** View-space normals, from a non-MSAA pre-pass (sampleable like regular textures, unlike the MSAA scene pass's own depth). Lazy: reading it or `sceneDepthNode` is what adds the pre-pass, an extra scene render. */
  sceneNormalNode: THREE.Node;
  /** Depth, from the same non-MSAA pre-pass as `sceneNormalNode` (reading it adds the pre-pass). */
  sceneDepthNode: THREE.Node;
};

/** What a PostFX pass's {@link PostFxPassFn} may return instead of a bare node, when it needs
 * live params, a size or a disposal. */
export type PostFxPassApi = {
  /** The node this PostFX pass contributes to the chain. */
  node: THREE.Node<'vec4'>;
  /** Nodes whose updateBefore() cost is attributed to this PostFX pass when profiling. Defaults to [node]. */
  profileNodes?: THREE.Node[];
  /** Live param write-through (`setPostFxPassParam` and the debugger): without it, a param edit
   * rebuilds the chain. */
  setParam?: (key: string, value: unknown) => void;
  /** Called with the drawing buffer size in device px on the first frame of a build and on
   * every change (a render target the pass owns follows it). */
  onSetSize?: (width: number, height: number) => void;
  /** Called when the build is thrown away (a rebuild, the scene's exit): release what the pass
   * made. */
  onDispose?: () => void;
};

/**
 * The contract-named `fxNode` export of a PostFX pass's `.tsl.ts` file: builds the pass's node
 * from the previous one (`ctx.colorNode`). Called on every chain build (a pass enabled or
 * disabled, a param edit without `setParam`, a camera change); a throw leaves the pass out of
 * the chain with an error.
 * @param params the pass's current params (the JSON's `params`, with live edits)
 * @param ctx the engine's side ({@link PostFxPassContext})
 * @param defines the JSON's `staticDefines`
 * @returns the pass's output colour node, or a {@link PostFxPassApi} around it
 * @example
 * ```ts
 * import type { PostFxPassFn } from 'aekasha/postfx';
 * import { float, vec4 } from 'three/tsl';
 *
 * // A `<name>.tsl.ts` next to its `<name>.postFx.json`: darkens the frame by `params.amount`
 * export const fxNode: PostFxPassFn = (params, ctx) => {
 *   const amount = float(typeof params.amount === 'number' ? params.amount : 0.5);
 *   return vec4(ctx.colorNode.rgb.mul(amount.oneMinus()), ctx.colorNode.a);
 * };
 * ```
 */
export type PostFxPassFn = (
  params: Record<string, unknown>,
  ctx: PostFxPassContext,
  defines?: Record<string, unknown>
) => THREE.Node<'vec4'> | PostFxPassApi;

/** A PostFX pass as it arrives in the scene data (`SceneData`'s `postFx`), after the gatherer has
 * inlined it: its `*.postFx.json` without the tooling's keys. */
export type PostFxPassProps = Omit<PostFxAsset, '$schema' | '__sourcePath' | '__saveData'>;

/**
 * The currently built PostFX chain, as the debug profiler sees it.
 * @internal
 */
export type PostFxBuiltChain = {
  pipeline: THREE.RenderPipeline;
  /** The PostFX passes in the chain (enabled and built), in chain order. */
  postFxPasses: { id: string; profileNodes: THREE.Node[] }[];
};

/**
 * Per-PostFX pass measurement (smoothed ms per frame), as `getPostFxPassStats` reports it to the
 * PostFX tab and the profiler.
 * @internal
 */
export type PostFxPassStats = {
  /** The pass's id. */
  id: string;
  /** JS-side time in the PostFX pass's profileNodes' updateBefore(): render target setup,
   * uniform updates, draw dispatch. 0 for pure in-chain math PostFX passes. */
  cpuMs: number;
  /** GPU time of the render passes this PostFX pass issued, null when gpuAttribution is
   * 'shared' or GPU timing is unavailable. */
  gpuMs: number | null;
  /** 'exact': the PostFX pass issued render passes of its own, measured on their own.
   * 'shared': pure in-chain math, evaluated inside the final composite quad together with every
   * other 'shared' PostFX pass, so it can't be separated on the GPU (see compositeGpuMs). */
  gpuAttribution: 'exact' | 'shared';
};

/**
 * PostFX measurement results: what `getPostFxPassStats` returns to the PostFX tab and the profiler.
 * @internal
 */
export type PostFxStats = {
  /** Whether GPU timing is available (timestamp queries supported by the device). */
  gpuAvailable: boolean;
  /** Measured frames (CPU). */
  cpuSamples: number;
  /** Measured frames with resolved GPU timestamps. */
  gpuSamples: number;
  /** GPU time of the scene pass (render passes not issued by any PostFX pass). */
  sceneGpuMs: number | null;
  /** GPU time of the final composite quad, which includes every 'shared' PostFX pass. */
  compositeGpuMs: number | null;
  /** Each built PostFX pass's measurement, in chain order. */
  postFxPasses: PostFxPassStats[];
};
