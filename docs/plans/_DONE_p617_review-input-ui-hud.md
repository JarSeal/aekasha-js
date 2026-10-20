Status: implemented (Phases 0-6)
Category: Refactoring, Documentation, UI, Input
Epic: p600_whole-codebase-refactoring-and-documentation.md (Stage C)
Blocks: p621_hub-docs-readme-and-claude-md-final.md
Related: \_DONE_p610_character-and-input-action-architecture.md (the action layer), \_DONE_p611_sbp-tooling-profiles-and-marketing.md (the embed's input scope and HUD slot, §1.2), \_DONE_p612_review-ecs-loop-config-init.md (`pollHeldKeyBindings`, `ActionTypes.ts`' links), \_DONE_p613_review-rendering-scene-assets.md (D5: the windows' hooks), \_DONE_p605_coding-standards-and-documentation-tooling.md (the `icons` warning), \_DONE_p606_layering-inversion-and-public-entry.md (the kit left off `aekasha/ui`), \_DONE_p616_review-lod-spatial-instancing-lines.md (the plan this one follows), p622_engine-6-major.md (what waits for the major: D3), p800 in `docs/templates/todo-plan-prompts.txt` (restyles the kit and adds components: §1.2), p618_review-debug-public-api.md (the debug modules that use the kit)

# Review: Input, UI Kit and HUD

Applies p600 §5 (the per-file review standard) and p605's JSDoc style to every file in scope,
records the findings per file group, and fixes or files them. It also takes the keyboard module
out of builds that bind no key, fixes the UI kit's latent bugs before apps lean on it, keeps debug
CSS and a load-time listener out of production builds, and puts the kit an app needs (windows,
dialogs, the drop-down, toasters) on `aekasha/ui`, with the nested `CLAUDE.md` and Hub page every
other subsystem has. p800 restyles the kit and adds components later; this plan makes it usable
and documented as it is.

## 1. As found (2026-10-20, branch `review-input-ui-hud` at `f4095d4`, = `main` after p616's merge, Engine 5.7.0)

### 1.1 The stub's names, checked

| Stub | Now |
| --- | --- |
| The input devices and p610's action layer (`kernel/input/`, its `CLAUDE.md`) | 11 modules: `Actions.ts` 668, `KeyboardInput.ts` 449, `MouseInput.ts` 386, `GamepadInput.ts` 360, `TouchInput.ts` 319, `ActionBindings.ts` 304, `ActionTypes.ts` 259 (type-only), `ActionRecording.ts` 143, `InputState.ts` 76, `InputPicking.ts` 37, `InputSharedTypes.ts` 28 (type-only); tests `Actions.test.ts` 617 and `InputScope.test.ts` 170; the nested `CLAUDE.md` (Input devices, Action maps, Gamepad) |
| "99 of 122 exports documented after p610" | 104 / 127 (§1.3) |
| CMP (1,062 lines) | `ui/CMP.ts` **1,062** |
| DraggableWindow (1,503 lines) | `ui/DraggableWindow.ts` **1,529**, `DraggableWindow.module.scss` 347, `DraggableWindow.test.ts` 30 |
| DialogWindow, DropDown, Toaster | `DialogWindow.ts` 89, `DropDown.ts` 251 (+ `DropDown.scss` 133), `Toaster.ts` 528 |
| the HUD | `HUD.ts` 51, `Window.ts` 14 (`getWindowSize`) |
| the icon registry | `icons/SvgIcon.ts` 174, `icons/BuiltInIcons.ts` 71, 52 SVGs in `icons/svg/` |
| the styles | `styles/index.scss` 48 (the components', every build), `page.scss` 37 (the full-page boot's), `variables.scss` 56, `normalize.scss` 343 |
| "documented for app use, with a Hub page" | `aekasha/ui` exports `CMP` (with `TCMP`, `TProps`), `getHUDRootCMP`, `addToast` / `removeToast`, the icons. **No window, dialog, drop-down or `createToaster` is on any entry** (p606 left "the UI kit past `CMP` and toasts" to this plan). **No Hub page and no nested `CLAUDE.md`** for the kit: the windows are a paragraph of the root `CLAUDE.md`'s Debug system section. The Hub's Input page exists and matches the code. |

Two files are over the 800-line limit: `CMP.ts` and `DraggableWindow.ts`. No function over 150
lines was found by reading (`CMP.createListeners` is the longest, about 115); Phase 0 rechecks.

In scope (D1): `kernel/input/` with its `CLAUDE.md`, and `ui/` with its styles and icons. Outside
them, only what a change here touches: `kernel/loop/MainLoop.ts` (the held-key hook, I2),
`kernel/init/Boot.ts` (the style import, S1), `debug/debugger.scss` (where it's imported from, not
its rules), `devTools/verify/moduleSideEffects.test.ts` (G1), `kernel/config/Config.ts`
(`draggableWindows`, W3), `devTools/refactor/moveMap.ts` (the ui → kernel edge, D7), the root
`CLAUDE.md`'s window paragraph (moved, D13), and the Hub's Input and new UI kit pages. Not in scope:
the debug modules that build panels from the kit (p618's; p800 rewrites them), and the scene
loader's loader UI (p613's, §1.2).

### 1.2 The stub's inputs, checked

- **p605 Phase 5's `notExported` `icons`:** the stub's path (`UI/icons/SvgIcon.ts`) and reason
  (`SvgIconKey` as `keyof typeof`) are stale: p607 D12 made `SvgIconKey` `BuiltInIconName |
  (string & {})`, both exported. Phase 0's `yarn hub:build` confirms the warning is gone.
- **p612 Phase 3's `pollHeldKeyBindings`:** confirmed (a `.some` closure and `getChordArray`'s
  `[chord]` per `KEY_HELD` binding and sub-step), and more (I1, I2).
- **p612 Phase 7's links:** `ActionTypes.ts`' `{@link setActionContextEnabled}` is now line 31,
  `{@link createActionMap}` lines 161 and 191 (I8).
- **p613 D5:** as the stub says. The hooks are added on the windows' first use (`addWindowHooks`
  from `getWindows()` and the registration functions), never at load (`DraggableWindow.test.ts`);
  `handleWindowsOnSceneChangeStart` / `End` and `loadDraggableWindowStatesFromLS` are private.
- **p613 Phase 9's layout report:** "ui → kernel" lists `DraggableWindow.ts`' `Config.ts`
  (`getConfig`, `IS_DEBUG_ENV`, `IS_PROD_TEST_MODE`), `MainLoop.ts` (`addResizer`),
  `SceneHooks.ts` (`addSceneHooks`) and `BootHooks.ts` (`addBootAfterStartHook`), and its test's
  three. The other direction exists too: `Boot.ts` imports the HUD, the toaster and the icons,
  `SceneLoader.ts` and `Viewports.ts` the HUD root, `Config.ts` and `Views.ts` kit types (W4, D7).
- **p611's seams:** the input scope and `addInputListenerRemover` / `removeAllInputListeners` work
  as described (`InputScope.test.ts`). The page-height wheel unit still reads
  `window.innerHeight` (I9). The HUD slot works (`createHudContainer(slot)`). The kit's `rem`
  sizes in an embed are undecided (S2, D8). The banner's `ui` group is CMP and the HUD (the boot's
  HUD root and the loader UI); the loader UI is still the loader's, p613's area: Phase 0 records
  what it costs, nothing more.
- **p622** lists "The deprecations without a version (`ui/DraggableWindow.ts`'s six, …): each gets
  a version or a removal here". None of the six is on an entry or has a caller (W2): this plan
  removes them, and p622's line drops them (D3).
- **p800's prompt** (the debugger UI overhaul): its own components, a restyle from the Hub's look,
  a component page, accessibility. This plan changes no visual style and adds no component; it
  fixes, documents and exports what exists, so p800 starts from a kit apps already use.

### 1.3 Documentation (the ratchet's `docs.json`)

| Folder | Exports | Undocumented exports |
| --- | ---: | --- |
| `kernel/input` | 104 / 127 | `InputState`: `areAllInputsEnabled`, `areAppInputsSuspended`; `KeyboardInput`: **`KeyBinding`**, `KeyBindingType`, `KeyChord`, `KeyUpDownBinding`, **`createKeyBinding`**, **`deleteKeyBinding`**, **`setKeyBindingEnabled`**, `setKeyInputsEnabled`; `MouseInput`: **`MouseBinding`**, `MouseBindingType`, `MouseButton`, **`createMouseBinding`**, **`deleteMouseBinding`**, **`setMouseBindingEnabled`**, `setMouseInputsEnabled`; `TouchInput`: **`TouchBinding`**, `TouchBindingType`, **`createTouchBinding`**, **`deleteTouchBinding`**, **`setTouchBindingEnabled`**, `setTouchInputsEnabled` |
| `ui` | 42 / 74 | `CMP`: **`TCMP`**, `TAnimChain`, `TAnimState`, `TAttr`, `TClassAction`, `TListener`, `TListenerCache`, `TListenerCreator`, `TProps`' type itself (its members are documented), `TSettings`, `TStyle`; `DialogWindow`: `DialogProps`, `openDialog`; `DraggableWindow`: `DraggableWindowContent`, `DraggableWindowData`, `DraggableWindowUnits`, `OpenDraggableWindowProps`, `closeDraggableWindow`, `getDraggableWindow`, `openDraggableWindow`, `removeDraggableWindow`, `toggleCollapse`; `DropDown`: `DropDownOption`, `DropDownProps`, `TDropDown`; `HUD`: `GUI_CONTAINER_ID`, `HUD_ROOT_ID`; `Toaster`: **`AddToastResponse`**, **`ToastProps`**, `DEFAULT_TOASTER_SETTINGS`, **`addToast`**, `createToaster` |
| `ui/icons` | 6 / 6 | |

55 exports; **bold** names are on an entry. Members read 0 / 0: the ratchet counts the members of
classes and interfaces, and every type in scope is a type alias, so the aliases' fields (TCMP's
methods, `OpenDraggableWindowProps`' flags, the bindings' fields) go uncounted; D11 documents them
anyway. The documented ones follow an older style in places: `@param id (string) window id`,
`@returns ({@link TCMP})` (p605 has no types in tags), and member comments as trailing `//`
(`enabled?: boolean; // default true`).

### 1.4 Findings by file group

Numbered for the phases. **(bug)** marks wrong behaviour, **(perf)** per-frame cost, **(SBP)**
bytes or load-time work in a build that doesn't need them; the rest are hygiene, placement and API
shape. Read from the code, not reproduced, unless a finding says so. Type hygiene is clean in
`kernel/input/` (no `any`, no `eslint-disable`, no TODO); `ui/`'s is U8.

**Keyboard, mouse, touch (`KeyboardInput.ts`, `MouseInput.ts`, `TouchInput.ts`, `InputPicking.ts`, `InputSharedTypes.ts`)**

- I1 **(perf)** `pollHeldKeyBindings` runs once per fixed sub-step and allocates per `KEY_HELD`
  binding: the `.some` closure and `getChordArray`'s `[chord]` (p612). Beyond it, every
  case-insensitive chord test (`chordIsHeld`) lowercases each held key (`k.toLowerCase()`, a
  string per held key per test) and the chord's key. The action layer reads the same function for
  every key action of every map on every key event and on every frame a gamepad changed
  (`readActionDevices` → `isKeyChordHeld`). And it calls `initKeyListeners()` on every step.
- I2 **(SBP)** `MainLoop.ts` imports `pollHeldKeyBindings` statically, so `KeyboardInput.ts` is in
  every build (its listener code is in `dist-embed/banner`'s chunk), against the input
  `CLAUDE.md`'s "an app bundles only the devices it uses". And since the poll calls
  `initKeyListeners()`, any app adds the key listeners at its first step, with no key binding or
  map: on the window (`WINDOW`), or on the canvas with a `tabindex` (`CANVAS`).
- I3 The debug camera rule (`isInputInDebugCamInvalid`) is written four times (the three devices
  and `Actions.ts`' `isDebugCamRuleMet`).
- I4 `setKeyInputsEnabled`, `setMouseInputsEnabled`, `setTouchInputsEnabled`: undocumented, on no
  entry, no caller (the input `CLAUDE.md` says so); each is a branch in its device's hot path.
- I5 API gaps: the entry has `KeyBinding`, `MouseBinding`, `TouchBinding` and the action types,
  not the types they name: `KeyChord` (also `ActionKeys`'), `EnabledInDebugCam` (`ActionMapOpts`,
  `ActionMap`), `MouseButton` (`MouseButtonActionBinding`), `Modifiers`, `BindingMeta`,
  `TargetList`, `PickOpts`, each union's members (`KeyUpDownBinding`, `KeyHeldBinding`,
  `KeyBindingBase`, `MouseClickBinding`, …, `TouchPinchBinding`) and the `*BindingType`s. A
  rebinding screen needs `GAMEPAD_BUTTON_NAMES` and `getKeyChordLabel`.
- I6 Exported, on no entry and not `@internal`: `getKeyChordLabel`, `doKeyChordsCollide`,
  `getKeyBindings`, `isChordHeld`, `markChordReserved`, `pollHeldKeyBindings`, `pickTargetsAt`,
  `CLICK_MAX_MOVE_PX`, `GAMEPAD_BUTTON_NAMES`, and `InputState.ts`' switches
  (`setAllInputsEnabled`, `areAllInputsEnabled`, `setAppInputsSuspended`,
  `areAppInputsSuspended`, `areAppInputsEnabled`).
- I7 Stale docs: `InputSharedTypes.ts`' "per decision 9 in the plan" and `UI/icons/SvgIcon.ts`;
  `InputState.ts`' header and `setAllInputsEnabled` name "Keyboard/Mouse/Touch" (the gamepad and
  the action contexts read it too). `set*BindingEnabled` writes `enabled` on the object the app
  passed (the binding is kept as given): nowhere said.
- I12 **(perf)** `TouchInput.ts`' `onTouchMove` makes a `{ x, y }` delta object on every
  `touchmove` (found by Phase 0's audit): touch events aren't gated per frame, and a drag on a
  phone fires them at 60-120 Hz. A module-level scratch object, valid during the call (as
  `ActionBindings.ts`' `_stick`), with a `@remarks` on `TouchDragBinding.onMove`.

**The action layer (`Actions.ts`, `ActionBindings.ts`, `ActionTypes.ts`, `ActionRecording.ts`, `GamepadInput.ts`)**

- I8 `ActionTypes.ts`' three `{@link}`s link nowhere (p612): the type-only file imports neither
  name. An `import type` of each fixes them (the file stays erased).
- I9 The wheel's page unit (`deltaMode` 2) is `window.innerHeight`: in the `CANVAS` scope the
  page is the host's, and the canvas' height is the right unit (p611).
- I10 **(bug, latent)** The action layer's device sources are added once and never reset ("once
  added, they stay"): after `removeAllInputListeners()` its `has*Source` flags stay set, so a map
  made after an unmount gets no listeners. Unreachable today (one mount per page load,
  `docs/issues/remount-after-unmount.md`); a remover of its own fixes it for when that changes.
- The action layer's per-step path is clean: `sampleActions` writes each state in place, the
  replay and the recording allocate only a recording's frames, the gamepad poll diffs into typed
  arrays. `Actions.ts` (668) is under the limit.

**`InputState.ts`**: small and right (the master switches, the scope, the removers); only I6's
docs.

**Input tests**

- I11 The binding layer has no unit test beyond `InputScope.test.ts`' listener checks: chord
  matching (the modifier rule, a modifier key's own flag, `ignoreModifiers`, case), `KEY_HELD`
  polling, `yieldToOtherBindings`, the mouse's click vs drag threshold and right double-click
  timing, the touch tap, drag and pinch. The action layer has 617 lines of tests.

**CMP (`CMP.ts`)**

- U1 **(bug)** `addTemplateChildCmp` calls the *parent's* `onCreateCmp` once per template child,
  inside its loop, so a CMP with N template children gets N calls at creation (before it's in the
  DOM) and N + 1 at every `update()`. A template child itself never gets its own. Nothing in
  `src/` uses `onCreateCmp` (`_dbg__AssetsPreview.ts` works around the second half).
- U2 **(bug)** A custom listener's `options` (`TListenerCreator.options`) are stored but never
  passed: every listener is added with `true` (capture), so `passive` or `once` do nothing. Every
  CMP listener is a capture listener, which nothing documents (a child's `stopPropagation()`
  doesn't stop its parent's `onClick`).
- U3 **(bug)** In an animation chain, a `phaseEndFn` that returns an index runs `timerFn`
  recursively and then carries on with the old phase: two timers run, and `removeAnim` clears only
  the last one stored. Nothing uses `anim` today.
- U4 **(bug)** `focusCmp` calls `setSelectionRange` on any `HTMLInputElement`; it throws on a
  number, checkbox, range or email input.
- U5 **(bug)** `updateAttr` records new attributes in `props.attr` only when it exists: on a CMP
  made without `attr`, the next `update()` rebuilds the element without them.
- U6 A style key that is a custom property (`--x`) is set through `elem.style[prop]`, which ignores
  it; `setProperty` takes it.
- U7 **(perf)** The update methods copy the whole props object on every call (`setPropsValue`
  spreads it; `updateStyle` also spreads the style object per key). An app HUD that updates text
  or a style every frame (a speedometer; the sky box example's clock updates on change) allocates
  per frame. In-place writes need neither copy.
- U8 Type hygiene: seven `eslint-disable … no-explicit-any` without a reason in `removeCmp` and
  `removeAnim`, none needed (each field's type takes the value written); `@TODO` (an
  `onWindowResize` prop), two "test if null values remove the rule?" (answered by the code beside
  them), and a `@SUGGESTION` block of methods nobody asked for.
- U9 It imports three for `MathUtils.generateUUID` (ids): a counter does (the toaster's comment
  already prefers counters to timestamps), and `createNewId` has no caller.
- U10 Size: 1,062 lines. `createListeners` writes one block seven times (click, mousemove,
  mouseleave, focus, blur, input, change; about 90 lines); the animation chain (`updateCmpAnim`,
  `runAnims`, `removeAnim(s)`, about 125) is a part of its own.
- U11 Naming: the `T`-prefixed types (`TCMP`, `TProps`, `TListener`, `TSettings`, …, DropDown's
  `TDropDown`) are the only ones in the engine. `TCMP` and `TProps` are on the entry, so a rename
  is breaking (D3).
- U12 `getCmpById`, `createNewId`, `addStylesToHead`: exported, no caller, on no entry. `TSettings`'
  doc ("Lighter settings can only be set…") names another library. The old-style JSDoc
  (`@param props ({@link TProps}) optional component props`).

**Draggable windows (`DraggableWindow.ts`, `Window.ts`)**

- W1 Size: 1,529 lines. Its parts: the types (about 230 with their docs), the config resolution,
  `createConfig` and LS (about 230), stacking (90), geometry and fitting (170), kinds (65), the drag
  sessions (125), the DOM build (180), the public API (400, of which the deprecated 80). No
  function over 150 lines.
- W2 Six `@deprecated` functions without a removal version (`closeAllDraggableWindowsStartingWith`,
  `getDraggableWindowsStartingWith`, `addOnCloseToWindow`, `registerDraggableWindowCmp`,
  `registerDraggableWindowSceneTargetResolver`, `registerDraggableWindowContentFn`), plus
  `toggleCollapse` and `getDraggableWindowsDefaultZIndexes`: no caller in `src/` or the Hub, on no
  entry. Removing them breaks no app (the lint lets an app import only the entries).
- W3 A registered content function is stored by writing into the app's config
  (`getConfig().draggableWindows[id] = { contentFn }`): `AppConfig.draggableWindows` is a public
  config key that `src/CONFIG.ts` doesn't set, read by `buildContent` as a fallback.
- W4 Placement: ui → kernel as §1.2 lists, and kernel → ui. The four kernel names are the kit's
  only way to follow scene loads, the boot and resizes without the kernel naming the windows
  (p613 D5 took those imports out of the loader and the boot).
- W5 In an embed the windows measure the wrong box: `getWindowSize` reads the browser window, and
  a mounted HUD's fixed elements are relative to the mount's container (`contain: layout`), so the
  clamps, the fit and the cascade use the page's size; the default max size is `100vw` × `100vh`.
  No embed opens a window today.
- W6 Not on an entry (§1.1): the root `CLAUDE.md` documents the kinds, `toggleDraggableWindow`,
  `updateDraggableWindowsOfKind` and the fits as the way to build windows, and only engine code
  can call them.
- W7 Docs: `openDraggableWindow`, `closeDraggableWindow`, `removeDraggableWindow`,
  `getDraggableWindow` and four types undocumented; most `OpenDraggableWindowProps` and
  `DraggableWindowConfig` flags have none; `@param id (string)` style; `Units` is a generic name
  for a module type (`DraggableWindowUnit`).
- W8 A drag makes a closure per animation frame (`requestAnimationFrame(() =>
  applyDragSession(entry))`): pointer-drag time only, one function per session does.

**Dialogs, drop-down, toasts, HUD (`DialogWindow.ts`, `DropDown.ts`, `Toaster.ts`, `HUD.ts`)**

- G1 **(SBP)** `DialogWindow.ts` adds two window key listeners at module load (`if (typeof window
  !== 'undefined') window.addEventListener(…)`), against the no-side-effects rule. The rule's
  test (`moduleSideEffects.test.ts`) checks only top-level expression statements, so an `if`
  passes. Whenever the module is bundled, every Escape press on the page goes through it
  (capture, on the window), also in an embed.
- G2 Docs: `openDialog`, `DialogProps`, `createDropDown`'s option and handle types, the toaster's
  `createToaster`, `addToast`, `ToastProps`' fields, `AddToastResponse`'s fields,
  `DEFAULT_TOASTER_SETTINGS`, the HUD's two ids; `getGUIContainerElem` is exported for no one.
- G3 `AddToastResponse.timeout` is the toast's first timer, which the next phase replaces; its own
  doc says not to use it (D3).
- G4 DropDown is right (keyboard, focus, ARIA); its handle type is `TDropDown` (U11).

**Icons (`icons/`)**: clean (p607 D12's registry, documented, an `@example` each).

**Styles (`styles/`, `*.scss`)**

- S1 **(SBP)** `styles/index.scss`, which `Boot.ts` imports in every build, forwards
  `debug/debugger.scss` (137 lines: the ray cast stats and other debug panels) and holds
  `.statsContainer` (the debug stats): debug CSS in every production build. `banner.css` is
  2.3 kB with no UI shown. `yarn verify:baselines`' debug check reads JS modules, not CSS.
- S2 The kit's sizes are `rem`s on `page.scss`' `html { font-size: 62.5% }`, which a mount doesn't
  load: a kit component in an embed renders at the host's root size (1.6× at the default 16px).
  The toaster's injected CSS too.
- `variables.scss` is mostly the debugger's colours: p800's.

## 2. Decisions (confirmed 2026-10-20, as recommended)

### D1. Scope: §1.1's files

`kernel/input/` and `ui/` with their docs. Outside them, only §1.1's list of what a change
touches. The debug modules that use the kit aren't reviewed (p618), and their look isn't changed
(p800).

### D2. Versions

Engine **minor** (5.7.0 → 5.8.0): the kit and the input types on the entries (D6), the bug fixes
(D4), the keyboard hook (D5). Toolkit: no change expected. App **patch** if an app file changes
(D13's example). Project = engine.

### D3. What waits for engine 6.0.0 (p622)

Listed in p622 as candidates, not changed in a minor (as p614-p616 did):

- The `T`-prefixed type names (U11): `TCMP` → `Cmp`, `TProps` → `CmpProps`, and the rest, with
  the ones D6 adds under their current names, renamed together.
- `AppConfig.draggableWindows` (W3): deprecated now, removed there.
- `AddToastResponse.timeout` (G3): deprecated now, removed there.
- p622's "deprecations without a version" line loses `ui/DraggableWindow.ts`' six: removed here
  (W2: on no entry, no caller).

### D4. The CMP bugs fixed first, with tests

U1-U6, each with a test in Node (`ui/CMP.test.ts`, linkedom's `document` and `window` stubbed in
the file, as the test rules ask): `it.fails` in Phase 0, `it` after the fix.

- U1: a CMP's `onCreateCmp` runs once when it is mounted (added, attached as the root, or put in
  place of its `<cmp>` placeholder by its parent's template) and once after each `update()`. A
  template child gets its own call (`_dbg__AssetsPreview.ts`' comment changes; it doesn't use the
  hook).
- U2: the options are passed (`{ capture: true, ...options }`, so capture stays the default and
  removal matches), and the capture phase is a `@remarks` on `TProps`.
- U3: a jump returns after the recursive call.
- U4: `setSelectionRange` only where the input supports it (`selectionStart !== null`).
- U5: `updateAttr` records into `props.attr`, creating it.
- U6: custom properties through `setProperty` (and `removeProperty`).

**Alternative for U1:** drop only the per-child call, and leave template children without one.

### D5. The keyboard in a build that binds no key (I1, I2)

- `MainLoop.ts` stops importing `KeyboardInput.ts`: it calls a held-key poller hook
  (`setHeldKeyPoller`, `@internal`, like `setActionSampler`) that the first `KEY_HELD` binding
  sets, at the same two places, in the same order (after the action sample). An app without key
  bindings or maps bundles no keyboard module and adds no key listener (measured on the banner,
  Phase 2).
- `pollHeldKeyBindings`: no closure, no array, no `initKeyListeners()` per call.
- The held keys are also kept lowercased (a second `Set`, updated with the first), and chords are
  lowercased once (a key binding's at `createKeyBinding`, kept beside it; the action layer's at
  compile): a case-insensitive test is a `Set` lookup, with no string made.
- **Behaviour change:** the key listeners start with the first key binding, action map or
  `isChordHeld`, not at the first step. Nothing reads keys without one of them.

### D6. The public API

- **On `aekasha/ui`** (minor additions; p606 left them to this plan):
  - The windows: `openDraggableWindow`, `closeDraggableWindow`, `removeDraggableWindow`,
    `toggleDraggableWindow`, `getDraggableWindow`, `updateDraggableWindow`,
    `bringDraggableWindowToFront`, `isDraggableWindowOnTop`, `fitDraggableWindowToScreen`,
    `fitAllDraggableWindowsToScreen`, `registerDraggableWindow`, `registerDraggableWindowKind`,
    `getKindWindowId`, `getDraggableWindowsOfKind`, `updateDraggableWindowsOfKind`, and their types
    (`OpenDraggableWindowProps`, `DraggableWindow`, `DraggableWindowConfig`,
    `DraggableWindowContent`, `DraggableWindowData`, `DraggableWindowKindOpts`,
    `DraggableWindowUnits`, `DraggableWindowUnit` (W7's rename of `Units`, free while it's on no
    entry), `SceneTargetResolver`).
  - `openDialog`, `DialogProps`; `createDropDown`, `DropDownProps`, `DropDownOption`,
    `TDropDown`; `createToaster`, `hasToaster`, `removeToaster`, `ToasterProps`,
    `ToasterSettings`, `ToastType`, `ToastDirection`, `DEFAULT_TOASTER_SETTINGS`;
    `KEEP_IN_VIEWS_CLASS`; `classes`; the types `TProps` names (`TListener`, `TListenerCreator`,
    `TStyle`, `TAttr`, `TClassAction`, `TAnimChain`, `TAnimState`, `TSettings`).
- **On `aekasha`** (input): the types I5 lists, `GAMEPAD_BUTTON_NAMES` and `getKeyChordLabel`.
- **Not added:** `isChordHeld` (gameplay reads maps), `getKeyBindings`, `doKeyChordsCollide` and
  `markChordReserved` (the debug keys'), the master switches (the loader's and the views'),
  `setInputScope` (the mount's), `pickTargetsAt`, `CLICK_MAX_MOVE_PX`, `getWindowSize`.
- **Removed** (on no entry, no caller): W2's eight, `getCmpById`, `createNewId`,
  `addStylesToHead`, the three per-device switches (I4), `getGUIContainerElem`'s export.
- **`@internal`**, with a summary saying who uses it: everything else exported in scope and on no
  entry (I6).
- `AppConfig.draggableWindows` (W3): the registered content functions go into a module map; the
  config key is still read as a fallback and `@deprecated` (D3).

**Alternative for I4:** the per-device switches on the entry, documented, instead of removed.

### D7. The UI kit may name the kernel's hooks (W4)

The target layout (`moveMap.ts`' `checkEdge`, as built: `moveRules.ts` holds only the path rules)
allows ui → kernel for `kernel/config/Config.ts` (the env
flags), `kernel/loop/MainLoop.ts` (`addResizer`), `kernel/scene/SceneHooks.ts` and
`kernel/init/BootHooks.ts`, so the layout report stops listing them. The kit is engine code that
ships only with the kernel, and these registries are how it follows a scene load, the boot and a
resize while the kernel names no window (p613 D5). After W3, `Config.ts` gives only the flags.

**Alternative:** a seam (the kernel hands the kit its hooks during the boot): more code, and a
window registered before the boot would have none.

### D8. The kit in an embed (S2, W5): filed, for p800

An issue file (`docs/issues/ui-kit-in-an-embed.md`): the `rem` sizes against the host's root,
`getWindowSize` and the `vw` / `vh` max sizes against the container. p800 restyles every component
and picks their units, so its prompt gets the requirement, and the UI kit page states it. No embed
shows kit UI today (the banner has none).

**Alternative:** a `--aek-rem` custom property now (`page.scss` sets `1rem`, the HUD root a
fallback), about 150 values in four style files that p800 then rewrites; and `getWindowSize`
reading the HUD's container.

### D9. Nothing debug or load-time in a production build (G1, S1)

- G1: `DialogWindow.ts` adds its Escape listeners on the first `openDialog` with `closeOnEscape`.
  It stays first among the window's capture listeners for Escape, as now, by checking the ray
  tester's Esc cancel (the one later capture listener its comment names) in Phase 2.
  `moduleSideEffects.test.ts` checks every top-level statement that isn't a declaration (an `if`,
  a loop, a block, a `try`), and Phase 0 lists what else that finds in `src/` (fixed here if it's
  in scope, else named for its plan).
- S1: `debugger.scss`' rules and `.statsContainer` move out of `styles/index.scss` into the debug
  modules that use them (a style import of their own, loaded with them), so a production build's
  CSS carries the kit's rules only. `banner.css` and the app's `index.css` are measured before and
  after; each debug panel is checked by eye in the dev server.

### D10. Size

- `CMP.ts` (U10): `createListeners` as one loop over a table of the seven props (same events,
  same phase), and the animation chain into `CMPAnim.ts`; with U8 and U12's removals, about 800.
- `DraggableWindow.ts` (W1): split along its parts, moved as they are: `DraggableWindowTypes.ts`
  (the public types), `DraggableWindowStore.ts` (config resolution, `createConfig`, LS, kind
  geometry), `DraggableWindowGeometry.ts` (styles, px conversion, clamps, fits, cascade, place),
  `DraggableWindowDrag.ts` (the drag sessions and handles); `DraggableWindow.ts` keeps the stacks,
  the DOM build, the hooks and the public functions (about 650). The LS format doesn't change.

### D11. Documentation

§1.3's 55 exports to 100 %, entry names first, and the type aliases' members in scope (TCMP's
methods, every `OpenDraggableWindowProps` / `DraggableWindowConfig` field, the bindings' fields,
the toast fields), checked by reading since the ratchet doesn't count them. p605's style
throughout (no types in tags, member docs as `/** */`). `@example` on what an app calls: `CMP`,
`openDraggableWindow`, `registerDraggableWindowKind`, `openDialog`, `createDropDown`,
`createToaster` / `addToast`, `createKeyBinding`, `createMouseBinding`, `createTouchBinding`.
`@remarks` for the traps: CMP's capture listeners (U2), `set*BindingEnabled` writing the passed
object (I7), Chrome's gamepad rule (there already). I7's and U12's stale text, I8's links.

### D12. Tests

New, in Node: `ui/CMP.test.ts` (D4's cases, then create, add, update keeping added children,
template children, remove clearing listeners and timers, `classes`), `ui/DialogWindow.test.ts`
(Escape closes the top dialog, swallows its keyup, no listener before the first escape dialog),
`DraggableWindow.test.ts` grows (the config resolution's rule set and the LS round trip, through
the module with linkedom), `kernel/input/KeyboardInput.test.ts` (I11's keyboard cases, D5's
poll), `MouseInput.test.ts` and `TouchInput.test.ts` (I11's, with event stubs as
`InputScope.test.ts` makes them). The toaster and the drop-down only if linkedom runs their DOM
reads (`offsetWidth`, `focus`); else the scene runner and a check by hand.

### D13. The kit gets its docs

- A nested `src/_engine/ui/CLAUDE.md` (one `## UI kit` section: CMP and its rules, the HUD root
  and `KEEP_IN_VIEWS_CLASS`, the windows (the root's Debug system paragraph moves here), dialogs,
  the drop-down, toasters, icons, the styles and what a mount loads), its line in the root's map.
- A Hub feature page "UI kit" whose `aek:covers` names it: building an app HUD from the kit (a
  panel, a toast, a window of a kind, a dialog, a drop-down), with the embed caveat (D8).
- The Input page: the binding types and the two names D6 adds, under Key APIs.
- `readme.md`: the UI kit in Features if it isn't there.
- An example scene for the page (`examples/uiKit/`, chosen 2026-10-20 with the recommendations):
  an app HUD built from the kit, a menu dialog opened by an action map in its own context, a
  settings window, a drop-down and toasts. The stub asks for "a Hub page showing an app HUD built
  from it", and the kit is new on the entry, so the page shows it running.

### D14. Performance

I1, I2 (D5), U7 (in-place props writes) and I12 (the touch delta's scratch object). Nothing in the template polls a `KEY_HELD` binding
or updates the HUD every frame, so there is no scene to time: `perf-auditor` runs over
`kernel/input/` and `ui/` in Phase 0 and confirms or adds to these, and Phase 2 reads the
changes against them. The banner's bytes are measured (`yarn sbp --profile banner`).

## 3. Phases

Each phase leaves the tree green: `yarn test`, the lint and `tsc` (the Stop hook), and the phase's
own checks. `yarn verify:scenes` runs in Phase 0 (`--update`, on this commit = `main`) and once in
Phase 6 for Phases 1-5 together (decided 2026-10-20; snapshots, hashes and system order
unchanged unless a phase says otherwise; no file is edited while it runs). Each phase ends with
its "As built" list, its files' JSDoc at 100 % and `docs.json` updated (`yarn verify:baselines
--docs --update`).

### Phase 0: baselines, measurements and repro — done

1. `yarn verify:scenes --update` on this commit, then `yarn verify:baselines` clean.
2. `perf-auditor` over `kernel/input/` and `ui/`: confirm or add to I1, U7, W8. The functions over
   150 lines rechecked.
3. `yarn hub:build`: the warnings in scope (the `icons` one expected gone, I8's three).
4. `yarn sbp --profile banner --why` for `kernel/input/KeyboardInput.ts` and the `ui` group, and
   `banner.css` / `index.css` sizes: recorded here.
5. The `moduleSideEffects.test.ts` change (D9) run once to list what it finds.
6. Repro: D4's tests as `it.fails` (U1-U6) in `ui/CMP.test.ts`, with linkedom.
7. Record the numbers here.

As built (2026-10-20, at `f4095d4` plus this plan and the Phase 0 tests; WSL2, headless Chromium,
WebGL2 through SwiftShader):

- **D1-D14 confirmed** as recommended (2026-10-20), before Phase 0. D13's example scene: yes
  (`examples/uiKit/`).
- **Baselines (step 1):** `yarn verify:scenes --update` recorded 101 of 104 runs
  in 3,837 s. The three it didn't are `thirdPersonGymScene`'s debug configurations ("the physics
  probe didn't reach step 600 in 300 s" on SwiftShader), the same three as every run of p616's on
  this machine; the gym's `prodTest` passes. Phase 1's and later runs compare the other 101. `yarn verify:baselines`
  on this commit: `api.json`, `docs.json` and the banner's bundle unchanged, no debug code in
  either build; its one "change" is `assets/EngineRapier.js` and `EngineRapier.js#2` swapping
  their sizes (9.3 / 9.5 kB gzip): two chunks with one name whose `#n` order flipped between
  builds, not a change of this branch (`docs.json` 2,204 / 2,414 exports, 935 / 970 members).
- **The perf audit (step 2)** confirmed I1 (every part: `initKeyListeners()` per call, the array
  and closure per `KEY_HELD` binding, `chord.key.toLowerCase()` and a lowercased string per held
  key per chord test, also through the action layer on every key event and gamepad-change frame),
  U7 (`setPropsValue`'s copy per call, and `updateStyle`'s style copy per key) and W8 (one closure
  per animation frame of a drag). It added I12 (the touch delta per `touchmove`) and
  `pickTargetsAt`'s options object per raycast (per pointer-moved frame or click: left as is). It
  found the action layer's per-step and per-event paths, the hover system, the gamepad poll, the
  recording and the toaster clean. No function over 150 lines in either folder (the longest:
  `createListeners` 112, `createActionMap` 93, `mountWindow` 74).
- **`yarn hub:build` (step 3):** 428 pages; in scope exactly I8's three (`ActionTypes.ts:37`,
  `:162`, `:194`). The `icons` `notExported` warning is gone (p607 D12), as §1.2 expected.
- **The banner (step 4)**, `yarn sbp --profile banner --why src/_engine/kernel/input/KeyboardInput.ts`:
  the input group is in the initial chunk, 2 modules (`KeyboardInput.ts`, `InputState.ts`),
  5,565 B rendered, 1,755 B gzip; the `ui` group 3 modules, 22,360 B rendered, 5,217 B gzip.
  CSS: `banner.css` 2,300 B (896 gzip), with the `rayCastStats` and `.statsContainer` rules (S1);
  the app's `index.css` 4,416 B (1,636 gzip). `--why` takes one profile.
- **The side-effects test (step 5)** now flags every top-level statement that isn't a
  declaration (`isDeclaration`; `export default` and a declaration's initializer aren't read). It
  finds one in `src/`: `DialogWindow.ts:58`, G1. It's on `NOT_YET_INSTALLED` (count 1) until
  Phase 2, so the test stays green and fails once the count can drop.
- **Repro (step 6):** `ui/CMP.test.ts`, linkedom stubbed in the file: U1 (two cases: the parent's
  calls, a template child's own), U2, U3, U4 (a number input's `selectionStart` null and a
  throwing `setSelectionRange`, as a browser's), U5, each `it.fails` failing on its own assertion.
  U6 isn't reproducible in Node: linkedom's style takes `style['--x']`, which browsers ignore; it
  stays read from the code and is checked in Chromium by hand in Phase 1. `yarn test`: 93 files,
  749 passed, 6 expected fails, 1 skipped.

### Phase 1: the bugs (D4) and the tests (D12) — done

1. U1-U6 with their tests; I9 and I10.
2. D12's other tests (input devices, dialogs, windows).

As built (2026-10-20):

- **No `yarn verify:scenes` here** (decided 2026-10-20): Phase 6 runs it once for Phases 1-5.
- **U1:** `addTemplateChildCmp` calls the template child's own `onCreateCmp` when it puts it in
  place of its placeholder, never the parent's: a CMP's own runs when it's added (or a template
  child is adopted) and after each `update()`. `_dbg__AssetsPreview.ts`' comment says so.
- **U2:** a custom listener is added with `{ capture: true, ...options }` and keyed
  `` `${type}#${index}` ``, so several of one type, or one beside `onClick`, keep their own entry;
  `removeListeners` removes each by its own type and capture flag (it removed by the key before).
- **U3:** a phase end's jump returns after the recursive run. **U4:** the caret goes to the end
  (`value.length`, not `9999999999999`) only where `selectionStart` is a number. **U5:**
  `updateAttr` records into a copy of `props.attr`, made when there's none.
- **U6:** one `setElemStyle` for `createElem` and `updateStyle`: a name with a `-` goes through
  `setProperty` / `removeProperty`, the rest through the indexed form (`''` removes). The two
  `@TODO`s beside the old code went with it. Checked in Chromium (playwright, a scratch script):
  `style['--x'] = …` sets nothing, `setProperty` does; Chromium takes kebab-case names in the
  indexed form too, so only custom properties changed behaviour. No Node test (linkedom takes
  either form).
- **I9:** `Actions.ts`' wheel page is the height of the event's `currentTarget` (the canvas in the
  `CANVAS` scope), else `window.innerHeight`; no import added. **I10:** the first source a map
  adds registers `resetDeviceSources` with `addInputListenerRemover`, which forgets the three
  sources, so a map made after `removeAllInputListeners()` adds the listeners again. Both tests
  fail against `HEAD`'s `Actions.ts` and pass now.
- **D12's tests** (Node; linkedom stubbed per file where a test needs DOM), 99 files, 807 passed,
  1 skipped, no expected fails left:
  - `ui/CMP.test.ts` (11): U1 (two), U2-U5, then add / update keeping added children, template
    children rebuilt by an update, remove (children, listeners, timers, the id freed), the class,
    style (a custom property included) and text updates, `classes`. U3's repro needed the CMP
    added first (a chain starts on add), and U1's makes its template children in the `html`
    function (an update removes them and makes them again).
  - `ui/DraggableWindow.test.ts` (7): the hooks test, then open and mount, the reopen rules
    (layout kept unless reset, a passed flag and title win), a kind (content from `data`, removed
    on close, its `onClose` with the id), a scene window suspended over a load and kept or closed
    by its resolver, a failed load (`loadSettled` without `entered`) closing it, and the LS round
    trip through `vi.resetModules()` and the after-start hook. The mocks keep the hooks they get:
    Vitest clears a mock's calls between tests.
  - `ui/DialogWindow.test.ts` (3): Escape closes the top `closeOnEscape` dialog and no later
    listener gets the press or its keyup, one dialog per press (a repeat closes none), and Escape
    passes without such a dialog. The module is imported after the DOM is stubbed (its listeners
    are added at load until Phase 2); linkedom's window dispatches only its own `Event`.
  - `ui/Toaster.test.ts` (3, fake timers): a toast's phases with one timer at a time, an early
    removal and `removeToaster` clearing the timers and the styles, a missing toaster.
  - `ui/DropDown.test.ts` (3): the label and the list opened on the value, the arrows and Enter
    (the keys `preventDefault`ed), Escape without a change.
  - `kernel/input/KeyboardInput.test.ts` (16): exact chords, modifiers, `ignoreModifiers`, a
    modifier key's own chord, case, chord lists and `KEY_UP`, a replaced id, `enabled` (written on
    the passed object), `sceneId`, the master switches and `isDebugKey`, yielding, `KEY_HELD`
    polling (also a letter pressed with Shift and released after it), the labels and collisions.
  - `kernel/input/MouseInput.test.ts` (9, picking and the ECS world mocked): a click's button and
    hit, drag vs click at `CLICK_MAX_MOVE_PX`, a press and release both on the canvas, the right
    double-click's timing and the third click, the native left one, the master switch, the wheel
    over the canvas only, the context menu, hover enter and leave once per moved frame.
  - `kernel/input/TouchInput.test.ts` (4): a tap with its hit, too long or too far, a drag's
    start, deltas and end (and `preventDefault`), a pinch's distance and change with no tap.
    Phase 2's I12 makes `onMove`'s delta a reused object: this test then copies it per call.
  - `kernel/input/Actions.test.ts` (+3): I9 (the window and the `CANVAS` scope) and I10.

### Phase 2: the build and the hot paths (D5, D9, D14) — done

1. D5: the held-key hook, the poll, the lowercased keys.
2. D9: the dialog listeners and the test; the styles out of `index.scss`.
3. U7, W8 and I12.
4. Phase 0's banner and CSS numbers again, side by side.

As built (2026-10-20):

- **D5, the hook:** `MainLoop.ts` imports no keyboard code. It runs `heldKeyPoller?.(delta)` at
  the two places it called `pollHeldKeyBindings`, in the same order (after the action sample);
  `setHeldKeyPoller` (`@internal`) is set by the first `KEY_HELD` binding's `createKeyBinding`.
  The no-stepping comment's "debug camera movement" example was stale (nothing in `src/` binds
  `KEY_HELD`): it says a `KEY_HELD` binding now.
- **D5, the matching:** each binding is kept as an entry with its chords compiled once
  (`compileKeyChord`, `CompiledKeyChord`: the chord and its key lowercased, both `@internal`);
  `getKeyBindings` returns the bindings as given, rebuilt with the entries. The held keys are also
  kept in `heldLowerKeys`, and the held modifiers are written in place. A key event is read once
  (`readKeyEvent`: its key lowercased and its modifiers, memoized by the event), so every binding
  and map that tests it shares one string. `chordIsHeld` is two `Set` lookups and the modifier
  test, with no string made; `pollHeldKeyBindings` makes no closure or array and no longer calls
  `initKeyListeners()` (its binding added the listeners). Beyond D5: the old event path made a
  modifiers object per chord test (`eventMatchesChord`), now gone too, and `dispatchKeyEvent` walks
  the event's list, so a callback that creates or deletes a binding doesn't shift it.
  `isKeyChordHeld` / `doesKeyEventMatchChord` take a compiled chord: `ActionBindings.ts`' `toChords`
  compiles at compile time, `Actions.ts`' reserved-chord warning maps them back, and
  `DefaultDebugKeyBindings.ts`' `runDebugKey` compiles its key's chords at the call (only at its own
  action's press or release). A test: the poll is set by the first `KEY_HELD` binding only.
- **G1:** `DialogWindow.ts` adds its two capture listeners on the first `openDialog` with
  `closeOnEscape` (`addEscapeListeners`) and keeps them (a no-op while no such dialog is open).
  `NOT_YET_INSTALLED` is empty again; `devTools/verify/CLAUDE.md` describes the wider test. A test
  records the window's `addEventListener` calls (linkedom's window is a proxy, so a wrapper, not
  `vi.spyOn`): none at import or for a dialog without `closeOnEscape`, then keydown and keyup with
  capture. The order the old comment wanted (first among the window's capture listeners) holds
  unless the ray tester arms a pick before the first escape dialog ever opens: then one Escape
  cancels the pick and closes the dialog. Its `stopPropagation` doesn't stop listeners on the same
  target, and a dialog's backdrop covers the canvas, so a pick can't complete under one: accepted.
- **S1:** `debug/debugger.scss` is split by user and deleted, each part imported by the module that
  renders it: `kernel/render/debug/RayDebug.scss` (the ray cast stats and the ray tester, from
  `_dbg__Raycast.ts` and `_dbg__RayTester.ts`), `debug/PercentagePie.scss` (from
  `PercentagePieHtml.ts`), `debug/DebugToaster.scss` (the debug toaster's icon colours, from
  `_dbg__DebuggerGUI.ts`: the toaster is the debug env's) and `debug/Stats.scss` (`.statsContainer`,
  from `_dbg__Stats.ts`). `styles/index.scss` keeps the editor views' HUD rule and `.uiIcon`.
  Checked in a dev server (Chromium, WebGL2): with `?isDebug=true` every moved rule is present
  after the boot, `.statsContainer` is fixed at the bottom left, the debug toaster exists, no
  console error; with `?isProdTest=true` only the stats rule loads (with its module), no error.
  The production build's `index.css` has none of the moved selectors. The four new files are
  `git add -N`'d so `moveMap.ts` (the tracked tree) resolves their imports; its outputs are
  regenerated in Phase 3.
- **U7:** CMP copies the props it's given once, at create and at `update()` (`toOwnProps`: `style`
  and `attr` copied too, so a style constant several CMPs share is never written), and the update
  methods write `ownProps(cmp)` in place (`setPropsValue` and its copy per call are gone). A test:
  the props object stays the same through `updateStyle`, `updateText` and `updateAttr`, and a
  shared style constant and its other CMP are untouched.
- **W8:** a drag session makes its animation-frame callback once (`DragSession.apply`).
  **I12:** the touch drag's delta is one module object written in place; `onMove`'s type reads it
  as `readonly`, with a `@remarks` (read it in the call, copy it to keep it). No `TOUCH_DRAG`
  binding outside `kernel/input/` keeps it. The touch test copies it per call and checks it's one
  object.
- **The numbers (step 4)**, `yarn verify:baselines` and `yarn sbp --profile banner`:

  | | Phase 0 | Phase 2 |
  | --- | --- | --- |
  | Banner, input group (initial, gzip) | 1,755 B, 2 modules | 0.1 kB, 1 module (`InputState.ts`; `KeyboardInput.ts` "no code in the build") |
  | Banner, `ui` group (gzip) | 5,217 B | 5.2 kB (+0.1: `toOwnProps`, `ownProps`) |
  | `banner.css` | 2,300 B (896 gzip) | 120 B (147 gzip): the two kit rules |
  | App `index.css` | 4,416 B (1,636 gzip) | 2,236 B (981 gzip) |
  | App, input group (gzip) | 11.9 kB | 12.3 kB (+0.4: the compiled chords, the second held-key set, the event read) |

  `api.json` lists three additions (`compileKeyChord`, `CompiledKeyChord`, `setHeldKeyPoller`,
  all `@internal`), recorded in Phase 3 with D6's changes; `docs.json` recorded here (input 106 /
  129, loop 45 / 45). The bundle diff's other line is `EngineRapier.js` / `#2` swapping sizes
  again (Phase 0's noise). No debug code in either build. `yarn test`: 99 files, 810 passed, 1
  skipped.

### Phase 3: the API (D6, D7) and the deferrals (D3) — done

1. The entries, the removals, `@internal`, `draggableWindows`' module map.
2. `moveMap.ts`' edge (`checkEdge`); `npx tsx devTools/refactor/moveMap.ts` regenerated.
3. p622's list; `api.json` (`yarn verify:baselines --update`) with D6's additions and removals.

As built (2026-10-20):

- **The entries (D6):** `aekasha` gets I5's types (`KeyChord`, `KeyBindingType`, `KeyBindingBase`,
  `KeyUpDownBinding`, `KeyHeldBinding`, `MouseButton`, `MouseBindingBase`, `MouseBindingType`, the
  four mouse binding types, `TouchBindingBase`, `TouchBindingType`, the three touch binding
  types, `EnabledInDebugCam`, `Modifiers`, `BindingMeta`, `TargetList`, `PickOpts`),
  `GAMEPAD_BUTTON_NAMES` and `getKeyChordLabel`. `aekasha/ui` (rewritten in path order) gets D6's
  list, and **`TListenerCache`** beside it: `TCMP.listeners` names it. **`ClassProp`** (named by
  `DropDownProps`) is gone rather than exported: its five fields are `string | string[]`, as the
  window config's class fields are. `yarn hub:build` lists no type a public signature names
  outside the entries in scope.
- **Removed:** W2's eight, `createNewId`, `addStylesToHead` (with `stylesInHead`), the three
  per-device switches (I4) and their checks, and the exports of `getCmpById`, `toggleCollapse`
  and `getGUIContainerElem` (the first two have callers in their module: only the `export`
  went). `pendingRuntimes` went with `registerDraggableWindowCmp`, its only writer. The comments
  naming the switches (`InputState.ts`' header, `Actions.ts`') went too.
- **`@internal`**, each with a summary naming its users: the five master switches and
  `InputScope` (the mount's `input` option is its own literal union), `pickTargetsAt`,
  `getKeyBindings`, `doKeyChordsCollide`, `isChordHeld` (no caller at all), `pollHeldKeyBindings`,
  `markChordReserved`, `CLICK_MAX_MOVE_PX`, `GUI_CONTAINER_ID`, `HUD_ROOT_ID`,
  `createHudContainer` and `getWindowSize`. `Units` is `DraggableWindowUnit`.
- **W3:** a registered content function goes into the module's `contentFns`; `buildContent` reads
  it, then `getConfig().draggableWindows` as the fallback, so `DraggableWindow.ts` still reads
  `getConfig()` until 6.0.0 (D7's "only the flags" holds after p622). `AppConfig.draggableWindows`'
  doc said "size, place, content": only `contentFn` was ever read, and it says so. A test: a
  registered content stays out of the config and wins over its `contentFn`, which is still read
  for a window without one.
- **D3:** `AppConfig.draggableWindows` and `AddToastResponse.timeout` are `@deprecated` (removed in
  engine 6.0.0). p622 gets a "From p617" block (the two, and the `T`-prefixed names as a
  candidate), and its "deprecations without a version" line drops `ui/DraggableWindow.ts`' six.
- **D7:** the edge is in `moveMap.ts`' `checkEdge` (`UI_KERNEL_HOOKS`, the four modules), not
  `moveRules.ts`, which holds only path rules. `layoutReport.md` has no "ui → kernel" section left.
  The regenerated outputs also picked up p616's and Phase 2's files (765 → 788) and p616's
  `LodChainOptions.ts` split (Kernel → feature 26 → 27 type-only imports), which no run had
  recorded since.
- **The baselines** (`yarn verify:baselines --update`): `api.json` lists exactly the removals and
  additions above, plus Phase 2's three `@internal` ones (`compileKeyChord`, `CompiledKeyChord`,
  `setHeldKeyPoller`); the entries 808 exports. `docs.json`: input 108 / 126, ui 32 / 61 (fewer
  exports, none more undocumented; Phase 4's D11 takes both to 100 %). The bundle baselines
  record Phase 2's numbers (banner input 0.1 kB, its CSS 0.1 kB gzip; the app's `index.css` 0.9
  kB) and `EngineRapier.js` / `#2`'s size swap again (Phase 0's noise). No debug code in either
  build. `yarn hub:build`: 428 pages; in scope only I8's three warnings (Phase 4).
- **For Phase 4 (found here):** U9 (CMP's `three` import for ids, in no phase) goes with the CMP
  split. `registerDraggableWindow` / `registerDraggableWindowKind` say "call it once at module
  load", which the side-effects rule forbids outside `_dbg__` modules, now that an app can call
  them: D11's docs say where (an install, or the app's `start`, before the boot's after-start
  restore), and Phase 5's moved `CLAUDE.md` paragraph too.

### Phase 4: the internals (D10, D11) — done

1. The CMP and window splits; I3 (one debug camera rule, in `InputState.ts`' neighbourhood:
   `InputPicking.ts` is the mouse's and touch's, so a small `InputRules.ts` or the shared types'
   file made a module).
2. D11's docs, I7, I8, U8, U12; U9 (Phase 3); the window registrations' "at module load" wording
   (Phase 3).

As built (2026-10-20):

- **I3:** `kernel/input/InputRules.ts`' `isDebugCamRuleMet` (`@internal`), the one rule. There
  were five copies, not four: the fifth was `debug/DefaultDebugKeyBindings.ts`' (p618's folder;
  only its import changed). The devices and `Actions.ts` dropped their camera and flag imports.
- **The CMP split (D10):** the animation chain in `ui/CMPAnim.ts` (118), moved as it was; it
  writes the CMP through its own methods (`cmp.updateClass`, `cmp.updateStyle`), so it imports
  only CMP's types and there's no cycle. `createListeners` is one loop over `PROP_LISTENERS` (the
  same events, phase and keys). **Beyond the plan (decided 2026-10-20):** the types moved to
  `ui/CMPTypes.ts` (239 with their docs), since the docs would have taken `CMP.ts` past 800; the
  entry and the 40-odd modules that import them name the new file (only those import lines
  changed). `CMP.ts`: 721.
- **The window split (D10)**, cut by statement with the TypeScript compiler, moved as it was:
  `DraggableWindowTypes.ts` (299: the public types and, `@internal`, the shared internal ones),
  `DraggableWindowStore.ts` (229), `DraggableWindowGeometry.ts` (221), `DraggableWindowDrag.ts`
  (147). None imports `DraggableWindow.ts`: the LS write takes the windows map
  (`writeWindowStatesToLS`) and a drag's end calls back (`DragCommit`, `commitDrag`). The type
  importers (the entry, `DialogWindow.ts`, `Config.ts`, the test, seven debug modules) name
  `DraggableWindowTypes.ts`. `DraggableWindow.ts` is 822 with its docs (not about 650): over the
  limit, so its header says why (decided 2026-10-20): what is left shares the module's state, and
  a further split would make the modules import each other. The LS round trip test passes
  unchanged.
- **D11's docs:** `kernel/input` 127 / 127 and `ui` 89 / 89 exports documented (`docs.json`), and
  the aliases' members by reading: `TCMP`'s methods and fields, every `TProps`, `TSettings` and
  `TAnimChain` field, every `OpenDraggableWindowProps` / `DraggableWindowConfig` field, the key,
  mouse and touch bindings' fields, the toast and toaster fields, the drop-down's. `@example`s on
  `CMP`, `openDraggableWindow`, `registerDraggableWindowKind` (with `toggleDraggableWindow` and
  `getKindWindowId`), `openDialog`, `createDropDown`, `createToaster`, `addToast`,
  `createKeyBinding`, `createMouseBinding` and `createTouchBinding`, all type-checked. `@remarks`:
  CMP's capture listeners (on `TProps`, U2), `set*BindingEnabled` writing the passed object (and
  on each `create*Binding`, I7), the touch tap's emulated mouse click. The toaster's docs say the
  engine makes a toaster only in the debug env, so an app that shows toasts makes its own. The
  registrations say where to register: in `start` or a feature's install, before the boot's
  restore (a `_dbg__` module at its load).
- **I7, I8, U8, U12:** I7's stale text fixed (`InputSharedTypes.ts`, `InputState.ts`' header and
  `setAllInputsEnabled`). I8's three links use the coding standard's module form
  (`{@link _engine/kernel/input/Actions!createActionMap}`): an `import type` for a link trips
  `no-unused-vars`. `yarn hub:build` no longer warns about them. U8: the seven `any` casts (a
  field set to `undefined` instead of `null` where its type has no null), the `@TODO` and the
  `@SUGGESTION` block gone. U12: `TSettings`' doc and the old-style tags rewritten.
- **U9:** generated ids are a counter (`aekCmp_N`, skipping one taken by a given id), so `CMP.ts`
  imports no three.
- **Found:** `TSettings.doCheckIsInDom` is stored and never read: `@deprecated` (no effect), on
  p622's list. `DragCommit` had to be exported (`@internal`): TypeDoc warned that `addDragHandle`
  names a type its module doesn't export.
- **`eslint.config.js`:** `dist-embed/` and `dist-stats/` in the global ignores (decided
  2026-10-20). A bare `yarn lint` read the minified embed build that `yarn verify:baselines`
  makes and ran for 20 minutes; it takes 15 s now.
- **The checks:** `tsc` (both), `yarn lint`, `yarn test` (99 files, 811 passed, 1 skipped),
  `yarn hub:build` (435 pages, no warning in scope), `moveMap.ts --check` (795 files, no new
  boundary violation; the seven new files `git add -N`'d before their commit).
  `yarn verify:baselines --update`: `api.json` lists the moved types under their new modules and
  the new modules' `@internal` exports, the entries still 808; the app's main chunk 184 → 186
  modules at 831.7 kB gzip (+0.1), the banner unchanged; `EngineRapier.js` / `#2` swapped sizes
  again (Phase 0's noise). No debug code in either build.
- **For Phase 5:** `ui/CLAUDE.md` names the kit's files (CMP's three, the window's five) and the
  toaster rule above; the root's window paragraph says "register once at module load", which
  moves with it in the new wording.

### Phase 5: the Hub, CLAUDE.md, readme, and what's filed — done

1. D13's `ui/CLAUDE.md`, the root map line and the moved paragraph; the input `CLAUDE.md` (D5's
   hook, I4's switches gone, D6's entry names).
2. The UI kit page (and the example scene, if D13 chooses one); the Input page.
3. D8's issue file and p800's prompt; `readme.md`.
4. `yarn hub:build`.

As built (2026-10-20):

- **`ui/CLAUDE.md`** (one `## UI kit` section): CMP (its three files, templates, props copied once
  and written in place, the hooks' timing, capture listeners, custom properties), the HUD root,
  the windows (their five files, layers, the moved root paragraph with the new registration
  wording, LS, scene loads, D7's four kernel names), dialogs, the drop-down, toasters, icons, the
  styles, the embed caveat, the tests, what waits for 6.0.0. **Found:** the boot registers the
  built-in icons only in the debug env and prodTest, so a production app registers the ones it
  shows (else `??` and a warning); the file and the Hub page say so. The root `CLAUDE.md`: the map
  line, the `ui/` folder line, the windows paragraph replaced by a pointer. The input `CLAUDE.md`:
  `InputRules.ts`, the entry's types and names, the held-key hook and the compiled chords, the
  removed switches, I9, I10, I12, the device tests. `hub/CLAUDE.md` lists `ui-kit` among the
  feature pages.
- **The example scene** (`src/app/examples/uiKit/`, `exampleUiKit`, an app file: D2's app bump):
  three shapes, a HUD panel (a button per shape with a `--swatch` custom property), a window kind
  per shape with a colour drop-down, a settings window (the ground's colour, two toasts), the
  scene's toaster, and a pause menu dialog: Escape opens it through the `GAMEPLAY` map, the
  dialog's `closeOnEscape` closes it, and its arrow keys are a map in a `MENU` context that is
  off until it opens (`onClose` switches back, however it closes). No animation over time, so
  the scene runner's snapshot is stable. Driven in Chromium (WebGL2, debug and prodTest): the
  contexts, Escape both ways, the focus moves, the cascade, the cleanup on a scene change. Its
  Hub image (`exampleUiKit.hub.png`) was saved on SwiftShader through `saveHubImageAsync`; the
  example's card is a page screenshot with the HUD (`hub/pages/examples/ui-kit/ui-kit-hud.png`,
  `aek:image`), since the Hub image is the canvas only.
- **The Hub:** the feature page `features/ui-kit/` (Core, order 47, Lucide's `app-window` icon
  added; `aek:covers` `UI kit`), the example page `examples/ui-kit/` (order 75, the scene's four
  regions), the Input page (a key and a mouse binding, the binding types, `getKeyChordLabel` and
  `GAMEPAD_BUTTON_NAMES`, the held keys and the bundling, a link to the UI kit's dialogs).
- **D8:** `docs/issues/ui-kit-in-an-embed.md` (open, for p800), and p800's prompt in
  `docs/templates/todo-plan-prompts.txt` gets a paragraph marked as p617's: the kit's public API
  as its start, the 6.0.0 renames, and the embed requirement with its check.
- **`readme.md`:** the Features line is "UI kit" with what's on the entry, and the project
  structure's `ui/` line names the dialogs and toasts.
- **The checks:** `tsc`, the lint, `yarn test` (99 files, 815 passed, 1 skipped), `yarn hub:build`
  (438 pages, no warning in scope; the search index size warning is older, 1.56 MB at p616).
- **Found, not fixed (decided 2026-10-20: both fixed, in Phase 6 before its checks):**
  - The drop-down re-reads `value` only on an open and on `refresh()`, so an app's `onChange`
    calls `refresh()` (the example does). Proposed: `choose` refreshes after `onChange` (one line
    and a test).
  - A context switch in a press callback applies to the maps after it in the same key event
    (`updateAllMaps` checks each map's activity as it reaches it), so a menu that opens and closes
    on one key through two maps closes again on the same press, or reopens. The example avoids it
    (the dialog closes on Escape). Proposed: fix the active maps at the event's start, with a
    test; else a `@remarks` on `setActionContextEnabled` and a line on the Input page.
- **For Phase 6:** the new scene has no local scene runner baseline (`--update --only
  exampleUiKit` before the full run), and `yarn verify:baselines` shows its chunk as new. D2's
  app bump: a new example scene reads as an app minor rather than a patch.

### Phase 6: versions and done — done

0. Phase 5's two findings, fixed (decided 2026-10-20), so the checks cover them.
1. `yarn verify:scenes` (Phases 1-6; `--update --only exampleUiKit` first, the new scene having
   no baseline), `yarn verify:baselines`, `yarn build`, `yarn hub:build`.
2. `package.json` (D2, with the app **minor**, decided 2026-10-20: a new example scene), the
   `CHANGELOG.md` entry, `yarn checkVersions --against main`.
3. Mark the plan done (`docs/plans/CLAUDE.md`), p621's and p622's references.

As built (2026-10-20):

- **The drop-down's refresh:** `choose` calls `refresh()` after `onChange` returns, so a `value`
  getter that reads what `onChange` set shows the pick; `refresh()` stays for a change made
  elsewhere (its doc and `value`'s and `onChange`'s say so). `DropDown.test.ts`: the pick shows
  without a `refresh()`, and a new test for `refresh()` after an outside change. The example's
  two `refresh()` calls, the UI kit page's snippet and the example page's line dropped them;
  `ui/CLAUDE.md` says it.
- **A context switch in a callback:** `updateAllMaps` fixes which maps count the event first
  (`MapRuntime.isActiveAtEvent`, one pass, no allocation), then updates them; `onKeyEvent`'s
  `preventDefault` reads the same flag (a map deleted by the callbacks is skipped, one they made
  hasn't counted the event). So a switch, a `setEnabled` or a new map applies from the next
  event. A device event dispatched from inside a callback re-fixes the flags for the outer
  event's later maps (the old behaviour for them; nothing does that). `@remarks` on
  `setActionContextEnabled`; the Input page's Contexts section and the input `CLAUDE.md` say it.
  `Actions.test.ts`: Escape opens a menu in the player map and doesn't close it in the menu map
  that follows (fails on the old code: `[1, 1]`), and the next press closes it. The example
  keeps its dialog's `closeOnEscape`.
- `yarn test` (99 files, 817 passed, 1 skipped), `tsc` (both), the lint.
- **The checks (step 1):** `yarn verify:scenes --update --only exampleUiKit` recorded the new
  scene in the four configurations (hash `811c9dc5`, the empty one: no physics). The full
  `yarn verify:scenes` (Phases 1-6, WebGL2 on SwiftShader, 3,819 s): 105 passed, the hashes,
  snapshots and system order unchanged; the three that failed are `thirdPersonGymScene`'s debug
  configurations ("the physics probe didn't reach step 600 in 300 s"), as in Phase 0 and every
  p616 run on this machine, its `prodTest` passing. `yarn verify:baselines`: the two new chunks
  (`exampleUiKit.js` 12.3 kB gzip, `exampleUiKit.css` 2.1 kB), `EngineRapier.js` / `#2` swapped
  again (Phase 0's noise), `_engine/ui` 5.3 → 5.4 kB gzip (the two fixes), the main chunk 186
  modules at 832.0 kB gzip; `api.json`, `docs.json` and the banner unchanged, no debug code in
  either build; recorded (`--update --no-build`). `yarn build` (with `yarn sbp`: every budget
  within, and `yarn hub:build`: 438 pages, no warning in scope; the search index 1.66 MB, the
  older warning).
- **Versions (step 2):** engine 5.7.0 → 5.8.0 (and the project), app 1.12.4 → 1.13.0, the
  toolkit unchanged (no file of it changed). `CHANGELOG.md`'s entry `review-input-ui-hud`: Engine
  (Added, Changed with its five behaviour changes, Deprecated, Fixed), App (the example scene),
  Project (the tests, the docs, the lint and side-effects test changes, the baselines: the main
  chunk 387,312 B gzip, +491 B on `main`; the banner's 291,970 B, −910 B).
  `yarn checkVersions --against main` passes.
- **Done (step 3):** the status `implemented (Phases 0-6)`, the file `git mv`'d to
  `_DONE_p617_review-input-ui-hud.md`. p621's `Blocked by` drops it; p600 (`Blocks`, the Stage C
  table), p622 (`Related`), p605's and p610's `Blocks` and p613's `Related` name the new file.
  p622's p617 block names `ui/CMPTypes.ts` for the `T`-prefixed types (Phase 4 moved them). The
  root and nested `CLAUDE.md` files and `readme.md` were updated in Phase 5 and step 0.

## 4. Risks

- **The debugger is CMP's biggest user.** D4's fixes change what every debug panel's CMPs do
  (U1's call count, U2's options): the scene runner's debug configurations and a pass through the
  drawer tabs in the dev server catch a panel that relied on the old behaviour.
- **Moved styles** (S1) can leave a debug panel unstyled where its module doesn't load the rules it
  used: each panel checked by eye.
- **The window split** must not change the LS format (`AEK_popupWindows`): a saved layout from
  before the split restores the same.
- **The keyboard hook** (D5) changes when the key listeners start: the scene runner's input scripts
  (`playInput`) and the debug keys (action maps, so unaffected) cover it.

## Done when

- Every file in scope reviewed against p600 §5, the findings fixed or filed (`docs/issues/` or a plan item).
- JSDoc coverage of the scope's public exports at 100% (p601's `docs.json`), members included; the ratchet raised.
- `yarn test`, `yarn verify:scenes` (snapshots and hashes unchanged unless stated), `yarn verify:baselines` (no unexplained growth), `yarn build`, `yarn hub:build`. The verify commands run for minutes to hours: when one starts, give the watch command, `tail -f .cache/verify/progress.log`.
- The Hub pages of the features in scope checked against the code; CLAUDE.md's nested files for them current.
