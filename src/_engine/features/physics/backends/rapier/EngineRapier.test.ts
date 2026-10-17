import type Rapier from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import type { LoopState } from '../../../../kernel/loop/MainLoop';
import type { PhysicsDownProtocol } from '../../protocol/PhysicsDownProtocol';
import { PhysicsProtocolType } from '../../protocol/PhysicsProtocolType';
import type { PhysicsUpProtocol } from '../../protocol/PhysicsUpProtocol';
import type { EngineAPIType } from '../../types/PhysicsBackendTypes';
import { RigidBodyTypeAPI } from '../../types/PhysicsBodyTypes';
import {
  ActiveCollisionTypes,
  ActiveEvents,
  ActiveHooks,
  CoefficientCombineRule,
  ShapeType,
} from '../../types/PhysicsColliderTypes';
import type { PhysicsState } from '../../types/PhysicsConfigTypes';
import { SolverFlags } from '../../types/PhysicsEventTypes';
import { JointAxesMask } from '../../types/PhysicsJointTypes';
import { FeatureType, QueryFilterFlags } from '../../types/PhysicsQueryTypes';
import type { WorldAPI } from '../../types/PhysicsWorldTypes';
import { initPhysicsEngine } from '../../PhysicsUtils';
import { physicsSwitchWorld } from '../../worker/PhysicsSwitchWorld';

// The Rapier backend in Node: the compat build carries its WASM inline, so no GPU or DOM is needed.

let RAPIER: typeof Rapier;
let engAPI: EngineAPIType;
let world: WorldAPI;
/** The module's first collider: ids start at 0 and are never reused. */
let groundId: number;

beforeAll(async () => {
  const loaded = await initPhysicsEngine('RAPIER');
  RAPIER = loaded.engine as typeof Rapier;
  engAPI = loaded.engineAPI;
  const state = { gravity: { x: 0, y: -9.81, z: 0 }, timestepRatio: 1 / 60 } as PhysicsState;
  world = engAPI.init(state, true, {} as LoopState)!;
  groundId = engAPI.createCollider({ type: 'CUBOID', hx: 5, hy: 0.5, hz: 5 }).id;
});

describe('EngineRapier', () => {
  it('reports collider 0 as a contact pair through the worker switch (W1)', async () => {
    expect(groundId).toBe(0);
    const body = engAPI.createRigidBody({
      rigidType: 'DYNAMIC',
      translation: { x: 0, y: 0.9, z: 0 },
    });
    const ball = engAPI.createCollider({ type: 'BALL', radius: 0.5 }, body.id);
    engAPI.step();
    const replies: PhysicsDownProtocol[] = [];
    await physicsSwitchWorld(
      {
        type: PhysicsProtocolType.WORLD_CONTACT_PAIRS_WITH,
        colliderId: ball.id,
        requestId: 1,
      } as PhysicsUpProtocol,
      world,
      (message) => replies.push(message)
    );
    expect(replies).toEqual([
      { type: PhysicsProtocolType.WORLD_CONTACT_PAIRS_WITH, colliderIds: [groundId] },
    ]);
  });

  it('gives a collider asking for friction 0 friction 0 (R1)', () => {
    expect(engAPI.createCollider({ type: 'BALL', radius: 0.5, friction: 0 }).frictionSync()).toBe(
      0
    );
    // Rapier's default stays for one that doesn't ask
    expect(engAPI.createCollider({ type: 'BALL', radius: 0.5 }).frictionSync()).toBe(0.5);
  });

  it("never writes the parent into the caller's params (R3)", () => {
    const body = engAPI.createRigidBody({ rigidType: 'DYNAMIC' });
    const params = { type: 'BALL', radius: 0.5 } as const;
    const attached = engAPI.createCollider(params, body.id);
    expect(params).not.toHaveProperty('parentId');
    // The same params again, without a parent: a free collider, not a second one on the body
    const free = engAPI.createCollider(params);
    expect(attached.parentId).toBe(body.id);
    expect(free.parentId).toBeUndefined();
  });

  it("mirrors Rapier's enums member for member (RapierEnums.ts' casts rely on it)", () => {
    /** An enum's members by name (a numeric enum also maps its numbers back to names). */
    const members = (e: object) =>
      Object.fromEntries(Object.entries(e).filter(([name]) => Number.isNaN(Number(name))));
    const pairs: [object, object][] = [
      [RigidBodyTypeAPI, RAPIER.RigidBodyType],
      [ShapeType, RAPIER.ShapeType],
      [CoefficientCombineRule, RAPIER.CoefficientCombineRule],
      [ActiveHooks, RAPIER.ActiveHooks],
      [ActiveEvents, RAPIER.ActiveEvents],
      [ActiveCollisionTypes, RAPIER.ActiveCollisionTypes],
      [FeatureType, RAPIER.FeatureType],
      [QueryFilterFlags, RAPIER.QueryFilterFlags],
      [SolverFlags, RAPIER.SolverFlags],
      [JointAxesMask, RAPIER.JointAxesMask],
    ];
    for (const [ours, rapiers] of pairs) expect(members(ours)).toEqual(members(rapiers));
  });

  it('reuses one Rapier ray across queries, also from inside an intersectionsWithRay callback (R4)', () => {
    const down = { x: 0, y: -1, z: 0 };
    // The ground's top is at y = 0.5 (away from the bodies the tests above put at the origin)
    const hit = world.castRaySync({ origin: { x: 4, y: 3, z: 4 }, dir: down }, 10, true);
    expect(hit?.timeOfImpact).toBeCloseTo(2.5);
    const miss = world.castRaySync({ origin: { x: 20, y: 3, z: 0 }, dir: down }, 10, true);
    expect(miss).toBeNull();

    const nested: (number | null)[] = [];
    world.intersectionsWithRaySync(
      { origin: { x: 4, y: 3, z: 4 }, dir: down },
      10,
      true,
      (intersect) => {
        // A query in the callback sets the shared ray again: the outer query has read it already
        const inner = world.castRaySync({ origin: { x: 3, y: 2, z: 3 }, dir: down }, 10, true);
        nested.push(intersect.collider.id === groundId ? inner?.timeOfImpact ?? null : null);
        return true;
      }
    );
    expect(nested.filter((toi) => toi !== null)).toHaveLength(1);
    expect(nested.find((toi) => toi !== null)).toBeCloseTo(1.5);
  });
});
