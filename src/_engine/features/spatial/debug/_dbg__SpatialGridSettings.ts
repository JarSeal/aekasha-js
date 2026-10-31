// The Spatial index tab's saved settings (p806 D11: out of _dbg__SpatialGrid.ts, so the tab, its
// items and the overlays all read them): one entry per domain, the cell size per scope, and the
// single-grid tab's LS migrated into DEFAULT's entry.
import { persistDebuggerTabValue } from '../../../debug/DebuggerGUI';
import { lsGetItem, lsSetItem } from '../../../utils/LocalAndSessionStorage';
import { DEFAULT_SPATIAL_DOMAIN } from '../SpatialDomains';

export const SPATIAL_GRID_TAB_ID = 'spatialGridControls';
export const SPATIAL_GRID_LS_KEY = 'AEK_debugSpatialGrid';

/** One domain's tab settings (docs/plans/_DONE_p346_spatial-domains.md §3.6). */
export type DomainDebugSettings = {
  /** Overrides the cell size of the domain's world settings; absent = the app's. */
  cellSize?: number;
  /**
   * Overrides the cell size of a scene's settings, by scene id; absent = the app's (never the
   * world value, docs/plans/_DONE_p349_scene-scoped-spatial-domains.md §3.5).
   */
  cellSizeByScene?: Record<string, number>;
  showCells: boolean;
  cellsColor: number;
  showOversized: boolean;
  oversizedColor: number;
};

/** The tab's state: the shown domain and each domain's settings (its `persistKeys`). */
export type SpatialGridTabState = {
  selectedDomain: string;
  domains: Record<string, DomainDebugSettings>;
};

// DEFAULT keeps the colors the single-grid tab had; other domains get a pair from this list by
// their id, so a domain's color stays the same across reloads and registration orders.
const DEFAULT_DOMAIN_COLORS: [number, number] = [0xff0000, 0xffaa00];
const DOMAIN_COLORS: [number, number][] = [
  [0x00c8ff, 0x0066ff],
  [0x66ff33, 0x009933],
  [0xff33cc, 0x9900cc],
  [0xffff00, 0xcc9900],
  [0x00ffaa, 0x008866],
  [0xffffff, 0x999999],
];

const hashId = (id: string) => {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(hash);
};

const defaultDomainSettings = (id: string): DomainDebugSettings => {
  const [cellsColor, oversizedColor] =
    id === DEFAULT_SPATIAL_DOMAIN
      ? DEFAULT_DOMAIN_COLORS
      : DOMAIN_COLORS[hashId(id) % DOMAIN_COLORS.length];
  return { showCells: false, cellsColor, showOversized: false, oversizedColor };
};

/** The tab's state, which `createDebuggerTab` hydrates and the clear-LS button resets. */
export const spatialGridTabState: SpatialGridTabState = {
  selectedDomain: DEFAULT_SPATIAL_DOMAIN,
  domains: {},
};

/** A domain's settings, for reading (defaults when it has none saved). */
export const getDomainSettings = (id: string) =>
  spatialGridTabState.domains[id] ?? defaultDomainSettings(id);

/** A domain's settings, for writing (created from the defaults). */
export const editDomainSettings = (id: string) =>
  (spatialGridTabState.domains[id] ??= defaultDomainSettings(id));

export const persistDomainSettings = () => persistDebuggerTabValue(SPATIAL_GRID_TAB_ID, 'domains');

/** The saved cell size of domain `id`'s settings with scope `sceneId` (undefined = the world settings). */
export const getSavedCellSize = (id: string, sceneId: string | undefined) => {
  const settings = spatialGridTabState.domains[id];
  return sceneId === undefined ? settings?.cellSize : settings?.cellSizeByScene?.[sceneId];
};

/** Saves domain `id`'s cell size for scope `sceneId` (undefined = the world settings). */
export const setSavedCellSize = (id: string, sceneId: string | undefined, cellSize: number) => {
  const settings = editDomainSettings(id);
  if (sceneId === undefined) settings.cellSize = cellSize;
  else (settings.cellSizeByScene ??= {})[sceneId] = cellSize;
};

/** Clears the saved cell size of domain `id`'s settings with scope `sceneId`. */
export const clearSavedCellSize = (id: string, sceneId: string | undefined) => {
  const settings = spatialGridTabState.domains[id];
  if (!settings) return;
  if (sceneId === undefined) {
    delete settings.cellSize;
    return;
  }
  const byScene = settings.cellSizeByScene;
  if (!byScene) return;
  delete byScene[sceneId];
  if (Object.keys(byScene).length === 0) delete settings.cellSizeByScene;
};

/**
 * Before domains, the tab saved one grid's settings as flat keys. They become DEFAULT's entry
 * (the cell size only when it differed from the old default, 20). Run before the tab's
 * registration, which hydrates the state from the saved settings.
 */
export const migrateLegacySpatialGridSettings = () => {
  // An object default makes lsGetItem parse the JSON
  const saved = lsGetItem(SPATIAL_GRID_LS_KEY, {}) as Record<string, unknown> | null;
  if (!saved || typeof saved !== 'object' || 'domains' in saved || 'selectedDomain' in saved) {
    return;
  }
  const legacyKeys = [
    'cellSize',
    'visualizerEnabled',
    'visualizerColor',
    'oversizedVisualizerEnabled',
    'oversizedVisualizerColor',
  ];
  if (!legacyKeys.some((key) => key in saved)) return;

  const defaults = defaultDomainSettings(DEFAULT_SPATIAL_DOMAIN);
  const entry: DomainDebugSettings = {
    showCells: Boolean(saved.visualizerEnabled ?? defaults.showCells),
    cellsColor: Number(saved.visualizerColor ?? defaults.cellsColor),
    showOversized: Boolean(saved.oversizedVisualizerEnabled ?? defaults.showOversized),
    oversizedColor: Number(saved.oversizedVisualizerColor ?? defaults.oversizedColor),
  };
  if (typeof saved.cellSize === 'number' && saved.cellSize !== 20) entry.cellSize = saved.cellSize;
  lsSetItem(SPATIAL_GRID_LS_KEY, { domains: { [DEFAULT_SPATIAL_DOMAIN]: entry } });
};
