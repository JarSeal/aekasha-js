Status: in progress | Phases 0-8 implemented
Category: UI, Accessibility, Input
Epic: p800_debugger-ui-overhaul.md
Related: \_DONE_p803_ui-kit-structure-and-core.md (the folders, coding style, overlay layer, the input glyph whose gamepads this adds: its D10), \_DONE_p804_forms-and-bindings.md (the form, the property grid and its items the settings menu builds on; its D1: a field reports, its owner persists), \_DONE_p805_data-display.md (`RovingFocus.ts`, the announcer, the tabs the settings menu's pages are on, the list's reorder model the inventory's moves follow), \_DONE_p610_character-and-input-action-architecture.md (the action maps the prompts read and the controls page rebinds), \_DONE_p611_sbp-tooling-profiles-and-marketing.md (the embed's `CANVAS` input scope: D5), p770 (still a prompt in `docs/templates/todo-plan-prompts.txt`: its rebinding UI is this plan's controls page, D9), p355_save-menu-and-file-server-settings.md (its menu on the game menu, D8)

# Game UI Components

p800's eighth child: the pieces games build again and again (p800 §4.5), public on `aekasha/ui`
in a new `ui/game/` folder, and the `gameHud` example scene that uses all of them, playable with a
keyboard, a mouse or a gamepad without switching modes. Each piece is plain DOM through CMP and
works without the engine (p800 D1); where the engine knows something the DOM doesn't (an entity's
position, the camera, the device the player uses, the action maps), a small engine or toolkit
module feeds the kit piece, and the piece takes plain data.

Nothing breaks: new components, new engine and toolkit functions, one additive glyph change.

---

## 1. As found (2026-11-02, `main` at `b6be591a`, Engine 5.14.0 with the unreleased 6.0.0 work)

### 1.1 p800's p808 sketch, checked

p800 §4.5 and §5 hold, with these differences and additions:

- **The kit can't import the input, camera, ECS or loop modules.** `devTools/layout/layout.ts`
  allows `ui → kernel` only for `UI_KERNEL_HOOKS` (`Config.ts`, `SceneHooks.ts`, `BootHooks.ts`);
  a type-only import is allowed. So every engine-aware piece is split: the kit's DOM piece takes
  plain data (screen positions, a device, bindings in the kit's own shapes, as p803 D10's glyph
  does), and its engine side lives in the kernel or the toolkit (D2).
- **No "last used device" exists.** No active-device state or change event anywhere in `src`.
  The closest: `onGamepadConnected` / `onGamepadDisconnected` (`GamepadInput.ts`), an
  `ActionEventFn`'s DOM `Event` (`null` for the gamepad poll), and the `@internal`, single-slot
  `setKeyActionListener` (taken by the action layer). The gamepad's family (Xbox, PlayStation,
  Nintendo) isn't detected: `GamepadInfo.id` is passed through.
- **Gamepads in an embed:** in the `CANVAS` input scope the pads are read only while the canvas
  has focus (`GamepadInput.ts:127-133`), so once a HUD element takes focus (a menu's button) the
  gamepad goes silent: HUD navigation by gamepad can't work in an embed as it is (D5).
- **Action maps** (`kernel/input/Actions.ts`, p610): `createActionMap`, contexts with
  `setActionContextEnabled` ("a menu turns `GAMEPLAY` off and its own context on"), bindings as
  plain data, rebinding public on the handle (`map.getBindings(id)`, `map.setBindings(id, …)`),
  `ActionDef`'s `name` / `icons` "metadata for UI (a shortcuts list, a rebinding screen)". No
  persistence, no "capture the next input" helper; `getKeyChordLabel` and `GAMEPAD_BUTTON_NAMES`
  (the W3C standard mapping by position: `SOUTH`, `EAST`, …, `DPAD_*`, `HOME`) are public, and
  `doKeyChordsCollide` is exported but on no entry.
- **Keys in text fields reach the maps** (`Actions.ts`' `isEditableTarget` only skips
  `preventDefault`): a game action fires while a kit text field has focus. The settings menu's
  key capture must keep its key from the maps (D9).
- **The kit's runtime settings:** no setters for the theme, UI scale or motion. The styling guide
  (`hub/pages/features/ui-kit/styling/guide.md`) tells an app to write `data-aek-theme`,
  `--aek-ui-scale` and `--aek-motion` on the HUD root itself; the Hub's library page does so
  (`_components.ts`' `initSettings`); only the debugger has a `@internal` writer
  (`DebuggerRoot.ts`' `setDebuggerTheme`). The settings menu needs them (D10).
- **The entry:** `aekasha/ui` has 149 value names and 238 type names; p803 D12 said "p808
  revisits this if the entry passes about 150 names" (D3).

### 1.2 The engine side the anchors and the minimap use

- Per-frame hooks: `world.addSystem(stage, id, fn, order)` (`kernel/ecs/ECS.ts:410`); stages
  `MAIN → APP_PRE_PHYSICS → [APP_PHYSICS_STEP ×N] → APP_POST_PHYSICS → APP_LOGIC →
  APP_RENDER_SYNC → render → LATE_MAIN`. The `APP_*` stages stop while the app is paused, and a
  frame the max-FPS cap holds back skips the render and `LATE_MAIN`. `LATE_MAIN` runs after the
  render has updated every matrix, also while paused (a paused fly camera still moves the labels).
  Toolkit precedent: `registerFollowToolEffect` (`toolkit/ecs/effects/FollowTool.ts:179`).
- `getActiveCamera()` (`kernel/camera/Camera.ts:335`, on `aekasha`: the debug camera while it's
  on), `getCanvasSize()` (CSS px, `kernel/render/CanvasSize.ts:47`, on `aekasha`).
- The HUD root is a fixed, zero-size element at the canvas's origin (the full page, or a mount's
  container with `contain: layout`), so `position: fixed; inset: 0` under it covers the canvas
  exactly, as the viewports' layer does.
- An entity's position: `ComponentType.OBJECT3D`'s `matrixWorld` (the interpolated render pose
  after `POSE_PRODUCERS`) is the anchors' source; `TRANSFORM` is in parent space and its
  `getComponent` copies in `TYPED_ARRAY` mode. `world.isAlive(id)` checks the generation.
- Viewports (`aekasha/viewports`): `createViewport({ id, scene, camera, anchor, rect, size, … })`
  places its slot element in `#aekViewportsLayer` under the HUD root and renders where the slot's
  box is (`Viewport.slotElem` public; the JSDoc example is a minimap). A frame appended into the
  slot lines up by construction. The viewport renders into the main canvas, so the DOM can't clip
  it to a circle (D7).

### 1.3 The kit this builds on

- `components/InputGlyph.ts` (p803 D10): one key or a mouse input, `role="img"` with the spoken
  name; `InputGlyphInput` mirrors the `KEYBOARD` and `MOUSE` bindings; "p808 adds `'GAMEPAD'`".
- `components/ProgressBar.ts` (`role="progressbar"`, segments, a `scaleX` fill),
  `components/LoadingOverlay.ts` (spinner or bar, `showAsync` / `hideAsync`, `setText`),
  `components/RovingFocus.ts`, `components/Announcer.ts` (one polite announcer per kit root),
  `overlays/` (the stack's Escape and focus return, the focus trap, `showAnchored`, the tooltip,
  the popover, the menu, dialogs), `forms/` (the form, the property grid with
  `addPropertyGridItems`, every field), `data/` (the tabs, the list and its reorder's
  Alt+arrows and announcements).
- `core/Motion.ts`' `getMotionFactor`, `core/ThemeWatch.ts` (`@internal`), `core/Window.ts`'
  `getWindowSize` / `onBoundsResize` (`@internal`, the HUD's bounds).
- The tokens have every role this needs (`danger`, `warning`, `success`, `info` with `-soft`, the
  chart colours, motion, z-layers); D6's game tokens are component properties, not roles.

### 1.4 Around it

- Hub: the UI kit section's group pages (`core` 10, `forms` 15, `data` 18, `overlays` 20,
  `styling` 30, `library` 40), each an `index.html` with `intro.md` and `guide.md`, `aek:covers`
  naming a `##` of `src/_engine/ui/CLAUDE.md`; the library's demo modules and checks
  (`hub/_assets/ts/_library/<group>.ts`, `<group>Checks.ts`, merged in `_components.ts` and
  `_componentChecks.ts`), `COMPONENT_USES` (`devTools/hub/generated/components.ts`), the recipe in
  `hub/CLAUDE.md`. Example pages at `aek:order` 10-80 (`ui-kit` 75, `embed` 80).
- The example scenes in `src/app/examples/` (one folder each; registration generated by the
  gather); `devTools/verify/scenes.config.ts` lists exceptions only, so a new scene runs in
  `yarn verify:scenes` without an entry.
- SBP: `_engine/ui/data/: 0` in the `app` and `uiKit` profiles' `modules` (p805 D13); the
  `uiKit` profile's data window is a chunk of its own with a budget.
- Versions: `main` holds the unreleased engine 6.0.0 work; p807 joined `CHANGELOG.md`'s
  "Unreleased — engine-6" entry with no bump (p807 D2).

---

## 2. Decisions (proposed 2026-11-02, for review)

### D1. Scope

All of p800 §4.5, as these pieces (`ui/game/` unless said otherwise):

| Group      | Pieces                                                                                                               |
| ---------- | -------------------------------------------------------------------------------------------------------------------- |
| Input      | the glyph's gamepads (`components/InputGlyph.ts`), `createInputPrompt` and `setPromptDevice`; the kernel's device tracker |
| Bars       | `createResourceBar` (health, stamina: segments, a damage trail, a heal flash, thresholds), `createCooldown`          |
| Aim        | `createCrosshair` (shapes, spread, a target state), its `showHitMarker`                                              |
| Text       | `createNotificationFeed`, `createObjectiveTracker`, `createSubtitles`, `createDialogueBox`                           |
| Navigation | `createSpatialNavigation` (arrows, d-pad, focus groups, back), `createRadialMenu`, `createGameMenu` (pause and the like) |
| Items      | `createItemSlot`, `createHotbar`, `createInventoryGrid` (moves by pointer, keys and gamepad), `createItemDetails` (a tooltip's stats with a comparison) |
| Settings   | `createSettingsMenu` (pages of property grid items), `createControlsPage` (rebinding), `setKitPreferences`           |
| World      | `createWorldAnchorLayer` and `createCompass` (kit), `createMinimapFrame` (kit), the toolkit's `registerWorldAnchorSync` |
| Loading    | the loading overlay's `tips` (no new piece: `components/LoadingOverlay.ts` gains it)                                 |

- **Moved or dropped:** the loading screen is the loading overlay with tips and an optional image,
  not its own piece (the overlay is already the scene loader's, p803); a circular minimap is out
  (the viewport renders into the main canvas, which the DOM can't clip: D7); a 3D in-world UI
  stays out (p800).
- **Out:** saving the player's settings (a piece reports, its owner persists: p804 D1; the
  example saves to `localStorage`, the Hub guide shows it), audio (the settings menu's audio page
  is an app's sliders on the property grid), a quest system (the tracker shows what it's given).

### D2. Layout and the engine boundary

- **`ui/game/`**: a layout rule in `UI_KIT_FOLDERS` (`devTools/layout/layoutRules.ts`, after
  `data`). A piece with more than one module gets a folder (`game/inventory/`, `game/anchors/`).
  Every module DOM-only (p800 D1); the input glyph stays in `components/` (it's p803's).
- **The kernel** (`kernel/input/`): the device tracker (D5) and the gamepad family, public on
  `aekasha` (they're input facts any app reads, not UI).
- **The toolkit** (`toolkit/ecs/effects/WorldAnchorSync.ts`, on `aekasha/toolkit/ecs`): the one
  system that feeds the anchor layer from entities and the active camera (D7). Not an engine
  feature: it's an opt-in system an app registers, as `FollowTool` is, so it costs nothing until
  used and needs no `FeatureContext`.
- **The wiring between them** (a gamepad's d-pad to the spatial navigation, the device tracker to
  the prompts, the action maps to the controls page) is a few lines of app code, in the example
  and on the Hub guide, not a module: each is one call per event, and an app's menu map is its own.

### D3. One entry

`aekasha/ui` stays one entry (p803 D12's reasoning holds: `sideEffects` keeps only what's used,
so a sub-entry saves no bytes). About 25 value names join it (≈175). Revisit at about 250, or if
the dev server's load of the entry (every module it re-exports) is felt; recorded in
`src/_engine/ui/CLAUDE.md`.

### D4. The pieces' common rules (p800 D1-D8, for a game's HUD)

- **Per-frame setters** (a bar's value, a cooldown, the crosshair's spread, an anchor's position,
  the compass's heading) write in place, compare with the shown value first and write nothing when
  it's unchanged, allocate nothing (p800 D7's per-frame rule): a game calls them every frame.
  Their motion is a CSS transition or animation started by a state change, never a per-frame JS
  animation, except the anchor layer's transform writes (D7).
- **Colour is never the only signal** (p800 D6): a threshold sets a `data-state` and an icon or
  text, a hit marker's kind changes its shape, a comparison has a sign and an arrow.
- **Assistive tech:** a bar is a `role="meter"` (a value in a known range, not a task's progress)
  with `aria-valuetext` ("72 of 100"); the crosshair, the hit marker, the anchors' arrows and the
  compass's strip are `aria-hidden` decoration, with the deviation in their JSDoc (the game says
  it in its sound and its feed); the feed, the subtitles, the dialogue line and the tracker's
  changes announce through `aria-live` (polite) once, not per character or per frame.
- **Reduced motion** (`getMotionFactor`, `--aek-motion`): the damage trail and the heal flash
  jump instead of easing, the typewriter shows the whole line, the feed's items appear without
  sliding, the cooldown's sweep steps once a second (the remaining time is information: it stays).
- **Game tokens** are component properties with role fallbacks (`--aek-resource-bar-color`,
  `--aek-crosshair-color`, `--aek-crosshair-size`, …), not new roles: the contrast test's pairs
  stay as they are.
- **Density:** the game pieces are for the default density; the compact one works but isn't
  their target.

### D5. The device tracker and the prompts (p800 §4.5's device-aware prompts)

- **Kernel** (`kernel/input/InputDevice.ts`, on `aekasha`): `getLastInputDevice()` →
  `{ device: 'KEYBOARD_MOUSE' | 'GAMEPAD' | 'TOUCH', family? }` and
  `onLastInputDeviceChange(fn)` → remover. Its listeners (`keydown`, `pointerdown` with the
  pointer type, `wheel`; a gamepad's button or a stick past the deadzone) are added on the first
  `onLastInputDeviceChange` or the first read, by the input scope (`setInputScope`), and removed
  with `removeAllInputListeners`. The gamepad side reads the pads in the action layer's poll when
  it runs, else in its own `requestAnimationFrame` poll that runs only while a listener exists
  and a pad is connected. A mouse move alone doesn't switch from the gamepad (a bumped desk), a
  click or a key does.
- **Family:** `getGamepadFamily(id)` → `'XBOX' | 'PLAYSTATION' | 'NINTENDO' | 'GENERIC'` from
  `Gamepad.id` (vendor ids `045e` Microsoft, `054c` Sony, `057e` Nintendo, and the names browsers
  give), on `GamepadInfo` as `family`.
- **The embed's gamepads** (§1.1): in the `CANVAS` scope a pad is read while focus is inside the
  mount's container (the canvas or the HUD), not only on the canvas.
- **The kit:** `InputGlyphInput` gains `{ device: 'GAMEPAD', button }` and
  `{ device: 'GAMEPAD', stick: 'LEFT' | 'RIGHT' | 'DPAD' }` (the action bindings' shapes) and the
  glyph a `family` prop and `setFamily`. A face button is drawn by its family's label (Xbox
  `A B X Y`, PlayStation's shapes `✕ ○ □ △` drawn as SVG, Nintendo `B A Y X` by position, generic
  a diamond with the pressed one filled), neutral in colour (p800 D6: the brands' button colours
  would be colour as decoration; an app restyles `.aekInputGlyph__face[data-button]`), spoken by
  its name ("A button", "Cross button", "South face button").
- **`createInputPrompt({ bindings, label? })`**: shows, from an action's bindings, the one for the
  current prompt device (the first binding of that device; the keyboard's for touch, which has no
  glyph), and the label ("Interact"). `setPromptDevice({ device, family })` (module state of the
  kit, no listener at load) switches every prompt at once; a prompt subscribes on creation and
  unsubscribes on `cmp.remove()`. The app wires it in one line:
  `onLastInputDeviceChange(setPromptDevice)`.

### D6. Bars, cooldowns, the crosshair

- **`createResourceBar({ label, max, value, segments?, thresholds?, trail? })`**: a meter with a
  fill, a damage trail (a second fill that holds the old value for `trailDelayMs`, then eases down
  over `--aek-motion-slow`; a heal fills at once and flashes), segments as the progress bar's,
  thresholds (`[{ below: 0.25, state: 'danger', icon? }]`: the bar's `data-state` and an icon at
  its start), an optional value text (`showValue: 'fraction' | 'percent'`). `setValue`, `setMax`.
- **`createCooldown({ for?, durationMs? })`**: an overlay for any element (an icon button, a
  hotbar slot): a conic sweep from a registered `--aek-cooldown-progress` animated by CSS from
  the start time (no JS per frame), the remaining seconds as text (tabular), a ready flash.
  `start(durationMs, elapsedMs?)`, `cancel()`, `isRunning()`, `onReady`. The element it covers
  gets `aria-disabled` and an `aria-describedby` "Ready in 3 s" text updated once a second while
  running (D4: not per frame).
- **`createCrosshair({ shape, gap, thickness, size })`**: `'cross' | 'dot' | 'circle' |
  'chevron'`, drawn with CSS on tokens; `setSpread(px)` (a transform per arm, on change only),
  `setState('default' | 'target' | 'blocked')` (a ring appears for a target, a slash for blocked:
  not colour alone), `showHitMarker({ kind: 'hit' | 'critical' | 'kill' })` (an X whose size and
  stroke differ per kind, restarting its CSS animation; under reduced motion it shows still for
  the same time). Centred on its container (the HUD's bounds by default).

### D7. World anchors, the compass, the minimap frame

- **`createWorldAnchorLayer({ cullDistance?, edgePadding? })`** (kit, `game/anchors/`): a layer
  over its container (`position: absolute; inset: 0`, `pointer-events: none`), and anchors in it:
  `layer.addAnchor({ content, offset?, offScreen?: 'hide' | 'clamp', maxDistance? })` → an anchor
  handle (`setContent`, `remove`). `layer.update(viewProjection, width, height, cameraPosition)`
  takes the matrix as 16 numbers (a `THREE.Matrix4`'s `elements` as it is: no three import) and
  each anchor's world position from `anchor.setPosition(x, y, z)` (written by its owner, or the
  toolkit's sync); it projects, hides behind the camera, clamps to the edge with an arrow turned
  to the target for `'clamp'` (a waypoint), culls by distance, and writes
  `transform: translate3d(…)` only when the rounded pixel position changed (no allocation: a
  kept `Float64Array` scratch). The layer sorts nothing per frame; a nearer anchor's `z-index` is
  set only when the order changes (`depthSort`, off by default).
- **The toolkit's `registerWorldAnchorSync(world, { layer })`** adds one `LATE_MAIN` system (after
  the render's matrix updates, and it runs while paused) that, for every entity with the
  `WORLD_ANCHOR` component (`{ anchor, offsetY? }`), reads its `OBJECT3D.matrixWorld` position
  into the anchor, then calls `layer.update` with the active camera's
  `projectionMatrix × matrixWorldInverse` and `getCanvasSize()`. A removed entity's anchor goes
  with the component's removal hook. Measured with 200 anchors by the perf-auditor agent (p800
  §5) in Phase 7.
- **`createCompass({ markers?, fov? })`** (kit): a strip of the bearings (N, E, S, W and ticks)
  scrolled by `setHeading(radians)` (a transform, on change only), markers at bearings
  (`setMarker(id, { bearing, label, icon? })`, a waypoint's), `aria-hidden` with the heading as a
  visually hidden text updated when its rounded cardinal changes ("Facing north-east"). The app
  (or the toolkit's sync, `compass` option) gives it the camera's yaw.
- **`createMinimapFrame({ title?, zoom? })`** (kit): a frame for a viewport's slot (an app appends
  it into `viewport.slotElem`, which places it), with a north mark, the player's arrow at its
  centre (`setPlayerHeading`), optional zoom buttons (`onZoom`), a label for assistive tech.
  Square with the radius token; a circle would need the viewport to clip itself (out: D1).

### D8. Navigation and menus

- **`createSpatialNavigation({ root, onBack?, wrap? })`**: moves focus by position among the tab
  stops under `root` (the focusable elements with `tabindex >= 0`, not `inert`, not hidden, one
  per roving composite) with `move('up' | 'down' | 'left' | 'right')`, and reads the arrow keys
  itself on `root` (`handleKeys`, default true). A composite that uses arrows (a tab list, a
  radio group, a slider, a grid, a text field) keeps them; the gamepad's `move` still leaves it
  from its edge (a composite's element at the edge in that direction). Focus groups:
  `[data-aek-focus-group]` elements are tried first in the direction, then the nearest group's
  remembered element; `nextGroup` / `previousGroup` (a shoulder button). `back()` calls `onBack`
  (or the overlay stack's Escape). The scoring: the distance along the direction plus twice the
  perpendicular offset, of the candidates whose box lies ahead (the usual spatial navigation
  heuristic), on boxes read once per move.
- **`createRadialMenu({ items, label })`**: items round a ring (`role="menu"`, `menuitem`s,
  `aria-label`), opened with `open()` at its container's centre or a point; picked by the pointer's
  angle from the centre, by `setDirection(x, y)` (a stick: past a dead zone it highlights, the
  release picks: the app calls `select()`), or by arrow keys (round the ring) and Enter; Escape
  or the centre closes. The centre shows the highlighted item's label and its description.
- **`createGameMenu({ title, items, onBack })`**: a full-screen or panel menu of large buttons
  (the pause menu, a title screen), a modal dialog on the overlay stack (its focus trap and
  return), with a spatial navigation inside it and "back" on Escape, the gamepad's `EAST` (through
  the app's map) and a visible "Back" button; `items` are buttons or pages (a page swaps the
  panel's content, a settings menu, with a back stack). The pause menu is this with Resume first.

### D9. The settings menu and the controls page

- **`createSettingsMenu({ pages, onChange })`**: pages on the tabs (p805), each a property grid
  from `PropertyGridItem`s (p804), so an app writes its graphics and audio settings as data; the
  menu reports each change and its owner persists (p804 D1). Its "Reset page" and "Reset all"
  set every field's default (the binding's `default`).
- **`createControlsPage({ actions, onRebind })`**: one row per action (its `name`, its glyphs per
  device), with a capture button per device column (keyboard and mouse, gamepad). Capturing waits
  for the next key, mouse button or gamepad button (Escape cancels, the gamepad's capture polls
  `navigator.getGamepads()` only while capturing: a DOM API, no engine), stops that event in the
  capture phase on `window` so no action map sees it (§1.1), shows a conflict with another
  action's binding (a warning, with "Swap" and "Keep both"), and reports
  `onRebind(actionId, device, binding)` in the action bindings' shapes. "Reset to defaults". The
  app applies it with `map.setBindings` and persists it; the example's 20 lines are the Hub's
  snippet.
- **`setKitPreferences(root, { theme?, uiScale?, reducedMotion?, density? })`** (`core/`): writes
  `data-aek-theme`, `--aek-ui-scale`, `--aek-motion` and `data-aek-density` on a kit root (the HUD
  root by default), the styling guide's three manual writes as one call, and
  `getKitPreferences(root)`.

### D10. Text

- **`createNotificationFeed({ max, durationMs })`**: short lines in a corner ("+25 gold", "Quest
  updated"), each with an optional icon and tone; the newest on top, merging a repeat into "×3"
  (by `key`), fading after `durationMs` (held while hovered or focused), announced politely.
  Not the toaster: no dismiss, no actions, game-styled, many at once.
- **`createObjectiveTracker({ title })`**: objectives with optional counts ("Collect crystals 3 / 5")
  and sub-steps, `setObjective(id, …)`, `complete(id)` (a check, struck through, then removed
  after a moment), a list (`role="list"`); a completion is announced.
- **`createSubtitles({ maxLines })`**: `show({ text, speaker?, durationMs })`, lines stacked at the
  bottom, the speaker's name in its own colour property and bold (not colour alone), size and
  background as custom properties (an app's subtitle size setting), `aria-live="polite"`.
- **`createDialogueBox({ onAdvance })`**: a speaker, an optional portrait (an element the app
  gives), a line revealed by a typewriter (`charsPerSecond`; the whole line at once under reduced
  motion; the reveal is `aria-hidden`, the full line in a live region when it starts), Enter /
  Space / click to skip the reveal and then to advance, `choices` as buttons in a group (arrow
  keys, numbers 1-9), a "next" indicator.

### D11. Items

- **`createItemSlot({ item?, size?, keyHint? })`**: a square button with an item's icon (an
  element or an image URL), a stack count (bottom right, tabular), a rarity or tone as a border
  property and a `data-rarity` (with a text for assistive tech), an optional key hint (the glyph
  or a `Kbd`) and a cooldown (`createCooldown` on it). `setItem`, `setCount`, `setSelected`.
- **`createHotbar({ slots, onUse })`**: a row of slots (`role="toolbar"`, roving focus), a
  selected slot (`aria-pressed`), `select(index)` / `selectNext(±1)` for the wheel and the
  shoulder buttons, the number keys' hints.
- **`createInventoryGrid({ columns, rows, items, onMove, canMove? })`**: an APG grid of slots.
  Moves: pointer drag (pointer events, so touch works too: a lifted ghost, the target slot
  highlighted, a swap or a merge of stacks), and the keys: Enter or Space picks the focused item up
  (`aria-grabbed`'s successor: the row's state in text, announced), arrows move the focus, Enter
  drops (a swap), Escape puts it back; the gamepad does the same through the spatial navigation's
  keys and the app's `SOUTH`. `onMove(from, to)` reports, `canMove` vetoes (a slot type). Several
  grids (a chest and the bag) move between each other through one `createItemDragGroup`.
- **`createItemDetails({ item, compareTo? })`**: the content for a tooltip or a popover (the
  kit's): the item's name, tone, description, and its stats as rows, each with a comparison
  against `compareTo` (an up or down arrow, a sign and the difference, in the status roles:
  better `success`, worse `danger`).

### D12. Size

- Every `ui/game/` module is 0 in the first download of the `app`, `banner` and `uiKit` profiles
  (`modules: { '_engine/ui/game/': 0 }`, as p805 D13), and the device tracker is in no first
  download either (a profile that doesn't call it doesn't bundle it).
- The `uiKit` profile gets a game window (a resource bar, a hotbar with a cooldown, a feed, a
  prompt) as its own chunk with a budget: what a game HUD costs, the number the Hub shows.
- The example scene's chunk is the app's; it's not budgeted beyond the `app` profile's lazy
  scenes.

### D13. Tests and checks

- Each piece's `*.test.ts` on `testing/KitDom.ts`: its keys, its ARIA after each action, its
  disposal (`countListeners`: none after `cmp.remove()`), its per-frame setters writing nothing
  when unchanged (a `MutationObserver` count or a write spy). The anchor layer's projection,
  clamping and culling as maths tests; the spatial navigation's choice on fixed boxes (linkedom
  has no layout: the module reads boxes through one function the test replaces).
- The kernel's device tracker and family in `kernel/input/` tests.
- `yarn verify:ui`: each piece's box on the library page, its states and its keyboard scripts.
- `yarn verify:scenes`: the `exampleGameHud` scene, its baseline recorded.
- `yarn verify:embed`: the `uiKit` profile's game window in its layouts.

### D14. Documentation and the example

- **`src/app/examples/gameHud/`** (`exampleGameHud`): a small arena (a floor, a few physics
  crates, three "NPC" markers, a waypoint), the player a character (the character example's
  setup) or a flying camera if that's simpler in Phase 8; nameplates and a waypoint anchor, a
  health and a stamina bar, a hotbar with cooldowns, the feed, the tracker, a dialogue with an
  NPC, subtitles, the radial menu on a key or the gamepad's `RIGHT_SHOULDER`, the pause menu and
  the settings menu (UI scale, theme, reduced motion, subtitles' size, the controls page),
  prompts that follow the device, the crosshair with hit markers on the crates, the compass and a
  minimap viewport. One action map for play and one for menus (`MENU` context), switched by the
  pause menu.
- **Hub:** the UI kit section's `game/` page (`aek:covers "Game UI"`, a new `##` in
  `src/_engine/ui/CLAUDE.md`), each piece's section with `::: demo`, reference table and keys;
  both component library pages' boxes; `hub/pages/examples/game-hud/` with the walkthrough
  (`#region`s in the example); the input page's device tracker (`aek:covers` of the input
  `CLAUDE.md`'s sections as needed); the toolkit's anchor sync on its page.
- `src/_engine/kernel/input/CLAUDE.md` (the tracker), `src/_engine/ui/CLAUDE.md` (Game UI),
  `readme.md` (Features: the game UI pieces; Examples' list).

### D15. Branch and versions

- **Branch:** `p808-game-ui-components` from `main`, merging into `main` (p800 §6).
- **Versions:** as p807 D2: `main` holds the unreleased engine 6.0.0, so this plan's changelog
  sections join the "Unreleased — engine-6" entry (Engine, Toolkit, App) with no bump; the
  toolkit's and the app's minors are made at the engine-6 merge, the note under their headings
  says so. `yarn checkVersions --against main` fails at the PR on purpose, as p806's and p807's
  did.

---

## 3. Phases

Each phase is verified with `yarn test`, `yarn lint`, `tsc` (the Stop hook), and what it names.
A phase that adds a piece adds its tests with it; the Hub boxes come in Phase 8 with the rest.

### Phase 0: grounding and baselines — done

1. §1 checked against `main` (done when this plan was written: §1).
2. The scene baselines recorded on `main` (`yarn verify:scenes --update`), `yarn verify:baselines`
   and `yarn sbp --profile all` run on `main` for the before figures (`uiKit`'s first download,
   the `ui/` groups).
3. p800's Blocks line and §5's p808 entry point here; this plan's status `in progress`.

As built:

- The scene baselines were recorded on the branch's first commit-less state (the plan file only,
  so `main`'s code at `b6be591a`), on macOS (the local Chromium's WebGPU).
- The before figures for the bundle, the API and the SBP profiles are the committed baselines
  (`devTools/verify/baselines/`, `sbp`'s baseline): `main`'s, so no separate run was made.

### Phase 1: groundwork — the folder, the device tracker, the glyph's gamepads, the prompts — done

1. `ui/game/` in `UI_KIT_FOLDERS` with its doc line.
2. `kernel/input/InputDevice.ts`: `getLastInputDevice`, `onLastInputDeviceChange`,
   `getGamepadFamily` (D5); `GamepadInfo.family`; the `CANVAS` scope's gamepad focus rule (D5);
   on `aekasha`; tests.
3. The glyph's `GAMEPAD` inputs and `family` (D5), its tests; the Hub's glyph text names the
   gamepads.
4. `game/InputPrompt.ts`: `createInputPrompt`, `setPromptDevice` (D5), tests.
5. `core/KitPreferences.ts`: `setKitPreferences`, `getKitPreferences` (D9), tests; the styling
   guide's manual writes replaced by it.

As built:

- **The scope's root:** `setInputScope(scope, root?)` (`InputState.ts`, `@internal`) keeps the
  `CANVAS` scope's root, which `mountAekasha` passes (its container); `getInputScopeRoot()`.
  `GamepadInput.ts`' `isInScope` reads the pads while the focus is on the canvas or inside the
  root (`InputScope.test.ts`' new case).
- **The family** is its own module, `kernel/input/GamepadFamily.ts` (`getGamepadFamily`, the
  `GamepadFamily` type), so the tracker doesn't import `GamepadInput.ts` and its renderer import.
  `GamepadInfo.family` is set by `toInfo`. Vendor ids from Chrome's `Vendor: 054c` and Firefox's
  `54c-9cc-` prefix (leading zeros dropped), else the names.
- **The tracker** (`kernel/input/InputDevice.ts`) always polls the pads with its own
  `requestAnimationFrame` loop, not the action layer's poll (D5 said "in the action layer's poll
  when it runs"): the action layer polls only while a map has a gamepad binding, and sharing it
  would have tied the two modules together for one `getGamepads()` call a frame while a pad is
  connected. The loop runs only while the tracker listens and a pad is connected
  (`gamepadconnected` starts it; it stops on the first frame with none). Its listeners are added
  again by the next read or callback after `removeAllInputListeners`, as the devices' are.
- **The glyph's parts:** the gamepad attributes are on the glyph's element (`data-family`
  lowercased, `data-button`: a button's name, `STICK_LEFT`, `LEFT_X`; `data-shape`), not on a
  `.aekInputGlyph__face` part as D5 wrote; the button's text is `.aekInputGlyph__label`. The
  types are `InputGlyphFamily`, `InputGlyphGamepadButton` and `InputGlyphGamepadInput`
  (`components/GamepadGlyphs.ts`, `@internal` drawing, its types on the entry). Shown labels:
  Xbox `LB RB LT RT View Menu LS RS Xbox`, PlayStation `L1 R1 L2 R2 Share Options L3 R3 PS`,
  Nintendo `L R ZL ZR − + LS RS Home`, generic `L1 R1 L2 R2 Select Start L3 R3 Home`.
- **The prompt** also exports `getPromptDevice`. Its glyphs are child CMPs (the CMP registry),
  kept and redrawn in place on a device change, the extra ones removed.
- **Docs so far:** the input and kit `CLAUDE.md` lines, the core guide's key hints section, the
  input glyph's library texts and demo (a row per family) with a check, and the styling guide
  (`setKitPreferences` in place of the manual writes, a "settings menu" tip). The prompt's and
  the preferences' library boxes and the `game/` page are Phase 8's.
- The entry: 154 value names (149 + `createInputPrompt`, `getPromptDevice`, `setPromptDevice`,
  `getKitPreferences`, `setKitPreferences`).

### Phase 2: bars, the cooldown, the crosshair — done

`createResourceBar`, `createCooldown`, `createCrosshair` with `showHitMarker` (D6), each with its
stylesheet and tests.

As built:

- **The resource bar** (`game/ResourceBar.ts`): D6's thresholds take a `text` (the word shown in
  `.aekResourceBar__status` and read in `aria-valuetext`, '18 of 100, Low'), not an `icon`; the
  lowest `below` that holds applies. `flashAbove` (default 0.05 of the maximum) keeps a regen
  tick from flashing. The trail is a CSS transition with a delay
  (`--aek-resource-bar-trail-delay` × `--aek-motion`), so a drop needs no timer and a drop
  during the hold restarts it from where the trail is; only a heal eases the fill
  (`data-change`). The flash restarts by alternating two animation names (`data-run` 1 / 2), the
  pattern the cooldown and the hit marker use too: no reflow, no timer. The texts are written
  only when the rounded value or the percent changes. Segments are dividers drawn by a repeating
  gradient over one fill (`--aek-resource-bar-segments`), not the progress bar's parts.
- **The cooldown** (`game/Cooldown.ts`): D6's `for` prop is `target`. The sweep is
  `conic-gradient` on `@property --aek-cooldown-progress` (1 → 0), animated on the sweep element
  (a registered property that doesn't inherit), its duration, delay and timing inline: linear, or
  `steps(seconds)` when `getMotionFactor` is 0 at the start. One `setTimeout` chain a second
  writes the seconds and the target's description, a `hidden` span appended to the target (an
  `aria-describedby` reference reads hidden text, and hidden content isn't part of the target's
  name); `aria-disabled` and `aria-describedby` are put back as they were. The shade's default is
  the text colour at 30 % (`color-mix`): the backdrop token, a dark scrim, vanished on the dark
  theme's surfaces (seen in Chromium, both themes).
- **The crosshair** (`game/Crosshair.ts`): fixed at 50 % / 50 % (the HUD root is a zero-size
  fixed element, so an absolute child can't centre on it), so it goes on the HUD root, not a box.
  The hit marker's 250 ms is fixed (information), with a still variant (`data-still`) when
  `getMotionFactor` is 0. The `blocked` slash is in `--aek-danger` with the arms muted.
- **Looked at in Chromium** (both themes) through a throwaway page served by Vite from the
  gitignored `.cache/p808view/` (a `vite.config.mts` aliasing `aekasha/ui` to the entry, and
  `devTools/verify/browser.ts`' `launchChromium` from a `tsx` script; `page.evaluate` takes a
  string, since `tsx`'s `__name` helper isn't in the page). Not kept: Phase 8's library boxes and
  `yarn verify:ui` are the lasting check.
- **Size:** `yarn verify:baselines --update` recorded the names; the bundle baselines came out
  as `main`'s (nothing in a first download).

### Phase 3: text — done

`createNotificationFeed`, `createObjectiveTracker`, `createSubtitles`, `createDialogueBox` (D10);
the loading overlay's `tips` (D1).

As built:

- **The feed** (`game/NotificationFeed.ts`): a `ul` (named, default 'Notifications') that places
  itself, `placement` a corner of the HUD's bounds (fixed, default `'top-right'`) or `'inline'`
  (a panel's flow, the library's box). `add({ text, spokenText?, key?, icon?, tone?, durationMs? })`
  and `clear()`; `icon` is a registered icon's name (as a window's), `tone` the badge's
  `BadgeTone` (a stripe and the icon's colour). Each line's shown text and count are
  `aria-hidden`, a visually hidden `__spoken` says it ('25 gold, 3 times'). Held while hovered,
  focused, or the page is hidden (`visibilitychange`, as the toaster). A merge restarts the
  count's pop by alternating `data-run` 1 / 2 (Phase 2's pattern). Past `max` the oldest fades out
  (`data-state="leaving"`, `--aek-motion-base`, removed after 200 ms × the motion factor).
- **The announcer's `append`** (`components/Announcer.ts`): `announce(elem, text, { append: true })`
  joins a pending text after a full stop instead of replacing it, so a feed's lines or a
  tracker's changes that come together (an objective complete and the next one new) are all read.
  The feed and the tracker announce with it. A test that ends with an announcement pending runs
  its timers before `useRealTimers` (the region outlives the test, and a dropped fake timer would
  leave its pending text for the next test's append).
- **The shared placement:** `game/HudPlacement.ts`' `HudPlacement` type (the feed and the tracker;
  each stylesheet has its own five placement rules: the kit has no Sass partials).
- **The tracker** (`game/ObjectiveTracker.ts`): `{ title?, hideTitle?, headingLevel?, placement?,
  completeHoldMs? }` (default `'top-left'`, 2500 ms); `setObjective(id, { text, count?: { value,
  total }, steps?: [{ text, done? }] })` adds at the end or rewrites in place (steps by index), and
  makes a completed one active again; `complete`, `removeObjective`, `hasObjective`, `setTitle`.
  The title is a `p` or a heading, naming the `ul` (`role="list"`). Read: a new objective ('New
  objective: Collect crystals, 0 of 5'), a changed count, a step newly done, a completion; a text
  change alone isn't. The hold isn't times the motion factor (information); the fade is. The
  check is drawn by CSS in `--aek-bg` on `--aek-success` (`--aek-on-accent` would be light on the
  dark theme's light green). `hidden` while empty, with its own `[hidden]` rule.
- **The subtitles** (`game/Subtitles.ts`): `{ maxLines?, placement?: 'bottom' | 'top' | 'inline' }`
  (2, `'bottom'`), `show({ text, speaker?, speakerColor?, durationMs? })`, `clear()`. The element
  is the live region (`aria-live="polite"`, `aria-relevant="additions"`), not the announcer: a line
  is one appended `p`, read once, speaker first ('Mara: Over here!', the ': ' a
  `__separator` span an app can hide). It carries `KEEP_LIVE_ATTR`, so as a direct child of the
  HUD root it stays live under a modal's `inert`. A line's default time is from its length (1000 +
  65 ms a character with the speaker's, at least 2000: about 15 characters a second). Newest last;
  past `maxLines` the oldest goes at once; a line fades in over `--aek-motion-fast` and goes
  without a fade. `speakerColor` is the line's `--aek-subtitles-speaker-color` on its name; the
  size is `--aek-subtitles-font-size` (default `--aek-font-size-xl`), the background
  `--aek-subtitles-bg` (the page's at 80 %: themed, like the rest of the kit).
- **The dialogue box** (`game/DialogueBox.ts`): D10's `{ onAdvance }` with `onChoice(index)`,
  `charsPerSecond` (40; 0 at once), `label`, `placement: 'bottom' | 'inline'`. The line and its
  speaker, portrait and choices are one `setLine({ text, speaker?, speakerColor?, portrait?,
  choices?: [{ label, disabled? }] })` (`null` empties: `data-state="empty"`, `display: none`);
  `confirm()` (what Enter, Space and a click do: the whole line, then `onAdvance`; a gamepad's
  `SOUTH` calls it), `choose(index)`, `isRevealing()`, `focus()` (the first enabled choice, else
  Continue: an app calls it when a conversation starts, so Enter reaches the box).
  - The "next" indicator is a real `<button>` (Continue, a CSS chevron that bobs while the line
    waits, still at `--aek-motion: 0`), shown during the reveal too: Enter and Space click it
    natively. One `click` listener on the box: a choice's click picks it, any other confirms.
    Enter / Space on its own buttons are stopped (not prevented) before the action maps' bubble
    listeners (the window, or the canvas), so a map's Enter wired to `confirm()` doesn't act
    twice.
  - The typewriter is a `setTimeout` chain (at most a frame apart) that reads the elapsed time and
    writes two text nodes, `__shown` and `__rest` (`visibility: hidden`), by character offsets (a
    surrogate pair one character): no per-frame JS, no reflow. Reduced motion (a factor of 0 at
    the line's start) shows it at once.
  - Choices show when the reveal ends, as native buttons in a `role="group"` ('Choices'), each
    with its number (`__choiceKey`, `aria-hidden`; `aria-keyshortcuts`); the arrows (both axes,
    round, past a disabled one), Home / End, and 1-9 on the box. A pick is reported once per line.
    A disabled choice is the native `disabled` (read in browse mode, skipped by the arrows).
  - The focus that was inside the box stays inside when its element goes (Continue hidden for
    the choices, the choices replaced by the next line).
  - The whole line ('Mara: Over here!') is in a visually hidden `__spoken` and announced (the
    kit's announcer, `append`) when the line starts; the reveal and the speaker are `aria-hidden`.
- **The loading overlay's tips and image** (`components/LoadingOverlay.ts`, D1): `tips`,
  `tipIntervalMs` (7000, not times the motion factor: it's read), `tipLabel` ('Tip'), `setTips`;
  the first tip a random one, then in order, an interval run only while the overlay is shown or
  showing. The tip element is made with the first tips (the existing tests check the content's
  children exactly). Not live: a tip every few seconds would talk over the status. `image` (a URL)
  is a decorative `img` covering the overlay under the content, and `data-image` puts the content
  on a panel (`--aek-loading-overlay-panel-bg`). The scene loader's own overlay is unchanged.
- **The entry:** 158 value names (154 + `createNotificationFeed`, `createObjectiveTracker`,
  `createSubtitles`, `createDialogueBox`; the overlay's are props), and the `HudPlacement` type.
- **Looking at an entering animation headless:** Chromium renders no frame until the first
  screenshot, so a CSS animation is pending (`startTime: null`) until then and the shot shows its
  first keyframe; take one screenshot, wait, take the real one.

### Phase 4: navigation and menus — done

`createSpatialNavigation`, `createRadialMenu`, `createGameMenu` (D8).

As built:

- **The spatial navigation** (`game/SpatialNavigation.ts`): a behaviour on a root, not a component:
  `createSpatialNavigation({ root, onBack?, wrap?, handleKeys? })` (`root` an element or a CMP)
  returns `{ move, nextGroup, previousGroup, back, focus, dispose }`; `move` and the group moves
  return whether the focus moved (a sound's cue).
  - Candidates: `FocusTrap.ts`' `getFocusableElements` (so `tabindex="-1"` and unrendered ones
    out), not under `[inert]`, a native radio group's checked radio (else its first enabled).
  - The score as D8 (along + 2 × the gap across), the boxes wholly ahead (1 px tolerance) first,
    then the ones whose centre and far edge are ahead (an overlapping layout); a tie goes to the
    smaller centre offset. Boxes are `getBoundingClientRect`, which the test sets per element.
  - Groups: the focused element's group first; past its edge every other group is one target (its
    box), entered on its last focused element (a `focusin` listener records it), else its nearest.
    `wrap` goes round the focused element's group, else the whole root.
  - The risk's override is in: `data-aek-nav-up` / `-down` / `-left` / `-right` name an id.
  - Keys: one bubble `keydown` on the root, so it sees only the arrows no element under it used
    (the kit's composites stop theirs); it leaves a text entry's, a native radio's or range's, a
    slider's or spinbutton's and a focusable separator's (its own axis) alone; Escape calls
    `onBack` when there is one. A key it uses is prevented, stopped, its keyup swallowed.
  - The gamepad (D8's "leaves it from its edge", decided here): `move` sends a composite
    (`tablist`, `radiogroup`, `toolbar`, `listbox`, `menu`, `menubar`, `tree`, `treegrid`, `grid`)
    a synthetic arrow `KeyboardEvent` while it has an item ahead (so a d-pad walks a tab list, its
    selection following, and leaves it at the end instead of going round); a slider gets the moves
    along its axis; a text field is left at once; a native radio is checked by `click()` (a sent
    key does nothing native). The root's listener stops every sent key, so no action map sees it.
    A move with the focus in an open `menu` / `listbox` outside the root (a drop-down's list) is
    sent there; from anywhere else outside it, the focus goes in.
  - The focus moves with `focusVisible: true` (no keydown precedes a gamepad's move).
  - `back()` without `onBack` sends Escape to the overlay stack (its top entry's close).
- **The radial menu** (`game/RadialMenu.ts`): `{ items, label, onSelect?(id, index), onOpen?,
  onClose?, deadZone? }` → `{ cmp, open({ point?, highlight? }), close, isOpen, setDirection,
  select, getHighlighted, setItems }`; an item `{ id, label, description?, icon?, disabled? }`.
  - A layer fixed over the HUD's bounds while open (the pointer's direction read anywhere), the
    ring at the point (viewport px, clamped inside the bounds; the open measures `offsetWidth`,
    which the scale-in's transform doesn't change), item 0 at the top, clockwise.
  - It opens with nothing highlighted and the focus on the ring, so a stick's release right after
    picks nothing. `setDirection` uses the Gamepad API's axes (y down), writes only when the sector
    changes, and keeps the highlight inside the dead zone, so `select()` on the release picks it.
  - The real focus follows the highlight; the arrows go round (Right / Down clockwise), not
    skipping a disabled item (the kit menu's rule: its description says why); Enter / Space pick,
    Tab and Escape (the overlay stack's entry, not inert) close. A click picks the sector there,
    the backdrop's too; the centre closes; a touch picks where it lifts.
  - Its z-index defaults to `--aek-z-loading` (above the app's windows, below its dialogs). The
    highlight is opaque (the accent mixed into the surface: the soft accent over the backdrop read
    as muted in Chromium), with a border and a 1.15 scale; a disabled item's border is dashed.
- **The game menu** (`game/GameMenu.ts`): `{ title, items, onBack?, layout?: 'panel' |
  'fullscreen', backLabel?, wrap? (true), footer?, onOpen?, onClose? }` → `{ cmp, open, close,
  isOpen, back, openPage, getDepth, setItems, navigation }`; an item `{ id, label, description?,
  icon?, disabled?, onSelect?, page? }`, a page `{ title, items?, content? }`.
  - The command palette's pattern, not `openDialog` (a draggable window's header, id and LS are
    no use here): its element goes into the HUD root on `open` and out on `close`, an `inert`
    overlay stack entry whose `close` is Back, `trapFocus` on the panel (`role="dialog"`,
    `aria-modal`, named by the title), `--aek-z-dialog`.
  - Back: the page before (the focus back on the item that opened it), else `onBack`; without
    `onBack` the first page has no Back (a title screen: the button hidden, Escape does nothing).
    The Back button is in a footer, with the app's `footer` CMP (the input prompts) beside it.
  - Pages are CMPs under the body, the ones below `hidden`; a page is a `role="group"` named by
    its title. A page with a CMP `content` is kept between opens (moved last when opened again,
    removed with the menu); an items page and a function `content` are made on each open and
    removed on Back. `close` pops every page; `open` starts on the first.
  - Its spatial navigation (on the panel, `wrap` default true) is public as `navigation`: the
    app's gamepad calls `navigation.move`, `navigation.back()` is `back()`.
  - A disabled item is `aria-disabled` (a stop, its description read); a description is shown
    `aria-hidden` and read from a `hidden` copy by `aria-describedby`. Enter and Space on its
    buttons are stopped (not prevented) before the action maps.
  - The focused item: its border, a fill and a bar inside its start (outside, the scrolling body
    clipped it).
- **Looked at in Chromium** (both themes) with Phases 2-3's throwaway viewer (`.cache/p808view/`,
  `radial.ts`, `menu.ts`): the two fixes above came from it.
- **The entry:** 161 value names (158 + the three), and their types (`NavigationDirection`,
  `SpatialNavigation*`, `RadialMenu*`, `GameMenu*`).

### Phase 5: items — done

`createItemSlot`, `createHotbar`, `createInventoryGrid` with `createItemDragGroup`,
`createItemDetails` (D11).

As built:

- **The folder** is `game/items/` (D2 named `game/inventory/` as an example): the four pieces share
  the item type, `ItemTypes.ts`' `GameItem` (`{ id, name, icon?, image?, count?, rarity?,
  rarityLabel? }`, on the entry). D11's "an element or an image URL": `icon` is a registered
  icon's name or a function making the picture (called for each slot showing the item, since one
  element can't be in two slots), `image` a URL (an `img` with `alt=""`, `draggable=false` for
  the inventory's own drag).
- **The slot** (`game/items/ItemSlot.ts`): `createItemSlot({ item?, size?: 'sm' | 'md' | 'lg',
  keyHint?, selected?, cooldown?, emptyLabel?, onClick? })` → `{ cmp, cooldown, setItem, getItem,
  setCount, setSelected, isSelected }`. A native `<button>` named by a visually hidden `__spoken`
  ('Health potion, 5, Rare'; `emptyLabel`, default 'Empty slot'), the picture, count and key hint
  `aria-hidden`. `keyHint` is keys for `createKbd` (then the slot's `aria-keyshortcuts`) or a
  handle whose `cmp` is drawn (an input glyph); removed with the slot. `selected` (or the first
  `setSelected`) makes it a toggle (`aria-pressed`), so an inventory's slots aren't read as
  toggles. `cooldown: true | { onReady }` makes `slot.cooldown` (the Phase 2 cooldown on the
  button). `setItem` makes the picture again only when `icon` / `image` changed; `setCount` writes
  only a changed count and leaves the app's item object alone. The rarity: `data-rarity`, the
  border's `--aek-item-slot-rarity-color` (the stylesheet's `uncommon` success, `rare` chart-1,
  `epic` chart-3, `legendary` chart-5) and a 12 % tint, read in the name and shown as a word in
  the details (piece 4): the border isn't its only sign. An empty slot's border is dashed; a pressed
  one has rings outside and inside and a bar under it (distinct from the focus outline).
  `getRarityLabel` is `@internal`, for the details.
- **The hotbar** (`game/items/Hotbar.ts`): `createHotbar({ slots, label?, selected?, keyHints?,
  cooldowns?, onCooldownReady?, onUse?, size?, orientation?, placement?: 'bottom' | 'inline' })` →
  `{ cmp, slots, setItem, select, selectNext, getSelected, getSelectedItem }`; the slot count is
  set by `slots` (items or null).
  - `onUse(index, item)` is a slot's click, Enter or Space, the one callback: the app uses the item
    (an ability bar) or calls `select(index)` (a touch screen's hotbar). The hotbar binds no keys:
    the app's map calls `select` for the number keys and `selectNext(±1)` for the wheel and the
    shoulders. A running cooldown doesn't stop `onUse` (the cooldown's own rule: the action
    checks it).
  - Without `selected` there's no selection and the slots are plain buttons (an ability bar); the
    first `select` makes every slot a toggle. `select` writes only the old and the new slot; the
    tab stop follows it and it's announced ('Iron sword selected', the kit's announcer) only while
    the focus isn't on the bar (on the bar, the stop is where the player is and the toggle's state
    is read). `selectNext` goes round, from none 1 is the first and -1 the last.
  - `keyHints` default '1'-'9', '0' (the slots' `aria-keyshortcuts`), `false` for none, or an
    array of keys or handles by index. Keys: the toolbar's roving tab stop (`RovingFocus.ts`), the
    arrows along the orientation round, Home / End; Enter and Space stopped (not prevented) before
    the action maps.
  - `'bottom'` is fixed, centred at `--aek-hotbar-inset` (default `--aek-space-5`) from the
    bounds' bottom; a `md` bar reaches about 100 px up, over the subtitles' default inset (64 px),
    so an app with both raises `--aek-subtitles-inset` (Phase 8's example; the guide says so). A vertical bar puts the selected
    slot's bar at its start (`.aekHotbar:where(…) :where(.aekItemSlot…)::after`, one class).
- **The inventory** (`game/items/InventoryGrid.ts`, `ItemDragGroup.ts`):
  `createInventoryGrid({ label, columns, rows?, items, group?, canMove?, onMove?, size?,
  emptyLabel? })` → `{ cmp, slots, group, setItems, setItem, getItem, focus(index?) }`;
  `createItemDragGroup()` → `{ cancel, isHolding, getHeld }` (`HeldItem`: `{ item, grid, index
  }`). A grid without `group` makes its own. The group's code reaches its grids through a
  `WeakMap` (`useItemDragGroup`, `@internal`), each grid registering an `ItemDragHost`.
  - **The move** (`InventoryMove`): `{ item, target, kind: 'move' | 'swap' | 'merge', from,
    fromIndex, to, toIndex }`, `from` / `to` the grid handles. `merge` when the target has the
    held item's `id` and the item a `count` (the app adds them and keeps any rest). It goes to the
    `onMove` and `canMove` of the grid it lands in (the slot's rules are the target's: an
    equipment slot); the grid moves nothing itself, the app's records change and `setItems` shows
    them (D11's "reports").
  - **One action picks up and drops** (decided here, over D11's keys-only Enter): a click, Enter
    or Space (the button's own click) picks the focused item up and, on another slot, drops it; on
    its own slot puts it back. So the mouse can click-to-carry too, and a gamepad's `SOUTH` is a
    click on the focused slot. Escape (an overlay stack entry while held, so the spatial
    navigation's `back()` reaches it) and `group.cancel()` put it back, the focus back on its slot
    when it was in a grid. A veto keeps it held ('… can't go there').
  - **The pointer**: a press on an item moved 4 px is a drag (a window listener per press, so the
    pointer may leave every grid); the target is `document.elementFromPoint` under the ghost
    (`pointer-events: none`); released over no slot or a vetoed one puts it back; the click the
    release makes is ignored (the reorder's pattern). `touch-action: none` on the slots: a drag on
    a touch screen moves the item.
  - **The ghost** (`__ghost`, `aria-hidden`, `inert`): a clone of the slot, in the HUD root at
    `--aek-z-tooltip`, placed from the HUD root's corner (an embed's container); dragged, it keeps
    the point it was grabbed at under the pointer; held by a click or a key, it floats over the
    target slot's corner. Drawn at 0.8 so the target's mark shows round it. The marks:
    `data-held` (faded, dashed), `data-drop-target="allowed"` (an accent ring) or `"blocked"` (a
    danger border struck through: a shape, not colour alone), set on a focus, a mouse hover
    (held) or the pointer's slot (dragged).
  - **Keys**: the APG grid's (one roving tab stop over the slot buttons in `gridcell`s), but an
    arrow at an edge isn't used, so a spatial navigation round the grids (or the action maps) gets
    it: the bag to the chest by the arrows or a d-pad. Home / End in the row, Ctrl+Home / End.
  - **Assistive tech**: a pick says the item and the keys; every slot of every grid is described
    by one hidden 'Holding Iron sword' (an id added to each `aria-describedby` while held); a drop
    says what happened ('… moved to Bag, row 2, column 1' across grids, '… swapped with Bow',
    '… stacked'), the kit's announcer.
- **The tooltip's `content`** (`overlays/Tooltip.ts`, decided here: D11's "the content for a
  tooltip or a popover" met a text-only tooltip): `TooltipProps.text` is optional and `content`
  takes its place, a CMP added once and kept, or a function built on each show and removed on hide
  (a slot's tooltip shows the slot's item then); `data-content` widens it to 40ch with more
  padding; still never interactive, read as the anchor's description; `setText` does nothing on
  one. The popover was no fit (its trigger's click is the grid's pick). The overlays guide's
  Tooltips section shows it. Its cost: +179 B of script and +115 B of CSS in the tooltip's chunks
  (`DialogWindow`, `uiKitEmbed`), about 70 B gzip, recorded in the bundle baselines; no first
  download changed.
- **The details** (`game/items/ItemDetails.ts`): `createItemDetails({ item, compareTo?,
  compareLabel?, emptyLabel? })` → `{ cmp, setItem(item, compareTo?) }`. `GameItem` gained
  `description` and `stats` (`ItemStat`: `{ id, label, value, format?, lowerIsBetter? }`).
  - A header (`__name`, `__rarity`: the rarity's word, its colour a stripe at the header's start,
    not the text, which stays `--aek-text` for contrast), `__description`, the stats as a `dl`
    (`__stat` rows `display: contents` in a grid; compared, `data-compared` gives a third column and
    each `dd` is a subgrid, so the values and the differences line up), `__compare` ('Compared with
    Bronze dagger', `compareLabel`).
  - A comparison by stat id: the arrow says better (up) or worse (down), the sign which way the
    number went ('▼ +0.4 s': a longer attack time, worse), the colour the success or danger role,
    and a visually hidden text the words ('1.2 s, 0.4 s more, worse'); the same value a muted '='
    ('the same'); a stat only the other item has a row with '–' (lost by the change). The
    difference is rounded to 6 decimals before the app's `format` (1.2 − 0.8 was 0.3999…).
  - Compared with itself (the same object): no comparison. No item: `emptyLabel` ('Empty slot'),
    `data-state="empty"`.
  - D11's option 2, the details in a panel beside the inventory that follows the focused slot (a
    gamepad hovers nothing), is the same piece with `setItem` on the grid's `focusin`: Phase 8's
    guide and example show it.
- **Checked:** `yarn test`, lint, both `tsc`, the docs ratchet, `yarn verify:baselines --update`
  (the names; no debug code), `yarn hub:build`; each piece looked at in Chromium in both themes
  with the throwaway viewer (`.cache/p808view/`: `slot`, `hotbar`, `grid`, `details`), which
  moved the pressed slot's bar clear of its ring, shrank the drag ghost and kept its grab point,
  and aligned the details' columns.
- **The entry:** five value names more (`createItemSlot`, `createHotbar`, `createInventoryGrid`,
  `createItemDragGroup`, `createItemDetails`): 169 counting every value name of `index.ts`'
  `export { … }` lines, where Phase 4's commit counts 164 (its note's 161 was counted another
  way); and their types (`GameItem`, `ItemStat`,
  `ItemSlot*`, `Hotbar*`, `InventoryGrid*`, `InventoryMove`, `HeldItem`, `ItemDragGroup`,
  `ItemDetails*`).

### Phase 6: settings — done

`createSettingsMenu`, `createControlsPage` (D9).

As built:

- **The settings menu** (`game/SettingsMenu.ts`): `createSettingsMenu({ pages, label?, selected?,
  onSelect?, onChange?, onReset?, orientation?, labelWidth?, resetPageLabel?, resetAllLabel?,
  confirmResetAll?, resetDoneText? })` → `{ cmp, select, selectNext, getSelected, refresh,
  resetPage(key?), resetAll, getFields(key) }`; a page `{ key, label, icon?, items?, content?,
  onReset? }` (`content` after the items, the controls page's CMP, with its `onReset` the page's
  reset for it).
  - Inline content, not an overlay: a game menu page's `content` (a kept CMP) or a window's.
  - Every page's property grid (`resizable: false`, label column 45 %) is built at creation on one
    shared scheduler, so "Reset all" reaches a page never shown; the tabs add a page on its first
    selection (a function `content`), and the menu removes the ones they never added.
  - `onChange({ page, item, value, change })` after the item's own `onChange` (each field item's
    `onChange` and `onCreate` wrapped; the handles of the non-monitor fields collected): every
    write, the owner persisting on `change.last`. A reset reports each field it changes, then
    `onReset(key | null)` once (one save).
  - "Reset page" is disabled on a page with no field and no `onReset`. "Reset all" asks first
    (`confirmResetAll`, default true; decided here: D9 didn't say): an inline `role="group"` in the
    buttons' place, named by its question, the focus on Cancel, its danger button resetting; the
    focus leaving it (a game menu's Back, a click elsewhere) cancels it. No dialog (the windows'
    code in the chunk) and nothing a gamepad can't reach (a hold to confirm can't be held on one).
  - A reset from a button is announced ('Display reset to defaults', `resetDoneText`); the API's
    `resetPage` / `resetAll` aren't.
  - `selectNext(±1)` for the shoulder buttons, round, calls `onSelect`, and moves the focus to the
    new tab when it was in the menu (else it would stay in a hidden panel).
  - Enter and Space on its buttons stopped before the action maps (the game menu's rule).
  - **The field's `reset` reads the bound value first** (`forms/Field.ts`, decided here): it went
    through `binding.change`, which compares with the kept copy, so a field on a page not shown
    since the app changed its setting kept the default as its copy and a reset wrote nothing; it
    now syncs first as `setValue` does, and redraws when the sync changed the copy. The form's
    reset gets the same. And the menu's `refresh()` reads a page that isn't shown itself (the
    scheduler reads the shown fields only, so a hidden tab, or the whole menu out of the document
    in a closed game menu, would show old values).
- **The controls page** (`game/controls/`: `ControlsPage.ts`, `ControlsBindings.ts` (pure),
  `ControlsCapture.ts`): `createControlsPage<B>({ actions, onRebind, columns?, label?, family?,
  captureTimeoutMs?, showReset?, onCaptureChange?, texts? })` → `{ cmp, reset, setActions,
  setBindings, getBindings, isCapturing, cancelCapture, setFamily }`; an action `{ id, name,
  description?, type?, bindings, defaults?, group?, rebindable? }`, `B` the bindings' type (the
  map's `ActionBinding`, which passes as the kit's `ControlsBinding`: the prompt's
  `InputPromptBinding`, a type test checks it).
  - **`onRebind` reports the action's whole new list** (`{ action, bindings, column, reason:
    'rebind' | 'swap' | 'reset' }`), not D9's `(actionId, device, binding)`: the app's line is
    `map.setBindings(action, bindings)` and the page decides which binding a slot replaces. The
    `@example` widens a typed map to `ActionMap` (any map is one) to take a string id.
  - A native `table` (the action a row header; a column per device, `columns`): a cell rebinds
    the action's first binding in its column, a slot button per part (a button binding's one, a
    keyboard axis' `negative` / `positive`, a composite's `up` / `left` / `down` / `right`, decided
    here: D9 named a button per column); a stick, the mouse's movement and a locked action
    (`rebindable: false`) are shown, not rebound; a column without a binding has an empty slot
    for a button action only. A slot is named by its action, column, part and input.
  - The capture (D9's): the next key (a letter lowercased; Escape cancels and can't be bound), a
    mouse button (the keyboard column) or a gamepad button pressed after the start (the gamepad
    column; one held at the start, the `SOUTH` that clicked the slot, counts once released), in the
    capture phase on the window, every key stopped while it runs. A press of the other device, a
    touch, the window's blur and `captureTimeoutMs` (8000: a gamepad has no Escape) cancel. A
    part takes a key only (a mouse press there cancels). A mouse capture's click, auxclick, context
    menu and compatibility `mousedown` are dropped until the task after its release. A gamepad
    press reaches the action maps too (the poll is theirs): `onCaptureChange` is the app's cue to
    turn its menu map off.
  - The conflict (D9's): any key of another slot's part in the action's `group` (default one for
    all), or another part of the same action, asks under the row ("[E] Also bound to Interact.":
    the glyph and a text, a `role="group"`): Swap (the other gets the old input, in place in its
    key list; not offered when that would leave a part empty or put a mouse button in one), Keep
    both, Cancel; the focus on the first, the focus leaving it cancels (the settings menu's rule).
  - The same input again reports nothing. "Reset to defaults" (`showReset`, false in a settings
    menu, whose page `onReset` calls `reset()`) reports each action that differs from `defaults`
    (default the bindings at creation).
  - The gamepad column's family follows the input prompts' (`setPromptDevice`; an `@internal`
    `onPromptDeviceChange` in `InputPrompt.ts`), keeping the last gamepad's while on the keyboard;
    `family` / `setFamily` fix it.
  - Its texts are one `texts` object (15 strings, some functions), not a prop each: the language
    an app replaces.
  - Looks (seen in Chromium, both themes): a slot with an input is frameless (its key caps are the
    look; it fills on hover), an empty one dashed, a capturing one an accent ring that pulses and
    "Press a key"; the conflict a warning stripe on `warning-soft`.
- **The input prompt's bindings** (`InputPrompt.ts`, fixed here): `InputPromptBinding` typed an
  axis' and a composite's parts as one key, but the maps give key lists (`ActionKeys`), so a map's
  `up: ['w']` drew an array as a key. A part is now `PromptKeys` (a key or a list, the first shown;
  `PromptKeys` and `PromptKeyChord` on the entry), and `getBindingInputs` / `getKeyInputs` are
  `@internal` for the controls page.
- **Checked:** `yarn test`, lint, both `tsc`, the docs ratchet, `yarn verify:baselines --update`
  (the names; no debug code; no first download changed), the throwaway viewer
  (`.cache/p808view/settings.ts`, `controls.ts`): both pieces inside a game menu in both themes,
  and a real capture (a key with a conflict swapped by Enter, a right click captured with no
  context menu, Escape cancelling without the game menu's Back).
- **The entry:** 171 value names (`createSettingsMenu`, `createControlsPage`), their types and
  `PromptKeys`, `PromptKeyChord`.

### Phase 7: the world — done

`createWorldAnchorLayer`, `createCompass`, `createMinimapFrame` (D7); the toolkit's
`registerWorldAnchorSync` and its `WORLD_ANCHOR` component; the perf-auditor's pass with 200
anchors, its findings fixed or written down here.

As built:

- **The anchor layer** (`game/anchors/WorldAnchorLayer.ts`, its maths in `AnchorProjection.ts`):
  `createWorldAnchorLayer({ cullDistance?, edgePadding? (32), depthSort?, placement?: 'hud' |
  'inline' })` → `{ cmp, addAnchor, update, clear, getAnchorCount }`; `addAnchor({ content?,
  position?, offset?, align?: 'center' | 'above' | 'below', offScreen?, maxDistance? })` → `{ cmp,
  setPosition, setContent, setVisible, getState, getDistance, remove }`.
  - **`update(view)` takes one `WorldAnchorView`** (`{ viewProjection, width, height,
    cameraPosition }`), not D7's four positional arguments (the coding standards' options object
    past two parameters); the caller keeps one object and writes it each frame, so nothing is
    allocated.
  - `content` is a text or a CMP (removed with the anchor, or when `setContent` replaces it).
    `align` (decided here) puts a nameplate's bottom on its point; `offset` is screen px, not
    applied while clamped (a clamped anchor is centred, the edge padding its room).
  - The projection: in front and inside the screen it's shown; with `'clamp'` only inside the
    padding, else moved onto the padded edge along its direction from the centre, with the arrow
    (`--aek-world-anchor-angle`, written when its rounded degree changes). Behind the camera the
    clip x and y are used undivided (dividing by the negative `w` mirrors them); straight behind
    points down. Past `maxDistance` (default the layer's `cullDistance`) it hides, clamped or not;
    `getDistance` still reports it (a waypoint's '120 m', the app's text).
  - Writes: `transform: translate()` (2D: piece 5) when the rounded position changed, `data-state`
    (`shown` / `clamped` / `hidden`, `display: none`) when it changed. `depthSort` is an insertion
    sort in place (nearly sorted from the frame before) with a `z-index` written only where an
    anchor's place changed; hidden anchors go to the back.
  - The layer: fixed over the HUD's bounds (the crosshair's reason), `contain: strict`, no pointer
    events, `z-index: var(--aek-world-anchor-layer-z, auto)`. The body's text has a halo
    (`--aek-world-anchor-halo`, default `--aek-bg`) so a bare name reads over any scene.
  - Looked at in Chromium (both themes) with the throwaway viewer (`.cache/p808view/anchors.ts`):
    the arrow was made narrower (11 × 10 px) so its direction reads at its size.
- **The compass** (`game/Compass.ts`): `createCompass({ heading?, fov? (2π / 3), markers?,
  placement?: 'top' | 'inline', texts? })` → `{ cmp, setHeading, getHeading, setMarker,
  setMarkerBearing, removeMarker, hasMarker }`; a marker `{ bearing, label?, icon?, color?,
  offScreen?: 'clamp' | 'hide' }`.
  - Bearings and the heading are radians clockwise from north (the toolkit's sync turns the
    camera's yaw into one: north is -z, east +x). `setMarkerBearing` (decided here) moves a
    marker without an object a frame (a waypoint's bearing from the player changes as it moves).
  - The strip is two turns (from -180°) wide in the field's units, its 16 labels at fixed
    percentages and its ticks a background every 15°, moved by one `translateX` percentage of its
    own width: nothing measured, no px. Written when the heading moved a tenth of a degree.
  - Markers over the clipped track (its ends faded by a mask), each placed by its `left` as a
    percentage of the field when its offset changed a tenth of a degree; outside the field on the
    nearer end (`data-edge`, an arrow out: turn this way) or hidden. A marker without an icon is a
    diamond; `color` is read on the marker itself (a custom property resolved on the root would
    have hidden it: seen in Chromium).
  - The spoken heading ('Facing north-east') is a visually hidden text, not live, written when
    the nearest of the eight directions changes. `texts` holds the shown and spoken directions
    and the facing text (the language).
  - `placement: 'top'` is fixed at the top centre of the HUD's bounds (`--aek-compass-inset`).
  - Looked at in Chromium (both themes, `.cache/p808view/compass.ts`).
- **The minimap frame** (`game/MinimapFrame.ts`): `createMinimapFrame({ label? ('Map'),
  playerHeading?, mapHeading?, showNorth?, onZoom?, texts? })` → `{ cmp, setPlayerHeading,
  setMapHeading, setZoomEnabled, setLabel }`.
  - D7's `title` is `label` (the other pieces' word): the group's `aria-label`, not shown; D7's
    `zoom` is the buttons' presence by `onZoom(1 | -1)` (the app moves its viewport's camera and
    owns the zoom's value), `setZoomEnabled({ zoomIn?, zoomOut? })` disabling one at a limit
    (`aria-disabled`).
  - `setMapHeading` (decided here): a map that turns with the player gets the player's heading;
    the north mark goes round the ring's square edge along north's direction, and the arrow turns
    by the player's heading less the map's. Each written when its rounded degree changes.
  - It fills the slot (`position: absolute; inset: 0`), letting the pointer through to the canvas
    but for its buttons (`pointer-events: auto` in a non-interactive slot). The square's corners
    outside the rounded border are filled by the border's outward shadow in its colour (the
    viewport's render can't be clipped: D1).
  - Assistive tech: a `role="group"` named by `label`, the pictures `aria-hidden`, a visually
    hidden 'Facing east' written when the nearest direction changes (not live). The compass's and
    the frame's directions are `Directions.ts` (`@internal`, no styles: the frame doesn't bring
    the compass's stylesheet).
  - The zoom buttons are native buttons ('+' / '−', named by `texts`), their Enter and Space
    stopped before the action maps (the game menu's rule); the kit's global focus ring.
  - Looked at in Chromium (both themes, `.cache/p808view/minimap.ts`: a north-up frame and a
    turning one with zoom).
- **The anchor sync** (`toolkit/ecs/effects/WorldAnchorSync.ts`, on `aekasha/toolkit/ecs`):
  `registerWorldAnchorSync(world, { layer, compass?, camera?, size? })`,
  `unregisterWorldAnchorSync(world)`, `WorldAnchorComponentType.WORLD_ANCHOR`
  (`'TOOL_WORLD_ANCHOR'`, `{ anchor, offsetY? }`), `getCompassBearing(dx, dz)`.
  - One `LATE_MAIN` system per world (id `worldAnchorSync`): each entity's `OBJECT3D.matrixWorld`
    position (+ `offsetY`) into its anchor (none: left where it was), then `layer.update` with a
    kept view (the kept `Matrix4`'s `elements` as its `viewProjection`, written by
    `multiplyMatrices(projectionMatrix, matrixWorldInverse)`), then the compass's heading.
  - Not a plugin: it takes the layer, so the app calls it per world when it has one (a scene's
    start). A second call on a world replaces its options (state in a `WeakMap` by world).
  - `camera` and `size` are resolvers (decided here: the viewports' `camera` pattern), default
    `getActiveCamera` and `getCanvasSize`; a frame with no camera updates nothing. They make it
    testable and let an `'inline'` layer give its own box.
  - The removal hooks (`onRemoveComponent`, `onDeleteEntity`: `anchor.remove()`) are registered
    once on the first call, not in an install: D7's "needs no `FeatureContext`", and the call is
    the app's at run time, not at module load.
  - The heading: the camera's forward `-Z` column's bearing, or its `+Y` column's when it looks
    straight down (a top-down camera's screen up). North is -z, east +x; `getCompassBearing` is
    the one place that says it (a waypoint marker's bearing, the minimap's player heading).
  - The tests use stand-ins for the kit's layer, anchor and compass (the toolkit's tests can't
    reach the kit's DOM helpers), a real `ECSWorld` and three's cameras.
  - **For the perf pass:** `getCanvasSize()` makes two objects a call (the source's `read` and
    its result), so the default `size` allocates every frame.
- **The perf pass** (D7, p800 §5): the perf-auditor agent read the per-frame path (the sync, the
  layer, the projection, the compass, the minimap frame, the component storage), and the
  throwaway viewer measured it (`.cache/p808view/perf.ts`, `layers.ts`: 200 anchors, 20 of them
  clamped waypoints, half of them moving every frame, under an orbiting camera with a compass,
  600 frames, 1280 × 720, Chromium on macOS, CDP's `Performance` and `LayerTree`).
  - Measured: `layer.update` 0.12 ms a frame on average (p95 0.2 ms, max 1 ms) with about 136
    anchors shown; the page's whole task time about 1.7 ms a frame, style recalculation 0.26 ms
    and layout 0.08 ms a frame (one style pass a frame; layout in fewer than half the frames, all
    inside the layer's `contain: strict`); `depthSort` changed none of it measurably. At most 4
    compositor layers.
  - **Fixed:** the anchors' `translate3d()` is now a 2D `translate()` (the auditor: a 3D
    transform can make each anchor its own compositor layer). The measurement didn't show it
    (4 layers and the same cost either way in this Chromium), but the positions are rounded, so
    the 3D form bought nothing.
  - **Written down, not changed:**
    - The sync's `for … of` over the component storage makes an entry array per entity unless
      V8's escape analysis removes it (often, not always). Every effect in the toolkit iterates
      its storage this way, and `IComponentStorage` has no `forEach`: a change for the ECS core,
      not this plan.
    - `getCanvasSize()` (the default `size`) makes two small objects a frame, and a mount's size
      source reads `clientWidth` / `clientHeight` (a layout read, after the frame before's
      writes have been laid out by its render, so low risk). The fix would be the engine's (an
      `out` argument, or a public `onCanvasResize`); the option's `@remarks` tells an app to
      return a kept object updated on a resize.
    - A marker's `left` in the compass is a layout property, contained in its track's box: fine
      for a few markers, worth a transform only with tens.
  - Fine as is (the auditor's list): the projection (scalar maths into a kept `Float64Array`),
    the layer's guards (position, state, angle, `z-index` each written on a change only), the
    kept view and matrix, the compass's and the frame's tenth-of-a-degree and one-degree guards,
    the strings built only inside those guards, the order (positions before `update`, after the
    render's matrices).
- **The entry:** 174 value names on `aekasha/ui` (`createWorldAnchorLayer`, `createCompass`,
  `createMinimapFrame`) and their types (`WorldAnchor*`, `Compass*`, `MinimapFrame*`); on
  `aekasha/toolkit/ecs` `WorldAnchorComponentType`, `getCompassBearing`,
  `registerWorldAnchorSync`, `unregisterWorldAnchorSync`, `WorldAnchorData`,
  `WorldAnchorSyncOptions`.

### Phase 8: the example, the Hub, the docs — done

The `gameHud` example (D14) and its Hub page; the UI kit's `game/` page, both library pages'
boxes, the checks, `COMPONENT_USES`; the `uiKit` profile's game window and its budgets (D12);
`yarn verify:ui`, `yarn verify:embed`, `yarn verify:scenes --only exampleGameHud --update`;
the nested `CLAUDE.md` files and `readme.md`.

Sections: 1 the example scene; 2 the component library's boxes and checks, `COMPONENT_USES`, the
UI kit section's `game/` page, `yarn verify:ui`; 3 the example's Hub page, the input and toolkit
pages, its Hub image, the nested `CLAUDE.md` files, `readme.md`, the scene baseline; 4 the
`uiKit` profile's game window and budgets, `yarn verify:embed`.

As built (section 1, the example):

- **`src/app/examples/gameHud/`** (`exampleGameHud`, "Example: A game HUD"): the scene file
  (`exampleGameHud.ts`: the player, its camera, the maps, the game's rules and the per-frame
  system), `exampleGameHudLevel.ts` (the arena: a walled floor, four dynamic crates, the NPCs
  Mara, Ivo and Pell on FIXED boxes, the beacon in the north-west corner, a fire pit drawn only),
  `exampleGameHudHud.ts` (every kit piece, made from plain data and the game's callbacks),
  `exampleGameHudMenus.ts` (the pause menu, the inventory, the settings menu, the controls page,
  their saving), `exampleGameHudIcons.ts` (its own 16 px SVG icons, registered on each visit: a
  production build registers no built-in icon) and `exampleGameHud.scss`; its own camera and
  lights. No `createExampleHud` line: the hotbar is where it sits, and the device-aware prompts
  under the bars are the hints.
- **The player** is D14's character: a `CAMERA_RELATIVE` brain (W A S D or the left stick, Space
  / SOUTH, Shift / L3 held, C / EAST) under the toolkit's follow rig with `getMouseMoveInput`,
  orbiting 7 m out about 8° down at a 0.9 m target height, so the screen's centre (the crosshair)
  reaches crate height 5-12 m ahead (12° and 25° missed every crate: the ray reached the ground
  before them). The orbit is a right-drag on the canvas (DOM `pointermove`s summed between frames,
  not a map: `read()` is the last step's sample, which two frames between steps read twice) plus
  the right stick's rate.
- **The toolkit's follow rig** (changed here): with `getMouseMoveInput` the orbit starts from the
  offset's direction (`Spherical.setFromVector3`, its pitch clamped to the orbit's limits) instead
  of a fixed 60° from straight up, which ignored the offset's direction; a test for it. The
  changelog's Toolkit section names it (Phase 9).
- **The maps**: the game's (`exampleGameHud`, `GAMEPLAY`: interact E / WEST, fire the left button /
  RIGHT_TRIGGER, use F / NORTH, items 1-4 and the d-pad's left and right, the radial Q /
  RIGHT_SHOULDER held, look the right stick, menu Escape / START, inventory I / SELECT; the wheel a
  DOM listener), the brain's (`<id>:input`), the menu's (`MENU`, gamepad only: the d-pad to
  `navigation.move`, SOUTH clicks the focused element, EAST back or puts a held item back, the
  shoulders the settings' tabs, START closes; the keyboard's keys are the kit's own) and the
  conversation's (`DIALOGUE`: E / SOUTH click the focused choice or `confirm()`, the d-pad to a
  spatial navigation over the box with `handleKeys: false`). A conversation and the menu turn
  `GAMEPLAY` off; the exit puts every context back.
- **The rules**: stamina drains while running; the fire pit burns 30 a second (the respawn is
  queued, with 500 ms of grace while the drawn pose catches up); a shot is a `Raycaster` through
  the screen's centre against the crates (3 hits, a top hit critical, the last a kill: the crate
  dark, its anchor's component removed, '+25 gold' merged by `key`) and its impulse waits for the
  `APP_PHYSICS_STEP` system, as the respawn does (the simulation rule); the crosshair's `target`
  ring is a ray against a 0.55 m sphere per crate a frame (no allocation; 0.75 promised misses);
  its spread follows the speed. The hotbar: a potion (+35, 4 s cooldown, refused at full health),
  a tonic, a whistle (Mara's subtitle), counts down to an empty slot.
- **The world UI**: `registerWorldAnchorSync` with the layer and the compass; nameplates (Mara's
  holds the Talk prompt, shown within 2.5 m), the crates' segmented bars (20 m: the anchor's
  distance is the camera's), the beacon's clamped waypoint with the player's distance; the
  compass's beacon and Mara markers (her marker has no label: two labels at close bearings
  overlapped) moved by `setMarkerBearing` from the player each frame; the minimap a
  `BOTTOM_RIGHT` viewport of the root scene through a north-up orthographic camera following the
  player, its slot sized in `--aek-base` (`invalidateViewportLayout` after a UI scale change),
  the frame appended into `slotElem` (the public `Viewport` has no `slotCmp`), its zoom 0.6 / 1 /
  1.6.
- **The text**: the feed (top right), the tracker (talk, then the crates' count and the beacon),
  subtitles (raised over the hotbar by `--aek-subtitles-inset`; Mara's call at the start, Ivo's
  and Pell's lines as the player passes, the emotes'), the dialogue (a small tree, Mara's portrait
  a CMP); the bars and the hotbar are hidden (`visibility`) during a conversation by a
  `data-example-game-hud` attribute on the HUD root, removed on the exit.
- **The menus**: the game menu (Resume, Inventory, Settings, Restart) with a Select prompt in its
  footer; the inventory (a bag and a chest in one drag group, the beacon key vetoed from the
  chest, the details following the focus and the pointer, compared with the sword in hand, their
  room kept so the menu doesn't move); the settings (Display: theme, UI scale, reduced motion,
  crosshair shape; Subtitles: on, size; Controls: the page over the brain's and the game's maps,
  its `onReset` the page's reset) saved in `localStorage` (`exampleGameHud.settings`, each key
  kept only with the default's type) with `setKitPreferences` on the HUD root (put back as they
  were on the exit); the bindings saved per `<map>/<action>` (`exampleGameHud.bindings`), applied
  before the HUD's prompts are made, the defaults the maps' before that.
- **Checked**: `tsc`, lint, `yarn test`; played in Chrome on the dev server
  (`?isProdTest=true&startScene=exampleGameHud`, `startScene` needs a debug or prod test flag)
  with a throwaway Playwright script in both themes: the walk to Mara and her prompt, the
  conversation and its choices, the tracker, aiming (a right-drag sweep until the crosshair's
  `data-state` is `target`), the hit marker and a crate's kill, the fire pit and the respawn, the
  radial menu, a potion, the pause menu, the settings, the inventory with a held item; no console
  errors. `yarn verify:scenes --only exampleGameHud`: all four configurations NEW, no errors, the
  same hash in the three debug ones. The gamepad paths weren't driven (no pad: by hand, as the
  gym's).

As built (section 2, the library, the checks, the game page):

- **The demos** are five group modules by the game page's sections, each with its checks:
  `hub/_assets/ts/_library/game.ts` (the input prompt, the kit preferences, the resource bar, the
  cooldown, the crosshair; its `createStatusLine` the others import), `gameText.ts`, `gameMenus.ts`,
  `gameItems.ts` (the items' icons registered by the first demo that shows one) and `gameWorld.ts`
  (the anchors' camera a view-projection built by hand, three's column-major order), merged in
  `_components.ts` and `_componentChecks.ts`. 21 boxes in both library pages (after the input
  glyph), their public and dev texts, the dev page's `generated-components-*` slots and
  `COMPONENT_USES` (`createItemDragGroup` with the inventory, `setPromptDevice` and
  `getPromptDevice` with the prompt). The loading overlay's box gained "A loading screen with a
  tip" (D1's tips).
- **Screenshots never wait on a timer** (`verify:ui` settles on animations, not timers): a piece
  that places itself over the HUD's bounds is `inline` or in a `contain: layout` stage
  (`.hubDemoStage`: the crosshair; the fixed centre is the stage's, as a mount's container); the
  feed's and the subtitles' lines are held 60 s; the dialogue box shows its lines whole until a
  switch in the box makes one that types (`charsPerSecond: 40`); a cooldown's state buttons run
  1-2 s, ended by the shot; a hit marker's 250 ms is gone by it (the scripts check its
  `data-kind`). The kit preferences' box is a kit root of its own, outside the page's switches.
- **The game page** (`hub/pages/features/ui-kit/game/`, `aek:order` 25, `aek:covers "Game UI"`):
  `intro` (the `exampleGameHud` scene panel: its Hub image is section 3's, a warning until then),
  `hud-guide`, `text-guide`, `menus-guide`, `items-guide`, `world-guide` and `guide` (wiring the
  engine, loading screens, in a build, key APIs, read more); each piece's section with its
  `::: demo`, a code block, its rules and its reference table. The UI kit overview's intro links
  it.
- **`## Game UI` in `src/_engine/ui/CLAUDE.md`** (pulled forward from section 3: `aek:covers`
  needs the section): the layout paragraph's long `game/` parenthesis moved there as a bullet per
  piece, with an intro (the engine sides, D3's entry count, the demos' modules). The root
  `CLAUDE.md`'s map line and `hub/CLAUDE.md`'s lists name it and the game page.
- **Found by `yarn verify:ui`, fixed in the kit:**
  - The game menu's focused item had `outline: none` (`tokens.css` says never: a forced-colours
    mode draws only the outline): the kit's ring is back, inside the item (`outline-offset`
    negative, the menu's own pattern), with the border, fill and bar.
  - WCAG 2.5.3 (axe's `label-content-name-mismatch`, on the controls page's slots): a gamepad
    glyph's spoken name now starts with its shown label where the label is a word of its own
    (`GamepadGlyphs.ts`: Xbox `LB RB LT RT LS RS`, Nintendo `LS RS`, generic `L1 R1 L2 R2 L3 R3`:
    'RT, right trigger').
  - The inventory's Escape outside the HUD root: the hold's overlay stack entry never saw the key
    in a page's kit root, so the grid's keydown puts the item back itself there (inside the HUD
    the stack's capture listener takes it first); a test.
  - `AnchorProjection.ts`' `{@link WorldAnchorLayer}` (no such symbol in its scope: TypeDoc's
    warning) is plain text.
- **The demo's speaker colours** are status roles (`var(--aek-warning)`, `var(--aek-info)`): the
  first hex colours failed axe's contrast in the light theme; the guide's example says so.
- **Not changed (for review):** the Hub's search index is 470 KiB gzipped (was 440), over
  `devTools/hub/search.ts`' 450 KiB warning mark (a warning, not an error).
- **Found by `yarn verify:baselines`, from section 1 (open):** the production build's `main` now
  carries `debug/GPUMemory.ts` and `debug/Profiler.ts` (the check's failure) and a third viewports
  module: `createViewport` calls the debug wrapper `registerGPUMemorySource` unguarded
  (`features/viewports/Viewports.ts:359`), and with the game HUD a second scene uses the viewports,
  so `Viewports.ts` moved into `main`. The proposed fix: `__AEK_DEBUG__ ? registerGPUMemorySource(…)
  : () => {}` (folded in production, the wrapper's own run-time check kept for prodTest). The other
  bundle changes are the new example's chunks and the shared chunks it split out (`FocusTrap`,
  `Tabs`, `TextField`, `TimeSeries`, `GraphMonitor`), to record with `--update` once the debug code
  is out. Still open after section 3 (not this section's files); section 4 runs `yarn sbp` and
  the budgets, so it fixes it there before recording any baseline. **Fixed in section 4** (below).

As built (section 3, the example's page, the input and toolkit pages, the docs):

- **`hub/pages/examples/game-hud/`** ("Example: A game HUD", `aek:order` 77, after the app HUD):
  `intro` (the `::: scene` panel with every control, keyboard and gamepad, and the HUD
  screenshot) and `walkthrough`: the files, the game's actions, the prompts and the vitals, the
  camera and its orbit, the hotbar and its use, shooting and the physics step, every frame, UI in
  the world (the anchors, then the minimap), text (the pieces, the conversation's data and its
  wiring), the radial menu, the pause menu's gamepad map, the inventory, the settings, the controls
  page: the 19 regions section 1 left, plus `game-hud-minimap` (added around `createMinimap`).
- **Two images, as the UI kit example's:** `exampleGameHud.hub.png` (the canvas, saved by the Hub
  tab's button through the test bridge, `?isDebug=true`) is the scene panel's;
  `hub/pages/examples/game-hud/game-hud.png` (a 1600 × 1000 page screenshot in `?isProdTest=true`,
  the debugger roots hidden: the prod test's play tools sit over the compass) is the `aek:image`
  and the intro's figure: a step forward, the aim swept until the crosshair rings a crate, the
  whistle (Mara's subtitle, its cooldown), three shots (the kill marker, '+25 gold'). The script
  was a throwaway in `.cache/p808view/hubImages.ts`; `hub/CLAUDE.md` says how the HUD screenshot is
  taken.
- **The input page:** a "The last used device" section after the gamepad's (the tracker's two
  functions, what switches it, the families, the start, its listeners and the embed's scope), its
  Key APIs, the intro's and Read more's links to the example and the game UI. Its `aek:covers`
  already names Input devices, where the tracker is.
- **The toolkit page:** `WorldAnchorSync` in the tree and the effects list (the exception to "once
  in the app's feature": a scene registers it with its own layer and compass), the follow rig's
  orbit (`getMouseMoveInput`, from `offset`'s direction), and the example in See it.
- **The game page's guide** links the example page (Wiring the engine, Read more).
- **Nested `CLAUDE.md` files:** `src/_engine/ui/CLAUDE.md`'s Game UI intro names the example;
  `hub/CLAUDE.md` the HUD screenshot. `kernel/input/CLAUDE.md` already had the tracker (Phase 1).
- **`readme.md`:** the UI kit feature gets the game UI's sentence and the Hub's two example
  scenes, Input the device tracker, the toolkit `WorldAnchorSync` and the rig's orbit, the
  structure's `ui/` line `game/`, and Examples' list the game HUD (eleven examples, ten scenes).
- **Checked:** `yarn hub:build` (a dead `#the-worlds-ui`: the slug is `the-world-s-ui`, the heading
  became "UI in the world"); `yarn verify:scenes --only exampleGameHud --update`: the four
  configurations recorded (`workerSab`, `workerMsg`, `mainThread` the same hash `f09aa8a3`;
  `prodTest`), no errors. The search index grew to 484 KiB gzipped with the page (the warning
  above).

As built (section 4, the `uiKit` profile's game window, the budgets, `yarn verify:embed`):

- **The viewports' debug wrapper** (section 2's open item): `createViewport`'s
  `removeGPUMemorySource` is `__AEK_DEBUG__ ? registerGPUMemorySource({ … }) : () => {}`
  (`Viewports.ts`), as proposed: the wrapper's own check stays prodTest's. `yarn verify:baselines`:
  no debug code in the production build or either embed.
- **Why `Viewports.ts` grew in `main`** (found here): `ViewportsFeature.ts` imports
  `installViewports` from it, so the module was always in `main`, but before section 1 no shipping
  code called `createViewport` (the debug gizmo and ball were its only callers), so the build
  dropped it. The minimap is its first production caller: its code (1.1 kB) and the slots'
  `Viewports.module.scss` ship with the feature. `assets/index.css` went over its budget (4.2 KiB,
  budget 4): raised to 6 KiB (`suggestBudget`) with the reason in `sbp.config.ts`; the viewports
  group (2.7 kB) is within its 3 KiB.
- **The game window** (`src/app/profiles/uiKit/uiKitEmbedGame.ts`, D12): a health bar (40 of 100,
  thresholds), a hotbar (`inline`, `sm`, no key hints: the embed binds no number keys) of a potion
  (3, +25, a 3 s cooldown; refused at full health or with none left) and a ward (a 5 s cooldown)
  and an empty slot, an input prompt ("Use": the mouse's left button or the pad's SOUTH) and an
  `inline` feed (3 lines, 30 s each, merged by `key`); the items' two SVG icons registered by the
  module (a production build registers no built-in icon). The scene's window got a fourth button,
  "Open the game HUD" (`uiKitEmbedOpenGame`), which imports the module and opens a `Game HUD`
  window (`uiKitEmbedGame`, 300 × 280 at 252, 16, over the data window's place); the first window
  is 220 × 240 (was 230) for the fourth button.
- **The budgets** (`sbp.config.ts`, from `suggestBudget`): `assets/uiKitEmbedGame.js` 9 KiB (7.6:
  the bar, the hotbar, the slots, the cooldown, the feed, the prompt and the input glyph, the
  gamepads' glyphs the largest at 1.5), its CSS 4 KiB (2.6), and a new shared chunk,
  `assets/Announcer.js` 3 KiB (1.2: the announcer and `RovingFocus.ts`, which the hotbar and the
  data window's list and table share), which took the data window from 19.4 to 18.6 KiB (its
  budget 21 → 20, reported well under). `modules` at 0: `_engine/ui/game/` and
  `_engine/kernel/input/InputDevice.ts` in the `app`, `banner` (a `modules` of its own now, inside
  the Hub's `banner-profile` region) and `uiKit` profiles. First downloads: banner 287.4 and uiKit
  286.6 kB gzip, unchanged; the app 387.0, `main`'s 384.4 (found in Phase 9, against `main`'s
  `bundle.json`): the viewports +1.2 kB (the minimap's `createViewport`, above), `_engine/ui` +0.4
  (the loading overlay's tips: `src/index.ts` makes the overlay) and `kernel/input` +0.3 (the
  gamepad family, through `GamepadInput.ts`).
- **`yarn verify:embed`'s kit scenario**, after Escape closed the dialog: the game window from its
  button, its bar, hotbar, prompt and first feed line inside the container, the bar's and the
  line's font sizes the same at both host roots in IBM Plex Sans, then a press on the potion's
  slot: the meter's `aria-valuenow` 65, its cooldown `running`, a feed line with "health".
- **Found by `yarn verify:embed`:** the cooldown's `@property --aek-cooldown-progress` (the sweep's
  animated number, `Cooldown.scss`) is on every host element after the unmount (CSS has no scoped
  registration). The registration stays (the animation needs it); the style check now leaves out
  every `@property` the kit's stylesheets register (`src/_engine/ui/**/*.{css,scss}`), not only
  `tokens.css`' (`embed.ts`, `embedChecks.ts`' doc, `devTools/verify/CLAUDE.md`).
- **The Hub:** the UI kit overview's In a build, the game page's and the data page's (the shared
  announcer chunk) name the new chunks; the overview's embed caption names the data and game
  windows. `uiKitEmbed.hub.png` (the embed's poster) taken again: it was a button behind since
  p805 (a throwaway Playwright script on the dev Hub's UI kit page, the stage 800 × 500 at a
  device scale of 2, lifted over the page's side column).
- **Docs:** `devTools/sbp/CLAUDE.md`'s profiles item, `devTools/verify/CLAUDE.md`'s embed item, the
  embed check's header, the profile's and the entry's comments.
- **Checked:** `tsc`, lint, `yarn test` (295 files; `buildGuard.test.ts` failed once while a
  background build rewrote `dist-embed/` and passed alone and in the full run after),
  `yarn sbp --profile all` (every budget within), `yarn verify:embed` (all 7 scenarios),
  `yarn verify:baselines --update` (`bundle.json`: section 1's example chunks and the shared
  chunks it split out, `FocusTrap`, `Tabs`, `TextField`, `TimeSeries`, `GraphMonitor`, `Hotbar`,
  plus `Announcer` and `uiKitEmbedGame`; `bundle.uiKit.json`: the game window, the announcer, the
  scene's button; no API or docs change), `yarn hub:build`.
- **For Phase 9's changelog:** the viewports' production fix (Engine), the cooldown's registered
  property in an embed (the check's rule, Project), the `uiKit` embed's game window and first
  window's height (App), the budgets (Project).

### Phase 9: versions and done

The changelog's sections in the unreleased engine-6 entry (D15), p800's §5 p808 entry rewritten
as done ("what the later plans build on"), the plan marked done, `_DONE_`.

Sections: 1 the changelog; 2 p800's §5 entry, the plan marked done and moved to `_DONE_`, the
references to its name, `yarn checkVersions --against main`.

As built (section 1, the changelog):

- **`CHANGELOG.md`'s "Unreleased — engine-6"**: the intro names p808 and gets a paragraph for it;
  Engine 6.0.0's Added (the device tracker on `aekasha`; the game UI on `aekasha/ui` by D1's
  groups; the loading overlay's tips and image, the tooltip's `content`), Changed (the embed's
  gamepad scope; the sizes), Fixed (`createViewport`'s unguarded debug wrapper, the field's
  `reset`); a new Toolkit section (unreleased, a minor at the merge: `registerWorldAnchorSync`
  Added, the follow rig's orbit Changed); App's Added (the example, the `uiKit` embed's game
  window); Project (the embed check, the budgets, the Hub, the baselines, the layout rule, the
  docs, the plans). Pieces made and fixed inside this branch (the glyphs' WCAG 2.5.3 names, the
  menu's ring, the prompt's `PromptKeys`) aren't fixes: they're in the Added lines as built.
- **The app's first download** grew 384.4 → 387.0 KiB gzip against `main`; section 4's
  "unchanged" is corrected above, and the changelog's Sizes line has the parts.
- **The example's engine APIs** (found in review, after section 1): Phase 8's shot was a three.js
  `Raycaster` against the crates' meshes, which no ray statistic or debug helper sees (the
  engine's own casts, `kernel/render/Raycast.ts`, are all `@internal`) and which hit a crate
  through an NPC's box or a wall. Changed:
  - The shot is `getPhysicsWorld().castRay` (`fireAsync`): from the camera ray's point nearest
    the player (nothing behind the player stops it), the player's body left out, `debug` with a
    helper id (drawn, counted in the Physics API tab and the profiler), the hit's
    `collider.parentId` mapped to its crate, the visit (`isRemoved`) and the crate checked again
    after the `await` (a frame or two on `WORKER_THREAD`).
  - The crosshair's ring stays maths on the camera's ray (no cast a frame: an async query would
    allocate a promise a frame); its comment and the walkthrough say it's a hint.
  - No `THREE.Raycaster` left: the aim (the shot's ray and the ring's) is a kept `THREE.Ray` from
    the camera's position and `getWorldDirection` (`updateAim`), which is the screen centre's ray
    of a perspective camera, `setFromCamera((0, 0))`'s, without a raycaster in the snippet.
  - The wheel is a `MOUSE_WHEEL` `createMouseBinding` (the input switches apply), not a DOM
    listener. The kit's items guide keeps its DOM line: the kit works without the engine.
  - No wall clock in the game's rules: the respawn's grace counts down by the frame's `dt`
    (`safeFor`), the stick's orbit rate reads `getAppDelta()`.
  - The orbit input and the minimap moved to `exampleGameHudView.ts` (the scene file was 853
    lines, now 770); the walkthrough's includes and file list follow.
  - Making the engine's render casts public (`castRayFromScreenPosition` on `aekasha`) is left to
    a plan of its own: an API decision outside p808.
  - Checked: `tsc` (both), lint, `yarn test`, `yarn hub:build`, the shot and the wheel driven in
    Chromium on `WORKER_THREAD` (`.cache/p808view/physShot.ts`: hit, hit, kill, '+25 gold', the
    wheel down and up), `yarn verify:scenes --only exampleGameHud`.

---

## 4. Risks

- **Size of the plan.** 25 pieces. Mitigation: the phases are independent after Phase 1; a phase
  that runs long moves its last piece to a later phase and says so here.
- **Spatial navigation's heuristic** picks a surprising neighbour in irregular layouts. Mitigation:
  focus groups, an explicit `data-aek-nav-<direction>` override (an element id), the example's
  menus as the test bed.
- **Gamepad families** from `Gamepad.id` vary by browser and OS. Mitigation: `GENERIC` as the
  fallback, an app's override (`setPromptDevice` takes the family it wants).
- **The anchor layer's cost** with many anchors: D7's on-change writes, the perf-auditor's pass.
- **Key capture** racing the action maps: the capture phase on `window` (D9), checked in the
  example with a gameplay map active.

## Done when

- Every piece of D1 is on `aekasha/ui` (or the kernel or the toolkit as D2 says), documented with
  its demo, keys and parts, tested, and passing `yarn verify:ui`.
- `exampleGameHud` plays with a keyboard, a mouse or a gamepad, switches its prompts with the
  device, and its menus work without a mouse; its scene baseline is recorded.
- The game pieces cost the first downloads nothing; the `uiKit` profile's game window is budgeted.
