// The Streaming tab's cell window (docs/plans/_DONE_p353_macro-streaming-grid.md §7): one cell's state,
// ring, its layers (each one's phase, units, owner key, GPU memory and running fade; p353 Phase 5),
// load time, entities, far groups, GPU memory and assets, its last transitions, and a
// button that teleports the focus to it. A window kind keyed by the cell; cells don't outlive a scene, so the windows are
// removed on a scene change and not saved. The transitions are recorded here, from the machine's
// transition listener, for every tracked cell of the current scene.
import * as THREE from 'three/webgpu';
import { createDebugWindowGrid, getNoteItem } from '../../../debug/_dbg__DebugWindowGrid';
import { ComponentType } from '../../../kernel/ecs/ECSCoreComponents';
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
} from '../StreamingCells';
import {
  type StreamingLayer,
  getStreamingLayerEntityIds,
  setStreamingTransitionListener,
} from '../StreamingLayers';
import type { StreamingManifest, StreamingManifestLayer } from '../StreamingManifest';
import { StreamingLevel } from '../StreamingRings';
import { getCellGPUBytes, getOwnedAssetIds, getOwnerGPUBytes } from './_dbg__StreamingMemory';

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
  const generations = cell.layers.map((layer) => layer.generation).join('/');
  entries.push(`${at} s  ${getCellStateLabel(cell)}  (ring ${cell.ring}, gen ${generations})`);
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
  const assetsOf = (layer: StreamingManifestLayer, prefix: string) =>
    (['textures', 'materials', 'geometries', 'importedAssets'] as const)
      .map((kind) => [kind, ids(kind, layer[kind])] as const)
      .filter(([, list]) => list.length)
      .map(([kind, list]) => `${prefix}${kind}: ${list.join(', ')}`);
  // Its near content, then its far and kept layers' (p353 Phase 5)
  const lines = [
    `near: ${entry.meshes?.length ?? 0} meshes, ${entry.lights?.length ?? 0} lights, est. ${formatBytes(entry.bytesEstimate)}`,
    ...assetsOf(entry, '  '),
  ];
  for (const [name, layer] of [
    ['far', entry.far],
    ['kept', entry.kept],
  ] as const) {
    if (!layer) continue;
    lines.push(
      `${name}: ${layer.meshes?.length ?? 0} meshes, est. ${formatBytes(layer.bytesEstimate)}`
    );
    lines.push(...assetsOf(layer, '  '));
  }
  return lines.join('\n');
};

/** A layer's running fade's progress (0 → 1), or -1 without one. */
export const getLayerFadeProgress = (rt: StreamingRuntime, layer: StreamingLayer) => {
  const { fade } = layer;
  const ms = rt.settings.fadeSeconds * 1000;
  if (!fade || ms <= 0) return -1;
  return Math.min(1, (rt.now() - fade.startedAt) / ms);
};

/** The far groups (InstancedMesh entities) a cell's far layer holds, and their instances. */
export const countFarGroups = (rt: StreamingRuntime, cell: StreamingCell) => {
  const far = cell.layers.find((layer) => layer.range === 'FAR');
  let groups = 0;
  let instances = 0;
  if (!far) return { groups, instances };
  for (const id of getStreamingLayerEntityIds(far)) {
    const object = rt.world.getComponent(id, ComponentType.OBJECT3D)?.value;
    if (!(object instanceof THREE.InstancedMesh)) continue;
    groups++;
    instances += object.count;
  }
  return { groups, instances };
};

/** A cell's layers (p353 Phase 5 D1, D10): each one's phase, units, generation and running fade,
 * then its owner key and GPU memory. */
const formatLayers = (cell: StreamingCell | undefined) => {
  const rt = getStreamingRuntime();
  if (!cell || !rt) return '';
  const bytes = getOwnerGPUBytes();
  return cell.layers
    .map((layer) => {
      const progress = getLayerFadeProgress(rt, layer);
      const fade =
        progress < 0
          ? ''
          : `, fading ${layer.fade?.direction.toLowerCase()} ${Math.round(progress * 100)} %`;
      return [
        `${layer.range}: ${layer.phase}, ${layer.units.length} units, gen ${layer.generation}${fade}`,
        `  ${layer.ownerKey}: ${formatBytes(bytes.get(layer.ownerKey) ?? 0)}`,
      ].join('\n');
    })
    .join('\n');
};

/** The longest of a cell's layers' last load or priming times, in ms (-1 before one). */
const getLastMs = (cell: StreamingCell | undefined, key: 'lastLoadMs' | 'lastPrimeMs') =>
  cell ? Math.max(...cell.layers.map((layer) => layer[key])) : -1;

/** A cell's owned asset ids, one kind a line (empty kinds left out). */
const formatAssets = (ownerKeys: readonly string[]) => {
  const ids = getOwnedAssetIds(ownerKeys);
  return Object.entries(ids)
    .filter(([, list]) => list.length)
    .map(([kind, list]) => `${kind}: ${list.join(', ')}`)
    .join('\n');
};

const createCellWindowContent = (data?: Record<string, unknown>) => {
  const cellKey = Number(data?.cellKey);
  const cx = Number(data?.cx);
  const cz = Number(data?.cz);
  const ownerKeys = (data?.ownerKeys as string[] | undefined) ?? [];
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
    {
      label: 'Layers',
      get: () => formatLayers(getCell(cellKey)),
      readonly: true,
      multiline: true,
      rows: 6,
      interval: REFRESH_MS,
    },
    live('Far groups', () => {
      const rt = getStreamingRuntime();
      const cell = getCell(cellKey);
      if (!rt || !cell) return '–';
      const { groups, instances } = countFarGroups(rt, cell);
      return `${groups} (${instances} instances)`;
    }),
    live('Last load (ms)', () => {
      const ms = getLastMs(getCell(cellKey), 'lastLoadMs');
      return ms < 0 ? '–' : ms.toFixed(1);
    }),
    live('Last priming (ms)', () => {
      const ms = getLastMs(getCell(cellKey), 'lastPrimeMs');
      return ms < 0 ? '–' : ms.toFixed(1);
    }),
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
    live('GPU memory', () => {
      const cell = getCell(cellKey);
      return formatBytes(cell ? getCellGPUBytes(getOwnerGPUBytes(), cell) : 0);
    }),
    {
      label: 'Its assets',
      get: () => formatAssets(ownerKeys),
      readonly: true,
      multiline: true,
      rows: 3,
      interval: REFRESH_MS,
    },
    getNoteItem(
      'Its assets: those its layers’ owner keys are on (what its content registered, or got from the cache). Those a layer holds alone and nothing uses are freed when that layer unloads.'
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
    data: {
      cellKey: cell.key,
      cx: cell.cx,
      cz: cell.cz,
      ownerKeys: cell.layers.map((layer) => layer.ownerKey),
    },
    isDebugWindow: true,
    removeOnSceneChange: true,
    size: { w: 380, h: 660 },
  });
};

/** The open cell windows' keys, as list item ids. */
export const getOpenStreamingCellWindowIds = () =>
  getDraggableWindowsOfKind(CELL_WIN_KIND).map((win) => String(win.data?.cellKey));

registerDraggableWindowKind(CELL_WIN_KIND, { content: createCellWindowContent });
