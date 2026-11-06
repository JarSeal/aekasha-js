// Code-registered cell content (p353 §3.1): per scene and cell, the units the state machine
// (StreamingCells.ts) loads and unloads. A scene's registrations go when the scene is left, so
// its code registers them again on every load.
import type { ECSWorld } from '../../kernel/ecs/ECS';

/**
 * What a cell content's `load` and `unload` are handed: the cell, and whether the load is still
 * wanted.
 */
export type StreamingCellContext = {
  /** The scene the cell is in. */
  readonly sceneId: string;
  /** The cell's key (`getStreamingCellKey`). */
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
 * A unit of a cell's content: `load` creates it and returns the ids of the entities it created,
 * `unload` takes it down again. Without `unload`, the entities `load` returned are deleted.
 */
export type StreamingCellContent = {
  /** Creates the content, returning the entities it created (or a promise of them). */
  load: (ctx: StreamingCellContext) => readonly number[] | Promise<readonly number[]>;
  /** Takes the content down: what `load` created. Default: deletes `entityIds`. */
  unload?: (entityIds: readonly number[], ctx: StreamingCellContext) => void;
};

const contentByScene = new Map<string, Map<number, StreamingCellContent[]>>();
const NO_CONTENT: readonly StreamingCellContent[] = [];

/**
 * Adds a unit of content to a scene's cell. Returns the remover (a cell already loading or loaded
 * keeps what it loaded until it unloads).
 * @internal
 */
export const addStreamingCellContent = (
  sceneId: string,
  cellKey: number,
  content: StreamingCellContent
) => {
  let cells = contentByScene.get(sceneId);
  if (!cells) {
    cells = new Map();
    contentByScene.set(sceneId, cells);
  }
  let units = cells.get(cellKey);
  if (!units) {
    units = [];
    cells.set(cellKey, units);
  }
  units.push(content);
  return () => {
    const current = contentByScene.get(sceneId)?.get(cellKey);
    const index = current ? current.indexOf(content) : -1;
    if (index !== -1) current?.splice(index, 1);
  };
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
