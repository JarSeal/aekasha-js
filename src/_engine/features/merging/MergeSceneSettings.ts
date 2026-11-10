// A scene's merge settings (docs/plans/p372_mesh-merge-groups.md §4.2), kept when it's registered: its
// `mergeGroups` (a group's settings for when it's made on first use, `AUTO`'s defaults) and its
// JSON streaming cell size, for the two streaming warnings: an `AUTO` cell size that doesn't
// divide it, and a group whose members span two streaming cells. Only the JSON's `streaming` is
// seen: one set in code (`setSceneStreamingSettings`) isn't, as merging imports nothing of
// streaming's.
import type * as THREE from 'three/webgpu';
import type { SceneData } from '../../kernel/scene/Scene';
import { getCurrentSceneId, getLoadingSceneId } from '../../kernel/scene/Scene';
import { worldToCell } from '../../utils/CellKey';
import { lwarn } from '../../utils/Logger';
import type { SceneAutoMergeEntry, SceneMergeGroupEntry } from './MergeTypes';

/**
 * `AUTO`'s default cell size, in metres (§4.1).
 * @internal
 */
export const DEFAULT_AUTO_CELL_SIZE = 32;

/**
 * `AUTO`'s default vertex cap per group (§4.1).
 * @internal
 */
export const DEFAULT_AUTO_MAX_VERTICES = 262_144;

/**
 * A scene's merge settings, from its JSON.
 * @internal
 */
export type SceneMergeSettings = {
  /** The groups' settings by id, for when one is made on first use. */
  groups: ReadonlyMap<string, SceneMergeGroupEntry>;
  /** `AUTO`'s cell size for a mesh that doesn't give one. */
  autoCellSize: number;
  /** `AUTO`'s vertex cap for a mesh that doesn't give one. */
  autoMaxVertices: number;
  /** The JSON's streaming cell size, when the scene streams. */
  streamingCellSize: number | undefined;
};

const DEFAULT_SETTINGS: SceneMergeSettings = Object.freeze({
  groups: new Map<string, SceneMergeGroupEntry>(),
  autoCellSize: DEFAULT_AUTO_CELL_SIZE,
  autoMaxVertices: DEFAULT_AUTO_MAX_VERTICES,
  streamingCellSize: undefined,
});

const settingsByScene = new Map<string, SceneMergeSettings>();
/** The streaming warnings given, once each per scene: `<sceneId>|cell|<size>`,
 * `<sceneId>|span|<groupId>`. */
const warned = new Set<string>();

const isAutoEntry = (
  entry: SceneMergeGroupEntry | SceneAutoMergeEntry
): entry is SceneAutoMergeEntry => entry.id === 'AUTO';

/**
 * Keeps a scene's merge settings from its data: the `merging()` feature's `sceneRegistered`
 * hook.
 * @internal
 */
export const keepSceneMergeSettings = (sceneId: string, data: SceneData) => {
  const streamingCellSize = data.streaming?.cellSize;
  if (!data.mergeGroups?.length && streamingCellSize === undefined) {
    settingsByScene.delete(sceneId);
    return;
  }
  const groups = new Map<string, SceneMergeGroupEntry>();
  let auto: SceneAutoMergeEntry | undefined;
  for (const entry of data.mergeGroups ?? []) {
    if (isAutoEntry(entry)) auto = entry;
    else groups.set(entry.id, entry);
  }
  settingsByScene.set(sceneId, {
    groups,
    autoCellSize: auto?.cellSize ?? DEFAULT_AUTO_CELL_SIZE,
    autoMaxVertices: auto?.maxVertices ?? DEFAULT_AUTO_MAX_VERTICES,
    streamingCellSize,
  });
};

/** The scene whose groups are being made: the loading one, else the current one. */
const getActiveSceneId = () => getLoadingSceneId() ?? getCurrentSceneId() ?? '';

/**
 * The merge settings of the scene loading or current (the defaults for one without).
 * @internal
 */
export const getActiveSceneMergeSettings = (): SceneMergeSettings =>
  settingsByScene.get(getActiveSceneId()) ?? DEFAULT_SETTINGS;

/**
 * Warns, once per scene and size, when an `AUTO` cell size doesn't divide the active scene's
 * streaming cell size: an automatic group could then span two streaming cells.
 * @internal
 */
export const warnIfCellSizeSplitsStreaming = (settings: SceneMergeSettings, cellSize: number) => {
  const { streamingCellSize } = settings;
  if (streamingCellSize === undefined || Number.isInteger(streamingCellSize / cellSize)) return;
  const sceneId = getActiveSceneId();
  const key = `${sceneId}|cell|${cellSize}`;
  if (warned.has(key)) return;
  warned.add(key);
  lwarn(
    `merge 'AUTO' in the scene "${sceneId}": the cell size ${cellSize} doesn't divide its streaming cell size ${streamingCellSize}, so an automatic group can span two streaming cells. Use a divisor (eg. ${streamingCellSize / 2}).`
  );
};

/**
 * Warns, once per scene and group, when a build's members are in more than one of the active
 * scene's streaming cells (by their world positions).
 * @internal
 */
export const warnIfGroupSpansStreamingCells = (
  groupId: string,
  worldMatrices: readonly THREE.Matrix4[]
) => {
  const { streamingCellSize } = getActiveSceneMergeSettings();
  if (streamingCellSize === undefined || worldMatrices.length < 2) return;
  const sceneId = getActiveSceneId();
  const key = `${sceneId}|span|${groupId}`;
  if (warned.has(key)) return;
  const invCellSize = 1 / streamingCellSize;
  const cellOf = (matrix: THREE.Matrix4) =>
    `${worldToCell(matrix.elements[12], invCellSize)},${worldToCell(matrix.elements[14], invCellSize)}`;
  const first = cellOf(worldMatrices[0]);
  for (let i = 1; i < worldMatrices.length; i++) {
    const cell = cellOf(worldMatrices[i]);
    if (cell === first) continue;
    warned.add(key);
    lwarn(
      `The merge group "${groupId}" in the scene "${sceneId}" has members in the streaming cells ${first} and ${cell}: a group doesn't load or unload with a cell (a member that goes collapses in place). Keep a group inside one streaming cell.`
    );
    return;
  }
};
