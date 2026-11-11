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
import { getMergeDebugStats } from '../MergeState';
import {
  createMergeRateMeter,
  formatCount,
  getAutoCellLabel,
  getGroupVertexCount,
  getMaterialLabel,
  getMergeEntityName,
  getMergeSummary,
  getStandingRefusals,
  MERGING_TAB_ID,
} from './_dbg__MergingInfo';
import {
  _registerMergingWindowLinks,
  getOpenMergeGroupWindowIds,
  toggleMergeGroupWindow,
} from './_dbg__MergingWindows';

// The Merging tab (docs/plans/p373_merge-debug-and-member-editing.md D1): the default world's
// merge groups at a glance (the groups, members and vertices, the draws per pass merged against
// unmerged, the waste, the builds and in-place updates of the last second, the last build's time),
// a row per group opening its window (_dbg__MergingWindows.ts), and the entities whose `merge` was
// refused with the reason. Nothing is
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

/** "now merged · unmerged", eg. "28 merged · 409 unmerged". */
const formatDraws = (now: number, unmerged: number) =>
  `${formatCount(now)} merged · ${formatCount(unmerged)} unmerged`;

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
  return {
    groups: `${formatCount(s.groups)} (${formatCount(s.drawnGroups)} drawn, ${formatCount(s.pendingGroups)} pending)`,
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

/** A row per group of the world, in creation order: its id, `AUTO` cell, material, members and
 * vertices (the first MAX_GROUP_ROWS). */
export const getMergeGroupListData = (world: ECSWorld): DebuggerListItem[] => {
  const items: DebuggerListItem[] = [];
  let more = 0;
  for (const [groupEntityId, group] of world.getStorage(ComponentType.MERGE_GROUP)) {
    if (items.length >= MAX_GROUP_ROWS) {
      more++;
      continue;
    }
    const cell = getAutoCellLabel(group.id);
    const n = group.members.length;
    const vertices = formatCount(getGroupVertexCount(groupEntityId, group, world));
    const state = group._isPending ? ', pending' : '';
    items.push({
      itemId: String(groupEntityId),
      title: group.id,
      subTitle: `[${groupEntityId}]`,
      ...(group._isAuto ? { badge: 'AUTO' } : {}),
      description: `${getMaterialLabel(group._material)}${cell ? ` · cell ${cell}` : ''}`,
      suffix: `${formatCount(n)} ${n === 1 ? 'member' : 'members'}, ${vertices} v${state}`,
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
            'Draws per pass before culling: what the pass submits with everything in view. A merged group is culled whole.'
          ),
          monitor('builds', 'Builds, last second'),
          monitor('updates', 'In-place updates, last second'),
          monitor('lastBuild', 'Last build'),
          monitor('refused', 'Refused entities'),
        ],
      },
      debuggerListCMP({
        id: 'mergeGroups',
        heading: 'Merge groups',
        emptyText: 'No merge groups in this world.',
        data: () => getMergeGroupListData(world),
        selectedItemId: getOpenMergeGroupWindowIds,
        perItemConfig: {
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
