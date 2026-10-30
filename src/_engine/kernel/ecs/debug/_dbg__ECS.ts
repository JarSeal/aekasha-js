// The ECS tab: the worlds' list (a row opens the world's edit window, on the UI kit's property
// grid, p806 D10) and the stress test benchmark.
import {
  createDebuggerTab,
  debuggerListCMP,
  updateDebuggerTab,
  type DebuggerListItem,
} from '../../../debug/DebuggerGUI';
import {
  DEFAULT_ECS_WORLD_ID,
  deleteECSWorld,
  ECSWorld,
  getAllECSWorlds,
  getECSWorld,
  onECSEntityCountChange,
  onECSWorldRegistryChange,
} from '../ECS';
import {
  clearECSStorageLSOverride,
  ECS_LS_KEY,
  getECSStorageLSOverride,
  setECSStorageLSOverride,
  type ECSStorageLSOverride,
} from '../ECSComponentStorage';
import { lsRemoveItem } from '../../../utils/LocalAndSessionStorage';
import { createClearListLSButton, lsKeyHasData } from '../../../debug/_dbg__ClearLSButtons';
import { ComponentType } from '../ECSCoreComponents';
import { resetECSStressTest, spawnECSStressTestBatch } from './_dbg__ECSStressTest';
import { CMP } from '../../../ui/core/CMP';
import {
  closeDraggableWindow,
  getDraggableWindowsOfKind,
  getKindWindowId,
  registerDraggableWindowKind,
  toggleDraggableWindow,
} from '../../../ui/overlays/windows/DraggableWindow';
import { isCurrentlyLoading } from '../../scene/SceneLoader';
import type { PropertyGridItem } from '../../../ui/forms/PropertyGridItems';
import { createDebugWindowGrid, getInfoRowItem } from '../../../debug/_dbg__DebugWindowGrid';

/** The edit windows' kind: one window per world, keyed by its id */
export const EDIT_ECS_WORLD_WIN_ID = 'ecsWorldEditorWindow';
const TAB_ID = 'ecsControls';
let worldRegistryListenerRegistered = false;
const refreshECSTab = () => updateDebuggerTab(TAB_ID);

// Coalesces list refreshes to at most once per animation frame. Entity
// creation/deletion can happen thousands of times in one stress-test batch
// (_dbg__ECSStressTest.ts) — rebuilding the whole list's HTML on every single one
// would be a real cost, unlike the rare world create/delete case (which
// still refreshes synchronously via updateECSWorldsDebuggerGUI below).
let listRefreshScheduled = false;
const scheduleListRefresh = () => {
  if (listRefreshScheduled) return;
  listRefreshScheduled = true;
  requestAnimationFrame(() => {
    listRefreshScheduled = false;
    refreshECSTab();
  });
};

/** Each open edit window's grid refresh, by world id: set by createEditECSWorldContent, removed
 * with its content. An entity added or removed refreshes it (the count's monitor reads on a
 * refresh only), not a window rebuild, since that can fire at stress-test frequency. */
const openWorldEditRefreshes = new Map<string, () => void>();

/** Applies a storage setting: saved as the world's override, then the app reloads (the storage is
 * made at the world's creation) */
const applyStorageConfig = (worldId: string, config: ECSStorageLSOverride) => {
  setECSStorageLSOverride(worldId, config);
  location.reload();
};

/** The world's storage folder: its mode and max entities, each change reloading the app */
const getStorageFolder = (world: ECSWorld): PropertyGridItem => {
  const storageConfig = { storageMode: world.storageMode, maxEntities: world.maxEntities };
  return {
    type: 'folder',
    id: 'storage',
    title: 'Storage (reloads the app)',
    items: [
      {
        target: storageConfig,
        key: 'storageMode',
        label: 'Storage mode',
        options: { Map: 'MAP', 'Typed Array': 'TYPED_ARRAY' },
        onChange: () => applyStorageConfig(world.id, storageConfig),
      },
      // Both MAP and TYPED_ARRAY enforce maxEntities as a real cap, so it's always editable. A
      // gesture's end reloads (a key step's keyup, a typed value's Enter), not each step. The
      // kit's step grid starts at `min`: 1000 keeps the steps on thousands
      {
        target: storageConfig,
        key: 'maxEntities',
        label: 'Max entities',
        step: 1000,
        min: 1000,
        onChange: (_value, change) => {
          if (change.last) applyStorageConfig(world.id, storageConfig);
        },
      },
      {
        type: 'button',
        title: 'Clear local storage',
        disabled: () => !getECSStorageLSOverride(world.id),
        onClick: () => {
          clearECSStorageLSOverride(world.id);
          location.reload();
        },
      },
    ],
  };
};

/** Logic for the Edit ECS World Draggable Window (p806 D10: the UI kit's property grid) */
export const createEditECSWorldContent = (data?: { [key: string]: unknown }) => {
  const d = data as { id: string };
  const world = ECSWorld.getWorld(d.id);
  if (!world) return CMP({ style: { padding: '10px' }, text: 'ECS World no longer exists' });

  // The content is built before the window state is open: refresh the list selection after it
  queueMicrotask(refreshECSTab);

  const items: PropertyGridItem[] = [
    {
      label: 'Entity count',
      get: () => world.getEntityCount(),
      readonly: true,
      interval: 'refresh',
      format: (v) => (v as number).toFixed(0),
    },
    getStorageFolder(world),
  ];
  if (world.id !== DEFAULT_ECS_WORLD_ID) {
    items.push({
      type: 'button',
      title: 'Delete world',
      variant: 'danger',
      onClick: () => {
        // Close first so the registry-change notification (fired from inside
        // deleteECSWorld) doesn't try to refresh a window whose world is
        // already gone.
        closeDraggableWindow(getKindWindowId(EDIT_ECS_WORLD_WIN_ID, world.id));
        deleteECSWorld(world.id);
      },
    });
  }
  items.push(
    { type: 'separator' },
    getInfoRowItem('World ID', world.id),
    getInfoRowItem('Name', world.name),
    ...(world.description ? [getInfoRowItem('Description', world.description)] : [])
  );

  // Kept live by the onECSEntityCountChange listener registered in _initECSDebugGUI
  let refresh = () => {};
  const { cmp, grid } = createDebugWindowGrid({
    items,
    onRemove: () => {
      if (openWorldEditRefreshes.get(world.id) === refresh) openWorldEditRefreshes.delete(world.id);
    },
  });
  refresh = grid.refresh;
  openWorldEditRefreshes.set(world.id, refresh);
  return cmp;
};

registerDraggableWindowKind(EDIT_ECS_WORLD_WIN_ID, {
  content: createEditECSWorldContent,
  onClose: refreshECSTab,
  // Kept open on a scene change when the world still exists (secondary worlds are scene-scoped)
  sceneTargetResolver: (data) => Boolean(ECSWorld.getWorld(String(data?.id))),
});

/** The default world's TRANSFORM entity count (and capacity), for the benchmark readout. */
const benchmarkReadout = { entities: '' };
const updateBenchmarkReadout = () => {
  const world = getECSWorld();
  const entityCount = world.getStorage(ComponentType.TRANSFORM).size;
  const capacity = world.getTypedTransformStore()?.capacity;
  benchmarkReadout.entities =
    capacity !== undefined ? `${entityCount} / ${capacity}` : `${entityCount} (Map, uncapped)`;
};
const benchmarkConfig = { batchSize: 1000 };

/** Creates the Tab in the Debug Drawer */
export const _initECSDebugGUI = () => {
  // Registered once (not per tab-open): refreshes the live list (and closes
  // a deleted world's edit window) whenever any world is created or deleted
  // anywhere in the app.
  if (!worldRegistryListenerRegistered) {
    worldRegistryListenerRegistered = true;
    onECSWorldRegistryChange(onWorldRegistryChange);

    // Entity add/remove in any world — keeps list entity counts and the
    // open edit window's count correct. Routed through the rAF-coalesced
    // scheduleListRefresh (not updateECSWorldsDebuggerGUI's synchronous
    // path), since this can fire thousands of times per stress-test batch.
    onECSEntityCountChange((world) => {
      scheduleListRefresh();
      openWorldEditRefreshes.get(world.id)?.();
    });
  }

  createDebuggerTab({
    id: TAB_ID,
    title: 'ECS',
    icon: 'ecs',
    // A refresh re-reads what it shows: kept open on a scene change (p806 D5)
    keepOnSceneChange: true,
    // The whole 'AEK_ecs' key IS the per-world-id list (see ECSComponentStorage.ts) - there is
    // no separate tab-only field, so the tab button stays disabled (kept for consistency)
    clearLSButton: true,
    headerButtons: () => [
      createClearListLSButton({
        hasData: () => lsKeyHasData(ECS_LS_KEY),
        watchKey: ECS_LS_KEY,
        // Keyed by world id, not scene id - no scope ambiguity, so no confirm dialog.
        onClear: () => lsRemoveItem(ECS_LS_KEY),
      }),
    ],
    // The benchmark readout (only while the tab is visible)
    refreshIntervalMs: 1000,
    onRefresh: updateBenchmarkReadout,
    content: () => [
      debuggerListCMP({
        id: 'ecsWorlds',
        label: 'ECS worlds',
        emptyText: 'No ECS worlds found.',
        data: getECSWorldsListData,
        selectedItemId: () =>
          getDraggableWindowsOfKind(EDIT_ECS_WORLD_WIN_ID).map((win) => String(win.data?.id)),
        perItemConfig: { onClick: openEditECSWorldWindow },
      }),
      // --- Benchmark ---
      // Always targets the default world — reuses _dbg__ECSStressTest.ts' spawn logic so Map vs
      // Typed Array can be compared live: pick a mode in a world's edit window (reloads), then
      // spawn a batch here and watch the Stats tab's FPS/frame-time panel.
      {
        pane: true,
        content: [
          {
            type: 'folder',
            id: 'benchmark',
            title: 'Stress Test Benchmark (default world)',
            content: [
              {
                key: 'entities',
                target: benchmarkReadout,
                label: 'TRANSFORM entities',
                readonly: true,
              },
              {
                key: 'batchSize',
                target: benchmarkConfig,
                label: 'Batch size',
                step: 100,
                min: 1,
                max: 20000,
              },
              {
                type: 'button',
                title: 'Spawn individual meshes',
                onClick: () => {
                  spawnECSStressTestBatch(getECSWorld(), benchmarkConfig.batchSize, false);
                  refreshECSTab();
                },
              },
              {
                type: 'button',
                title: 'Spawn instanced meshes',
                onClick: () => {
                  spawnECSStressTestBatch(getECSWorld(), benchmarkConfig.batchSize, true);
                  refreshECSTab();
                },
              },
              {
                type: 'button',
                title: 'Clear stress-test entities',
                onClick: () => {
                  resetECSStressTest(getECSWorld());
                  refreshECSTab();
                },
              },
            ],
          },
        ],
      },
    ],
  });
};

const getECSWorldsListData = (): DebuggerListItem[] =>
  getAllECSWorlds().map((world) => ({
    itemId: world.id,
    title: world.name,
    subTitle: world.id === DEFAULT_ECS_WORLD_ID ? world.id : `[${world.id}]`,
    suffix: `(${world.getEntityCount()} ent.)`,
  }));

/** List row click: opens the world's window, brings it to the front, or closes it when on top. */
const openEditECSWorldWindow = (worldId: string) => {
  const world = ECSWorld.getWorld(worldId);
  if (!world) return;
  toggleDraggableWindow({
    id: getKindWindowId(EDIT_ECS_WORLD_WIN_ID, world.id),
    kind: EDIT_ECS_WORLD_WIN_ID,
    title: `Edit ECS World: ${world.name}`,
    isDebugWindow: true,
    data: { id: world.id },
    closeOnSceneChange: true,
    saveToLS: true,
  });
};

/** A world was created or deleted: refreshes the list and closes the deleted worlds' windows. A
 * scene change leaves the windows to the scene change handling (kept when the next scene has the
 * world). */
const onWorldRegistryChange = () => {
  refreshECSTab();
  if (isCurrentlyLoading()) return;
  const wins = getDraggableWindowsOfKind(EDIT_ECS_WORLD_WIN_ID);
  for (let i = 0; i < wins.length; i++) {
    if (!ECSWorld.getWorld(String(wins[i].data?.id))) closeDraggableWindow(wins[i].id);
  }
};
