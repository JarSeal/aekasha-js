/**
 * PostFX system: an ordered, per-scene chain of authored
 * PostFX passes (a `<name>.postFx.json` + `<name>.tsl.ts` pair each), rendered through a TSL
 * `RenderPipeline` instead of `renderer.render()` while it is switched on.
 *
 * Naming rule: one item of the chain is always a "PostFX pass" (`PostFxPass`, `postFxPass`,
 * `postFxPasses`), never a bare `pass`. TSL's `pass()` / `PassNode` is something else: the scene
 * render that feeds the chain, which is always called `scenePass` here.
 *
 * Changing the enabled PostFX pass set rebuilds the node chain (a shader recompile, so a
 * one-frame hitch), but a disabled PostFX pass then costs nothing. Switching the whole stack
 * off keeps the pipeline warm, so switching it back on does not recompile. The chain is also
 * rebuilt when the active camera changes (eg. the debug fly camera is toggled), because the TSL
 * scene pass binds its camera at construction. Resizing needs no rebuild.
 */
import * as THREE from 'three/webgpu';
import { mrt, normalView, pass } from 'three/tsl';
import { getConfig, IS_DEBUG_ENV } from '../../kernel/config/Config';
import type { FeatureContext } from '../../kernel/init/Features';
import { getRenderer } from '../../kernel/render/Renderer';
import { getGeneratedAppData, getRootScene, getSceneOpts } from '../../kernel/scene/Scene';
import { getActiveCamera } from '../../kernel/camera/Camera';
import { getAppData } from '../../kernel/scene/AppData';
import { lerror, llog, lwarn } from '../../utils/Logger';
import type { DebugModuleRef } from '../../kernel/config/DebugModules';
import { loadDebugModuleAsync, useDebug } from '../../kernel/config/DebugModules';
import type {
  PostFxBuiltChain,
  PostFxPassApi,
  PostFxPassContext,
  PostFxPassFn,
  PostFxPassProps,
} from './PostFXTypes';
import type { DebugData } from '../../schemas/_HelperSchemas';
import type { PostFxParamMeta } from '../../schemas/PostFxSchema';

type PostFxPassState = {
  id: string;
  props: PostFxPassProps;
  enabled: boolean;
  fxNode: PostFxPassFn;
  /** What fxNode returned in the current build (null when not in the chain). */
  api: PostFxPassApi | null;
};

/**
 * How a PostFX pass takes param edits ({@link PostFxPassInfo}'s `liveParams`): `'setParam'` live
 * through its own `setParam`, `'rebuild'` by rebuilding the chain (a shader recompile),
 * `'unknown'` while it has not been built (disabled, or no frame rendered with it yet), since only
 * a build shows whether it returns a `setParam`.
 */
export type PostFxLiveParams = 'setParam' | 'rebuild' | 'unknown';

/** A PostFX pass of the current scene's chain, as {@link getPostFxPasses} lists it: a snapshot,
 * which later edits don't change. */
export type PostFxPassInfo = {
  /** The pass's id (its `*.postFx.json`'s `id`). */
  id: string;
  /** Position in the scene's chain (execution order). */
  index: number;
  /** Whether the pass is in the chain (a disabled one costs nothing). */
  enabled: boolean;
  /** The pass JSON's debug data (the debugger's name and description). */
  debugData?: DebugData;
  /** The current (live) param values, a copy. */
  params: Record<string, unknown>;
  /** The pass JSON's debugger hints per param key (label, slider range, options, hidden). */
  paramsMeta?: Record<string, PostFxParamMeta>;
  /** How the pass takes a param edit. */
  liveParams: PostFxLiveParams;
};

let isMasterEnabled = false;
let isEnabled = false;
let postFxSceneId: string | null = null;
let postFxPasses: PostFxPassState[] = [];
let enabledPostFxPassCount = 0;
let pipeline: THREE.RenderPipeline | null = null;
let scenePass: THREE.PassNode | null = null;
/** Lazy non-MSAA depth + normal pre-pass, see buildPostFxPipeline(). */
let prePass: THREE.PassNode | null = null;
/** The camera the current build's scene pass renders with. */
let builtCamera: THREE.Camera | null = null;
let needsRebuild = true;
/** Called after the PostFX chain is (re)built or disposed (eg. by the debug profiler). */
const postFxChainListeners = new Set<() => void>();
const lastSize = new THREE.Vector2(-1, -1);
const curSize = new THREE.Vector2();
/** The PostFX pass files loaded so far, by pass id (see loadScenePostFxFilesAsync) */
const loadedPostFxFiles = new Map<string, Record<string, unknown>>();

/**
 * Installs the PostFX system (the `postFx()` feature's install, PostFXFeature.ts): reads
 * `AppConfig.postFx.enabled`. Nothing is built here: the pipeline is only created the first time
 * a scene's PostFX chain is actually rendered.
 * @internal
 */
export const installPostFx = (ctx: FeatureContext) => {
  isMasterEnabled = ctx.config.postFx?.enabled !== false;
};

/**
 * Loads the files of the PostFX passes a scene's chain names (its options' `postFx`), which the
 * gathered data loads on demand (p607 D11): the `created` scene hook awaits it before
 * buildPostFxForScene. A file loads once; one that fails is logged and its pass left out (as a
 * pass without a file is).
 * @internal
 */
export const loadScenePostFxFilesAsync = async (sceneId: string) => {
  const entries = getSceneOpts(sceneId)?.postFx || [];
  await Promise.all(
    entries.map(async (entry) => {
      const id = typeof entry === 'string' ? entry : entry.id;
      const load = getAppData().postFxFiles[id];
      if (loadedPostFxFiles.has(id) || !load) return;
      try {
        loadedPostFxFiles.set(id, await load());
      } catch (err) {
        lerror(`Could not load the file of PostFX pass "${id}" (scene "${sceneId}").`, err);
      }
    })
  );
};

const resolvePostFxPass = (
  entry: PostFxPassProps | string,
  sceneId: string
): PostFxPassState | null => {
  let props = entry;
  if (typeof props === 'string') {
    // Only dev builds carry the asset registries (the gatherer inlines scene PostFX passes)
    const registry = (
      getGeneratedAppData() as unknown as { postFx?: Record<string, PostFxPassProps> }
    ).postFx;
    const found = registry?.[props];
    if (!found) {
      lwarn(`Could not find PostFX pass with id "${props}" (scene "${sceneId}"), skipping it.`);
      return null;
    }
    props = found;
  }

  const fxNode = loadedPostFxFiles.get(props.id)?.fxNode as PostFxPassFn | undefined;
  if (!fxNode) {
    lwarn(
      `Could not locate the "fxNode" export for PostFX pass "${props.id}" (scene "${sceneId}"), skipping it. A PostFX pass needs a *.postFx.json file whose tslFile exports "fxNode" (PostFX passes written inline in a scene file are not supported).`
    );
    return null;
  }

  // Copied, so runtime param edits never write into the generated data
  return {
    id: props.id,
    props: { ...props, params: { ...props.params } },
    enabled: props.enabled !== false,
    fxNode,
    api: null,
  };
};

const countEnabledPostFxPasses = () => {
  enabledPostFxPassCount = 0;
  for (let i = 0; i < postFxPasses.length; i++) {
    if (postFxPasses[i].enabled) enabledPostFxPassCount++;
  }
};

/** Disposes the current build's nodes, but keeps the pipeline and the PostFX pass list. */
const disposePostFxNodes = () => {
  for (let i = 0; i < postFxPasses.length; i++) {
    postFxPasses[i].api?.onDispose?.();
    postFxPasses[i].api = null;
  }
  scenePass?.dispose();
  scenePass = null;
  prePass?.dispose();
  prePass = null;
  builtCamera = null;
};

const buildPostFxPipeline = (
  renderer: THREE.WebGPURenderer,
  rootScene: THREE.Scene,
  camera: THREE.Camera
) => {
  disposePostFxNodes();

  const newScenePass = pass(rootScene, camera);
  const sceneColorNode = newScenePass.getTextureNode('output');
  // Depth and normals come from a separate, non-MSAA pre-pass: the scene pass inherits the
  // renderer's MSAA, and a multisampled depth texture can't be sampled like a regular one (eg.
  // WGSL has no textureGather for it, which GTAONode uses). Lazy, so the extra scene render only
  // happens when a PostFX pass actually reads depth or normals.
  const getPrePass = () => {
    if (!prePass) {
      prePass = pass(rootScene, camera, { samples: 0 });
      prePass.setMRT(mrt({ output: normalView }));
    }
    return prePass;
  };
  // A fresh object per PostFX pass (not a spread copy, which would trigger the getters)
  const createContext = (colorNode: THREE.Node<'vec4'>): PostFxPassContext => ({
    renderer,
    scene: rootScene,
    camera,
    scenePass: newScenePass,
    colorNode,
    sceneColorNode,
    get sceneNormalNode() {
      return getPrePass().getTextureNode('output');
    },
    get sceneDepthNode() {
      return getPrePass().getTextureNode('depth');
    },
  });

  let colorNode: THREE.Node<'vec4'> = sceneColorNode;
  for (let i = 0; i < postFxPasses.length; i++) {
    const postFxPass = postFxPasses[i];
    if (!postFxPass.enabled) continue;
    try {
      const result = postFxPass.fxNode(
        postFxPass.props.params || {},
        createContext(colorNode),
        postFxPass.props.staticDefines
      );
      postFxPass.api = (result as THREE.Node).isNode
        ? { node: result as THREE.Node<'vec4'> }
        : (result as PostFxPassApi);
      colorNode = postFxPass.api.node;
    } catch (err) {
      lerror(`Could not build PostFX pass "${postFxPass.id}", leaving it out of the chain.`, err);
    }
  }

  if (!pipeline) pipeline = new THREE.RenderPipeline(renderer);
  pipeline.outputNode = colorNode;
  pipeline.needsUpdate = true;
  scenePass = newScenePass;
  builtCamera = camera;
  lastSize.set(-1, -1);
  needsRebuild = false;

  for (const listener of postFxChainListeners) listener();

  if (IS_DEBUG_ENV) {
    const ids = postFxPasses.filter((p) => p.api).map((p) => p.id);
    llog(
      `[PostFX] Built the PostFX chain (scene "${postFxSceneId}"): ${ids.join(' → ')}${prePass ? ' (+ depth/normal pre-pass)' : ''}`
    );
  }
};

/** Calls the PostFX passes' onSetSize hooks when the drawing buffer size has changed. */
const updatePostFxSize = (renderer: THREE.WebGPURenderer) => {
  renderer.getDrawingBufferSize(curSize);
  if (curSize.equals(lastSize)) return;
  lastSize.copy(curSize);
  for (let i = 0; i < postFxPasses.length; i++) {
    postFxPasses[i].api?.onSetSize?.(curSize.x, curSize.y);
  }
};

/**
 * Returns the PostFX render pipeline to render the frame with, or null when the frame should
 * be rendered directly (PostFX is switched off, or no PostFX pass is enabled). (Re)builds the
 * pipeline when needed, so this is meant to be called once per frame: it's the render pipeline
 * seam's provider (`postFx()`), which renderScene() and snapshots read.
 * @internal
 */
export const getActivePostFxPipeline = () => {
  if (!isMasterEnabled || !isEnabled || !enabledPostFxPassCount) return null;
  const renderer = getRenderer();
  const camera = getActiveCamera();
  if (!renderer || !camera) return null;
  if (needsRebuild || !pipeline || camera !== builtCamera) {
    const rootScene = getRootScene();
    if (!rootScene) return null;
    buildPostFxPipeline(renderer, rootScene, camera);
  }
  updatePostFxSize(renderer);
  return pipeline;
};

/**
 * Sets up the PostFX pass chain of a scene (from its scene options: `postFx` and
 * `postFxEnabled`), replacing (and disposing) the previous one. The `created` scene hook calls it
 * once the passes' files have loaded (loadScenePostFxFilesAsync); a pass whose file didn't load
 * is left out with a warning.
 * @internal
 * @returns the scene's PostFX passes
 */
export const buildPostFxForScene = (sceneId: string) => {
  disposePostFx();
  const opts = getSceneOpts(sceneId);
  const entries = opts?.postFx || [];
  const ids = new Set<string>();
  for (let i = 0; i < entries.length; i++) {
    const postFxPass = resolvePostFxPass(entries[i], sceneId);
    if (!postFxPass) continue;
    if (ids.has(postFxPass.id)) {
      lwarn(`Duplicate PostFX pass "${postFxPass.id}" in scene "${sceneId}", skipping it.`);
      continue;
    }
    ids.add(postFxPass.id);
    postFxPasses.push(postFxPass);
  }
  countEnabledPostFxPasses();
  postFxSceneId = sceneId;
  isEnabled = opts?.postFxEnabled !== false;
  return getPostFxPasses();
};

/**
 * Switches the current scene's whole PostFX stack on or off (live). Off renders the frame
 * directly and keeps the pipeline built, so switching it back on doesn't recompile. The next
 * scene load sets it again from that scene's `postFxEnabled`.
 * @remarks Has no effect while `AppConfig.postFx.enabled` is false (it warns): the app config
 * wins.
 * @example
 * ```ts
 * import { setPostFxEnabled } from 'aekasha/postfx';
 *
 * // A graphics setting: render the scene without its PostFX chain
 * setPostFxEnabled(false);
 * ```
 */
export const setPostFxEnabled = (enabled: boolean) => {
  if (enabled && !isMasterEnabled) {
    lwarn('PostFX is disabled in the app config (AppConfig.postFx.enabled), it stays off.');
  }
  isEnabled = enabled;
};

/**
 * Whether the current scene's PostFX stack is switched on (and allowed by the app config).
 * @internal
 */
export const isPostFxEnabled = () => isMasterEnabled && isEnabled;

const getPostFxPass = (id: string) => {
  const postFxPass = postFxPasses.find((p) => p.id === id);
  if (!postFxPass) {
    lwarn(`Could not find PostFX pass "${id}" in the current scene ("${postFxSceneId}").`);
  }
  return postFxPass;
};

/**
 * Adds a PostFX pass of the current scene's chain to the rendered chain, or takes it out. The
 * chain is rebuilt on the next frame that renders it (a shader recompile, so a one-frame hitch);
 * a disabled pass costs nothing. An id the current scene doesn't have warns.
 * @param enabled whether the pass is in the chain
 * @example
 * ```ts
 * import { setPostFxPassEnabled } from 'aekasha/postfx';
 *
 * setPostFxPassEnabled('ambientOcclusion', false);
 * ```
 */
export const setPostFxPassEnabled = (id: string, enabled: boolean) => {
  const postFxPass = getPostFxPass(id);
  if (!postFxPass || postFxPass.enabled === enabled) return;
  postFxPass.enabled = enabled;
  countEnabledPostFxPasses();
  needsRebuild = true;
};

/**
 * Returns the current scene's PostFX passes in chain order, the disabled ones included: a new
 * array of snapshots per call (their `params` copied). Empty before a scene with a chain is
 * current.
 * @example
 * ```ts
 * import { getPostFxPasses } from 'aekasha/postfx';
 *
 * for (const postFxPass of getPostFxPasses()) {
 *   console.log(postFxPass.index, postFxPass.id, postFxPass.enabled);
 * }
 * ```
 */
export const getPostFxPasses = (): PostFxPassInfo[] =>
  postFxPasses.map((p, index) => ({
    id: p.id,
    index,
    enabled: p.enabled,
    debugData: p.props.debugData,
    params: { ...p.props.params },
    paramsMeta: p.props.paramsMeta,
    liveParams: !p.api ? 'unknown' : p.api.setParam ? 'setParam' : 'rebuild',
  }));

/**
 * Sets a param of a PostFX pass of the current scene's chain, live. Goes through the pass's own
 * `setParam` when its build returned one, otherwise the chain is rebuilt on the next frame (the
 * param is only read at build time). The value lasts until the scene is loaded again (the
 * scene data isn't changed). An id the current scene doesn't have warns.
 * @param key the param's key in the pass JSON's `params`
 * @param value the new value, of the type the pass reads
 * @example
 * ```ts
 * import { setPostFxPassParam } from 'aekasha/postfx';
 *
 * setPostFxPassParam('ambientOcclusion', 'radius', 0.5);
 * ```
 */
export const setPostFxPassParam = (id: string, key: string, value: unknown) => {
  const postFxPass = getPostFxPass(id);
  if (!postFxPass) return;
  if (!postFxPass.props.params) postFxPass.props.params = {};
  postFxPass.props.params[key] = value;
  if (postFxPass.api?.setParam) {
    postFxPass.api.setParam(key, value);
  } else if (postFxPass.enabled) {
    needsRebuild = true;
  }
};

/**
 * Disposes the PostFX pipeline, its nodes, and the current scene's PostFX pass list (the `exit`
 * scene hook, and the start of buildPostFxForScene).
 * @internal
 */
export const disposePostFx = () => {
  disposePostFxNodes();
  pipeline?.dispose();
  pipeline = null;
  postFxPasses = [];
  enabledPostFxPassCount = 0;
  postFxSceneId = null;
  isEnabled = false;
  needsRebuild = true;
  for (const listener of postFxChainListeners) listener();
};

/**
 * Adds a listener called after the PostFX chain is (re)built or disposed (the debugger's tab and
 * the profiler).
 * @internal
 * @returns the remover
 */
export const addPostFxChainListener = (listener: () => void) => {
  postFxChainListeners.add(listener);
  return () => {
    postFxChainListeners.delete(listener);
  };
};

// Debug
type PostFXGUIModule = typeof import('./debug/_dbg__PostFX');
let debugGUI: DebugModuleRef<PostFXGUIModule> | null = null;

/**
 * Creates the PostFX debugger tab (debug env only: `postFx()`'s `onDebugAfterStart`).
 * @internal
 */
export const createPostFXDebugGUI = async () => {
  debugGUI = await loadDebugModuleAsync(() => import('./debug/_dbg__PostFX'));
  await useDebug(debugGUI)?._createPostFXDebugGUI();
};

type PostFxProfilerModule = typeof import('./debug/_dbg__PostFXProfiler');
let profiler: DebugModuleRef<PostFxProfilerModule> | null = null;

const loadPostFxProfilerAsync = async () => {
  if (!profiler)
    profiler = await loadDebugModuleAsync(() => import('./debug/_dbg__PostFXProfiler'));
  return useDebug(profiler);
};

/**
 * Loads the PostFX per-pass profiler (debug env only: `postFx()`'s `onDebugAfterStart`, since
 * measuring needs the renderer), and starts measuring when `AppConfig.postFx.measureEnabled` is
 * set.
 * @internal
 */
export const registerPostFxProfiler = async () => {
  if (!IS_DEBUG_ENV) return;
  const module = await loadPostFxProfilerAsync();
  if (getConfig().postFx?.measureEnabled) module?._setPostFxMeasureEnabled(true);
};

/**
 * Switches PostFX per-pass measuring on or off, live (debug env only; the PostFX tab and the
 * profiler's PostFX source).
 * @internal
 */
export const setPostFxMeasureEnabled = async (enabled: boolean) => {
  if (!IS_DEBUG_ENV) return;
  (await loadPostFxProfilerAsync())?._setPostFxMeasureEnabled(enabled);
};

/**
 * Whether PostFX per-pass measuring is on (false until the profiler has loaded).
 * @internal
 */
export const isPostFxMeasureEnabled = () => useDebug(profiler)?._isPostFxMeasureEnabled() || false;

/**
 * The smoothed CPU and GPU times per PostFX pass, or null while not measuring (the profiler's
 * PostFX source).
 * @internal
 */
export const getPostFxPassStats = () => useDebug(profiler)?._getPostFxPassStats() || null;

/**
 * Returns the currently built PostFX chain (for the debug profiler and the GPU memory tab), or
 * null when none is built.
 * @internal
 */
export const getPostFxBuiltChain = (): PostFxBuiltChain | null => {
  if (!pipeline) return null;
  const builtPostFxPasses: PostFxBuiltChain['postFxPasses'] = [];
  for (let i = 0; i < postFxPasses.length; i++) {
    const api = postFxPasses[i].api;
    if (!api) continue;
    builtPostFxPasses.push({
      id: postFxPasses[i].id,
      profileNodes: api.profileNodes || [api.node],
    });
  }
  return { pipeline, postFxPasses: builtPostFxPasses };
};
