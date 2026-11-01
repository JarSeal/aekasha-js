**Title:** An app's action map takes Enter (or any key it binds) from a focused debugger control

Status: fixed | 2026-10-29, p806 (D12, Phase 2 section 4)
Category: Debug, Input, Accessibility
Found: 2026-10-29, p806 Phase 1 section 1 (the scene runner's `debugger` configuration)
Our workaround (until p806 Phase 2 section 4): click the control; the scene runner's character
state opener clicked (its `clickReason`, gone with the fix)

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

## The fix (p806 Phase 2 section 4)

A key whose keydown goes to an element in a debugger root is the debugger's
(`kernel/input/KeyboardInput.ts`' `isKeyEventOnDebugger`, folded away in a production build):

- The app's input doesn't see it: an action map outside the `DEBUG` context neither counts it,
  calls back, nor prevents its default (`Actions.ts`), and a key binding that isn't a debug key
  doesn't fire (`KeyboardInput.ts`). So Enter and Space click the focused button, and the player
  doesn't jump.
- It stays the debugger's until its keyup, wherever the focus is then: an app's map doesn't read it
  held meanwhile (a `KEY_HELD` binding neither), so a later event or sample doesn't turn it into a
  press.
- The `DEBUG` maps (the debug keys) see it as before: F7 or `h` works with the focus on a debugger
  control. A key the app already held stays the app's (its repeats going to a control clicked
  meanwhile).
- A press on an on-screen tool doesn't move the focus (the tools' rows prevent the default of the
  mousedown), so the app's keys go on working after a click on one; the keys reach the tools by
  Tab. A click on another debugger control (the drawer) focuses it, as a click on a text field
  does, until the canvas or the page is clicked.

Tests: `Actions.test.ts` and `KeyboardInput.test.ts` ("a debugger control's keys"). The scene
runner's character state opener presses Enter again.

Found on the way: a text field outside the debugger (an app's) isn't treated the same way. An
action map leaves a key typed there its default, but still counts it, so typing in it can move a
player: the premise above ("a text field's typing doesn't move the player") was wrong. That's the
app's case, unchanged here.
