Status: stub — not-implemented
Category: Refactoring, Documentation, UI, Input
Epic: p600_whole-codebase-refactoring-and-documentation.md (Stage C)
Blocks: p621_hub-docs-readme-and-claude-md-final.md

# Review: Input, UI Kit and HUD — Stub

**This is a stub.** It fixes the scope, the inputs and the done criteria. Expand it into a full plan (grounding checked against the code, non-breaking phases, the Hub phase, versioning) when its blockers land: its details depend on p602's decisions.

## Goal

Applies p600 §5 (the per-file review standard) and p605's JSDoc style to every file in scope, and records the findings per file group in an "As found" list.

## Scope

- The input devices and p610's action layer (`kernel/input/`, its `CLAUDE.md`; 99 of 122 exports documented after p610, the undocumented ones the devices' older exports).
- **The UI kit** (`ui/`, p602 D5): CMP (1,062 lines), the HUD, DraggableWindow (1,503 lines), DialogWindow, DropDown, Toaster, the icon registry, the styles; documented for app use, with a Hub page showing an app HUD built from it.
- **Aligned with p800** (the debugger UI overhaul, a prompt today): this plan makes the kit usable and documented; p800 restyles it and adds the components that replace Tweakpane.

## Inputs

- p602 D5, p610, the p800 prompt in `docs/templates/todo-plan-prompts.txt`.
- p605 Phase 5's `notExported` warnings in scope (`yarn hub:build` lists each with its file and line; export the type with a summary or change the signature): `icons` (`UI/icons/SvgIcon.ts`, the value `SvgIconKey` is `keyof typeof`).
- p612 Phase 3 (the `perf-auditor` agent over the loop): `KeyboardInput.ts`' `pollHeldKeyBindings`
  allocates once per fixed sub-step and held binding: the `.some` closure and `getChordArray`'s
  `[chord]` array for a single chord.
- p612 Phase 7: `ActionTypes.ts`' `{@link setActionContextEnabled}` (line 37) and
  `{@link createActionMap}` (lines 162, 194) link nowhere (`yarn hub:build` warns): TypeDoc resolves
  a link in the file's scope, and the file doesn't import the names.
- p613 D5 (`DraggableWindow.ts`'s scene-change handling left the scene loader and the boot): the
  windows add their hooks on their first use (`addWindowHooks`, from `getWindows()`' lazy init and
  the three registration functions; never at module load, `ui/DraggableWindow.test.ts`). The scene
  hooks are `loadStart` (the windows flagged to go are removed before the exit hooks and the
  entities they show), `entered` (rebuilt once the scene has entered) and `loadSettled` (a failed
  load: the windows it suspended close); the restore of the saved states is an after-start step
  (`addBootAfterStartHook`, `kernel/init/BootHooks.ts`). A hook added after that step is refused,
  so a window module first used after the boot restores nothing (none in the template). The two
  handlers and the restore are private. Review the hooks with the rest of the file; keep the
  module free of load-time registration.
- p613 Phase 9 (the layout report, `devTools/refactor/layoutReport.md`): its "ui → kernel" now lists
  `ui/DraggableWindow.ts`' runtime imports of `kernel/scene/SceneHooks.ts` (`addSceneHooks`) and
  `kernel/init/BootHooks.ts` (`addBootAfterStartHook`), next to the older `kernel/config/Config.ts`
  and `kernel/loop/MainLoop.ts` (`addResizer`), and its test's three. The target layout
  (`moveMap.ts`) lets `ui` import only `ui`, `utils` and `types`; the report only lists it. Decide whether the UI kit may name the kernel's hooks (it's the
  kit's only way to follow scene loads), or whether they move behind a seam.

## From p611 (2026-10-14)

The embed's seams (p611 Phase 3, D6), each defaulting to the full-page boot's behaviour:

- **The input scope** (`kernel/input/InputState.ts`, `@internal`: `setInputScope`, `InputScope`):
  `WINDOW` (default), `CANVAS` (the pointer and touch on the canvas, `mouseup` on the window; the
  keys on the canvas with `tabindex="0"`, cleared on `blur`; the gamepads read while it has focus),
  `NONE` (no listeners). Each device registers its remover (`addInputListenerRemover`), which
  `removeAllInputListeners()` calls (the mount imports no device). Details: the input `CLAUDE.md`.
  The page-height wheel unit (`Actions.ts`, `deltaMode` 2) still reads `window.innerHeight`.
- **The HUD:** `createHudContainer(slot?)`: the UI kit's root replaces the element it attaches to
  (`CMP`'s `replaceRootDom`, default on; the template's `#guiContainer` is replaced), so a mount
  passes an empty slot in its container, whose `contain: layout` keeps the HUD's fixed elements
  inside it.
- **The UI kit's sizes in an embed:** its `rem`s assume `page.scss`' `html { font-size: 62.5% }`,
  which a mounted engine doesn't load, so a kit component in an embed's HUD is 1.6× its size on a
  page with the default 16px. The review decides (sizes in `em` from the HUD root, or a root font
  size on the HUD).
- **The UI kit in a mount without a HUD** (p611 §7, Phase 5's lite-renderer study): the banner
  embed ships `ui` 13.1 kB before minification (`DraggableWindow.ts` 7.2, `CMP.ts` 4.7, `HUD.ts`
  0.4) though it shows no UI, because `kernel/scene/SceneLoader.ts` imports the windows'
  scene-change handlers (`handleDraggableWindowsOnSceneChange*`) and the HUD root (its loader UI)
  statically. The windows could register their handlers through a scene hook when the first one is
  made, and the loader UI could be the full-page boot's.
  **The windows' part done by p613 D5** (Inputs above): the banner's `ui` group is 5.1 kB (`CMP.ts`
  and `HUD.ts`, which the boot's HUD root and the loader UI keep), its CSS 0.9 kB, and the
  budgets are lowered to match (`sbp.config.ts`: `ui` 7 KiB in both profiles). The loader UI is
  still the loader's.

## Done when

- Every file in scope reviewed against p600 §5, the findings fixed or filed (`docs/issues/` or a plan item).
- JSDoc coverage of the scope's public exports at 100% (p601's `docs.json`), members included; the ratchet raised.
- `yarn test`, `yarn verify:scenes` (snapshots and hashes unchanged unless stated), `yarn verify:baselines` (no unexplained growth), `yarn build`, `yarn hub:build`. The verify commands run for minutes to hours: when one starts, give the watch command, `tail -f .cache/verify/progress.log`.
- The Hub pages of the features in scope checked against the code; CLAUDE.md's nested files for them current.
