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

## Done when

- Every file in scope reviewed against p600 §5, the findings fixed or filed (`docs/issues/` or a plan item).
- JSDoc coverage of the scope's public exports at 100% (p601's `docs.json`), members included; the ratchet raised.
- `yarn test`, `yarn verify:scenes` (snapshots and hashes unchanged unless stated), `yarn verify:baselines` (no unexplained growth), `yarn build`, `yarn hub:build`. The verify commands run for minutes to hours: when one starts, give the watch command, `tail -f .cache/verify/progress.log`.
- The Hub pages of the features in scope checked against the code; CLAUDE.md's nested files for them current.
