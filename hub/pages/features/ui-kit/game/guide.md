## Wiring the engine

The pieces take plain data, so the wiring between them and the engine is a few lines of yours,
one call per event:

- **The prompts follow the device:** `onLastInputDeviceChange(setPromptDevice)`
  ([input](hub:features/input) has the device tracker: `getLastInputDevice`, the gamepad's
  family).
- **The world UI follows the entities and the camera:** `registerWorldAnchorSync(world, { layer,
  compass })` from `aekasha/toolkit/ecs`, once per world (a scene's start); a `WORLD_ANCHOR`
  component per entity, its anchor removed with the component.
- **A gamepad in the menus:** a menu action map in a context of its own (`MENU`), on while a menu
  is open: its d-pad calls the menu's `navigation.move`, `SOUTH` clicks the focused element,
  `EAST` calls `back()`, the shoulders `selectNext` on the settings' tabs. The keyboard's arrows,
  Enter and Escape are the kit's own, so the menu map binds only the gamepad.
- **Gameplay off in a menu:** the game menu's `onOpen` / `onClose` turn the `GAMEPLAY` context
  off and on (`setActionContextEnabled`).
- **Settings and bindings saved:** the settings menu's `onChange` (on `change.last`) and the
  controls page's `onRebind` are where you save; at the start, apply the saved bindings with
  `map.setBindings` before the prompts are made, and the settings with `setKitPreferences`.

The [game HUD example](hub:examples/game-hud) does all of it in one scene.

### Loading screens

A game's loading screen is the [loading overlay](hub:features/ui-kit/core#loading-overlays) with
`tips` (one at a time, the first a random one, every `tipIntervalMs`) and an `image` behind its
content:

```ts
const loading = createLoadingOverlay({
  text: 'Loading the arena',
  progress: 0,
  tips: ['Hold Shift to run: it drains your stamina.', 'Crates break in three hits.'],
  image: 'loading/arena.webp',
});
```

## In a build

Each piece is its own module with its own styles, in no first download: a build carries the ones
the app makes, loaded with the code that makes them. The engine's device tracker and the
toolkit's anchor sync are only in a build that calls them. The `uiKit` embed profile measures a
few pieces together: its window's fourth button opens a game window, from a module the first
press imports, with a health bar, a hotbar of two items with a cooldown on each slot, a
notification feed and an input prompt. From the last `yarn sbp` report (gzip), that comes to
{{sbp:uiKit.chunk:assets/uiKitEmbedGame.js}} of code and
{{sbp:uiKit.chunk:assets/uiKitEmbedGame.css}} of styles on top of the HUD's window, dialog and
button, the prompt's gamepad glyphs the largest part of it, and
{{sbp:uiKit.chunk:assets/Announcer.js}} for the announcer and the arrow keys' focus, which the
hotbar shares with the [data display](hub:features/ui-kit/data#in-a-build). A piece that uses
another takes it as a value instead of importing it where it can: a slot's key hint is your Kbd or
glyph, a settings page's content is your CMP.

## Key APIs

- [`createInputPrompt`](api:createInputPrompt), [`setPromptDevice`](api:setPromptDevice),
  [`getPromptDevice`](api:getPromptDevice); [`setKitPreferences`](api:setKitPreferences),
  [`getKitPreferences`](api:getKitPreferences).
- [`createResourceBar`](api:createResourceBar), [`createCooldown`](api:createCooldown),
  [`createCrosshair`](api:createCrosshair).
- [`createNotificationFeed`](api:createNotificationFeed),
  [`createObjectiveTracker`](api:createObjectiveTracker), [`createSubtitles`](api:createSubtitles),
  [`createDialogueBox`](api:createDialogueBox).
- [`createSpatialNavigation`](api:createSpatialNavigation), [`createRadialMenu`](api:createRadialMenu),
  [`createGameMenu`](api:createGameMenu), [`createSettingsMenu`](api:createSettingsMenu),
  [`createControlsPage`](api:createControlsPage).
- [`createItemSlot`](api:createItemSlot), [`createHotbar`](api:createHotbar),
  [`createInventoryGrid`](api:createInventoryGrid), [`createItemDragGroup`](api:createItemDragGroup),
  [`createItemDetails`](api:createItemDetails) ([`GameItem`](api:GameItem),
  [`ItemStat`](api:ItemStat)).
- [`createWorldAnchorLayer`](api:createWorldAnchorLayer), [`createCompass`](api:createCompass),
  [`createMinimapFrame`](api:createMinimapFrame); the toolkit's
  [`registerWorldAnchorSync`](api:registerWorldAnchorSync) and
  [`getCompassBearing`](api:getCompassBearing).
- The engine's [`getLastInputDevice`](api:getLastInputDevice),
  [`onLastInputDeviceChange`](api:onLastInputDeviceChange) and
  [`getGamepadFamily`](api:getGamepadFamily).

## Read more

- [The game HUD example](hub:examples/game-hud): every piece on this page in one scene, its
  walkthrough.
- [The UI kit](hub:features/ui-kit): components, the HUD root, styling.
- [Core components](hub:features/ui-kit/core): the input glyphs, the progress bar and the loading
  overlay these build on.
- [Forms and fields](hub:features/ui-kit/forms): the property grid a settings page is.
- [Input](hub:features/input#the-last-used-device): action maps, contexts, the gamepad and the
  device tracker.
- [The component library](hub:features/ui-kit/library): every piece in every state.

::: claude-md
:::
