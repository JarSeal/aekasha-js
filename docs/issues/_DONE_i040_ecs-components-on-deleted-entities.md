**Title:** `addComponent` stores a component on a deleted entity, where it stays until the slot is reused

Status: fixed | 2026-11-21, `addComponent` and `commitTransform` ignore a dead id (a warning in the debug env), and `createCharacter` rejects when its visual's entity goes during the create
Category: ECS
Found: 2026-10-17, p614 Phase 1 (E1: a physics entity deleted while its `WORKER_THREAD` create was in flight got its components back)
Our workaround: code that keeps an entity id across an `await` checks `world.isAlive(id)` before writing to it (p600's async rule; `createPhysicsEntity` does since p614)

## What happens

`ECSWorld.addComponent` (`kernel/ecs/ECS.ts`) writes into the type's storage without checking the
entity: after `deleteEntity(id)`, `addComponent(id, …)` stores the data, runs the type's
`onAddComponent` hooks, and `hasComponent(id, type)` is `true` again, for an id `isAlive(id)` calls
dead. `deleteEntity` cleared the entity's storages when it ran, and nothing clears them again, so
the data stays (with whatever it holds: an `Object3D`, a body proxy) until the slot's next entity
is deleted, and an `onDeleteEntity` hook never runs for it.

The generation in the id keeps the slot's next entity apart (its id differs), so nothing reads the
stale data by accident; the cost is the leak and the hooks that ran for a dead entity.

## Reproduce

```ts
const world = new ECSWorld({ id: 'repro' });
const id = world.createEntity();
world.deleteEntity(id);
world.addComponent(id, ComponentType.USER_DATA, {});
world.isAlive(id); // false
world.hasComponent(id, ComponentType.USER_DATA); // true
```

## Options

- `addComponent` ignores a dead id (a debug-env warning naming the type), as `removeComponent`
  already is a no-op for a component the entity doesn't have. One `isAlive` check per add: a
  `generations` read and a `Set` lookup.
- Or it throws in the debug env only, to find the callers, and ignores in production.

Either changes behaviour for code that writes after a delete today, so it goes with the ECS's next
review (with a scan of the template's callers), not with p614.

## The fix

The first way out, for `commitTransform` too.

- **Worse than it said:** in `TYPED_ARRAY` storage the stale data wasn't apart from the slot's next
  entity. `TypedArrayTransformStore` keys its sparse array by the slot's index, so a stale id's
  `TRANSFORM` write (`addComponent` or `commitTransform`) after the slot was reused took the new
  entity's sparse entry: the live entity's `TRANSFORM` read `undefined`, and its delete then leaked
  its dense slot. `MAP` storage only leaked.
- **`ECSWorld.addComponent`** checks `isAlive` first: a dead id (or one the world never made)
  stores nothing and runs no `onAddComponent` hook. **`commitTransform`** does the same. Both warn
  in the debug env (`_warnDeadWrite`: the world, the entity and the type), so a caller that keeps
  an id across an `await` shows up. An `onDeleteEntity` hook can still add to the entity being
  deleted (it's alive while its hooks run, and the delete clears it after).
- **The callers** (every `addComponent` and `commitTransform` after an `await`, in a `.then` or a
  listener): `createPhysicsEntity`, `createInstanceSetAsync`, `setMeshLod`'s `AUTO` path and the
  streaming primer's `hold` check `isAlive`; the physics tiers' and merge builds' callbacks check
  their own component, gone with the entity; scene and debug code writes to entities alive at the
  time. One wasn't: **`createCharacter`** added `CHARACTER` after `await createPhysicsEntity`
  without a check, so a visual deleted during a `WORKER_THREAD` create kept a character no delete
  hook would clean up (its brain's action map leaked), and `createDynamicCharacter` then threw from
  `attachBody`, outside the `try` that disposes the brain. It now rejects, naming the visual, and
  `createDynamicCharacter` disposes the brain. `createPhysicsEntity`'s own check stays: it deletes
  what the create made.
- `yarn verify:scenes --config quick` (52 runs, WebGPU): the warning fired in none.
- Tests: `kernel/ecs/ECS.test.ts` ("writes to a deleted entity": the repro, a never-made id, a
  delete hook's add, both storage modes' stale `TRANSFORM` writes, the debug warning) and
  `features/character/Character.test.ts` (the visual deleted during the create, with and without
  `createDynamicCharacter`'s brain).
