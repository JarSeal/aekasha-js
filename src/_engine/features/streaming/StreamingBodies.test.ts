import { afterEach, describe, expect, test, vi } from 'vitest';
import { ECSWorld } from '../../kernel/ecs/ECS';
import { ComponentType } from '../../kernel/ecs/ECSCoreComponents';
import {
  type PhysicsCreationScope,
  type PhysicsTierWant,
  getPhysicsCreationScope,
  setPhysicsTierAccess,
} from '../../kernel/ecs/PhysicsTierAccess';
import { packCellKey } from '../../utils/CellKey';
import * as Logger from '../../utils/Logger';
import { createStreamingBodies } from './StreamingBodies';
import {
  type StreamingRuntime,
  createStreamingRuntime,
  decideStreamingCells,
  pumpStreamingCells,
} from './StreamingCells';
import { addStreamingCellContent, clearSceneStreamingContent } from './StreamingContent';
import type { SceneStreamingSettings } from './StreamingSchema';
import { resolveStreamingSettings } from './StreamingSettings';

const WORLD_ID = 'streaming-bodies-test';

afterEach(() => {
  ECSWorld.deleteWorld(WORLD_ID);
});

describe('createStreamingBodies', () => {
  test('a dynamic body, whatever its tier, moves; anything else stays', () => {
    const world = new ECSWorld({ id: WORLD_ID, applyGlobalPlugins: false });
    const bodies = createStreamingBodies();
    const at = { x: NaN, z: NaN };
    const entityAt = (x: number, z: number) => {
      const id = world.createEntity();
      world.getPosition(id)!.set(x, 7, z);
      return id;
    };
    // The data isn't read: the component keys are what counts
    const body = {} as never;

    const dynamicId = entityAt(10, -20);
    world.addComponent(dynamicId, ComponentType.BODY_DYNAMIC_VISUAL, body);
    expect(bodies.locateMover(world, dynamicId, at)).toBe(true);
    expect(at).toEqual({ x: 10, z: -20 });

    const headlessId = entityAt(1, 2);
    world.addComponent(headlessId, ComponentType.BODY_DYNAMIC_HEADLESS, body);
    expect(bodies.locateMover(world, headlessId, at)).toBe(true);

    // A STATIC or DISABLED tier (in BODY_STATIC), or REMOVED (in no bucket)
    const tieredId = entityAt(3, 4);
    world.addComponent(tieredId, ComponentType.PHYSICS_SIM_TIER, body);
    expect(bodies.locateMover(world, tieredId, at)).toBe(true);
    expect(at).toEqual({ x: 3, z: 4 });

    const fixedId = entityAt(5, 6);
    world.addComponent(fixedId, ComponentType.BODY_STATIC, body);
    expect(bodies.locateMover(world, fixedId, at)).toBe(false);
    expect(bodies.locateMover(world, entityAt(0, 0), at)).toBe(false);

    world.deleteEntity(dynamicId);
    expect(bodies.locateMover(world, dynamicId, at)).toBe(false);
  });
});

describe("the cells' physics tiers (p353 Phase 4 D2-D8)", () => {
  // Rings 1 / 2 on 64 m cells: from (32, 32), cell (2, 0) is NEARBY; from (96, 32) RESIDENT, and
  // back at (32, 32) NEARBY again (96 m from its edge, over ring 1's 80 m)
  const NEAR = packCellKey(2, 0, 0);
  const HOME = packCellKey(0, 0, 0);
  let seq = 0;
  const sceneIds: string[] = [];

  afterEach(() => {
    setPhysicsTierAccess(null);
    for (const id of sceneIds.splice(0)) clearSceneStreamingContent(id);
    vi.restoreAllMocks();
  });

  /** A machine on the real bodies, and a tier access that records what it's asked */
  const setup = (settings: Partial<SceneStreamingSettings> = {}, withAccess = true) => {
    const sceneId = `streaming-bodies-tiers-${seq++}`;
    sceneIds.push(sceneId);
    const world = new ECSWorld({ id: WORLD_ID, applyGlobalPlugins: false });
    const rt = createStreamingRuntime(
      sceneId,
      resolveStreamingSettings({ cellSize: 64, ...settings }),
      world,
      () => 0,
      () => 0
    );
    rt.bodies = createStreamingBodies(rt.settings.nearbyPhysicsTier);
    const tiers = new Map<number, PhysicsTierWant>();
    const memberships: [number, boolean][] = [];
    if (withAccess) {
      setPhysicsTierAccess({
        requestTiers: (w, entityIds, wantOf) => {
          for (const id of entityIds) {
            const want = wantOf(id);
            if (want === null) continue;
            tiers.set(id, want);
            // What a request leaves once applied (the policy's own requests aren't modelled)
            if (want !== 'POLICY') {
              w.addComponent(id, ComponentType.PHYSICS_SIM_TIER, {
                tier: want,
                target: want,
              } as never);
            }
          }
        },
        setPolicyMember: (w, entityId, member) => {
          memberships.push([entityId, member]);
          if (member) {
            w.addComponent(entityId, ComponentType.PHYSICS_TIER_POLICY, {
              refusedTier: null,
              placed: false,
            });
          } else {
            w.removeComponent(entityId, ComponentType.PHYSICS_TIER_POLICY);
          }
          return true;
        },
        isJointed: () => false,
      });
    }
    const budgets = { maxConcurrentLoads: 100, maxCreateMsPerFrame: 1000 };
    const goTo = (x: number) => {
      decideStreamingCells(rt, x, 32);
      pumpStreamingCells(rt, budgets);
    };
    return { rt, world, tiers, memberships, goTo };
  };

  /** A unit making a dynamic body (a policy member with `isMember`) and a static entity, noting
   * the creation scope its load ran in; returns the list its loads put the bodies in */
  const bodyUnit = (
    rt: StreamingRuntime,
    cellKey: number,
    opts: { isMember?: boolean; scopes?: (PhysicsCreationScope | null)[] } = {}
  ) => {
    const ids: number[] = [];
    addStreamingCellContent({
      sceneId: rt.sceneId,
      cellKey,
      load: ({ world, cx, cz, cellSize }) => {
        const scope = getPhysicsCreationScope();
        opts.scopes?.push(scope);
        const bodyId = world.createEntity();
        // In its own cell: a body goes to the cell it's in on every decision
        world.getPosition(bodyId)!.set((cx + 0.5) * cellSize, 0, (cz + 0.5) * cellSize);
        world.addComponent(bodyId, ComponentType.BODY_DYNAMIC_HEADLESS, {} as never);
        // What createPhysicsEntity does with `tierPolicy`: joins, or reports to a holding scope
        if (opts.isMember && scope?.holdPolicyMember) scope.holdPolicyMember(world, bodyId);
        else if (opts.isMember) {
          world.addComponent(bodyId, ComponentType.PHYSICS_TIER_POLICY, {
            refusedTier: null,
            placed: false,
          });
        }
        ids.push(bodyId);
        return [bodyId, world.createEntity()];
      },
    });
    return ids;
  };

  test("a body gets its cell's tier, by the creation scope and by a request, and follows the level", () => {
    const { rt, tiers, goTo } = setup();
    const scopes: (PhysicsCreationScope | null)[] = [];
    const homeIds = bodyUnit(rt, HOME, { scopes });
    const nearIds = bodyUnit(rt, NEAR, { scopes });
    goTo(32);
    const [home, near] = [homeIds[0], nearIds[0]];
    expect(scopes.map((scope) => scope?.tier)).toEqual(['FULL', 'STATIC']);
    expect(scopes[0]?.holdPolicyMember).toBeNull();
    expect(tiers.get(home)).toBe('FULL');
    expect(tiers.get(near)).toBe('STATIC');

    goTo(96);
    expect(tiers.get(near)).toBe('FULL');
    goTo(32);
    expect(tiers.get(near)).toBe('STATIC');
    expect(rt.bodies?.summarize?.(rt.world)).toEqual({
      bodies: 2,
      heldOutOfPolicy: 0,
      byTier: { FULL: 1, STATIC: 1 },
      offTier: 0,
    });
    // A tier no request asked for (eg. another caller's): off its cell's
    rt.world.addComponent(near, ComponentType.PHYSICS_SIM_TIER, {
      tier: 'FULL',
      target: 'FULL',
    } as never);
    expect(rt.bodies?.summarize?.(rt.world).offTier).toBe(1);
  });

  test("a body pushed into another cell takes that cell's tier at the next decision", () => {
    // Made by the home cell, pushed into cell (2, 0); from (160, 32) the home cell is NEARBY and
    // cell (2, 0) RESIDENT: the body is FULL (the cell it's in), not the home cell's STATIC
    const { rt, world, tiers, goTo } = setup();
    const ids = bodyUnit(rt, HOME);
    goTo(32);
    const [bodyId] = ids;
    world.getPosition(bodyId)!.set(160, 0, 32);
    goTo(160);
    expect(rt.cells.get(NEAR)?.adopted).toEqual([bodyId]);
    expect(rt.cells.get(HOME)?.level).not.toBe(rt.cells.get(NEAR)?.level);
    expect(tiers.get(bodyId)).toBe('FULL');
    expect(rt.stats.bodiesAdopted).toBe(1);
    expect(rt.bodies?.summarize?.(rt.world).offTier).toBe(0);
  });

  test("the scene's nearbyPhysicsTier is a NEARBY cell's", () => {
    const { rt, tiers, goTo } = setup({ nearbyPhysicsTier: 'DISABLED' });
    const scopes: (PhysicsCreationScope | null)[] = [];
    const nearIds = bodyUnit(rt, NEAR, { scopes });
    goTo(32);
    const [near] = nearIds;
    expect(scopes[0]?.tier).toBe('DISABLED');
    expect(tiers.get(near)).toBe('DISABLED');
  });

  test('a policy member is out of the policy while its cell is NEARBY, and in while RESIDENT', () => {
    const { rt, world, tiers, memberships, goTo } = setup();
    const homeIds = bodyUnit(rt, HOME, { isMember: true });
    const nearIds = bodyUnit(rt, NEAR, { isMember: true });
    goTo(32);
    const [home, near] = [homeIds[0], nearIds[0]];
    // Created into a NEARBY cell: held out by its scope, never a member
    expect(world.hasComponent(near, ComponentType.PHYSICS_TIER_POLICY)).toBe(false);
    expect(tiers.get(near)).toBe('STATIC');
    expect(tiers.get(home)).toBe('POLICY');
    expect(rt.bodies?.summarize?.(rt.world)).toMatchObject({ bodies: 2, heldOutOfPolicy: 1 });

    goTo(96);
    expect(memberships).toEqual([[near, true]]);
    expect(tiers.get(near)).toBe('POLICY');
    // Far enough that the home cell is NEARBY
    goTo(160);
    expect(memberships).toEqual([
      [near, true],
      [home, false],
    ]);
    expect(world.hasComponent(home, ComponentType.PHYSICS_TIER_POLICY)).toBe(false);
    expect(tiers.get(home)).toBe('STATIC');
  });

  test("a body handed to another cell takes that cell's tier", () => {
    const { rt, world, tiers, goTo } = setup();
    // Cell (-2, 0) is NEARBY from (32, 32) and unloads from (96, 32); (-1, 0) is RESIDENT, then
    // NEARBY
    const ids = bodyUnit(rt, packCellKey(-2, 0, 0));
    goTo(32);
    const [bodyId] = ids;
    expect(tiers.get(bodyId)).toBe('STATIC');
    world.getPosition(bodyId)!.set(-32, 0, 32);
    // Rolled into (-1, 0), which is RESIDENT
    goTo(32);
    goTo(96);
    expect(rt.cells.get(packCellKey(-1, 0, 0))?.adopted).toEqual([bodyId]);
    expect(tiers.get(bodyId)).toBe('STATIC');
    goTo(32);
    expect(tiers.get(bodyId)).toBe('FULL');
  });

  test('without physicsTiers(): no scope, no request, one warning', () => {
    const warn = vi.spyOn(Logger, 'lwarn').mockImplementation(() => {});
    const { rt, goTo } = setup({}, false);
    const scopes: (PhysicsCreationScope | null)[] = [];
    bodyUnit(rt, NEAR, { scopes });
    bodyUnit(rt, packCellKey(-2, 0, 0), { scopes });
    goTo(32);
    expect(scopes).toEqual([null, null]);
    expect(warn.mock.calls.filter(([m]) => String(m).includes('physicsTiers()'))).toHaveLength(1);
  });
});
