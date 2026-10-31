import { createDebuggerTab, updateDebuggerTab } from '../../../debug/DebuggerGUI';
import { getECSWorld } from '../../../kernel/ecs/ECS';
import {
  DEFAULT_SPATIAL_DOMAIN,
  getSpatialDomainIds,
  reapplySpatialDomainOptions,
  setSpatialDomainOptionsOverride,
} from '../SpatialDomains';
import {
  getSavedCellSize,
  migrateLegacySpatialGridSettings,
  SPATIAL_GRID_LS_KEY,
  SPATIAL_GRID_TAB_ID,
  spatialGridTabState,
} from './_dbg__SpatialGridSettings';
import {
  registerSpatialGridVisualizer,
  syncCreatedSpatialGridOverlays,
  syncSpatialGridOverlays,
} from './_dbg__SpatialGridOverlays';
import {
  createSelectedDomainReadout,
  createSpatialDomainView,
  getDomainItems,
  getVisualizerFolder,
  syncSelectedDomain,
} from './_dbg__SpatialGridItems';
import {
  createSpatialStatsReadout,
  getAllDomainsFolder,
  getLiveStatsFolder,
  getOccupancyFolder,
  syncSpatialStats,
} from './_dbg__SpatialGridReadouts';

// The "Spatial index" drawer tab (docs/plans/_DONE_p050_spatial-index.md §9,
// docs/plans/_DONE_p346_spatial-domains.md §3.6): per domain, the cell size override, the
// brute-force oracle, the overlays and the rebuild counts, and an all-domains summary. Default
// world only. Its settings, overlays, rows and figures are the `_dbg__SpatialGrid*.ts` modules
// beside it (p806 D11).

/** Creates the "Spatial index" drawer tab (`spatialGridControls`): the spatial index's debug
 * module entry, which `registerSpatialIndexDebugGUI` loads. */
export const _createSpatialGridDebugGUI = () => {
  const world = getECSWorld();
  // Before createDebuggerTab, which hydrates the state from the saved settings
  migrateLegacySpatialGridSettings();

  const view = createSpatialDomainView(world);
  const selected = createSelectedDomainReadout();
  const stats = createSpatialStatsReadout();
  let builtDomainListKey = '';

  createDebuggerTab({
    id: SPATIAL_GRID_TAB_ID,
    title: 'Spatial index',
    icon: 'spatialGrid',
    lsKey: SPATIAL_GRID_LS_KEY,
    state: spatialGridTabState,
    persistKeys: ['selectedDomain', 'domains'],
    onClearLS: () => {
      spatialGridTabState.selectedDomain = DEFAULT_SPATIAL_DOMAIN;
      spatialGridTabState.domains = {};
      syncCreatedSpatialGridOverlays();
      // Back to the cell sizes the app registered
      for (const id of getSpatialDomainIds(world)) reapplySpatialDomainOptions(world, id);
      updateDebuggerTab(SPATIAL_GRID_TAB_ID, { rebuild: true });
    },
    // Debug-only polling: simplest way to keep a live readout current without wiring a
    // subscriber through the rebuild system (it only runs while the tab is visible)
    refreshIntervalMs: 500,
    onRefresh: () => {
      syncSelectedDomain(world, view, selected);
      syncSpatialStats(world, selected.domain, stats);
      // A domain registered, unregistered or saved since the build, or a scene change: the
      // dropdown and the domains' rows need a rebuild. Deferred, since this runs inside a refresh
      // or a build.
      if (builtDomainListKey && view.getListKey() !== builtDomainListKey) {
        builtDomainListKey = '';
        queueMicrotask(() => updateDebuggerTab(SPATIAL_GRID_TAB_ID, { rebuild: true }));
      }
    },
    content: () => {
      builtDomainListKey = view.getListKey();
      selected.domain = view.getShown();
      return [
        {
          pane: true,
          content: [
            ...getDomainItems(world, view, selected),
            getVisualizerFolder(view, selected),
            getLiveStatsFolder(stats),
            getOccupancyFolder(stats),
            getAllDomainsFolder(world, view.listIds()),
          ],
        },
      ];
    },
  });

  // The saved cell sizes apply to every registration in the default world from here on (the
  // tab only covers that world), and to the domains registered before the tab. Each scope gets
  // only its own value: a scene's settings never get the world value.
  setSpatialDomainOptionsOverride((w, requested, sceneId) => {
    const cellSize = w === world ? getSavedCellSize(requested.id, sceneId) : undefined;
    return cellSize === undefined ? requested : { ...requested, cellSize };
  });
  for (const id of getSpatialDomainIds(world)) reapplySpatialDomainOptions(world, id);

  for (const id of Object.keys(spatialGridTabState.domains)) syncSpatialGridOverlays(id);
  registerSpatialGridVisualizer();
};
