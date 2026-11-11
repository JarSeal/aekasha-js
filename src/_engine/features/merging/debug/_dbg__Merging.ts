import {
  createDebuggerTab,
  debuggerListCMP,
  type DebuggerListItem,
  type DebuggerPaneItem,
  updateDebuggerTab,
} from '../../../debug/DebuggerGUI';
import { getNoteItem } from '../../../debug/_dbg__DebugWindowGrid';
import { getECSWorld, type ECSWorld } from '../../../kernel/ecs/ECS';
import { ComponentType } from '../../../kernel/ecs/ECSCoreComponents';
import { isBatchedGroup } from '../MergeBatchFront';
import { getMergeDebugStats } from '../MergeState';
import type { MergeGroupData } from '../MergeTypes';
import {
  createMergeRateMeter,
  formatCount,
  formatCountOf,
  getAutoCellLabel,
  getGroupVertexCount,
  getMaterialLabel,
  getMergeBatchFigures,
  getMergeEntityName,
  getMergeSummary,
  getStandingRefusals,
  MERGING_TAB_ID,
} from './_dbg__MergingInfo';
import {
  getMergeOverlayCounts,
  isMergeGroupHighlighted,
  isMergeHighlightAll,
  MAX_BOXES_PER_COLOR,
  setMergeGroupHighlighted,
  setMergeHighlightAll,
} from './_dbg__MergingOverlay';
import {
  getUnmergedViewCount,
  isMergeGroupUnmergedView,
  setMergeGroupUnmergedView,
} from './_dbg__MergingUnmerged';
import {
  _registerMergingWindowLinks,
  getOpenMergeGroupWindowIds,
  toggleMergeGroupWindow,
} from './_dbg__MergingWindows';

// The Merging tab (docs/plans/_DONE_p373_merge-debug-and-member-editing.md D1): the default world's
// merge groups at a glance (the groups, members and vertices, the draws per pass merged against
// unmerged, the waste, the builds and in-place updates of the last second, the last build's time),
// a row per group opening its window (_dbg__MergingWindows.ts; a batched group's with its badge and
// its batch figures, p375 S5), and the entities whose `merge` was refused with the reason. A group's members can be outlined (_dbg__MergingOverlay.ts), and a group
// shown unmerged for an A/B (_dbg__MergingUnmerged.ts). Nothing is
// persisted: it's all for inspecting. Default world only.

/** Rows the group list shows at most */
const MAX_GROUP_ROWS = 200;

type Item = DebuggerPaneItem<object>;

/** The summary's monitors' texts, written on every refresh */
type Readouts = {
  groups: string;
  members: string;
  vertices: string;
  wasted: string;
  draws: string;
  shadowDraws: string;
  builds: string;
  updates: string;
  lastBuild: string;
  refused: string;
};

/** The draws now against every member drawn on its own, eg. "28 now · 409 unmerged" ("now"
 * counts a group shown unmerged and the members waiting for a build by their own draws). */
const formatDraws = (now: number, unmerged: number) =>
  `${formatCount(now)} now · ${formatCount(unmerged)} unmerged`;

/** The summary's texts for a world (`rates`: the last second's builds and updates). */
export const formatMergeSummary = (
  world: ECSWorld,
  rates: { builds: number; updates: number }
): Readouts => {
  const s = getMergeSummary(world);
  const stats = getMergeDebugStats(world);
  const wastedShare = s.mergedVertices
    ? ` (${Math.round((s.wastedVertices / s.mergedVertices) * 100)} %)`
    : '';
  const last = stats.lastBuild;
  const unmerged = getUnmergedViewCount(world);
  const shownUnmerged = unmerged ? `, ${formatCount(unmerged)} shown unmerged` : '';
  return {
    groups: `${formatCount(s.groups)} (${formatCount(s.drawnGroups)} drawn, ${formatCount(s.pendingGroups)} pending${shownUnmerged})`,
    members: `${formatCount(s.members)} (${formatCount(s.builtMembers)} merged, ${formatCount(s.members - s.builtMembers)} waiting, ${formatCount(s.queued)} queued)`,
    vertices: formatCount(s.mergedVertices),
    wasted: `${formatCount(s.wastedVertices)}${wastedShare}`,
    draws: formatDraws(s.drawsNow, s.drawsUnmerged),
    shadowDraws: formatDraws(s.shadowDrawsNow, s.shadowDrawsUnmerged),
    builds: `${formatCount(rates.builds)} (${formatCount(stats.builds)} in total)`,
    updates: `${formatCount(rates.updates)} (${formatCount(stats.inPlaceUpdates)} in total)`,
    lastBuild: last
      ? `${last.ms.toFixed(1)} ms, ${last.isWorker ? 'worker' : 'main thread'}: ${last.groupId}`
      : 'none yet',
    refused: formatCount(getStandingRefusals(world).length),
  };
};

/** A group row's badge: `AUTO` and `BATCHED` (the default mode, `BAKED`, has none), or none. */
const getGroupBadge = (group: MergeGroupData) => {
  const badge = [group._isAuto ? 'AUTO' : '', isBatchedGroup(group) ? 'BATCHED' : '']
    .filter(Boolean)
    .join(' · ');
  return badge ? { badge } : {};
};

/** A group row's figures: its members and vertices; a built batched group's members, visible
 * members, its draws by its order (geometry runs and compactions, draws sorted by range, or one
 * multi-draw), and its LOD fades while there are some. */
const getGroupRowFigures = (groupEntityId: number, group: MergeGroupData, world: ECSWorld) => {
  const members = formatCountOf(group.members.length, 'member');
  const batch = getMergeBatchFigures(group, world);
  if (batch) {
    const fading = batch.levelFades + batch.cullFades;
    const order =
      batch.order === 'COMPACT'
        ? `${formatCountOf(batch.runs, 'run')}, ${formatCountOf(batch.compactions, 'compaction')}`
        : batch.order === 'RANGE_SORT'
          ? `${formatCountOf(batch.draws, 'draw')} sorted by range`
          : 'one multi-draw';
    return `${members} (${formatCount(batch.visible)} visible), ${order}${fading ? `, ${formatCount(fading)} fading` : ''}`;
  }
  return `${members}, ${formatCount(getGroupVertexCount(groupEntityId, group, world))} v`;
};

/** A row per group of the world, in creation order: its id, its badge (`AUTO`, `BATCHED`), `AUTO`
 * cell, material, members and vertices, or a batched group's figures (the first MAX_GROUP_ROWS). */
export const getMergeGroupListData = (world: ECSWorld): DebuggerListItem[] => {
  const items: DebuggerListItem[] = [];
  let more = 0;
  for (const [groupEntityId, group] of world.getStorage(ComponentType.MERGE_GROUP)) {
    if (items.length >= MAX_GROUP_ROWS) {
      more++;
      continue;
    }
    const cell = getAutoCellLabel(group.id);
    const state = group._isPending ? ', pending' : '';
    items.push({
      itemId: String(groupEntityId),
      title: group.id,
      subTitle: `[${groupEntityId}]`,
      ...getGroupBadge(group),
      description: `${getMaterialLabel(group._material)}${cell ? ` · cell ${cell}` : ''}`,
      suffix: `${getGroupRowFigures(groupEntityId, group, world)}${state}`,
      // Right to left: the highlight, then the A/B (a built group's only)
      toggleValues: [
        isMergeGroupHighlighted(group.id),
        world.hasComponent(groupEntityId, ComponentType.OBJECT3D)
          ? isMergeGroupUnmergedView(groupEntityId, world)
          : null,
      ],
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

/** The highlight's note: the member boxes over the overlay's cap, if any. */
export const getMergeOverlayNote = () => {
  const { skipped } = getMergeOverlayCounts();
  return skipped
    ? `${formatCount(skipped)} member boxes in view aren't outlined: each colour draws ${formatCount(MAX_BOXES_PER_COLOR)} at most.`
    : '';
};

/** A group row's highlight toggle: the group's members outlined, by the row's group entity. */
const toggleGroupHighlight = (world: ECSWorld, itemId: string, isOn: boolean) => {
  const group = world.getComponent(Number(itemId), ComponentType.MERGE_GROUP);
  if (group) setMergeGroupHighlighted(group.id, isOn, world);
};

/** A row per refused entity still standing, newest first. */
export const getMergeRefusalListData = (world: ECSWorld): DebuggerListItem[] =>
  getStandingRefusals(world).map((row) => ({
    itemId: String(row.entityId),
    title: getMergeEntityName(row.entityId, world),
    subTitle: `[${row.entityId}]`,
    description: `${row.groupId}: ${row.reason}`,
  }));

/** Creates the "Merging" drawer tab (`mergingControls`): the merging debug module's entry, which
 * `registerMergeDebug` loads. */
export const _createMergingDebugGUI = () => {
  _registerMergingWindowLinks();
  const world = getECSWorld();
  const rates = createMergeRateMeter();
  const readouts: Readouts = formatMergeSummary(world, { builds: 0, updates: 0 });
  const monitor = (key: keyof Readouts, label: string, hint?: string): Item => ({
    key,
    target: readouts,
    label,
    readonly: true,
    interval: 'refresh',
    ...(hint ? { hint } : {}),
  });

  createDebuggerTab({
    id: MERGING_TAB_ID,
    title: 'Merging',
    icon: 'merge',
    // Nothing is persisted; the disabled button keeps the heading like the other tabs'
    clearLSButton: true,
    refreshIntervalMs: 500,
    keepOnSceneChange: true,
    onSceneChange: () => rates.reset(),
    onRefresh: () => {
      Object.assign(readouts, formatMergeSummary(world, rates.read(world, performance.now())));
    },
    content: () => [
      {
        pane: true,
        content: [
          monitor('groups', 'Groups'),
          monitor('members', 'Members', 'Waiting: joined, merged at the next build.'),
          monitor('vertices', 'Merged vertices'),
          monitor('wasted', 'Wasted vertices', 'Left by removed members: a rebuild compacts.'),
          monitor('draws', 'Draws, main pass'),
          monitor('shadowDraws', 'Draws, shadow pass'),
          getNoteItem(
            'Draws per pass before culling: what the pass submits with everything in view. A merged group is culled whole; a batched one counts a draw per geometry run (WebGPU; WebGL2 draws it in one) and culls each member.'
          ),
          monitor('builds', 'Builds, last second'),
          monitor('updates', 'In-place updates, last second'),
          monitor('lastBuild', 'Last build'),
          monitor('refused', 'Refused entities'),
          {
            label: 'Highlight all groups',
            get: isMergeHighlightAll,
            set: (value) => {
              setMergeHighlightAll(Boolean(value));
              // The rows' toggles follow
              updateDebuggerTab(MERGING_TAB_ID);
            },
            hint: "Outlines every group's members in the group's colour (in view only).",
          },
          getNoteItem(getMergeOverlayNote),
        ],
      },
      debuggerListCMP({
        id: 'mergeGroups',
        heading: 'Merge groups',
        emptyText: 'No merge groups in this world.',
        data: () => getMergeGroupListData(world),
        selectedItemId: getOpenMergeGroupWindowIds,
        perItemConfig: {
          toggles: [
            {
              icon: 'objectsCubes',
              title: 'Highlight the members',
              fn: (itemId, isOn) => toggleGroupHighlight(world, itemId, isOn),
            },
            {
              icon: 'geometry',
              title: 'Show unmerged (A/B)',
              fn: (itemId, isOn) => {
                setMergeGroupUnmergedView(Number(itemId), isOn, world);
                // The summary's draws follow
                queueMicrotask(() => updateDebuggerTab(MERGING_TAB_ID));
              },
            },
          ],
          onClick: (itemId) => {
            if (itemId === 'more') return;
            toggleMergeGroupWindow(Number(itemId));
            // The row selection follows the window
            queueMicrotask(() => updateDebuggerTab(MERGING_TAB_ID));
          },
        },
      }),
      {
        pane: true,
        id: 'refusals',
        title: 'Refused entities',
        expanded: false,
        content: [
          {
            type: 'custom',
            build: (container) => {
              container.add(
                debuggerListCMP({
                  id: 'mergeRefusals',
                  label: 'Refused entities',
                  emptyText: 'No refusals: every mesh that asked to merge did.',
                  data: () => getMergeRefusalListData(world),
                })
              );
            },
          },
        ],
      },
    ],
  });
};
