## Action maps

[`createActionMap`](api:createActionMap), from `aekasha`, makes a map: its actions, each with a
type, and the bindings that drive them.

```ts
import { createActionMap } from 'aekasha';

const controls = createActionMap({
  id: 'player',
  sceneId: 'level1', // Active in that scene only
  actions: {
    move: { type: 'AXIS_2D', name: 'Move' },
    jump: { type: 'BUTTON', name: 'Jump' },
    look: { type: 'DELTA_2D', name: 'Look' },
  },
  bindings: {
    move: [
      { device: 'KEYBOARD', up: ['w'], down: ['s'], left: ['a'], right: ['d'] },
      { device: 'GAMEPAD', stick: 'LEFT' },
    ],
    jump: [
      { device: 'KEYBOARD', keys: [' '] },
      { device: 'GAMEPAD', button: 'SOUTH' },
    ],
    look: [{ device: 'MOUSE', delta: 'MOVE', scale: 0.5 }],
  },
});
```

The action ids are typed from `actions`, and each action's bindings are checked against its type.
A map with an id that's already taken replaces the old one, so a scene can make its map on every
visit. `name`, `description` and `icons` are for UI: the debug key shortcuts dialog (`u`) lists
the app's maps with them.

| Type       | Reads                                                                                   |
| ---------- | --------------------------------------------------------------------------------------- |
| `BUTTON`   | On or off, and the presses and releases since the last sample (jump, interact, toggle). |
| `AXIS_1D`  | -1 to 1 (throttle, zoom).                                                               |
| `AXIS_2D`  | A direction of length 0 to 1, right and up positive (move, a stick's look rate).        |
| `DELTA_2D` | Movement summed since the last sample, right and up positive (mouse look, a drag).      |

With several bindings on one action, a `BUTTON` is down while any of them is, an axis takes the
one pushed furthest, and a delta adds them up.

## Bindings

Bindings are plain data, so they can come from a config file or a settings screen.

| Device     | Binding                                                    | Action     |
| ---------- | ---------------------------------------------------------- | ---------- |
| `KEYBOARD` | `keys`: any of them                                        | `BUTTON`   |
|            | `negative`, `positive`                                     | `AXIS_1D`  |
|            | `up`, `down`, `left`, `right` (a diagonal has length 1)    | `AXIS_2D`  |
| `MOUSE`    | `button`: `LEFT`, `MIDDLE`, `RIGHT`, pressed on the canvas | `BUTTON`   |
|            | `delta`: `MOVE` (CSS pixels) or `WHEEL` (a line is 16)     | `DELTA_2D` |
| `TOUCH`    | `gesture: 'TAP'`                                           | `BUTTON`   |
|            | `gesture: 'DRAG'`: one finger, started on the canvas       | `DELTA_2D` |
| `GAMEPAD`  | `button` (a trigger reads its analog value)                | `BUTTON`   |
|            | `axis`: `LEFT_X`, `LEFT_Y`, `RIGHT_X`, `RIGHT_Y`           | `AXIS_1D`  |
|            | `stick`: `LEFT`, `RIGHT`, or `DPAD` read as a stick        | `AXIS_2D`  |

- Keys are `KeyboardEvent.key` values (`'w'`, `' '`, `'ArrowUp'`, `'Shift'`), case-insensitive,
  or chords (`{ key: 'z', ctrl: true }`{ts}).
- Outside the `DEBUG` context a map's keys ignore modifiers by default (`ignoreModifiers`), so
  movement keeps working while Shift is held to run.
- A map calls `preventDefault()` on the key presses it matches while it's active (so Space
  doesn't scroll the page), but never in a text field, and a binding that ignores modifiers
  never for a key pressed with Ctrl, Alt or Meta: copy, paste and back stay the browser's.
- Sticks and axes have a deadzone (0.15 by default; a stick's is radial), and above it the rest
  is rescaled to 0-1.
- A map's `setBindings` replaces an action's bindings at runtime, for a rebinding screen, and
  [`getActionMap`](api:getActionMap) finds a map by its id (a player brain's map is
  `<characterId>:input`). The screen's labels come from
  [`getKeyChordLabel`](api:getKeyChordLabel) (`{ key: 'z', ctrl: true }`{ts} reads `Ctrl+Z`) and
  [`GAMEPAD_BUTTON_NAMES`](api:GAMEPAD_BUTTON_NAMES) (the pad's buttons in the standard
  mapping's order).

## Reading actions

There are two ways to read an action, because the simulation and the UI need different things:

- **At the step.** The engine samples every map right before each fixed physics step (once a
  frame when physics doesn't step), and the map's `read` returns that sample: what an
  `APP_PHYSICS_STEP` system or a character's brain reads. Presses and releases between two
  samples are counted (`pressedCount`, `releasedCount`), so a tap shorter than a step isn't lost
  and a jump lands on exactly one step. The returned object is the same one every time, updated in
  place.
- **At the event.** `onPressed` and `onReleased` call back when the device reports it (a DOM
  event, or the gamepad's poll each frame), also while the loop is paused or an editor view is
  open: what menus, one-off actions and debug keys use. Both return the remover.

```ts
world.addSystem(ECSSystemStage.APP_PHYSICS_STEP, 'playerInput', () => {
  const move = controls.read('move'); // { x, y, value, isDown, ... }
  intent.moveX += move.x;
  intent.moveZ -= move.y; // Up is north, -Z
  if (controls.read('jump').pressedCount > 0) intent.jump = true;
});

const removeMenuKey = controls.onPressed('jump', () => closeMenu());
```

A key held while its map is inactive reads down once the map is active again, without a press.

## Contexts and scenes

A map belongs to a context, which enables or suspends all of its maps at once:

- `GAMEPLAY`, the default: off during a scene load and while an editor view is open, and while
  the debug camera is on unless the map's `enabledInDebugCam` allows it.
- `DEBUG`: the debug keys. It runs in every view, editor views included, and is off during a
  scene load.
- Any other name is your own and behaves like `GAMEPLAY`: a menu turns `GAMEPLAY` off and its
  own context on with [`setActionContextEnabled`](api:setActionContextEnabled).

A switch made in a callback applies from the next key, button or gamepad event: the maps that
take an event are fixed when it arrives. So one key can open a menu in the gameplay map and close
it in the menu's map, and the press that opens it doesn't close it again.

A map with a `sceneId` is active in that scene only, and its `setEnabled` turns one map off. An
inactive map reads idle and calls nothing back; its `isActive()` tells whether devices drive it
now.

## The gamepad

Gamepads use the browser's standard mapping. Buttons are named by their position, not their
label: `SOUTH` is A on an Xbox pad and Cross on a PlayStation pad, `EAST` B or Circle. The
shoulders, triggers, sticks, d-pad, `SELECT`, `START` and `HOME` have names too
([`GamepadButtonName`](api:GamepadButtonName)). Stick axes are right and up positive.

- The pads are polled once a frame, and only while a map has a gamepad binding.
- `gamepadIndex` on a map reads one pad only (a split screen); by default it reads any, the
  furthest pushed for an axis.
- [`getConnectedGamepads`](api:getConnectedGamepads), [`onGamepadConnected`](api:onGamepadConnected)
  and [`onGamepadDisconnected`](api:onGamepadDisconnected) follow the pads.

::: tip Press a button to start
Chrome reports a gamepad only after a button on it has been pressed, so a "press any button"
prompt is the usual start screen.
:::

## Recording and replay

[`recordActions`](api:recordActions) records a map's samples, one frame per step in which an
action wasn't idle. The recording is plain data: save it as JSON, send it to a peer, or replay it.
[`playActionRecording`](api:playActionRecording) stands in for the map's devices until its last
step. By default each frame plays at the step it was recorded at, starting over when the step
goes back (a scene loaded again), so a run of a scene replays from its start: a ghost, a demo or a
test's input.

```ts
const recorder = recordActions(controls);
// ... later
const recording = recorder.stop();
playActionRecording(controls, recording); // The map's devices are ignored meanwhile
```

## Key, mouse and touch bindings

The device bindings under the action layer stay public:
[`createKeyBinding`](api:createKeyBinding), [`createMouseBinding`](api:createMouseBinding) and
[`createTouchBinding`](api:createTouchBinding). A binding is a callback on one device event, with
no sampling. Use them for what isn't an action: clicking or hovering a 3D object (a mouse
binding's `targets` are raycast), a pinch, or a tool that wants the raw event. Gameplay belongs on
action maps.

```ts
import { createKeyBinding, createMouseBinding } from 'aekasha';

createKeyBinding({
  id: 'toggleMap',
  type: 'KEY_DOWN',
  chord: [{ key: 'm' }, { key: 'Tab' }],
  fn: () => toggleMap(),
});
createMouseBinding({
  id: 'pickCrate',
  type: 'MOUSE_CLICK',
  button: 'LEFT',
  targets: () => crates, // Only these are raycast, never the whole scene
  fn: (_e, hit) => selectCrate(hit.object), // The closest hit
});
```

- The bindings are plain data like the maps', with their types on `aekasha`:
  [`KeyBinding`](api:KeyBinding), [`MouseBinding`](api:MouseBinding) and
  [`TouchBinding`](api:TouchBinding), each a union of one type per event (`KEY_DOWN` /
  `KEY_UP`, `KEY_HELD`; `MOUSE_CLICK`, `MOUSE_HOVER`, …), and [`KeyChord`](api:KeyChord).
- A binding is kept as given: `setKeyBindingEnabled` (and the mouse's and touch's) writes
  `enabled` on the object you passed.
- A `KEY_HELD` binding is called once per physics step while its chord is held (once a frame
  when physics doesn't step).
- A device adds its listeners with its first binding or map, so an app with no key binding and no
  map with a key bundles no keyboard code.

## Debug keys

The engine's debug keys are action maps in the `DEBUG` context, so they work while the loop is
paused and in editor views (the [debug suite's keys](hub:features/debug-suite#keys)).
`AppConfig.debugKeys` in `src/CONFIG.ts` rebinds them or adds your own, which get a map of their
own; a gameplay binding on a debug key's chord logs a warning in debug mode.

## Key APIs

- [`createActionMap`](api:createActionMap), [`getActionMap`](api:getActionMap) and
  [`getActionMaps`](api:getActionMaps); [`ActionMap`](api:ActionMap) and
  [`ActionState`](api:ActionState).
- [`setActionContextEnabled`](api:setActionContextEnabled) and
  [`isActionContextEnabled`](api:isActionContextEnabled).
- [`recordActions`](api:recordActions) and [`playActionRecording`](api:playActionRecording).
- [`getConnectedGamepads`](api:getConnectedGamepads),
  [`onGamepadConnected`](api:onGamepadConnected) and
  [`onGamepadDisconnected`](api:onGamepadDisconnected).
- [`createKeyBinding`](api:createKeyBinding), [`createMouseBinding`](api:createMouseBinding) and
  [`createTouchBinding`](api:createTouchBinding); [`KeyBinding`](api:KeyBinding),
  [`MouseBinding`](api:MouseBinding), [`TouchBinding`](api:TouchBinding) and
  [`KeyChord`](api:KeyChord).
- [`getKeyChordLabel`](api:getKeyChordLabel) and
  [`GAMEPAD_BUTTON_NAMES`](api:GAMEPAD_BUTTON_NAMES), for a rebinding screen.

## Read more

- [Characters](hub:features/characters): the player brains read action maps.
- [Physics](hub:features/physics#stepping): the fixed steps the actions are sampled for.
- [UI kit](hub:features/ui-kit#dialogs): a pause menu that switches the contexts.
- The API reference: [`input/`](hub:documentation/aekasha/input) of `aekasha`.

::: claude-md
:::
