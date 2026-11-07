import {
  createDebuggerTab,
  debuggerListCMP,
  type DebuggerListItem,
  type DebuggerPaneItem,
  updateDebuggerTab,
} from '../../../debug/DebuggerGUI';
import { getNoteItem } from '../../../debug/_dbg__DebugWindowGrid';
import { formatBytes } from '../../../kernel/assets/debug/_dbg__AssetStats';
import {
  getStreamingBudgets,
  getStreamingDataContent,
  getStreamingFocus,
  getStreamingFocusOverride,
  getStreamingPrimeBudgets,
  getStreamingRuntime,
  getStreamingUpdateInterval,
  setStreamingFocusOverride,
  setStreamingUpdateInterval,
} from '../Streaming';
import type { StreamingRuntime } from '../StreamingCells';
import { StreamingLevel } from '../StreamingRings';
import {
  getCellStateLabel,
  getOpenStreamingCellWindowIds,
  startStreamingTransitionHistory,
  toggleStreamingCellWindow,
} from './_dbg__StreamingCellWindow';
import {
  getStreamingOverlayHeight,
  isStreamingOverlayEnabled,
  setStreamingOverlayEnabled,
  setStreamingOverlayHeight,
} from './_dbg__StreamingOverlay';
import { getCellGPUBytes, getOwnerGPUBytes } from './_dbg__StreamingMemory';
import { countFarGroups } from './_dbg__StreamingCellWindow';

// The Streaming tab (docs/plans/_DONE_p353_macro-streaming-grid.md §7): the current scene's settings,
// the focus and its cell, the cells per state, the machine's counters, the focus tools (freeze,
// teleport to a cell: the focus override `?streamingFocus=x,z` also sets), the budgets, the cell
// overlay (_dbg__StreamingOverlay.ts) and a row per tracked cell opening its window
// (_dbg__StreamingCellWindow.ts). Nothing is persisted: it's all for inspecting, and a reload
// starts from the app's values (but `?streamingFocus`). Default world only.

const STREAMING_TAB_ID = 'streamingControls';
/** Rows the cell list shows at most */
const MAX_LIST_ROWS = 200;

type Item = DebuggerPaneItem<object>;

/** The figures the tab's monitors show, written on every refresh */
type Readouts = {
  scene: string;
  focus: string;
  cells: string;
  counters: string;
  priming: string;
  fades: string;
  bodies: string;
  memory: string;
  data: string;
};

/** The cells' GPU bytes by owner key, read once per refresh (it walks every asset) */
let cellBytes = new Map<string, number>();

const COUNTED_STATES = [
  'RESIDENT',
  'NEARBY',
  'FAR',
  'QUEUED',
  'LOADING',
  'PRIMING',
  'UNLOADING',
] as const;

const formatScene = (rt: StreamingRuntime | null) => {
  if (!rt) return 'This scene doesn’t stream.';
  const { cellSize, rings, margin, nearbyPhysicsTier, fadeSeconds } = rt.settings;
  return `${rt.sceneId}: ${cellSize} m cells, rings ${rings.join(' / ')}, margin ${margin} m, NEARBY bodies ${nearbyPhysicsTier}, fades ${fadeSeconds} s`;
};

const formatFocus = (rt: StreamingRuntime | null) => {
  const override = getStreamingFocusOverride();
  const appFocus = getStreamingFocus();
  const source = override
    ? 'frozen'
    : appFocus === null
      ? 'main camera'
      : typeof appFocus === 'number'
        ? `entity ${appFocus}`
        : 'point';
  if (!rt || Number.isNaN(rt.focusX)) return `${source}, not measured yet`;
  return `${source}: ${rt.focusX.toFixed(1)}, ${rt.focusZ.toFixed(1)} (cell ${rt.focusCx}, ${rt.focusCz})`;
};

const formatCells = (rt: StreamingRuntime | null) => {
  if (!rt) return '';
  const counts: Record<string, number> = {};
  for (const cell of rt.cells.values()) {
    const state = getCellStateLabel(cell);
    counts[state] = (counts[state] ?? 0) + 1;
  }
  return COUNTED_STATES.map((state) => `${state.toLowerCase()}: ${counts[state] ?? 0}`).join('\n');
};

const formatCounters = (rt: StreamingRuntime | null) => {
  if (!rt) return '';
  const s = rt.stats;
  return [
    `loads started: ${s.loadsStarted}`,
    `loads finished: ${s.loadsFinished}`,
    `loads cancelled: ${s.loadsCancelled}`,
    `unloads: ${s.unloadsFinished}`,
    `late results: ${s.lateResults}`,
    `content errors: ${s.unitErrors}`,
    `cell releases: ${s.assetReleases}`,
    `assets freed: ${s.assetsReleased}`,
  ].join('\n');
};

const formatPriming = (rt: StreamingRuntime | null) => {
  if (!rt) return '';
  const s = rt.stats;
  return [
    `primes finished: ${s.primesFinished}`,
    `stalls (shown unprimed): ${s.primingStalls}`,
    `textures uploaded: ${s.texturesUploaded}`,
    `oversized uploads: ${s.oversizedUploads}`,
    `compiles: ${s.compiles}`,
    `new materials shown: ${s.structuresShown}`,
  ].join('\n');
};

/** The layers' fades (p353 Phase 5 D4): running now, and the counters. */
const formatFades = (rt: StreamingRuntime | null) => {
  if (!rt) return '';
  let fadingIn = 0;
  let fadingOut = 0;
  for (const cell of rt.cells.values()) {
    for (const layer of cell.layers) {
      if (layer.fade?.direction === 'IN') fadingIn++;
      else if (layer.fade) fadingOut++;
    }
  }
  const s = rt.stats;
  return [
    `running: ${fadingIn} in, ${fadingOut} out`,
    `started: ${s.fadesStarted}, turned around: ${s.fadesReversed}`,
    `shown layers taken down unfaded: ${s.unfadedTakeDowns}`,
  ].join('\n');
};

const BODY_TIERS = ['FULL', 'STATIC', 'DISABLED', 'REMOVED'] as const;

/** The cells' bodies by tier (p353 Phase 4): what the Physics API tab's tier counts should match
 * for the cells' content. */
const formatBodies = (rt: StreamingRuntime | null) => {
  const summary = rt?.bodies?.summarize?.(rt.world);
  if (!rt || !summary) return '';
  return [
    `bodies: ${summary.bodies}, handed over: ${rt.stats.bodiesAdopted}`,
    BODY_TIERS.map((tier) => `${tier.toLowerCase()} ${summary.byTier[tier] ?? 0}`).join(', '),
    `held out of the policy: ${summary.heldOutOfPolicy}`,
    `off their cell's tier: ${summary.offTier}`,
  ].join('\n');
};

/** The tracked cells' GPU bytes together, by layer, and the largest cell's. */
const formatMemory = (rt: StreamingRuntime | null) => {
  if (!rt) return '';
  let total = 0;
  let largest = 0;
  const byRange: Record<string, number> = {};
  for (const cell of rt.cells.values()) {
    const bytes = getCellGPUBytes(cellBytes, cell);
    total += bytes;
    largest = Math.max(largest, bytes);
    for (const layer of cell.layers) {
      byRange[layer.range] = (byRange[layer.range] ?? 0) + (cellBytes.get(layer.ownerKey) ?? 0);
    }
  }
  return [
    `${formatBytes(total)} in cells, the largest ${formatBytes(largest)}`,
    `near ${formatBytes(byRange.NEAR ?? 0)}, far ${formatBytes(byRange.FAR ?? 0)}, kept ${formatBytes(byRange.NEAR_AND_FAR ?? 0)}`,
  ].join('\n');
};

/** The scene's JSON cell content (the gather's manifest): its cells and entries, the estimated
 * GPU memory of the tracked cells' cell-only assets, and the oversized meshes alive. */
const formatDataContent = (rt: StreamingRuntime | null) => {
  const content = getStreamingDataContent();
  if (!rt || !content) return 'none (code content only)';
  const { manifest } = content;
  let estimate = 0;
  for (const cell of rt.cells.values()) {
    const entry = manifest.cells[String(cell.key)];
    if (!entry) continue;
    // What its level loads: its near or far content, and its kept content (p353 Phase 5)
    const isFar = cell.level === StreamingLevel.FAR;
    estimate += (isFar ? entry.far?.bytesEstimate ?? 0 : entry.bytesEstimate) ?? 0;
    estimate += entry.kept?.bytesEstimate ?? 0;
  }
  let groups = 0;
  let instances = 0;
  for (const cell of rt.cells.values()) {
    const far = countFarGroups(rt, cell);
    groups += far.groups;
    instances += far.instances;
  }
  return [
    `${Object.keys(manifest.cells).length} cells, ${manifest.meshes.length} meshes, ${manifest.farMeshes?.length ?? 0} far meshes, ${manifest.lights.length} lights`,
    `estimated for the tracked cells: ${formatBytes(estimate)}`,
    `far groups alive: ${groups} (${instances} instances)`,
    `oversized meshes alive: ${content.shared.size}`,
  ].join('\n');
};

/** The tracked cells nearest first (the last decision's order), the first MAX_LIST_ROWS. */
export const getStreamingCellListData = (rt: StreamingRuntime | null): DebuggerListItem[] => {
  if (!rt) return [];
  const items: DebuggerListItem[] = [];
  for (const cell of rt.order) {
    // A cell forgotten since the decision
    if (rt.cells.get(cell.key) !== cell) continue;
    if (items.length >= MAX_LIST_ROWS) {
      items.push({
        itemId: 'more',
        title: `…and ${rt.cells.size - MAX_LIST_ROWS} more`,
        disabled: true,
        titlePlaceholder: true,
      });
      break;
    }
    const lastLoadMs = Math.max(...cell.layers.map((layer) => layer.lastLoadMs));
    const loadMs = lastLoadMs < 0 ? '' : `, ${lastLoadMs.toFixed(1)} ms`;
    const bytes = getCellGPUBytes(cellBytes, cell);
    items.push({
      itemId: String(cell.key),
      title: `Cell ${cell.cx}, ${cell.cz}`,
      subTitle: `ring ${cell.ring}${bytes ? `, ${formatBytes(bytes)}` : ''}`,
      suffix: `${getCellStateLabel(cell).toLowerCase()}${loadMs}`,
    });
  }
  return items;
};

const getFocusFolder = (teleport: { cx: number; cz: number }): Item => ({
  type: 'folder',
  title: 'Focus',
  content: [
    {
      label: 'Freeze focus',
      get: () => getStreamingFocusOverride() !== null,
      set: (frozen: unknown) => {
        const rt = getStreamingRuntime();
        if (!frozen) setStreamingFocusOverride(null);
        else if (rt && !Number.isNaN(rt.focusX)) {
          setStreamingFocusOverride({ x: rt.focusX, z: rt.focusZ });
        }
      },
      interval: 'refresh',
    },
    { label: 'Cell x', target: teleport, key: 'cx', step: 1 },
    { label: 'Cell z', target: teleport, key: 'cz', step: 1 },
    {
      type: 'button',
      title: 'Teleport focus to cell',
      disabled: () => !getStreamingRuntime(),
      onClick: () => {
        const rt = getStreamingRuntime();
        if (!rt) return;
        const size = rt.settings.cellSize;
        setStreamingFocusOverride({ x: (teleport.cx + 0.5) * size, z: (teleport.cz + 0.5) * size });
        updateDebuggerTab(STREAMING_TAB_ID);
      },
    },
    getNoteItem(
      'Freezing or teleporting holds the focus until it’s unfrozen; ?streamingFocus=x,z starts frozen.'
    ),
  ],
});

const getBudgetsFolder = (): Item => {
  const budgets = getStreamingBudgets();
  const primeBudgets = getStreamingPrimeBudgets();
  return {
    type: 'folder',
    title: 'Budgets',
    content: [
      {
        label: 'Decide every (frames)',
        get: getStreamingUpdateInterval,
        set: (frames: unknown) => setStreamingUpdateInterval(Number(frames)),
        min: 1,
        max: 120,
        step: 1,
        interval: 'refresh',
      },
      {
        label: 'Concurrent loads',
        target: budgets,
        key: 'maxConcurrentLoads',
        min: 1,
        max: 16,
        step: 1,
        interval: 'refresh',
      },
      {
        label: 'Create ms per frame',
        target: budgets,
        key: 'maxCreateMsPerFrame',
        min: 0,
        max: 16,
        step: 0.25,
        interval: 'refresh',
      },
      {
        label: 'Prime ms per frame',
        target: primeBudgets,
        key: 'maxPrimeMsPerFrame',
        min: 0,
        max: 16,
        step: 0.25,
        interval: 'refresh',
      },
      {
        label: 'New materials per frame',
        get: () => primeBudgets.maxNewStructuresPerFrame ?? 0,
        set: (count: unknown) => {
          const n = Math.round(Number(count));
          primeBudgets.maxNewStructuresPerFrame = n > 0 ? n : null;
        },
        min: 0,
        max: 16,
        step: 1,
        interval: 'refresh',
      },
      {
        label: 'Objects shown per frame',
        get: () => primeBudgets.maxShownObjectsPerFrame ?? 0,
        set: (count: unknown) => {
          const n = Math.round(Number(count));
          primeBudgets.maxShownObjectsPerFrame = n > 0 ? n : null;
        },
        min: 0,
        max: 256,
        step: 1,
        interval: 'refresh',
      },
      getNoteItem(
        'New materials per frame 0: by the backend (WebGL2 1, WebGPU 8). Objects shown per frame 0: by the backend (WebGL2 16, WebGPU not paced).'
      ),
    ],
  };
};

const getOverlayFolder = (): Item => ({
  type: 'folder',
  title: 'Overlay',
  content: [
    {
      label: 'Show cells',
      get: isStreamingOverlayEnabled,
      set: (enabled: unknown) => setStreamingOverlayEnabled(Boolean(enabled)),
      interval: 'refresh',
    },
    {
      label: 'Height (m)',
      get: getStreamingOverlayHeight,
      set: (y: unknown) => setStreamingOverlayHeight(Number(y)),
      step: 0.1,
    },
    getNoteItem(
      'Resident green, nearby yellow, far orange, queued grey, loading blue, priming purple, unloading red; the focus a white cross.'
    ),
  ],
});

/** Creates the "Streaming" drawer tab (`streamingControls`): the streaming debug module's entry,
 * which `registerStreamingDebugGUI` loads. */
export const _createStreamingDebugGUI = () => {
  startStreamingTransitionHistory();
  const readouts: Readouts = {
    scene: '',
    focus: '',
    cells: '',
    counters: '',
    priming: '',
    fades: '',
    bodies: '',
    memory: '',
    data: '',
  };
  const teleport = { cx: 0, cz: 0 };

  createDebuggerTab({
    id: STREAMING_TAB_ID,
    title: 'Streaming',
    icon: 'streaming',
    // Nothing is persisted; the disabled button keeps the heading like the other tabs'
    clearLSButton: true,
    refreshIntervalMs: 250,
    onRefresh: () => {
      const rt = getStreamingRuntime();
      readouts.scene = formatScene(rt);
      readouts.focus = formatFocus(rt);
      readouts.cells = formatCells(rt);
      readouts.counters = formatCounters(rt);
      readouts.priming = formatPriming(rt);
      readouts.fades = formatFades(rt);
      readouts.bodies = formatBodies(rt);
      cellBytes = rt ? getOwnerGPUBytes() : new Map();
      readouts.memory = formatMemory(rt);
      readouts.data = formatDataContent(rt);
    },
    content: () => [
      {
        pane: true,
        content: [
          { key: 'scene', target: readouts, label: 'Scene', readonly: true, interval: 'refresh' },
          { key: 'focus', target: readouts, label: 'Focus', readonly: true, interval: 'refresh' },
          {
            key: 'cells',
            target: readouts,
            label: 'Cells',
            readonly: true,
            multiline: true,
            rows: COUNTED_STATES.length,
            interval: 'refresh',
          },
          {
            key: 'counters',
            target: readouts,
            label: 'Since the load',
            readonly: true,
            multiline: true,
            rows: 8,
            interval: 'refresh',
          },
          {
            key: 'priming',
            target: readouts,
            label: 'Priming',
            readonly: true,
            multiline: true,
            rows: 6,
            interval: 'refresh',
          },
          getNoteItem(
            'A cell streamed in during play is held unseen while its textures upload and its new shaders compile, then shown a few new materials a frame. A stall: the focus reached it first (widen the rings). An oversized upload: an uncompressed texture over 1024² (ship KTX2).'
          ),
          {
            key: 'fades',
            target: readouts,
            label: 'Fades',
            readonly: true,
            multiline: true,
            rows: 3,
            interval: 'refresh',
          },
          getNoteItem(
            'A layer streamed in during play dithers in once shown, and a shown one dithers out before it unloads, over the scene’s fadeSeconds; a NEARBY ↔ FAR switch does both at once. Taken down unfaded: none, unless a content’s own unload leaves entities alive.'
          ),
          {
            key: 'bodies',
            target: readouts,
            label: 'Bodies',
            readonly: true,
            multiline: true,
            rows: 4,
            interval: 'refresh',
          },
          getNoteItem(
            'The dynamic bodies the cells hold take their cell’s physics tier: a RESIDENT cell’s FULL, or their tier policy’s; another’s the scene’s nearbyPhysicsTier, out of the policy. One that moved into another loaded cell is handed to it when its own cell unloads. Off their tier: none, unless a tier is set outside the cells (or without physicsTiers()).'
          ),
          {
            key: 'memory',
            target: readouts,
            label: 'GPU memory',
            readonly: true,
            multiline: true,
            rows: 2,
            interval: 'refresh',
          },
          getNoteItem(
            'A cell’s GPU memory is what its layers alone hold (near, far and kept, each its own owner key): what several cells or the scene share is the scene’s (the profiler’s GPU memory tab). A FAR cell holds only its far and kept layers’.'
          ),
          {
            key: 'data',
            target: readouts,
            label: 'JSON content',
            readonly: true,
            multiline: true,
            rows: 4,
            interval: 'refresh',
          },
          getNoteItem(
            'The scene JSON’s content the gather cut into cells: an asset only cells use loads with them (the estimate sums their textures’ and imports’ encoded GPU size), a mesh with LOD levels gives its FAR cell its coarsest level (alike ones one InstancedMesh, a far group), an oversized mesh is kept while any of its cells is loaded.'
          ),
          getFocusFolder(teleport),
          getBudgetsFolder(),
          getOverlayFolder(),
        ],
      },
      debuggerListCMP({
        id: 'streamingCells',
        heading: 'Tracked cells',
        emptyText: 'No cell is tracked: the scene doesn’t stream, or nothing is in its rings.',
        data: () => getStreamingCellListData(getStreamingRuntime()),
        selectedItemId: getOpenStreamingCellWindowIds,
        perItemConfig: {
          onClick: (itemId) => {
            const cell = getStreamingRuntime()?.cells.get(Number(itemId));
            if (!cell) return;
            toggleStreamingCellWindow(cell);
            // The row selection follows the window
            queueMicrotask(() => updateDebuggerTab(STREAMING_TAB_ID));
          },
        },
      }),
    ],
  });
};
