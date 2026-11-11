// The Merging tab's windows (docs/plans/p373_merge-debug-and-member-editing.md D2): a merge group's
// (its kind, settings and figures, its members' highlight (D3), its members as a list whose rows
// open their windows, Rebuild and Dissolve) and a member's (its group with a link to the group's window, its state, assets and
// part range, its pose, Remove from group). Group and member entities don't outlive their scene, so
// the windows are removed on a scene change and not saved. Default world only.
import * as THREE from 'three/webgpu';
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
import {
  closeDraggableWindow,
  getDraggableWindowsOfKind,
  getKindWindowId,
  registerDraggableWindowKind,
  toggleDraggableWindow,
} from '../../../ui/overlays/windows/DraggableWindow';
import { rebuildMergeGroup } from '../MergeGroups';
import { getGroupMesh } from '../MergeState';
import {
  formatCount,
  getAutoCellLabel,
  getGroupVertexCount,
  getMaterialLabel,
  getMergeEntityName,
  isGroupDrawn,
  MERGING_TAB_ID,
} from './_dbg__MergingInfo';
import { isMergeGroupHighlighted, setMergeGroupHighlighted } from './_dbg__MergingOverlay';
import { dissolveMergeGroupRecorded, removeMergeMemberRecorded } from './_dbg__MergingUndo';

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
 * reasons, its notes and functions (its monitors read on their own interval). */
const createRefreshedGrid = (items: PropertyGridItem[]) => {
  let interval = 0;
  const { cmp, grid } = createDebugWindowGrid({
    items,
    onRemove: () => window.clearInterval(interval),
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

/** A member's state in a few words. */
export const getMemberStateText = (entityId: number, world: ECSWorld) => {
  const member = world.getComponent(entityId, ComponentType.MERGE_MEMBER);
  if (!world.isAlive(entityId)) return 'deleted';
  if (!member) return 'not in a merge group';
  if (member.partIndex === -1) return "waiting for its group's build";
  if (member._isCollapsed) return 'disabled: its range collapsed';
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
  const items: PropertyGridItem[] = [
    getNoteItem(() => (has() ? '' : 'The merge group was dissolved.')),
    live('State', () => getGroupStateText(groupEntityId, world)),
    live('Kind', () =>
      group._isAuto ? `AUTO${cell ? `, cell ${cell}` : ''}` : 'explicit (named)'
    ),
    live('Material', () => getMaterialLabel(group._material)),
    live('Cast shadow', () => getShadowText(groupEntityId, world, 'castShadow')),
    live('Receive shadow', () => getShadowText(groupEntityId, world, 'receiveShadow')),
    live('Persistent', () => (group.settings.persistent ? 'yes' : 'no')),
    live('Members', () => {
      const built = group.members.filter((id) => group.partIndex.has(id)).length;
      return `${formatCount(group.members.length)} (${formatCount(built)} merged)`;
    }),
    live('Vertices', () => formatCount(getGroupVertexCount(groupEntityId, group, world))),
    live(
      'Wasted vertices',
      () => formatCount(group.wasted),
      'Left by removed members: a rebuild compacts.'
    ),
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

const scratchEuler = new THREE.Euler();

/** A member's own mesh, if it still has one. */
const getMemberMesh = (entityId: number, world: ECSWorld) =>
  world.getComponent(entityId, ComponentType.OBJECT3D)?.value as THREE.Mesh | undefined;

/** A member's range in its group's merged geometry, eg. "#3: vertices 72-95, indices 108-143". */
export const getMemberPartText = (entityId: number, world: ECSWorld) => {
  const member = world.getComponent(entityId, ComponentType.MERGE_MEMBER);
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
  const pose = { label: '', readonly: true as const, interval: REFRESH_MS, precision: 2 };
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
    { ...pose, label: 'Position', get: () => mesh()?.position ?? { x: 0, y: 0, z: 0 } },
    {
      ...pose,
      label: 'Rotation (°)',
      get: () => {
        const object = mesh();
        if (!object) return { x: 0, y: 0, z: 0 };
        scratchEuler.setFromQuaternion(object.quaternion);
        const deg = THREE.MathUtils.RAD2DEG;
        return { x: scratchEuler.x * deg, y: scratchEuler.y * deg, z: scratchEuler.z * deg };
      },
    },
    { ...pose, label: 'Scale', get: () => mesh()?.scale ?? { x: 1, y: 1, z: 1 } },
    getNoteItem(
      'The pose is read-only: a merged member is static; move it with updateMergeMember.'
    ),
    getReasonedButtonItem({
      title: 'Remove from group',
      getDisabledReason: () => (member() ? null : 'It isn’t in a merge group.'),
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
  return createRefreshedGrid(items);
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
