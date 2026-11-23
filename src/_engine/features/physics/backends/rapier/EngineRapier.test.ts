import type Rapier from '@dimforge/rapier3d-compat';
import * as THREE from 'three/webgpu';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LoopState } from '../../../../kernel/loop/MainLoop';
import type { PhysicsDownProtocol } from '../../protocol/PhysicsDownProtocol';
import { PhysicsProtocolType } from '../../protocol/PhysicsProtocolType';
import type { PhysicsUpProtocol } from '../../protocol/PhysicsUpProtocol';
import type { EngineAPIType } from '../../types/PhysicsBackendTypes';
import { RigidBodyTypeAPI } from '../../types/PhysicsBodyTypes';
import type { RigidBodyParams } from '../../types/PhysicsBodyTypes';
import { ShapeType } from '../../types/PhysicsColliderTypes';
import type { ColliderParams } from '../../types/PhysicsColliderTypes';
import type { PhysicsState } from '../../types/PhysicsConfigTypes';
import { JointAxesMask } from '../../types/PhysicsJointTypes';
import { FeatureType, QueryFilterFlags } from '../../types/PhysicsQueryTypes';
import type { WorldAPI } from '../../types/PhysicsWorldTypes';
import { initPhysicsEngine } from '../../PhysicsUtils';
import { physicsSwitchWorld } from '../../worker/PhysicsSwitchWorld';
import { backend, colliders, rigidBodies } from './RapierState';

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

  it('turns a shape by its orientation, then by its rotation on the body (M2)', () => {
    const s = Math.SQRT1_2;
    const body = engAPI.createRigidBody({ rigidType: 'FIXED' });
    // A cylinder on X (+Y onto +X), and a collider turned 90° about Y on its body (+X onto −Z)
    const orientation = { x: 0, y: 0, z: -s, w: s };
    const rotation = { x: 0, y: s, z: 0, w: s };
    const cylinder = { type: 'CYLINDER', radius: 0.5, halfHeight: 1 } as const;
    // Where the collider's rotation takes Rapier's spine (+Y), rounded
    const spineOf = (params: ColliderParams) => {
      const q = engAPI.createCollider(params, body.id).rotationWrtParentSync()!;
      const spine = new THREE.Vector3(0, 1, 0).applyQuaternion(
        new THREE.Quaternion(q.x, q.y, q.z, q.w)
      );
      return spine.toArray().map((v) => Math.round(v) + 0);
    };

    expect(spineOf(cylinder)).toEqual([0, 1, 0]);
    expect(spineOf({ ...cylinder, orientation })).toEqual([1, 0, 0]);
    expect(spineOf({ ...cylinder, rotation })).toEqual([0, 1, 0]);
    // Both: rotation × orientation, the rotation doesn't replace the orientation
    expect(spineOf({ ...cylinder, orientation, rotation })).toEqual([0, 0, -1]);
  });

  it("mirrors Rapier's enums member for member (RapierEnums.ts' casts rely on it)", () => {
    /** An enum's members by name (a numeric enum also maps its numbers back to names). */
    const members = (e: object) =>
      Object.fromEntries(Object.entries(e).filter(([name]) => Number.isNaN(Number(name))));
    const pairs: [object, object][] = [
      [RigidBodyTypeAPI, RAPIER.RigidBodyType],
      [ShapeType, RAPIER.ShapeType],
      [FeatureType, RAPIER.FeatureType],
      [QueryFilterFlags, RAPIER.QueryFilterFlags],
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

describe('EngineRapier world bounds (p102)', () => {
  const killY = { min: { y: -5 } };

  /** A dynamic ball away from the ground (x = 50), moving at `vy` m/s. */
  const createBall = (y: number, vy = 0, extra: Partial<RigidBodyParams> = {}) => {
    const body = engAPI.createRigidBody({
      rigidType: 'DYNAMIC',
      translation: { x: 50, y, z: 0 },
      linvel: { x: 0, y: vy, z: 0 },
      ...extra,
    });
    engAPI.createCollider({ type: 'BALL', radius: 0.5 }, body.id);
    return body;
  };

  beforeEach(() => {
    // A fresh world each: its step count starts at 0, and it has no bounds
    engAPI.deleteWorld();
    engAPI.createWorld({ x: 0, y: -9.81, z: 0 }, { timestep: 1 / 60 });
  });

  it('disables a body on the step it leaves the bounds, and records it once', () => {
    engAPI.setWorldBounds(killY);
    const body = createBall(0, -60);
    let steps = 0;
    let records = engAPI.drainPendingOutOfBoundsRecords();
    while (!records.length && steps < 30) {
      engAPI.step();
      steps++;
      records = engAPI.drainPendingOutOfBoundsRecords();
    }
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ bodyId: body.id, step: steps, source: 'GLOBAL' });
    expect(records[0].y).toBeLessThan(-5);
    expect(body.isEnabledSync()).toBe(false);
    for (let i = 0; i < 10; i++) engAPI.step();
    expect(engAPI.drainPendingOutOfBoundsRecords()).toHaveLength(0);
  });

  it('checks nothing without bounds, or with a box open on every side', () => {
    const body = createBall(-10, -60);
    engAPI.step();
    engAPI.setWorldBounds({ min: {}, max: {} });
    engAPI.step();
    expect(engAPI.drainPendingOutOfBoundsRecords()).toHaveLength(0);
    expect(body.isEnabledSync()).toBe(true);
  });

  it('catches a body created outside before the next step, or at a drain before it', () => {
    engAPI.setWorldBounds(killY);
    engAPI.step();
    // A body that sleeps from its create on never becomes active: the step's check wouldn't see it
    const body = engAPI.createRigidBody({
      rigidType: 'DYNAMIC',
      translation: { x: 50, y: -10, z: 0 },
    });
    // Queued, not checked at its create: its own bounds set with it would apply first
    expect(body.isEnabledSync()).toBe(true);
    engAPI.step();
    expect(body.isEnabledSync()).toBe(false);
    // The step count it had before that step, as at a create
    expect(engAPI.drainPendingOutOfBoundsRecords()).toEqual([
      { bodyId: body.id, step: 1, x: 50, y: -10, z: 0, source: 'GLOBAL', frozen: false },
    ]);
    const drained = createBall(-10);
    expect(engAPI.drainPendingOutOfBoundsRecords().map((r) => r.bodyId)).toEqual([drained.id]);
    expect(drained.isEnabledSync()).toBe(false);
  });

  it('checks every body, the sleeping ones included, when the bounds are set', () => {
    const sleeper = createBall(-10);
    sleeper.sleep();
    const inside = createBall(0);
    engAPI.step();
    engAPI.setWorldBounds(killY);
    const records = engAPI.drainPendingOutOfBoundsRecords();
    expect(records.map((r) => r.bodyId)).toEqual([sleeper.id]);
    expect(records[0].step).toBe(1);
    expect(sleeper.isEnabledSync()).toBe(false);
    expect(inside.isEnabledSync()).toBe(true);
  });

  it('leaves fixed and kinematic bodies alone', () => {
    engAPI.setWorldBounds(killY);
    const fixed = engAPI.createRigidBody({
      rigidType: 'FIXED',
      translation: { x: 50, y: -10, z: 0 },
    });
    const kinematic = engAPI.createRigidBody({
      rigidType: 'VELO_BASED',
      translation: { x: 50, y: 0, z: 0 },
      linvel: { x: 0, y: -60, z: 0 },
    });
    for (let i = 0; i < 20; i++) engAPI.step();
    expect(engAPI.drainPendingOutOfBoundsRecords()).toHaveLength(0);
    expect(fixed.isEnabledSync()).toBe(true);
    expect(kinematic.isEnabledSync()).toBe(true);
  });

  it('makes a jointed body FIXED instead of disabling it (i250)', () => {
    engAPI.setWorldBounds({ min: { x: 40 } });
    const anchor = createBall(0, 0, { gravityScale: 0 });
    const body = createBall(0, 0, { gravityScale: 0, linvel: { x: -60, y: 0, z: 0 } });
    engAPI.createJoint({
      type: 'ROPE',
      body1Id: anchor.id,
      body2Id: body.id,
      length: 100,
      anchor1: { x: 0, y: 0, z: 0 },
      anchor2: { x: 0, y: 0, z: 0 },
    });
    for (let i = 0; i < 30; i++) engAPI.step();
    const records = engAPI.drainPendingOutOfBoundsRecords();
    expect(records.map((r) => r.bodyId)).toEqual([body.id]);
    expect(body.isEnabledSync()).toBe(true);
    expect(body.bodyTypeSync()).toBe(RigidBodyTypeAPI.Fixed);
    expect(anchor.bodyTypeSync()).toBe(RigidBodyTypeAPI.Dynamic);
  });

  it('forgets the bounds and the undelivered exits with the world', () => {
    engAPI.setWorldBounds(killY);
    createBall(-10);
    engAPI.deleteWorld();
    engAPI.createWorld({ x: 0, y: -9.81, z: 0 });
    const body = createBall(-10, -60);
    engAPI.step();
    expect(engAPI.drainPendingOutOfBoundsRecords()).toHaveLength(0);
    expect(body.isEnabledSync()).toBe(true);
  });

  it("checks a body by its own bounds instead of the world's (p102 Phase 2)", () => {
    engAPI.setWorldBounds(killY);
    // Below the kill height, inside its own deeper box: kept
    const deep = createBall(-10);
    engAPI.setBodyWorldBounds(deep.id, { min: { y: -100 } });
    // Above the kill height, outside its own box: out, by its own
    const fenced = createBall(0, 0, { gravityScale: 0 });
    engAPI.setBodyWorldBounds(fenced.id, { max: { x: 40 } });
    const ignored = createBall(-10);
    engAPI.setBodyWorldBounds(ignored.id, 'IGNORE');
    const open = createBall(-10);
    engAPI.setBodyWorldBounds(open.id, { min: {}, max: {} });
    engAPI.step();
    expect(engAPI.drainPendingOutOfBoundsRecords()).toEqual([
      { bodyId: fenced.id, step: 0, x: 50, y: 0, z: 0, source: 'ENTITY', frozen: false },
    ]);
    expect(deep.isEnabledSync()).toBe(true);
    expect(ignored.isEnabledSync()).toBe(true);
    expect(open.isEnabledSync()).toBe(true);
    // Null: the world's bounds again, checked before the next step
    engAPI.setBodyWorldBounds(deep.id, null);
    engAPI.step();
    expect(engAPI.drainPendingOutOfBoundsRecords()).toEqual([
      expect.objectContaining({ bodyId: deep.id, step: 1, source: 'GLOBAL' }),
    ]);
  });

  it('checks the bodies with their own bounds without world bounds, and ignores unknown ids', () => {
    const sleeper = createBall(0);
    sleeper.sleep();
    engAPI.step();
    engAPI.setBodyWorldBounds(sleeper.id, { min: { y: 1 } });
    engAPI.setBodyWorldBounds(9999, { min: { y: 1 } });
    engAPI.step();
    expect(engAPI.drainPendingOutOfBoundsRecords()).toEqual([
      expect.objectContaining({ bodyId: sleeper.id, step: 1, source: 'ENTITY' }),
    ]);
  });

  it("keeps a body's own bounds through a detach, and forgets them with the body", () => {
    engAPI.setWorldBounds(killY);
    const body = createBall(-10);
    engAPI.setBodyWorldBounds(body.id, 'IGNORE');
    engAPI.step();
    engAPI.detachRigidBody(body.id);
    engAPI.reattachRigidBody(body.id, { bodyType: RigidBodyTypeAPI.Dynamic, enabled: true });
    engAPI.step();
    expect(engAPI.drainPendingOutOfBoundsRecords()).toHaveLength(0);
    // A detached body takes its own bounds too, for its return
    engAPI.detachRigidBody(body.id);
    engAPI.setBodyWorldBounds(body.id, null);
    engAPI.reattachRigidBody(body.id, { bodyType: RigidBodyTypeAPI.Dynamic, enabled: true });
    engAPI.step();
    expect(engAPI.drainPendingOutOfBoundsRecords().map((r) => r.bodyId)).toEqual([body.id]);
    engAPI.deleteRigidBody(body.id);
    // Its entry went with it: a later set for its id is ignored, and nothing is checked
    engAPI.setBodyWorldBounds(body.id, { min: { y: 0 } });
    engAPI.setWorldBounds(null);
    engAPI.step();
    expect(engAPI.drainPendingOutOfBoundsRecords()).toHaveLength(0);
  });

  it('finds a body again after a detach and reattach (the REMOVED tier)', () => {
    const body = createBall(0, -60);
    engAPI.detachRigidBody(body.id);
    engAPI.reattachRigidBody(body.id, { bodyType: RigidBodyTypeAPI.Dynamic, enabled: true });
    engAPI.setWorldBounds(killY);
    for (let i = 0; i < 30; i++) engAPI.step();
    expect(engAPI.drainPendingOutOfBoundsRecords().map((r) => r.bodyId)).toEqual([body.id]);
  });
});

describe('EngineRapier snapshots (p500)', () => {
  beforeEach(() => {
    engAPI.deleteWorld();
    world = engAPI.createWorld({ x: 0, y: -9.81, z: 0 }, { timestep: 1 / 60 });
  });

  /** A dynamic ball with a collider falling from y = 10 at `x`, far from everything else. */
  const createFallingBall = (x = -50, extra: Partial<RigidBodyParams> = {}) => {
    const body = engAPI.createRigidBody({
      rigidType: 'DYNAMIC',
      translation: { x, y: 10, z: 0 },
      ...extra,
    });
    const collider = engAPI.createCollider({ type: 'BALL', radius: 0.5 }, body.id);
    return { body, collider };
  };

  const stepTimes = (n: number) => {
    for (let i = 0; i < n; i++) engAPI.step();
  };

  const countWorld = () => ({
    bodies: backend.world.bodies.len(),
    colliders: backend.world.colliders.len(),
    joints: backend.world.impulseJoints.len(),
  });

  const NO_ORPHANS = { rigidBodies: 0, colliders: 0, joints: 0 };

  it('takes nothing, and refuses a restore, without a world', () => {
    const snapshot = engAPI.takeSnapshot()!;
    engAPI.deleteWorld();
    expect(engAPI.takeSnapshot()).toBeUndefined();
    expect(() => engAPI.restoreSnapshot(snapshot)).toThrow(/no world/);
  });

  it('refuses a snapshot of another world (D5)', () => {
    createFallingBall();
    const snapshot = engAPI.takeSnapshot()!;
    engAPI.deleteWorld();
    engAPI.createWorld({ x: 0, y: -9.81, z: 0 });
    const { body } = createFallingBall();
    expect(() => engAPI.restoreSnapshot(snapshot)).toThrow(/another world/);
    expect(engAPI.getRigidBodyAPIWithId(body.id)).toBe(body);
  });

  it('restores into a new Rapier world, keeps every API object and frees the replaced world', () => {
    const { body, collider } = createFallingBall();
    const snapshot = engAPI.takeSnapshot()!;
    stepTimes(30);
    const replaced = backend.world;
    const free = vi.spyOn(replaced, 'free');
    const result = engAPI.restoreSnapshot(snapshot);
    expect(result.world).toBe(world);
    expect(backend.world).not.toBe(replaced);
    expect(free).toHaveBeenCalledOnce();
    expect(world.restoringWorld).toBe(false);
    expect(result).toMatchObject({
      reapedRigidBodyIds: [],
      reapedColliderIds: [],
      reapedJointIds: [],
      orphanCounts: NO_ORPHANS,
    });
    // The same proxies, now on the restored world's objects
    expect(engAPI.getRigidBodyAPIWithId(body.id)).toBe(body);
    expect(engAPI.getColliderAPIWithId(collider.id)).toBe(collider);
    expect(body.pos.y).toBe(10);
    expect(collider.translationSync().y).toBe(10);
    // The world's own methods go through the one implementation
    expect(world.restoreSnapshotSync(snapshot).world).toBe(world);
  });

  it('restores the same snapshot twice to the same state', () => {
    const { body } = createFallingBall();
    const snapshot = engAPI.takeSnapshot()!;
    stepTimes(30);
    engAPI.restoreSnapshot(snapshot);
    expect(body.pos.y).toBe(10);
    stepTimes(30);
    const afterFirst = body.pos.y;
    engAPI.restoreSnapshot(snapshot);
    expect(body.pos.y).toBe(10);
    stepTimes(30);
    expect(body.pos.y).toBe(afterFirst);
    expect(afterFirst).toBeLessThan(10);
  });

  it("throws on bytes Rapier can't read, and keeps the world as it was", () => {
    const { body } = createFallingBall();
    const snapshot = engAPI.takeSnapshot()!;
    const current = backend.world;
    // Rapier's World.fromRaw returns null for bytes it can't deserialize
    vi.spyOn(RAPIER.World, 'restoreSnapshot').mockReturnValueOnce(null as unknown as Rapier.World);
    expect(() => engAPI.restoreSnapshot(snapshot)).toThrow(/could not read/);
    expect(backend.world).toBe(current);
    expect(world.restoringWorld).toBe(false);
    engAPI.step();
    expect(body.pos.y).toBeLessThan(10);
  });

  it('carries the step count and the world settings in the snapshot', () => {
    stepTimes(10);
    const snapshot = engAPI.takeSnapshot()!;
    expect(snapshot.step).toBe(10);
    stepTimes(5);
    world.setGravity({ x: 0, y: -1, z: 0 });
    const result = engAPI.restoreSnapshot(snapshot);
    expect(result.step).toBe(10);
    expect(backend.stepCount).toBe(10);
    expect(result.gravity.y).toBeCloseTo(-9.81, 5);
    expect(world.getGravitySync().y).toBeCloseTo(-9.81, 5);
    expect(result.timestep).toBeCloseTo(1 / 60, 7);
    expect(result).toMatchObject({ solverIterations: 4, internalPgsIterations: 1 });
  });

  it('reaps the bodies, colliders and joints made after the snapshot', () => {
    const { body: anchor } = createFallingBall(-50);
    const snapshot = engAPI.takeSnapshot()!;
    const before = countWorld();
    const { body: late, collider: lateCollider } = createFallingBall(-60);
    const extraCollider = engAPI.createCollider({ type: 'BALL', radius: 0.2 }, anchor.id);
    const joint = engAPI.createJoint({
      type: 'ROPE',
      body1Id: anchor.id,
      body2Id: late.id,
      length: 20,
      anchor1: { x: 0, y: 0, z: 0 },
      anchor2: { x: 0, y: 0, z: 0 },
    });
    const result = engAPI.restoreSnapshot(snapshot);
    expect(result.reapedRigidBodyIds).toEqual([late.id]);
    expect(result.reapedColliderIds.sort()).toEqual([lateCollider.id, extraCollider.id].sort());
    expect(result.reapedJointIds).toEqual([joint.id]);
    expect(result.orphanCounts).toEqual(NO_ORPHANS);
    expect(engAPI.getRigidBodyAPIWithId(late.id)).toBeUndefined();
    expect(engAPI.getColliderAPIWithId(extraCollider.id)).toBeUndefined();
    expect(engAPI.getJointAPIWithId(joint.id)).toBeUndefined();
    expect(countWorld()).toEqual(before);
    // A reaped id's delete is the quiet no-op of an unknown id
    expect(engAPI.deleteRigidBody(late.id)).toEqual({ id: late.id, colliderIds: [], jointIds: [] });
  });

  it('takes out what was deleted since the snapshot, or keeps it with KEEP', () => {
    const { body: kept, collider: keptCollider } = createFallingBall(-50);
    const { body: deleted } = createFallingBall(-60);
    const snapshot = engAPI.takeSnapshot()!;
    const deletedAt = { x: -60, y: 10, z: 0 };
    engAPI.deleteRigidBody(deleted.id);
    const result = engAPI.restoreSnapshot(snapshot);
    expect(result.orphanCounts).toEqual({ rigidBodies: 1, colliders: 1, joints: 0 });
    expect(result.reapedRigidBodyIds).toEqual([]);
    expect(countWorld()).toEqual({ bodies: 1, colliders: 1, joints: 0 });
    expect(engAPI.getRigidBodyAPIWithId(kept.id)).toBe(kept);
    // Rapier's queries see a collider from the first step it's in the world on. Asked of Rapier
    // itself: the world API leaves out a hit on a collider it doesn't know
    engAPI.step();
    const rayDown = (x: number) => new RAPIER.Ray({ x, y: 20, z: 0 }, { x: 0, y: -1, z: 0 });
    expect(backend.world.castRay(rayDown(deletedAt.x), 100, true)).toBeNull();
    // The control: the survivor is hit, so the miss isn't the queries missing everything
    expect(backend.world.castRay(rayDown(-50), 100, true)?.collider.handle).toBe(
      colliders.get(keptCollider.id)
    );

    const kept2 = engAPI.restoreSnapshot(snapshot, { orphanPolicy: 'KEEP' });
    expect(kept2.orphanCounts).toEqual({ rigidBodies: 1, colliders: 1, joints: 0 });
    expect(countWorld()).toEqual({ bodies: 2, colliders: 2, joints: 0 });
    engAPI.step();
    expect(backend.world.castRay(rayDown(deletedAt.x), 100, true)).not.toBeNull();
  });

  it("tells a body made since at a deleted body's index from it (the handle generation)", () => {
    const { body: old } = createFallingBall(-50);
    const snapshot = engAPI.takeSnapshot()!;
    const oldHandle = rigidBodies.get(old.id)!;
    engAPI.deleteRigidBody(old.id);
    const { body: reused } = createFallingBall(-60);
    const reusedHandle = rigidBodies.get(reused.id)!;
    // Rapier's arena reuses the freed index with the next generation
    expect(reusedHandle).not.toBe(oldHandle);
    const result = engAPI.restoreSnapshot(snapshot);
    expect(result.reapedRigidBodyIds).toEqual([reused.id]);
    expect(result.orphanCounts.rigidBodies).toBe(1);
    expect(countWorld().bodies).toBe(0);
  });

  it('rebinds a joint and keeps the Rapier-side user data', () => {
    const { body: a } = createFallingBall(-50, { lockRotations: { x: true, y: false, z: true } });
    const { body: b } = createFallingBall(-52);
    const joint = engAPI.createJoint({
      type: 'ROPE',
      body1Id: a.id,
      body2Id: b.id,
      length: 4,
      anchor1: { x: 0, y: 0, z: 0 },
      anchor2: { x: 0, y: 0, z: 0 },
    });
    const snapshot = engAPI.takeSnapshot()!;
    stepTimes(10);
    const result = engAPI.restoreSnapshot(snapshot);
    expect(result.reapedJointIds).toEqual([]);
    expect(engAPI.getJointAPIWithId(joint.id)).toBe(joint);
    expect(joint.body1IdSync()).toBe(a.id);
    expect(joint.isValidSync()).toBe(true);
    const restoredA = backend.world.getRigidBody(rigidBodies.get(a.id)!);
    expect(restoredA.userData).toMatchObject({ lockRotationsX: true, lockRotationsZ: true });
  });

  it('leaves a body detached since the snapshot detached, and an orphan in the restored world', () => {
    const { body } = createFallingBall(-50);
    const snapshot = engAPI.takeSnapshot()!;
    engAPI.detachRigidBody(body.id);
    const result = engAPI.restoreSnapshot(snapshot);
    expect(result.orphanCounts).toEqual({ rigidBodies: 1, colliders: 1, joints: 0 });
    expect(countWorld().bodies).toBe(0);
    engAPI.reattachRigidBody(body.id, { bodyType: RigidBodyTypeAPI.Dynamic, enabled: true });
    expect(countWorld().bodies).toBe(1);
    expect(body.pos.y).toBe(10);
  });

  it('replays the same steps the same, bit for bit, after a restore (D16)', () => {
    // A small pile falling onto a ground and onto itself
    engAPI.createCollider({
      type: 'CUBOID',
      hx: 10,
      hy: 0.5,
      hz: 10,
      translation: { x: 0, y: -1, z: 0 },
    });
    const bodies: ReturnType<typeof createFallingBall>['body'][] = [];
    for (let i = 0; i < 12; i++) {
      bodies.push(
        createFallingBall((i % 3) * 0.6, {
          translation: { x: (i % 3) * 0.6, y: 1 + i * 0.9, z: (i % 2) * 0.3 },
          angvel: { x: i * 0.1, y: 0, z: 0 },
        }).body
      );
    }
    stepTimes(20);
    const snapshot = engAPI.takeSnapshot()!;
    const readPoses = () => {
      const out = new Float32Array(bodies.length * 7);
      bodies.forEach((b, i) => b.readPoseInto(out, i * 7));
      return out;
    };
    stepTimes(120);
    const first = readPoses();
    engAPI.restoreSnapshot(snapshot);
    stepTimes(120);
    expect(readPoses()).toEqual(first);
  });
});
