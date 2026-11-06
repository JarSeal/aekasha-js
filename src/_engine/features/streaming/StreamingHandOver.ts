// The streaming machine's hand-over of the bodies that moved (p353 Phase 4 D1): when a cell starts
// unloading, each body it holds that is inside another loaded cell goes to that cell, which
// deletes it when it unloads itself. The runtime's bodies (StreamingBodies.ts, loaded on demand)
// run it as their `handOver`, and say which entities are bodies and where they are; without them
// nothing moves. A module of its own so the machine's tests can hand it to their stand-in.
import { isCellInRange, packCellKey, worldToCell } from '../../utils/CellKey';
import type { StreamingCell, StreamingRuntime } from './StreamingCells';

const _at = { x: 0, z: 0 };

/** The cell a body of `cell`'s has moved into, when that cell has content to keep it with
 * (`LOADING`, `PRIMING` or `LOADED`); null when it's still in `cell`, isn't a body that moves, or
 * is somewhere nothing is loaded (it goes with `cell`). */
const findAdopter = (
  rt: StreamingRuntime,
  cell: StreamingCell,
  entityId: number
): StreamingCell | null => {
  if (!rt.bodies?.locateMover(rt.world, entityId, _at)) return null;
  const { invCellSize } = rt.settings;
  const cx = worldToCell(_at.x, invCellSize);
  const cz = worldToCell(_at.z, invCellSize);
  if ((cx === cell.cx && cz === cell.cz) || !isCellInRange(cx, 0, cz)) return null;
  const target = rt.cells.get(packCellKey(cx, 0, cz));
  if (!target || target === cell) return null;
  const { phase } = target;
  return phase === 'LOADING' || phase === 'PRIMING' || phase === 'LOADED' ? target : null;
};

const adoptBody = (rt: StreamingRuntime, target: StreamingCell, entityId: number) => {
  target.adopted.push(entityId);
  rt.stats.bodiesAdopted++;
  rt.bodies?.adopted?.(rt, target, entityId);
};

/**
 * Hands each body of `cell`'s that has moved into another loaded cell to that cell, as `cell`
 * starts unloading: its units' finished entities (a moved one leaves its unit's ids, so a custom
 * `unload` never sees it) and the bodies it adopted itself. A body another cell made that is
 * inside `cell` isn't `cell`'s: its own cell checks it when it unloads. Allocates only for a unit
 * that loses a body.
 * @internal
 */
export const handOverMovedBodies = (rt: StreamingRuntime, cell: StreamingCell) => {
  if (!rt.bodies) return;
  for (let i = 0; i < cell.units.length; i++) {
    const unit = cell.units[i];
    const ids = unit.entityIds;
    // Only a finished unit holds ids
    if (!ids) continue;
    let kept: number[] | null = null;
    for (let j = 0; j < ids.length; j++) {
      const target = findAdopter(rt, cell, ids[j]);
      if (target) {
        kept ??= ids.slice(0, j);
        adoptBody(rt, target, ids[j]);
      } else {
        kept?.push(ids[j]);
      }
    }
    if (kept) unit.entityIds = kept;
  }
  const { adopted } = cell;
  let count = 0;
  for (let i = 0; i < adopted.length; i++) {
    const entityId = adopted[i];
    if (!rt.world.isAlive(entityId)) continue;
    const target = findAdopter(rt, cell, entityId);
    if (target) adoptBody(rt, target, entityId);
    else adopted[count++] = entityId;
  }
  adopted.length = count;
  rt.bodies.forgetCell?.(rt, cell);
};
