// The Spatial index tab's editing rows (p806 D11: out of _dbg__SpatialGrid.ts): which domains the
// tab lists and shows, and the shown domain's cell size, oracle and overlays. The live figures are
// _dbg__SpatialGridReadouts.ts.
import {
  persistDebuggerTabValue,
  updateDebuggerTab,
  type DebuggerPaneItem,
} from '../../../debug/DebuggerGUI';
import type { ECSWorld } from '../../../kernel/ecs/ECS';
import { getCurrentSceneId } from '../../../kernel/scene/Scene';
import {
  DEFAULT_SPATIAL_DOMAIN,
  getSpatialDomain,
  getSpatialDomainIds,
  getSpatialDomainOptions,
  getSpatialDomainSceneId,
  reapplySpatialDomainOptions,
} from '../SpatialDomains';
import { isSpatialGridOracleEnabled, setSpatialGridOracleEnabled } from '../SpatialOracle';
import {
  clearSavedCellSize,
  editDomainSettings,
  getDomainSettings,
  getSavedCellSize,
  persistDomainSettings,
  setSavedCellSize,
  SPATIAL_GRID_TAB_ID,
  spatialGridTabState,
  type SpatialGridTabState,
} from './_dbg__SpatialGridSettings';
import { syncSpatialGridOverlays } from './_dbg__SpatialGridOverlays';

type Item = DebuggerPaneItem<SpatialGridTabState>;

/** Which domains the tab lists and shows in a world, and where it edits their cell sizes. */
export type SpatialDomainView = {
  /** DEFAULT always is: its settings exist without its grid (p349 §3.6). */
  isRegistered: (id: string) => boolean;
  /** The domain's id, with why it has no grid when it hasn't. */
  getLabel: (id: string) => string;
  /** Registered domains first (DEFAULT leading), then the unregistered ones with a cell size
   * saved for the current scene or id-wide, so it can be seen and cleared (p349 §3.5). */
  listIds: () => string[];
  /** The listed domains and their labels as one key: a change rebuilds the tab. */
  getListKey: () => string;
  /** The domain the tab shows: the saved selection while it's listed, else DEFAULT. The saved
   * selection is kept, so it's shown again when its domain is registered again. */
  getShown: () => string;
  /** The scope (scene id, undefined = world) the tab edits domain `id`'s cell size in: that of
   * the settings in use. For an unregistered domain, that of the saved value it shows. */
  getEditScope: (id: string) => string | undefined;
};

/** The tab's view of `world`'s domains (see {@link SpatialDomainView}). */
export const createSpatialDomainView = (world: ECSWorld): SpatialDomainView => {
  const isRegistered = (id: string) => Boolean(getSpatialDomainOptions(world, id));
  const getLabel = (id: string) => {
    if (!isRegistered(id)) return `${id} (not registered)`;
    return getSpatialDomain(world, id) ? id : `${id} (no grid)`;
  };
  const getSceneId = () => getCurrentSceneId() ?? undefined;
  const listIds = () => {
    const sceneId = getSceneId();
    return [
      ...new Set([
        DEFAULT_SPATIAL_DOMAIN,
        ...getSpatialDomainIds(world),
        ...Object.keys(spatialGridTabState.domains).filter(
          (id) =>
            getSavedCellSize(id, undefined) !== undefined ||
            (sceneId !== undefined && getSavedCellSize(id, sceneId) !== undefined)
        ),
      ]),
    ];
  };
  return {
    isRegistered,
    getLabel,
    listIds,
    getListKey: () => listIds().map(getLabel).join(','),
    getShown: () => {
      const selected = spatialGridTabState.selectedDomain;
      return listIds().includes(selected) ? selected : DEFAULT_SPATIAL_DOMAIN;
    },
    getEditScope: (id) => {
      if (isRegistered(id)) return getSpatialDomainSceneId(world, id);
      const sceneId = getSceneId();
      return sceneId !== undefined && getSavedCellSize(id, sceneId) !== undefined
        ? sceneId
        : undefined;
    },
  };
};

/** The shown domain's values, which its rows bind. Synced on every refresh. */
export type SelectedDomainReadout = {
  domain: string;
  scope: string;
  cellSize: number;
  maxMembers: number;
  update: string;
  showCells: boolean;
  cellsColor: number;
  showOversized: boolean;
  oversizedColor: number;
  oracle: boolean;
};

/** A readout of the shown domain, before its first sync. */
export const createSelectedDomainReadout = (): SelectedDomainReadout => ({
  domain: DEFAULT_SPATIAL_DOMAIN,
  scope: '',
  cellSize: 0,
  maxMembers: 0,
  update: '',
  showCells: false,
  cellsColor: 0,
  showOversized: false,
  oversizedColor: 0,
  oracle: false,
});

/** Syncs `selected` to the shown domain's settings in `world`. */
export const syncSelectedDomain = (
  world: ECSWorld,
  view: SpatialDomainView,
  selected: SelectedDomainReadout
) => {
  const id = view.getShown();
  const opts = getSpatialDomainOptions(world, id);
  const settings = getDomainSettings(id);
  const scope = view.getEditScope(id);
  selected.domain = id;
  selected.scope = scope === undefined ? 'world' : `scene: ${scope}`;
  selected.cellSize = opts?.cellSize ?? getSavedCellSize(id, scope) ?? 0;
  selected.maxMembers = opts?.maxMembers ?? 0;
  selected.update = opts ? opts.update : 'not registered';
  selected.showCells = settings.showCells;
  selected.cellsColor = settings.cellsColor;
  selected.showOversized = settings.showOversized;
  selected.oversizedColor = settings.oversizedColor;
  selected.oracle = isSpatialGridOracleEnabled(world, id);
};

const readout = (
  key: keyof SelectedDomainReadout,
  label: string,
  selected: object,
  format?: (v: number) => string
): Item => ({
  key,
  target: selected,
  label,
  readonly: true,
  ...(format ? { format } : {}),
  interval: 'refresh',
});

/**
 * The shown domain's rows: the domain select, its scope, its cell size (saved for that scope)
 * with its reset, its size and policy, and the brute-force oracle.
 */
export const getDomainItems = (
  world: ECSWorld,
  view: SpatialDomainView,
  selected: SelectedDomainReadout
): Item[] => [
  {
    // A proxy of the saved selection, which may not be listed (see getShown)
    key: 'domain',
    target: selected,
    label: 'Domain',
    options: view.listIds().map((id) => ({ value: id, text: view.getLabel(id) })),
    onChange: (value) => {
      spatialGridTabState.selectedDomain = String(value);
      persistDebuggerTabValue(SPATIAL_GRID_TAB_ID, 'selectedDomain');
      // The refresh syncs the bound values to the newly selected domain
      updateDebuggerTab(SPATIAL_GRID_TAB_ID);
    },
  },
  readout('scope', 'Scope', selected),
  {
    key: 'cellSize',
    target: selected,
    label: 'Cell size',
    // The kit's step grid starts at `min` (p804 D6): 0.5 keeps it on the halves
    min: 0.5,
    step: 0.5,
    // Editable for DEFAULT without a grid too: the edit applies at its next build
    disabled: () => !view.isRegistered(view.getShown()),
    onChange: (value, e) => {
      // Re-creating the grid per drag tick would be costly (DEFAULT holds 100k slots)
      if (!e.last) return;
      const id = view.getShown();
      setSavedCellSize(id, view.getEditScope(id), Number(value));
      persistDomainSettings();
      reapplySpatialDomainOptions(world, id);
      updateDebuggerTab(SPATIAL_GRID_TAB_ID);
    },
  },
  {
    type: 'button',
    title: "Reset to the app's cell size",
    // Only the shown scope's value, so a reset never changes another scene
    disabled: () => {
      const id = view.getShown();
      return getSavedCellSize(id, view.getEditScope(id)) === undefined;
    },
    onClick: () => {
      const id = view.getShown();
      clearSavedCellSize(id, view.getEditScope(id));
      persistDomainSettings();
      reapplySpatialDomainOptions(world, id);
      // Rebuilt: an unregistered domain without a saved value leaves the dropdown
      updateDebuggerTab(SPATIAL_GRID_TAB_ID, { rebuild: true });
    },
  },
  readout('maxMembers', 'Max members', selected, (v) => v.toFixed(0)),
  readout('update', 'Update', selected),
  {
    key: 'oracle',
    target: selected,
    label: 'Brute-force oracle',
    onChange: (value) => {
      setSpatialGridOracleEnabled(world, Boolean(value), view.getShown());
    },
  },
];

/** Writes one overlay setting of the shown domain from the bound readout, saved at a gesture's
 * end. */
const setOverlaySetting =
  (view: SpatialDomainView, key: 'showCells' | 'cellsColor' | 'showOversized' | 'oversizedColor') =>
  (value: unknown, e: { last: boolean }) => {
    const id = view.getShown();
    const settings = editDomainSettings(id);
    if (key === 'showCells' || key === 'showOversized') settings[key] = Boolean(value);
    else settings[key] = Number(value);
    syncSpatialGridOverlays(id);
    if (e.last) persistDomainSettings();
  };

/** "Visualizer": the shown domain's two overlays and their colours. */
export const getVisualizerFolder = (
  view: SpatialDomainView,
  selected: SelectedDomainReadout
): Item => ({
  type: 'folder',
  title: 'Visualizer',
  content: [
    {
      key: 'showCells',
      target: selected,
      label: 'Show grid wireframe',
      onChange: setOverlaySetting(view, 'showCells'),
    },
    {
      key: 'cellsColor',
      target: selected,
      label: 'Wireframe color',
      kind: 'color',
      onChange: setOverlaySetting(view, 'cellsColor'),
    },
    {
      key: 'showOversized',
      target: selected,
      label: 'Show oversized bounds',
      onChange: setOverlaySetting(view, 'showOversized'),
    },
    {
      key: 'oversizedColor',
      target: selected,
      label: 'Oversized color',
      kind: 'color',
      onChange: setOverlaySetting(view, 'oversizedColor'),
    },
  ],
});
