// The streaming cells' bodies (p353 Phase 4): which of a cell's entities can leave it and where
// they are (the machine's hand-over, StreamingHandOver.ts, asks), and the cells' physics tiers
// (D2-D7), per content layer (Phase 5 D11): a body gets its layer's tier when its unit finishes,
// when its cell's level changes and when a layer adopts it, a body created inside a layer's load
// starts in it (the kernel's creation scope), and a tier policy member is out of the policy while
// its cell isn't `RESIDENT`. A `FAR` cell's kept and far bodies are `REMOVED` (a jointed group
// `STATIC`, physics' batch). `createStreamingBodies` makes one per scene's machine (rt.bodies), loaded with
// an import() by a scene that streams (the first download carries none of it); the machine's own
// tests run with a stand-in. Bodies are read from the kernel's component keys and
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
import { lwarn } from '../../utils/Logger';
import type { StreamingRuntime } from './StreamingCells';
import { findAdopter, handOverMovedBodies, takeBodyFromLayer } from './StreamingHandOver';
import { type StreamingLayer, isLayerWanted, showAdoptedBody } from './StreamingLayers';
import { StreamingLevel } from './StreamingRings';

/**
 * What the streaming machine asks of its cells' bodies. Only `locateMover` is required: a machine
 * test's stand-in leaves the tiers out (and passes `handOverMovedBodies` as its `handOver`).
 * @internal
 */
export type StreamingBodies = {
  /** Writes `entityId`'s x and z into `out` and returns true when it can leave its cell (a live
   * entity with a dynamic body, whatever its tier), else returns false. */
  locateMover(world: ECSWorld, entityId: number, out: { x: number; z: number }): boolean;
  /** `layer` starts unloading: its bodies that moved into another loaded cell go to that cell's
   * layer (StreamingHandOver.ts' `handOverMovedBodies`). Without it nothing is handed over. */
  handOver?(rt: StreamingRuntime, layer: StreamingLayer): void;
  /** A decision starts: every body the layers hold that is inside another loaded cell goes to its
   * layer and takes its tier, so a body's tier is the cell it's in, not the one that made it. */
  rebalance?(rt: StreamingRuntime): void;
  /** The creation scope a layer's content runs in (its tier, and whether policy members are held
   * out), or null without physics tiers. */
  getCreationScope?(rt: StreamingRuntime, layer: StreamingLayer): PhysicsCreationScope | null;
  /** A unit of the layer finished with these entities: its bodies are the layer's now. */
  unitLoaded?(rt: StreamingRuntime, layer: StreamingLayer, entityIds: readonly number[]): void;
  /** The layer's cell got another level while the layer has content. */
  levelChanged?(rt: StreamingRuntime, layer: StreamingLayer): void;
  /** A body was handed to `layer`. */
  adopted?(rt: StreamingRuntime, layer: StreamingLayer, entityId: number): void;
  /** `layer` starts unloading, its moved bodies handed over: the rest go with it. */
  forgetLayer?(rt: StreamingRuntime, layer: StreamingLayer): void;
  /** The bodies the cells hold, for the debug tab and checks (walks them all). */
  summarize?(world: ECSWorld): StreamingBodiesSummary;
};

/**
 * The bodies a scene's cells hold, by tier (`StreamingBodies.summarize`).
 * @internal
 */
export type StreamingBodiesSummary = {
  /** Bodies the cells hold. */
  bodies: number;
  /** Of them, in the tier policy's set but held out of it (their cell isn't `RESIDENT`). */
  heldOutOfPolicy: number;
  /** Bodies per tier (`FULL` for one that never got a tier). */
  byTier: Record<string, number>;
  /** Bodies with no tier request pending whose tier isn't their layer's: a non-policy body of a
   * `RESIDENT` cell that isn't `FULL`, a `NEARBY` cell's (or a leaving layer's) not in its
   * `nearbyPhysicsTier`, a `FAR` cell's not `REMOVED` (characters and jointed bodies left out:
   * their tiers aren't the cell's, but p420's and their joint group's). Without `physicsTiers()`,
   * every body of a cell that isn't `RESIDENT`. */
  offTier: number;
};

/** Whether the entity has a dynamic body: in a dynamic bucket, or a tier holds it (a `STATIC`
 * or `DISABLED` one is in `BODY_STATIC`, a `REMOVED` one in none). */
const isMover = (world: ECSWorld, entityId: number) =>
  world.hasComponent(entityId, ComponentType.BODY_DYNAMIC_VISUAL) ||
  world.hasComponent(entityId, ComponentType.BODY_DYNAMIC_HEADLESS) ||
  world.hasComponent(entityId, ComponentType.PHYSICS_SIM_TIER);

/** The entities a layer holds: its units' and the ones it adopted. */
const forEachLayerEntity = (layer: StreamingLayer, fn: (entityId: number) => void) => {
  for (let i = 0; i < layer.units.length; i++) {
    const ids = layer.units[i].entityIds;
    if (ids) for (let j = 0; j < ids.length; j++) fn(ids[j]);
  }
  for (let i = 0; i < layer.adopted.length; i++) fn(layer.adopted[i]);
};

let hasWarnedNoTiers = false;

/**
 * A layer's bodies' tier (p353 Phase 5 D11): a `RESIDENT` cell's `FULL` (or their policy's), a
 * `NEARBY` cell's `nearbyTier`, a `FAR` cell's `REMOVED`; a layer its cell is leaving keeps
 * `nearbyTier` until it's deleted (a `REMOVED` round trip for a fade's length is waste).
 */
const getLayerWant = (
  layer: StreamingLayer,
  isPolicy: boolean,
  nearbyTier: 'STATIC' | 'DISABLED'
): PhysicsTierWant => {
  if (!isLayerWanted(layer)) return nearbyTier;
  switch (layer.cell.level) {
    case StreamingLevel.RESIDENT:
      return isPolicy ? 'POLICY' : 'FULL';
    case StreamingLevel.FAR:
      return 'REMOVED';
    default:
      return nearbyTier;
  }
};

/**
 * A scene's cells' bodies as the engine has them (p353 Phase 4): a mover's position is its
 * `TRANSFORM`'s (a `REMOVED` body's is the pose it was taken out at, p352), and its tier its
 * layer's: a `RESIDENT` cell's bodies `FULL` or their policy's, a `NEARBY` cell's `nearbyTier`
 * (the scene's `nearbyPhysicsTier`), a `FAR` cell's `REMOVED` (Phase 5 D11). The requests go out
 * on the frames the cells change (D2), so their steps depend on frame timing.
 * @internal
 */
export const createStreamingBodies = (
  nearbyTier: 'STATIC' | 'DISABLED' = 'STATIC'
): StreamingBodies => {
  /** The layer each body is with (its unit's, or the one it was handed to) */
  const bodyLayers = new Map<number, StreamingLayer>();
  /** The layers' bodies that follow the tier policy while their cell is RESIDENT (D5) */
  const policyBodies = new Set<number>();

  const wantOf = (entityId: number): PhysicsTierWant | null => {
    const layer = bodyLayers.get(entityId);
    return layer ? getLayerWant(layer, policyBodies.has(entityId), nearbyTier) : null;
  };

  /** Gives `entityIds`' bodies their layer's tier, and their policy membership (D5). */
  const syncBodies = (
    rt: StreamingRuntime,
    layer: StreamingLayer,
    entityIds: readonly number[]
  ) => {
    const access = getPhysicsTierAccess();
    const isResident = layer.cell.level === StreamingLevel.RESIDENT;
    if (!access) {
      if (!isResident && !hasWarnedNoTiers) {
        hasWarnedNoTiers = true;
        lwarn(
          "Streaming: a NEARBY or FAR cell's bodies keep simulating FULL: per-cell physics tiers need physicsTiers() (from 'aekasha/physics') in InitEngine's features."
        );
      }
      return;
    }
    const { world } = rt;
    for (let i = 0; i < entityIds.length; i++) {
      const entityId = entityIds[i];
      if (bodyLayers.get(entityId) !== layer || !policyBodies.has(entityId)) continue;
      const isMember = world.hasComponent(entityId, ComponentType.PHYSICS_TIER_POLICY);
      // Out: its tier stays as it is until the request below; in: the policy places it
      if (isMember !== isResident) access.setPolicyMember(world, entityId, isResident);
    }
    access.requestTiers(world, entityIds, wantOf);
  };

  /** A tierPolicy body created in a cell that wasn't RESIDENT, its body just made (D5). */
  const holdPolicyMember = (rt: StreamingRuntime, layer: StreamingLayer, entityId: number) => {
    policyBodies.add(entityId);
    // RESIDENT since its create started: in at once
    if (layer.cell.level === StreamingLevel.RESIDENT) {
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

    handOver: handOverMovedBodies,

    rebalance: (rt) => {
      if (!bodyLayers.size) return;
      const { world } = rt;
      let moved: Map<StreamingLayer, number[]> | null = null;
      for (const [entityId, layer] of bodyLayers) {
        if (!world.isAlive(entityId)) {
          bodyLayers.delete(entityId);
          policyBodies.delete(entityId);
          continue;
        }
        const target = findAdopter(rt, layer, entityId);
        if (!target) continue;
        takeBodyFromLayer(layer, entityId);
        target.adopted.push(entityId);
        rt.stats.bodiesAdopted++;
        showAdoptedBody(rt, target, entityId);
        bodyLayers.set(entityId, target);
        moved ??= new Map();
        const ids = moved.get(target);
        if (ids) ids.push(entityId);
        else moved.set(target, [entityId]);
      }
      if (moved) for (const [layer, ids] of moved) syncBodies(rt, layer, ids);
    },

    getCreationScope: (rt, layer) => {
      if (!getPhysicsTierAccess()) return null;
      const want = getLayerWant(layer, false, nearbyTier);
      if (want === 'FULL') return { tier: 'FULL', holdPolicyMember: null };
      return {
        // A FAR cell's bodies start DISABLED (a create has no REMOVED), its unit's batch takes
        // them out (D11)
        tier: want === 'REMOVED' ? 'DISABLED' : nearbyTier,
        holdPolicyMember: (_world, entityId) => holdPolicyMember(rt, layer, entityId),
      };
    },

    unitLoaded: (rt, layer, entityIds) => {
      const { world } = rt;
      let hasBodies = false;
      for (let i = 0; i < entityIds.length; i++) {
        const entityId = entityIds[i];
        if (!world.isAlive(entityId) || !isMover(world, entityId)) continue;
        hasBodies = true;
        bodyLayers.set(entityId, layer);
        if (world.hasComponent(entityId, ComponentType.PHYSICS_TIER_POLICY)) {
          policyBodies.add(entityId);
        }
      }
      if (hasBodies) syncBodies(rt, layer, entityIds);
    },

    levelChanged: (rt, layer) => {
      const entityIds: number[] = [];
      forEachLayerEntity(layer, (entityId) => {
        if (bodyLayers.get(entityId) === layer) entityIds.push(entityId);
      });
      if (entityIds.length) syncBodies(rt, layer, entityIds);
    },

    adopted: (rt, layer, entityId) => {
      bodyLayers.set(entityId, layer);
      syncBodies(rt, layer, [entityId]);
    },

    forgetLayer: (_rt, layer) =>
      forEachLayerEntity(layer, (entityId) => {
        if (bodyLayers.get(entityId) !== layer) return;
        bodyLayers.delete(entityId);
        policyBodies.delete(entityId);
      }),

    summarize: (world) => {
      const summary: StreamingBodiesSummary = {
        bodies: 0,
        heldOutOfPolicy: 0,
        byTier: {},
        offTier: 0,
      };
      for (const [entityId, layer] of bodyLayers) {
        if (!world.isAlive(entityId)) continue;
        summary.bodies++;
        const data = world.getComponent(entityId, ComponentType.PHYSICS_SIM_TIER);
        const tier = data?.tier ?? 'FULL';
        summary.byTier[tier] = (summary.byTier[tier] ?? 0) + 1;
        const isPolicy = policyBodies.has(entityId);
        if (isPolicy && layer.cell.level !== StreamingLevel.RESIDENT) summary.heldOutOfPolicy++;
        if (data && data.target !== data.tier) continue;
        if (world.hasComponent(entityId, ComponentType.TAG_IS_CHARACTER)) continue;
        if (getPhysicsTierAccess()?.isJointed(world, entityId)) continue;
        const want = getLayerWant(layer, isPolicy, nearbyTier);
        if (want !== 'POLICY' && tier !== want) summary.offTier++;
      }
      return summary;
    },
  };
};
