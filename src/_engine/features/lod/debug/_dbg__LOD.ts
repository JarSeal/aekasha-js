import {
  createDebuggerTab,
  debuggerListCMP,
  type DebuggerListItem,
  updateDebuggerTab,
} from '../../../debug/DebuggerGUI';
import { getECSWorld, type ECSWorld } from '../../../kernel/ecs/ECS';
import { ComponentType } from '../../../kernel/ecs/ECSCoreComponents';
import { getDevFilesStatus } from '../../../debug/DevFiles';
import { getImpostorRecords } from '../impostors/ImpostorRegistry';
import {
  getLodBias,
  getLodDebugOptions,
  getLodFadeSeconds,
  getLodFrameStats,
  getLodMaxSelectionsPerFrame,
  type LodFrameStats,
} from '../LodSettings';
import {
  getLodEntityName,
  getOpenLodEntityWindowIds,
  toggleLodEntityWindow,
} from './_dbg__LodEntityWindow';
import { isLodOverlayEnabled } from './_dbg__LodOverlay';
import {
  getFadesFolder,
  getImpostorsFolder,
  getInspectFolder,
  getLastFrameFolder,
  getOverlayFolder,
  getSelectionFolder,
  LOD_TAB_ID,
  toCapOption,
  type LodControls,
} from './_dbg__LodTabItems';

// The LOD tab (docs/plans/_DONE_p348_ecs-lod-selection.md §6): counts per level, the last frame's
// selections, applies and fades, the selection's runtime overrides, the fades' duration and time
// scale (docs/plans/_DONE_p351_impostor-billboard-lod.md Phase 2), the level overlay
// (_dbg__LodOverlay.ts), the per-entity LOD windows (_dbg__LodEntityWindow.ts) and the
// impostors generated in this session with their Export (p351 Phase 4,
// _dbg__ImpostorExport.ts). Nothing is persisted: it's all for inspecting, and a reload starts
// from the app's values. Default world only. Its folders are _dbg__LodTabItems.ts (p806 D11).

/** Rows the mesh list shows at most (a scene can have thousands of LOD meshes). */
const MAX_LIST_ROWS = 100;

/** The default world's LOD meshes (not pool instances: those are too many to list; "Nearest in
 * view" reaches them), the first MAX_LIST_ROWS. */
export const getLodMeshListData = (world: ECSWorld): DebuggerListItem[] => {
  const items: DebuggerListItem[] = [];
  let more = 0;
  for (const [entityId, lod] of world.getStorage(ComponentType.LOD)) {
    if (lod._target) continue;
    if (items.length >= MAX_LIST_ROWS) {
      more++;
      continue;
    }
    let suffix = `L${Math.max(lod.applied, 0)}`;
    const isFading = world.hasComponent(entityId, ComponentType.TAG_LOD_TRANSITIONING);
    if (
      world.isDisabled(entityId) ||
      world.hasComponent(entityId, ComponentType.TAG_FRUSTUM_CULLED)
    ) {
      suffix = 'out of view';
    } else if (world.hasComponent(entityId, ComponentType.TAG_LOD_CULLED)) {
      suffix = isFading ? 'fading out' : 'culled';
    } else if (isFading) {
      suffix += ' fading';
    }
    items.push({
      itemId: String(entityId),
      title: getLodEntityName(entityId, world),
      subTitle: `[${entityId}]`,
      suffix,
    });
  }
  if (more) {
    items.push({
      itemId: 'more',
      title: `…and ${more} more`,
      disabled: true,
      titlePlaceholder: true,
    });
  }
  return items;
};

/** The fixed lines of the counts text after the level lines. */
const COUNT_EXTRA_LINES = 3;

/** Entities per shown level, plus the hidden ones by reason. */
type LodCounts = { levels: number[]; lodCulled: number; outOfView: number; total: number };

/**
 * Counts the default world's LOD entities. Shown ones by the level they show (one not selected
 * yet, or without levels, shows the mesh as created: level 0), hidden ones by why: out of view
 * (disabled or frustum-culled, keeping their level) or LOD-culled.
 */
const countLevels = (world: ECSWorld): LodCounts => {
  const counts: LodCounts = { levels: [0], lodCulled: 0, outOfView: 0, total: 0 };
  for (const [entityId, lod] of world.getStorage(ComponentType.LOD)) {
    counts.total++;
    const levelCount = Math.max(lod._levels.length, 1);
    while (counts.levels.length < levelCount) counts.levels.push(0);
    if (
      world.isDisabled(entityId) ||
      world.hasComponent(entityId, ComponentType.TAG_FRUSTUM_CULLED)
    ) {
      counts.outOfView++;
    } else if (world.hasComponent(entityId, ComponentType.TAG_LOD_CULLED)) {
      counts.lodCulled++;
    } else {
      counts.levels[Math.max(lod.applied, 0)]++;
    }
  }
  return counts;
};

/** The counts as aligned lines (the monitor's mono font): a level's, then the hidden ones. */
export const formatLodCounts = (world: ECSWorld) => {
  const counts = countLevels(world);
  const row = (label: string, value: number) => `${label.padEnd(12)}${String(value).padStart(7)}`;
  const text = [
    ...counts.levels.map((n, i) => row(`Level ${i}`, n)),
    row('LOD culled', counts.lodCulled),
    row('Out of view', counts.outOfView),
    row('Total', counts.total),
  ].join('\n');
  return { text, levelCount: counts.levels.length };
};

/** What the impostor rows were built for: a rebuild follows a change */
const getImpostorsSignature = () =>
  getImpostorRecords()
    .map((record) => `${record.id}:${record.kind}:${record.origin}`)
    .join('|');

/** Creates the "LOD" drawer tab (`lodControls`): the LOD debug module's entry, which
 * `registerLodDebugGUI` loads. */
export const _createLodDebugGUI = () => {
  const world = getECSWorld();

  const controls: LodControls = {
    overlay: false,
    bias: 1,
    maxSelections: -1,
    freeze: false,
    forceLevel: -1,
    useActiveCamera: false,
    fadeSeconds: 0.25,
    fadeTimeScale: 1,
  };
  const stats: LodFrameStats = {
    selections: 0,
    lapFrames: 1,
    applies: 0,
    totalApplies: 0,
    selectionMs: 0,
    fading: 0,
    fadeMs: 0,
  };
  const countsState = { text: '' };

  /** Levels of the entity with the most, which the counts and the force options list. */
  let levelCount = 1;
  let builtLevelCount = 0;
  /** The impostors the folders were built for (null: not built) */
  let builtImpostors: string | null = null;
  let devFilesNote = 'Checking the dev files…';

  createDebuggerTab({
    id: LOD_TAB_ID,
    title: 'LOD',
    icon: 'lod',
    // Nothing is persisted; the disabled button keeps the heading like the other tabs'
    clearLSButton: true,
    refreshIntervalMs: 500,
    onRefresh: () => {
      const opts = getLodDebugOptions();
      controls.overlay = isLodOverlayEnabled();
      controls.bias = getLodBias();
      controls.maxSelections = toCapOption(getLodMaxSelectionsPerFrame());
      controls.freeze = opts.freeze;
      controls.forceLevel = opts.forceLevel;
      controls.useActiveCamera = opts.useActiveCamera;
      controls.fadeSeconds = getLodFadeSeconds();
      controls.fadeTimeScale = opts.fadeTimeScale;
      Object.assign(stats, getLodFrameStats(world));

      const counts = formatLodCounts(world);
      countsState.text = counts.text;
      levelCount = counts.levelCount;

      // Another level count (eg. a scene change): the force options and the counts' rows need
      // a rebuild, as do other impostors' folders. Deferred, since this runs inside a refresh or
      // a build.
      const isLevelCountChanged = builtLevelCount && levelCount !== builtLevelCount;
      const isImpostorsChanged =
        builtImpostors !== null && builtImpostors !== getImpostorsSignature();
      if (isLevelCountChanged || isImpostorsChanged) {
        builtLevelCount = 0;
        builtImpostors = null;
        queueMicrotask(() => updateDebuggerTab(LOD_TAB_ID, { rebuild: true }));
      }
    },
    onOpen: () => {
      let isOpen = true;
      // Asked on every mount: the server can restart with other settings
      getDevFilesStatus().then((status) => {
        if (!isOpen) return;
        devFilesNote = status.available
          ? 'Export writes the files into the repo.'
          : `Export downloads the files: ${status.message}.`;
        updateDebuggerTab(LOD_TAB_ID);
      });
      return () => {
        isOpen = false;
      };
    },
    content: () => {
      builtLevelCount = levelCount;
      builtImpostors = getImpostorsSignature();
      return [
        {
          pane: true,
          content: [
            {
              key: 'text',
              target: countsState,
              label: 'Entities',
              readonly: true,
              multiline: true,
              rows: levelCount + COUNT_EXTRA_LINES,
              interval: 'refresh',
            },
            getLastFrameFolder(stats),
            getSelectionFolder(controls, levelCount),
            getFadesFolder(controls),
            getOverlayFolder(controls, levelCount),
            getImpostorsFolder(getImpostorRecords(), () => devFilesNote),
            getInspectFolder(world),
          ],
        },
        debuggerListCMP({
          id: 'lodMeshes',
          heading: 'Meshes with a LOD',
          emptyText: 'No meshes with a LOD (pool instances: "Nearest in view").',
          data: () => getLodMeshListData(world),
          selectedItemId: getOpenLodEntityWindowIds,
          perItemConfig: {
            onClick: (itemId) => {
              if (itemId === 'more') return;
              toggleLodEntityWindow(Number(itemId));
              // The row selection follows the window
              queueMicrotask(() => updateDebuggerTab(LOD_TAB_ID));
            },
          },
        }),
      ];
    },
  });
};
