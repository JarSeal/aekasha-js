/**
 * Shared GPU timestamp-query plumbing for debug measurements (the GPU frame times, the PostFX
 * profiler, the sky box env bake stats). Debug only.
 *
 * - While anyone holds the timer (_acquireGpuTimer), the backend tracks timestamps and one
 *   inspector reports every render and compute context opened (_onRenderContext,
 *   _onComputeContext), so a measurement can collect the context uids of the work it wants timed.
 * - Every resolve replaces the timestamp pools' batches, so separate resolvers would consume each
 *   other's timestamps. _requestTimestampResolve runs one resolve of both pools at a time and
 *   hands the batches to every listener (_onTimestampsResolved). Something outside (eg. the
 *   stats-gl GPU panel) can still resolve on its own: listeners get a batch without their uids,
 *   and retry.
 */
import {
  InspectorBase,
  TimestampQuery,
  type Camera,
  type ComputeNode,
  type Node,
  type RenderTarget,
  type Renderer,
  type Scene,
  type Texture,
  type WebGPURenderer,
} from 'three/webgpu';
import { getRenderer } from '../kernel/render/Renderer';
import { lerror } from '../utils/Logger';

type TimestampPool = {
  timestamps: Map<string, number>;
  queryOffsets: Map<string, number>;
  /** WebGL only: each query's state by its offset ('inactive' until begun, 'ended'). */
  queryStates?: Map<number, string>;
};
type TimedBackend = {
  trackTimestamp: boolean;
  isWebGPUBackend?: boolean;
  hasTimestamp: boolean;
  timestampQueryPool: Record<string, TimestampPool | null | undefined>;
};

type ContextListener = (uid: string) => void;
type ResolveListener = (
  render: ReadonlyMap<string, number>,
  compute: ReadonlyMap<string, number>
) => void;

let holders = 0;
let renderer: WebGPURenderer | null = null;
let backend: TimedBackend | null = null;
let gpuAvailable = false;
let prevTrackTimestamp = false;
let prevInspector: InspectorBase | null = null;
let tap: RenderContextTap | null = null;
let isResolving = false;
let resolvingBackend: TimedBackend | null = null;
const renderContextListeners = new Set<ContextListener>();
const computeContextListeners = new Set<ContextListener>();
const resolveListeners = new Set<ResolveListener>();
let hasLoggedResolveError = false;
const NO_TIMESTAMPS: ReadonlyMap<string, number> = new Map();

/** Reports render contexts, and forwards everything to the previously installed inspector, so
 * it keeps working. */
class RenderContextTap extends InspectorBase {
  private readonly prev: InspectorBase;

  constructor(prev: InspectorBase) {
    super();
    this.prev = prev;
  }

  setRenderer(r: Renderer) {
    super.setRenderer(r);
    this.prev.setRenderer(r);
    return this;
  }

  begin() {
    super.begin();
    this.prev.begin();
  }

  finish() {
    super.finish();
    this.prev.finish();
  }

  inspect(node: Node) {
    this.prev.inspect(node);
  }

  computeAsync(computeNode: ComputeNode, dispatchSizeOrCount: number | number[]) {
    this.prev.computeAsync(computeNode, dispatchSizeOrCount);
  }

  beginCompute(uid: string, computeNode: ComputeNode) {
    for (const listener of computeContextListeners) listener(uid);
    this.prev.beginCompute(uid, computeNode);
  }

  finishCompute(uid: string) {
    this.prev.finishCompute(uid);
  }

  beginRender(uid: string, scene: Scene, camera: Camera, renderTarget: RenderTarget) {
    for (const listener of renderContextListeners) listener(uid);
    this.prev.beginRender(uid, scene, camera, renderTarget);
  }

  finishRender(uid: string) {
    this.prev.finishRender(uid);
  }

  copyTextureToTexture(srcTexture: Texture, dstTexture: Texture) {
    this.prev.copyTextureToTexture(srcTexture, dstTexture);
  }

  copyFramebufferToTexture(framebufferTexture: Texture) {
    this.prev.copyFramebufferToTexture(framebufferTexture);
  }
}

/**
 * Which GPU timing the renderer has, without taking a hold. WEBGL: timer queries exist, but
 * three's WebGL pool times one context at a time: a context opened inside another (eg. the
 * scene pass inside PostFX's composite) has no query of its own and never resolves, its time
 * being in the outer one's (see _keepTimedUids).
 */
export const _getGpuTimerSupport = (): 'WEBGPU' | 'WEBGL' | 'NONE' => {
  const r = getRenderer();
  if (!r) return 'NONE';
  const b = r.backend as unknown as TimedBackend;
  if (b.isWebGPUBackend) return r.hasFeature('timestamp-query') ? 'WEBGPU' : 'NONE';
  return b.hasTimestamp ? 'WEBGL' : 'NONE';
};

/**
 * Takes a hold on the timer: the first hold switches timestamp tracking on and installs the
 * render context tap. Pair every successful call with _releaseGpuTimer.
 * @returns whether GPU times will be available (timestamp queries supported), or null when
 * the renderer doesn't exist yet (nothing was held)
 */
export const _acquireGpuTimer = (): { gpuAvailable: boolean } | null => {
  if (holders === 0) {
    renderer = getRenderer() || null;
    if (!renderer) return null;
    backend = renderer.backend as unknown as TimedBackend;
    // WebGPUBackend.hasTimestamp is always true, the device feature is what decides
    gpuAvailable = backend.isWebGPUBackend
      ? renderer.hasFeature('timestamp-query')
      : backend.hasTimestamp;
    prevTrackTimestamp = backend.trackTimestamp;
    // The timestamp query pool is created lazily on first use, so this works after init
    if (gpuAvailable) backend.trackTimestamp = true;
    prevInspector = renderer.inspector;
    // Note: on the WebGL backend three warns once that ".toInspector()" needs WebGPU whenever a
    // custom inspector is installed, harmless (it only concerns three's own inspector addon)
    tap = new RenderContextTap(prevInspector);
    renderer.inspector = tap;
  }
  holders++;
  return { gpuAvailable };
};

/** Releases a hold; the last one restores the inspector and the timestamp tracking. */
export const _releaseGpuTimer = () => {
  if (holders === 0) return;
  holders--;
  if (holders > 0) return;
  // Leave an inspector installed after ours alone (it forwards to ours, which keeps forwarding)
  if (renderer && prevInspector && renderer.inspector === tap) renderer.inspector = prevInspector;
  // Back to the state before the first hold: on if it was on then. Something that switched it on
  // while held (eg. the stats-gl GPU panel) isn't seen, so it goes off with the last hold
  if (backend && !prevTrackTimestamp) backend.trackTimestamp = false;
  prevInspector = null;
  tap = null;
  renderer = null;
  backend = null;
};

/** Calls `listener` with the uid of every render context opened while the timer is held.
 * @returns a function that removes the listener */
export const _onRenderContext = (listener: ContextListener) => {
  renderContextListeners.add(listener);
  return () => {
    renderContextListeners.delete(listener);
  };
};

/** Calls `listener` with the uid of every compute context (a `compute` / `computeAsync` call)
 * opened while the timer is held.
 * @returns a function that removes the listener */
export const _onComputeContext = (listener: ContextListener) => {
  computeContextListeners.add(listener);
  return () => {
    computeContextListeners.delete(listener);
  };
};

/** Calls `listener` with every batch _requestTimestampResolve resolves: the render and the
 * compute durations in ms by context uid (a map is empty while its pool doesn't exist, the
 * compute one until something dispatches; a pool that read nothing new hands its last batch).
 * @returns a function that removes the listener */
export const _onTimestampsResolved = (listener: ResolveListener) => {
  resolveListeners.add(listener);
  return () => {
    resolveListeners.delete(listener);
  };
};

const handResolvedBatches = () => {
  const pools = resolvingBackend?.timestampQueryPool;
  const render = pools?.[TimestampQuery.RENDER]?.timestamps ?? NO_TIMESTAMPS;
  const compute = pools?.[TimestampQuery.COMPUTE]?.timestamps ?? NO_TIMESTAMPS;
  for (const listener of resolveListeners) listener(render, compute);
};

const logResolveError = (err: unknown) => {
  // Eg. a lost device: every later frame with records would reject the same way
  if (hasLoggedResolveError) return;
  hasLoggedResolveError = true;
  lerror('GPU timer: resolving the timestamps failed (logged once)', err);
};

const endResolve = () => {
  isResolving = false;
  resolvingBackend = null;
};

/** Resolves the render timestamps, and the compute ones once their pool exists (unless a
 * resolve is already running), and hands the batches to every listener. WebGPU: concurrent
 * resolves share one promise, and a pool keeps the last resolved batch until the next one.
 * WebGL: a concurrent resolve returns at once, and the queries opened while one runs are lost
 * when it ends (three's pool clears its offsets then). */
export const _requestTimestampResolve = () => {
  if (isResolving || !renderer || !backend || !gpuAvailable) return;
  isResolving = true;
  resolvingBackend = backend;
  const render = renderer.resolveTimestampsAsync(TimestampQuery.RENDER);
  const resolved = backend.timestampQueryPool[TimestampQuery.COMPUTE]
    ? Promise.all([render, renderer.resolveTimestampsAsync(TimestampQuery.COMPUTE)])
    : render;
  resolved.then(handResolvedBatches).catch(logResolveError).finally(endResolve);
};

/**
 * Keeps, in place, the uids of `uids` whose timestamp query runs, and returns `uids`. WebGPU
 * times every context. WebGL times one at a time: a context opened inside another has no query
 * (its time is in the outer one's), so it is dropped here, and a frame's GPU time is the sum of
 * what's left. Call it once the contexts have finished (their queries ended) and before the
 * next resolve: a uid three's pool no longer knows (a resolve cleared it) is kept, and never
 * resolves.
 */
export const _keepTimedUids = (uids: string[]) => {
  if (!backend || backend.isWebGPUBackend) return uids;
  let kept = 0;
  for (let i = 0; i < uids.length; i++) {
    const uid = uids[i];
    const pool =
      backend.timestampQueryPool[
        uid.startsWith('c:') ? TimestampQuery.COMPUTE : TimestampQuery.RENDER
      ];
    const offset = pool?.queryOffsets.get(uid);
    const state = offset === undefined ? undefined : pool?.queryStates?.get(offset);
    if (state !== 'inactive') uids[kept++] = uid;
  }
  uids.length = kept;
  return uids;
};

/** The summed GPU ms of these render contexts, or null while any of them is missing. */
export const _sumGpuMs = (timestamps: ReadonlyMap<string, number>, uids: string[]) => {
  let total = 0;
  for (let i = 0; i < uids.length; i++) {
    const ms = timestamps.get(uids[i]);
    if (ms === undefined) return null;
    total += ms;
  }
  return total;
};
