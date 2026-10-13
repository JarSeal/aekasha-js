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

A player brain owns an [action map](hub:features/input) (`<characterId>:input`) built from its
`bindings`, and writes the character's intent from it once per physics step. The engine registers
three:

| Brain             | Its movement actions                                                                        |
| ----------------- | ------------------------------------------------------------------------------------------- |
| `TANK`            | `turn` left and right, and `forward` along the facing.                                      |
| `WORLD_FIXED`     | `move` north, south, west and east (8 directions with diagonals); it turns toward its move. |
| `CAMERA_RELATIVE` | Like `WORLD_FIXED`, with up along the camera's view on the ground.                          |

Every player brain also has `jump`, `run` and `crouch`. `runMode` and `crouchMode` choose whether
their bindings toggle or must be held. Bindings can be keys, a gamepad's sticks and buttons, or
both: the app's gym gives its `TANK` player both. The map is in the `GAMEPLAY` context, so the
character stands still while the debug camera is on or an editor view is open, and a settings
screen rebinds it through [`getActionMap`](api:getActionMap)`('player:input')`. With
`turnToLastMoveDirection`, the two directional brains keep turning the character in place, after
the move stops, until it faces the last direction it moved in.

[`setCharacterBrain`](api:setCharacterBrain) switches a character's brain at runtime (a
cutscene, a possession, a disconnected player handed to an AI), or takes it away with `null`.

## Your own brain

A brain is whatever decides what the character wants: an AI, a script, a network peer. Add its
kind to `CharacterBrainKinds` with its params, then register its factory with
[`registerBrainKind`](api:registerBrainKind) from a feature's install (the app's is
`AppECSPlugins.ts`):

```ts
import { registerBrainKind } from 'aekasha/character';

declare module 'aekasha/character' {
  interface CharacterBrainKinds {
    HOPPER: { everySteps?: number };
  }
}

registerBrainKind('HOPPER', (params) => ({
  kind: 'HOPPER',
  think: (intent, step) => {
    intent.moveForward += 1; // A move lasts one step: write it every step
    if (step % (params.everySteps ?? 60) === 0) intent.jump = true;
  },
}));
```

Then `brain: { kind: 'HOPPER', params: { everySteps: 30 } }`{ts} gives it to a character. A
brain is plain data, `{ kind, params }`, so a save or a network message can rebuild it.

- `think(intent, step, dt)` runs once per physics step. It writes the intent and never touches the
  body.
- Count time in steps (`step`, and `dt` to turn milliseconds into steps), not with the clock, and
  draw random numbers from [`getRandomStream`](api:getRandomStream): the brain then decides the
  same way on every visit.
- Add to the moves and the turn rather than overwrite them: code may write the same intent.
- `dispose` runs when the brain is switched out or its character is deleted (a player brain
  deletes its action map there).

The app's gym has one, `GYM_DUMMY` (`thirdPersonGymScene/GymDummyBrain.ts`): every second it
jumps and switches between walking forward and turning, counted in steps.

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

## Controllers

The controller moves the body. Each physics step runs, in this order: your `APP_PHYSICS_STEP`
systems (order 0 by default), every character's brain (order -5), then every character's
controller (order -10). So what code writes to an intent in its step applies in that step, and a
brain sees it.

A controller ([`ActorController`](api:ActorController)) has a `kind` and a
`tick(dt, intent, step)`, run once per physics step with the step index as its clock: it reads
the intent, moves the body and clears the intent's per-step fields. **Only the tick writes the
body.** Collision callbacks and sensors record what happened, and the next tick applies it, so a
step's outcome doesn't depend on when an event arrives. The dynamic controller
([`DynamicCharacterController`](api:DynamicCharacterController), kind `DYNAMIC_CHARACTER`) is the
engine's. Its `state` is what the tick writes, `config.values` the live configuration (with
`config.onChange` for edits from outside), and `internal` the tick's memory between steps.

Characters can be made from data too:
[`createCharacterOfKind`](api:createCharacterOfKind) takes a controller kind with its params and
a brain spec, and resolves with the character once it exists. That's what rebuilds a character
from a save or a network message. A controller of your own is a kind added to
`CharacterControllerKinds` and registered with
[`registerControllerKind`](api:registerControllerKind): its factory makes the body with
[`createCharacter`](api:createCharacter) and sets the character's `controller`.

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

## Determinism

On `MAIN_THREAD`, a scene with characters simulates the same way on every visit, given the same
input (see [Physics](hub:features/physics#deterministic-scene-loads)):

- The controller's clock is the step index. Its durations stay in milliseconds in the
  configuration (`jumpCooldown: 100`) and are counted as whole steps: 100 ms is 6 steps at 60
  steps a second.
- Its random numbers (a tumble's direction) come from the seeded stream `character:<id>`, which
  every scene load restarts.
- Its floor and wall probes are synchronous casts, used in the step that fires them.
- Player brains read their actions as sampled right before the step, so a key press lands on one
  step whatever the frame rate.

::: warning Not yet in WORKER_THREAD mode
With the worker, the controller still ticks on the main thread against the worker's last
snapshot, and its casts answer a frame or more later. The characters then depend on frame timing.
:::

::: dev-only Recorded input runs
`yarn verify:scenes` plays a scene's input script (`devTools/verify/inputs/<sceneId>.json`:
key events by step) through the test bridge and compares a hash of every character's path with
its baseline, on `MAIN_THREAD`. The gym has one: it walks, runs, crouches, jumps and tumbles both
players through the course.
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
- [`setCharacterBrain`](api:setCharacterBrain) and [`registerBrainKind`](api:registerBrainKind);
  [`ActorBrain`](api:ActorBrain) and [`CharacterIntent`](api:CharacterIntent).
- [`createCharacterOfKind`](api:createCharacterOfKind) and
  [`registerControllerKind`](api:registerControllerKind); [`ActorController`](api:ActorController).
- [`createCharacter`](api:createCharacter): the base a controller builds on, for writing your own.

## Read more

- [Physics](hub:features/physics), which characters are built on.
- [Input](hub:features/input): the action maps the player brains read.
- The API reference: [Character](hub:documentation/engine/features/character/Character).
