// The Merging tab's windows (docs/plans/_DONE_p373_merge-debug-and-member-editing.md D2): a merge group's
// (its kind, settings and figures, its members' highlight and the unmerged A/B (D3), its members as
// a list whose rows open their windows, Rebuild and Dissolve) and a member's (its group with a link
// to the group's window, its state, assets and part range, its pose, editable through an edit
// session (D4, `_dbg__MergingMemberPose.ts`), Remove from group). Group and member entities don't outlive their scene, so
// the windows are removed on a scene change and not saved. Default world only.
//
// A batched group's (p375 S5): its mode, its batch's figures (instances, visible ones, geometries,
// vertices, runs, compactions, per-member culling) in place of the palette and the waste; a
// batched member's state is its instance's, its part its instance and the batch's geometry. Its
// LOD (p375 Phase 2 S5): the group's LOD figures, a member's level and the fade its batch draws.
import type * as THREE from 'three/webgpu';
import { registerEntityWindowOpener } from '../../../debug/Profiler';
import { updateDebuggerTab } from '../../../debug/DebuggerGUI';
import {
  createDebugWindowGrid,
  getEntityInfoItems,
  getNoteItem,
  getReasonedButtonItem,
} from '../../../debug/_dbg__DebugWindowGrid';
import { _registerManagerDebugInfo } from '../../../debug/_dbg__ManagedEntities';
import { getECSWorld, type ECSWorld } from '../../../kernel/ecs/ECS';
import { ComponentType } from '../../../kernel/ecs/ECSCoreComponents';
import { createList } from '../../../ui/data/List';
import type { PropertyGridItem } from '../../../ui/forms/PropertyGridItems';
import type { MergeGroupData, MergeMemberData } from '../MergeTypes';
import {
  closeDraggableWindow,
  getDraggableWindowsOfKind,
  getKindWindowId,
  registerDraggableWindowKind,
  toggleDraggableWindow,
} from '../../../ui/overlays/windows/DraggableWindow';
import { isBatchedGroup } from '../MergeBatchFront';
import { rebuildMergeGroup } from '../MergeGroups';
import { isMergeMemberInEdit } from '../MergeMemberEdit';
import { getGroupMesh } from '../MergeState';
import {
  formatCount,
  formatCountOf,
  getAutoCellLabel,
  getGroupBatchState,
  getGroupVertexCount,
  getMaterialLabel,
  getMergeBatchFigures,
  getMergeEntityName,
  isGroupDrawn,
  isMergeMemberBuilt,
  MERGING_TAB_ID,
} from './_dbg__MergingInfo';
import { isMergeGroupHighlighted, setMergeGroupHighlighted } from './_dbg__MergingOverlay';
import {
  getUnmergedViewRefusal,
  isMergeGroupUnmergedView,
  setMergeGroupUnmergedView,
} from './_dbg__MergingUnmerged';
import { dissolveMergeGroupRecorded, removeMergeMemberRecorded } from './_dbg__MergingUndo';
import { getMergeMemberPoseItems } from './_dbg__MergingMemberPose';

const GROUP_WIN_KIND = 'mergeGroup';
const MEMBER_WIN_KIND = 'mergeMember';
/** The live rows' read rate */
const REFRESH_MS = 250;
/** Rows the member list shows at most */
const MAX_MEMBER_ROWS = 200;

const getGroup = (groupEntityId: number, world: ECSWorld) =>
  world.getComponent(groupEntityId, ComponentType.MERGE_GROUP);

const live = (label: string, get: () => string, hint?: string): PropertyGridItem => ({
  label,
  get,
  readonly: true,
  interval: REFRESH_MS,
  ...(hint ? { hint } : {}),
});

/** A window's grid refreshed every REFRESH_MS while it exists: its buttons' disabled states and
 * reasons, its notes and functions, its edit fields (its monitors read on their own interval).
 * `onRemove` runs at its removal too. */
const createRefreshedGrid = (items: PropertyGridItem[], onRemove?: () => void) => {
  let interval = 0;
  const { cmp, grid } = createDebugWindowGrid({
    items,
    onRemove: () => {
      window.clearInterval(interval);
      onRemove?.();
    },
  });
  interval = window.setInterval(() => grid.refresh(), REFRESH_MS);
  return cmp;
};

// --- THE GROUP WINDOW ---

/** A group's state: built and drawn, pending, building, or why it draws nothing. */
export const getGroupStateText = (groupEntityId: number, world: ECSWorld) => {
  const group = getGroup(groupEntityId, world);
  if (!group) return 'dissolved';
  if (group._isBuilding) return 'building in the assets worker';
  if (group._isPending) return 'pending: builds in the next frame';
  if (!getGroupMesh(groupEntityId, world)) return 'not built yet';
  if (group.members.length === 0) return 'no members: its mesh is out of the scene';
  if (isMergeGroupUnmergedView(groupEntityId, world)) {
    return 'shown unmerged: its members are drawn on their own';
  }
  return isGroupDrawn(groupEntityId, world) ? 'built' : 'built, not drawn';
};

/** A shadow flag's text: the group mesh's, else its setting's, else its first member's. */
const getShadowText = (
  groupEntityId: number,
  world: ECSWorld,
  key: 'castShadow' | 'receiveShadow'
) => {
  const mesh = getGroupMesh(groupEntityId, world);
  if (mesh) return mesh[key] ? 'yes' : 'no';
  const setting = getGroup(groupEntityId, world)?.settings[key];
  return setting === undefined ? "its first member's" : setting ? 'yes' : 'no';
};

type MemberRow = { entityId: number; name: string; state: string };

/** A batched member's state, once it has its instance: shown unmerged, its instance hidden (and
 * why), or merged. */
const getBatchedMemberStateText = (entityId: number, member: MergeMemberData, world: ECSWorld) => {
  if (isMergeGroupUnmergedView(member.groupEntityId, world)) {
    return 'merged, drawn on its own (shown unmerged)';
  }
  if (world.isDisabled(entityId)) return 'disabled: its instance hidden';
  if (world.hasComponent(entityId, ComponentType.TAG_DRAW_HELD)) return 'held: its instance hidden';
  if (world.hasComponent(entityId, ComponentType.TAG_FRUSTUM_CULLED)) {
    return 'frustum-culled: its instance hidden';
  }
  // A cull fading out is drawn until its fade ends
  if (
    world.hasComponent(entityId, ComponentType.TAG_LOD_CULLED) &&
    !world.hasComponent(entityId, ComponentType.TAG_LOD_TRANSITIONING)
  ) {
    return 'LOD culled: its instance hidden';
  }
  return 'merged';
};

/** A batched member's level and the fade its batch draws, eg. "level 1 of 3, fading from level 0
 * (instance #12), 40%". */
const getBatchedMemberLodText = (entityId: number, member: MergeMemberData, world: ECSWorld) => {
  const lod = world.getComponent(entityId, ComponentType.LOD)!;
  const level = `level ${Math.max(lod.applied, 0)} of ${lod._levels.length}`;
  const percent = `${Math.round((lod._fade ?? 0) * 100)}%`;
  const isFading = world.hasComponent(entityId, ComponentType.TAG_LOD_TRANSITIONING);
  switch (member._lodFade) {
    case 'LEVEL':
      return `${level}, fading from level ${lod._fadeFrom ?? '?'} (instance #${member._fadeInstanceId}), ${percent}`;
    case 'OUT':
      return `${level}, fading out to LOD culled, ${percent}`;
    case 'IN':
      return `${level}, fading in from LOD culled, ${percent}`;
  }
  if (isFading) return `${level}, a fade it came with: drawn whole until it ends`;
  if (world.hasComponent(entityId, ComponentType.TAG_LOD_CULLED)) return `${level}, LOD culled`;
  return lod.applied < 0 ? `${level} (not selected yet)` : level;
};

/** A member's LOD: none, a batched member's level and fade, or the level its own mesh shows (a
 * baked group draws the geometry a member joined with). */
export const getMemberLodText = (entityId: number, world: ECSWorld) => {
  const lod = world.getComponent(entityId, ComponentType.LOD);
  if (!lod || lod._levels.length === 0) return 'none';
  const member = world.getComponent(entityId, ComponentType.MERGE_MEMBER);
  if (member && member.instanceId >= 0) return getBatchedMemberLodText(entityId, member, world);
  const own = `level ${Math.max(lod.applied, 0)} of ${lod._levels.length} on its own mesh`;
  return member && member.partIndex !== -1
    ? `${own} (not drawn: its group draws the geometry it joined with)`
    : own;
};

/** A member's state in a few words. */
export const getMemberStateText = (entityId: number, world: ECSWorld) => {
  const member = world.getComponent(entityId, ComponentType.MERGE_MEMBER);
  if (!world.isAlive(entityId)) return 'deleted';
  if (!member) return 'not in a merge group';
  if (!isMergeMemberBuilt(member)) return "waiting for its group's build";
  if (member.instanceId >= 0) return getBatchedMemberStateText(entityId, member, world);
  if (member._editPose) return 'being moved: drawn on its own until the move ends';
  if (member._isCollapsed) return 'disabled: its range collapsed';
  if (isMergeGroupUnmergedView(member.groupEntityId, world)) {
    return 'merged, drawn on its own (shown unmerged)';
  }
  return 'merged';
};

const getMemberRows = (groupEntityId: number, world: ECSWorld): MemberRow[] => {
  const members = getGroup(groupEntityId, world)?.members ?? [];
  const rows = members.slice(0, MAX_MEMBER_ROWS).map((entityId) => ({
    entityId,
    name: getMergeEntityName(entityId, world),
    state: getMemberStateText(entityId, world),
  }));
  if (members.length > MAX_MEMBER_ROWS) {
    rows.push({ entityId: -1, name: `…and ${members.length - MAX_MEMBER_ROWS} more`, state: '' });
  }
  return rows;
};

/** The group's members as a list (a row opens the member's window), read every REFRESH_MS. */
const getMemberListItem = (groupEntityId: number, world: ECSWorld): PropertyGridItem => ({
  type: 'custom',
  build: (container) => {
    const list = createList<MemberRow>({
      items: () => getMemberRows(groupEntityId, world),
      getKey: (row) => String(row.entityId),
      title: (row) => row.name,
      subTitle: (row) => (row.entityId >= 0 ? `[${row.entityId}]` : null),
      suffix: (row) => (row.state === 'merged' ? null : row.state),
      isPlaceholder: (row) => row.entityId < 0,
      disabled: (row) => row.entityId < 0,
      onActivate: (row) => {
        if (row.entityId >= 0) toggleMergeMemberWindow(row.entityId);
      },
      heading: 'Members',
      headingLevel: 4,
      empty: 'No members.',
      interval: REFRESH_MS,
    });
    container.add(list.cmp);
  },
});

/** A group's mode in a few words. */
const getModeText = (group: MergeGroupData) =>
  isBatchedGroup(group)
    ? 'BATCHED: instances of one BatchedMesh'
    : 'BAKED: one merged geometry, culled whole';

/** A group's members, eg. "3 (3 merged)"; a batched group's with its visible ones. */
const getMembersText = (group: MergeGroupData, world: ECSWorld) => {
  const batch = getMergeBatchFigures(group, world);
  if (batch) {
    return `${formatCount(group.members.length)} (${formatCount(batch.instances)} batched, ${formatCount(batch.visible)} visible)`;
  }
  const built = group.members.filter((id) => group.partIndex.has(id)).length;
  return `${formatCount(group.members.length)} (${formatCount(built)} merged)`;
};

/** A batched group's batch rows (its batch's figures; "not built yet" before its first build). */
const getBatchItems = (group: MergeGroupData, world: ECSWorld): PropertyGridItem[] => {
  const figures = () => getMergeBatchFigures(group, world);
  const NOT_BUILT = 'not built yet';
  return [
    live(
      'Batch',
      () => {
        const f = figures();
        if (!f) return NOT_BUILT;
        const levels = f.levelGeometries ? ` (${formatCount(f.levelGeometries)} LOD levels)` : '';
        return `${formatCountOf(f.geometries, 'geometry', 'geometries')}${levels}, ${formatCount(f.vertices)} of ${formatCount(f.maxVertices)} vertices, ${formatCount(f.batchInstances)} of ${formatCount(f.maxInstances)} instances`;
      },
      "Its geometries are its members' and their LOD levels', each once; its instances are its members' and their level fades' outgoing ones."
    ),
    live(
      'LOD',
      () => {
        const f = figures();
        if (!f) return NOT_BUILT;
        if (!f.lodMembers) return 'no member has a LOD';
        return `${formatCountOf(f.lodMembers, 'member')} with a LOD: ${formatCountOf(f.levelFades, 'level fade')}, ${formatCountOf(f.cullFades, 'cull fade')}, ${formatCount(f.lodCulled)} LOD culled`;
      },
      "A level fade draws the outgoing level as a second instance until it ends; a cull fade dithers the member's own instance."
    ),
    live(
      'Draw runs',
      () => {
        const f = figures();
        if (!f) return NOT_BUILT;
        return `${formatCount(f.runs)} (${formatCount(f.geometriesInUse)} geometries in use), ${formatCountOf(f.compactions, 'compaction')}`;
      },
      "A run is a geometry's instances in a row: one draw on WebGPU. Past twice the geometries in use, the batch compacts its ids."
    ),
    live('Per-member culling', () => {
      const f = figures();
      if (!f) return group.settings.perMemberCulling === false ? 'no' : 'yes';
      return f.perMemberCulling ? 'yes' : 'no';
    }),
  ];
};

/** A baked group's palette and waste rows. */
const getBakedItems = (group: MergeGroupData): PropertyGridItem[] => [
  live(
    'Palette',
    () => group.settings.palette ?? 'none',
    'A palette group takes meshes of any of its materials, drawn by its merge material.'
  ),
];

/** A group window's content (its kind's `content`, by the group's entity in `data`). */
export const createGroupWindowContent = (data?: Record<string, unknown>) => {
  const groupEntityId = Number(data?.groupEntityId);
  const world = getECSWorld();
  const has = () => Boolean(getGroup(groupEntityId, world));
  const group = getGroup(groupEntityId, world);
  if (!group) {
    return createDebugWindowGrid({ items: [getNoteItem('The merge group no longer exists.')] }).cmp;
  }
  const cell = getAutoCellLabel(group.id);
  const isBatched = isBatchedGroup(group);
  const items: PropertyGridItem[] = [
    getNoteItem(() => (has() ? '' : 'The merge group was dissolved.')),
    live('State', () => getGroupStateText(groupEntityId, world)),
    live('Kind', () =>
      group._isAuto ? `AUTO${cell ? `, cell ${cell}` : ''}` : 'explicit (named)'
    ),
    live('Mode', () => getModeText(group)),
    live('Material', () => getMaterialLabel(group._material)),
    ...(isBatched ? [] : getBakedItems(group)),
    live('Cast shadow', () => getShadowText(groupEntityId, world, 'castShadow')),
    live('Receive shadow', () => getShadowText(groupEntityId, world, 'receiveShadow')),
    live('Persistent', () => (group.settings.persistent ? 'yes' : 'no')),
    live('Members', () => getMembersText(group, world)),
    live(
      'Vertices',
      () => formatCount(getGroupVertexCount(groupEntityId, group, world)),
      isBatched ? 'What its instances draw: the batch holds each geometry once.' : undefined
    ),
    ...(isBatched
      ? getBatchItems(group, world)
      : [
          live(
            'Wasted vertices',
            () => formatCount(group.wasted),
            'Left by removed members: a rebuild compacts.'
          ),
        ]),
    live('Builds', () => formatCount(group.rebuilds)),
    {
      label: 'Highlight members',
      get: () => isMergeGroupHighlighted(group.id),
      set: (value) => {
        setMergeGroupHighlighted(group.id, Boolean(value), world);
        // The tab's row toggle follows
        updateDebuggerTab(MERGING_TAB_ID);
      },
      hint: "Outlines its members in the group's colour (in view only).",
    },
    {
      label: 'Show unmerged',
      get: () => isMergeGroupUnmergedView(groupEntityId, world),
      set: (value) => {
        setMergeGroupUnmergedView(groupEntityId, Boolean(value), world);
        updateDebuggerTab(MERGING_TAB_ID);
      },
      disabled: () => getUnmergedViewRefusal(groupEntityId, world) !== null,
      hint: 'Hides the merged mesh and draws each member on its own: an A/B of the image and the draws. Until the scene changes.',
    },
    getReasonedButtonItem({
      title: 'Rebuild',
      getDisabledReason: () => {
        if (!has()) return 'The group was dissolved.';
        return group.members.length ? null : 'The group has no members.';
      },
      onClick: () => rebuildMergeGroup(group.id, world),
    }),
    getReasonedButtonItem({
      title: 'Dissolve',
      getDisabledReason: () => (has() ? null : 'The group was dissolved.'),
      onClick: () => {
        dissolveMergeGroupRecorded(groupEntityId, world);
        closeDraggableWindow(getKindWindowId(GROUP_WIN_KIND, groupEntityId));
        updateDebuggerTab(MERGING_TAB_ID);
      },
    }),
    getNoteItem('Dissolving draws each member on its own; undo merges them again.'),
    getMemberListItem(groupEntityId, world),
    ...getEntityInfoItems({
      entityId: groupEntityId,
      appId: world.getComponent(groupEntityId, ComponentType.APP_ID)?.id,
      type: 'Merge group',
      name: group.id,
    }),
  ];
  // The buttons' reasons and the note follow the group
  return createRefreshedGrid(items);
};

// --- THE MEMBER WINDOW ---

/** A member's own mesh, if it still has one. */
const getMemberMesh = (entityId: number, world: ECSWorld) =>
  world.getComponent(entityId, ComponentType.OBJECT3D)?.value as THREE.Mesh | undefined;

/** A batched member's instance, eg. "instance #12, geometry #3" (the batch's ids). */
const getInstanceText = (member: MergeMemberData, world: ECSWorld) => {
  const group = getGroup(member.groupEntityId, world);
  const geometryId = group ? getGroupBatchState(group)?.geometryAt[member.instanceId] : undefined;
  return `instance #${member.instanceId}${geometryId === undefined ? '' : `, geometry #${geometryId}`}`;
};

/** A member's range in its group's merged geometry, eg. "#3: vertices 72-95, indices 108-143"; a
 * batched member's instance. */
export const getMemberPartText = (entityId: number, world: ECSWorld) => {
  const member = world.getComponent(entityId, ComponentType.MERGE_MEMBER);
  if (member && member.instanceId >= 0) return getInstanceText(member, world);
  if (!member || member.partIndex === -1) return 'none yet';
  const range = getGroupMesh(member.groupEntityId, world)?.geometry.userData.mergeParts[
    member.partIndex
  ];
  if (!range) return `#${member.partIndex}`;
  const last = (start: number, count: number) => start + Math.max(count, 1) - 1;
  return `#${member.partIndex}: vertices ${range.vertexStart}-${last(range.vertexStart, range.vertexCount)}, indices ${range.indexStart}-${last(range.indexStart, range.indexCount)}`;
};

/** A member window's content (its kind's `content`, by the member's entity in `data`). */
export const createMemberWindowContent = (data?: Record<string, unknown>) => {
  const entityId = Number(data?.entityId);
  const world = getECSWorld();
  const member = () => world.getComponent(entityId, ComponentType.MERGE_MEMBER);
  const mesh = () => getMemberMesh(entityId, world);
  const pose = getMergeMemberPoseItems(entityId, world);
  const joined = getGroup(member()?.groupEntityId ?? -1, world);
  // A LOD row where one can matter: a batched group's member, or a member with a LOD
  const hasLodRow =
    world.hasComponent(entityId, ComponentType.LOD) || Boolean(joined && isBatchedGroup(joined));
  const items: PropertyGridItem[] = [
    getNoteItem(() => {
      if (!world.isAlive(entityId)) return 'The entity no longer exists.';
      return member() ? '' : 'It isn’t in a merge group any more: it’s drawn on its own.';
    }),
    live('Merged into', () => member()?.groupId ?? 'none'),
    {
      type: 'button',
      title: 'Open the group’s window',
      disabled: () => !member(),
      onClick: () => {
        const groupEntityId = member()?.groupEntityId;
        if (groupEntityId !== undefined) toggleMergeGroupWindow(groupEntityId);
      },
    },
    live('State', () => getMemberStateText(entityId, world)),
    live('Geometry', () => String(mesh()?.geometry.userData.id ?? 'unregistered')),
    live('Material', () => {
      const material = mesh()?.material;
      return Array.isArray(material) ? 'a material array' : getMaterialLabel(material ?? null);
    }),
    live('Vertices', () => formatCount(mesh()?.geometry.getAttribute('position')?.count ?? 0)),
    live('Part', () => getMemberPartText(entityId, world)),
    ...(hasLodRow
      ? [
          live(
            'LOD',
            () => getMemberLodText(entityId, world),
            "A level fade draws the outgoing level as a second instance of the batch; the LOD tab's window has the switch distances."
          ),
        ]
      : []),
    live('Palette index', () => {
      const index = member()?._paletteIndex;
      return index === undefined ? 'none (a group of one material)' : String(index);
    }),
    ...pose.items,
    getNoteItem(() => {
      const groupEntityId = member()?.groupEntityId;
      const group = groupEntityId === undefined ? undefined : getGroup(groupEntityId, world);
      return group && isBatchedGroup(group)
        ? 'Its instance follows it as it moves (no session, no rebuild); undo puts it back.'
        : 'Moving it draws it on its own until the change ends, then writes its part of the group’s mesh in place (no rebuild); undo puts it back.';
    }),
    getReasonedButtonItem({
      title: 'Remove from group',
      getDisabledReason: () => {
        if (!member()) return 'It isn’t in a merge group.';
        return isMergeMemberInEdit(entityId, world)
          ? 'It’s being moved: finish the move first.'
          : null;
      },
      onClick: () => {
        removeMergeMemberRecorded(entityId, world);
        updateDebuggerTab(MERGING_TAB_ID);
      },
    }),
    ...getEntityInfoItems({
      entityId,
      appId: world.getComponent(entityId, ComponentType.APP_ID)?.id,
      type: 'Mesh (merge group member)',
      name: world.getComponent(entityId, ComponentType.DEBUG_DATA)?.name,
    }),
  ];
  // Closed mid-gesture: the move ends there
  return createRefreshedGrid(items, pose.onRemove);
};

registerDraggableWindowKind(GROUP_WIN_KIND, { content: createGroupWindowContent });
registerDraggableWindowKind(MEMBER_WIN_KIND, { content: createMemberWindowContent });

// --- OPENING ---

/** Opens a merge group's window, brings it to the front, or closes it when it's on top. */
export const toggleMergeGroupWindow = (groupEntityId: number) => {
  const group = getGroup(groupEntityId, getECSWorld());
  toggleDraggableWindow({
    id: getKindWindowId(GROUP_WIN_KIND, groupEntityId),
    kind: GROUP_WIN_KIND,
    title: `Merge group ${group?.id ?? groupEntityId}`,
    icon: 'merge',
    data: { groupEntityId },
    isDebugWindow: true,
    removeOnSceneChange: true,
    position: { x: 140, y: 80 },
    size: { w: 400, h: 640 },
  });
};

/** Opens a merge member's window, brings it to the front, or closes it when it's on top. */
export const toggleMergeMemberWindow = (entityId: number) => {
  toggleDraggableWindow({
    id: getKindWindowId(MEMBER_WIN_KIND, entityId),
    kind: MEMBER_WIN_KIND,
    title: `Merge member ${getMergeEntityName(entityId, getECSWorld())}`,
    icon: 'merge',
    data: { entityId },
    isDebugWindow: true,
    removeOnSceneChange: true,
    position: { x: 180, y: 110 },
    size: { w: 400, h: 600 },
  });
};

/** The group entity ids whose window is open, as the tab's list item ids. */
export const getOpenMergeGroupWindowIds = () =>
  getDraggableWindowsOfKind(GROUP_WIN_KIND).map((win) => String(win.data?.groupEntityId));

/**
 * Links the windows from the other debug tools (the tab's creation, the boot's debug step): the
 * group entity's manager info (anything that shows a managed entity names it and links to the
 * Merging tab), and the profiler's heaviest objects opening a group mesh's window, or a member's
 * (drawn on its own while it waits) after the physics and character windows.
 */
export const _registerMergingWindowLinks = () => {
  _registerManagerDebugInfo('MERGE', {
    label: 'Merge group',
    icon: 'merge',
    tabId: MERGING_TAB_ID,
  });
  registerEntityWindowOpener({
    id: 'mergeGroup',
    label: 'Merge group',
    canOpen: (world, entityId) =>
      world === getECSWorld() && world.hasComponent(entityId, ComponentType.MERGE_GROUP),
    toggle: (_world, entityId) => toggleMergeGroupWindow(entityId),
  });
  registerEntityWindowOpener({
    id: 'mergeMember',
    label: 'Merge group member',
    priority: -1,
    canOpen: (world, entityId) =>
      world === getECSWorld() && world.hasComponent(entityId, ComponentType.MERGE_MEMBER),
    toggle: (_world, entityId) => toggleMergeMemberWindow(entityId),
  });
};
