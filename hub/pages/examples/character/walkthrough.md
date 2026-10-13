## The level

Plain blocks, each a mesh with a `FIXED` box body of the same size, plus a ramp and stairs:

<<< src/app/examples/character/exampleCharacter.ts#character-level

- [`createPhysicsEntity`](api:createPhysicsEntity) attaches each body to its mesh's entity, as in
  the [physics example](hub:examples/physics). Blocks of one size share a geometry, and blocks of
  one colour a material: their ids carry the size and the colour.
- The ramp is a tilted block. The controller walks up slopes to `maxWalkableAngle` (45° by
  default) and slides down steeper ones.
- The stairs are drawn only. A capsule pushed against a step's edge catches on it, so the body
  walks up one smooth slope under the steps instead: a hidden `FIXED` body through the middle of
  each step.

## The look

<<< src/app/examples/character/exampleCharacter.ts#character-visual

The controller never reads the visual: it moves whatever `Object3D` it gets, here a capsule of
the body's default size (1.6 m tall, 0.5 m radius) with a nose. At a yaw of 0 a character faces
+X, so that's where the nose goes. The nose is made outside the scene
(`doNotAddToScene`) and added to the capsule, so it turns with it.

## The character

<<< src/app/examples/character/exampleCharacter.ts#dynamic-character

- [`createDynamicCharacter`](api:createDynamicCharacter) makes the visual's entity a character,
  with the default body plan and configuration.
- The brain, `WORLD_FIXED` ([`WorldFixedBrainParams`](api:WorldFixedBrainParams)), moves the
  character in world directions: up is North (-Z). It owns an action map,
  `exampleCharacterPlayer:input`, built from `bindings`: `move` has two keyboard bindings, and
  the one pushed furthest wins. The map belongs to the `GAMEPLAY` context, so the keys do nothing
  while the debug camera is on or an editor view is open.
- `runMode: 'HOLD'` runs while Shift is held; crouching keeps the default, `TOGGLE`.
- `turnToLastMoveDirection` keeps the character turning in place after the keys are let go, until
  it faces the direction it last moved in: a tap of a key turns it all the way, and a diagonal
  let go a step or two apart (W first, then D) still ends on the diagonal.
- The character starts where its body is put, with `setTranslation`.

The brain reads the keys once per physics step and writes the character's intent, which the
controller reads next. See the [characters](hub:features/characters#player-brains) feature for
the other brains and for driving a character from code.

## The camera

<<< src/app/examples/character/exampleCharacter.ts#follow-camera

[`createFollowObjectCameraRig`](api:createFollowObjectCameraRig) moves the camera toward the
character plus `offset`, smoothed, once per frame, reading the pose that's drawn. Its system is
registered once for every world, in the app's `AppECSPlugins.ts`.

- `orientation: 'FIXED'` keeps the camera looking along `-offset`: it only moves, so the view
  never swings while the camera catches up. The default, `'LOOK_AT_TARGET'`, aims at the
  character every frame.
- `lookAhead` leads the followed point up to `distance` metres in the character's direction of
  travel, eased in over `smoothingTime` (0.6 s by default). Once the character stands still, the
  lead moves back to it at `returnSpeed` (1 m/s by default).
- The rig isn't an entity, so the scene deletes it on exit; the character goes with the scene.

The scene's `scene` function makes the level, the character and the camera, then the HUD line
(`createExampleHud`, the examples' own).

Back to the [examples](hub:examples).
