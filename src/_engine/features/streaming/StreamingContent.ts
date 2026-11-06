// Code-registered cell content (p353 §3.1): per scene and cell, the units the state machine
// (StreamingCells.ts) loads and unloads. A scene's registrations go when the scene is left, so
// its code registers them again on every load. The public register / unregister are in
// Streaming.ts (they need the feature's install check).
import type { ECSWorld } from '../../kernel/ecs/ECS';
import { CELL_AXIS_OFFSET, isCellInRange, packCellKey, unpackCellKey } from '../../utils/CellKey';

/**
 * What a cell content's `load` and `unload` are handed: the cell, and whether the load is still
 * wanted.
 */
export type StreamingCellContext = {
  /** The scene the cell is in. */
  readonly sceneId: string;
  /** The cell's key ({@link getStreamingCellKey}). */
  readonly cellKey: number;
  /** The cell's index along x: `floor(x / cellSize)`. */
  readonly cx: number;
  /** The cell's index along z: `floor(z / cellSize)`. */
  readonly cz: number;
  /** The cell side in metres; the cell spans `[cx × cellSize, (cx + 1) × cellSize)` on x. */
  readonly cellSize: number;
  /** The world the content creates its entities in (the default world). */
  readonly world: ECSWorld;
  /** False once this load was cancelled (the cell is no longer wanted) or its scene was left:
   * an async `load` checks it after every `await` and stops creating. What it returns anyway is
   * unloaded at once. */
  isCurrent(): boolean;
};

/**
 * A unit of a scene's cell's content (`registerStreamingCellContent`): `load` creates it
 * when the cell loads and returns the ids of the entities it created, `unload` takes it down when
 * the cell unloads. Without `unload`, the entities `load` returned are deleted.
 */
export type StreamingCellContent = {
  /** The scene whose cell it's in. */
  readonly sceneId: string;
  /** The cell ({@link getStreamingCellKey}, {@link getStreamingCellKeyAt}). */
  readonly cellKey: number;
  /** Creates the content, returning the entities it created (or a promise of them). A cell's
   * units load in registration order, several a frame under `AppConfig.streaming`'s budget, so
   * a unit is the slice a frame can't split: a cell of thousands of entities is many units. */
  readonly load: (ctx: StreamingCellContext) => readonly number[] | Promise<readonly number[]>;
  /** Takes the content down: what `load` created. Default: deletes `entityIds`. */
  readonly unload?: (entityIds: readonly number[], ctx: StreamingCellContext) => void;
};

/**
 * A streaming cell's key from its indices: the key `registerStreamingCellContent` takes.
 * A cell spans `[cx × cellSize, (cx + 1) × cellSize)` on x, and the same on z. Throws outside
 * ±65,536 cells.
 * @example
 * ```ts
 * import { getStreamingCellKey, registerStreamingCellContent } from 'aekasha/streaming';
 *
 * const cellKey = getStreamingCellKey(2, -1);
 * registerStreamingCellContent({ sceneId: 'myWorld', cellKey, load: (ctx) => createRocks(ctx) });
 * ```
 */
export const getStreamingCellKey = (cx: number, cz: number) => {
  if (!Number.isInteger(cx) || !Number.isInteger(cz) || !isCellInRange(cx, 0, cz)) {
    throw new Error(
      `getStreamingCellKey: (${cx}, ${cz}) isn't a cell: whole numbers within ±${CELL_AXIS_OFFSET}.`
    );
  }
  return packCellKey(cx, 0, cz);
};

/**
 * The key of the streaming cell holding the point (`x`, `z`) for a scene's `cellSize`.
 */
export const getStreamingCellKeyAt = (x: number, z: number, cellSize: number) =>
  getStreamingCellKey(Math.floor(x / cellSize), Math.floor(z / cellSize));

const _coords = { x: 0, y: 0, z: 0 };

/**
 * Whether `cellKey` is a streaming cell's key (a cell key with y 0).
 * @internal
 */
export const isStreamingCellKey = (cellKey: number) =>
  Number.isSafeInteger(cellKey) && cellKey >= 0 && unpackCellKey(cellKey, _coords).y === 0;

const contentByScene = new Map<string, Map<number, StreamingCellContent[]>>();
const NO_CONTENT: readonly StreamingCellContent[] = [];

/**
 * Adds a unit of content to its scene's cell (no checks: `registerStreamingCellContent`'s).
 * @internal
 */
export const addStreamingCellContent = (content: StreamingCellContent) => {
  let cells = contentByScene.get(content.sceneId);
  if (!cells) {
    cells = new Map();
    contentByScene.set(content.sceneId, cells);
  }
  let units = cells.get(content.cellKey);
  if (!units) {
    units = [];
    cells.set(content.cellKey, units);
  }
  if (!units.includes(content)) units.push(content);
};

/**
 * Removes a unit of content from its scene's cell. Returns whether it was there.
 * @internal
 */
export const removeStreamingCellContent = (content: StreamingCellContent) => {
  const units = contentByScene.get(content.sceneId)?.get(content.cellKey);
  const index = units ? units.indexOf(content) : -1;
  if (index === -1) return false;
  units?.splice(index, 1);
  return true;
};

/**
 * A scene's cell's content units, in registration order (shared: copy before keeping).
 * @internal
 */
export const getStreamingCellContent = (
  sceneId: string,
  cellKey: number
): readonly StreamingCellContent[] => contentByScene.get(sceneId)?.get(cellKey) ?? NO_CONTENT;

/**
 * Drops every content registration of a scene (its exit).
 * @internal
 */
export const clearSceneStreamingContent = (sceneId: string) => contentByScene.delete(sceneId);
