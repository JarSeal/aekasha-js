## The files

The example is a scene folder, `src/app/examples/gameHud/`, split by what each file does:

- `exampleGameHud.ts`: the scene file. The player, its camera, the game's action maps, the
  game's rules and the per-frame system that feeds the HUD.
- `exampleGameHudView.ts`: the camera's orbit input and the minimap's viewport.
- `exampleGameHudLevel.ts`: the arena. A walled floor, four dynamic crates, three NPCs (Mara, Ivo
  and Pell) on `FIXED` bodies, the beacon and a fire pit, which is only drawn: the game checks the
  player's position against its square.
- `exampleGameHudHud.ts`: the HUD, every kit piece made from plain data and the game's callbacks.
- `exampleGameHudMenus.ts`: the pause menu, the inventory, the settings and the controls page,
  and their saving.
- `exampleGameHudIcons.ts`: the example's own 16 px icons, registered on every visit (a
  production build registers no built-in icon), and `exampleGameHud.scss`, the HUD's layout.

The player is a dynamic [character](hub:features/characters) on a `CAMERA_RELATIVE` brain: W A S
D or the left stick move it along the camera's view. Its map, `exampleGameHudPlayer:input`, is
one of the two the controls page rebinds.

## The game's actions

The game's own actions are an action map of the `GAMEPLAY` context: a keyboard or mouse binding
and a gamepad binding for each, both always on. The HUD's prompts and the controls page read
these bindings, so a rebinding shows everywhere.

<<< src/app/examples/gameHud/exampleGameHud.ts#game-hud-actions

- The `name`s are what the controls page shows. The brain's map names its own (move, jump, run,
  crouch).
- The HUD is UI, so the game reacts at the press: `onPressed` and `onReleased` call back at the
  device's event ([reading actions](hub:features/input#reading-actions)).
- The mouse wheel picks the next or previous item. It's an engine mouse binding
  ([`createMouseBinding`](api:createMouseBinding), `MOUSE_WHEEL`), so the input switches apply to
  it, and it acts only while the game's map is active.

## Prompts that follow the device

<<< src/app/examples/gameHud/exampleGameHud.ts#game-hud-prompts

The engine's device tracker ([the last used device](hub:features/input#the-last-used-device))
reports the device the player last used, with a gamepad's family, and the kit's
`setPromptDevice` switches every prompt to it at once: "[E] Talk" after a key, "[X] Talk" after a
press on an Xbox pad, "[□] Talk" on a PlayStation pad. A mouse move alone doesn't switch from the
gamepad. The controls page's gamepad column follows it too.

The health and stamina bars sit at the bottom left with the prompts under them:

<<< src/app/examples/gameHud/exampleGameHudHud.ts#game-hud-vitals

- A [resource bar](hub:features/ui-kit/game#resource-bars)'s thresholds set a state and a word:
  under a quarter the health bar turns `danger` and reads "Low", so it never says it by colour
  alone. The stamina bar is in four segments.
- Each [input prompt](hub:features/ui-kit/game#input-prompts) takes the map's bindings as they
  are and draws the first one for the prompt device. After a rebinding, the scene hands each
  prompt its action's bindings again (`setBindings`).
- The scene writes the bars every frame with `setValue`: a value that didn't change writes
  nothing, so there's nothing to track.

## The camera

The camera is the toolkit's [follow rig](hub:features/toolkit#gameplay), orbiting the player:

<<< src/app/examples/gameHud/exampleGameHud.ts#game-hud-camera

With `getMouseMoveInput` the rig orbits the followed point at `offset`'s length, starting from
its direction, so the camera starts behind the player, about 8° down. The screen's centre, where
the crosshair is, then reaches crate height 5 to 12 m ahead. The orbit's input is the scene's:

<<< src/app/examples/gameHud/exampleGameHudView.ts#game-hud-orbit

- A right-drag on the canvas sums the pointer's movement between frames. It's DOM events, not an
  action map: a map's `read()` is the last physics step's sample, which two frames between steps
  would read twice.
- The right stick adds its rate, read from the game's `look` action. While the radial menu is
  open the stick is the menu's, and the camera stays.
- The right button's context menu is turned off on the canvas.

## The hotbar

<<< src/app/examples/gameHud/exampleGameHudHud.ts#game-hud-hotbar

The [hotbar](hub:features/ui-kit/game#hotbars) is a toolbar of item slots, each with a
[cooldown](hub:features/ui-kit/game#cooldowns). It binds no keys of its own: the game's map
calls `select` and `selectNext` (1 to 4, the d-pad, the wheel), and `onUse` is a slot's click,
Enter or Space. The scene's use:

<<< src/app/examples/gameHud/exampleGameHud.ts#game-hud-hotbar-use

- A slot's `cooldown` says when its item is ready again: `start(ms)` sweeps it, and
  `isRunning()` refuses a second use meanwhile.
- The [notification feed](hub:features/ui-kit/game#notification-feeds)'s `key` merges a repeat
  into its line ("Health is full ×3") instead of adding lines.
- A count that reaches 0 empties the slot with `setItem(index, null)`; the others are written
  with `setCount`.

## Shooting

<<< src/app/examples/gameHud/exampleGameHud.ts#game-hud-fire

- The aim is the camera's ray through the screen's centre, where the crosshair is: the camera's
  position and its forward, a `THREE.Ray` of plain maths that tests nothing.
- A shot is a [physics ray](hub:features/physics#queries-events-and-joints) along the aim, so a
  wall or an NPC in the way stops it. It starts at the aim's point nearest the player, so nothing
  behind the player stops it, and leaves out the player's own body. A hit's collider names its
  body (`parentId`), which the scene maps back to its crate.
- On `WORKER_THREAD` the cast resolves a frame or two later, so after the `await` the shot checks
  again that the visit is still on and the crate still whole.
- With `debug` the debug env draws each shot, and the Physics API tab and the profiler count it
  with the physics rays. A three.js `Raycaster` against the meshes would be invisible to both.
- The [crosshair](hub:features/ui-kit/game#crosshairs)'s `showHitMarker` says how it went: a hit,
  a critical one on the crate's top, or the kill.
- A crate's health bar is a segmented resource bar over it (below, the world's UI). The kill
  removes the crate's `WORLD_ANCHOR` component, and its bar goes with it.
- The shot pushes the crate, but not from the shot's callback: physics writes go in a physics
  step, so the impulse waits in `pending` for the scene's `APP_PHYSICS_STEP` system, as the
  respawn after the fire pit does:

<<< src/app/examples/gameHud/exampleGameHud.ts#game-hud-step

[Stepping](hub:features/physics#stepping) has why: a write from a frame's stage lands on
whichever step comes next, which depends on the frame rate.

## Every frame

One `APP_LOGIC` system, after physics has synced the drawn poses, feeds the HUD from the game:

<<< src/app/examples/gameHud/exampleGameHud.ts#game-hud-frame

- The stamina drains while running and comes back while not. The fire pit burns the health
  while the player stands in it; at 0 the respawn is queued for the next step, with half a second
  of grace while the drawn pose catches up, counted in the frames' `dt` so a pause holds it.
- The crosshair opens up with the speed (`setSpread`) and shows its `target` ring while the
  screen's centre is on a crate: the aim against a sphere about each crate, maths with no
  allocation and no cast. It's a hint: a wall in front of a crate still rings it, where the shot
  stops at the wall.
- Mara's talk prompt shows within 2.5 m of her. Ivo and Pell each say a line as the player
  passes.
- The waypoint's distance and the compass's markers are the player's: `getCompassBearing`, from
  `aekasha/toolkit/ecs`, turns a direction on the ground into the compass's bearing.
- Every setter writes only when its value changed (the waypoint's text only when the whole metres
  do), so most frames write nothing to the page.

## UI in the world

The nameplates, the crates' bars and the beacon's waypoint are
[world anchors](hub:features/ui-kit/game#world-anchors): HUD content over points in the world.

<<< src/app/examples/gameHud/exampleGameHudHud.ts#game-hud-world

- `registerWorldAnchorSync`, from `aekasha/toolkit/ecs`, is one `LATE_MAIN` system: after the
  render, it moves each `WORLD_ANCHOR` entity's anchor to its drawn position, projects the layer's
  anchors with the active camera and turns the [compass](hub:features/ui-kit/game#compasses).
  Removing the component, or the entity, removes its anchor.
- Mara's nameplate holds her talk prompt, hidden until the player is near.
- The beacon's waypoint is `offScreen: 'clamp'`: off screen it stays on the screen's edge with an
  arrow to the beacon. The other anchors hide past `maxDistance` (the camera's distance, 7 m behind
  the player) and behind the camera.
- The layer is added to the HUD first, so every other piece is drawn over the anchors.

The minimap is a [viewport](hub:features/viewports) of the same scene through a top-down camera,
and the kit's [minimap frame](hub:features/ui-kit/game#minimap-frames) its ring and zoom buttons:

<<< src/app/examples/gameHud/exampleGameHudView.ts#game-hud-minimap

- The viewport places its slot at the bottom right; the frame is appended into `slotElem` and
  fills it. The slot is sized in the kit's units in the stylesheet, so after a UI scale change
  the scene calls `invalidateViewportLayout`.
- Every frame moves the camera over the player and turns the frame's arrow with the player's
  facing. The zoom buttons call the scene's `onMapZoom`, which sets the camera's `zoom`.

## Text

<<< src/app/examples/gameHud/exampleGameHudHud.ts#game-hud-text

- The [feed](hub:features/ui-kit/game#notification-feeds) at the top right reports the game's
  events, the [objective tracker](hub:features/ui-kit/game#objective-trackers) at the top left
  the quest: talk to Mara, then the crates' count and the beacon.
- The [subtitles](hub:features/ui-kit/game#subtitles) show the NPCs' lines, the whistle's and the
  emotes'. The stylesheet raises them over the hotbar with `--aek-subtitles-inset`, and the
  settings' Subtitles page turns them off or sizes them.
- The [dialogue box](hub:features/ui-kit/game#dialogue-boxes) holds the conversation. A
  [spatial navigation](hub:features/ui-kit/game#spatial-navigation) with `handleKeys: false`
  lets the gamepad's d-pad move among its choices; the keyboard's keys are the box's own.

Mara's conversation is plain data, a line each, its choices naming the next:

<<< src/app/examples/gameHud/exampleGameHud.ts#game-hud-dialogue

And the scene shows it:

<<< src/app/examples/gameHud/exampleGameHud.ts#game-hud-conversation

- A conversation turns the `GAMEPLAY` context off and its own `DIALOGUE` context on, so the
  character stands still and E or `SOUTH` confirm: a focused choice is clicked, else the line
  goes on (`confirm()`).
- `focus()` puts the focus in the box, so Enter, Space and the arrows are the box's too.
- While it shows, the bars and the hotbar are hidden by an attribute the scene sets on the HUD
  root, which the stylesheet reads.
- The first conversation's end completes the tracker's first objective and adds the next two.

## The radial menu

<<< src/app/examples/gameHud/exampleGameHud.ts#game-hud-radial

Q or the right shoulder held opens the [radial menu](hub:features/ui-kit/game#radial-menus) of
emotes. The pointer's direction or the right stick (`setDirection`, in the frame's system)
highlights one, and the highlight stays when the stick springs back, so the release picks it.
`select()` returns false when nothing is highlighted, and the scene then closes the menu without
a pick.

## The pause menu

Escape or `START` opens the [game menu](hub:features/ui-kit/game#game-menus): Resume, the
inventory, the settings and a restart. Its `onOpen` turns `GAMEPLAY` off and the `MENU` context
on, its `onClose` the other way round. The keyboard's arrows, Enter and Escape are the kit's own,
so the menu's map binds only the gamepad:

<<< src/app/examples/gameHud/exampleGameHudMenus.ts#game-hud-menu-gamepad

- The d-pad calls the menu's `navigation.move`: the focus moves by position, so the inventory's
  grids and the settings' fields need no order of their own.
- `SOUTH` clicks the focused element, so every button, slot and field works as a click does.
- `EAST` goes back, or puts back an item held in the inventory. The shoulders turn the settings'
  tabs.

### The inventory

<<< src/app/examples/gameHud/exampleGameHudMenus.ts#game-hud-inventory

- Two [inventory grids](hub:features/ui-kit/game#inventory-grids), the bag and a chest, in one
  drag group (`createItemDragGroup`), so an item moves between them: a click, Enter or Space
  picks it up and drops it, a drag works too.
- The grids move nothing themselves: `onMove` changes the records (a move, a swap or a merge of
  a stack) and `setItems` shows them. `canMove` is the target's rule: the beacon key stays in the
  bag.
- A gamepad hovers nothing, so the [item details](hub:features/ui-kit/game#item-details) follow
  the focus as well as the pointer, and compare a weapon with the sword in hand.

### The settings

<<< src/app/examples/gameHud/exampleGameHudMenus.ts#game-hud-settings

- A [settings menu](hub:features/ui-kit/game#settings-menus) is pages of property grid items
  bound to the settings object. Each change applies at once: the theme, the UI scale and reduced
  motion with `setKitPreferences` on the HUD root, the crosshair's shape and the subtitles through
  the scene's `onApply`.
- A finished change (`change.last`) and a reset are saved in `localStorage`. On the next visit
  the saved settings are read back, each key only with the default's type, and the scene's exit
  puts the kit's preferences back as they were.
- The Controls page is a page of its own content, its reset the page's.

### The controls page

<<< src/app/examples/gameHud/exampleGameHudMenus.ts#game-hud-controls

- The [controls page](hub:features/ui-kit/game#controls-pages) lists the actions of both maps,
  the brain's and the game's, a slot per binding. A rebinding is reported as the action's whole
  new list, which `setBindings` takes as it is.
- The bindings are saved per map and action, and applied at the start before the HUD's prompts
  are made. The defaults are the maps' bindings before that, so a reset goes back to them.
- While the page waits for an input, the menu's map is off, so a gamepad's press binds instead
  of moving the focus.

Back to the [examples](hub:examples).
