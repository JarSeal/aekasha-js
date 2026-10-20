Status: draft | not-implemented
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
(`draggableWindows`, W3), `devTools/refactor/moveRules.ts` (the ui → kernel edge, D7), the root
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

## 2. Decisions (proposed, for review)

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

The target layout (`moveRules.ts`) allows ui → kernel for `kernel/config/Config.ts` (the env
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
- **Open:** whether to build an example scene for the page (an app HUD: a menu dialog opened by an
  action map in its own context, a settings window, a drop-down, toasts), or point it at the
  existing examples' HUD (`app/examples/exampleHud.ts`).

### D14. Performance

I1, I2 (D5) and U7 (in-place props writes). Nothing in the template polls a `KEY_HELD` binding
or updates the HUD every frame, so there is no scene to time: `perf-auditor` runs over
`kernel/input/` and `ui/` in Phase 0 and confirms or adds to these, and Phase 2 reads the
changes against them. The banner's bytes are measured (`yarn sbp --profile banner`).

## 3. Phases

Each phase leaves the tree green: `yarn test`, the lint and `tsc` (the Stop hook), and the phase's
own checks. `yarn verify:scenes` runs in Phase 0 (`--update`, on this commit = `main`), at the end
of Phase 1, and once in Phase 6 for Phases 2-5 together (snapshots, hashes and system order
unchanged unless a phase says otherwise; no file is edited while it runs). Each phase ends with
its "As built" list, its files' JSDoc at 100 % and `docs.json` updated (`yarn verify:baselines
--docs --update`).

### Phase 0: baselines, measurements and repro

1. `yarn verify:scenes --update` on this commit, then `yarn verify:baselines` clean.
2. `perf-auditor` over `kernel/input/` and `ui/`: confirm or add to I1, U7, W8. The functions over
   150 lines rechecked.
3. `yarn hub:build`: the warnings in scope (the `icons` one expected gone, I8's three).
4. `yarn sbp --profile banner --why` for `kernel/input/KeyboardInput.ts` and the `ui` group, and
   `banner.css` / `index.css` sizes: recorded here.
5. The `moduleSideEffects.test.ts` change (D9) run once to list what it finds.
6. Repro: D4's tests as `it.fails` (U1-U6) in `ui/CMP.test.ts`, with linkedom.
7. Record the numbers here.

### Phase 1: the bugs (D4) and the tests (D12)

1. U1-U6 with their tests; I10.
2. D12's other tests (input devices, dialogs, windows).
3. `yarn verify:scenes`: unchanged.

### Phase 2: the build and the hot paths (D5, D9, D14)

1. D5: the held-key hook, the poll, the lowercased keys.
2. D9: the dialog listeners and the test; the styles out of `index.scss`.
3. U7 and W8.
4. Phase 0's banner and CSS numbers again, side by side.

### Phase 3: the API (D6, D7) and the deferrals (D3)

1. The entries, the removals, `@internal`, `draggableWindows`' module map.
2. `moveRules.ts`' edge; `npx tsx devTools/refactor/moveMap.ts` regenerated.
3. p622's list; `api.json` (`yarn verify:baselines --update`) with D6's additions and removals.

### Phase 4: the internals (D10, D11)

1. The CMP and window splits; I3 (one debug camera rule, in `InputState.ts`' neighbourhood:
   `InputPicking.ts` is the mouse's and touch's, so a small `InputRules.ts` or the shared types'
   file made a module).
2. D11's docs, I7, I8, U8, U12.

### Phase 5: the Hub, CLAUDE.md, readme, and what's filed

1. D13's `ui/CLAUDE.md`, the root map line and the moved paragraph; the input `CLAUDE.md` (D5's
   hook, I4's switches gone, D6's entry names).
2. The UI kit page (and the example scene, if D13 chooses one); the Input page.
3. D8's issue file and p800's prompt; `readme.md`.
4. `yarn hub:build`.

### Phase 6: versions and done

1. `yarn verify:scenes` (Phases 2-5), `yarn verify:baselines`, `yarn build`, `yarn hub:build`.
2. `package.json` (D2), the `CHANGELOG.md` entry, `yarn checkVersions --against main`.
3. Mark the plan done (`docs/plans/CLAUDE.md`), p621's and p622's references.

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
