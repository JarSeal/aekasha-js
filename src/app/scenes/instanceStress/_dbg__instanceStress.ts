import { ECSSystemStage, APP_RENDER_SYNC_ORDER, getRenderer, loadScene, lwarn } from 'aekasha';
import type { ECSWorld } from 'aekasha';
import { createDebuggerTab, registerStatsSource } from 'aekasha/debug';
import { readInstanceSetStatsAsync, type InstanceSetBackendKind } from 'aekasha/instancing';
import { getLodFrameStats } from 'aekasha/lod';
import {
  INSTANCE_STRESS_COUNTS,
  INSTANCE_STRESS_SCENE_ID,
  instanceStressSettings,
  instanceStressState,
  onInstanceStressExit,
} from './instanceStress';

// The instance stress scene's measuring (debug env, p354 Phase 0): systems at fractional orders
// around the engine's bracket the CPU path's parts in every frame, without touching the engine:
// - the pool sync: everything at `POSE_PRODUCERS` (order 0) in APP_RENDER_SYNC, where
//   `instancedMeshPoolSync` is the only system with work in this scene;
// - the LOD: everything at `LOD_SELECTION` (-1.5), the selection, the apply and the fades;
// - the render submit: from the last APP_RENDER_SYNC system to the first LATE_MAIN one;
// - the CPU frame: from the first MAIN system to the first LATE_MAIN one (the update and the
//   render submit, not three's own animation frame).
// The window global `__aekInstanceStress` is the measuring harness's: `measure(frames)` averages
// the next `frames` frames. The tab and the profiler's App rows show the same figures live, over
// one-second windows. The GPU path's per-level counts come from the set's readback
// (`readInstanceSetStatsAsync`), a few times a second; its dispatches are in the render submit.

const TAB_ID = 'instanceStressDemo';
const PROBE_PREFIX = 'instanceStress:';
/** Far above and below anything the engine registers in the stage */
const FIRST = 1e9;
const LAST = -1e9;

/** A frame's figures */
type FrameFigures = {
  poolSyncMs: number;
  lodMs: number;
  lodSelectionMs: number;
  renderMs: number;
  cpuMs: number;
  intervalMs: number;
  lodApplies: number;
  lodFading: number;
  drawCalls: number;
  triangles: number;
};
const FIGURE_KEYS: (keyof FrameFigures)[] = [
  'poolSyncMs',
  'lodMs',
  'lodSelectionMs',
  'renderMs',
  'cpuMs',
  'intervalMs',
  'lodApplies',
  'lodFading',
  'drawCalls',
  'triangles',
];

const createFigures = (): FrameFigures => ({
  poolSyncMs: 0,
  lodMs: 0,
  lodSelectionMs: 0,
  renderMs: 0,
  cpuMs: 0,
  intervalMs: 0,
  lodApplies: 0,
  lodFading: 0,
  drawCalls: 0,
  triangles: 0,
});

/** Sums and maxima over frames */
class FigureWindow {
  frames = 0;
  sum = createFigures();
  max = createFigures();
  add(frame: FrameFigures) {
    this.frames++;
    for (const key of FIGURE_KEYS) {
      this.sum[key] += frame[key];
      if (frame[key] > this.max[key]) this.max[key] = frame[key];
    }
  }
  /** The averages and maxima, and the instances per level right now */
  summarize() {
    const avg = createFigures();
    for (const key of FIGURE_KEYS) avg[key] = this.frames ? this.sum[key] / this.frames : 0;
    return { frames: this.frames, avg, max: { ...this.max }, levels: countLevels() };
  }
  reset() {
    this.frames = 0;
    this.sum = createFigures();
    this.max = createFigures();
  }
}

/** The GPU path's last readback: the instances drawn per level (in view) */
let setDrawn: number[] = [];

/** Instances per level: the pools' (a fading one counts in both, in view or not), or the set's
 * drawn ones (in view) */
const countLevels = () => {
  if (instanceStressState.set) return setDrawn;
  const counts: number[] = [];
  for (const pool of instanceStressState.pools) {
    pool.meshes.forEach((mesh, i) => {
      counts[i] = (counts[i] ?? 0) + mesh.count;
    });
  }
  return counts;
};

export type InstanceStressSummary = ReturnType<FigureWindow['summarize']> & {
  count: number;
  pools: number;
  path: string;
  pipeline: StressPipeline;
  shadow: boolean;
  /** The renderer's: 'WebGPU' or 'WebGL2' */
  backend: string;
  /** What draws the set ('GPU', 'CPU'), null on the pool path */
  setBackend: InstanceSetBackendKind | null;
  /** The GPU path's instances in view past a visible list's budget, per level (a readback) */
  overflow?: number[];
  /** The GPU path's other cameras drawing the set (a shadow, a viewport): each one's drawn copies
   * per level (a readback) */
  cameras?: { name: string; drawn: number[] }[];
  /** Every instance's state at the last frame: per level (a fading one in both), culled and
   * fading. The CPU path's from its pools and the LOD stats, the GPU path's from a readback */
  state?: { levels: number[]; culled: number; fading: number };
  /** three's build caches, the whole renderer's (debug only, its private fields): node builds,
   * render pipelines, vertex and fragment programs */
  builds: { nodeBuilds: number; pipelines: number; vertex: number; fragment: number };
};

/** The drawing pipeline the scene renders with: three's standard one, or three r187's
 * experimental GPU-driven `MeshletDrawingPipeline` (p354 Phase 0's drop-in, WebGPU only) */
type StressPipeline = 'standard' | 'meshlet';

/** Switches to `?stressPipeline=meshlet`'s pipeline for this load of the scene (back to the one
 * before on its exit), and returns the pipeline it renders with. */
const useStressPipelineAsync = async (): Promise<StressPipeline> => {
  const wanted = new URLSearchParams(window.location.search).get('stressPipeline');
  const renderer = getRenderer();
  const isWebGPU = Boolean(
    (renderer?.backend as { isWebGPUBackend?: boolean } | undefined)?.isWebGPUBackend
  );
  if (wanted !== 'meshlet' || !renderer || !isWebGPU) return 'standard';
  // An instance set dispatches through the engine's drawing pipeline, which this would replace
  if (instanceStressState.set) {
    lwarn(
      "Instance stress: ?stressPipeline=meshlet is for the pools; an instance set keeps the engine's pipeline."
    );
    return 'standard';
  }
  const { MeshletDrawingPipeline } = await import(
    'three/examples/jsm/pipelines/MeshletDrawingPipeline.js'
  );
  const previous = renderer.drawingPipeline;
  const meshlet = new MeshletDrawingPipeline();
  renderer.drawingPipeline = meshlet;
  onInstanceStressExit(() => {
    renderer.drawingPipeline = previous;
    meshlet.dispose();
  });
  return 'meshlet';
};

/** Frames between two of the GPU path's live readbacks */
const READBACK_FRAMES = 20;
let readbackFrames = 0;
let isReadbackPending = false;

/** Reads the set's drawn counts back every READBACK_FRAMES frames, one read at a time. */
const readSetLevels = () => {
  const set = instanceStressState.set;
  if (!set || isReadbackPending || ++readbackFrames < READBACK_FRAMES) return;
  readbackFrames = 0;
  isReadbackPending = true;
  void readInstanceSetStatsAsync(set).then((stats) => {
    isReadbackPending = false;
    if (stats && instanceStressState.set === set) setDrawn = stats.drawn;
  });
};

/** Installs the measuring systems for this load of the scene (removed on its exit), the window
 * global, the profiler's App rows and the scene's tab. */
export const installInstanceStressProbe = async (world: ECSWorld) => {
  // This load's set: the last load's readback is no longer its
  setDrawn = [];
  readbackFrames = 0;
  const pipeline = await useStressPipelineAsync();
  const frame = createFigures();
  const marks = { frameStart: 0, lastFrameStart: 0, syncStart: 0, lodStart: 0, renderStart: 0 };
  const live = new FigureWindow();
  let shown = live.summarize();
  let liveStart = 0;
  let pending: { window: FigureWindow; left: number; resolve: (s: FigureWindow) => void } | null =
    null;

  const systems: [ECSSystemStage, string, () => void, number][] = [
    [
      ECSSystemStage.MAIN,
      'frameStart',
      () => {
        const now = performance.now();
        frame.intervalMs = marks.frameStart ? now - marks.frameStart : 0;
        marks.frameStart = now;
      },
      FIRST,
    ],
    [
      ECSSystemStage.APP_RENDER_SYNC,
      'syncStart',
      () => (marks.syncStart = performance.now()),
      APP_RENDER_SYNC_ORDER.POSE_PRODUCERS + 0.25,
    ],
    [
      ECSSystemStage.APP_RENDER_SYNC,
      'syncEnd',
      () => (frame.poolSyncMs = performance.now() - marks.syncStart),
      APP_RENDER_SYNC_ORDER.POSE_PRODUCERS - 0.25,
    ],
    [
      ECSSystemStage.APP_RENDER_SYNC,
      'lodStart',
      () => (marks.lodStart = performance.now()),
      APP_RENDER_SYNC_ORDER.LOD_SELECTION + 0.25,
    ],
    [
      ECSSystemStage.APP_RENDER_SYNC,
      'lodEnd',
      () => {
        frame.lodMs = performance.now() - marks.lodStart;
        const lodStats = getLodFrameStats(world);
        frame.lodSelectionMs = lodStats.selectionMs;
        frame.lodApplies = lodStats.applies;
        frame.lodFading = lodStats.fading;
      },
      APP_RENDER_SYNC_ORDER.LOD_SELECTION - 0.25,
    ],
    [
      ECSSystemStage.APP_RENDER_SYNC,
      'renderStart',
      () => (marks.renderStart = performance.now()),
      LAST,
    ],
    [
      ECSSystemStage.LATE_MAIN,
      'frameEnd',
      () => {
        const now = performance.now();
        frame.renderMs = now - marks.renderStart;
        frame.cpuMs = now - marks.frameStart;
        readSetLevels();
        const render = getRenderer()?.info.render;
        frame.drawCalls = render?.drawCalls ?? 0;
        frame.triangles = render?.triangles ?? 0;
        live.add(frame);
        if (now - liveStart >= 1000) {
          shown = live.summarize();
          live.reset();
          liveStart = now;
        }
        if (pending) {
          pending.window.add(frame);
          if (--pending.left <= 0) {
            pending.resolve(pending.window);
            pending = null;
          }
        }
      },
      FIRST,
    ],
  ];
  for (const [stage, id, fn, order] of systems)
    world.addSystem(stage, PROBE_PREFIX + id, fn, order);

  /** three's private caches, read for the build counts (p354 Phase 0 part 3) */
  type RendererCaches = {
    _nodes?: { nodeBuilderCache?: Map<string, unknown> };
    _pipelines?: {
      caches?: Map<string, unknown>;
      programs?: { vertex: Map<string, unknown>; fragment: Map<string, unknown> };
    };
  };
  const countBuilds = () => {
    const caches = getRenderer() as unknown as RendererCaches | null;
    return {
      nodeBuilds: caches?._nodes?.nodeBuilderCache?.size ?? 0,
      pipelines: caches?._pipelines?.caches?.size ?? 0,
      vertex: caches?._pipelines?.programs?.vertex.size ?? 0,
      fragment: caches?._pipelines?.programs?.fragment.size ?? 0,
    };
  };

  const summarize = (window: FigureWindow): InstanceStressSummary => ({
    ...window.summarize(),
    builds: countBuilds(),
    count: instanceStressState.count,
    pools: instanceStressState.pools.length,
    path: instanceStressState.path,
    pipeline,
    shadow: instanceStressSettings.shadow,
    setBackend: instanceStressState.set?.backend ?? null,
    backend: (getRenderer()?.backend as { isWebGPUBackend?: boolean } | undefined)?.isWebGPUBackend
      ? 'WebGPU'
      : 'WebGL2',
  });

  const api = {
    /** Averages the next `frames` frames (one measurement at a time: a second call replaces the
     * first, which never resolves). `startOrbit` starts a held orbit (`?stressOrbitHold=true`)
     * with the first measured frame. */
    measure: (frames: number, startOrbit = false) =>
      new Promise<InstanceStressSummary>((resolve) => {
        if (startOrbit) instanceStressState.orbiting = true;
        pending = {
          window: new FigureWindow(),
          left: Math.max(1, frames),
          resolve: (w) => {
            const summary = summarize(w);
            const set = instanceStressState.set;
            if (!set) {
              const levels = countLevels();
              const drawn = levels.reduce((sum, n) => sum + n, 0) - frame.lodFading;
              const culled = instanceStressState.count - drawn;
              resolve({ ...summary, state: { levels, culled, fading: frame.lodFading } });
              return;
            }
            // Queued now, after this frame's work: the counts and the state of its last dispatch
            void readInstanceSetStatsAsync(set, { state: true }).then((stats) =>
              resolve({
                ...summary,
                levels: stats?.drawn ?? [],
                overflow: stats?.overflow,
                cameras: stats?.slots
                  .filter((slot) => slot.camera !== 'main')
                  .map((slot) => ({ name: slot.camera, drawn: slot.drawn })),
                state: stats?.state && {
                  levels: stats.state.levels,
                  culled: stats.state.culled,
                  fading: stats.state.fading,
                },
              })
            );
          },
        };
      }),
    /** The set's readback now (every camera's slot; `state: true` adds the state counted), or
     * null on the pool path */
    stats: (state = false) => {
      const set = instanceStressState.set;
      return set ? readInstanceSetStatsAsync(set, { state }) : Promise.resolve(null);
    },
    /** three's render pipeline cache keys (debug: what differs between two pipelines) */
    pipelineKeys: () => [
      ...((getRenderer() as unknown as RendererCaches | null)?._pipelines?.caches?.keys() ?? []),
    ],
    /** The last one-second window */
    read: () => ({ ...shown, count: instanceStressState.count }),
  };
  (window as unknown as { __aekInstanceStress?: typeof api }).__aekInstanceStress = api;

  const sources = (
    [
      ['poolSyncMs', 'Pool sync (ms)'],
      ['lodMs', 'LOD systems (ms)'],
      ['renderMs', 'Render submit (ms)'],
      ['cpuMs', 'CPU frame (ms)'],
    ] as const
  ).map(([key, label]) =>
    registerStatsSource({
      id: `instanceStress.${key}`,
      label: `Stress: ${label}`,
      read: () => shown.avg[key],
      format: (value) => value.toFixed(3),
    })
  );

  onInstanceStressExit(() => {
    for (const [, id] of systems) world.removeSystem(PROBE_PREFIX + id);
    for (const remove of sources) remove();
    delete (window as unknown as { __aekInstanceStress?: unknown }).__aekInstanceStress;
  });

  createInstanceStressTab(() => shown);
};

const formatLive = (summary: ReturnType<FigureWindow['summarize']>) => {
  const { avg, max, levels } = summary;
  const ms = (key: keyof FrameFigures) => `${avg[key].toFixed(3)} (max ${max[key].toFixed(3)})`;
  const { set } = instanceStressState;
  const where = set
    ? `an instance set (${set.backend})`
    : `${instanceStressState.pools.length} pools`;
  return [
    `Instances: ${instanceStressState.count.toLocaleString()} in ${where}`,
    `Per level: ${levels.map((n) => n.toLocaleString()).join(' / ')}`,
    `Pool sync ms: ${ms('poolSyncMs')}`,
    `LOD systems ms: ${ms('lodMs')} (selection ${avg.lodSelectionMs.toFixed(3)})`,
    `LOD applies per frame: ${avg.lodApplies.toFixed(1)}, fading: ${avg.lodFading.toFixed(0)}`,
    `Render submit ms: ${ms('renderMs')}`,
    `CPU frame ms: ${ms('cpuMs')}`,
    `Frame interval ms: ${avg.intervalMs.toFixed(2)}`,
    `Draws: ${avg.drawCalls.toFixed(0)}, triangles: ${Math.round(avg.triangles).toLocaleString()}`,
  ].join('\n');
};

/** The scene's tab: the count, the tile size and the camera, the reload, and the live figures. */
const createInstanceStressTab = (getShown: () => ReturnType<FigureWindow['summarize']>) => {
  // A monitor polls its target: the getter formats the last window on every read
  const readout = {
    get text() {
      return formatLive(getShown());
    },
  };
  createDebuggerTab({
    id: TAB_ID,
    title: 'Instance stress',
    icon: 'easel',
    sceneId: INSTANCE_STRESS_SCENE_ID,
    content: () => [
      {
        pane: true,
        content: [
          {
            label: 'Instances (next load)',
            target: instanceStressSettings,
            key: 'count',
            options: INSTANCE_STRESS_COUNTS.map((value) => ({
              text: value.toLocaleString(),
              value,
            })),
          },
          {
            label: 'Tile side (trees)',
            target: instanceStressSettings,
            key: 'tileSide',
            options: [32, 64, 128, 256, 1024].map((value) => ({ text: String(value), value })),
          },
          {
            label: 'Path (next load)',
            target: instanceStressSettings,
            key: 'path',
            options: [
              { text: 'CPU: instanced LOD pools', value: 'CPU' },
              { text: 'GPU: an instance set', value: 'GPU' },
            ],
          },
          {
            label: 'Sun shadow (next load)',
            target: instanceStressSettings,
            key: 'shadow',
          },
          {
            label: 'Camera',
            target: instanceStressSettings,
            key: 'camera',
            options: [
              { text: 'Circle inside the forest', value: 'ORBIT' },
              { text: 'Stay', value: 'STILL' },
            ],
          },
          {
            type: 'button',
            title: 'Reload the scene',
            onClick: () => void loadScene({ sceneId: INSTANCE_STRESS_SCENE_ID }),
          },
          {
            label: 'Live (1 s window)',
            target: readout,
            key: 'text',
            readonly: true,
            multiline: true,
            rows: 10,
          },
        ],
      },
    ],
  });
};
