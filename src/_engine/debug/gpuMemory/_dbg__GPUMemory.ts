import type { Renderer } from 'three/webgpu';
import { addDebugToast, openDebuggerTab } from '../DebuggerGUI';
import { GPU_MEMORY_TAB_ID } from '../GPUMemory';
import { createProfilerTab, updateProfilerTab } from '../Profiler';
import { IS_DEBUG_ENV } from '../../kernel/config/Config';
import { llog } from '../../utils/Logger';
import { ECSSystemStage } from '../../kernel/loop/SystemStages';
import { ECSWorld, getECSWorld } from '../../kernel/ecs/ECS';
import { getRenderer, onRendererCreated } from '../../kernel/render/Renderer';
import { getCurrentSceneId, registerOnAllSceneEnters } from '../../kernel/scene/Scene';
import { addViewFrameListener } from '../../kernel/render/Views';
import { formatBytes } from '../../kernel/assets/debug/_dbg__AssetStats';
import { installCompressedTextureSizer } from './_dbg__GPUMemoryOwners';
import { registerEngineGPUMemorySources } from './_dbg__GPUMemorySources';
import { installAllocationTracker, setRecordAllocationSites } from './_dbg__GPUMemoryAllocations';
import {
  clearGPUMemorySnapshot,
  getGPUMemoryDiff,
  getGPUMemorySnapshot,
  takeGPUMemorySnapshot,
} from './_dbg__GPUMemorySnapshots';
import { createGPUMemorySnapshotView } from './_dbg__GPUMemorySnapshotView';
import {
  createGPUMemoryView,
  FRAME_METRICS,
  formatTime,
  type GPUMemoryPeak,
} from './_dbg__GPUMemoryView';

/**
 * GPU memory and draw-call tab (docs/plans/_DONE_p345_gpu-memory-and-draw-call-debugger.md), a
 * profiler window tab (docs/plans/_DONE_p344_profiler-mega-window.md §2.9). Loaded wherever the
 * profiler is, so in prodTest mode too when the profiler is enabled there. prodTest has no drawer
 * and no debug toaster: the links to drawer tabs are hidden and there is no budget toast (the
 * budget bar still shows it).
 *
 * Everything here is three's own bookkeeping (`renderer.info`) of the buffers and textures it
 * created, not a driver measurement: browsers expose no real VRAM figure.
 *
 * `info.render` is not reset per render() call but at the start of three's own animation frame,
 * which runs next to the engine's main loop. So the frame counters are read by a LATE_MAIN
 * system, right after the frame's renderScene() (MainLoop.ts), and never from the tab's refresh
 * interval: that would read 0 whenever three's reset ran last, the loop is paused or the FPS
 * limiter skipped the frame. The same system tracks the memory peaks and the budget, so they are
 * caught while the tab is closed too.
 *
 * The sections are the UI kit's tables and stacked bar (p807 D8: the live ones in
 * `_dbg__GPUMemoryView.ts`, the snapshot's in `_dbg__GPUMemorySnapshotView.ts`), built once per
 * mount and written in place on each refresh (D9).
 */

const LS_KEY = 'AEK_debugGPUMemory';
const DEFAULT_BUDGET_MB = 512;
/** Frame counters are summarised (min / avg / max) per window of this length. */
const FRAME_WINDOW_MS = 500;
/** No sampled frame for this long reads as a paused main loop. */
const PAUSED_AFTER_MS = 1000;
const MB = 1024 * 1024;

const state = { budgetMB: DEFAULT_BUDGET_MB, recordSites: false };

// --- MEMORY ---

const bootPeak: GPUMemoryPeak = { bytes: 0, at: 0 };
const scenePeak: GPUMemoryPeak = { bytes: 0, at: 0 };
/** Over-budget toast shown in the current scene (reset on scene enter and on a budget change). */
let isBudgetToastShown = false;

const raisePeak = (peak: GPUMemoryPeak, bytes: number) => {
  if (bytes <= peak.bytes) return;
  peak.bytes = bytes;
  peak.at = Date.now();
};

const trackMemory = (total: number) => {
  raisePeak(bootPeak, total);
  raisePeak(scenePeak, total);
  // No debug toaster in prodTest mode
  if (!IS_DEBUG_ENV || isBudgetToastShown || total <= state.budgetMB * MB) return;
  // addDebugToast is a no-op (null) before the debug toaster exists: try again next frame
  isBudgetToastShown = Boolean(
    addDebugToast({
      type: 'warning',
      title: 'GPU memory over budget',
      message: `${formatBytes(total)} of the ${state.budgetMB} MB budget (three's estimate). See the profiler's GPU memory tab.`,
    })
  );
};

// --- FRAME COUNTERS ---

const METRIC_COUNT = FRAME_METRICS.length;

const frameLast = new Float64Array(METRIC_COUNT);
const windowMin = new Float64Array(METRIC_COUNT);
const windowMax = new Float64Array(METRIC_COUNT);
const windowSum = new Float64Array(METRIC_COUNT);
let windowFrames = 0;
let windowStartedAt = 0;
let lastSampledAt = 0;
/** The last finished window, shown in the tab. */
const shown = {
  min: new Float64Array(METRIC_COUNT),
  max: new Float64Array(METRIC_COUNT),
  avg: new Float64Array(METRIC_COUNT),
  frames: 0,
};

const finishFrameWindow = (now: number) => {
  for (let i = 0; i < METRIC_COUNT; i++) {
    shown.min[i] = windowMin[i];
    shown.max[i] = windowMax[i];
    shown.avg[i] = windowSum[i] / windowFrames;
  }
  shown.frames = windowFrames;
  windowFrames = 0;
  windowStartedAt = now;
};

const sampleFrame = (info: Renderer['info'], now: number) => {
  frameLast[0] = info.render.drawCalls;
  frameLast[1] = info.render.triangles;
  frameLast[2] = info.render.frameCalls;
  frameLast[3] = info.compute.frameCalls;
  for (let i = 0; i < METRIC_COUNT; i++) {
    const value = frameLast[i];
    if (windowFrames === 0 || value < windowMin[i]) windowMin[i] = value;
    if (windowFrames === 0 || value > windowMax[i]) windowMax[i] = value;
    windowSum[i] = windowFrames === 0 ? value : windowSum[i] + value;
  }
  windowFrames++;
  lastSampledAt = now;
  if (now - windowStartedAt >= FRAME_WINDOW_MS) finishFrameWindow(now);
};

/** LATE_MAIN, so right after the frame's renderScene(); default world only (one renderer). */
const gpuMemorySamplerSystem = (world: ECSWorld) => {
  if (world !== getECSWorld()) return;
  sampleGPUMemory();
};

/** One frame's sample: from gpuMemorySamplerSystem, or in an editor view (Views.ts, the
 * scene's stages don't run) from an 'AFTER_RENDER' view frame listener. */
const sampleGPUMemory = () => {
  const renderer = getRenderer();
  if (!renderer) return;
  sampleFrame(renderer.info, performance.now());
  trackMemory(renderer.info.memory.total);
};

// --- TAB CONTENT ---

/** What the live sections read (`_dbg__GPUMemoryView.ts`) */
const viewOpts = {
  getRenderer: () => getRenderer(),
  getCurrentSceneId: () => getCurrentSceneId(),
  getBudgetMB: () => state.budgetMB,
  bootPeak,
  scenePeak,
  frameLast,
  frameWindow: shown,
  frameWindowMs: FRAME_WINDOW_MS,
  isPaused: () => performance.now() - lastSampledAt > PAUSED_AFTER_MS,
};

/** What the snapshot section reads (`_dbg__GPUMemorySnapshotView.ts`) */
const snapshotViewOpts = {
  getRenderer: () => getRenderer(),
  isRecordingSites: () => state.recordSites,
};

// --- SNAPSHOTS ---

const logDiff = () => {
  const renderer = getRenderer();
  const snapshot = getGPUMemorySnapshot();
  if (!renderer || !snapshot) return;
  const diff = getGPUMemoryDiff(renderer)!;
  llog(
    `[GPU memory] Diff since the snapshot in "${snapshot.sceneId}" at ${formatTime(snapshot.at)}:`,
    diff
  );
};

/** The mounted tab's sections (made again on each mount) */
let view: ReturnType<typeof createGPUMemoryView> | null = null;
let snapshotView: ReturnType<typeof createGPUMemorySnapshotView> | null = null;

export const _createGPUMemoryDebugGUI = () => {
  createProfilerTab({
    id: GPU_MEMORY_TAB_ID,
    title: 'GPU memory',
    icon: 'memory',
    // After Objects (10), before Settings (100)
    orderNr: 20,
    lsKey: LS_KEY,
    state,
    persistKeys: ['budgetMB', 'recordSites'],
    // Only writes the figures; the sampling runs in gpuMemorySamplerSystem
    refreshIntervalMs: 500,
    // Its figures span scenes (the peaks, a snapshot's diff): kept (p807 D9)
    keepOnSceneChange: true,
    // The sections read once; the tab's scheduler then writes their tables
    onRefresh: () => {
      view?.update();
      snapshotView?.update();
    },
    content: ({ scheduler }) => {
      view = createGPUMemoryView(viewOpts, scheduler);
      snapshotView = createGPUMemorySnapshotView(snapshotViewOpts, scheduler);
      return [
        ...view.cmps,
        {
          pane: true,
          content: [
            {
              key: 'budgetMB',
              label: 'Budget (MB)',
              min: 16,
              step: 16,
              onChange: (_value, e) => {
                // Re-checked against the new budget from the next frame on
                if (e.last) isBudgetToastShown = false;
              },
            },
            // Drawer tabs: there is no drawer in prodTest mode
            {
              type: 'button',
              label: 'Viewports',
              title: 'Open Debug tools',
              hidden: !IS_DEBUG_ENV,
              onClick: () => openDebuggerTab('debugToolsControls'),
            },
            {
              type: 'button',
              label: 'GPU time',
              title: 'Open PostFX profiler',
              hidden: !IS_DEBUG_ENV,
              onClick: () => openDebuggerTab('postFxControls'),
            },
          ],
        },
        snapshotView.cmp,
        {
          pane: true,
          content: [
            {
              type: 'button',
              label: 'Snapshot',
              title: 'Take snapshot',
              disabled: () => !getRenderer(),
              onClick: () => {
                const renderer = getRenderer();
                if (!renderer) return;
                takeGPUMemorySnapshot(renderer);
                updateProfilerTab(GPU_MEMORY_TAB_ID);
              },
            },
            {
              type: 'button',
              label: 'Diff',
              title: 'Log diff to console',
              disabled: () => !getGPUMemorySnapshot(),
              onClick: logDiff,
            },
            {
              type: 'button',
              label: 'Clear',
              title: 'Clear snapshot',
              disabled: () => !getGPUMemorySnapshot(),
              onClick: () => {
                clearGPUMemorySnapshot();
                updateProfilerTab(GPU_MEMORY_TAB_ID);
              },
            },
            {
              key: 'recordSites',
              label: 'Call sites',
              onChange: (value) => setRecordAllocationSites(Boolean(value)),
            },
          ],
        },
      ];
    },
  });

  // Hydrated above; the tracker is installed before the renderer's init(), so it sees everything
  setRecordAllocationSites(state.recordSites);
  onRendererCreated(installCompressedTextureSizer);
  onRendererCreated(installAllocationTracker);
  registerEngineGPUMemorySources();

  registerOnAllSceneEnters('gpuMemoryScenePeak', () => {
    // Starts from what is held now: the previous scene's assets are already released here
    scenePeak.bytes = getRenderer()?.info.memory.total ?? 0;
    scenePeak.at = Date.now();
    isBudgetToastShown = false;
  });

  ECSWorld.registerPlugin((world) => {
    world.addSystem(ECSSystemStage.LATE_MAIN, 'gpuMemorySamplerSystem', gpuMemorySamplerSystem);
  });
  addViewFrameListener(sampleGPUMemory, 'AFTER_RENDER');
};
