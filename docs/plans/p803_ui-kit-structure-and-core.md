Status: in progress | Phases 0-7 implemented
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

As built (section 2, 2026-10-25):

- `overlays/Anchor.ts` (`@internal`): `computeAnchorPlacement` (pure, viewport px: the preferred
  side, flipped when the element doesn't fit and the other side has more room, else kept with
  the space it has; `start` / `center` / `end` along the side, shifted inside the bounds with
  `gap` from their edges, a too wide one fitted to them; the space left as `maxHeight` /
  `maxWidth`, never negative; all four sides, for the tooltip) and `showAnchored({ elem, anchor,
  side?, align?, gap? = 4, matchAnchorWidth? })` (`hasTopLayer()` feature-detects
  `showPopover`). The top layer path sets `popover="manual"` and keeps the element's DOM place;
  the fallback moves it to the HUD root at `--aek-z-tooltip` with its old place's
  `data-aek-theme` / `data-aek-density` (a dialog's centring `transform` would make a fixed element
  inside it relative to the dialog), and subtracts the bounds' corner. Both write
  `position: fixed`, `left` / `top`, the max size, `min-width` (`matchAnchorWidth`) and
  `data-side`. The reposition is one rAF on a capture `scroll` on the document, the window's
  `resize` and `onBoundsResize`; the remover stops them and calls `hidePopover()` (a no-op on a
  hidden popover, so no `:popover-open` check, which throws in linkedom).
- **The perf-auditor review** (D11): no layout thrashing (every read before every write), the
  teardown right. Applied: the overlay's own scroll (a long list) doesn't reposition it, and
  `place()` writes nothing when the ten numbers it read (the anchor's box, the bounds', the
  overlay's size) are those of the last call. Documented, not changed: the measured width is the
  rendered one under the last max width, so after the space grows a centre or end alignment uses
  the old width once (measuring the natural width would take a write before the reads). Skipped:
  the few objects per reposition (event-driven, only while an overlay is open), the forced layout
  once per open, the doubled window `resize` without a bounds element (the rAF coalesces it).
- The drop-down: the list is shown with `showAnchored` (side `placement`, `matchAnchorWidth`)
  before the highlight scrolls to it (a closed popover has no box), stopped before it's removed
  and in the root's `onRemoveCmp`. `DropDown.scss`: the list's `absolute`, `40vh`, `min-width:
  100%` and the two side rules went; `inset: auto`, `margin: 0`, `border: 0`, `width:
  max-content` undo the browser's popover styles. **Its width now follows the trigger** (the
  anchor), not the drop-down's root, which a flex column stretched to the panel's width (the
  component library's window): a list as wide as its trigger, or wider for its options. The
  font size is inherited as before in the top layer (its DOM place); the fallback takes the HUD
  root's until Phase 5 puts both on the type tokens (a size token now would shrink the list and
  not the trigger in the compact density). The highlighted option gets `data-active`, and
  `.aekDropDownList:focus-visible` moves the ring onto it (inset, since the list's overflow clips
  around the options).
- `verify:ui`'s outline check reads the option `aria-activedescendant` names when the focused
  element has one; the drop-down's and the dialog's scripts pass with it, so the ring shows on
  the option after every key.
- `verify:embed`: the `uiKit` scene's dialog is 180 px tall (was 230, "tall enough for the open
  list"), so the list overflows it, and the scenario checks the list's last option is the topmost
  element at its centre (`elementFromPoint`) besides the list inside the container. Both host
  roots pass.
- `KitDom.ts`: `countListeners(window, …)` read 0 always (linkedom's `window` is a proxy whose
  listeners are on the document's parent target): it resolves the window now, so section 1's
  "none on the window" assertions check something. A `getBoundingClientRect` shim (a box at the
  origin): linkedom has none, and `showAnchored` runs on the fallback path in the kit's tests.
  `Anchor.test.ts`: the maths (fits, flips both ways, keeps a side with less room opposite,
  shifts at both edges, a too wide one, centred in an embed's container box, left and right, no
  negative size), the fallback path (moved, theme and density, z, fixed, `data-side`), the top
  layer path (stubbed `showPopover` / `hidePopover`: kept in place, `popover="manual"`), and no
  listener left after the remover.
- The section's checks: `yarn test` (1347 tests), `tsc` (both), ESLint, `yarn hub:build`,
  `yarn verify:ui` (every piece: all eight keyboard scripts pass; only the screenshots below
  differ, no axe violation outside the allow list), `verify:embed` (seven scenarios).
  `verify:baselines`: the anchor's nine `@internal` exports, `DropDown.js` (the app's chunk with the
  windows, dialogs and drop-down) and the `uiKit` embed's `uiKitEmbed.js` +1.0 kB gzip each,
  recorded. `yarn sbp`: `uiKitEmbed.js` at 12.5 kB went over its 12 KiB budget, so it's 13 KiB
  now (`sbp.config.ts`, the comment naming this phase; Phase 7 resets it from `suggestBudget`);
  every budget within after.
- The screenshots that differ, to re-record after review (`--update`): the dialog's "Closes on
  Escape" and "With a drop-down" (section 1's demo texts), its list open (also the list's width),
  and the drop-down's "a list open" (2.3 %: the list as wide as its trigger, not the panel).

As built (section 3, 2026-10-25):

- `overlays/Tooltip.ts` + `Tooltip.scss`, `overlays/Popover.ts` + `Popover.scss`, on
  `aekasha/ui` with their types (`Tooltip`, `TooltipProps`, `Popover`, `PopoverProps`); D2's
  style: `createX(props)` returning `{ cmp, … }`, `class` / `attr` / `id` props, `cmp.remove()`
  disposing of the listeners on the anchor, the timers, the stack entry and the anchor's ARIA. Each
  is a persistent CMP whose element is in the HUD root only while it shows (never inside the
  anchor: a tooltip's text would join the anchor's accessible name), so nothing lingers when the
  anchor goes. Their side props spell the union out (no internal type in a public signature).
- The tooltip: shown after `--aek-tooltip-delay` (new token, 500 ms, read on the anchor with
  `getComputedStyle`) of hover and at once on a `:focus-visible` focus (a click's focus shows
  none); hidden on blur, `pointerdown` on the anchor (the window close button's case: the press
  removes the anchor under it), Escape (the stack's, `returnFocus: null`; the anchor's own
  listener outside the HUD root), the pointer leaving with a 100 ms grace to reach the tooltip
  (hoverable, WCAG 1.4.13), and the anchor leaving the document. `aria-describedby` is set at
  create (added to the anchor's ids), while the element exists only when shown: the description is
  there when a focus shows it, as Radix does it.
- The popover: the trigger's `click` toggles (Enter / Space on a button), `aria-haspopup="dialog"`,
  `aria-expanded`, `aria-controls`; `role="dialog"` (non-modal), `tabindex="-1"`, `aria-label`
  from `label`; the focus moves to its first focusable element (else itself); Escape returns it to
  the trigger (`returnFocus: anchor`, so also on Safari, where a click doesn't focus a button);
  a capture `pointerdown` on the document while open, outside it and its trigger, or a focusout
  leaving both, closes it without taking the focus back. `content` is a CMP added once or a
  function built per open (removed on close).
- `showAnchored` grew two things both use: an overlay outside the element carrying its anchor's
  forced `data-aek-theme` / `data-aek-density` takes them (the fallback's, and now one made in the
  HUD root), and `onAnchorRemoved` (an rAF check of `anchor.isConnected` while it shows: one
  property read a frame). It writes the max size as `--aek-anchor-max-width` / `-height`, not
  `max-width` / `max-height`, so a stylesheet caps it further (the tooltip at 32ch); the drop-down
  list's stylesheet reads them.
- The new stylesheets are on the tokens and in `@layer aek.components` with `:where()` (D5), the
  first kit styles there. `--aek-tooltip-delay` is a delay, not motion (reduced motion keeps it):
  `tokens.css` after the easings, and the design document's motion section has a "Delays" table
  (`design.ts`' `isDelay`).
- `KitDom.ts`: `requestAnimationFrame` / `cancelAnimationFrame` as 16 ms timers (fake timers run
  them). Tests: `Tooltip.test.ts` (6: the ARIA and its removal, the delay, the hoverable leave, a
  leave before the delay, focus / blur / press / Escape, the anchor removed, no timer or listener
  left, `setText`), `Popover.test.ts` (5: the trigger's ARIA, open with the focus in and the
  content built, the trigger's click closing it, Escape with the focus back, an outside press
  and a focus leaving, the disposal, a CMP content kept).
- The component library: a tooltip demo (a window of buttons laid out as a compass, so each side's
  tooltip has room, and a long text; states: the window, the four sides shown at once with
  `show()`, the long text) and a popover demo (a window with a "Filters" trigger; the checks'
  state opens it). Keyboard scripts: Tab shows the focused button's tooltip, Escape hides it and not
  the window, Tab shows the next; Enter opens the popover with the focus in, Tab moves inside,
  Escape closes it with the focus back on the trigger and `aria-expanded` false. Their texts,
  `COMPONENT_USES` and the page's tags. `UI_ALLOWED_VIOLATIONS` gets the windows'
  `landmark-no-duplicate-banner` on `tooltip` and `popover` too (their demos open in windows),
  until Phase 5 §1.
- The `uiKit` embed: its window (170 px tall, `focusFirstElement: false`: the focus would show the
  tooltip and the dialog's taking it hide it) has a "Hint" button whose tooltip shows before the
  dialog opens (so the dialog stays above it on the stack, and the scenario's Escape closes the
  dialog). The scenario checks the tooltip inside the container, its font size the same at both
  roots and its font IBM Plex Sans. `uiKitEmbed.js` budget 14 KiB (13.0 KiB now).
- Docs: the kit's `CLAUDE.md` has a `## The overlay layer` section (the stack, the trap and the
  anchor moved there from the UI kit section, the tooltip, the popover, their styles), which the
  UI kit feature page's `aek:covers` names; the UI kit guide a "Tooltips and popovers" section, the
  two in its pieces table and key APIs; the root `CLAUDE.md`'s map line and `overlays/` line.
  The readme waits for Phase 8 (D13).
- An `@example` naming `toolbar` failed the example check: it's a DOM global (`window.toolbar`,
  a `BarProp`), so the free name resolved to it; renamed `toolbarPanel` (the guide too).
- The phase's verification: `yarn test` (1358 tests), `tsc` (both), ESLint, `yarn hub:build` (no
  warning), `yarn verify:scenes` (104 passed against Phase 0's baselines), `verify:embed` (seven
  scenarios), `yarn sbp --profile all` (every budget within), `yarn verify:ui` (every keyboard
  script; the four reviewed screenshots differ, the tooltip's and the popover's are new), and
  `verify:baselines` recorded: the six new `aekasha/ui` names, `uiKitEmbed.js` +0.8 kB gzip in
  the embed (the tooltip) and, in the app's build of the profile's scene, `uiKitEmbed.js`
  +1.0 kB and a new `uiKitEmbed.css` (0.3 kB: the tooltip's styles).

### Phase 5: the existing pieces restyled and accessible — done

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

As built (section 1, 2026-10-25):

- **Decided in this section** (asked, 2026-10-25): the cycle keys' listener is on the HUD root's
  **parent** (the page's body, or a mount's container with the canvas), not on the HUD root as
  D8 said: on the HUD root F6 only acts with the focus already in the HUD, so from the canvas (a
  game's usual focus) it couldn't reach a window. An embed's host page outside the container
  keeps its F6. The main loop's debug key is **Shift+F7** as proposed, in the debug env and
  prodTest. Not checked: Firefox may open its Style Editor on Shift+F7 (a devtools shortcut a
  page probably can't prevent; Playwright can't press browser-level shortcuts), and F6 / Shift+F6
  on Windows and in Edge (Phase 0 ran macOS only). Both are left for a check by hand.
- `DraggableWindow.module.scss` became `DraggableWindow.scss`: global classes in
  `@layer aek.components` with `:where()` (`aekWindow`, `aekWindow__header`, `__title`,
  `__button` / `__collapse` / `__close`, `__content`, `__resizeV` / `__resizeH` / `__resizeHV`,
  `aekWindowBackdrop`), the states as attributes (`data-state="collapsed" | "expanded"`,
  `data-draggable`, `data-resizable="both" | "vertical" | "horizontal"`, `data-resizing`), every
  colour from p801's rows and every size a token, no `--aek-rem`. Its custom properties
  (`--aek-window-header-height` (default `--aek-space-7`, 32 px / 24 px compact), `-radius`,
  `-bg`, `-header-bg`, `-border-color`, `-shadow`) are read with the token as the fallback and
  never declared, so an app sets them on any ancestor. The window is `box-sizing: border-box`
  (an embed has no page `*` rule) with a 1 px `border-strong` border. The header's buttons, the
  header and the content draw the ring inside (the window's `overflow` clips an outside one). The
  collapse chevron and the close cross are CSS marks in `currentColor` (no icon: a production app
  may not register the built-ins). The debugger's content helpers (`winPaddedContent`,
  `winSmallIconButton`, …) moved with it, on the tokens, until p806.
- **The split** (D8's "keys in `DraggableWindowKeys.ts`"): the DOM build grew about 210 lines, so
  `DraggableWindowDom.ts` (new, no state: the attributes, the names, the header with its buttons,
  tooltips and keys, the collapsed state, the content's tab stop) and `DraggableWindowKeys.ts`
  (the header's keys, the cycle keys and their window list) take it. `DraggableWindow.ts` is 833
  lines, as before the section; neither new module imports it.
- ARIA (D8): the window `role="dialog"` named by `aria-labelledby` its title, else
  `aria-label` from the new `ariaLabel` prop (`OpenDraggableWindowProps` and the stored config;
  default 'Window'; an empty title's `h3` is `aria-hidden`, or axe's `empty-heading` would fire).
  The header is a `<div>` (closes the `landmark-no-duplicate-banner` entries); with a key to act on
  it's `tabindex="0"`, `role="group"` (an `aria-roledescription` needs a role),
  `aria-roledescription="movable window"` when it moves, and its keys in a `hidden` span named by
  `aria-describedby`. The collapse button: `aria-expanded`, `aria-controls` the content, named by
  the title (the disclosure pattern: "Settings, expanded"), its tooltip "Collapse" / "Expand". The
  close button: `aria-label="Close"` and a tooltip. Their `title` attributes went.
- **`createTooltip` grew two rules** for this: no `aria-describedby` while the text is the
  anchor's `aria-label` (the close button's tooltip would read "Close, Close"), and the prop
  `onlyWhenTruncated` (shows only while the anchor's text is cut: the title's tooltip; no
  `aria-describedby` either). `disableDragging` joined the structural keys (a change remounts:
  the header's role and keys depend on it).
- The header's keys: the arrows move by `--aek-base` × 16 / 14 (16 px at the defaults, in both
  densities: `--aek-space-5` is unregistered, so its computed value is an unresolved `calc()`),
  Alt+arrows resize (left / up shrink, in px from then on, a collapsed window's height left
  alone), Shift × 4, Enter toggles the collapse; only for a key on the header itself (its buttons
  keep theirs), and a used key is stopped (no key binding moves the player meanwhile). The commit
  (kind geometry, LS) is on the arrow's keyup or the header's focusout.
- The cycle: the HUD root's children in DOM order (the mount order, which a bring-to-front
  doesn't change: in z-order, Shift+F6 would only flip between the top two windows), the app's
  windows and then the debug windows, skipping an inert or unrendered one (a modal's inert, an
  editor view's hidden HUD); from outside every window F6 takes the first, Shift+F6 the last. The
  focus target is the windows' first-focus rule (the content's first focusable, else the header).
  With no window open the key is left alone (the browser's F6). `setWindowCycleKeys` takes chord
  strings (`'Ctrl+Shift+F6'`) and `null`; it and `WindowCycleKeys` are on `aekasha/ui`. A window
  also comes to the front on `focusin` (Tab into it), as on a press.
- `scrollable-region-focusable`: a content with no focusable element gets `tabindex="0"` (read at
  the mount and a rebuild), and a collapsed window's content is `visibility: hidden` once the
  collapse's transition ends (Tab skipped it before, too: it was only clipped).
- The title's descenders (1.2's item 4): the title's `line-height` is `--aek-line-height-base`,
  centred in the header, one line with an ellipsis.
- The debug key: `sc-toggle-main-loop` and `sc-prod-test-toggle-main-loop` are `Shift+F7` (a
  chord's modifiers match exactly, so F7 alone stays the pause); the on-screen tools' title, the
  debug `CLAUDE.md`, the debug suite's Hub page and `DefaultDebugKeyBindings.test.ts` follow.
- `verify:ui`: a new step `expectStyle` (a computed style property: the key move's `left` /
  `top`, the resize's `width`), and three window scripts: the header's buttons
  (`data-state`, `aria-expanded`), the header's keys (560 → 576 px, Shift+ArrowDown 290 → 354 px,
  Alt+ArrowRight 320 → 336 px wide, Enter twice), and F6 / Shift+F6 from a Hub button through the
  default window and a kind window. `UI_ALLOWED_VIOLATIONS` lost the five
  `landmark-no-duplicate-banner` entries and `scrollable-region-focusable`, and got
  `color-contrast` on `dialog` and `dropDown` until section 3: the drop-down keeps its old dark
  greys inside a window that follows the light theme now (its labels, its open list over the
  panel's text).
- `verify:embed`: the `uiKit` scenario's selectors follow (`.aekWindow__title`), and Escape inside
  the dialog is pressed on its drop-down's trigger, not its close button: focused, the close
  button shows its tooltip, which takes the first Escape (the innermost overlay, D7, as in the
  component library's tooltip script).
- Size: the windows now bring the tooltip, the anchor and the keys. `DropDown.js` (the app's chunk
  with the windows) 12.4 → 14.7 kB gzip, `DropDown.css` 1.9 → 2.1 kB; the `uiKit` embed's
  `uiKitEmbed.js` 13.3 → 15.0 kB, over its 14 KiB budget, so it's 16 KiB (`sbp.config.ts`' comment
  names this section; Phase 7 resets it from `suggestBudget`).
- The section's checks: `yarn test` (167 files, 1371 tests), `tsc` (both), ESLint,
  `yarn hub:build` (960 names, 100 % documented), `verify:embed` (all seven scenarios),
  `yarn sbp --profile all` (every budget within after the raise), `verify:baselines` recorded
  (the 18 new `@internal` exports, `setWindowCycleKeys` and `WindowCycleKeys` on `aekasha/ui`, the
  sizes above). `yarn verify:ui`: every keyboard script passes and no violation outside the allow
  list; the window's, the dialog's and the drop-down's screenshots differ (the restyle, and the
  drop-down's window 3 px taller): re-recorded with `--update` after review, and the run after
  passed every check.

As built (section 2, 2026-10-25):

- **Decided in this section** (asked, 2026-10-25): **an app's modal dialogs stack below the
  debugger**, not above the debug windows as D7 said. D7's other rule spares the debugger's roots
  from an app's `inert` so a pause menu can be debugged, but at 30000 the dialog's backdrop would
  cover the drawer (10200), the on-screen tools (10000) and the debug windows (20000+), and no
  click would reach them. So `--aek-z-dialog` is **5000** (above the app's windows and the scene
  loader at 1000) and a new `--aek-z-debug-dialog` is **30000** (a debug modal: the key shortcuts
  dialog). The design document's layers paragraph and the guide's layers row follow; the toasts
  (31000) and the tooltips (32000) don't change.
- The stacks: `DraggableWindow.ts`' `Layer` is `APP | DIALOG | DEBUG | DEBUG_DIALOG` and
  `Z_INDEX_BASES` (`@internal` now) is 100 / 5000 / 20000 / 30000; `DialogWindow.test.ts` reads
  `tokens.css` and checks they're equal. A modal is marked by `setDraggableWindowModal(id)`
  (`@internal`, a set of ids `openDialog` adds to before the open, dropped with the window), not a
  config key: the modal behaviour is `openDialog`'s, so a public flag on `openDraggableWindow`
  would make a modal-looking window without its trap.
- `openDialog`: `role="dialog"` or `"alertdialog"` (new `alert` prop) and `aria-modal="true"`
  written on every open; a new `initialFocus` prop (a selector in the dialog, focused after the
  windows' first focus); `trapFocus(elem)`, removed in the unmount hook and on a reopen (a reopen
  without a remount kept the old trap's listener before); its stack entry `inert: true` with the
  backdrop in `keep` and `isDebug` for a debug dialog. Its JSDoc lists the ARIA, focus, inert,
  keys and layers.
- `DEBUGGER_ROOT_ATTR` (`data-aek-debugger`) on the drawer, the editor drawer, the on-screen
  tools' rows and switch tools (with their forced theme), a debug window and its backdrop
  (`DraggableWindowDom.ts`), and also the stats panels (`_dbg__Stats.ts`: their click opens the
  profiler) and the debug toaster (`Boot.ts`, its closable alerts), which D7 didn't list. An
  app's modal leaves them live; a debug modal inerts them with the rest.
- **A child added while a modal is open stays live, no observer** (Phase 4's open question): what
  code adds then is on purpose (a window or a toast the dialog opened, a tooltip, a fallback list
  above it), and the next push or remove recomputes.
- `radius-lg` for the windows and dialogs (the design document's rule; section 1 had `md`), and
  the resize handles `--aek-border` (p801's row; section 1's `border-strong` read as a scrollbar's
  thumb in the light theme).
- The component library: two dialog states, "Alert" (`alert`, `initialFocus` on Cancel, Cancel and
  Delete) and "Over a window" (a window at the top left, inert while the dialog is open), and two
  keyboard scripts: the alert's role, `aria-modal`, the focus on Cancel, Tab wrapping to the close
  button and Shift+Tab back, Enter closing it with the focus on its Hub button; the window's
  `inert` set and then removed after Escape. The demo's dialog buttons get a class from their text
  (`hubDemoCancel`).
- Tests: `DialogWindow.test.ts` (+5: the roles and `initialFocus`, the trap and no listener after
  the close, `inert` with the backdrop and a debugger root spared, the layers' z with a debug
  dialog inerting a debugger root and an app dialog, the bases equal the tokens).
- Docs: the kit's `CLAUDE.md` (the dialogs' modality and layers; the stack's spared roots and the
  no-observer decision), the debug `CLAUDE.md` (the marker), the UI kit guide (modal, `alert`,
  `initialFocus`, the layers), the component library's dialog text.
- The section's checks: `yarn test` (1376 tests; `buildGuard.test.ts` failed once in the Stop
  hook's run while `verify:embed` rebuilt `dist-embed/` next to it, and passes alone), `tsc`
  (both), ESLint, `yarn hub:build`, `verify:embed` (all seven), `yarn sbp --profile all` (every
  budget within), `verify:baselines` recorded (`Z_INDEX_BASES` and `setDraggableWindowModal`;
  `DropDown.js` and the embed's `uiKitEmbed.js` +0.3 kB gzip each). `verify:ui --only
  window,dialog`: every keyboard script passes, no violation outside the allow list; the
  screenshots that differ (the corners' `radius-lg` and the handles' `border` on every window and
  dialog state, the dialog box's two new buttons; the two new states have none yet) to re-record
  after review.

As built (section 3, 2026-10-25):

- `DropDown.scss` on the tokens in `@layer aek.components` (p801's rows): the trigger a control
  (`surface`, a 1 px `border-control`, `radius-md`, `surface-hover` on hover, `text-disabled`
  and `border` disabled, the caret `text-muted`), the list `surface-raised` with a 1 px
  `border-strong` and `shadow-sm`, the highlighted option `surface-hover`, the current option's dot
  the `accent`, the sizes from the type and space scales, no `--aek-rem` or `variables.scss`. The
  list sets its own `--aek-font-size-sm`, so the fallback in the HUD root looks the same (Phase 4
  §2's open item). **A 24 px floor** on the trigger, the filter field and the options (WCAG
  2.5.8): axe's `target-size` fired on the field in the compact density (21 px); an option is a
  flex box centring one label span (a flex box would drop the spaces around a match).
- **`searchable: true`** and `searchPlaceholder` (default 'Search'): the open popup
  (`.aekDropDownPopup`, the anchored element, with `listClass`) holds the filter field
  (`.aekDropDownSearch`, `role="combobox"`, `aria-controls` the list, which now writes its id,
  `aria-autocomplete="list"`, `aria-expanded`, named by the placeholder), the list and a
  `role="status"` `.aekDropDownEmpty` ('No matches', hidden while empty). The field keeps the focus
  and the `aria-activedescendant` (the ring on the active option follows it:
  `.aekDropDownSearch:focus-visible + .aekDropDownList`); typing filters by label, case ignored,
  marks the first match (`<mark class="aekDropDownMatch">`, built from text nodes: labels are app
  data) and highlights the first match; the arrows move, Enter picks (nothing with no match), Home,
  End and Space are the field's, Escape and Tab as before. A press on the popup's own padding keeps
  the focus in the field. The popup's keydown, keyup and focusout listeners moved from the list's
  CMP listeners (capture) to plain ones on the popup (the list itself without `searchable`), and
  a typed letter's keyup is stopped with the arrows'. No typeahead: D9's "its typeahead stays as
  today" found none to keep.
- The debugger: only `OnScreenTools.module.scss` still restyles the drop-down (its trigger, by
  `triggerClass`; `MaterialEditor.module.scss` no longer does, 1.1 is stale there). Its unlayered
  class wins over the kit's layer, so the on-screen triggers look as before; their list takes the
  tokens' dark theme (the tools force it). Checked by eye in the debug env, a light and a dark
  system (`.cache/p803/phase5s3/`, local; a scratchpad script).
- `UI_ALLOWED_VIOLATIONS` lost section 1's two `color-contrast` entries.
- The component library: a "Searchable: type to filter" row (the panel's window 600 px tall), a
  state with its list open, and a keyboard script: Enter opens it with the focus on the field
  (`role="combobox"`), the active option Orange; `o` leaves three options with the match marked,
  ArrowDown to Gold, `l` leaves two with Gold highlighted, ArrowDown to Violet, Enter picks it
  and the focus is back on the trigger.
- Tests: `DropDown.test.ts` (+1: the field's ARIA, the filter, the mark, Home and Space left to
  the field, 'No matches' and Enter doing nothing, a pick by Enter and the focus back).
- Docs: `createDropDown`'s JSDoc (the searchable keys, its parts, its ARIA), the kit's
  `CLAUDE.md`, the UI kit guide (a searchable example, the colours note), the component library's
  drop-down text.
- The section's checks: `yarn test` (1377 tests; `buildGuard.test.ts` failed again in the Stop
  hook's run beside the background `verify:embed`, and passes alone), `tsc` (both), ESLint,
  `yarn hub:build`, `verify:embed` (all seven), `yarn sbp --profile all` (every budget within:
  the embed's `uiKitEmbed.js` 15.9 kB of its 16 KiB), `verify:baselines` recorded (`DropDown.js`
  and `uiKitEmbed.js` +0.5 kB gzip each: the searchable variant). `verify:ui --only
  window,dialog,dropDown`: every keyboard script passes and no violation (the allow list holds the
  toaster's `button-name` alone); the drop-down's and the dialog's drop-down screenshots differ
  (the restyle, the panel's new row) and the searchable state is new, to re-record after review.

As built (section 4, 2026-10-25):

- **Nothing in the page's head** (D5): `Toaster.scss` (on the tokens, layered) has the styles, a
  toaster's size settings are custom properties on its element (`--aek-toast-min-width`,
  `-max-width`, `-min-height`, `-max-height`; the `ToasterSettings` keys unchanged), a toast's
  animation time is `--aek-toast-time` on it (the JS still times the phases), the toaster at
  `--aek-z-toast`. `verify:embed`'s `uiKit` scenario counts the host head's `<style>` elements
  before and after the mount.
- **The classes are aek-prefixed** (decided in this section: D5's global prefixed classes; a host
  page's own `.toast` matched the old ones in an embed): `aekToaster`, `aekToast` with `__icon`,
  `__content`, `__title`, `__message`, `__close`, `data-type`, and the phase as `data-phase`
  (`entering` / `appearing` / `showing` / `removing`, in place of `toastStart` / `toastEnd`), the
  toaster's padding transition on `data-updating`. The changelog's restyle note names the rename.
  `DebugToaster.scss` (the debug toaster's icon colours by the old classes) is deleted: the kit
  colours each kind now. `MaterialEditor.module.scss`' toaster rule takes `.aekToaster`.
- **`success`** joins `ToastType` (D9 names it; 3.2 s like info). Each kind has a status colour
  (a 3 px stripe, `--aek-toast-status`: `info`, `success`, `warning`, `danger`) and an icon:
  `settings.icons`' HTML (the debug toaster's), else a glyph drawn in CSS in a `-soft` circle
  (`data-glyph`: i, a check mark, !, a multiplication sign), so an app needn't register the
  built-in icons. The glyphs are CSS escapes in the output (`sass:string`'s `unquote`): a
  non-ASCII character would make Sass write `@charset`.
- Assistive tech (D9): two visually hidden live regions per toaster (`role="status"` polite for
  info, success and warning; `role="alert"` assertive for an alert) read a toast's title and
  message once, the region emptied and filled 50 ms later so a repeated text is read again; the
  toaster isn't live itself. `aekVisuallyHidden` is new in `kit.scss` (`aek.utilities`), for
  Phase 6's link too. `verify:ui`'s capture leaves visually hidden elements out of the union (the
  regions' 1 px boxes made every state's shot the whole viewport).
- The close button: `aria-label="Close"` (closes the `button-name` entry), a 24 px target,
  `type="button"`; the default cross is CSS like the window's. With the focus in a toast it has an
  overlay stack entry (pushed on `focusin`, its `returnFocus` the `relatedTarget`), so Escape
  closes it and the focus goes back; `removeToast` with the focus inside returns it too.
- The pauses: the showing time counts down only while the toast isn't hovered, doesn't hold the
  focus and the page isn't hidden (one `visibilitychange` listener on the document, added with the
  first toaster and removed with the last); the time left is kept across a pause.
- The long toast (1.2's item 5): a flex row (icon, text, close), the text `align-self: stretch`
  with its own scroll inside `--aek-toast-max-height`, a tab stop when it overflows (measured
  at the add: `scrollable-region-focusable` fired on the long message).
- Reduced motion (D9, p800 D7): with a factor of 0 the toast doesn't slide or push the queue; it's
  settled at once and fades in place in the setting's time, unscaled (opacity isn't motion).
  `animationTime` in the response is that fade then.
- Found: a `down` or `right` toaster's new toast slid in at the start and then settled at the far
  end (it was appended); it's prepended now. The old code's `prepend` was on the toast's content,
  which put a down toaster's text before its icon.
- `UI_ALLOWED_VIOLATIONS` is empty (Done when: `verify:ui` passes with no allowed violations).
- The component library: a "Success" toast; the long message closable and its text on the
  scroll; three keyboard scripts (the close button's label and Enter; Escape in a toast with the
  focus back on its Hub button; the polite region's text after "With a title").
- Tests: `Toaster.test.ts` on `KitDom` (7: the phases, the early removal and the toaster's
  removal with no head `<style>` and no listener left, the live regions, the glyph and the close
  label and an omitted icon, the three pauses with the time left, Escape with the focus back).
- Size: the toaster's CSS left its JS string: `uiKitEmbed.css` 2.6 → 3.2 kB gzip and
  `uiKitEmbed.js` 15.9 → 16.1 kB in the embed (`DropDown.css` +0.6, `DropDown.js` +0.2 in the
  app), over their budgets: 4 KiB and 17 KiB now (`sbp.config.ts`, Phase 7 resets them).
- Checked by eye: the debug toaster in the app (F1's toast) on a light system follows it (D6: the
  debug toaster isn't forced dark), its own icons in the kind's colour (`.cache/p803/phase5s4/`).
- The section's checks, in the foreground this time (the Stop hook's tests and the background
  `verify:embed` collided twice): `yarn test` (1381 tests), `tsc` (both), ESLint,
  `yarn hub:build`, `verify:embed` (all seven), `yarn sbp --profile all` (every budget within after
  the raise), `verify:baselines` recorded. `yarn verify:ui` (every piece): every keyboard script
  passes, no violation, an empty allow list; the toaster's screenshots differ (the restyle), and
  the tooltip's and the popover's by 0.16-0.36 % (they open in windows: section 2's corners and
  handles, not re-recorded then), to re-record after review.
- Docs: the kit's `CLAUDE.md` (the toaster, the closed "Left for p803" item, the embed's check),
  `devTools/verify/CLAUDE.md` (the head check, `expectStyle`, the capture's hidden elements), the
  UI kit guide's toasts, the component library's toaster text.

As built (section 5, 2026-10-25):

- `getSvgIcon(name, size?: SvgIconSize | 'small')` writes `<span class="aekIcon uiIcon">`, with
  `data-size` for a size and `smallIcon` at `'sm'` (the debugger's classes until p806); `'small'`
  is `'sm'`, deprecated (its `@param` says so: a union member can't carry `@deprecated`), and
  p622's UI kit item lists it with the two debugger classes. `SvgIconSize` (`'sm' | 'md' | 'lg'`) is
  on `aekasha/ui` (a public signature names it). The engine's 14 `'small'` calls and the Hub's are
  `'sm'` now; the window title's icon has no size (`1em`, following the title).
- `kit.scss`' `aek.base`: `.aekIcon` is an inline block `1em` wide (the SVG keeps its square
  aspect), `vertical-align: -0.125em`, and `[data-size]` takes `--aek-icon-size-sm` / `-md` /
  `-lg` (new in `tokens.css`: 12 / 16 / 20 px, and 11 / 13 / 16 in the compact block: D5 puts them
  in the type scale's group, so the density re-declares them; `Tokens.test.ts`' density check
  counts `icon-size` with `font-size` and `space`). The design document's type section has an
  "Icon sizes" table (`design.ts`: `icon-size-` in `TYPE_PREFIXES`, a square sample per size).
  The unlayered `.uiIcon svg` rule stays for the debugger.
- **The debugger keeps its icons** (found by a before / after screenshot of the drawer and the
  on-screen tools): the drawer's tab buttons never sized their icon (the SVG's own 16 px did), so
  the kit's `1em` shrank them. Inside `[data-aek-debugger]` (section 2's marker) the base layer
  gives `.aekIcon` the old inline, auto-width box, after the size rules, and the debugger's own
  unlayered `.uiIcon` rules win as before: 0 changed pixels after (`.cache/p803/phase5s5/`, local;
  a scratchpad script).
- The drop-down's trigger sizes its icon (`.aekDropDownTrigger .aekIcon { width: auto }`, its SVG
  1.25em); its `icon` prop's example is `getSvgIcon('camera')`.
- The component library's icons box: icons at `1em`, the three sizes, the "Undo" button with an
  icon at `1em` (the page no longer sizes `.uiIcon`), and the unregistered name.
- Tests: `SvgIcon.test.ts` (new, 4: `aekIcon` without a size, `data-size` and `smallIcon`, `'small'`
  as `'sm'`, `??` with one warning).
- Docs: `getSvgIcon`'s JSDoc (its parts, its custom properties, an `lg` example), the kit's
  `CLAUDE.md` (the icons; its "Left for p803" item, the last, gone; the 6.0.0 list), the UI kit
  guide's icons, the component library's icons text, p622.
- The section's checks: `yarn test` (168 files, 1385 tests), `tsc` (both), ESLint,
  `yarn hub:build` (961 names, 100 % documented), `verify:embed` (all seven), `yarn sbp --profile
  all` (every budget within), `verify:baselines` recorded (`SvgIconSize`; the kit's base CSS
  +0.1 kB gzip in `index.css`, `banner.css` and `uiKit.css`). `yarn verify:ui` (every piece): every
  keyboard script passes, no violation; the icons box's two shots differ (its new row), to
  re-record after review.

The phase's verification (2026-10-25, at its end): `yarn verify:scenes`, 104 passed against
Phase 0's baselines (none changed: the scene runner's snapshots are the canvas alone, so the
"baselines change here on purpose" above didn't happen); each section's checks above (`yarn test`,
`tsc`, ESLint, `yarn hub:build`, `verify:embed`, `yarn sbp --profile all`, `verify:baselines`,
`yarn verify:ui` with an empty allow list). For Phase 6's size check: `DraggableWindow.ts` is 860
lines (833 after section 1's split into `DraggableWindowDom.ts` and `DraggableWindowKeys.ts`,
then section 2's dialog layers; its header says why it's over 800), `Toaster.ts` 705,
`DropDown.ts` 422; the `uiKit` embed's `uiKitEmbed.js` 16.1 kB of 17 KiB and `uiKitEmbed.css`
3.2 of 4 KiB; the changelog's restyle note (Phase 9) must name the toaster's class rename, the
layered styles, the window and dialog z-order and `--aek-z-dialog`'s new value, and Shift+F7.
 `verify:scenes`
  wasn't run: its snapshots are the canvas alone, which no kit style reaches (Phase 0); it runs at
  the phase's end.
- Tests: `DraggableWindowKeys.test.ts` (11: the chords, the roles and names, a fixed window's
  header, the content's tab stop, the move and its stop, the resize, Enter, the cycle's order, an
  inert window, `null` and other keys, no window open), two in `Tooltip.test.ts`.
- Docs: the kit's `CLAUDE.md` (the windows' files, ARIA, keys and cycle; the styles; the tests;
  the tooltip's rules; the "Left for p803" title item gone), the debug `CLAUDE.md`, the UI kit
  guide ("Keys and assistive tech", the window's parts and custom properties in Styling, the
  colours note, `setWindowCycleKeys` in the key APIs, the tooltip's rules), the component
  library's window text and `_components.scss`' comment.

### Phase 6: core components I — actions — done

D10: Button (variants, sizes, icon, loading, toggle, hold to confirm), the button group, Menu, the
split button, Link, Kbd, the input glyph, Badge, Tag. Each with its tests, its demo and keyboard
script, `verify:ui` clean. A module size check after the windows' growth (D8) closes the
phase.

Each section: the modules in `components/` (`Menu.ts` in `overlays/`, D2) with their stylesheet
and test on `KitDom`, on `aekasha/ui` with their types, JSDoc with the parts, custom properties,
keys and an `@example`; the component library's demo box (`<piece>-text.md`, `DEMOS`,
`COMPONENT_USES`, the checks table); the kit's `CLAUDE.md` and the UI kit guide; then `yarn test`,
`tsc`, ESLint, `yarn hub:build`, `verify:ui --only <pieces>`, `yarn sbp --profile all` and
`verify:baselines` (the new names recorded).

1. Section 1, Kbd and the input glyph (first: the button's `kbd` draws with Kbd).
   `components/KeyNames.ts` (`@internal`, no styles: a key's shown and spoken names, the
   platform), `components/Kbd.ts`, `components/InputGlyph.ts`.
2. Section 2, the button: `components/Button.ts`, the five variants (`link` included, D10's Link
   bullet), the sizes, the icon, the label and tooltip, `kbd`, loading, disabled, the toggle and
   hold to confirm.
3. Section 3, the button group (`createButtonGroup`: `role="group"`, joined; `exclusive` a toolbar
   with roving `tabindex`) and the link (`createLink`).
4. Section 4, the menu (`overlays/Menu.ts`, the APG menu button) and the split button
   (`createSplitButton`).
5. Section 5, the badge and the tag (`createBadge`, `createTag`); then the module size check
   (D8: `DraggableWindow.ts` at 860 lines) and the phase's verification (`verify:scenes` too).

Defaults chosen at the phase's start (2026-10-25, for review):

- **Static pieces in the page.** Kbd, the glyph, the button, the badge and the tag are demoed in
  their box, not in a window: in a kit root of the demo's own (`aekUi`, as an app's UI outside
  the HUD), which the page's theme and density switches set too, so `verify:ui` checks them in
  the four settings. The menu and the split button open in the box too (their menu is an
  overlay on the HUD root's stack).
- **Kbd** (`createKbd({ keys })`): `keys` is `getKeyChordLabel`'s text (`'Ctrl+Shift+P'`, a
  trailing `+` for the key itself, alternatives joined with `' / '` shown with "or", as the
  debug shortcuts dialog draws them; p806 moves the dialog onto it). An outer `<kbd class="aekKbd">`
  holds a `<kbd>` per key with `+` between them on every platform (D10). On macOS (read at
  create from `navigator.userAgentData` / `navigator.platform`, or the `platform` prop) the
  modifiers show as ⌃ ⇧ ⌥ ⌘; the arrows are ← ↑ → ↓ everywhere. When what it shows isn't
  what it says (a symbol, an arrow), the shown keys are `aria-hidden` and a visually hidden copy
  holds the full names ("Command+Shift+P"): `aria-label` on a `kbd` (a generic role) is
  prohibited (axe's `aria-prohibited-attr`). Sized in `em` so it follows its text, as an icon.
- **The input glyph** (`createInputGlyph({ input })`): `input` is an action binding's shape,
  spelled out in the kit (no kernel import): `{ device: 'KEYBOARD', key }`,
  `{ device: 'MOUSE', button: 'LEFT' | 'MIDDLE' | 'RIGHT' }` or
  `{ device: 'MOUSE', delta: 'MOVE' | 'WHEEL' }`, so an app passes a map's binding as it is; p808
  adds `'GAMEPAD'`. A key is a key cap (a wide one for Space, Shift, Enter, Tab, Backspace), a
  mouse input an inline SVG of a mouse with the part in the accent (the kit's own markup: a
  production app may not register the built-in icons). `role="img"` with the spoken name as its
  `aria-label` ("Left mouse button").
- **The button's spinner** (section 2) is a CSS mark on the button (`[aria-busy="true"]`), like
  the window's close cross, so the button needs no Phase 7 module; Phase 7's spinner shares its
  keyframes. `kbd` sets `aria-keyshortcuts` on the button and its Kbd is `aria-hidden` (the
  button's name stays its label).

As built (section 1, 2026-10-25):

- `components/KeyNames.ts` (`@internal`): `getKeyPlatform()`, `getKeyName(key, platform)`
  (`{ shown, spoken }`: the modifiers by platform, the arrows, Esc, Space, Del, PgUp / PgDn; a
  one-character key upper-cased, an unknown one kept) and `splitKeyChord` (a trailing `+` is the
  key).
- `components/Kbd.ts` + `Kbd.scss`: `createKbd({ keys, platform?, class?, attr?, id? })` returns
  `{ cmp, setKeys }` (redrawn in place). **The hidden copy is there whenever a shown name isn't
  its word**, so `Ctrl` gets one too ("Control+Shift+P"), not only the macOS symbols. The id is
  written only when given. The browser's monospace `kbd` font is undone (`font-family: inherit`).
- `components/InputGlyph.ts` + `InputGlyph.scss`: `createInputGlyph({ input, platform?, class?,
  attr?, id? })` returns `{ cmp, setInput }`; `InputGlyphInput` on `aekasha/ui`. No wide key caps
  (D10 doesn't ask; a cap is at least square and grows with its text: Space is wider by itself).
  The mouse is a 24 × 24 SVG: the body, the buttons' line, the left or right half, the wheel
  (`MIDDLE`, and `WHEEL` with an up and down chevron), and side chevrons for `MOVE`. The line is
  broken around the wheel only when the wheel is the part: through it, the line hid the lit wheel,
  and an outlined wheel on every mouse cut into a lit half (the two halves read alike in the
  compact density's shot).
- The component library: a "Kbd" and an "Input glyph" box, drawn in the page in a kit root of their
  own (`addKitRoot`, `.hubDemoKitRoot`), which the theme and density switches set with the HUD
  root (the switches' note said "every setting looks the same": stale since Phase 5, rewritten).
  The rows' size is `--aek-font-size-md` on the groups, not the kit root: `--aek-base` is computed
  from the root's own font size, so the root reading it would be a cycle. No Hub buttons: the box
  as shown is the state. Their check scripts have no keys (nothing to press): the macOS hint's
  symbol, `aria-hidden` and spoken copy, and the glyphs' `role="img"` and names.
- Tests: `Kbd.test.ts` (8: the chord split, the names by platform, the platform read from
  `navigator`, the keys and joins, `Ctrl` said in full, the macOS symbols hidden with the words,
  alternatives and `setKeys`, the id), `InputGlyph.test.ts` (3).
- Docs: the kit's `CLAUDE.md` (a bullet, the styles' importers, the tests), the UI kit guide (two
  rows in the pieces table, "Key hints and input glyphs", the key APIs), the component library's
  two texts and `COMPONENT_USES`.
- The section's checks: `yarn test` (170 files, 1396 tests), `tsc` (both), ESLint,
  `yarn hub:build` (968 names, 100 % documented), `yarn sbp --profile all` (every budget within;
  no profile ships the two yet), `verify:baselines` recorded (the seven `aekasha/ui` names and the
  five `@internal` key-name exports; every bundle unchanged). `verify:ui --only kbd,inputGlyph`:
  both scripts pass, no violation; the two boxes' screenshots are new, to record with `--update`
  after review.

As built (section 2, 2026-10-25):

- `components/Button.ts` + `Button.scss`: `createButton(props)` returns `{ cmp, setLabel,
  setDisabled, setLoading, isLoading, setPressed, isPressed }`. **`label` is required on every
  button** (D10 said "required when it shows only an icon"): a button's text is its name, so
  there's one prop for both, and `iconOnly` (new) shows only the icon, the label then the
  `aria-label` and, without `tooltip`, the tooltip (which describes nothing: the tooltip's rule).
  `type` is a prop too (default 'button'). `onClick(e)` gets the click, or for a hold the press
  that was held.
- **The size is on the parts** (`--aek-button-font-size`, `--aek-button-height` per size; md 32 px,
  sm 24, lg 40 at the defaults, never under 24 px): `normalize.scss`' unlayered `button {
  font-size: 100%; line-height: 1.15 }` beats a layered rule on the button on the full page (the
  drop-down's finding). The danger variant is the danger colour on a surface with a `danger-soft`
  hover (there's no `on-danger` token for a filled one); a pressed toggle is `accent-soft` with
  an accent border; `link` keeps the 24 px target with no padding.
- **Loading's spinner** is the button's `::after` (the parts at `opacity: 0`, the width kept),
  turning on `kit.scss`' new `aekSpin` (`calc(800ms * var(--aek-motion, 1))`: a still ring at an
  app's `--aek-motion: 0`), pulsing on `aekPulse` under `prefers-reduced-motion`; Phase 7's
  spinner takes the same keyframes.
- **Hold to confirm:** **a fill across the button** (`.aekButton__hold`, `scaleX` over
  `--aek-button-hold-time`, linear), not D10's ring: a ring around a wide, short button reads
  poorly. It starts on a primary `pointerdown` (captured, so a release anywhere ends it), Space or
  Enter (repeats ignored; their default prevented, so they make no click), stays full after it
  acts until the release (`data-holding="confirmed"`), and a release, `pointercancel`, a lost
  capture or a blur before cancels. Every click is ignored, a screen reader's in browse mode too
  (it sends a click with no press): **open for review** whether that's right; the JSDoc, the
  guide and the component library say such a user holds Space in focus mode, and that an app
  offers another way (a dialog). Steps (`steps(4)`) when `getMotionFactor` reads 0 at the press,
  so an app's `--aek-motion: 0` counts, not only the media query. "Hold to confirm" is a `hidden`
  span inside the button that `aria-describedby` names (out of the name, read as the
  description).
- `kbd`: the hint is a Kbd (`aekButton__kbd`, `aria-hidden`) and the button's
  `aria-keyshortcuts` comes from `KeyNames.ts`' new `getAriaKeyShortcuts` (ARIA's `Control`,
  `Meta`, `Alt`, `Space`, `Escape`, `Plus`; alternatives space-separated).
- **`verify:ui`'s runner** (the button box needed it): a box's states are its `.hubButton`s only
  (`BOX_BUTTON`: a kit button drawn in the box is its demo; no box changed), the steps
  `clickInBox` / `focusInBox` (a kit piece in the box) and `keyDown` / `keyUp` (a held key; the
  outline check after them too), and the settle pauses an infinite animation at its start (the
  spinner never ends, which failed the settle; paused, its shot is the same on every run).
- **The Hub's own unlayered `button { color: inherit }` beat the kit** (D5's warning, found by axe:
  the primary label took `--aek-text` on the accent), and its unlayered `:focus-visible` set
  `border-radius` on a focused kit piece. Both now skip `#hudRoot *, .hubDemoKitRoot *`
  (`:not(:where(…))`, so the Hub's own rules keep their specificity), and the kit's layered ring
  and reset take over there.
  That changed the HUD's own buttons in the Hub too (checked: with the committed `_base.scss` the
  window, drop-down and toaster shots match their baselines): the Hub's `font: inherit` had been
  overriding the kit's layered `line-height` and font on them, so each drop-down trigger is now
  1 px shorter (the kit's `--aek-line-height-base`) and the window's and toasts' close buttons and
  a focused element's corners are the kit's. The new shots are the kit's own look.
- **Found, open for review:** in an app, `page.scss`' `normalize.scss` is unlayered too, so its
  `button { font-size: 100%; line-height: 1.15 }` beats every layered kit rule on a button: the
  button works around it (the size on its parts), but the drop-down's trigger takes `1.15` in an
  app and `--aek-line-height-base` in the Hub. Proposed: normalize in a layer below the kit's
  (`aek.page`, named first in `tokens.css`' order statement, so either stylesheet may load
  first), which an app's CSS still beats; then the button's size could go back on the button.
- The component library: a "Button" box in a kit root (`BUTTON_ID` ids, a `role="status"` line
  saying what each did): the variants, the sizes, the icons, Save (`kbd`, loads 1.5 s on a click),
  disabled and loading, two toggles, a hold to confirm. Four keyboard scripts: Enter and Space
  click and Tab goes on; a toggle's `aria-pressed` by Space and Enter; Save's
  `aria-keyshortcuts`, busy with the focus kept, then done; a short Enter does nothing on the hold
  and a held one fills, acts and resets on the release.
- Tests: `Button.test.ts` (9: the element and its id, the icon's side and icon only with its
  tooltip and `setLabel`, the tooltip and the shortcut, the ARIA names, click / loading / disabled,
  the toggle, the hold by pointer, by Space and Enter with repeats and a blur, the removal
  mid-hold with no timer or listener left).
- The section's checks: `yarn test` (171 files, 1405 tests), `tsc` (both), ESLint,
  `yarn hub:build` (971 names, 100 % documented), `yarn sbp --profile all` (every budget within; no
  profile ships the button yet), `verify:baselines` recorded (the three `aekasha/ui` names and
  `getAriaKeyShortcuts`; every bundle unchanged). `yarn verify:ui` (every piece): every keyboard
  script passes, the button's four included, and no violation; to record after review: the
  button's, Kbd's and the glyph's new shots, the window, drop-down and toaster shots above (the
  Hub's rules), and the icons box's two (stale since Phase 5 section 5's new row, never
  re-recorded).
- Docs: the kit's `CLAUDE.md` (Buttons; the styles' importers and the keyframes; the tests),
  `devTools/verify/CLAUDE.md` (the box's Hub buttons, the infinite animation, the new steps),
  `hub/CLAUDE.md` (Hub buttons and kit roots), the UI kit guide (Buttons, the table, the key APIs),
  the component library's text and `COMPONENT_USES`.

As built (section 3, 2026-10-25):

- `components/ButtonGroup.ts`: `createButtonGroup({ label, buttons, exclusive?, orientation?,
  onChange?, class?, attr?, id? })` returns `{ cmp, buttons, getPressedIndex, setPressedIndex }`;
  it takes `createButton` handles and adds them. **An exclusive group always keeps one pressed**
  (a segmented control): a capture `click` on the group stops a press of the pressed button
  before the button flips it, so nothing changes and its `onPressedChange` isn't called; a
  bubble `click` after another button pressed itself releases the rest and calls
  `onChange(index)`. The roving tab stop follows `focusin`, so Tab comes back to the last button
  focused in the toolbar (the APG toolbar), not the pressed one. Disabled buttons are skipped by
  the arrows. A used key is stopped, its keyup swallowed. `orientation` (new: D10 doesn't name it)
  picks the arrows and `aria-orientation`.
- **The joined styles live in `Button.scss`**, after the button's own: both are `:where()` in one
  layer, so between two stylesheets the load order would decide the corners. `ButtonGroup.ts`
  imports `Button.scss` only (it makes no button).
- `components/Link.ts` + `Link.scss`: `createLink({ href, label, external?, appearance?, variant?,
  size?, icon?, tooltip?, onClick?, class?, attr?, id? })` returns `{ cmp, setLabel, setHref }`.
  External by default for an http(s) `href` on another origin than `location`'s (`mailto:` isn't);
  the mark is the kit's own SVG and the hidden text " (opens in a new tab)", both made on the first
  external `href` and moved in and out by `setHref`. As a button it's `aekLink aekButton` with
  `data-variant` / `data-size` (Button.scss styles it; the variants without `link`).
- The Hub's unlayered `a { color }` beat a kit link like `button` did (section 2): it skips the kit
  pieces now too.
- The component library: a "Button group" box (a clipboard group, a view mode toolbar, a vertical
  tool toolbar, a status line) and a "Link" box (a link whose click a handler takes, an external
  one, a link in text, two links as buttons). Scripts: the group's Tab stops; the toolbar's
  arrows, Space, End, wrapping, Tab out and Shift+Tab back to the last focused; the vertical
  one's Up / Down and Enter; a link's Enter; the external link's `target`, `rel` and hidden text.
- Tests: `ButtonGroup.test.ts` (6), `Link.test.ts` (5).
- Docs: the kit's `CLAUDE.md` (Button groups, Links, the importers, the tests), the UI kit guide
  ("Groups and toolbars", "Links", the table, the key APIs), the component library's two texts and
  `COMPONENT_USES`.
- Found in the shots: a line of text inside a demo row (section 1's "Save with" and "Press E", this
  section's link in text) took the row label's style (`.hubComponentDemoGroup > p`: muted, 600,
  smaller). The line class (renamed `hubDemoLine`: the status lines use it too) now overrides it.
  Kbd's and the glyph's new shots change with it (not recorded yet either).
- The section's checks: `yarn test` (173 files, 1416 tests; `buildGuard.test.ts` failed in the Stop
  hook's run beside the background `hub:build` and passes alone, as Phase 5 found), `tsc` (both),
  ESLint, `yarn hub:build` (977 names, 100 % documented), `yarn sbp --profile all` (every budget
  within), `verify:baselines` recorded (the six `aekasha/ui` names; every bundle unchanged).
  `verify:ui --only kbd,inputGlyph,button,buttonGroup,link`: every keyboard script passes, no
  violation; the five boxes' shots are new, to record with `--update` after review.

As built (section 4, 2026-10-25):

- `overlays/Menu.ts` + `Menu.scss`: `createMenu({ anchor, items, label?, side?, align?, onOpen?,
  onClose?, class?, attr?, id? })` returns `{ cmp, open(focus?), close, toggle, isOpen }`, shown
  like the popover (the HUD root, `showAnchored` with `matchAnchorWidth`, a stack entry returning
  the focus to the trigger, an outside press, a focusout). **The item types are a union**
  (`MenuItem`: an action, `type: 'checkbox'`, `type: 'radio'` a whole one-of group with its
  `options` and `onValueChange`, `type: 'group'`, `type: 'separator'`), each type on
  `aekasha/ui`. `items` may be a getter read on every open: the menu keeps no state between
  opens, so a checked state or a value is the app's.
- The keys follow the APG menu button, with three choices made here: **Space flips an on / off item
  or a choice and keeps the menu open** (Enter picks and closes; the APG editor menubar's split),
  **Tab closes it with the focus back on the trigger** (as the drop-down; Tab from a top-layer menu
  in the HUD root would go on from the HUD, not from the trigger), and **a disabled item is
  focusable** (`aria-disabled`, the APG's advice). The items take the real focus (`tabindex="-1"`);
  hovering one focuses it. Typeahead: letters within 500 ms make one search; one letter, or one
  typed again, cycles from the next item.
- **A pick that closes closes first, then runs** its `onSelect` (or `onCheckedChange` /
  `onValueChange` on Enter), so a dialog it opens takes the focus from the trigger and gives it
  back there.
- **A group's visible name is a `::before` from `data-label`**, its `aria-label` the name for
  assistive tech: a heading element inside `role="menu"` would be a child that isn't an item.
  The check marks are CSS shapes (no glyph, no icon to register).
- `components/SplitButton.ts`: `createSplitButton({ label, onClick, items, menuLabel?, variant?,
  size?, icon?, kbd?, disabled?, class?, attr?, id? })` returns `{ cmp, button, menuButton, menu }`.
  Its own group element (`aekButtonGroup aekSplitButton`), not `createButtonGroup`, so its
  `onRemoveCmp` disposes of the menu; the menu button is icon-only with the kit's caret SVG,
  named "More options" by default, and its menu aligned to its end.
- The component library: a "Menu and split button" box (a File menu button: three actions with
  shortcuts and an icon, Autosave, Sort by, a disabled Revert; a split Save with two variants and
  a disabled one; a status line), two states (each menu open) and three scripts (Enter, the
  arrows, End wrapping and Enter picking with the focus back; ArrowUp to the last, a disabled
  item's Enter, typeahead, Space on the checkbox and the radio staying open, Escape; the split
  button's action, Tab, ArrowDown into its menu, Tab out).
- Tests: `Menu.test.ts` (12), `SplitButton.test.ts` (2).
- Docs: the kit's `CLAUDE.md` (Menus in the overlay layer, Split buttons, the importers, the
  tests; the stack's header), the UI kit guide ("Menus and split buttons", the table, the key APIs),
  the component library's text and `COMPONENT_USES`.
- Found in the shots: the labels didn't line up where a menu mixes items with and without a check
  mark or an icon, so an item with either gets `data-leading`, the menu `data-has-leading`, and the
  others keep the column empty (a start padding of the mark's `1em` and the gap); and the split
  button's two halves had no line between them on the primary look (one colour, one border
  colour): the menu button's start border is its text colour at 40 % (`color-mix`).
- The section's checks: `yarn test` (175 files, 1430 tests; `buildGuard.test.ts` failed in the Stop
  hook's run beside the background `hub:build` again and passes alone), `tsc` (both), ESLint,
  `yarn hub:build` (989 names, 100 % documented), `yarn sbp --profile all` (every budget within),
  `verify:baselines` recorded (the twelve `aekasha/ui` names; every bundle unchanged).
  `verify:ui --only menu,button,buttonGroup` (and `menu,buttonGroup` after the two fixes): every
  keyboard script passes, no violation; the menu's three shots are new, to record after review.

As built (section 5, 2026-10-25):

- `components/Badge.ts` + `Badge.scss`: `createBadge({ label, tone?, spokenLabel?, class?, attr?,
  id? })` returns `{ cmp, setLabel(label, spokenLabel?), setTone }`. **`spokenLabel` is new** (D10
  doesn't name it): a count alone ("3") says little, so the label is `aria-hidden` and a visually
  hidden copy says "3 unread" (an `aria-label` on a `span` is prohibited). Not live: an app
  announces a change in its own live region if it should. Sized in `em`, like Kbd. **The tones
  (`BadgeTone`, on `aekasha/ui`) are in `Badge.scss`**, shared with the tag, as `--aek-tone` /
  `--aek-tone-soft` (neutral: `text-muted` on `surface-hover`), which an app may set for a tone of
  its own.
- `components/Tag.ts` + `Tag.scss`: `createTag({ label, tone?, icon?, removable?, onRemove?,
  selectable?, selected?, onSelectedChange?, disabled?, class?, attr?, id? })` returns `{ cmp,
  setLabel, setSelected, isSelected }`. Always a `span.aekTag` (`data-selectable`, `data-selected`,
  `data-removable`); a selectable tag's label is a toggle `button` filling the chip (the whole chip
  is the target) with a CSS check mark when on (not the colour alone); a removable one has a 24 px
  remove `button` named "Remove {label}" with a CSS cross. **The tag removes itself** on its button,
  Backspace or Delete (on either button): the focus goes to the next tag's first focusable (else
  the previous), then the tag is removed and `onRemove` runs (where the app drops it from its
  list). `cmp.remove()` from code doesn't call `onRemove`.
- **The module size check** (D8): only `DraggableWindow.ts` is over 800 lines (860, its header says
  why; next `CMP.ts` 731, `Toaster.ts` 705, `Menu.ts` 482). **Two functions were over the coding
  standards' 150 lines and are split**: `createButton` (181 → 99: `createHoldToConfirm` and
  `appendParts` at module level) and `createMenu` (187 → 144: `createTypeahead`,
  `findTypedEntry`, `getMoveTarget` and `wireTrigger`, and `buildItems` sets the leading column's
  flag); the tests pass unchanged. The next longest: `createTooltip` 123, `createButtonGroup` 100.
- The component library: a "Badge" box (the tones, the Inbox count with "Add a message", a badge in
  a button) and a "Tag" box (the tones, three filter chips, three removable tags, a pinned and a
  disabled one, a status line). Scripts: the count's spoken label and its update; a chip's Space
  and Enter; Delete and Backspace with the focus to the next, then the previous, and Enter on the
  last remove button.
- Tests: `Badge.test.ts` (2), `Tag.test.ts` (5).
- Docs: the kit's `CLAUDE.md` (Badges and tags, the importers, the tests), the UI kit guide ("Badges
  and tags", the table, the key APIs), the component library's two texts and `COMPONENT_USES`.
- **Found by axe: a status colour on its own tint fell short in the light theme** (accent, success,
  warning and danger text on its `-soft` background: under 4.5). `Tokens.test.ts` checks the status
  colours on the four plain surfaces, not on their tints. The badge's and the tag's text is
  `--aek-tone-text`, the tone mixed 30 % toward `--aek-text` (`color-mix`): darker in the light
  theme, lighter in the dark, the hue kept; axe passes in all four settings.

The phase's verification (2026-10-25, at its end): `yarn test` (177 files, 1437 tests), `tsc`
(both), ESLint, `yarn hub:build` (996 names, 100 % documented), `yarn verify:scenes` (104 passed
against Phase 0's baselines), `verify:embed` (all scenarios, both host roots), `yarn sbp --profile
all` (every budget within: no profile ships the new components yet, so every bundle is
unchanged), `verify:baselines` recorded (Phase 6's names on `aekasha/ui`: `createButton`,
`createButtonGroup`, `createLink`, `createMenu`, `createSplitButton`, `createBadge`, `createTag`,
`createKbd`, `createInputGlyph` and their types). `yarn verify:ui`, every piece: every keyboard
script passes (the new pieces' 17 included) and no violation with the allow list empty. Still to
record with `--update` after review: every new box's shots (Kbd, the glyph, the button, the group,
the link, the menu's three, the badge's two, the tag), the window, drop-down and toaster shots that
changed with the Hub's scoped rules (section 2), and the icons box's two (stale since Phase 5
section 5).

For Phase 7:

- The spinner's keyframes are `kit.scss`' `aekSpin` and `aekPulse` (the button's loading mark):
  the spinner turns on them, and its reduced motion pulse is the same rule.
- Open for review from this phase: the hold to confirm ignoring a click with no press (section 2),
  and `normalize.scss` in a layer below the kit's (section 2's finding; the drop-down's trigger
  takes `line-height: 1.15` in an app until then).
- A component drawn in the page goes in a kit root of its own in its box (`addKitRoot`), its text
  lines `hubDemoLine`; the runner's `clickInBox` / `focusInBox` reach it, and an infinite animation
  is paused for the shot (the spinner and the progress bar's indeterminate state need nothing more).
- A tinted background needs its text checked in the light theme (the badge's finding): the
  progress bar's and the empty state's colours by axe in all four settings.

### Phase 7: core components II — feedback — done

D10: Spinner, Progress bar, Skeleton, Divider, Empty state, Loading overlay; the debug scene
loader onto the loading overlay (`_dbg__DebuggerSceneLoader.ts`: its spinner, its fades through
`showAsync` / `hideAsync`). Then the `uiKit` profile's scene grows (D13) and its budgets are set
from `suggestBudget`. The SBP report's "what does a HUD cost" lines (p800 D10: a window, a dialog,
a toast, a button) are noted here for the Hub.

Each section as Phase 6's: the modules with their stylesheet and test on `KitDom`, on `aekasha/ui`
with their types and JSDoc (parts, custom properties, keys, ARIA, an `@example`), the component
library's box (`<piece>-text.md`, `DEMOS`, `COMPONENT_USES`, the checks table), the kit's
`CLAUDE.md` and the UI kit guide; then `yarn test`, `tsc`, ESLint, `yarn hub:build`,
`verify:ui --only <pieces>`, `yarn sbp --profile all` and `verify:baselines` (the new names
recorded).

1. Section 1, the spinner and the progress bar (`components/Spinner.ts`,
   `components/ProgressBar.ts`): first, since the loading overlay draws with both.
2. Section 2, the skeleton, the divider and the empty state (`components/Skeleton.ts`,
   `components/Divider.ts`, `components/EmptyState.ts`; the empty state's action is a
   `createButton`).
3. Section 3, the loading overlay (`components/LoadingOverlay.ts`) and the debug scene loader on
   it (`_dbg__DebuggerSceneLoader.ts`: its module stylesheet goes), with the guide's
   `createSceneLoader` wiring.
4. Section 4, the `uiKit` profile's scene grows (D11's embed checks: a tooltip; D13: the new
   pieces), its budgets from `suggestBudget`, the "what does a HUD cost" lines noted for the Hub;
   then the phase's verification (`verify:scenes` and `verify:embed` too).

Defaults chosen at the phase's start (2026-10-25, for review):

- **Drawn in the page**, as Phase 6's pieces: each box in a kit root of its own (`addKitRoot`), its
  text lines `hubDemoLine`; the loading overlay's box opens one over the HUD's bounds with a Hub
  button, and one over a panel in the box.
- **The spinner** (`createSpinner({ size?, label?, decorative? })` → `{ cmp, setLabel }`): `1em`
  by default (it follows its text, as an icon), `size: 'sm' | 'md' | 'lg'` the icon tokens, and
  `--aek-spinner-size` for any other (the loading overlay's is larger). The ring is the element's
  `::before`, turning on `kit.scss`' `aekSpin` and pulsing on `aekPulse` under reduced motion, as
  the button's mark. Standing alone it's `role="status"` with its label (default 'Loading') in a
  visually hidden copy, so a `setLabel` is read; `decorative: true` makes it `aria-hidden` with no
  role, for a spinner inside something that already says it (the loading overlay's text).
- **The progress bar** (`createProgressBar({ label, value?, min?, max?, segments?, showValue? })`
  → `{ cmp, setValue, getValue, setLabel }`): a `role="progressbar"` element named by its visible
  label (`aria-labelledby`), `aria-valuemin` / `-max` / `-now`; `value: null` (the default) is
  indeterminate (`aria-valuenow` absent). The fill is a `scaleX` (no layout per update, a HUD
  value set every frame). `segments: n` draws n parts, each filled in turn (a health bar at 2.5 of
  5 shows half a part), each part's fill written in place. `showValue` shows the rounded percent
  next to the label. Indeterminate, a bar slides along the track; under reduced motion it's a
  still striped bar. Its colour is `--aek-progress-color` (default the accent), its height
  `--aek-progress-height`.
- **The loading overlay** (section 3): `createLoadingOverlay({ text, progress?, cover? })` →
  `{ cmp, showAsync, hideAsync, setText, setProgress }`. The app adds its `cmp` (the scene loader
  adds `loaderContainerFn`'s). `cover: 'bounds'` (default: `position: fixed`, the HUD's bounds:
  the browser window or a mount's container) or `'parent'` (`position: absolute` in a positioned
  element of the app's). A spinner, or a progress bar when `progress` is given (`null`:
  indeterminate; `setProgress` on a spinner overlay swaps in a bar). `showAsync` / `hideAsync`
  fade it (150 / 250 ms, the debug loader's, times `getMotionFactor`) and resolve `true` after the
  fade, `false` when another call or the removal cut it short, so they're `loadStartFn` and
  `loadEndFn` as they are. Its text is a `role="status"` (a `setText` is read), the spinner
  decorative. Its background is `--aek-loading-overlay-bg` (default `--aek-bg`, opaque: a scene
  swap stays hidden). It stacks at a new `--aek-z-loading` (1000, the debug loader's: above the
  app's windows, below the dialogs). No `inert` and no `aria-busy`: it covers the pointer only (a
  scene load turns the inputs off itself), and `aria-busy` on its parent would mute its own
  status.

As built (section 1, 2026-10-25):

- `components/Spinner.ts` + `Spinner.scss`: `createSpinner({ size?, label?, decorative?, class?,
  attr?, id? })` returns `{ cmp, setLabel }`, as the defaults say. The ring's width is an eighth of
  its size, never under 2 px. `--aek-spinner-color` (new) colours it (default the text colour).
- `components/ProgressBar.ts` + `ProgressBar.scss`: `createProgressBar({ label, hideLabel?, value?,
  min?, max?, segments?, showValue?, class?, attr?, id? })` returns `{ cmp, setValue, getValue,
  setLabel }`. **`hideLabel` is new** (a health bar whose place says what it is): the label stays
  for `aria-labelledby` as an `aekVisuallyHidden` span, and `data-label-hidden` drops the header's
  gap. **The `role="progressbar"` is the track, not the whole piece**: a progressbar's children
  are presentational, so the visible label and the shown percent sit beside it, the percent
  `aria-hidden`. The value is clamped; a non-finite one is indeterminate. The fill's `scaleX` is
  written as an inline `transform` (no layout, testable in linkedom). Segments are the track's own
  parts, each with the control border, joined by `--aek-space-1` gaps; **a segmented bar's
  indeterminate state is always the still stripes** (a sliding bar would cross the gaps).
  `aekProgressSlide` is the progress bar's own keyframes (in its stylesheet: nothing else uses
  them). Custom properties: `--aek-progress-color`, `-track-color`, `-height`, `-radius`.
- The component library: a "Spinner" box (the sizes, one in text marked decorative, the two
  custom properties) and a "Progress bar" box (a download at 40 % with "Add 10 %", an
  indeterminate one, a segmented health bar at 2.5 of 5 in the danger colour with its label
  hidden, a segmented indeterminate one; `.hubDemoProgress` gives a bar its width in a row).
  Scripts (no keys): the spinner's status and label, the decorative one hidden; the track's
  role and values, "Add 10 %" moving it to 50, none while indeterminate, the health bar's range.
  **The indeterminate bar's shot shows an empty track**: the runner pauses an infinite animation
  at its start, where the sliding bar is still off the track's left edge.
- Tests: `Spinner.test.ts` (2), `ProgressBar.test.ts` (3).
- Docs: the kit's `CLAUDE.md` (Spinners and progress bars, the importers, the keyframes, the
  tests), the UI kit guide ("Spinners and progress bars", the table, the key APIs), the component
  library's two texts and `COMPONENT_USES`.
- The section's checks: `yarn test` (179 files, 1442 tests; the `@example` check wanted the
  example's callback typed), `tsc` (both), ESLint, `yarn hub:build` (1002 names, 100 %
  documented), `yarn sbp --profile all` (every budget within; no profile ships the two),
  `verify:baselines` recorded (the six `aekasha/ui` names). **The entry stylesheets' baselines
  grew 85 bytes** in all three builds (`index.css`, `banner.css`, `uiKit.css`): Phase 6 section
  2's `aekSpin` / `aekPulse` keyframes in `kit.scss`, which Phase 6 never recorded ("every bundle
  unchanged" missed the CSS); recorded now. The JS files' bytes are unchanged (their gzip moved
  by a byte or two). `verify:ui --only spinner,progressBar`: both scripts pass, no violation; the
  boxes' shots (the box, "Add 10 %") are new, to record with `--update` after review.

As built (section 2, 2026-10-25):

- `components/Skeleton.ts` + `Skeleton.scss`: `createSkeleton({ shape?, lines?, width?, height?,
  class?, attr?, id? })` returns `{ cmp }`. `shape` is `'lines'` (the default, D10's "lines": three,
  at least one, the last 60 % wide, each `0.75em` tall with `0.6em` between), `'block'` (the
  container's width, `--aek-space-7` × 3 tall) or `'circle'` (`2.5em`, `aspect-ratio: 1`);
  `width` / `height` are CSS lengths written inline. Always `aria-hidden`; **the loading
  container's `aria-busy` is the app's** (the guide and the `@example` set and take it off): the
  skeleton can't know which container is loading. The shimmer is a gradient band
  (`--aek-skeleton-shine`, default the fill mixed 12 % toward the text) moved by
  `background-position` on `aekSkeletonShine` (its own keyframes), none under reduced motion.
- `components/Divider.ts` + `Divider.scss`: `createDivider({ orientation?, decorative?, class?,
  attr?, id? })` returns `{ cmp }`: an `<hr>` across (its own separator role), a `<div>`
  `role="separator"` `aria-orientation="vertical"` down a row, stretched to the row's height (at
  least `1em`). **`decorative` is new** (D10 doesn't name it): `aria-hidden` and no role, for a line
  between things nothing separates. The line is a border in `--aek-border` (decorative: a separator
  isn't a control, so it needs no 3:1), so normalize's unlayered `hr { height: 0 }` agrees with it.
- `components/EmptyState.ts` + `EmptyState.scss`: `createEmptyState({ title, text?, icon?,
  headingLevel?, action?, class?, attr?, id? })` returns `{ cmp, action, setTitle, setText }`. The
  action is `createButton(action)` (the handle's `action`, with `aekEmptyState__action`) added as a
  child CMP, so `cmp.remove()` removes it. **`headingLevel` is new**: the title is a `p` by default
  (a heading would add to the page's outline wherever an empty list shows), `h2`-`h6` where it
  starts a section. The text is `hidden` (as an attribute: linkedom) while empty.
- The component library: a "Skeleton" box (the lines, a block and a circle, a card with
  `aria-busy` whose "Load the content" puts its content in), a "Divider" box (a pause menu's
  column split before Quit, a toolbar's two groups) and an "Empty state" box (one with an icon and
  an action, its click in a status line; one with a title and a text). Scripts: the skeletons
  hidden and the card busy, then loaded; the hr and the vertical separator's role and orientation;
  the empty state's action by Enter.
- Tests: `Skeleton.test.ts` (3), `Divider.test.ts` (2), `EmptyState.test.ts` (2).
- Docs: the kit's `CLAUDE.md` (Skeletons, dividers and empty states, the importers, the tests),
  the UI kit guide ("Skeletons, dividers and empty states", the table, the key APIs), the
  component library's three texts and `COMPONENT_USES`.
- The `@example` check found the divider's `toolbar` variable: a browser global
  (`window.toolbar`), renamed.
- Found in the shots: **the Hub's prose rules beat the kit in the page**, as `button` and `a` did
  in Phase 6: `.hubContent :where(hr)` (a 2.5rem margin around the divider) and `:where(p, ul,
  ol)` (a 1.1rem margin under the empty state's title and text). Every element rule of
  `_prose.scss` now skips the kit's pieces (`:not(:where(…))` with `_base.scss`' `$kit-pieces`,
  which `_prose.scss` `@use`s), so they keep their specificity. And two kit fixes: **a horizontal
  divider stretches itself** (`align-self: stretch`: an empty `hr` in a flex column that doesn't
  stretch shrank to nothing), and **the empty state's icon takes its size as its font size**
  (`getSvgIcon`'s `.aekIcon` is `1em`, which a width on the SVG didn't change; a bare SVG is `1em`
  too).
- The section's checks: `yarn test` (182 files, 1449 tests), `tsc` (both), ESLint, `yarn hub:build`
  (1011 names, 100 % documented), `yarn sbp --profile all` (every budget within; every bundle
  unchanged), `verify:baselines` recorded (the nine `aekasha/ui` names). `yarn verify:ui`, every
  piece (the prose change reaches every kit root in the page): every keyboard script passes and no
  violation; the 11 failed states are all screenshot differences Phase 6 left to record (the
  window's three, the drop-down's three and the toaster's three from Phase 6 section 2's scoped
  rules, the icons box's two from Phase 5); the three new boxes' shots (and "Load the content")
  are new. To record with `--update` after review.

As built (section 3, 2026-10-25):

- `components/LoadingOverlay.ts` + `LoadingOverlay.scss`: `createLoadingOverlay({ text, progress?,
  cover?, fadeInMs?, fadeOutMs?, class?, attr?, id? })` returns `{ cmp, showAsync, hideAsync,
  isShown, setText, setProgress }`, as the defaults say. **`fadeInMs` / `fadeOutMs` and `isShown`
  are new.** It starts hidden (`data-state="hidden"`: `visibility: hidden`); `showAsync` /
  `hideAsync` go through `showing` / `hiding` to `shown` / `hidden`, with the inline
  `transitionDuration` at the time times `getMotionFactor`, **reading the computed opacity first**
  (a scene loader adds its container and calls `loadStartFn` in the same frame: without a style
  read the opacity would start at 1, which the old debug loader got round with a `setTimeout(0)`).
  One timer; a later call or `cmp.remove()` resolves the cut promise `false`, a 0 ms fade resolves
  at once. Hidden or hiding, it lets the pointer through. The progress bar's label is the text,
  hidden (the visible text is the status); the spinner or the bar sits above the text, the bar
  `align-self: stretch` in a column of `--aek-space-7` × 10 at most. In a parent it's at
  `--aek-loading-overlay-z`, default 1.
- **`--aek-z-loading: 1000`** in `tokens.css` (the layers' comment says where it sits), in the
  design document's Layers table by itself (`design.ts` reads every `z-` token) and in the UI kit
  guide's token table. It adds 22 bytes to the entry stylesheets (`index.css`, `banner.css`,
  `uiKit.css`: recorded); every JS file's bytes are unchanged.
- **The debug scene loader** (`_dbg__DebuggerSceneLoader.ts`) is the overlay with a spinner and
  "Loading the scene" (the old one had no text), a new overlay per load, its handle in the
  `createDebuggerSceneLoader` closure; `DebuggerSceneLoader.module.scss` (the old spinner, the
  debugger's grey) is gone. It now follows the system's theme (`--aek-bg`). Checked live on a dev
  server with the Debug tools' start scene saved in `AEK_debugTools` (`exampleQuickStart`, both
  schemes): fixed over the page at z 1000, under the debugger's on-screen tools and stats panels as
  the old one was, removed after the load, no page error.
- The component library: a "Loading overlay" box: an overlay over a panel (`cover: 'parent'`,
  shown at once, its spinner), "Show the progress" (a bar at 60 %), "Hide it", and "Over the
  HUD's bounds" (a bar at 35 % over the viewport; the demo's own click listener hides and removes
  it). Scripts: the status, the decorative spinner, the bar swapped in, the hide; the bounds'
  overlay fixed and shown, gone after a click.
- Tests: `LoadingOverlay.test.ts` (4). **Found by the test**: with `progress` given, the bar went
  above a text not yet in the content; the text is appended first now, and the spinner or bar
  inserted before it.
- Docs: the kit's `CLAUDE.md` (Loading overlays, the dialogs' z note, the importers, the tests),
  the UI kit guide ("Loading overlays" with the `createSceneLoader` wiring and
  `getLoaderStatusUpdater`, the table, the token row, the key APIs), the scenes guide's loader
  paragraph (a link to it), the component library's text and `COMPONENT_USES`.
- The section's checks: `yarn test` (183 files, 1453 tests; `buildGuard.test.ts` failed in the
  Stop hook's run beside the background `hub:build` again and passes alone), `tsc` (both),
  ESLint, `yarn hub:build` (1014 names, 100 % documented), `yarn sbp --profile all` (every budget
  within), `verify:baselines` recorded (the three `aekasha/ui` names, the 22 bytes).
  `verify:ui --only loadingOverlay`: four states and two scripts pass, no violation; the shots are
  new, to record with `--update` after review.

As built (section 4, 2026-10-25):

- **D11's embed checks were already in place**: the tooltip inside the container
  (`UI_KIT_ELEMENTS.tooltip`, Phase 4), the drop-down's list in the top layer, Escape on the host
  page and inside the dialog (Phase 4), and the host head's `<style>` count (Phase 5 section 4).
  So the scene grows by p800 D10's missing piece: **the window's "Hint" is a kit button**
  (`createButton({ label: 'Hint', size: 'sm' })`, its `createTooltip` kept for the check's class).
  The scene's chunk (`assets/uiKitEmbed.js` and `.css`) is now p800 D10's "what does a HUD cost":
  a window, a dialog, a toast and a button, with the drop-down and a tooltip.
- **The budgets from `suggestBudget`** (`sbp.config.ts`): the scene's JS 17 → 19 KiB (17.9 KiB:
  the button's +1.8), its CSS 4 → 6 KiB (4.2 KiB: the button's +1.0). Every other budget of the
  profile already equals `suggestBudget` of today's size (initial 298, the entries 2 / 296 / 3,
  three 261, assets 11, ECS 8, scene 5, `_engine/ui` 6, app 2), so they stay; the comments say so.
  `devTools/sbp/CLAUDE.md` and the kit's `CLAUDE.md` describe the scene's button.
- **Found, open for review: a button brings Kbd.** `Button.ts` (1.3 kB gzip alone) imports
  `Kbd.ts` and `KeyNames.ts` statically for its `kbd` hint (1.2 kB gzip measured alone, about
  0.7 kB of the button's 1.8 in the chunk), which a button without `kbd` doesn't use. Proposed for
  p804 or later, not here: a `kbd` that takes a `createKbd` handle the app makes (the button stays
  free of the key names), or the hint loaded on first use. The `aria-keyshortcuts` names
  (`getAriaKeyShortcuts`) would stay a small import.
- In the app build the `uiKitEmbed` scene's chunk carries the button too (+2.1 kB JS gzip and a new
  1.5 kB stylesheet in `bundle.json`): the app builds every scene, and no other scene uses a kit
  button yet.
- **The poster** (D13: `uiKitEmbed.hub.png`) is Phase 8's, with the `::: embed uiKit` that shows it:
  it's saved from the debug drawer's Hub tab, which needs `OTHER_HUB_SCENES` to list `uiKitEmbed`.

The phase's verification (2026-10-25, at its end): `yarn test` (183 files, 1453 tests;
`buildGuard.test.ts` failed in the Stop hook's runs beside a background build, a `hub:build` or
`verify:embed`'s rebuild of `dist-embed/`, and passes alone: it builds the Hub, which reads the
embed builds), `tsc` (both), `yarn lint`, `yarn hub:build` (1014 names, 100 % documented),
`yarn verify:scenes` (104 passed against Phase 0's baselines), `verify:embed` (every scenario,
both profiles, both host roots), `yarn sbp --profile all` (every budget within), `verify:baselines`
recorded (the bundles: the button in the `uiKit` scene's chunk and the app's). `yarn verify:ui`,
every piece: every keyboard script passes and no violation with the allow list empty; 11 states
fail on screenshots only, all left to record since Phase 6 (the window's, drop-down's and
toaster's three each, the icons box's two). Still to record with `--update` after review: those
11 and every new box's shots of Phases 6 and 7.

For Phase 8:

- The Hub's "what does a HUD cost" line: `{{sbp:uiKit.chunk:assets/uiKitEmbed.js}}` and
  `{{sbp:uiKit.chunk:assets/uiKitEmbed.css}}` (gzip, from the last `yarn sbp` report: 17.9 and
  4.2 KiB today), the window, dialog, toast, button, drop-down and tooltip loaded with the scene,
  over the kit's `{{sbp:uiKit.group:_engine/ui}}` in the initial chunks (the HUD root and CMP).
- `uiKitEmbed.hub.png`, the `uiKit` embed's poster: add `uiKitEmbed` to `OTHER_HUB_SCENES`
  (`app/examples/_dbg__exampleHub.ts`) and save it from the Hub tab, for `::: embed uiKit`.
- The example's scene loader is the loading overlay (D13), as the guide's "Loading overlays" shows.
- Open for review from Phase 7: the button bringing Kbd (above); the indeterminate progress bar's
  shot showing an empty track (the runner pauses its slide at the start); the Hub's prose rules now
  skip the kit's pieces (`_prose.scss`, section 2).
- Still open from Phase 6: the hold to confirm ignoring a click with no press, and `normalize.scss`
  in a layer below the kit's.

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
