Status: in progress | Phases 1-2 implemented (Phase 3 in progress)
Category: Characters, Input, Architecture
Epic: p600_whole-codebase-refactoring-and-documentation.md (Stage B; a minor bump per part, D7)
Blocks: p614_review-physics.md, p617_review-input-ui-hud.md, p512_client-prediction-and-reconciliation.md, p421_kinematic-character-controller.md, p423_vehicles.md, p424_ai-brains-and-navigation.md, p420_npc-simulation-tiers.md
Related: \_DONE_p603_gameplay-architecture-contracts.md (the contracts C1-C5 this plan builds, and the stub plans p421-p427 that build on it), \_DONE_p604_multiplayer-viability-study.md (§4: step-index time, seeded RNG, the simulation reads its own state), p420_npc-simulation-tiers.md, the "Refactor dynamic character code" (p070) and "Key binding refactoring" (p770) prompts in `docs/templates/todo-plan-prompts.txt` (they build on this plan)

# Character and Input Action Architecture

Refactor the character code into p603's contracts (C1-C5) and add the input action layer, so a
second controller, an AI or network brain and new input schemes plug in without touching the
dynamic character. Characters become deterministic on `MAIN_THREAD` (step-index time, the seeded
RNG, synchronous casts), and a recorded input run of the gym proves every later phase keeps their
behaviour. A new Hub example shows a keyboard character with a look-ahead follow camera.

---

## 1. As found (2026-10-13, branch `character-and-input-action-architecture` at `8deb455`, = `main` after p609's merge)

What changed since the stub (and p603's grounding) was written:

- **Paths.** p603 and p600 §2.6 name `core/…` paths. Today: `features/character/` (`Character.ts`
  354 lines, `CharacterTypes.ts`, `CharacterIntent.ts`, `CharacterInputSchemes.ts`,
  `CharacterBodyPlans.ts`, `CharacterFeature.ts`, `DynamicCharacter.ts` 1534 lines with
  `createDynamicCharacter` at 512-1481, `debug/` 3580 lines over six files), `kernel/input/`
  (`KeyboardInput.ts`, `MouseInput.ts`, `TouchInput.ts`, `InputState.ts`, `InputSharedTypes.ts`,
  `GamepadInput.ts`: still a TODO stub imported by nothing) and `debug/DefaultDebugKeyBindings.ts`
  (382 lines, the engine's debug keys; p602 put it in `debug/`, not `kernel/input/`).
- **The gym** is `src/app/scenes/thirdPersonGymScene/thirdPersonGymScene.ts`: a TANK player
  (WASD, Space, Shift, Control) with the follow camera, a CAMERA_RELATIVE player (arrow keys,
  Enter) and the dummy (lines 223-256: an `APP_PHYSICS_STEP` system `dummyCharLooper`, order 0,
  writing the intent from a `dt` accumulator, removed by hand on load and in the exit callback).
  The dummy is already step-deterministic: it counts fixed `dt`s, not the wall clock.
  `ARE_CHARACTERS_ENABLED` is `true`.
- **A second scene has a character:** `topDownTestScene` (WORLD_FIXED, WASD), whose
  `#region dynamic-character` is the characters feature page's include
  (`hub/pages/features/characters/guide.md`). That page has no `::: scene` panel yet. The scene
  isn't in `scenes.config.ts`, so its hash is checked as stable today (the character only idles).
- **The wall clock.** `getPhysGameTime()` (`PhysicsAPI.ts:998`, public on `aekasha/physics`) reads
  `PhysicsWallClock.ts`' `readPhysicsWallClock` (added by p605, allow-listed in the simulation lint;
  its doc says p610 deletes it). Readers: the tick's `now` (`DynamicCharacter.ts:1107`),
  `resolveCastRecord` (`:483`), `startCharacterTumbling` (`:1487`), and two debug modules the stub
  doesn't name: the state window's timestamp ages (`_dbg__CharacterStateWindow.ts:873`) and the
  gizmos' wall-cast hold (`_dbg__CharacterGizmos.ts:597`). `CharacterCastRecord.resolvedAt` is
  documented as a `getPhysGameTime()` value. Every `__…Time` stamp uses 0 as "not set".
- **`Math.random`:** still `DynamicCharacter.ts:1497-1500` only, allow-listed in
  `eslint.config.js` ("p610: the seeded RNG"). The lint message points at
  `toolkit/geometry/SeededRandom.ts` "until the RNG service exists". **No engine RNG exists.**
- **Body writes outside the tick** (p603 C2's list, still accurate): the wall sensor's tumble
  start in the `.then()` of the async `bodyType()` (`:905-918`), the floor sensor's tumble start
  (`:962`) and landing velocity (`:977`).
- **The casts on `MAIN_THREAD` aren't deterministic either:** `castShape` / `castRayAndGetNormal`
  return a promise there too, so the result lands on a microtask after the frame's code, not after
  the step: with two sub-steps in one frame, the second doesn't see the first's result. The sync
  versions (`castShapeSync`, `castRayAndGetNormalSync`) exist on `MAIN_THREAD`.
- **`bodyTypeSync()` throws in `WORKER_THREAD` mode** (`PhysicsAPI.ts:3656`).
- **No input recording.** The test bridge (`debug/_dbg__TestBridge.ts`) has no input methods.
  Today's character reads the wall clock, so a run recorded on today's code doesn't replay the
  same way twice: the "before" of the done criterion can only be recorded once Phase 1's step time
  is in (D2).
- **Versions:** Engine 5.0.2 (Golden Hour), Toolkit 2.0.2 (Half Moon), App 1.10.2 (Preschooler).
  p600 §11 makes p608-p611 minor or patch bumps; the stub's header and p603 C1 still called this
  an engine major (D7 settles it).
- **`FollowObjectCameraRig`** (`toolkit/ecs/gameplay/FollowObjectCameraRig.ts`, 266 lines): the
  camera's position is smoothed toward `target + offset` while `camera.lookAt(targetPos)` aims at
  the target exactly, so the view direction swings while the camera catches up (the "rotation when
  moving west or east"). No look-ahead. The `LERP` and `SMOOTH_DAMP` ticks duplicate each other.

## 2. Decisions (confirmed 2026-10-13)

### D1. Determinism scope: `MAIN_THREAD` (the user's choice "C")

- p610 makes characters deterministic on `MAIN_THREAD` with real frame timing: step-index time
  (D2), the seeded RNG (D3), synchronous casts whose result is used on the next step (a fixed
  one-step lag, the same lag the worker approximates today), and every body write inside the tick.
- In the worker targets, every read p610 can move to step-stamped state moves (the body type, the
  pending events), but the controller still ticks on the main thread against the latched snapshot
  and async casts, so the gym stays in `unstableHash` for `workerSab` and `workerMsg` only, with
  the reason rewritten.
- The rest goes to a new stub, `p428_character-determinism-in-worker-targets.md` (Phase 8): the
  controller in the worker (loaded by its registered kind) or fixed-lag step-stamped reads with
  step gates, decided with p614 (the worker protocol) and p421 (the KCC's in-step sweeps). p512
  points at it.

### D2. Step time

- The controller's clock is the step index (`getPhysicsSubStepIndex()`, passed to the tick as
  `step` from Phase 3). The `_…` configuration stays in milliseconds (the saved debug overrides,
  the docs and the app's `charData` keep working) and is compared against
  `(step - stampStep) * timestepMs`, with the world's fixed timestep. Durations become multiples
  of a step (`_jumpCooldown` 100 ms = 6 steps at 60 Hz).
- The `__…Time` stamps become `__…Step` step indices with `-1` for "not set" (step 0 is a real
  step: 0 can't stay the sentinel).
- `CharacterCastRecord` gains `resolvedAtStep`; `resolvedAt` is kept, `@deprecated`, filled with
  `resolvedAtStep * timestepMs`. The debug window and gizmos show ages from the last stepped index.
- `getPhysGameTime()` is `@deprecated` (removal: the next engine major) and nothing in the
  simulation calls it; `PhysicsWallClock.ts` stays until then, its doc rewritten.

### D3. The seeded RNG service (p603 C7)

- `utils/SeededRandom.ts`: `createSeededRandom` moves from the toolkit unchanged (same output, the
  toolkit's generators and app scenes draw the same numbers).
- `utils/RandomStreams.ts`: named streams, `getRandomStream(name)` returning a `() => number` seeded
  from the world seed and the name (so one stream's sequence doesn't depend on another's draws),
  `setRandomSeed(seed)`, and `resetRandomStreams()`, which `loadScene` calls next to
  `resetPhysicsWorld` (`beforeAssets`), so a scene draws the same numbers on every visit. Public on
  `aekasha`.
- The tumble start draws from `character:<id>`, looked up when tumbling starts.
- The toolkit's `createSeededRandom` becomes a re-export from `aekasha`, `@deprecated` (removal:
  the next toolkit major); the toolkit's generators import it from `aekasha`. The simulation lint
  message names the service.

### D4. The action layer (p603 C5)

A sketch; Phase 2 writes the real types.

```ts
const map = createActionMap({
  id: 'player',
  context: 'GAMEPLAY',               // a context enables or suspends the whole map
  actions: {
    move: { type: 'AXIS_2D', name: 'Move' },
    jump: { type: 'BUTTON', name: 'Jump' },
    look: { type: 'DELTA_2D' },
  },
  bindings: {                        // plain data, so CONFIG.ts can override it (p770)
    move: [{ device: 'KEYBOARD', up: ['w'], down: ['s'], left: ['a'], right: ['d'] },
           { device: 'GAMEPAD', stick: 'LEFT' }],
    jump: [{ device: 'KEYBOARD', keys: [' '] }, { device: 'GAMEPAD', button: 'SOUTH' }],
  },
});
map.read('jump');                    // at the step: { isDown, pressedCount, releasedCount }, reused
map.onPressed('jump', fn);           // at the device event, also while the loop is paused
map.delete();
```

- **Action types:** `BUTTON`, `AXIS_1D`, `AXIS_2D` (clamped to length 1; keyboard composites,
  sticks with a radial deadzone), `DELTA_2D` (mouse movement, touch drag; summed between samples).
- **Two ways to read**, because the simulation and the UI need different things:
  - *At the step:* `sampleActions()` runs right before each fixed sub-step (and once per frame
    without stepping), next to `pollHeldKeyBindings`. Presses and releases between two samples are
    counted, so a tap shorter than a step isn't lost, and an edge-triggered action (jump, a toggle)
    lands on one step. Brains read this.
  - *At the event:* `onPressed` / `onReleased` fire when the device reports it (a DOM event, or the
    gamepad's per-frame poll), so debug keys and UI work while the loop is paused or an editor
    view suspends the scene.
- **Contexts** replace the scattered binding flags for action maps: `GAMEPLAY` (suspended in editor
  views, and while the debug camera is on unless the map allows it), `DEBUG` (runs in every view),
  plus app-defined ones (`setActionContextEnabled`). A map can still be scene-scoped (`sceneId`).
- **Devices:** keyboard (chords, as `KeyChord` today, `ignoreModifiers` by default for gameplay
  maps), mouse (buttons, movement, wheel), touch (tap, drag) and the gamepad: `GamepadInput.ts`
  implemented (`navigator.getGamepads()` polled once per frame, the standard mapping's buttons
  and sticks by name, connect and disconnect events).
- **Recording:** per step, plain data (`{ step, actions }` frames), and a replay that stands in for
  the devices of one map. The test bridge and the scene runner use it (D6).
- **The binding APIs stay** (`createKeyBinding`, `createMouseBinding`, `createTouchBinding`): the
  low-level device API, unchanged and documented as such. Action maps are what gameplay code uses.
- **Smallest build:** `MainLoop` calls the sampler through a hook the first `createActionMap` sets,
  so an app without action maps bundles none of it.

### D5. Actors, controllers and brains (p603 C1, C2, C4)

- **Where:** in `features/character/`, on `aekasha/character`, named generically (`ActorController`,
  `ActorBrain`, `registerBrainKind`, `registerControllerKind`), so p423's vehicles can lift them into
  their own place. No new feature: an app's `features` list doesn't change. The `CHARACTER`
  component is the actor record of kind `'CHARACTER'`.
- **Controller (C2):** `tick(dt, intent, step)`, a `kind` (`'DYNAMIC_CHARACTER'`), `attach` /
  `detach` in the type but unused (p603: until a controller is swapped on a live actor), `probes`,
  and `config` (today's hooks plus the live values). Only the tick writes the body: collision
  callbacks record, the tick applies.
- **Brain (C4):** `{ kind, think(intent, step), dispose? }`, made from `{ kind, params }` by a
  registered factory (`registerBrainKind`). One system runs every character's brain at
  `APP_PHYSICS_STEP` order -5: after the app's order-0 systems, before the controllers (-10). The
  brain goes with its character; `setCharacterBrain(id, { kind, params } | null)` switches it at
  runtime and disposes the old one.
- **Player brains:** `TANK`, `WORLD_FIXED` and `CAMERA_RELATIVE` are registered by `character()`'s
  install. Each owns an action map (`<characterId>:input`, `GAMEPLAY`) built from its `bindings`
  param, the `HOLD` latch and the turn-to-move default (`turnToMoveDirection`, a brain param that
  sets the controller's `_turnToMoveDirection` unless `charData` gives one). `CAMERA_RELATIVE`
  reads the camera at `think`: the recorded intent carries the result, not the camera.
- **Kept, deprecated (removal: the next engine major):** `DynamicCharacterOpts.input` (mapped to a
  player brain, its `mappings` to the brain's bindings), `CharacterObject.kind` and
  `CharacterBodyPlan.kind` (next to the new `bodyKind`; a plan may give either),
  `CharacterObject.keyBindingIds` / `mouseBindingIds` and `CreateCharacterOpts.controls`.
  `controlFns` stays: it's the script brain's API.
- **The gym's dummy** becomes an app brain kind (`GYM_DUMMY`, registered in `AppECSPlugins.ts`'s
  install), so the scene no longer adds or removes a system by hand.

### D6. The recorded run (the done criterion's check)

- The test bridge gets `playInput(frames)` (device-level key events dispatched right before the
  given steps, from a debug-only pre-step hook in `MainLoop`) and `whenCharacterPathsDone(steps)`
  (every character's pose per step, hashed). The scene runner reads a per-scene `inputScript`
  (`devTools/verify/inputs/thirdPersonGymScene.json`: the two players walking, turning, running,
  crouching and jumping into the props, written by hand) and compares the path hash with its
  baseline, on `MAIN_THREAD` and in Firefox.
- Device-level, so the same script drives today's bindings, the action layer and the brains: it
  checks the whole input path, not only the controller. `CAMERA_RELATIVE` depends on the camera,
  which is deterministic under the runner's test clock only; that's where the check runs.
- The baseline is recorded at the end of Phase 1 (after step time), and every later phase must
  give the same hash. Phase 1's own behaviour changes (D8) are checked by playing the gym.

### D7. Versions (the user's choice "minor")

- **Engine 5.0.2 → 5.1.0:** the action layer, the RNG service, the contracts and the gamepad are
  new API; every removal is a `@deprecated` alias until the next major (§2's lists).
- **Toolkit 2.0.2 → 2.1.0:** the camera rig's new options (D9), `createSeededRandom` re-exported
  from the engine, deprecated.
- **App 1.10.2 → 1.11.0:** the character example scene, the gym on brains, the scenes' bindings on
  actions.
- One `CHANGELOG.md` entry with Engine, Toolkit, App and Project sections.

### D8. The behaviour changes Phase 1 makes on purpose

Everything else must stay the same; these can't, and are listed in the changelog:

- Durations are whole steps (D2).
- The casts' results are used in the step that fires them on `MAIN_THREAD` (synchronous casts;
  before: a microtask after the frame, so one or more steps later depending on the frame).
- The wall sensor's tumble start runs in the next tick, not when its promise resolves, and its
  `isNearWall` is set in the events' flush of the same sub-step (before: a microtask after the
  frame, behind the async `bodyType()`).
- The tumble start's direction comes from the seeded stream.
- The gym's hash and `topDownTestScene`'s may change once: their baselines are updated in Phase 1
  with the reason.

### D9. The example scene and the camera rig (the user's request)

- **Scene `exampleCharacter`** (`src/app/examples/character/`): a ground with a few obstacles,
  steps and a ramp, a sun and ambient light, its own camera; one dynamic character on a
  `WORLD_FIXED` brain, keyboard only: W/A/S/D and the arrow keys move North, West, South and East,
  Space jumps, Shift runs, C crouches (not Control: Ctrl+W closes the tab on Windows and Linux,
  and browsers don't let a page stop it). Its HUD line (`exampleHud.ts`) names the keys. It uses
  the new API (`brain: { kind: 'WORLD_FIXED', params }`) with `turnToLastMoveDirection` on (D10),
  shown in the Hub through regions.
- **Hub:** a new `hub/pages/examples/character/` page (intro and walkthrough), the characters
  feature page's intro gets `::: scene exampleCharacter`, and its guide's include moves from
  `topDownTestScene`'s `dynamic-character` region to the example's.
- **The camera rig's new options** (`FollowObjectCameraParams`, defaults keep today's behaviour):
  - `orientation?: 'LOOK_AT_TARGET' | 'FIXED'` (default `'LOOK_AT_TARGET'`): `'FIXED'` keeps the
    camera looking along `-offset` and only moves it, so it never turns while it catches up.
    Without mouse input only; with `getMouseMoveInput` the orbit decides the orientation.
  - `lookAhead?: { distance: number; smoothingTime?: number; returnSpeed?: number }`: the
    followed point leads the target by up to `distance` (m) in its horizontal direction of travel
    (from the rendered pose's movement), eased in over `smoothingTime` (default 0.6 s). When the
    target stops, the lead moves back to the target at `returnSpeed` (m/s, default 1); 0 keeps the
    lead where it is (it never eases back). So a character heading North shows a little more of the
    North, and the view centres again once it stands still.
  - The example uses `orientation: 'FIXED'` and a small `lookAhead` (about 1.5 m, tuned by eye).
  - The two smoothing ticks share their code first (one tick with the smoothing step chosen once).

### D10. Turn to the last heading (the user's request, 2026-10-13; the p070 prompt's item)

- A player brain param for `WORLD_FIXED` and `CAMERA_RELATIVE`, `turnToLastMoveDirection`
  (default `false`, so the gym and `topDownTestScene` move as before and the recorded run holds).
  On, the character keeps turning in place, at `_rotateSpeed`, until it faces the last direction
  it moved in: a quick tap of W while facing South turns it all the way North, W and D together
  North-East.
- In the brain, through the intent only (p603 C4: the turn-to-move default is the brain's): while
  there's move input it remembers the move's yaw and leaves `faceYaw` null (the controller turns
  toward the move); when the move stops it writes the remembered yaw to `faceYaw`, which the
  controller turns toward until it's reached. Turn input (`intent.turn`) still overrides it.
- **Releasing a diagonal:** keys let go of a step or two apart would end on one of the two
  directions (W+D released W first ends East). The brain keeps the direction with the most keys
  held during the last `releaseGraceMs` (default 80 ms, counted in steps, so deterministic) as the
  last heading. A param, so 0 turns it off.
- The example scene turns it on (D9).

## 3. Phases

Each phase is reviewed and committed on its own. Every phase runs `yarn test`, `yarn lint`,
`tsc`, `yarn verify:scenes` (from Phase 1's end also the gym's path hash, D6) and
`yarn verify:baselines`, plus its own checks.

### Phase 1: determinism and the recorded run — done

1. Record the scene runner's baselines on this branch's base (`8deb455` = `main`):
   `yarn verify:scenes --update`, in the background.
2. D3: `utils/SeededRandom.ts`, `utils/RandomStreams.ts` with tests, the reset in `loadScene`,
   the toolkit's re-export and its generators' imports, the lint message.
3. D2: step time in `DynamicCharacter.ts` (`__…Step` stamps, `-1` sentinels), `resolvedAtStep`,
   the debug window's and gizmos' ages, `getPhysGameTime` deprecated.
4. The body writes into the tick: the sensors record (`__pendingTumble`, `__pendingLanding`), the
   tick applies them where the callbacks did. The wall sensor's body type: `bodyTypeSync()` on
   `MAIN_THREAD`; in the worker, the facade keeps each body's type (set at creation, updated by
   `setBodyType` and the tier changes: check every path that changes a type) so `bodyTypeSync()`
   stops throwing there.
5. The casts: `castShapeSync` / `castRayAndGetNormalSync` on `MAIN_THREAD`, the result kept for the
   next step; the worker keeps the async casts (documented in `CharacterProbes` and p428's stub).
6. The tumble start from `getRandomStream('character:<id>')`; drop its lint allow-list entry.
7. D6: the test bridge's `playInput` and `whenCharacterPathsDone` (bump `TEST_BRIDGE_VERSION`),
   the pre-step hook, the runner's `inputScript`, the gym's script, its first path baseline.
   `scenes.config.ts`: the gym's `unstableHash` narrowed to `workerSab` / `workerMsg` with D1's
   reason.
8. Play the gym (the user) for D8's changes; update the gym's and `topDownTestScene`'s baselines
   with the reason. Commit.

**As built:**

- Step 1: recorded in a scratch worktree at `8deb455` (so the tree could change meanwhile), 96 of
  96 runs, WebGPU on macOS, about 6 minutes; the baseline copied into `.cache/verify/scenes/webgpu/`
  (the older one kept as `webgpu.before-p610/`). The worktree lacked the gitignored
  `src/public/debugger/assets/testOptimized/phase1/metalToolbox/`, so `assetCompare`'s snapshots
  missed the toolbox: recorded again from this tree in step 8 (its probe hash is unchanged).
- Step 2: `createSeededRandom` moved with `git mv` (same output: `RandomStreams.test.ts` pins its
  first numbers for seed 7); `getRandomStream`, `setRandomSeed`, `getRandomSeed` on `aekasha`,
  `resetRandomStreams` `@internal`, called in `loadScene` right before the `beforeAssets` hooks.
  The toolkit entry re-exports it from `aekasha` with a `@deprecated` comment (a re-export, so
  `api:createSeededRandom` stays unambiguous); the toolkit's generators and the app's seven users
  import it from `aekasha`. Bundle: the main chunk +0.5 kB gzip (`utils/` 7 → 9 modules), the
  `SeededRandom` chunk gone.
- Step 3: the `__…Step` stamps are the tick's `getPhysicsSubStepIndex()`, the step length the
  tick's `dt`; the jump cooldown treats `-1` as "never jumped". The state window shows stamps as
  "N steps (M ms) ago" (`STEP_AGO`), the gizmos' wall-cast hold counts steps from
  `getPhysicsSnapshotStepIndex()`.
- Step 4: the worker's `RigidBodyProxyAPI` keeps its type (`cachedBodyType`, from the creation
  params' `rigidType` at its three construction sites, updated by `setBodyType`, the only path
  that changes a type; the tiers use it too), so `bodyTypeSync()` no longer throws there. The
  pending tumble is applied before the tick reads the body (where the callbacks used to apply it),
  the pending landing right after (from `_vels`, the same values `lvel` gave).
- Step 5: the sync casts' results are used in the same step (D8 as amended), not kept for the
  next; the wall cast's shape object is reused instead of a new literal per cast.
- Step 7: `setPreStepHook` in `MainLoop` (`@internal`, run first in `runFixedSubStep`);
  `debug/_dbg__TestBridgeInput.ts` plays the script and hashes the paths (FNV-1a over Float32 bits,
  as the probe, plus each locomotion state); the bridge's `getCharacterPaths()`,
  `TEST_BRIDGE_VERSION` 4. The script reaches the page as `window.__AEK_TEST_INPUT__` from the
  runner's init script (a `playInput` call after `whenSceneReady` would come steps late).
  **The probe hash already leaves characters out** ("not hashed"), so the path hash is the only
  check on them; it's compared on `MAIN_THREAD` only (D1). The gym runs 600 probe steps; its script
  (`devTools/verify/inputs/thirdPersonGymScene.json`) gets the TANK player through
  `CROUCH_WALK/FALL/GET_UP/IDLE/JUMP/RUN/TUMBLE/WALK`, the arrow-keys player and the dummy through
  `FALL/IDLE/JUMP/WALK`. Path hash `a51d785e`, the same on every run; the gym's probe hash
  `f5cf468f` is the same in all three targets under the test clock.
- Step 8: the full matrix passed except the expected ones (the gym's snapshots at 600 steps,
  `assetCompare`'s, `topDownTestScene`'s new path hash); those three scenes recorded again
  (`--update --only`), then 12 of 12 passed. `yarn verify:baselines --update`: the RNG exports, the
  move, the bridge types, `setPreStepHook`, the character chunk +0.2 kB gzip. `moveMap.ts`
  regenerated (639 files, the same 26 boundary violations as `main`). Also done now, since they
  stated the old behaviour: the root `CLAUDE.md` (toolkit geometry, Physics' determinism and RNG
  lines, the lint allow-list), `src/_engine/debug/CLAUDE.md` (the bridge),
  `devTools/verify/CLAUDE.md` (input scripts, path hashes), and the Hub's physics and characters
  guides (`yarn hub:build` passes).
- Not checked yet: `MAIN_THREAD` determinism with real frame timing (several sub-steps a frame).
  The runner's test clock runs one step a frame; `CAMERA_RELATIVE` follows the camera, which
  depends on the frame timing by design (D6), so such a check needs the arrow-keys player left out.

### Phase 2: the action layer — done

1. D4 in `kernel/input/`: `Actions.ts` (maps, contexts, sampling, event callbacks), `ActionTypes.ts`,
   `ActionRecording.ts`, the keyboard, mouse and touch sources (through `@internal` listeners on
   the device modules, which keep their own bindings), `GamepadInput.ts` implemented.
2. The sampler hook in `MainLoop` (before `pollHeldKeyBindings`, in every loop variant), the
   editor views' suspension and `setAllInputsEnabled` honoured.
3. Unit tests: sampling and edge counts, contexts, the keyboard composite, the gamepad with a
   stubbed `navigator.getGamepads`, recording and replay.
4. Nothing uses it yet: every scene's hash and path stay. Commit.

**As built:**

- Files: `ActionTypes.ts` (types only), `Actions.ts` (maps, contexts, sampling, events, 608 lines),
  `ActionBindings.ts` (compiling bindings and reading the devices through them, split out to keep
  `Actions.ts` under the size standard), `ActionRecording.ts`, `GamepadInput.ts`; tests in
  `Actions.test.ts` (28, window / document / navigator stubbed). Public on `aekasha`:
  `createActionMap`, `getActionMap(s)`, `setActionContextEnabled`, `isActionContextEnabled`,
  `recordActions`, `playActionRecording`, `getConnectedGamepads`, `onGamepadConnected` /
  `onGamepadDisconnected`, and the types.
- **Types:** `createActionMap` has a `const` type parameter, so the action ids are typed and each
  action's bindings are checked against its type (`ActionBindingOf<T>`); a binding of the wrong
  kind from plain data is left out with a warning. `ActionMap`'s members are methods, so any map
  is an `ActionMap`. One `ActionState` shape for every type (`isDown`, `pressedCount`,
  `releasedCount`, `value`, `x`, `y`); `AXIS_2D` and `DELTA_2D` are right and up positive (the
  gamepad's and the mouse's Y flipped). Several bindings: a button is down while any is, an axis
  takes the one pushed furthest, a delta sums them.
- **Bindings:** keyboard `keys` (strings or `KeyChord`s), `negative` / `positive` (`AXIS_1D`),
  `up` / `down` / `left` / `right` (`AXIS_2D`, a diagonal has length 1); mouse `button` (pressed on
  the canvas) and `delta: 'MOVE' | 'WHEEL'` (over the canvas or while the pointer is locked, a wheel
  line 16 px); touch `gesture: 'TAP' | 'DRAG'` (the default tap thresholds); gamepad `button`,
  `axis` (deadzone, invert) and `stick: 'LEFT' | 'RIGHT' | 'DPAD'` (radial deadzone, default 0.15).
  No gamepad binding on `DELTA_2D`: a stick look is an `AXIS_2D` rate action.
- **Map defaults outside `DEBUG`:** `ignoreModifiers` true, `preventDefault` true (a bound key's
  press, never in a text field), `enabledInDebugCam: 'NOT_ENABLED_IN_DEBUG'` (D4; today's
  character bindings run in the debug camera, so Phase 3's brains change that, outside any hashed
  run). `DEBUG`: exact modifiers, no `preventDefault`, `ENABLED_IN_DEBUG`. `gamepadIndex` reads one
  pad (default: any). A taken id replaces the old map, as the bindings do.
- **Live state vs. activity:** every device's state is followed all the time; counts, deltas and
  callbacks only while the map is active (enabled, its context on, its scene current, the debug
  camera rule met, no replay). A key held through a disabled context reads down afterwards
  without a press. `DEBUG` follows `areAllInputsEnabled()` (off during a scene load, on in editor
  views); every other context `areAppInputsEnabled()`. The per-device `set*InputsEnabled`
  switches are the bindings' own and don't apply (nothing in `src/` calls them).
- **Device sources:** one `@internal` hook per device module (`setKeyActionListener`,
  `setMouseActionSource`, `setTouchActionSource`), plus `isKeyChordHeld` / `doesKeyEventMatchChord`
  / `isMouseButtonHeld`; each module's bindings are unchanged. Added only when a map's bindings
  need that device. Gamepad: connection callbacks from the DOM events (no polling), the pads'
  values polled once per frame while a map has a gamepad binding, kept as `Float64Array`s (the
  API's doubles: a `Float32Array` turned a trigger's 0.3 into 0.30000001, which a recording would
  carry).
- **The loop:** `MainLoop`'s `@internal` `setActionSampler` (`pollFrame`, `sample`, `skip`), set by
  the first `createActionMap`. `pollFrame` right after the latch in every variant (also paused and
  in editor views, so gamepad callbacks work there); `sample(stepIndex)` in `runFixedSubStep` after
  the pre-step hook and before the held keys, and `sample(-1)` in the no-stepping fallback (the
  layer then numbers its samples itself); `skip` in `noteFixedStepPause` (paused or suspended), so
  a press made meanwhile doesn't land on the first step after it. The step index reaches the loop
  through `FixedStepDriver.step`'s `onBeforeStep(stepDelta, stepIndex?)` (optional: other drivers
  still compile); `stepPhysics` passes `subStepIndex` in both worker targets, the number
  `getPhysicsSubStepIndex()` gives, so recordings and Phase 3's brains share one step clock.
- **Recording:** `recordActions(map).stop()` gives `{ mapId, firstStep, lastStep, frames }`, a
  frame per step with the non-idle fields of the non-idle actions (JSON as is). Replay
  (`playActionRecording`) stands in for the map's devices (which neither count nor call back
  meanwhile; replayed presses call the callbacks at the sample) whatever its context, until
  `lastStep`; `from: 'RECORDED_STEPS'` (default, starts over when the step goes back) or
  `'NEXT_SAMPLE'`. Deleting the map ends both.
- Not unit-tested: the `MainLoop` hook itself (driving the loop needs a renderer); nothing calls
  it until Phase 3.
- Checks: `yarn test` (345), lint, `tsc`; `yarn verify:scenes` 96 of 96 (WebGPU, macOS, 381 s),
  the gym's path hash `a51d785e` and probe hash `f5cf468f` unchanged. `yarn verify:baselines
  --update`: the new exports (the `aekasha` entry and the `@internal` hooks), `kernel/input` docs
  27 / 51 → 96 / 119; bundle: no new chunk, the action layer tree-shaken out (no map is made), the
  main chunk +15 B (the loop's sampler calls and physics' step index), the rest gzip noise and the
  two `EngineRapier.js` chunks trading places.

### Phase 3: brains and the controller contract

1. D5's types, `registerBrainKind` / `registerControllerKind`, the brain system, `setCharacterBrain`.
2. The three player brains on action maps (`CharacterInputSchemes.ts` becomes them); `input:`
   mapped to a brain; `bodyKind`; the controller gets `kind` and `tick(dt, intent, step)`.
3. D10's `turnToLastMoveDirection` and `releaseGraceMs`, with unit tests of the brain's `think`
   against a replayed action recording (a tap, a diagonal released a step apart, turn input
   overriding).
4. The gym: the players on `brain`, the dummy as `GYM_DUMMY`; gamepad bindings on the TANK player
   (checked by the user with a pad). `topDownTestScene` on `brain`.
5. Same path hash, same hashes (D10 is off in both scenes). Commit.

**As built (steps 1-3, in review):**

- Decided with the user: `ActorBrain.think(intent, step, dt)` (`dt` appended to D5's signature:
  the dummy and `releaseGraceMs` turn ms into steps), and `registerControllerKind` comes with
  `createCharacterOfKind({ id, visual (Object3D or app id), controller: { kind, params }, brain? })`.
- `ActorTypes.ts` (the contracts, type-only) and `ActorKinds.ts` (both registries, register /
  unregister / get, `createCharacterOfKind`). The kinds and their params are interfaces filled by
  declaration merging on `aekasha/character` (`CharacterBrainKinds`, `CharacterControllerKinds`,
  as `ComponentDataMap`), so a spec's params are type-checked per kind; `params` is optional when
  all of its fields are. An unknown kind throws, naming the registered ones.
- A brain's controller default: `ActorBrain.configDefaults` (a player brain's
  `_turnToMoveDirection`), set by the controller's new `config.applyDefaults` for the keys
  `charData` didn't give, at creation (before `initialConfig` is snapshotted, so saved debug
  edits still win) and on `setCharacterBrain` (which then overwrites a debug edit of that key).
- `Character.ts`: `characterBrainSystem` (order -5), the controller system passes the intent and
  `getPhysicsSubStepIndex()`, the brain is disposed with the character, `setCharacterBrain`
  makes the new brain before disposing the old one. `ActorController.kind` is required
  (`CharacterController` wasn't on the entry). New on the entry: `CharacterIntent`,
  `CharacterController`, `CharacterData`, the actor types, the player brains' params types.
- The player brains are in `brains/PlayerBrains.ts` (Phase 4's place). Actions: `TANK` `turn`
  (`AXIS_1D`, positive left) and `forward` (`AXIS_1D`); the others `move` (`AXIS_2D`); all
  `jump`, `run`, `crouch`. `TOGGLE` flips on an odd `pressedCount`, `HOLD` follows `isDown` (the
  HOLD latch left the tick). `CharacterInputSchemes.ts` keeps the deprecated types and
  `getInputBrainSpec` (`input:` → the same kind's spec, its mappings as keyboard bindings;
  `brain` wins over `input`, with a warning). `createCharacterInput` and
  `SCHEME_TURNS_TO_MOVE_DIRECTION` are gone (never on the entry).
- `bodyKind` on `CharacterObject`, `CharacterBodyPlan` and `CreateCharacterOpts`
  (`CharacterBodyKindField`: either field, `getBodyKind` reads it); `kind`, `keyBindingIds`,
  `mouseBindingIds` and `controls` `@deprecated`. `HUMANOID_CAPSULE` gives both names.
- Bundle: the `DYNAMIC_CHARACTER` factory `import()`s `DynamicCharacter.ts` (a static import put
  it in the main chunk, +12.5 kB gzip); the player brains registered at install keep the action
  layer in the main chunk (the user's choice, D5): main +6.5 kB gzip, `DynamicCharacter.js` a
  chunk of its own (6.5 kB).
- Step 3 (D10): the last heading is a closure made only when `turnToLastMoveDirection` is on.
  While `move` isn't idle it remembers the world move's yaw (and the last diagonal's: both of the
  action's axes non-zero, so a stick counts as one too) and clears a `faceYaw` it wrote; on the
  first idle step it writes the heading to `faceYaw`: the last diagonal when the move's last step
  is within `releaseGraceMs` of it (`(lastStep - diagonalStep) * dt * 1000 <= releaseGraceMs`, so
  80 ms keeps 4 steps at 60 Hz), else the last move. A turn in the intent cancels it, and a
  `faceYaw` someone else wrote is never cleared nor replaced (amends D10, which said nothing of
  it). Tested in `brains/PlayerBrains.test.ts` through replayed recordings of the brain's map.
- Checks: the gym's path hash `a51d785e` and probe hash `f5cf468f`, `topDownTestScene`'s
  `c7786d74`, unchanged in all targets (the arrow-keys diagonals included); the system order
  check fails only on the new `characterBrainSystem@-5`, recorded at the end of the phase.

### Phase 4: the dynamic controller split

1. `features/character/controllers/dynamic/`: the factory and the tick's order
   (`DynamicCharacter.ts`), `Floor.ts`, `Wall.ts`, `Platform.ts`, `Jump.ts`, `Tumble.ts`,
   `Crouch.ts`, `Locomotion.ts`, `Casts.ts`, `DynamicCharacterData.ts` (types and defaults);
   `features/character/brains/` for the player brains. No file over ~800 lines, no function over
   ~150 (the coding standard).
2. The data as three objects on the controller, `state`, `config` (values without the prefix, and
   the hooks) and `internal`; `character.data` and `charData`'s `_` keys stay as a `@deprecated`
   flat view (accessors built once at creation, nothing per frame).
3. The debug tools read the three objects; the saved overrides keep their localStorage keys and
   format (mapped on load).
4. Same path hash, same hashes; `perf-auditor` on the tick. Commit.

### Phase 5: the debug keys and the app's bindings on actions

1. `DefaultDebugKeyBindings.ts` becomes a `DEBUG` action map with event callbacks; `AppConfig.debugKeys`
   keeps its shape (mapped onto it), the reserved-chord warnings stay, the shortcuts dialog reads
   the map's metadata as well as the remaining key bindings.
2. The app's gameplay key reads (`scene01`, `physicsTiers`, `largeWorld`, `assetCompare`,
   `examplePhysics`, `exampleSkyBox`, the gym's `PhysicsStressTest`) go through action maps; a
   debug or demo toggle may stay a key binding (listed in "As built" with why). `examplePhysics`'
   regions change its Hub page in the same commit.
3. Same path hash, same hashes, every debug key checked by hand in the Runtime and the material
   editor views. Commit.

### Phase 6: the camera rig and the example scene

1. D9's rig options (the shared tick first), with the gym's rig unchanged.
2. The `exampleCharacter` scene and its HUD line.
3. The Hub: the example page, the characters feature page's panel and include; the Hub image
   (saved with the drawer's Hub tab: the user, or through the dev files from a driven browser).
   `yarn hub:build`. Commit.

### Phase 7: the Hub, readme and CLAUDE.md

1. The characters feature page's guide (controllers, brains, actions, determinism), the input
   documentation (action maps, contexts, the gamepad), the physics page's note on characters.
2. Nested `CLAUDE.md` files for `features/character/` and `kernel/input/` (one line each in the
   root's map; their `##` sections in a feature page's `aek:covers`), the root's Physics section
   (characters' determinism), the simulation lint list.
3. `readme.md`: the action layer and the gamepad (Features), the character example.
4. `yarn hub:build`, `yarn verify:baselines --docs`. Commit.

### Phase 8: versions and done

1. Create `p428_character-determinism-in-worker-targets.md` (stub, D1); point p512 and p421 at it.
2. D7's bumps, the changelog entry (D8's changes listed), `yarn checkVersions --against main`.
3. The full verification, including `yarn verify:scenes --browser firefox` (the gym's
   `MAIN_THREAD` path hash and every hash equal to Chromium's).
4. Mark the plan done; the references (`Blocked by` lines in p420, p421, p423, p424, p617, p614,
   p512, the p070 / p770 prompts' notes, p600). The p070 prompt's note says its "keep turning to
   the last heading" item is done (D10). Time for the PR: this branch into `main`.

## 4. Risks

1. **Worker targets stay non-deterministic** for characters (D1), and so does anything a character
   pushes. p428 owns it; p512's prediction needs it.
2. **Per-step sampling vs. a paused loop:** debug keys and UI must use the event callbacks, or they
   stop working while paused. Phase 5's hand check covers it.
3. **The deprecated flat data view** is two ways into the same values until the next major; the
   debug tools must use only the new objects, or the view can't be removed.
4. **The recorded run checks one script.** It catches a changed path, not a behaviour the script
   never exercises (tumbling on a wall, moving platforms): the script includes both on purpose.
5. **The camera rig's look-ahead** reads the rendered pose (presentation), which is right for a
   camera, but means the look-ahead isn't part of the deterministic run: the runner's snapshot of
   the example uses the test clock.
