import type { Renderer } from 'three/webgpu';
import { addDebugToast, openDebuggerTab } from '../DebuggerGUI';
import { GPU_MEMORY_TAB_ID } from '../GPUMemory';
import { createProfilerTab, updateProfilerTab } from '../Profiler';
import { CMP } from '../../ui/core/CMP';
import { IS_DEBUG_ENV } from '../../kernel/config/Config';
import { llog } from '../../utils/Logger';
import { ECSSystemStage } from '../../kernel/loop/SystemStages';
import { ECSWorld, getECSWorld } from '../../kernel/ecs/ECS';
import { getRenderer, onRendererCreated } from '../../kernel/render/Renderer';
import { getCurrentSceneId, registerOnAllSceneEnters } from '../../kernel/scene/Scene';
import { addViewFrameListener } from '../../kernel/render/Views';
import { formatBytes, formatNumber } from '../../kernel/assets/debug/_dbg__AssetStats';
import { installCompressedTextureSizer } from './_dbg__GPUMemoryOwners';
import { registerEngineGPUMemorySources } from './_dbg__GPUMemorySources';
import {
  ALLOCATION_KIND_LABELS,
  installAllocationTracker,
  setRecordAllocationSites,
} from './_dbg__GPUMemoryAllocations';
import {
  clearGPUMemorySnapshot,
  getGPUMemoryDiff,
  getGPUMemorySnapshot,
  takeGPUMemorySnapshot,
  type GPUMemoryDiff,
} from './_dbg__GPUMemorySnapshots';
import {
  createGPUMemoryView,
  FRAME_METRICS,
  formatTime,
  getOwnerLabel,
  MEMORY_CATEGORIES,
  type GPUMemoryPeak,
} from './_dbg__GPUMemoryView';
import styles from './GPUMemory.module.scss';

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
 * The live sections are the UI kit's tables and stacked bar (p807 D8, `_dbg__GPUMemoryView.ts`),
 * built once per mount and written in place on each refresh (D9).
 */

const LS_KEY = 'AEK_debugGPUMemory';
const DEFAULT_BUDGET_MB = 512;
/** Frame counters are summarised (min / avg / max) per window of this length. */
const FRAME_WINDOW_MS = 500;
/** No sampled frame for this long reads as a paused main loop. */
const PAUSED_AFTER_MS = 1000;
const MB = 1024 * 1024;

/** Rows per diff table; "Log diff" prints them all. */
const DIFF_MAX_ROWS = 12;

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

const esc = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string
  );

const ownerLabel = (owner: string) => esc(getOwnerLabel(owner));

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

// --- SNAPSHOTS ---

const formatDelta = (delta: number, format: (n: number) => string) =>
  delta === 0 ? '0' : `${delta > 0 ? '+' : '−'}${format(Math.abs(delta))}`;
const formatBytesDelta = (delta: number) => formatDelta(delta, formatBytes);
const formatCountDelta = (delta: number) => formatDelta(delta, formatNumber);

const moreRow = (total: number, columns: number) =>
  total > DIFF_MAX_ROWS
    ? `<tr class="${styles.gpuMemoryUntracked}"><td colspan="${columns}">+${formatNumber(total - DIFF_MAX_ROWS)} more (Log diff lists all)</td></tr>`
    : '';

/** One row per info.memory category that changed, by its size and count keys. */
const memoryChangeRows = (diff: GPUMemoryDiff) => {
  const delta = (key: string) => {
    const change = diff.memory.find((c) => c.key === key);
    return change ? change.after - change.before : 0;
  };
  const rows = [
    ...MEMORY_CATEGORIES.map((c) => ({
      label: c.label,
      size: delta(c.size),
      count: delta(c.count),
    })),
    { label: 'Render targets', size: 0, count: delta('renderTargets') },
    { label: 'Geometries', size: 0, count: delta('geometries') },
  ].filter((row) => row.size !== 0 || row.count !== 0);
  return { total: delta('total'), rows };
};

const snapshotHtml = () => {
  const renderer = getRenderer();
  const snapshot = getGPUMemorySnapshot();
  if (!renderer || !snapshot) {
    return `<div class="${styles.gpuMemorySummary}">
  <h4 class="${styles.gpuMemoryHeading}">Snapshot</h4>
  <div class="${styles.gpuMemoryNote}">No snapshot. For leak hunting: take one in scene A, go to scene B and back to A, and the diff lists what B left allocated.</div>
</div>`;
  }
  const diff = getGPUMemoryDiff(renderer)!;
  const { total, rows } = memoryChangeRows(diff);

  const categoryRows = rows
    .map(
      (row) =>
        `<tr><td>${row.label}</td><td>${row.size ? formatBytesDelta(row.size) : ''}</td><td>${formatCountDelta(row.count)}</td></tr>`
    )
    .join('');
  const assetRows = diff.assets
    .slice(0, DIFF_MAX_ROWS)
    .map(
      (change) =>
        `<tr><td class="${styles.gpuMemoryWrap}" title="${esc(change.key)}">${esc(change.id)}<br><span class="${styles.gpuMemoryDim}">${change.kind}, ${ownerLabel(change.owner)}</span></td><td>${change.before ? formatBytes(change.before) : 'new'}</td><td>${change.after ? formatBytes(change.after) : 'gone'}</td><td>${formatBytesDelta(change.after - change.before)}</td></tr>`
    )
    .join('');
  const leftRows = diff.leftBehind
    .slice(0, DIFF_MAX_ROWS)
    .map(
      (group) =>
        `<tr><td class="${styles.gpuMemoryWrap}">${ALLOCATION_KIND_LABELS[group.kind]}: ${esc(group.label)}<br><span class="${styles.gpuMemoryDim}">${ownerLabel(group.scene)}, visit ${group.visit}${group.site ? ` · ${esc(group.site)}` : ''}${group.collected ? ` · ${formatNumber(group.collected)} collected` : ''}</span></td><td>${formatNumber(group.count)}</td><td>${formatBytes(group.bytes)}</td></tr>`
    )
    .join('');
  const assetsNew = diff.assets.filter((change) => !change.before).length;
  const assetsGone = diff.assets.filter((change) => !change.after).length;
  const assetsNet = diff.assets.reduce((sum, change) => sum + change.after - change.before, 0);
  const leftBytes = diff.leftBehind.reduce((sum, group) => sum + group.bytes, 0);
  const leftCount = diff.leftBehind.reduce((sum, group) => sum + group.count, 0);

  return `<div class="${styles.gpuMemorySummary}">
  <h4 class="${styles.gpuMemoryHeading}">Since the snapshot in ${ownerLabel(snapshot.sceneId)} at ${formatTime(snapshot.at)}</h4>
  <div class="${styles.gpuMemoryTotalRow}"><span>Total</span><strong>${formatBytesDelta(total)}</strong></div>
  ${
    categoryRows
      ? `<table class="${styles.gpuMemoryTable}">
    <thead><tr><th>Category</th><th>Size</th><th>Count</th></tr></thead>
    <tbody>${categoryRows}</tbody>
  </table>`
      : `<div class="${styles.gpuMemoryNote}">No category changed.</div>`
  }
  ${
    leftRows
      ? `<table class="${styles.gpuMemoryTable}">
    <thead><tr><th>Left behind (scene, visit)</th><th>Count</th><th>Size</th></tr></thead>
    <tbody>${leftRows}${moreRow(diff.leftBehind.length, 3)}</tbody>
    <tfoot><tr><td>Total</td><td>${formatNumber(leftCount)}</td><td>${formatBytes(leftBytes)}</td></tr></tfoot>
  </table>`
      : `<div class="${styles.gpuMemoryNote}">No earlier scene visit since the snapshot left anything allocated.</div>`
  }
  ${
    assetRows
      ? `<table class="${styles.gpuMemoryTable}">
    <thead><tr><th>Registered asset (${formatNumber(assetsNew)} new, ${formatNumber(assetsGone)} gone, net ${formatBytesDelta(assetsNet)})</th><th>Then</th><th>Now</th><th>Change</th></tr></thead>
    <tbody>${assetRows}${moreRow(diff.assets.length, 4)}</tbody>
  </table>`
      : `<div class="${styles.gpuMemoryNote}">No registered asset changed.</div>`
  }
  <div class="${styles.gpuMemoryNote}">Since the snapshot: ${formatNumber(diff.currentVisit.count)} allocations (${formatBytes(diff.currentVisit.bytes)}) made in this scene visit are still live, and ${formatNumber(diff.freed.count)} that existed at the snapshot (${formatBytes(diff.freed.bytes)}) were freed. "Left behind" lists what the snapshot's scene visit and the visits after it, up to this one, created and is still counted: what a scene left behind, or something long-lived it created first (a new visit starts on every scene load, so the same scene twice is two visits). Collected ones were garbage collected without being destroyed, so three counts them for good.${state.recordSites ? '' : ' Turn on "Call sites" to see where each one was created (from the next allocation on).'}</div>
</div>`;
};

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

/** The mounted tab's live sections (made again on each mount) */
let view: ReturnType<typeof createGPUMemoryView> | null = null;

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
    // The live sections read once; the tab's scheduler then writes their tables
    onRefresh: () => view?.update(),
    content: ({ scheduler }) => {
      view = createGPUMemoryView(viewOpts, scheduler);
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
        CMP({ html: snapshotHtml }),
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
