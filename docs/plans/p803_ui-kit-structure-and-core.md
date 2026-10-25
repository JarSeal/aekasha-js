Status: draft | not-implemented
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
  `:where(.aekUi) :where(button, input, select, textarea) { font: inherit; color: inherit; }`. That
  fixes the buttons' font and the toast's colour coming from the host (1.2's item 6). The debugger
  sits under the HUD root and gets it too. Its stylesheets set their own sizes, and Phase 0
  confirms that on the scene runner's screenshots.
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
  anchor helper subtracts the bounds' position as the windows do.
- **Modal dialogs don't use `<dialog>.showModal()`** (p800 D8 and §8's open question). It makes
  the whole document inert (a host page in an embed) and puts the dialog and its backdrop in the
  top layer, which ignores the mount's `contain: layout`, so the backdrop would cover the host
  page (p801 D9's check). Instead, a dialog keeps the window code and gets:
  - `role="dialog"` (or `"alertdialog"` with `alert: true`), `aria-modal="true"`, and
    `aria-labelledby` its title;
  - a focus trap (`FocusTrap.ts`: Tab and Shift+Tab wrap inside it), focus to its first focusable
    element or its `initialFocus`, and focus back to the opener on close;
  - `inert` on the HUD root's other children while it's open (never on anything outside the
    HUD root), restored on close. A second modal makes the first inert too.
- **z-order** (p801 D2's open item): modal dialogs leave the window stacks and stack from
  `--aek-z-dialog` in open order, above the debug windows. Toasts sit at `--aek-z-toast`. The
  windows' JS bases stay (`Z_INDEX_BASES`), and a test checks they equal the tokens' values.
- **Anchored positioning** (`Anchor.ts`, our own, about 1 KiB; floating-ui would be about 3 KiB
  gzip for more than we need): place an element at a side of an anchor rect, flip to the other
  side when it doesn't fit, shift along the side to stay inside the bounds (`getWindowSize`: the
  container in an embed), and give it `max-height` / `max-width` from the space left. That
  replaces the drop-down list's `40vh` (1.2's item 6). It repositions on scroll and resize while
  open, read in one `requestAnimationFrame`.
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
- **A key to cycle windows** (p800 D8): it focuses the next open window's first focusable element
  and brings that window to the front, in z-order, app windows and then debug windows. Phase 0
  checks which keys the browsers deliver to a page. The candidates are F6 (the platform's "next
  pane", but Chrome and Firefox may keep it for their address bar) and Alt+\` (no browser or OS
  binding we know of on Windows and macOS). The key is a kit setting (`setWindowCycleKey`),
  `null` turns it off, and the listener is on the HUD root like D7's.
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
  setup becomes one shared helper, if the structural tests allow a non-test module that imports
  `vitest` (Phase 0 checks `ModuleLoad.test.ts` and the layout rules). Otherwise each test keeps
  its copy.
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
  restore). It also warns that the kit is now layered, so an app's broad unlayered rules beat it.
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

### Phase 0: baselines and checks

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

### Phase 1: the move and the names (no behaviour change)

1. Section 1, the move (D2): the folders, `git mv`, the scratchpad import rewrite, the per-folder
   layout rules, the Hub's stand-in paths, every doc path. `yarn test`, `tsc`, `yarn hub:build`
   and the scene runner pass unchanged, and `verify:baselines`' bundle baseline moves only by
   module paths.
2. Section 2, the names (D3): the new types, the deprecated aliases, the engine's, app's and Hub's
   imports switched; the API baseline updated; p622's and p800 D12's lists updated.

### Phase 2: the kit without the boot

D4: `createHudRoot`, `hasHudRoot`, `KIT_ROOT_CLASS`, `kit.scss` imported by the kit,
`onBoundsResize` in place of `addResizer` (`UI_KERNEL_HOOKS` and the layout docs follow),
`getMotionFactor` public, `color-scheme` in the theme blocks, D6's forced dark theme on the
debugger's roots. The Hub's `MainLoop.ts` stand-in and the two deep imports go, and
`devTools/hub/scripts.test.ts` checks the component library's chunk has no engine kernel module.
Verify: `verify:embed`'s shrink check (the windows' clamp on the new resize source) and the
component library page by eye.

### Phase 3: `yarn verify:ui`

D11's command over the component library page as it is (still dev-only until Phase 8: it runs
against the dev Hub's URL, or a `dev`-mode `hub:build`): axe-core, the keyboard script format, the
screenshots, the progress log. The existing pieces' violations are recorded here as the list
Phases 4-6 empty (the command takes a `--allow <rule@piece>` list while that list isn't empty,
and the plan records each entry).

### Phase 4: the overlay layer

D7: `OverlayStack.ts`, `FocusTrap.ts`, `Anchor.ts`, the top layer with its fallback; the dialog's
Escape moved onto the stack (its window listeners go); the drop-down list moved onto the layer
and the anchor (no `40vh`, no clipping in a window, the ring on the active option); then
`Tooltip.ts` and `Popover.ts`. Tests: Escape closing only the innermost overlay, focus returning,
`inert` set and restored, the anchor's flip and shift (pure functions, in Node). Verify: the
embed scenario's new checks (D11).

### Phase 5: the existing pieces restyled and accessible

One section per piece, each with its demo boxes' screenshots in both themes for review and
`verify:ui` clean for it:

1. The windows (D5, D8): global classes and parts, the tokens, layered; `role="dialog"`, labels,
   the keyboard move and resize, the cycle key, the header's line height and the title's
   truncation; `DraggableWindowKeys.ts`.
2. The dialogs (D7): modal ARIA, the trap, `inert`, the z-order from `--aek-z-dialog`, `alert`.
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
- **Keyboard move and the cycle key** may collide with an app's key bindings: they only act with
  focus inside the HUD (D7's listener), and the cycle key can be set to `null`.
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
