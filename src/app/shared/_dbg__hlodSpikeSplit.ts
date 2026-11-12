import type * as THREE from 'three/webgpu';
import { ECSSystemStage, getRenderer, getRootScene, registerOnAllSceneExits } from 'aekasha';
import type { ECSWorld } from 'aekasha';

// p378 Phase 0's probe additions (docs/plans/_DONE_p378_baked-members-out-of-the-scene-graph.md, "What
// the spike adds"), for `cpuSplitAsync` (`_dbg__hlodSpikeDraws.ts`): the rest of the CPU frame's
// split, and one walk a frame.
//
// - `createSystemTimer`: every system of the world (each stage's entries, but the probe's own
//   `hlodSpike:` ones) wrapped by id while it measures, each frame's time per system summed.
//   `ECSWorld`'s `systems` map is private: the spike reads it through a typed cast here, never in
//   the engine. A system added meanwhile isn't timed.
// - `createProjectionTimer`: the root scene's `StandardDrawingPipeline.project` calls (three's
//   projection walk, every render: the scene pass, PostFX's depth / normal pre-pass and each
//   shadow map) timed and counted per frame, each render's kind apart: a camera other than the
//   active one is a shadow's, the active one with an MRT set the pre-pass (the only one PostFX
//   gives an MRT), else the scene pass. Its recursion runs the original method (the wrapper puts
//   it in its place for the call), so the wrapper costs a call per render, not per object.
// - `installWalkOnce` (`?hlodFieldWalk=once`, D5): the root scene's `updateMatrixWorld` runs once
//   per main loop frame: the frame's first call walks, a later one returns at once (counted),
//   until the last `APP_RENDER_SYNC` system, right before the render, starts the next frame. What
//   one walk a frame instead of two (the scene pass and the AO pre-pass) would save. A scene exit
//   takes it off.
//
// `performance.now()` is coarsened to 5 µs in a cross-origin isolated page (the dev server is):
// a system's per-frame figure below that is noise, its sum over the frames isn't.

type SystemFn = (world: ECSWorld, dt: number) => void;
type SystemEntry = { id: string; fn: SystemFn };
/** `ECSWorld`'s private systems map, as the spike reads it */
type WorldSystems = { systems: Map<ECSSystemStage, SystemEntry[]> };

const PROBE_PREFIX = 'hlodSpike:';
const WALK_ONCE_SYSTEM_ID = `${PROBE_PREFIX}walkOnceFrame`;

/** The projection's render kinds. */
export type ProjectionKind = 'scene' | 'prePass' | 'shadow';
const PROJECTION_KINDS: readonly ProjectionKind[] = ['scene', 'prePass', 'shadow'];

/**
 * Wraps every system of `world` (but the probe's own) with a timer until `restore()`.
 * `takeFrame()` ends a frame: each system's time since the last call goes to its series, and it
 * returns the frame's sum outside `LATE_MAIN` (which runs after the probe's frame end).
 */
export const createSystemTimer = (world: ECSWorld) => {
  const { systems } = world as unknown as WorldSystems;
  const ids: string[] = [];
  const counted: boolean[] = [];
  const frameMs: number[] = [];
  const wrapped: { entry: SystemEntry; fn: SystemFn }[] = [];
  for (const [stage, list] of systems) {
    for (const entry of list) {
      if (entry.id.startsWith(PROBE_PREFIX)) continue;
      const index = ids.length;
      ids.push(`${stage}:${entry.id}`);
      counted.push(stage !== ECSSystemStage.LATE_MAIN);
      frameMs.push(0);
      const fn = entry.fn;
      wrapped.push({ entry, fn });
      entry.fn = (w, dt) => {
        const startedAt = performance.now();
        fn(w, dt);
        frameMs[index] += performance.now() - startedAt;
      };
    }
  }
  const series: number[][] = ids.map(() => []);
  return {
    takeFrame: () => {
      let sum = 0;
      for (let i = 0; i < ids.length; i++) {
        series[i].push(frameMs[i]);
        if (counted[i]) sum += frameMs[i];
        frameMs[i] = 0;
      }
      return sum;
    },
    restore: () => {
      for (const { entry, fn } of wrapped) entry.fn = fn;
    },
    /** Each system's per-frame times, `<stage>:<id>` */
    series: () => ids.map((id, i) => ({ id, values: series[i] })),
  };
};

type ProjectFn = (
  object: THREE.Object3D,
  camera: THREE.Camera,
  groupOrder: number,
  renderList: unknown,
  clippingContext: unknown
) => void;

/**
 * Times the root scene's projection walks until `restore()`. `takeFrame()` ends a frame: each
 * kind's time and calls since the last call.
 */
export const createProjectionTimer = (getActiveCamera: () => THREE.Camera | undefined) => {
  const renderer = getRenderer();
  const root = getRootScene();
  if (!renderer || !root)
    throw new Error('The projection timer needs the renderer and the root scene.');
  const pipeline = renderer.drawingPipeline as unknown as { project: ProjectFn };
  const hadOwn = Object.prototype.hasOwnProperty.call(pipeline, 'project');
  const original = pipeline.project;
  const ms: Record<ProjectionKind, number> = { scene: 0, prePass: 0, shadow: 0 };
  const calls: Record<ProjectionKind, number> = { scene: 0, prePass: 0, shadow: 0 };

  const wrapper: ProjectFn = function (
    this: unknown,
    object,
    camera,
    groupOrder,
    renderList,
    clippingContext
  ) {
    if (object !== root) {
      original.call(this, object, camera, groupOrder, renderList, clippingContext);
      return;
    }
    const kind: ProjectionKind =
      camera !== getActiveCamera() ? 'shadow' : renderer.getMRT() ? 'prePass' : 'scene';
    // The recursion (`this.project`) goes straight to the original
    pipeline.project = original;
    const startedAt = performance.now();
    try {
      original.call(this, object, camera, groupOrder, renderList, clippingContext);
    } finally {
      pipeline.project = wrapper;
    }
    ms[kind] += performance.now() - startedAt;
    calls[kind]++;
  };
  pipeline.project = wrapper;

  const series = Object.fromEntries(
    PROJECTION_KINDS.map((kind) => [kind, { ms: [] as number[], calls: [] as number[] }])
  ) as Record<ProjectionKind, { ms: number[]; calls: number[] }>;
  return {
    /** Ends a frame; returns its projection time over every kind */
    takeFrame: () => {
      let sum = 0;
      for (const kind of PROJECTION_KINDS) {
        series[kind].ms.push(ms[kind]);
        series[kind].calls.push(calls[kind]);
        sum += ms[kind];
        ms[kind] = 0;
        calls[kind] = 0;
      }
      return sum;
    },
    restore: () => {
      if (hadOwn) pipeline.project = original;
      else delete (pipeline as Partial<{ project: ProjectFn }>).project;
    },
    series: () => series,
  };
};

/** The walk-once wrapper's skipped calls since the last read, or null when it isn't on. */
export type WalkOnce = { takeSkipped: () => number } | null;

/** With `?hlodFieldWalk=once`: the root scene walked once per main loop frame until the scene's
 * exit. */
export const installWalkOnce = (world: ECSWorld): WalkOnce => {
  if (new URLSearchParams(window.location.search).get('hlodFieldWalk') !== 'once') return null;
  const root = getRootScene();
  if (!root) throw new Error('Walk-once needs the root scene.');
  const hadOwn = Object.prototype.hasOwnProperty.call(root, 'updateMatrixWorld');
  const original = root.updateMatrixWorld;
  let walked = false;
  let skipped = 0;
  root.updateMatrixWorld = function (this: THREE.Scene, force?: boolean) {
    if (walked) {
      skipped++;
      return;
    }
    walked = true;
    original.call(this, force);
  };
  // After every other APP_RENDER_SYNC system (the probe's render mark is at -1e9): the render's
  // first walk is the frame's
  world.addSystem(
    ECSSystemStage.APP_RENDER_SYNC,
    WALK_ONCE_SYSTEM_ID,
    () => (walked = false),
    -2e9
  );
  let installed = true;
  registerOnAllSceneExits('hlodSpikeWalkOnce', () => {
    // Once: the listener stays registered for later scenes' exits
    if (!installed) return;
    installed = false;
    world.removeSystem(WALK_ONCE_SYSTEM_ID);
    if (hadOwn) root.updateMatrixWorld = original;
    else delete (root as Partial<THREE.Scene>).updateMatrixWorld;
  });
  return {
    takeSkipped: () => {
      const n = skipped;
      skipped = 0;
      return n;
    },
  };
};
