import { beforeAll, describe, expect, it } from 'vitest';
import type { LoopState } from '../../../../kernel/loop/MainLoop';
import type { PhysicsDownProtocol } from '../../protocol/PhysicsDownProtocol';
import { PhysicsProtocolType } from '../../protocol/PhysicsProtocolType';
import type { PhysicsUpProtocol } from '../../protocol/PhysicsUpProtocol';
import type { EngineAPIType } from '../../types/PhysicsBackendTypes';
import type { PhysicsState } from '../../types/PhysicsConfigTypes';
import type { WorldAPI } from '../../types/PhysicsWorldTypes';
import { initPhysicsEngine } from '../../PhysicsUtils';
import { physicsSwitchWorld } from '../../worker/PhysicsSwitchWorld';

// The Rapier backend in Node: the compat build carries its WASM inline, so no GPU or DOM is needed.

let engAPI: EngineAPIType;
let world: WorldAPI;
/** The module's first collider: ids start at 0 and are never reused. */
let groundId: number;

beforeAll(async () => {
  ({ engineAPI: engAPI } = await initPhysicsEngine('RAPIER'));
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
});
