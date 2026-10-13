## Installing it

List [`character()`](api:character), from `aekasha/character`, in `InitEngine`'s `features`,
after [`physics()`](api:physics): `features: [physics(), character(), …]`{ts}. `InitEngine`
fails at boot, naming both, when `physics()` isn't listed before it.

## A character

[`createDynamicCharacter`](api:createDynamicCharacter) turns a visual (a mesh or a group) into a
character. The [character example](hub:examples/character) makes its player like this:

<<< src/app/examples/character/exampleCharacter.ts#dynamic-character

- `brain` decides what it wants to do: here a player brain reading an action map's bindings. The
  brain is the character's, and it's deleted with it.
- `config` tunes it ([`DynamicCharacterConfig`](api:DynamicCharacterConfig)): its size, speeds,
  jump and slope limits, over the defaults (`config: { maxVelocity: 5 }`{ts}).
- `body` is its body plan: the colliders and how they're sized. The humanoid capsule is the
  default (`HUMANOID_CAPSULE`), with a crouching collider and the sensors the controller reads.
- It resolves with the character, its controller and its intent. The controller's `state` is what
  its tick writes every step (position, velocities, `locomotionState`, `isGrounded`…), its
  `config.values` the live configuration, and its `internal` the tick's memory. Deleting the character's entity,
  any way, deletes the character.

## Player brains

A player brain owns an action map (`<characterId>:input`) built from its `bindings`, and writes
the character's intent from it once per physics step. The engine registers three:

| Brain             | Its movement actions                                                                       |
| ----------------- | ------------------------------------------------------------------------------------------ |
| `TANK`            | `turn` left and right, and `forward` along the facing.                                     |
| `WORLD_FIXED`     | `move` north, south, west and east (8 directions with diagonals); it turns toward its move. |
| `CAMERA_RELATIVE` | Like `WORLD_FIXED`, with up along the camera's view on the ground.                         |

Every player brain also has `jump`, `run` and `crouch`. `runMode` and `crouchMode` choose whether
their bindings toggle or must be held. Bindings can be keys, a gamepad's sticks and buttons, or
both: the app's gym gives its `TANK` player both. With `turnToLastMoveDirection`, the two
directional brains keep turning the character in place, after the move stops, until it faces the
last direction it moved in.

[`setCharacterBrain`](api:setCharacterBrain) switches a character's brain at runtime (a
cutscene, a possession), or takes it away with `null`. Your own kinds, an AI or a scripted
behaviour, are registered with [`registerBrainKind`](api:registerBrainKind): the gym's dummy is
one, `GYM_DUMMY`.

## Driving it from code

The controller moves the character only by its intent, read once per physics step. A brain
writes it; so can code without a brain, from an `APP_PHYSICS_STEP` system:

```ts
const { intent } = await createDynamicCharacter({ id: 'guard', visual: guardMesh });

world.addSystem(ECSSystemStage.APP_PHYSICS_STEP, 'guardBrain', () => {
  intent.moveForward = 1; // A move and a turn last one step: write them every step
  intent.turn = 0.5; // -1..1, positive turns left
  if (shouldJump) intent.jump = true;
});
```

`moveX` / `moveZ` move in world directions, `moveForward` and `turn` relative to the facing,
`faceYaw` turns it to face a direction, and `run` and `crouch` stay set until you change them.

## Its state

The controller reports what the character is doing as a locomotion state: `IDLE`, `WALK`,
`RUN`, `CROUCH`, `CROUCH_WALK`, `JUMP`, `FALL`, `SLIDE`, `TUMBLE` or `GET_UP`, for animations
and sounds. Listen with `onLocomotionStateChange` (an option of `createDynamicCharacter`) or
[`onLocomotionStateChange`](api:onLocomotionStateChange) by id.

[`setControlMode`](api:setControlMode) with `PHYSICS_ONLY` hands the body to physics, for a
ragdoll or a knock-back, and `CONTROLLED` takes it back.

## Debugging characters

The drawer's Characters tab lists them. A character's state window shows its live data, grouped
and formatted, with freeze and copy. Its configuration can be edited live, with undo, and is kept
over reloads per scene. Its gizmos draw what the controller decides from (velocity, facing, the
ground normal, the floor ray, the wall cast, a trail), and can be pinned to stay after the window
closes.

::: warning Deterministic on MAIN_THREAD only
Characters count fixed physics steps, draw their random numbers from a seeded stream and cast
their probes synchronously, so on `MAIN_THREAD` a scene with characters simulates the same way on
every visit (see [Physics](hub:features/physics#deterministic-scene-loads)). In `WORKER_THREAD`
mode they still tick on the main thread against the worker's last snapshot and asynchronous
casts, so they don't yet.
:::

Besides the [example](hub:examples/character), the app's `thirdPersonGymScene` (an obstacle
course with moving platforms, two players and a character driven by a brain of its own) and
`topDownTestScene` (a `WORLD_FIXED` player among hills and props) are the ones to try: open them
with `?isDebug=true&startScene=<id>`.

## Key APIs

- [`createDynamicCharacter`](api:createDynamicCharacter) and
  [`deleteCharacter`](api:deleteCharacter).
- [`getCharacterById`](api:getCharacterById) and [`getCharacters`](api:getCharacters).
- [`setControlMode`](api:setControlMode) and
  [`onLocomotionStateChange`](api:onLocomotionStateChange).
- [`setCharacterBrain`](api:setCharacterBrain) and [`registerBrainKind`](api:registerBrainKind).
- [`createCharacter`](api:createCharacter): the base a controller builds on, for writing your own.

## Read more

- [Physics](hub:features/physics), which characters are built on.
- The API reference: [Character](hub:documentation/engine/features/character/Character).
