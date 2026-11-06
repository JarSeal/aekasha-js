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
import { getOwnerGPUBytes } from './_dbg__StreamingMemory';

// The Streaming tab (docs/plans/p353_macro-streaming-grid.md §7): the current scene's settings,
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
  memory: string;
  data: string;
};

/** The cells' GPU bytes by owner key, read once per refresh (it walks every asset) */
let cellBytes = new Map<string, number>();

const COUNTED_STATES = ['RESIDENT', 'NEARBY', 'QUEUED', 'LOADING', 'PRIMING', 'UNLOADING'] as const;

const formatScene = (rt: StreamingRuntime | null) => {
  if (!rt) return 'This scene doesn’t stream.';
  const { cellSize, rings, margin } = rt.settings;
  return `${rt.sceneId}: ${cellSize} m cells, rings ${rings.join(' / ')}, margin ${margin} m`;
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

/** The tracked cells' GPU bytes together, and the largest cell's. */
const formatMemory = (rt: StreamingRuntime | null) => {
  if (!rt) return '';
  let total = 0;
  let largest = 0;
  for (const cell of rt.cells.values()) {
    const bytes = cellBytes.get(cell.ownerKey) ?? 0;
    total += bytes;
    largest = Math.max(largest, bytes);
  }
  return `${formatBytes(total)} in cells, the largest ${formatBytes(largest)}`;
};

/** The scene's JSON cell content (the gather's manifest): its cells and entries, the estimated
 * GPU memory of the tracked cells' cell-only assets, and the oversized meshes alive. */
const formatDataContent = (rt: StreamingRuntime | null) => {
  const content = getStreamingDataContent();
  if (!rt || !content) return 'none (code content only)';
  const { manifest } = content;
  let estimate = 0;
  for (const cell of rt.cells.values()) {
    estimate += manifest.cells[String(cell.key)]?.bytesEstimate ?? 0;
  }
  return [
    `${Object.keys(manifest.cells).length} cells, ${manifest.meshes.length} meshes, ${manifest.lights.length} lights`,
    `estimated for the tracked cells: ${formatBytes(estimate)}`,
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
    const loadMs = cell.lastLoadMs < 0 ? '' : `, ${cell.lastLoadMs.toFixed(1)} ms`;
    const bytes = cellBytes.get(cell.ownerKey);
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
      getNoteItem('New materials per frame 0: by the backend (WebGL2 1, WebGPU 8).'),
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
      'Resident green, nearby yellow, queued grey, loading blue, unloading red; the focus a white cross.'
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
            key: 'memory',
            target: readouts,
            label: 'GPU memory',
            readonly: true,
            interval: 'refresh',
          },
          getNoteItem(
            'A cell’s GPU memory is what its content alone holds: what several cells or the scene share is the scene’s (the profiler’s GPU memory tab).'
          ),
          {
            key: 'data',
            target: readouts,
            label: 'JSON content',
            readonly: true,
            multiline: true,
            rows: 3,
            interval: 'refresh',
          },
          getNoteItem(
            'The scene JSON’s content the gather cut into cells: an asset only cells use loads with them (the estimate sums their textures’ and imports’ encoded GPU size), an oversized mesh while any of its cells is loaded.'
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
