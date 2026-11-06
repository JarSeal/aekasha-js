// The Streaming tab's cell window (docs/plans/p353_macro-streaming-grid.md §7): one cell's state,
// ring, load time, content units, entities, GPU memory and assets, its last transitions, and a
// button that teleports the focus to it. A window kind keyed by the cell; cells don't outlive a scene, so the windows are
// removed on a scene change and not saved. The transitions are recorded here, from the machine's
// transition listener, for every tracked cell of the current scene.
import { createDebugWindowGrid, getNoteItem } from '../../../debug/_dbg__DebugWindowGrid';
import { formatBytes } from '../../../kernel/assets/debug/_dbg__AssetStats';
import type { PropertyGridItem } from '../../../ui/forms/PropertyGridItems';
import {
  getDraggableWindowsOfKind,
  getKindWindowId,
  registerDraggableWindowKind,
  toggleDraggableWindow,
} from '../../../ui/overlays/windows/DraggableWindow';
import {
  getStreamingDataContent,
  getStreamingRuntime,
  setStreamingFocusOverride,
} from '../Streaming';
import {
  type StreamingCell,
  type StreamingRuntime,
  getStreamingCellEntityIds,
  setStreamingTransitionListener,
} from '../StreamingCells';
import type { StreamingManifest } from '../StreamingManifest';
import { StreamingLevel } from '../StreamingRings';
import { getOwnedAssetIds, getOwnerGPUBytes } from './_dbg__StreamingMemory';

const CELL_WIN_KIND = 'streamingCellWindow';
const REFRESH_MS = 250;
/** Transitions kept per cell */
const MAX_HISTORY = 12;
/** Entity ids the window lists at most */
const MAX_LISTED_ENTITIES = 50;

const LEVEL_NAMES = ['RESIDENT', 'NEARBY', 'FAR', 'UNLOADED'] as const;

/** A cell's state as the tab shows it: its level when loaded, `QUEUED` while it waits to load. */
export const getCellStateLabel = (cell: StreamingCell) => {
  if (cell.phase === 'LOADED') return LEVEL_NAMES[cell.level];
  if (cell.phase === 'UNLOADED') {
    return cell.level === StreamingLevel.UNLOADED ? 'UNLOADED' : 'QUEUED';
  }
  return cell.phase;
};

/** The transitions of the current scene's cells, by key (cleared with a new runtime) */
const history = new Map<number, string[]>();
let historyRuntime: StreamingRuntime | null = null;

const recordTransition = (rt: StreamingRuntime, cell: StreamingCell) => {
  if (rt !== historyRuntime) {
    history.clear();
    historyRuntime = rt;
  }
  let entries = history.get(cell.key);
  if (!entries) {
    entries = [];
    history.set(cell.key, entries);
  }
  const at = (performance.now() / 1000).toFixed(2);
  entries.push(`${at} s  ${getCellStateLabel(cell)}  (ring ${cell.ring}, gen ${cell.generation})`);
  if (entries.length > MAX_HISTORY) entries.shift();
};

/** Starts recording the cells' transitions: the tab's creation. */
export const startStreamingTransitionHistory = () =>
  setStreamingTransitionListener(recordTransition);

const getCell = (cellKey: number) => getStreamingRuntime()?.cells.get(cellKey);

const formatEntities = (cell: StreamingCell | undefined) => {
  if (!cell) return '';
  const ids = getStreamingCellEntityIds(cell);
  const shown = ids.slice(0, MAX_LISTED_ENTITIES).join(', ');
  return ids.length > MAX_LISTED_ENTITIES
    ? `${shown}, …and ${ids.length - MAX_LISTED_ENTITIES} more`
    : shown;
};

/** A cell's JSON content from the manifest (known before it loads): its entries, its cell-only
 * assets and their estimated GPU size; empty for a cell without any. */
const formatDataContent = (cellKey: number) => {
  const manifest = getStreamingDataContent()?.manifest;
  const entry = manifest?.cells[String(cellKey)];
  if (!manifest || !entry) return 'none';
  const ids = (kind: keyof StreamingManifest['assets'], indices: number[] | undefined) =>
    (indices ?? []).map((index) => manifest.assets[kind][index]?.id ?? `#${index}`);
  const assets = (['textures', 'materials', 'geometries', 'importedAssets'] as const)
    .map((kind) => [kind, ids(kind, entry[kind])] as const)
    .filter(([, list]) => list.length)
    .map(([kind, list]) => `${kind}: ${list.join(', ')}`);
  return [
    `${entry.meshes?.length ?? 0} meshes, ${entry.lights?.length ?? 0} lights, est. ${formatBytes(entry.bytesEstimate)}`,
    ...assets,
  ].join('\n');
};

/** A cell's owned asset ids, one kind a line (empty kinds left out). */
const formatAssets = (ownerKey: string) => {
  const ids = getOwnedAssetIds(ownerKey);
  return Object.entries(ids)
    .filter(([, list]) => list.length)
    .map(([kind, list]) => `${kind}: ${list.join(', ')}`)
    .join('\n');
};

const createCellWindowContent = (data?: Record<string, unknown>) => {
  const cellKey = Number(data?.cellKey);
  const cx = Number(data?.cx);
  const cz = Number(data?.cz);
  const ownerKey = String(data?.ownerKey);
  const live = (label: string, get: () => string): PropertyGridItem => ({
    label,
    get,
    readonly: true,
    interval: REFRESH_MS,
  });
  const items: PropertyGridItem[] = [
    getNoteItem(() => (getCell(cellKey) ? '' : 'The cell isn’t tracked: it’s unloaded.')),
    live('State', () => {
      const cell = getCell(cellKey);
      return cell ? getCellStateLabel(cell) : 'UNLOADED';
    }),
    live('Ring', () => String(getCell(cellKey)?.ring ?? '–')),
    live('Edge distance (m)', () => getCell(cellKey)?.edgeDistance.toFixed(1) ?? '–'),
    live('Load generation', () => String(getCell(cellKey)?.generation ?? '–')),
    live('Last load (ms)', () => {
      const ms = getCell(cellKey)?.lastLoadMs ?? -1;
      return ms < 0 ? '–' : ms.toFixed(1);
    }),
    live('Last priming (ms)', () => {
      const ms = getCell(cellKey)?.lastPrimeMs ?? -1;
      return ms < 0 ? '–' : ms.toFixed(1);
    }),
    live('Content units', () => String(getCell(cellKey)?.units.length ?? 0)),
    live('Entities', () => {
      const cell = getCell(cellKey);
      return String(cell ? getStreamingCellEntityIds(cell).length : 0);
    }),
    {
      label: 'Entity ids',
      get: () => formatEntities(getCell(cellKey)),
      readonly: true,
      multiline: true,
      rows: 3,
      interval: REFRESH_MS,
    },
    {
      label: 'JSON content',
      get: () => formatDataContent(cellKey),
      readonly: true,
      multiline: true,
      rows: 3,
    },
    live('GPU memory', () => formatBytes(getOwnerGPUBytes().get(ownerKey) ?? 0)),
    {
      label: 'Its assets',
      get: () => formatAssets(ownerKey),
      readonly: true,
      multiline: true,
      rows: 3,
      interval: REFRESH_MS,
    },
    getNoteItem(
      'Its assets: those its owner key is on (what its content registered, or got from the cache). Those it holds alone and nothing uses are freed when it unloads.'
    ),
    {
      label: 'Transitions',
      get: () => (history.get(cellKey) ?? []).join('\n'),
      readonly: true,
      multiline: true,
      rows: 6,
      interval: REFRESH_MS,
    },
    {
      type: 'button',
      title: 'Teleport focus here',
      onClick: () => {
        const rt = getStreamingRuntime();
        if (!rt) return;
        const size = rt.settings.cellSize;
        setStreamingFocusOverride({ x: (cx + 0.5) * size, z: (cz + 0.5) * size });
      },
    },
  ];
  return createDebugWindowGrid({ items }).cmp;
};

/** Opens a cell's window, or brings it to the front, or closes it (a list row's click). */
export const toggleStreamingCellWindow = (cell: StreamingCell) => {
  toggleDraggableWindow({
    id: getKindWindowId(CELL_WIN_KIND, cell.key),
    kind: CELL_WIN_KIND,
    title: `Cell ${cell.cx}, ${cell.cz}`,
    icon: 'streaming',
    data: { cellKey: cell.key, cx: cell.cx, cz: cell.cz, ownerKey: cell.ownerKey },
    isDebugWindow: true,
    removeOnSceneChange: true,
    size: { w: 360, h: 580 },
  });
};

/** The open cell windows' keys, as list item ids. */
export const getOpenStreamingCellWindowIds = () =>
  getDraggableWindowsOfKind(CELL_WIN_KIND).map((win) => String(win.data?.cellKey));

registerDraggableWindowKind(CELL_WIN_KIND, { content: createCellWindowContent });
