// The streaming machine's hand-over of the bodies that moved (p353 Phase 4 D1): when a cell's
// layer starts unloading, each body it holds that is inside another loaded cell goes to that
// cell's layer of the same range (Phase 5 D11), which deletes it when it unloads itself
// (StreamingBodies.ts' `rebalance` does the same on every decision, with these helpers). The
// runtime's bodies (StreamingBodies.ts, loaded on demand) run it as their `handOver`, and say
// which entities are bodies and where they are; without them nothing moves. A module of its own so
// the machine's tests can hand it to their stand-in.
import { isCellInRange, packCellKey, worldToCell } from '../../utils/CellKey';
import type { StreamingRuntime } from './StreamingCells';
import { type StreamingLayer, isLayerHolding } from './StreamingLayers';

const _at = { x: 0, z: 0 };

/**
 * The layer a body of `layer`'s has moved into: the same range's layer of the cell it's in, when
 * that has content to keep it with (`LOADING`, `PRIMING` or `LOADED`); null when it's still in
 * `layer`'s cell, isn't a body that moves, or is somewhere nothing is loaded (it stays).
 * @internal
 */
export const findAdopter = (
  rt: StreamingRuntime,
  layer: StreamingLayer,
  entityId: number
): StreamingLayer | null => {
  if (!rt.bodies?.locateMover(rt.world, entityId, _at)) return null;
  const { cell } = layer;
  const { invCellSize } = rt.settings;
  const cx = worldToCell(_at.x, invCellSize);
  const cz = worldToCell(_at.z, invCellSize);
  if ((cx === cell.cx && cz === cell.cz) || !isCellInRange(cx, 0, cz)) return null;
  const targetCell = rt.cells.get(packCellKey(cx, 0, cz));
  if (!targetCell || targetCell === cell) return null;
  const target = targetCell.layers[layer.index];
  return isLayerHolding(target) ? target : null;
};

/**
 * Takes a body out of `layer`'s lists (a unit's ids, a new array for that unit only, or its
 * adopted ones), for another layer to take it.
 * @internal
 */
export const takeBodyFromLayer = (layer: StreamingLayer, entityId: number) => {
  const adoptedAt = layer.adopted.indexOf(entityId);
  if (adoptedAt >= 0) {
    layer.adopted.splice(adoptedAt, 1);
    return;
  }
  for (let i = 0; i < layer.units.length; i++) {
    const ids = layer.units[i].entityIds;
    if (ids?.includes(entityId)) {
      layer.units[i].entityIds = ids.filter((id) => id !== entityId);
      return;
    }
  }
};

const adoptBody = (rt: StreamingRuntime, target: StreamingLayer, entityId: number) => {
  target.adopted.push(entityId);
  rt.stats.bodiesAdopted++;
  rt.bodies?.adopted?.(rt, target, entityId);
};

/**
 * Hands each body of `layer`'s that has moved into another loaded cell to that cell's layer, as
 * `layer` starts unloading: its units' finished entities (a moved one leaves its unit's ids, so a
 * custom `unload` never sees it) and the bodies it adopted itself. A body another cell made that
 * is inside `layer`'s cell isn't `layer`'s: its own layer checks it when it unloads. Allocates
 * only for a unit that loses a body.
 * @internal
 */
export const handOverMovedBodies = (rt: StreamingRuntime, layer: StreamingLayer) => {
  if (!rt.bodies) return;
  for (let i = 0; i < layer.units.length; i++) {
    const unit = layer.units[i];
    const ids = unit.entityIds;
    // Only a finished unit holds ids
    if (!ids) continue;
    let kept: number[] | null = null;
    for (let j = 0; j < ids.length; j++) {
      const target = findAdopter(rt, layer, ids[j]);
      if (target) {
        kept ??= ids.slice(0, j);
        adoptBody(rt, target, ids[j]);
      } else {
        kept?.push(ids[j]);
      }
    }
    if (kept) unit.entityIds = kept;
  }
  const { adopted } = layer;
  let count = 0;
  for (let i = 0; i < adopted.length; i++) {
    const entityId = adopted[i];
    if (!rt.world.isAlive(entityId)) continue;
    const target = findAdopter(rt, layer, entityId);
    if (target) adoptBody(rt, target, entityId);
    else adopted[count++] = entityId;
  }
  adopted.length = count;
  rt.bodies.forgetLayer?.(rt, layer);
};
