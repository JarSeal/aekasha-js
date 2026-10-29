**Title:** An app's action map takes Enter (or any key it binds) from a focused debugger control

Status: open
Category: Debug, Input, Accessibility
Found: 2026-10-29, p806 Phase 1 section 1 (the scene runner's `debugger` configuration)
Our workaround: click the control; the scene runner's character state opener clicks
(`clickReason` in `devTools/verify/scenes.config.ts`)

## What happens

In `thirdPersonGymScene`, Enter on a focused debugger button does nothing: the character edit
window's "Open character state window" button, focused by Tab, doesn't open the window. The
scene's player action map binds Enter to jump (`thirdPersonGymScene.ts`), and an action map
prevents the default of its keys' keydowns outside a text field (`kernel/input/`, the debug
`CLAUDE.md`'s debug keys). A native button's click on Enter (and on Space) is that default, so it
never comes. Any key an app's map binds is lost the same way on any focused control of the
debugger: a toggle, a select, a list row.

The pointer works, so the debugger looks fine until it's used by keyboard, which p806 D12 asks
for (every control reachable and usable by keys).

## A way out

An action map leaves a key's default alone when the focus is on a control inside a debugger root
(`DEBUGGER_ROOT_ATTR`, `ui/overlays/OverlayStack.ts`), as it does in a text field. Whether the
action still runs then (the player jumps while the user presses a debugger button) is the same
question: most likely it shouldn't, as a text field's typing doesn't move the player. p806 Phase
2's on-screen tools section (D7, D12) settles it and closes this file, and the scene runner's
opener then presses Enter again (its `clickReason` goes).
