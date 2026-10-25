Status: in progress | Phases 0-3 implemented
Category: UI, Refactoring, Accessibility
Epic: p800_debugger-ui-overhaul.md
Blocks: p804_forms-and-bindings.md, p805_data-display.md, p806_debugger-migration.md, p808_game-ui-components.md (p800 §5; written when each starts)
Related: \_DONE_p801_design-foundation.md (the tokens, units, themes, motion and ring this restyles onto; its §4 inventory is the restyle table; the embed issues it left: Phase 3's As built), \_DONE_p802_hub-project-section.md (the component library page and its stand-ins, which this plan's kit root and resize source remove; the findings it left), \_DONE_p617_review-input-ui-hud.md (the kit as it is; D7: the kernel hooks), p622_engine-6-major.md (the `T`-prefixed names' aliases go there: D3), \_DONE_p613_review-rendering-scene-assets.md (`createSceneLoader`, the loading overlay's host), p355_save-menu-and-file-server-settings.md (its menu on this plan's button, menu and dialog)

# UI Kit Structure and Core Components

p800's third child: the kit gets the folders, coding style and names its later groups (forms,
data, game) build into. It works without the boot. Its existing pieces (windows, dialogs, the
drop-down, toasts, icons) are restyled onto p801's tokens and made accessible (p800 D8). The
overlay layer (an Escape stack, focus return, anchored positioning) arrives with the tooltip,
popover and menu built on it, and so do the core components of p800 §4.2. A new
`yarn verify:ui` runs axe-core and keyboard checks over the component library page in a real
browser.

The debugger keeps its look except where it uses the kit's pieces (its windows' frames, its
drop-downs, the debug toaster, the scene loader): its own styles are p806's.

---

## 1. As found (2026-10-25, `main` at `b2e6c1a6`, Engine 5.11.1)

### 1.1 p800's p803 sketch, checked

p800 §2.4 and §5 hold, with these differences and additions:

- The kit is 6,551 lines in 33 files (`src/_engine/ui/`, tests and styles included):
  `DraggableWindow.ts` 822 (over the size rule, its header says why), `CMP.ts` 721, `Toaster.ts`
  598, `DraggableWindowTypes.ts` 304, `DropDown.ts` 283, `tokens.css` 260,
  `DraggableWindow.module.scss` 349, `DropDown.scss` 128.
- Engine files outside `ui/` import the kit by relative path: `CMP` 32 files, `CMPTypes` 25,
  `icons/SvgIcon` 19, `DraggableWindow` 15, `HUD` 7, `Toaster` 6, `DialogWindow` 3,
  `DraggableWindowTypes` 3, `Window` 2, `DropDown` 1, `Motion` 1. About 60 files change when the
  kit's files move (Phase 1). Six files import `aekasha/ui` (`src/index.ts`, `exampleHud.ts`,
  `exampleUiKit.ts`, `uiKitEmbed.ts`, `physicsTest.ts`, the Hub's `_components.ts`; four of them
  name `TCMP`), and three `@example` blocks name it (`SvgIcon.ts`, `SceneLoader.ts`).
- The kit's imports outside itself: `utils/Logger` (2), `utils/LocalAndSessionStorage`
  (`DraggableWindowStore.ts`) and the four kernel hooks of `devTools/layout/layout.ts`'
  `UI_KERNEL_HOOKS` (`Config.ts`, `MainLoop.ts`, `SceneHooks.ts`, `BootHooks.ts`), all through
  `DraggableWindow.ts`. `MainLoop.ts` is there for `addResizer` alone, and it brings three, the
  renderer and both workers into any bundle of the windows (p802 Phase 4).
- The layout rules have one rule for the whole kit (`{ from: 'src/_engine/ui/' }`), so a subfolder
  needs no new rule; a file directly in `ui/` is allowed too.
- Accessibility today: no `role` or `aria-*` in `DraggableWindow.ts`, `DialogWindow.ts` or
  `Toaster.ts`. The drop-down is the one complete piece. `openDialog`'s Escape is two capture
  listeners on `window` (`DialogWindow.ts`), so in an embed it takes Escape from the whole host
  page.
- The input system's key listeners are on the window (or the canvas, by input scope) in the
  **bubble** phase (`KeyboardInput.ts`' `addKeyListeners`): a capture listener on the HUD root runs
  before them for any key pressed with focus inside the HUD, which D7 relies on.
- The toaster puts a `<style>` element per toaster into the host's `<head>` (`Toaster.ts:406-409`).
  Its settings are lengths and positions, not colours, so they map onto custom properties on the
  toaster's element.
- Icons: `getSvgIcon(name, size?: 'small')` wraps the SVG in `<span class="uiIcon">`, and `'small'`
  adds `smallIcon`, which only the on-screen tools style. 14 calls pass `'small'`, and 7 files use
  the two classes.
- Two debugger stylesheets restyle the drop-down by its classes (`OnScreenTools.module.scss`,
  `MaterialEditor.module.scss`, both on `.aekDropDown…`). No other file outside the kit imports or
  names a kit stylesheet.
- The kit's tests stub linkedom per file (`parseHTML`, `vi.stubGlobal('document' | 'window')`, a
  `scrollIntoView` shim) and drive keys with synthetic events (`DropDown.test.ts`).
  `playwright-core` 1.63.0 is a dev dependency (`devTools/verify/browser.ts`); `axe-core` isn't.
- The readme sets no browser floor: WebGPU in recent Chrome, Edge and Safari, WebGL 2 otherwise.

### 1.2 What p801 and p802 left here

From `src/_engine/ui/CLAUDE.md` ("Left for p803", "Bounds in an embed") and p801's §4:

1. With a drop-down's list open in a `closeOnEscape` dialog, one Escape closes both.
2. The kit sizes no icon (`.uiIcon`'s SVG fills its box).
3. The global styles (the tokens, the ring, `.uiIcon`) come with the boot (`styles/index.scss`,
   `Boot.ts`), not with `aekasha/ui`, and nothing public makes a HUD root without the boot: the
   component library imports `createHudContainer` and `index.scss` by path.
4. The window header clips its title's descenders.
5. A long toast runs past its `toastMaxHeight` (100 px) under its close button.
6. In an embed: the drop-down list's `40vh` maximum height; a `closeOnEscape` dialog taking Escape
   from the whole host page; the toast's text colour and the buttons' font coming from the host;
   a window clipping a drop-down list that overflows it.
7. The kit's colours are still `variables.scss`' and its sizes `--aek-rem`: both themes and both
   densities look the same on it. p801 §4.2-§4.3 map every colour declaration to a role, which
   is the restyle table for the kit's files (`DraggableWindow`, `DropDown`, `Toaster.ts`).
8. p801 §4.5: the drop-down list holds focus (`aria-activedescendant`), so the ring goes round the
   list: "p803 decides whether the highlighted option shows it instead".
9. p801 §4.6: CMP's `anim` phases are an app's own durations, so p803 decides whether they follow
   reduced motion.
10. p801 D2: nothing reads the z tokens yet. p803 decides whether a modal dialog leaves the window
    stacks. No `color-scheme` on the kit root until the kit follows the theme.
11. p801 Phase 6: a showcase `::: embed uiKit` on the UI kit page fits this plan's restyle.

---

## 2. Decisions (proposed 2026-10-25, for review)

### D1. Scope

- **In:** the layout and coding style (D2), the renames (D3), the kit without the boot (D4), the
  styles on the tokens and layers (D5), the overlay layer (D7), the existing pieces restyled and
  accessible (D8, D9), the core components (D10), the tests and `yarn verify:ui` (D11), the Hub
  (D13).
- **Moved to later children:** the percentage pie (p805's donut), the debugger list (p805's list),
  the tab host's buttons (p805's tabs) and the context menu (p805; it opens D10's menu at the
  pointer). p800 §4.1 listed the first three for p803 and §4.4 already lists the context menu under
  p805. They're data display, and p805 builds them next to the table and the tree.
- **The debugger:** p803 builds the kit's spinner, `kbd` and loading overlay from the debugger's
  pieces. The debugger moves onto them in p806, except the scene loader (Phase 7): its loader is
  the loading overlay's first user, and the change is small. The debugger's windows, drop-downs
  and toasts change with the kit (D6).
- **The drop-down stays a drop-down.** p804 makes it the select field on D9's binding model (p800
  §4.3). p803 restyles it, moves its list onto the overlay layer and adds the searchable variant
  (p800 §4.1).

### D2. Layout and coding style

The folders p800 §5 sketched, with the files they take now:

| Folder                    | Files                                                                                                                                                                                                 |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ui/core/`                | `CMP.ts`, `CMPTypes.ts`, `CMPAnim.ts`, `HUD.ts`, `Window.ts` (the bounds), `Motion.ts`, `icons/` (moved as is)                                                                                        |
| `ui/components/`          | D10's components, one module each with its stylesheet and test: `Button.ts`, `Button.scss`, `Button.test.ts`, …                                                                                       |
| `ui/overlays/`            | `windows/` (the six `DraggableWindow*` files, `DialogWindow.ts` and their stylesheet), `Toaster.ts`, D7's `OverlayStack.ts`, `Anchor.ts`, `FocusTrap.ts`, D10's `Tooltip.ts`, `Popover.ts`, `Menu.ts` |
| `ui/forms/`               | `DropDown.ts` and `DropDown.scss` (p804 adds the fields)                                                                                                                                              |
| `ui/styles/`, `ui/fonts/` | as they are, plus D4's `kit.scss`                                                                                                                                                                     |
| `ui/data/`, `ui/game/`    | not created here: p805 and p808 create them                                                                                                                                                           |

- `ui/testing/` holds D11's shared linkedom helper (`KitDom.ts`, Phase 0), which only tests
  import.
- The engine root's `ui/index.ts` and `CLAUDE.md` stay the only files directly in `ui/`.
  `layoutRules.ts` gets a rule per folder in place of the one `ui/` rule, so a module dropped
  directly into `ui/` fails `layout.test.ts`. The `ui/` boundary of `layout.ts` doesn't change.
- A piece gets its own folder when it has more than one module (the windows). A module, its
  stylesheet and its test sit flat in their group's folder.
- The move is one commit with no other change: `git mv`, then a one-off script in the scratchpad
  (not committed: p619 removed `devTools/refactor/`) that rewrites the relative imports of every
  moved file and of its importers, then Prettier. The Hub's stand-in map (`HUB_KIT_STAND_INS`) and
  every path in a `CLAUDE.md`, the Hub and the plans that names a moved file follow in the same
  commit (`grep -rn "ui/<Name>"`).
- **Coding style for a component** (p800 D1, made concrete):
  - `createX(props: XProps): X`, with `X` the handle type: `{ cmp, …setters, …getters }`. Disposal
    is `cmp.remove()`, and its `onRemoveCmp` clears the component's listeners, timers, observers
    and its overlay stack entry.
  - The props every component takes: `class`, `attr`, `id`. Events are `on*` props. A handle's
    setter writes its element in place, with no rebuild and no allocation (a HUD value updated
    every frame).
  - JSDoc on each export with an `@example` (the coding standards). Each component's summary lists
    its parts, its custom properties and its keyboard map (p800 D3, D8).
  - Nothing at module load (`moduleSideEffects.test.ts`). Each module imports its stylesheet and
    `styles/kit.scss` (D4).

### D3. Type names (changes p800 D12's list)

- The kit's `T`-prefixed types get new names next to the old ones, which stay as deprecated
  aliases (`@deprecated Use {@link CMPHandle}. Removed in engine 6.0.0.`) until p622:

  | Old                | New                  |
  | ------------------ | -------------------- |
  | `TCMP`             | `CMPHandle`          |
  | `TProps`           | `CMPProps`           |
  | `TSettings`        | `CMPSettings`        |
  | `TListener`        | `CMPListener`        |
  | `TListenerCache`   | `CMPListenerCache`   |
  | `TListenerCreator` | `CMPListenerCreator` |
  | `TStyle`           | `CMPStyle`           |
  | `TAttr`            | `CMPAttr`            |
  | `TClassAction`     | `CMPClassAction`     |
  | `TAnimChain`       | `CMPAnimChain`       |
  | `TAnimState`       | `CMPAnimState`       |
  | `TDropDown`        | `DropDown`           |

- **Why not p800 D12's `Cmp` / `CmpProps`:** the engine writes an acronym in capitals (`ECSWorld`,
  `GPUMemory`, `getHUDRootCMP`). `Cmp` next to the function `CMP` would be two names in one entry
  that differ only in case, which the coding standards forbid. `CMPHandle` is the word the kit's
  docs already use ("returns its handle").
- The engine, the app and the Hub switch to the new names in Phase 1 (a `sed` over the imports).
  Only the aliases keep the old ones. p622's UI kit item and p800 D12 are updated to this table.

### D4. The kit without the boot (closes 1.2's item 3)

- **`createHudRoot(props?: { slot?: HTMLElement })`** on `aekasha/ui`: today's `@internal`
  `createHudContainer`, made public and renamed. It makes the one HUD root: in place of `slot`, or
  of the page's `#hudRoot` / `#guiContainer`. The boot calls it. A page without the engine calls
  it itself: the Hub, or a menu page shown before the engine starts. A second call throws, as
  today, with a message saying the boot made one. Also public: `hasHudRoot()` and
  **`KIT_ROOT_CLASS`** (`'aekUi'`), the class an app puts on its own container outside the HUD.
- **The kit brings its global styles.** `styles/kit.scss` holds `tokens.css` and D5's `aek.base`
  rules: the ring, the controls' `font: inherit`, `.aekIcon`. `HUD.ts` and every component module
  import it. Vite emits it once per chunk graph, and a page that uses no kit module doesn't get
  it. `styles/index.scss` (the boot's) keeps only the editor views' rule and imports `kit.scss`
  the same way, so the full page has one copy.
- **The windows' resize source leaves the main loop.** `Window.ts` gets an `@internal`
  `onBoundsResize(fn)`. On first use it adds a `resize` listener on the window, or a
  `ResizeObserver` on the bounds element (`setWindowBoundsElement`), and it returns the remover.
  `DraggableWindow.ts` drops `addResizer`, and `MainLoop.ts` leaves `UI_KERNEL_HOOKS`. The
  canvas size source keeps its own observer. The windows no longer clamp through the main loop's
  resizers, so p801 Phase 3's shrink check in `verify:embed` must still pass.
- The Hub drops its `MainLoop.ts` stand-in and the component library's two deep imports. The
  storage stand-in stays: the dev Hub shares the app's origin, which is the Hub's concern, not
  the kit's.
- **`getMotionFactor(elem)`** goes public. CMP's `anim` phases don't scale on their own (an app's
  animation can carry meaning: closes 1.2's item 9). The kit's own JS timings use the factor, and
  the guide shows an app how to.
- `SceneHooks.ts`, `BootHooks.ts` and `Config.ts` stay (harmless without the boot, p617 D7).

### D5. Styles: global classes, layers, parts

- **Every kit style moves into `@layer aek.components`** (p800 D3; p801 D5 left them unlayered
  until their restyle). Selectors are `:where()`, so even a layered app rule wins. The base rules
  go in `aek.base`. Since an app's unlayered CSS now beats the kit, each restyle's changelog entry
  warns about broad app rules (`button { … }`).
- **Global prefixed classes** replace the windows' CSS module: `aekWindow`, `aekWindow__header`,
  `aekWindow__title`, … (p800 D3). States become attributes: `[data-state="collapsed"]`,
  `[aria-expanded]`, `[aria-pressed]`, `[aria-busy]`. CSS modules stay only in the debugger. The
  drop-down keeps its `aekDropDown…` names, which two debugger stylesheets use.
- **The toaster's injected `<style>` goes.** `Toaster.scss` is imported by its module, and each
  toaster's settings become custom properties on its element (`--aek-toast-max-width`, …). Nothing
  is written to the host's `<head>` any more.
- **Every colour from a role** (p801 §4.2-§4.3, the kit's rows), every size from the type and space
  scales, and no `--aek-rem` in the kit's files when this plan is done (p801 D4: it stays for the
  debugger until p806). Component-level custom properties (`--aek-button-radius`,
  `--aek-window-header-height`, …) read the tokens and are documented per component (D13).
- **`color-scheme`** in each theme block of `tokens.css` (`dark` / `light`; p801 left it here), so
  native scrollbars and inputs follow the kit's theme.
- `aek.base` resets the controls inside the kit root:
  `:where(.aekUi) :where(button, input, select, textarea) { font: inherit; color: inherit; }`, and
  the kit root gets `color: var(--aek-text)` (it sets none, so `inherit` would give the host's).
  That fixes the buttons' font and the toast's colour coming from the host (1.2's item 6). The
  debugger sits under the HUD root and gets both: Phase 0 found no visible change on it (As
  built).
- Icons: `getSvgIcon` writes `aekIcon` (plus `uiIcon`, kept for the debugger until p806).
  `aekIcon` is `1em` square by default, so an icon follows its text, and
  `size: 'sm' | 'md' | 'lg'` maps to `--aek-icon-size-*` tokens (new, in the type scale's group).
  `'small'` keeps working as `'sm'`, deprecated until 6.0.0. This closes 1.2's item 2.
- New tokens go into `tokens.css` with their group in the Hub's design document
  (`devTools/hub/generated/design.ts`) and, where a pair applies, in `Tokens.test.ts`.

### D6. The debugger until p806

- Its roots force the dark theme: the drawer, the debug windows (`isDebugWindow`: the window code
  sets `data-aek-theme="dark"` on them), the on-screen tools, the profiler window and the editor
  drawer. On a light system, the kit's restyle would otherwise give a debug window a light frame
  around the debugger's dark content. p806 gives the debugger its theme setting and drops the
  attribute.
- They stay at the default density: p806 opts the debugger into `compact` with its own restyle.
- The kit-styled parts (window frames, drop-downs, toasts) take the tokens' dark navy while the
  debugger's own panels stay grey (`#1f1f1f`) until p806. The changelog says so, and the scene
  runner's baselines are updated on purpose (Phase 5).

### D7. The overlay layer

- **One overlay stack** (`OverlayStack.ts`, `@internal`): every open drop-down list, popover,
  tooltip, menu and dialog pushes an entry `{ elem, close, returnFocus, modal }`. One capture
  `keydown` listener on the HUD root's element closes the top entry on Escape and stops the
  event, plus its `keyup` (today's swallow). It's added on the first push and kept. Because the
  input system listens on the window in the bubble phase (1.1), this beats every key binding for
  a key pressed inside the HUD, and nothing outside it: in an embed the host page keeps its
  Escape. Closes 1.2's items 1 and 6 (Escape).
  - Closing an entry returns focus to what had it when the entry opened, if that's still in the
    document.
  - Today's `closeOnEscape` window listeners go. A dialog without `closeOnEscape` still takes the
    entry (modal, so Escape stops there and does nothing).
- **Non-modal overlays go in the top layer** (the Popover API, `popover="manual"`): the drop-down
  list, the tooltip, the popover and the menu. A window's `overflow` no longer clips them (1.2's
  item 6). Inheritance follows the DOM, so the tokens still reach them. Where `showPopover` is
  missing (older WebGL 2 browsers), they stay in the HUD root at `--aek-z-tooltip`, and the
  anchor helper subtracts the bounds' position as the windows do. In the top layer it doesn't:
  there the mount's `contain: layout` doesn't apply, and the viewport rect is the position
  (Phase 0).
- **Modal dialogs don't use `<dialog>.showModal()`** (p800 D8 and §8's open question). It makes
  the whole document inert (a host page in an embed) and puts the dialog and its backdrop in the
  top layer, which ignores the mount's `contain: layout`, so the backdrop would cover the host
  page (p801 D9's check). Instead, a dialog keeps the window code and gets:
  - `role="dialog"` (or `"alertdialog"` with `alert: true`), `aria-modal="true"`, and
    `aria-labelledby` its title;
  - a focus trap (`FocusTrap.ts`: Tab and Shift+Tab wrap inside it), focus to its first focusable
    element or its `initialFocus`, and focus back to the opener on close;
  - `inert` on the HUD root's other children while it's open (never on anything outside the
    HUD root), restored on close. A second modal makes the first inert too. **The debugger's
    roots are spared by an app's modal** (decided 2026-10-25, Phase 4): the drawer, the editor
    drawer, the on-screen tools and the debug windows carry a marker the stack skips, so a pause
    menu can still be debugged; a debug modal (the key shortcuts dialog) inerts the rest of the
    HUD, the app's and the debugger's other roots alike.
- **z-order** (p801 D2's open item): modal dialogs leave the window stacks and stack from
  `--aek-z-dialog` in open order, above the debug windows. Toasts sit at `--aek-z-toast`. The
  windows' JS bases stay (`Z_INDEX_BASES`), and a test checks they equal the tokens' values.
- **Anchored positioning** (`Anchor.ts`, our own, about 1 KiB; floating-ui would be about 3 KiB
  gzip for more than we need): place an element at a side of an anchor rect, flip to the other
  side when it doesn't fit, shift along the side to stay inside the bounds (`getWindowSize`: the
  container in an embed), and give it `max-height` / `max-width` from the space left. That
  replaces the drop-down list's `40vh` (1.2's item 6). It repositions on scroll (a capture
  listener on the document: a host page's scroll moves the anchor, not a top-layer overlay) and
  resize while open, read in one `requestAnimationFrame`.
- The drop-down list's highlighted option shows the ring (`[data-active]` styled as
  `:focus-visible`), not the list: the list keeps DOM focus for `aria-activedescendant` (p801 §4.5,
  1.2's item 8).

### D8. The windows and dialogs, accessible

- A window is `role="dialog"` (non-modal: no `aria-modal`, no trap), `aria-labelledby` its title,
  or `aria-label` from a new `ariaLabel` prop when it has no title. The collapse button has
  `aria-expanded` and `aria-controls`, and the close and collapse buttons have labels and D10's
  tooltips.
- **Keyboard move and resize** (p800 D8: every pointer action has a keyboard path): the header is
  focusable (`tabindex="0"`, `aria-roledescription="movable window"`, its instructions in
  `aria-describedby`). Arrows move the window by `--aek-space-5` (16 px), Alt+arrows resize it,
  and Shift multiplies either by 4. It clamps as a drag does and saves to LS on keyup. Enter on
  the header toggles collapse, as a double-click on the title fits it today.
- **Keys to cycle windows** (p800 D8): **F6** focuses the next open window's first focusable
  element and brings that window to the front, in z-order, app windows and then debug windows;
  **Shift+F6** goes the other way. That's the platform's "next pane" pair, and Phase 0 found them
  the only candidates every browser delivers (Ctrl+F6 and Alt+F6 never reach a page in Firefox,
  and Alt+\` names no single physical key: As built). The keys are a kit setting
  (`setWindowCycleKeys`), `null` turns them off, the listener is on the HUD root like D7's, and
  it calls `preventDefault()` (which keeps Firefox's and Chrome's own F6 from the address bar).
  - **The debug key `sc-toggle-main-loop` moves off F6** (debug env and prodTest), so F6 means
    one thing wherever focus is. Proposed: Shift+F7, next to F7's app loop pause (confirmed in
    Phase 5). It stays rebindable through `AppConfig.debugKeys`; the debug key docs
    (`src/_engine/debug/CLAUDE.md`, the debug suite's Hub page, the shortcuts dialog's data) and
    the changelog follow.
- Title clipping (1.2's item 4): the header's `line-height` from `--aek-line-height-base`, and the
  title truncates with an ellipsis and a tooltip when it overflows.
- `DraggableWindow.ts` is over 800 lines already. The keyboard paths go into
  `windows/DraggableWindowKeys.ts`, and Phase 6 checks the module sizes again.

### D9. The toaster and the drop-down, accessible

- **Toasts:** each toaster has two live regions, `role="status"` (`aria-live="polite"`) for
  `info` / `success` and `role="alert"` for `alert`. Its toasts are announced through them (a
  visually hidden copy of the title and text), so screen readers don't read the whole toaster
  again on each change. A toast's timer pauses while it is hovered or holds focus, and while the
  page is hidden. Its close button is reachable with Tab, and Escape inside a toast closes it
  (D7). Each type shows its icon and its status colour (p800 D6: never colour alone). A long toast
  scrolls inside its text area with the close button in its own column (1.2's item 5). Under
  reduced motion it fades in place instead of sliding (p800 D7).
- **The drop-down:** restyled (tokens, the overlay layer, the anchor). A `searchable: true`
  variant is the APG select-only combobox with a filter: a text input over the list filters the
  options and highlights each match, the arrows move through the filtered list, and Enter picks.
  Its typeahead and keys otherwise stay as today. The p804 select field wraps it.

### D10. The core components (p800 §4.2)

Each is a `createX(props)` returning its handle (D2), with its keyboard map and ARIA in its JSDoc.
Here are the decisions that aren't obvious from p800 §4.2:

- **Button** (`components/Button.ts`): a native `<button>` (`type="button"` by default). The props:
  `variant: 'primary' | 'secondary' | 'ghost' | 'danger'` (default `secondary`; p800 D6: primary is
  the one accent use in a group), `size: 'sm' | 'md' | 'lg'`, `icon` and `iconPosition`, `label`
  (required when it shows only an icon: then it's the `aria-label` and the tooltip), `kbd` (a
  shortcut hint drawn with `createKbd`; display only, binding the key is the app's), `onClick`.
  The handle has `setLoading(on)` (the width is kept, the text fades into a spinner, `aria-busy`
  is set and clicks are ignored), `setDisabled`, `setLabel`.
  - **Toggle:** `pressed` with `onPressedChange`, and `aria-pressed`.
  - **Hold to confirm:** `holdToConfirmMs` (e.g. 800 ms, for a destructive action). A ring fills
    while the pointer, Space or Enter is held, and releasing early cancels. Screen readers hear
    "hold to confirm" through `aria-describedby`. Reduced motion still shows the progress (it's
    information): it steps instead of filling smoothly.
  - **Button group** (`createButtonGroup`): `role="group"` with a label, the buttons joined
    visually. An `exclusive: true` group of toggles is a toolbar with roving `tabindex`.
  - **Split button** (`createSplitButton`): an action button and a menu button (D10's menu) in a
    group.
  - **Icon button:** a `Button` with only an icon. There's no separate component, but the Hub
    documents it on its own.
- **Link** (`createLink`): an `<a>`. With `external: true` (or an absolute URL to another origin)
  it gets the external icon, `rel="noopener noreferrer"`, `target="_blank"` and a visually hidden
  "(opens in a new tab)". `appearance: 'button'` styles a link as a button. A button styled as a
  link is `createButton({ variant: 'link' })`: a fifth variant, so each look keeps the right
  element.
- **Badge** (a count or a status word: `tone: 'neutral' | 'accent' | 'info' | 'success' |
'warning' | 'danger'`, with the status `-soft` backgrounds) and **tag / chip** (`createTag`:
  `removable` with a labelled remove button, Backspace and Delete removing a focused tag,
  `selectable` as a toggle button).
- **Kbd** (`createKbd`): a `<kbd>` per key of a chord (`'Ctrl+Shift+P'` → three keys, `+` between
  them), with the platform's names (`⌘` on macOS) shown and the full name in the label. **Input
  glyph** (`createInputGlyph`): one key, mouse button or gamepad button as a glyph. Here it's
  static and keyboard plus mouse only. p808 makes it device-aware and adds the gamepad families.
- **Tooltip** (`createTooltip({ anchor, text })` or the `tooltip` prop on Button / Link): shown on
  hover after `--aek-tooltip-delay` (500 ms) and on focus at once, hidden on Escape, blur or
  pointer leave. The anchor's `aria-describedby` points at it, and it's `role="tooltip"`, never
  interactive (an interactive one is a popover).
- **Popover** (`createPopover({ anchor, content })`): anchored (D7), opened by its trigger (which
  gets `aria-expanded` and `aria-controls`). Focus moves in, Escape or an outside click closes it,
  and focus returns.
- **Menu** (`createMenu({ anchor, items })`, the APG menu button pattern): `menuitem`,
  `menuitemcheckbox`, `menuitemradio`, separators and groups. The keys are the arrows, Home / End
  and typeahead, Enter / Space activate, Escape closes. Submenus wait for p805's context menu,
  if it needs them.
- **Spinner** (sizes from the icon tokens, a label for screen readers, `role="status"` when it
  stands alone). Under reduced motion it pulses its opacity slowly instead of turning (p800 D7).
  It replaces the debug scene loader's spinner.
- **Progress bar** (`role="progressbar"`, `aria-valuenow` / `-min` / `-max`, a visible label):
  determinate, indeterminate (`aria-valuenow` absent; reduced motion: a still striped bar) and
  `segments: n`.
- **Skeleton** (lines, a block, a circle; `aria-hidden`, the loading container has
  `aria-busy`; its shimmer stops under reduced motion).
- **Divider** (`<hr>` or `role="separator"`, horizontal or vertical).
- **Empty state** (an icon, a title, a text and an optional action button).
- **Loading overlay** (`createLoadingOverlay({ text, progress? })`): covers its container (the
  HUD's bounds by default), with a spinner or a progress bar and a text. The handle has
  `showAsync()` and `hideAsync()` (each resolving after the fade: 0 ms under reduced motion),
  `setText` and `setProgress`. The guide and `@example` wire it into `createSceneLoader`'s
  `loaderContainerFn`, `loadStartFn`, `loadEndFn` and `updateLoaderStatusFn` (the kit can't import
  the scene loader: `ui → kernel` only through the hooks). The debug scene loader moves onto it
  (D1).

### D11. Tests and `yarn verify:ui`

- **Unit tests** (Node, linkedom, next to each module) check a component's keyboard map (each key
  of its JSDoc), its ARIA states after each action, its disposal (no listener or timer left after
  `cmp.remove()`: a test helper counts them), and that nothing happens at load. The kit's linkedom
  setup becomes one shared helper, `ui/testing/KitDom.ts` (`@internal`, called in `beforeAll`),
  with Phase 0's focus shim (As built: the structural tests pass with it). The kit writes `inert`,
  ARIA and `popover` as attributes, which linkedom doesn't reflect from properties.
- **`yarn verify:ui [--url <url>] [--only <piece>] [--update] [--headed]`**: a new command, not a
  mode of `verify:embed`, whose job is the embed (p800 §8's open question).
  `devTools/verify/ui.ts` serves the built Hub (`hubPreview`'s server) or `--url`. It opens the
  public component library page (D13) in Chromium and, for each demo box in both themes and both
  densities:
  - runs axe-core (a new dev dependency, MPL-2.0, injected with `page.addScriptTag`) on the box
    with its overlays open, so any violation fails;
  - runs the piece's keyboard script (a table next to the demo: Tab into it, the keys, the
    expected focus and ARIA state), which also checks that a focused element shows an outline
    (computed `outline-style` not `none`);
  - compares a screenshot of the box with the last good one (kept locally under
    `.cache/verify/ui/`, as the scene runner's are: the fonts render differently per machine).
  - It writes `.cache/verify/progress.log` like the other verify commands.
- **`yarn verify:embed`'s `uiKit` scenario** grows: a tooltip and the drop-down's list inside the
  container (the anchor's bounds), Escape pressed on the host page doesn't close the dialog, and
  Escape inside it does. The host style check confirms nothing is written to the host's `<head>`
  any more (D5's toaster change).
- The perf-auditor agent reviews `Anchor.ts`'s reposition and the toaster's timers, the kit's two
  per-frame-ish paths.

### D12. One entry

`aekasha/ui` stays one entry (p800 D10's open question). `package.json`'s `sideEffects` makes a
build keep only what's used through it, a component's stylesheet included (p801 D8's finding: a
dropped module drops its stylesheet import). So sub-entries would save no bytes, and they'd
add aliases, `tsconfig.json` paths and `aliases.test.ts` rows. The dev server runs every
re-exported module when the entry is imported. That costs only module load time, since nothing
registers at load. p808 revisits this if the entry passes about 150 names.

### D13. Documentation (p800 D11)

- **The UI kit feature page becomes a section** (`hub/pages/features/ui-kit/` and children): the
  overview (CMP, the HUD root and `createHudRoot`, what's where), `styling/` (the "Styling" part of
  `guide.md` grown into p800 D11's styling guide: the three ways to restyle in order (tokens, a
  component's properties, rules on its parts), the layers and why an app's CSS wins, themes,
  densities, UI scale, the fonts, and a worked "make it look like my game" example), `core/` (the
  buttons, links, badges, tags, kbd, glyphs and the feedback pieces), `overlays/` (windows,
  dialogs, toasts, tooltip, popover, menu, the Escape and focus rules), and the drop-down on the
  overview until p804's forms page. Each component has a live demo, its props, its parts and
  custom properties, its keyboard map and its size (from `{{sbp:…}}` where SBP measures it).
- **The public component library page** (`features/ui-kit/library/`): every component in every
  state, in both themes and densities. It's rendered by today's `_components.ts`, made public:
  `hub.ts` loads it in both modes on a `[data-hub-components]` page, and it leaves
  `DEV_ONLY_SCRIPT_MODULES`. The dev page (`project/aekasha/components/`) renders the same `DEMOS`
  with its internal notes (the generated "Used by", the SBP lines, what's left for later plans)
  and links each piece's public section. `devTools/hub/scripts.test.ts`' public assertions change
  to match.
- **The example scene** (`examples/uiKit/` and its page): rebuilt on the new components (buttons,
  a split button with a menu, tooltips, a progress bar and the loading overlay as its scene
  loader). This is proposed instead of a new example scene, since p808 builds `gameHud`. The UI
  kit page gets the `::: embed uiKit` showcase p801 deferred. The `uiKit` profile's scene grows
  the pieces D11's embed checks need and gets a poster.
- `src/_engine/ui/CLAUDE.md` gets the new layout, the coding style (D2), the overlay layer (a new
  `##` section, so an `aek:covers` on the overlays page), the kit without the boot, and its "Left
  for p803" items closed or moved on. Also updated: the root `CLAUDE.md` (Three-folder split's
  `ui/` line, the `yarn verify:ui` command, `UI_KERNEL_HOOKS` without the main loop),
  `devTools/verify/CLAUDE.md` (`verify:ui`), `devTools/hub/CLAUDE.md` (the public library script,
  no `MainLoop.ts` stand-in), `hub/CLAUDE.md` (adding a component's demo and its keyboard script),
  and `readme.md` (the UI kit bullet: the components, accessibility; the commands table).
- The coding standards page gets one line: a UI component follows the kit's coding style (D2),
  linking `src/_engine/ui/CLAUDE.md`'s section.

### D14. Versions

- **Engine minor (5.12.0)**: the new components and public functions, the new type names with
  deprecated aliases (D3), and `getSvgIcon`'s `'small'` deprecated. The changelog's restyle note
  (p800 D12) says the kit's windows, dialogs, drop-downs and toasts take the tokens' colours,
  spacing and both themes. To keep the old look on an app's windows, force
  `data-aek-theme="dark"` on the HUD root (the old greys aren't tokens, so there's no exact
  restore). It also warns that the kit is now layered, so an app's broad unlayered rules beat it,
  and that the debug key toggling the main loop moved off F6 (D8), which now cycles windows.
- **App minor**: the `uiKit` example rebuilt and the profile's scene grown. Its type renames alone
  would be a patch.
- **Toolkit**: none (the toolkit uses no kit piece).
- **Project**: `yarn verify:ui`, axe-core, the Hub's public library script.
- p800 §6: own branch `p803-ui-kit-structure-and-core` from `main`, one PR into `main`.

---

## 3. Phases

Branch `p803-ui-kit-structure-and-core` from `main`. Verification of each phase: `yarn test`,
`yarn verify:scenes` (baselines recorded on `main` before the first run, updated on purpose from
Phase 5), `yarn verify:baselines`, `yarn verify:embed`, `yarn sbp --profile all`, and from
Phase 3 on `yarn verify:ui`, plus the phase's own checks. Each phase stops after each section for
review.

### Phase 0: baselines and checks — done

1. On `main`: `yarn verify:scenes --update`, `yarn verify:embed`, `yarn sbp --profile all` (the
   numbers noted here: the app's and the `uiKit` profile's `_engine/ui` group, the scene chunk).
   Also screenshots of the component library page in both themes (the "before" for Phase 5's
   review).
2. Checks that decide details later:
   - which window-cycle keys reach a page's `keydown` in Chrome, Firefox and Safari on macOS and
     Windows (D8: F6, Alt+\`, and a fallback);
   - a probe that the Popover API's top layer keeps D7's positions in an embed (viewport
     coordinates, the container's `contain: layout`), and that `inert` on the HUD root's
     children leaves the host page alone;
   - what linkedom supports for D11: `document.activeElement` after `focus()`, `inert`, the
     `popover` attribute, `matches(':focus-visible')`. A gap becomes a shim in the shared helper or
     a check moved to `verify:ui`;
   - whether a shared non-test helper importing `vitest` passes `ModuleLoad.test.ts` and the
     layout rules (D11), and where it would live;
   - which debugger styles change with D5's control reset (`font: inherit`), on the scene runner's
     debug screenshots and the drawer by eye.
3. The answers go into D7, D8 and D11 here (As built) before Phase 1.

As built (section 1, 2026-10-25, at `69086431`: `main` with this plan, macOS, Chromium on WebGPU):

- `yarn sbp --profile all`: every budget within. The app's first download 381.5 KiB gzip; its
  `_engine/ui` group 4.0 KiB initial (budget 5 KiB, 3 modules) and 10.4 KiB lazy (11 modules);
  the example's `exampleUiKit.js` 2.1 KiB and `exampleUiKit.css` 0.5 KiB. The `uiKit` profile's
  first download 285.8 KiB; its `_engine/ui` group 4.1 KiB initial (budget 6 KiB, 4 modules) and
  10.2 KiB lazy; the scene chunk `uiKitEmbed.js` 10.9 KiB (budget 12 KiB) and `uiKitEmbed.css`
  2.3 KiB (budget 3 KiB).
- `yarn verify:embed`: the banner's three scenarios and the `uiKit` profile's four pass.
- `yarn verify:scenes --update`: 104 runs recorded (26 scenes, 4 configurations), no failure, in
  `.cache/verify/scenes/webgpu/`.
- The component library's "before": 44 screenshots in `.cache/p803/before/` (local, gitignored),
  per theme the whole page and each demo button's state on its own page load (1440 × 900, the
  Hub's theme and the HUD root's `data-aek-theme` both set). A one-off script in the scratchpad,
  not committed.

As built (section 2, 2026-10-25; one-off probes in the scratchpad, not committed):

- **The top layer in an embed** (D7), a host page with a `contain: layout` container holding a
  HUD root, a fixed window (`overflow: hidden`) and a `popover="manual"` list, in Chromium 155 and
  Firefox 155 (Playwright's WebKit didn't download, twice: Safari is in the manual probe below):
  - a fixed element in the container is relative to it, but the open popover sits at the
    viewport coordinates it's given: the top layer ignores the mount's `contain: layout`. So the
    anchor uses viewport rects as they are on the top layer path, and subtracts the bounds'
    position only on the fallback path (in the HUD root);
  - neither the window's `overflow` nor the container's clips it, and it inherits the HUD root's
    custom properties (the tokens reach it);
  - the browser doesn't close a manual popover on Escape. A capture `keydown` listener on the HUD
    root gets a key pressed inside the popover (the event path follows the DOM), and its
    `stopPropagation()` keeps the key from a bubble listener on the window;
  - a host page scroll moves the container but not the popover, so the anchor repositions on
    `scroll` in the capture phase on the document (any ancestor of the anchor may scroll), not
    only on the window's;
  - `inert` on a HUD root's child refuses focus and clicks there, and the host page's button keeps
    both. A top-layer popover whose DOM parent is inert is inert too (a window's list under a
    modal dialog), and a list inside the dialog isn't.
- **linkedom 0.18.13** (D11): `document.activeElement` is always `undefined`; `focus()` fires
  `focus` but not `focusin`; `.inert = true` neither reflects to the attribute nor blocks focus;
  no `showPopover` (`:popover-open` throws); `:focus`, `:focus-visible` and `:focus-within`
  throw; no `KeyboardEvent` constructor, `ResizeObserver`, `requestAnimationFrame` or
  `getComputedStyle`; no ARIA property reflection (`ariaExpanded`); a `<button>`'s `tabIndex` is
  -1. So:
  - the shared helper (below) shims focus in about 20 lines: `activeElement` from `focus()` /
    `blur()` (the body when none or removed), the four focus events, and an `[inert]` ancestor
    blocking `focus()`;
  - the kit writes `inert`, ARIA and `popover` as attributes (`toggleAttribute`, `setAttribute`),
    never through reflected properties, finds focusables by selector (not `tabIndex`), and
    feature-detects the Popover API, so linkedom runs the fallback path (Risks);
  - key events stay `Event` with `key` assigned (today's `DropDown.test.ts`); `:focus-visible`
    and the outline are `verify:ui`'s; the anchor's maths are pure functions, its rAF
    repositioning `verify:ui`'s.
- **A shared test helper** (D11): tried as `src/_engine/ui/testing/KitDom.ts`
  (`stubKitDomAsync()`: linkedom, the `scrollIntoView` shim, `vi.stubGlobal`; `@internal`), called
  as `beforeAll(stubKitDomAsync)` from `DropDown.test.ts`. `ModuleLoad.test.ts` (it imports the
  helper, and `vitest` loads fine under a test run), the layout, side effects, engine imports and
  `@example` tests, ESLint, `tsc` and `verify:baselines --docs` pass. It's in TypeDoc's model
  (only `_dbg__*`, `*.test.ts` and `index.ts` are left out): a new folder in `docs.json` and its
  export in `api.json`, which lists `@internal` exports too, so its change records them
  (`--update`). It runs in `beforeAll`, not `vi.hoisted` (an import isn't there yet), as today's
  tests do. Reverted after the trial; Phase 1's per-folder layout rules give `ui/testing/` one.
- **The control reset and the debugger** (D5), 1,300 controls under the kit roots in the 15
  drawer tabs, the profiler window and the About dialog, read with and without the layered
  reset (canvas hidden for the screenshots): no font changes (every one sets its own: IBM Plex
  for the debugger's, Roboto Mono for Tweakpane's). The colour changes on 12 kinds (the
  on-screen tools, the windows' close and collapse buttons, the clear-LS buttons, Tweakpane's
  checkboxes and swatches, the list toggles), and none shows: 0 pixels differ in the 17 pairs.
  Adding `color: var(--aek-text)` on the kit root too changes no pixel either.
  - The scene runner's snapshots are the canvas alone (`takeSnapshotAsync`), so no kit style can
    change them: the drawer screenshots are the check.
  - **The kit root sets no `color`**, so `color: inherit` gives a control the host's colour (the
    on-screen tools read the body's black). The reset alone doesn't fix the toast's colour from
    the host (1.2's item 6): D5 adds `color: var(--aek-text)` on the kit root.
- **The window-cycle key** (D8) and Safari's top layer: a manual probe page
  (`keyProbe/server.mjs` in the scratchpad: each candidate's keydown, whether focus left the page
  after `preventDefault()`, and the top layer probe above), run on macOS with a Finnish ISO
  keyboard in Chrome 139, Safari 26.5 and Firefox 133 (and the top layer in VS Code's Electron,
  Chrome 150). The top layer probe passes in all of them, Safari included: the same results as
  the Playwright runs.
  - F6 and Shift+F6 reach the page in all three as `key: 'F6'`, and with `preventDefault()`
    focus stays in the page (Firefox's address bar included).
  - **Ctrl+F6 and Alt+F6 never reach a page in Firefox** (no keydown); Chrome and Safari deliver
    them.
  - **Alt+\` is out:** on a Mac ISO keyboard the key left of 1 reports `code: 'IntlBackslash'`
    in Chrome and Safari, and the `<` key `Backquote` there but `IntlBackslash` in Firefox (the
    swap differs per browser), and Option changes `key` (`'¶'`, `'≤'`), so neither `code` nor
    `key` names one physical key. Alt+letter keys type a character on macOS (Alt+W is `'Ω'`),
    which a text field in a window would get.
  - **F6 alone is taken in the debug env:** the engine's debug key `sc-toggle-main-loop`
    (`DefaultDebugKeyBindings.ts`; prodTest too). With focus inside the HUD, D7's capture
    listener would take F6 from it, and outside the HUD F6 would pause the loop: one key with
    two meanings by focus. The debug keys don't match a modified F key. Decided (2026-10-25):
    F6 / Shift+F6 cycle the windows and the debug key moves (D8).
  - Not run: Edge (Chromium) and Windows.

### Phase 1: the move and the names (no behaviour change) — done

1. Section 1, the move (D2): the folders, `git mv`, the scratchpad import rewrite, the per-folder
   layout rules, the Hub's stand-in paths, every doc path. `yarn test`, `tsc`, `yarn hub:build`
   and the scene runner pass unchanged, and `verify:baselines`' bundle baseline moves only by
   module paths.
2. Section 2, the names (D3): the new types, the deprecated aliases, the engine's, app's and Hub's
   imports switched; the API baseline updated; p622's and p800 D12's lists updated.

As built (section 1, 2026-10-25):

- 78 files moved (`git mv`): `core/` (`CMP`, `CMPTypes`, `CMPAnim`, `HUD`, `Window`, `Motion`,
  their tests, `icons/` whole), `overlays/windows/` (the six `DraggableWindow*` files, their two
  tests, `DialogWindow.ts` and its test), `overlays/` (`Toaster.ts` and its test), `forms/`
  (`DropDown.ts`, `.scss`, `.test.ts`). `components/` and `testing/` have a rule but no file yet
  (the first component in Phase 6; `KitDom.ts` with the first test that needs it).
- The scratchpad script (`moveKit.mjs`, not committed) rewrote every quoted relative path in the
  repo's `.ts`, `.scss` and `.css` files that resolves to a moved file, or sits in one (imports,
  `import()`, `vi.mock` paths, `@use`, `?raw` / `?url` suffixes kept): 67 files, then Prettier.
- `layoutRules.ts`: `UI_KIT_FOLDERS` (`core`, `components`, `overlays`, `forms`, `styles`,
  `fonts`, `testing`) as a rule each, plus file rules for `ui/index.ts` and `ui/CLAUDE.md` (every
  file under `src/` counts, the Markdown too). `layout.test.ts` checks a module directly in `ui/`
  has no rule, and its `ui → kernel` fixture moved into `ui/core/`.
- Paths by name, not import: `DraggableWindowTypes.ts`' `{@link _engine/ui/…/DraggableWindow!…}`
  (a TypeDoc module path), the Hub's design section (`ICONS_DIR`) and its test, `scripts.test.ts`,
  `sbp.config.ts`' icon module budgets and `devTools/sbp/config.ts`' example path (its test uses
  `_engine/ui/core/icons/` as an existing folder), code comments, the `CLAUDE.md` files (the kit's
  gets a layout paragraph and each piece its folder; the root's `ui/` line its groups), p622,
  p800 and `docs/issues/ui-kit-in-an-embed.md`. The `_DONE_` plans and `CHANGELOG.md` keep the
  old paths (records). The Hub's stand-ins needed nothing: neither replaced module moved.
- `yarn test`, `tsc` (both), ESLint and `yarn hub:build` pass. `verify:baselines`: 145 API
  changes, every one a moved export; `docs.json` five new folders at 100 % and two gone; the bundle
  baselines only shift gzip sizes by 1-6 bytes (no raw size or file key changes); no debug code in
  production. Recorded with `--update`. `yarn verify:scenes`: 104 passed against Phase 0's
  baselines.

As built (section 2, 2026-10-25):

- The declarations carry the new names (`core/CMPTypes.ts`, `forms/DropDown.ts`), and the old
  ones are aliases after them (`export type TCMP = CMPHandle;`, a summary line and
  `@deprecated Use {@link CMPHandle}. Removed in engine 6.0.0.`), both on `aekasha/ui`.
- A word-boundary rename over every file under `src/`, `hub/_assets/ts/` and `hub/pages/` that
  named one (39 files: the engine, the app's two examples, the Hub's component library script and
  the UI kit guide's `api:` links), then Prettier and ESLint's JSDoc fix (no blank line before
  `@deprecated`). Only the aliases, the entry and the kit's `CLAUDE.md` name the old ones.
- p622's UI kit item lists the aliases to remove, p800 D12 points at D3's table, and p355 names
  `DropDown`. `CHANGELOG.md` and the `_DONE_` plans keep the old names.
- `tsc` (both), ESLint, `yarn test` and `yarn hub:build` (947 names, 100 % documented, no
  warning) pass. `verify:baselines`: the 12 new names added to `aekasha/ui`, the bundle baselines
  unchanged (types only, so `verify:scenes` wasn't run again); recorded with `--update`.

### Phase 2: the kit without the boot — done

D4: `createHudRoot`, `hasHudRoot`, `KIT_ROOT_CLASS`, `kit.scss` imported by the kit,
`onBoundsResize` in place of `addResizer` (`UI_KERNEL_HOOKS` and the layout docs follow),
`getMotionFactor` public, `color-scheme` in the theme blocks, D6's forced dark theme on the
debugger's roots. The Hub's `MainLoop.ts` stand-in and the two deep imports go, and
`devTools/hub/scripts.test.ts` checks the component library's chunk has no engine kernel module.
Verify: `verify:embed`'s shrink check (the windows' clamp on the new resize source) and the
component library page by eye.

1. Section 1, the kit root and its styles: `createHudRoot`, `hasHudRoot`, `KIT_ROOT_CLASS`,
   `kit.scss` imported by the kit, `getMotionFactor` public, the component library's two deep
   imports gone.
2. Section 2, the resize source: `onBoundsResize`, `MainLoop.ts` out of `UI_KERNEL_HOOKS`, the
   Hub's `MainLoop.ts` stand-in gone, `scripts.test.ts`' kernel check, `verify:embed`.
3. Section 3, the themes: `color-scheme` in the theme blocks, D6's forced dark theme on the
   debugger's roots, the component library page by eye in both themes.

As built (section 1, 2026-10-25):

- `core/HUD.ts`: `createHudRoot(props?: HudRootProps)` (`{ slot? }`) returns the root's handle;
  a second call throws its own message naming the boot before CMP's "Root node already created".
  `hasHudRoot()`, `KIT_ROOT_CLASS` (the root's class is built from it), all on `aekasha/ui` with
  `HudRootProps`. `HUD.test.ts` (new): the root in its slot, a kit root, the second call.
- `styles/kit.scss`: `tokens.css` (`@use`d), D5's `aek.base` rules and `.uiIcon` (unlayered until
  Phase 5's `.aekIcon`). The kit root's `color: var(--aek-text)` is on
  `:where(.aekUi, .aekUi [data-aek-theme])`: a computed colour inherits as it is, so a forced
  theme under the root sets its own. `HUD.ts`, `DraggableWindow.ts`, `Toaster.ts`, `DropDown.ts`
  and `SvgIcon.ts` import it; `DialogWindow.ts` gets it through `DraggableWindow.ts`.
  `index.scss` keeps only the editor views' rule (no `@use` of `kit.scss`: that would be a second
  copy next to the module's).
- `getMotionFactor` on `aekasha/ui`, its JSDoc with D4's note on `anim` and an `@example`.
- The component library calls `createHudRoot` from `aekasha/ui`; both `eslint-disable`d deep
  imports are gone. Its intro and icons text, the UI kit guide (a "Without the engine" section,
  `KIT_ROOT_CLASS`, `getMotionFactor`, the controls' reset) and both `CLAUDE.md` files follow.

As built (section 2, 2026-10-25):

- `core/Window.ts`' `onBoundsResize(listener)` (`@internal`) keeps a set of listeners. The first
  one attaches the source and the last one's remover stops it. With a bounds element the source
  is a `ResizeObserver` (its first call follows `observe()`, which the windows' debounced clamp
  doesn't mind), and without one it's the window's `resize`. `setWindowBoundsElement` moves an
  attached source to the new bounds, so a window opened before a mount, or open across an
  unmount, follows the right box. `Window.test.ts` (new) covers both sources, the move and the
  detach, with stubs (linkedom has no `ResizeObserver`).
- `DraggableWindow.ts` calls it in place of `addResizer`, still once and kept, so the windows
  import no kernel module but `Config.ts`, `SceneHooks.ts` and `BootHooks.ts`.
  `UI_KERNEL_HOOKS` drops `MainLoop.ts`. `Camera.ts` and the canvas keep the main loop's
  resizers.
- The Hub: `hub/_assets/ts/_kit/MainLoop.ts` is deleted and `HUB_KIT_STAND_INS` holds only the
  storage. `scripts.test.ts` gets a test: the dev chunk's kernel modules are all in
  `UI_KERNEL_HOOKS`, and none is `MainLoop.ts`.
- The comments (`Mount.ts`, `embed.ts`' shrink check) and docs (the kit's and the Hub
  generator's `CLAUDE.md`, the component library's intro) follow.

As built (section 3, 2026-10-25):

- `tokens.css`: `color-scheme: dark` / `light` last in each of the three theme blocks (inside
  `aek.tokens`, so an app's own wins). `Tokens.test.ts` checks each block's value, and its
  contrast list counts only `--aek-*` names as roles. The Hub's design page and its
  `tokens.test.ts` read custom properties only, so neither changed. The Hub's own `_tokens.scss`
  already sets the same `color-scheme`, unlayered.
- D6's roots: `data-aek-theme="dark"` on the drawer (`_dbg__DebuggerGUI.ts`), the editor drawer
  (`_dbg__EditorDrawer.ts`), the on-screen tools' two rows and the switch tools
  (`_dbg__OnScreenTools.ts`: the switch tools mount on the HUD root directly), and a debug window
  with its backdrop (`DraggableWindow.ts`' `getThemeAttr`; `isDebugWindow` is a structural key,
  so a change remounts). The profiler is a debug window. Not forced: the debug toaster and the
  debug scene loader (the kit's, restyled in Phases 5 and 7) and stats-gl's panels (their own
  styles).
- Found by the screenshots: from section 1's kit root `color` until this section, the
  debugger's roots inherited the light theme's text colour on a light system (no pixel showed:
  the debugger sets its own colours). D6 makes them dark again.
- By eye (a scratchpad Playwright script, Chrome on WebGPU, 1440 × 900, the system theme emulated;
  shots in `.cache/p803/phase2/`, local): the app in the debug env (the drawer, the engine keys
  window, the profiler, an on-screen drop-down) and the component library (a window, a toast),
  before and after this section, in both system themes. The debugger looks the same on a light
  and a dark system. Against section 2, the only differing pixels are the live numbers and the
  profiler tab's focus ring on a light system (now the dark theme's accent). `color-scheme: dark`
  changed no visible pixel in those views, and the component library didn't change in either
  theme.
- The phase's verification at its end: `yarn test`, `tsc` (both), ESLint, `yarn hub:build`
  (91 pages, no warning), `verify:baselines` (unchanged since section 2's record), `verify:embed`
  (the shrink check on `onBoundsResize`), `yarn sbp --profile all` (every budget within) and
  `yarn verify:scenes` (104 passed against Phase 0's baselines) pass.

### Phase 3: `yarn verify:ui` — done

D11's command over the component library page as it is (still dev-only until Phase 8: it runs
against the dev Hub's URL, or a `dev`-mode `hub:build`): axe-core, the keyboard script format, the
screenshots, the progress log. The existing pieces' violations are recorded here as the list
Phases 4-6 empty (the command takes a `--allow <rule@piece>` list while that list isn't empty,
and the plan records each entry).

1. Section 1, the command and axe: `devTools/verify/ui.ts` (its own dev server, the scene
   runner's moved into a shared module, or `--url`; `--only`, `--headed`; the progress log), the
   demos' check table next to `_components.ts` (every Hub button in a box is a state, plus the
   states that need steps: a drop-down's list open), axe-core over each state in both themes and
   both densities, and the allowed violations, recorded here.
2. Section 2, the keyboard scripts: the step format, a script per piece, the outline check.
3. Section 3, the screenshots and the docs: the local baselines in `.cache/verify/ui/`,
   `--update`, the diff images; `devTools/verify/CLAUDE.md`, the root `CLAUDE.md`'s command,
   `hub/CLAUDE.md` (a demo's checks), the readme's commands table.

As built (section 1, 2026-10-25):

- `axe-core` 4.14.0 (2026-10-05, MPL-2.0), an exact dev dependency like `playwright-core`.
- The scene runner's own dev server moved into `devTools/verify/devServer.ts`
  (`startVerifyServerAsync`: it throws where it exited, and each runner exits 2 on it), which
  `scenes.ts` and the new command share (port 8092 or the next free, `node_modules/.vite-verify`).
- `yarn verify:ui [--url <hub url>] [--only <piece>[,…]] [--headed]` (`devTools/verify/ui.ts`, the
  CLI; `uiChecks.ts`, its pure parts, tested in `uiChecks.test.ts`; `ui.config.ts`, the axe tags
  and the allow list). Without `--url` it starts its own dev server and opens the dev Hub's
  `project/aekasha/components/` (Phase 8 moves it to the public page and `hubPreview`'s server).
- A box's states: the box as shown, each of its Hub buttons (a repeated text numbered: the
  toaster's two "Info"), and the check table's (`hub/_assets/ts/_componentChecks.ts`, plain data
  next to the demos, keyed like `DEMOS`: the dialog's and the drop-downs' lists open). Each state
  runs on its own page load in each setting, a browser context per setting (the Hub's saved theme,
  the emulated colour scheme, the page's theme and density radios), four at a time. It waits for
  no running animation and the HUD root's boxes still on two polls, then runs axe over the box and
  `#hudRoot` with WCAG 2.2 A / AA and `best-practice`. A console or page error fails the state.
- **The allow list is a committed list, not a `--allow` flag** (`UI_ALLOWED_VIOLATIONS`: rule,
  piece, the phase that removes it), so `yarn verify:ui` alone is each phase's check. An entry for
  a piece that ran and matched nothing is printed as one to remove.
- The first run: 30 states × 4 settings in about 50 s, 17 states failing on three rules, every
  one in all four settings. Allowed until Phase 5:
  - `landmark-no-duplicate-banner` on `window`, `dialog` and `dropDown` (its drop-downs open in a
    window): the window's `<header>` is a second banner landmark. A `role="dialog"` (D8) doesn't
    scope a `<header>` (only sectioning content and the article, complementary, main, navigation
    and region roles do), so section 1 changes the element or its role;
  - `scrollable-region-focusable` on `window` (collapsed, and long content): the scrolling content
    wrapper takes no focus (section 1);
  - `button-name` on `toaster` (alert, until closed): the close button is an icon with no label
    (section 4).
- axe finds no fault in what's missing: the windows and dialogs have no `role`, so no rule asks
  for their name, modal state or focus. Those are the keyboard scripts' (section 2) and D8's.
  No colour contrast violation either, in either theme.

As built (section 2, 2026-10-25):

- The step format is `_componentChecks.ts`' `UiKeyStep`: the states' `click` (a box button by its
  text) and `clickHud`, plus `focusHud` (a HUD root selector, focused as a script would: no key
  reaches a window yet, F6 does from Phase 5), `press` (Playwright's key names), and five
  expectations: `expectFocus`, `expectAttr` (null: absent), `expectCount`, `expectText` and
  `expectActiveOption` (the text of the option the focused element's `aria-activedescendant`
  names: the drop-down's list now, the menu's and the searchable drop-down's later). Selectors
  are the page's (`#hudRoot …` for the kit's), so a script can expect focus back on the opener
  in the box (Phase 4).
- The runner (`uiPage.ts`, the page side; `ui.ts` runs each script on its own page load in each
  setting after the piece's states): each expectation polls for up to 3 s (a close may animate)
  and the script stops at the first that doesn't come, naming the step and what the page had
  (`step 8 (expectActiveOption "Gold"): "Teal"`). After every `press`, the focused element (not
  the body) must show an outline within 500 ms. A problem in all four settings prints once.
- **The scripts say what's true today**, so each passes now; a phase that fixes a key changes
  its steps (Phase 4: Escape in the dialog's list closing the list only, focus back on the
  opener). Six:
  - window: the collapse button by Enter and Space (the class `*collapsed*` until Phase 5's
    `data-state`), Tab to the close button, Enter closes it;
  - dialog: Escape closes a `closeOnEscape` one (focus still on the Hub button: the window
    listener takes Escape from anywhere, which Phase 4 confines to the HUD root, where Phase 5
    moves the focus); a default dialog stays open on Escape and its OK button closes it;
  - drop-down: Enter opens the list (`aria-expanded`, focus on the list, the active option the
    value), ArrowDown, End, Home move, Enter picks (the list gone, the label the pick); Space
    opens it, Escape closes it without a change;
  - toaster: Enter on a closable toast's close button removes it.
  - icons: none (nothing to press).
- Checked that they can fail: two expectations broken on purpose failed with their step and the
  page's value, and a probe found the outline check reads `:focus-visible` (a script's focus
  after a click shows none, the next key turns it on, and an injected `outline: none` reads as
  `none`).
- The run: 30 states and 6 scripts × 4 settings, about 50 s, passing with section 1's allow list.

As built (section 3, 2026-10-25):

- `uiSnapshots.ts`: each state's shot in each setting against
  `.cache/verify/ui/baseline/<piece>/<state>.<setting>.png` (`getSnapshotFile`: slugs,
  `toaster/info-2.light-compact.png`; two states whose names make one slug throw), this run's in
  `last-run/` (emptied at the start) with a `*.diff.png` over the tolerance (`ui.config.ts`'
  `UI_SNAPSHOT_TOLERANCE`: mean delta 0.2, 0.1 % of the pixels, the scene runner's
  `compareSnapshots`). No baseline is a note; `--update` records the shots of the runs without
  problems. A changed size or a shot over the tolerance fails the state.
- What a shot holds (`uiPage.ts`' `captureStateAsync`), taken after the settle and before axe:
  the HUD root's overlays alone, the page around them hidden (`visibility: hidden` on the body's
  other children, removed before axe, which skips hidden elements), clipped to their boxes' union
  in the viewport (a backdrop's is the whole viewport, the Hub's background behind it), so a Hub
  text change doesn't change it; the demo box when nothing is open in the HUD root (the box, the
  icons, "Close all"), pinned at the viewport's top left with its width rounded and the rest of
  the page hidden.
- Pinned because of a run: the box shots first were the box where the page laid it out, and the
  intro's new paragraph moved the boxes by a fraction of a pixel, so their edges antialiased
  differently (1.8 % of the pixels, mean delta 0.9) and the window box failed. Pinning moved the
  box out from under the pointer, so a clicked button's hover transition was caught mid-way
  (0.1-0.2 %): after a state's steps the pointer moves to the viewport's bottom right corner,
  before the settle that waits out the transitions. Then a run with a temporary paragraph above
  the boxes, one without it and one more matched the baselines.
- Recorded on this branch (120 shots); the runs after matched every one: the shots are stable on
  one machine. They show the kit as it is, the known items included (the
  window title's clipped descender, the old greys in the light setting): Phase 5 updates them
  after its review.
- Docs: `devTools/verify/CLAUDE.md` (the command, and the shared dev server on the scene
  runner's line), the root `CLAUDE.md` (the command, the nested file's map line), `hub/CLAUDE.md`
  (`_componentChecks.ts` among the scripts; a new component's checks), the kit's `CLAUDE.md` (its
  tests line), the readme's commands table, the Hub's conventions table (`project/aekasha/`) and
  the component library's intro.
- The phase's verification: `yarn test`, `tsc` (both), ESLint, `yarn hub:build` and
  `yarn verify:ui` pass, and `verify:scenes` on one scene (the moved dev server). The phase
  changed nothing under `src/`, so the full `verify:scenes`, `verify:baselines`, `verify:embed`
  and `yarn sbp` weren't run again (Phase 2's results stand; a dev dependency isn't in a bundle).

### Phase 4: the overlay layer

D7: `OverlayStack.ts`, `FocusTrap.ts`, `Anchor.ts`, the top layer with its fallback; the dialog's
Escape moved onto the stack (its window listeners go); the drop-down list moved onto the layer
and the anchor (no `40vh`, no clipping in a window, the ring on the active option); then
`Tooltip.ts` and `Popover.ts`. Tests: Escape closing only the innermost overlay, focus returning,
`inert` set and restored, the anchor's flip and shift (pure functions, in Node). Verify: the
embed scenario's new checks (D11). `verify:ui` (Phase 3's As built): the keyboard scripts in
`_componentChecks.ts` follow the new behaviour (Escape in the dialog's open list closing the list
only, focus back on the opener, a `closeOnEscape` dialog's Escape only from inside the HUD root),
and the screenshots of the states that change (a list on the top layer) are re-recorded with
`--update` after review.

1. Section 1, the overlay stack: `testing/KitDom.ts` (Phase 0's shared linkedom helper with the
   focus shim; the tests this section touches move onto it), `overlays/OverlayStack.ts` (the
   entries, Escape on the HUD root's capture phase, the keyup swallow, focus return, `inert` for
   an entry that asks with the debugger's roots spared, all tested), `overlays/FocusTrap.ts`
   (the trap and the focusables finder the windows share; the dialog uses the trap from Phase 5).
   The dialog's Escape moves onto the stack (its window listeners go): every dialog pushes a
   modal entry, which closes on Escape with `closeOnEscape` and otherwise stops it, and its close
   returns focus to the opener. **The dialog sets no `inert` until Phase 5 §2** (decided
   2026-10-25: a dialog's modality arrives in one piece with the trap and the ARIA). The
   drop-down's list pushes an entry, so one Escape closes only the list (1.2's item 1). The
   dialog's keyboard scripts follow; the embed's `uiKit` scenario checks Escape on the host page
   leaves the dialog open and Escape inside closes it.
2. Section 2, the anchor and the top layer: `overlays/Anchor.ts` (the placement maths as pure
   functions, the reposition in one rAF on scroll and resize), the Popover API's top layer with
   the fallback in the HUD root (a dialog's `transform` centring would make a fixed list inside it
   relative to the dialog, so the fallback moves the list to the HUD root), the drop-down's list
   on both (no `40vh`, no clipping in a window, the ring on the active option). `verify:ui`'s
   outline check reads the active option when the focused element has `aria-activedescendant`.
   The embed's list inside the container; the perf-auditor review of the reposition.
3. Section 3, the tooltip and the popover: `overlays/Tooltip.ts`, `overlays/Popover.ts`, public
   on `aekasha/ui`, with their demos, checks and keyboard scripts, the kit's `CLAUDE.md` section on
   the overlay layer (its `aek:covers`), the embed's tooltip. Then the phase's verification and
   the changed screenshots re-recorded after review.

As built (section 1, 2026-10-25):

- **linkedom has no capture phase** (found writing the stack's tests): its `dispatchEvent` calls
  every listener from the target up, capture or not, so a capture listener on the HUD root ran
  after the target's and its `stopPropagation()` kept nothing from it. `testing/KitDom.ts`'
  `stubKitDomAsync()` patches linkedom's `EventTarget` (the window's event target is made from it
  on first use, so the patch comes right after `parseHTML`) with the DOM's order: capture from the
  window down, the target, bubble up, `once`, `stopImmediatePropagation`. With it Phase 0's focus
  shim (`activeElement`, blur / focusout / focus / focusin with `relatedTarget`, `[inert]` and
  unfocusable elements refusing `focus()`), `getClientRects` (one box when connected),
  `scrollIntoView`, `HTMLElement` / `HTMLInputElement` stubbed, and two helpers: `dispatchKey`
  (linkedom has no `KeyboardEvent`) and `countListeners` (D11's disposal check). A mutation (the
  stack's `stopPropagation()` removed) fails two of its tests. `DropDown.test.ts` and
  `DialogWindow.test.ts` moved onto it; the kit's other tests keep their own stubs until a phase
  touches them.
- `overlays/OverlayStack.ts` (`@internal`): `pushOverlay({ elem, close?, returnFocus?, inert?,
  keep?, isDebug? })` returns the remover (`returnFocus` default true). D7's `modal` is "no
  `close`": Escape stops at such an entry and does nothing, and `inert` is its own flag, so the
  dialog can push a modal entry now and ask for `inert` in Phase 5. The keydown listener is on the
  HUD root (capture), added on the first push with a HUD root; the keyup swallow is
  `swallowNextKeyUp`, a one-off capture listener on the **window**, not the HUD root: after a
  close the focus may be back on an opener outside the HUD, where the keyup goes (the drop-down
  shares it). An entry whose element left the document is dropped when the stack is read. Focus
  returns only when the focus is in the overlay or on the body, so a focusout close (the user
  clicked elsewhere) or a close from code while the user works elsewhere doesn't take it back.
  `inert`: the top inert entry covers the HUD root's children but its own, its `keep` and the
  entries above it; an app's entry spares `DEBUGGER_ROOT_ATTR` (`data-aek-debugger`, set on the
  debugger's roots in Phase 5 §2); the app's own `inert` is left alone; recomputed on each push and
  remove (a child added meanwhile stays live: Phase 5 decides whether that needs an observer).
- `overlays/FocusTrap.ts` (`@internal`): `trapFocus(elem)` and `getFocusableElements` /
  `getFirstFocusable`, which the windows' first-focus code now imports (its copy in
  `DraggableWindow.ts` went: 833 lines with the unmount hook, was 831).
- The dialog: every `openDialog` pushes an entry (with `close` only for `closeOnEscape`) after the
  window opens, with the focus before the open as `returnFocus`; the window's `onUnmount` (a new
  `@internal` `onDraggableWindowUnmount(id, fn)`, run first in `unmountWindow`, while the focus is
  still in it) removes it, so every close returns the focus. A reopen keeps the first opener. The
  window listeners are gone. A dialog rebuilt by a `sceneTargetResolver` after a load has no entry
  (dialogs are `removeOnSceneChange` in practice). The dialog already took the focus on open (the
  windows' `focusFirstElement`): Phase 3's "focus still on the Hub button" was wrong, the
  scripts below expect it inside.
- The drop-down: its list pushes an entry before it takes the focus, so the focus returns to what
  had it at the open: the trigger when opened by its keys, elsewhere (the canvas) when opened by a
  click (the trigger's `mousedown` doesn't focus it) or a shortcut. That's D7's rule, and it keeps
  Space from re-opening a list from a trigger the player never focused. A focusout close passes
  `false`. Its own Escape stays for a list outside the HUD root (the test's).
- `verify:ui`: two new steps, `focusBox` and `expectFocusBox` (a demo box's button by its text: the
  focus outside the HUD, an opener). The dialog's scripts: Escape inside a `closeOnEscape` dialog
  closes it and the focus is back on its Hub button; Escape on the Hub button leaves it open; a
  default dialog stops Escape and its OK button's close returns the focus; Escape in the dialog's
  open list closes the list (focus on the trigger), the next the dialog. The drop-down's two
  scripts expect the focus back on the trigger. All pass in the four settings. The screenshots of
  the dialog's "Closes on Escape" and "With a drop-down" states (and its list open) differ by the
  demo texts this section changed (0.14-0.29 % of the pixels): re-recorded after review.
- `verify:embed`: the `uiKit` scene's dialog is `closeOnEscape`; Escape on the host page's button
  leaves it open (a fixed 100 ms wait: nothing to poll for), and Escape on its close button closes
  it, in place of the button's click. Both host roots pass.
- The section's checks: `yarn test` (163 files), `tsc` (both), ESLint, `yarn hub:build`,
  `verify:ui --only dialog,dropDown` (every script; the three screenshots above), `verify:embed`
  (all seven scenarios). `verify:baselines`: the 12 new `@internal` exports, the dialog and
  drop-down chunk +0.6 kB gzip in the app (`DropDown.js`) and in the `uiKit` embed
  (`uiKitEmbed.js`, 11.5 KiB of its 12 KiB budget), and the banner's `banner.css` +56 B, Phase 2
  §3's `color-scheme` lines, which sat inside the tolerance unrecorded; recorded with `--update`.

### Phase 5: the existing pieces restyled and accessible

One section per piece, each with its demo boxes' screenshots in both themes for review and
`verify:ui` clean for it:

1. The windows (D5, D8): global classes and parts, the tokens, layered; `role="dialog"`, labels,
   the keyboard move and resize, the cycle keys (F6 / Shift+F6) and the main loop's debug key
   moved off F6, the header's line height and the title's truncation; `DraggableWindowKeys.ts`.
2. The dialogs (D7): modal ARIA, the trap, `inert` (the stack's, Phase 4: the dialog's entry asks
   for it, and the debugger's roots get the stack's marker), the z-order from `--aek-z-dialog`,
   `alert`.
3. The drop-down (D9): the restyle and the searchable variant; the two debugger stylesheets that
   restyle it checked.
4. The toaster (D5, D9): `Toaster.scss` and the custom properties, the live regions, pause on hover,
   focus and hidden page, the keyboard close, the icons per type, the long toast, reduced motion.
5. The icons (D5): `aekIcon`, the size tokens, `'small'` deprecated.

The scene runner's baselines change here on purpose (`--update` after review, recorded in As
built with the scenes that changed).

### Phase 6: core components I — actions

D10: Button (variants, sizes, icon, loading, toggle, hold to confirm), the button group, Menu, the
split button, Link, Kbd, the input glyph, Badge, Tag. Each with its tests, its demo and keyboard
script, `verify:ui` clean. A module size check after the windows' growth (D8) closes the
phase.

### Phase 7: core components II — feedback

D10: Spinner, Progress bar, Skeleton, Divider, Empty state, Loading overlay; the debug scene
loader onto the loading overlay (`_dbg__DebuggerSceneLoader.ts`: its spinner, its fades through
`showAsync` / `hideAsync`). Then the `uiKit` profile's scene grows (D13) and its budgets are set
from `suggestBudget`. The SBP report's "what does a HUD cost" lines (p800 D10: a window, a dialog,
a toast, a button) are noted here for the Hub.

### Phase 8: the Hub, the example, `CLAUDE.md`, readme

D13: the UI kit section and its child pages, the styling guide, the public component library page
(and its script in `public`), the dev page on the same demos, the `uiKit` example rebuilt and its
walkthrough, `::: embed uiKit`, the `CLAUDE.md` files, `readme.md`, the coding standards line.
`yarn hub:build` in both modes (no dead link, the API 100 % documented), and `verify:ui` against
the public build.

### Phase 9: versions and done

D14; the changelog entry with the restyle note; `yarn checkVersions --against main`; mark the plan
done; p800's §5 p803 entry points here and its Blocks line follows; p622's UI kit item names the
aliases to remove. Time for the PR: `p803-ui-kit-structure-and-core` → `main` (p800 §6).

---

## 4. Risks

- **The restyle changes every app's windows and toasts.** D14's note, the forced dark theme for
  an app that wants its old dark look, and the scene runner's screenshots reviewed in Phase 5.
- **The debugger in two looks until p806** (D6): navy frames around grey panels. It's dev-only, it
  lasts until p806, and it's written down. The alternative, keeping the old look for debug
  windows, would mean two window styles in the kit.
- **Layering lets an app's broad CSS win** (D5): the reason for layers, but a surprise for an app
  with `button { … }` in its global styles. The changelog warns, and the styling guide shows how
  to scope such a rule.
- **The top layer** (D7): ordering between several top-layer overlays follows open order, which is
  what we want. The fallback without the Popover API is the HUD-root path that's tested in
  linkedom (it has no top layer), so both paths get tests.
- **Keyboard move and the cycle keys** may collide with an app's key bindings: they only act with
  focus inside the HUD (D7's listener), and the cycle keys can be set to `null`. F6 / Shift+F6
  weren't checked on Windows (Phase 0 ran macOS only): Phase 5 checks them there, or says so.
- **The move** (Phase 1) touches about 60 files. One mechanical commit with no other change, and
  `tsc`, the layout check and the bundle baseline catch a miss.
- **axe-core's rules vs. the debugger**: `verify:ui` checks the kit's demos only, not the debugger
  (p806 adds its panels).
- **Size:** each component is lazy where it's used, but the windows and the toaster grow with the
  accessibility work. The `uiKit` profile's budgets are reset in Phase 7 and the app's `_engine/ui`
  group is watched in each phase's `yarn sbp`.

---

## Done when

- The kit is in `core/`, `components/`, `overlays/`, `forms/` and `styles/` under the per-folder
  layout rules. The new type names exist with deprecated aliases, and the engine, app and Hub use
  the new ones.
- `createHudRoot` and the kit's own stylesheet let a page use every piece without the boot. The
  kit no longer imports `MainLoop.ts`, and the Hub has no `MainLoop.ts` stand-in or deep import.
- The windows, dialogs, drop-down, toaster and icons are on the tokens in both themes and both
  densities, layered, with p800 D8's roles, labels, keyboard paths and focus handling. 1.2's items
  1-11 are each closed, or moved to a named plan.
- The overlay layer gives Escape to the innermost overlay only, inside the HUD only, and returns
  focus.
- D10's components exist with tests, demos, keyboard scripts and Hub sections, and `yarn
verify:ui` passes with no allowed violations.
- The Hub's UI kit section, styling guide, public component library page and the rebuilt
  `uiKit` example are live, and `yarn hub:build` passes in both modes.
- Engine 5.12.0 and app minor, the changelog's restyle note, `yarn checkVersions --against main`.
