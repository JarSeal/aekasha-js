## The shapes

Each kind of shape is a geometry, a material and a collider of the same size:

<<< src/app/examples/physics/examplePhysics.ts#physics-shapes

The ids register each geometry and material the first time, so every box shares one geometry
and one material, however many you drop. Sizes are where three.js and Rapier differ: a capsule's
`height` in three.js is its straight part, and Rapier's `halfHeight` is half of that. A Rapier
cylinder's `halfHeight` is half of the whole height.

## Dropping one

<<< src/app/examples/physics/examplePhysics.ts#physics-drop

[`createMeshEntity`](api:createMeshEntity) makes the entity, and
[`createPhysicsEntity`](api:createPhysicsEntity) attaches a `DYNAMIC` body and its collider to
it (the entity id is its last argument). The body starts at `translation` with `rotation`, and
from then on the simulation moves the entity's transform, and the transform moves the mesh.

## The scene

<<< src/app/examples/physics/examplePhysics.ts#physics-scene

- The ground is a mesh with a `FIXED` body: other bodies collide with it, and nothing moves it.
- The first four drops are the same on every visit. A scene's physics starts from a fresh world
  and waits for every `createPhysicsEntity` call of the load before it steps, so a scene
  simulates the same way every time it loads.
- [`createActionMap`](api:createActionMap) makes the scene's actions: here one `BUTTON`, `drop`,
  bound to Space and to a gamepad's bottom button (A, or ✕). With a `sceneId` the map is active in
  that scene only, and a map with an id already taken replaces the old one, so the next visit's
  map takes over. `onPressed` runs at the press itself, the right place for a one-off like this
  drop. Code that must step in lockstep with the simulation reads the action at the step instead
  (`actions.read('drop').pressedCount` in an `APP_PHYSICS_STEP` system), as the
  [characters](hub:features/characters)' brains do. The action's `name` shows in the debug key
  shortcuts dialog (`u`). [Input](hub:features/input) has the rest: bindings, contexts, the
  gamepad.
- [`getRandomStream`](api:getRandomStream) gives a named, seeded random stream that starts over
  on every load, so the drops come in the same order on every visit.
- Deleting an entity ([`deleteEntity`](api:ECSWorld.deleteEntity)) removes its body and
  colliders too.
- `createExampleHud` (`src/app/examples/exampleHud.ts`) is the examples' own HUD line: a
  `div` in the HUD, removed when the scene exits.

Back to the [examples](hub:examples).
