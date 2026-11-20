**Title:** `addComponent` stores a component on a deleted entity, where it stays until the slot is reused

Status: open | for the ECS's next review
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
