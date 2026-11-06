// The streaming cells' bodies (p353 Phase 4): which of a cell's entities can leave it and where
// they are (`createStreamingBodies`, injected into the machine as rt.bodies; its own tests run
// with a stand-in), and the machine's hand-over of the ones that moved when a cell unloads (D1).
// Read from the kernel's component keys, so streaming imports no physics code (a feature imports
// no other's), and without physics() nothing is ever a body that moves.
import type { ECSWorld } from '../../kernel/ecs/ECS';
import { ComponentType } from '../../kernel/ecs/ECSCoreComponents';
import { isCellInRange, packCellKey, worldToCell } from '../../utils/CellKey';
import type { StreamingCell, StreamingRuntime } from './StreamingCells';

/**
 * What the streaming machine asks of its cells' bodies.
 * @internal
 */
export type StreamingBodies = {
  /** Writes `entityId`'s x and z into `out` and returns true when it can leave its cell (a live
   * entity with a dynamic body, whatever its tier), else returns false. */
  locateMover(world: ECSWorld, entityId: number, out: { x: number; z: number }): boolean;
};

/** Whether the entity has a dynamic body: in a dynamic bucket, or a tier holds it (a `STATIC`
 * or `DISABLED` one is in `BODY_STATIC`, a `REMOVED` one in none). */
const isMover = (world: ECSWorld, entityId: number) =>
  world.hasComponent(entityId, ComponentType.BODY_DYNAMIC_VISUAL) ||
  world.hasComponent(entityId, ComponentType.BODY_DYNAMIC_HEADLESS) ||
  world.hasComponent(entityId, ComponentType.PHYSICS_SIM_TIER);

/**
 * The cells' bodies as the engine has them: a mover's position is its `TRANSFORM`'s (a `REMOVED`
 * body's is the pose it was taken out at, p352).
 * @internal
 */
export const createStreamingBodies = (): StreamingBodies => ({
  locateMover: (world, entityId, out) => {
    if (!world.isAlive(entityId) || !isMover(world, entityId)) return false;
    const position = world.getPosition(entityId);
    if (!position) return false;
    out.x = position.x;
    out.z = position.z;
    return true;
  },
});

// --- The hand-over (D1) -----------------------------------------------------------------------

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
};

/**
 * Deletes the bodies a cell adopted (its unload, or the scene's exit).
 * @internal
 */
export const deleteAdoptedBodies = (rt: StreamingRuntime, cell: StreamingCell) => {
  const { adopted } = cell;
  for (let i = 0; i < adopted.length; i++) rt.world.deleteEntity(adopted[i]);
  adopted.length = 0;
};
