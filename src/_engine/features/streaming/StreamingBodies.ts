// The streaming cells' bodies (p353 Phase 4): which of a cell's entities can leave it and where
// they are, the machine's hand-over of the ones that moved when a cell unloads (D1), and the
// cells' physics tiers (D2-D7): a body gets its cell's tier when its unit finishes, when the
// cell's level changes and when a cell adopts it, a body created inside a cell's load starts in
// it (the kernel's creation scope), and a tier policy member is out of the policy while its cell
// isn't `RESIDENT`. `createStreamingBodies` makes one per scene's machine (rt.bodies); the
// machine's own tests run with a stand-in. Bodies are read from the kernel's component keys and
// tiers asked for through the kernel's PhysicsTierAccess, so streaming imports no physics code (a
// feature imports no other's): without physics() nothing is a body that moves, and without
// physicsTiers() no tier is asked for.
import type { ECSWorld } from '../../kernel/ecs/ECS';
import { ComponentType } from '../../kernel/ecs/ECSCoreComponents';
import {
  type PhysicsCreationScope,
  type PhysicsTierWant,
  getPhysicsTierAccess,
} from '../../kernel/ecs/PhysicsTierAccess';
import { isCellInRange, packCellKey, worldToCell } from '../../utils/CellKey';
import { lwarn } from '../../utils/Logger';
import type { StreamingCell, StreamingRuntime } from './StreamingCells';
import { StreamingLevel } from './StreamingRings';

/**
 * What the streaming machine asks of its cells' bodies. Only `locateMover` is required: a machine
 * test's stand-in leaves the tiers out.
 * @internal
 */
export type StreamingBodies = {
  /** Writes `entityId`'s x and z into `out` and returns true when it can leave its cell (a live
   * entity with a dynamic body, whatever its tier), else returns false. */
  locateMover(world: ECSWorld, entityId: number, out: { x: number; z: number }): boolean;
  /** The creation scope a cell's content runs in (its tier, and whether policy members are held
   * out), or null without physics tiers. */
  getCreationScope?(rt: StreamingRuntime, cell: StreamingCell): PhysicsCreationScope | null;
  /** A unit of the cell finished with these entities: its bodies are the cell's now. */
  unitLoaded?(rt: StreamingRuntime, cell: StreamingCell, entityIds: readonly number[]): void;
  /** A cell with content got another loaded level. */
  levelChanged?(rt: StreamingRuntime, cell: StreamingCell): void;
  /** A body was handed to `cell`. */
  adopted?(rt: StreamingRuntime, cell: StreamingCell, entityId: number): void;
  /** `cell` starts unloading, its moved bodies handed over: the rest go with it. */
  forgetCell?(rt: StreamingRuntime, cell: StreamingCell): void;
  /** The bodies the cells hold, and those of them held out of the tier policy (the debug tab). */
  count?(): { bodies: number; heldOutOfPolicy: number };
};

/** Whether the entity has a dynamic body: in a dynamic bucket, or a tier holds it (a `STATIC`
 * or `DISABLED` one is in `BODY_STATIC`, a `REMOVED` one in none). */
const isMover = (world: ECSWorld, entityId: number) =>
  world.hasComponent(entityId, ComponentType.BODY_DYNAMIC_VISUAL) ||
  world.hasComponent(entityId, ComponentType.BODY_DYNAMIC_HEADLESS) ||
  world.hasComponent(entityId, ComponentType.PHYSICS_SIM_TIER);

/** The entities a cell holds: its units' and the ones it adopted. */
const forEachCellEntity = (cell: StreamingCell, fn: (entityId: number) => void) => {
  for (let i = 0; i < cell.units.length; i++) {
    const ids = cell.units[i].entityIds;
    if (ids) for (let j = 0; j < ids.length; j++) fn(ids[j]);
  }
  for (let i = 0; i < cell.adopted.length; i++) fn(cell.adopted[i]);
};

let hasWarnedNoTiers = false;

/**
 * A scene's cells' bodies as the engine has them (p353 Phase 4): a mover's position is its
 * `TRANSFORM`'s (a `REMOVED` body's is the pose it was taken out at, p352), and its tier its
 * cell's: a `RESIDENT` cell's bodies `FULL` or their policy's, a `NEARBY` cell's the scene's
 * `nearbyPhysicsTier`. The requests go out on the frames the cells change (D2), so their steps
 * depend on frame timing.
 * @internal
 */
export const createStreamingBodies = (): StreamingBodies => {
  /** The cell each body is with (its unit's, or the one it was handed to) */
  const bodyCells = new Map<number, StreamingCell>();
  /** The cells' bodies that follow the tier policy while their cell is RESIDENT (D5) */
  const policyBodies = new Set<number>();
  /** The NEARBY tier of the scene being synced (wantOf's) */
  let nearbyTier: 'STATIC' | 'DISABLED' = 'STATIC';

  const wantOf = (entityId: number): PhysicsTierWant | null => {
    const cell = bodyCells.get(entityId);
    if (!cell) return null;
    if (cell.level !== StreamingLevel.RESIDENT) return nearbyTier;
    return policyBodies.has(entityId) ? 'POLICY' : 'FULL';
  };

  /** Gives `entityIds`' bodies their cell's tier, and their policy membership (D5). */
  const syncBodies = (rt: StreamingRuntime, cell: StreamingCell, entityIds: readonly number[]) => {
    const access = getPhysicsTierAccess();
    const isResident = cell.level === StreamingLevel.RESIDENT;
    if (!access) {
      if (!isResident && !hasWarnedNoTiers) {
        hasWarnedNoTiers = true;
        lwarn(
          "Streaming: a NEARBY cell's bodies keep simulating FULL: per-cell physics tiers need physicsTiers() (from 'aekasha/physics') in InitEngine's features."
        );
      }
      return;
    }
    const { world } = rt;
    for (let i = 0; i < entityIds.length; i++) {
      const entityId = entityIds[i];
      if (bodyCells.get(entityId) !== cell || !policyBodies.has(entityId)) continue;
      const isMember = world.hasComponent(entityId, ComponentType.PHYSICS_TIER_POLICY);
      // Out: its tier stays as it is until the request below; in: the policy places it
      if (isMember !== isResident) access.setPolicyMember(world, entityId, isResident);
    }
    nearbyTier = rt.settings.nearbyPhysicsTier;
    access.requestTiers(world, entityIds, wantOf);
  };

  /** A tierPolicy body created in a cell that wasn't RESIDENT, its body just made (D5). */
  const holdPolicyMember = (rt: StreamingRuntime, cell: StreamingCell, entityId: number) => {
    policyBodies.add(entityId);
    // RESIDENT since its create started: in at once
    if (cell.level === StreamingLevel.RESIDENT) {
      getPhysicsTierAccess()?.setPolicyMember(rt.world, entityId, true);
    }
  };

  return {
    locateMover: (world, entityId, out) => {
      if (!world.isAlive(entityId) || !isMover(world, entityId)) return false;
      const position = world.getPosition(entityId);
      if (!position) return false;
      out.x = position.x;
      out.z = position.z;
      return true;
    },

    getCreationScope: (rt, cell) => {
      if (!getPhysicsTierAccess()) return null;
      if (cell.level === StreamingLevel.RESIDENT) return { tier: 'FULL', holdPolicyMember: null };
      return {
        tier: rt.settings.nearbyPhysicsTier,
        holdPolicyMember: (_world, entityId) => holdPolicyMember(rt, cell, entityId),
      };
    },

    unitLoaded: (rt, cell, entityIds) => {
      const { world } = rt;
      let hasBodies = false;
      for (let i = 0; i < entityIds.length; i++) {
        const entityId = entityIds[i];
        if (!world.isAlive(entityId) || !isMover(world, entityId)) continue;
        hasBodies = true;
        bodyCells.set(entityId, cell);
        if (world.hasComponent(entityId, ComponentType.PHYSICS_TIER_POLICY)) {
          policyBodies.add(entityId);
        }
      }
      if (hasBodies) syncBodies(rt, cell, entityIds);
    },

    levelChanged: (rt, cell) => {
      const entityIds: number[] = [];
      forEachCellEntity(cell, (entityId) => {
        if (bodyCells.get(entityId) === cell) entityIds.push(entityId);
      });
      if (entityIds.length) syncBodies(rt, cell, entityIds);
    },

    adopted: (rt, cell, entityId) => {
      bodyCells.set(entityId, cell);
      syncBodies(rt, cell, [entityId]);
    },

    forgetCell: (_rt, cell) =>
      forEachCellEntity(cell, (entityId) => {
        if (bodyCells.get(entityId) !== cell) return;
        bodyCells.delete(entityId);
        policyBodies.delete(entityId);
      }),

    count: () => {
      let heldOutOfPolicy = 0;
      for (const [entityId, cell] of bodyCells) {
        if (policyBodies.has(entityId) && cell.level !== StreamingLevel.RESIDENT) heldOutOfPolicy++;
      }
      return { bodies: bodyCells.size, heldOutOfPolicy };
    },
  };
};

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

/**
 * Deletes the bodies a cell adopted (its unload, or the scene's exit).
 * @internal
 */
export const deleteAdoptedBodies = (rt: StreamingRuntime, cell: StreamingCell) => {
  const { adopted } = cell;
  for (let i = 0; i < adopted.length; i++) rt.world.deleteEntity(adopted[i]);
  adopted.length = 0;
};
