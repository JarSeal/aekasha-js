import {
  createDebuggerTab,
  debuggerListCMP,
  type DebuggerListItem,
  type DebuggerPaneItem,
  updateDebuggerTab,
} from '../../../debug/DebuggerGUI';
import { getNoteItem } from '../../../debug/_dbg__DebugWindowGrid';
import {
  getStreamingBudgets,
  getStreamingFocus,
  getStreamingFocusOverride,
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
type Readouts = { scene: string; focus: string; cells: string; counters: string };

const COUNTED_STATES = ['RESIDENT', 'NEARBY', 'QUEUED', 'LOADING', 'UNLOADING'] as const;

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
    items.push({
      itemId: String(cell.key),
      title: `Cell ${cell.cx}, ${cell.cz}`,
      subTitle: `ring ${cell.ring}`,
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
  const readouts: Readouts = { scene: '', focus: '', cells: '', counters: '' };
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
            rows: 6,
            interval: 'refresh',
          },
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
