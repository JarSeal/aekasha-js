**Title:** The test bridge's `focusDebuggerControl` focuses the next control for a property grid button in a labelled row

Status: fixed | 2026-11-22, `findLabelledControls` gives a label inside a control that control, so a labelled row's button is focused by its own text
Category: Debugger, Test bridge
Found: 2026-11-20, p310 Phase 3 section 3 (the showcase's rain shower cycle, a `.cache/look/` script)
Our workaround: click the button found by its text in the page (Playwright's `getByRole('button', { name: /Rain shower/ })`), or pass the name the button is announced by: its row's label, a space and its text

## What happens

`focusDebuggerControl({ name: 'Rain shower' })` on the showcase's Weather section focused the button after it in the pane, Dry, and reported `FOCUSED`. The script pressed it, so the first two runs of the cycle dried the blocks instead of raining on them.

The property grid names a button in a row with a label by both: `PropertyGridItems.ts` sets its `aria-labelledby` to the row's label and the button itself, so its accessible name is "<row label> Rain shower". `getControlName` (`src/_engine/debug/_dbg__TestBridgeDebugger.ts`) reads that, so no control matches the name exactly, and `focusDebuggerControl` falls back to `findLabelledControls`: an element whose text is the name labels the first control at or after it in its row. The element whose text is "Rain shower" is the leaf element holding the button's text, inside the button. `findControlAfter` takes a control the label contains or one that follows it in document order, never the control that contains the label, so it returns the next button.

## The fix

In `findLabelledControls`, a label inside a control names that control (`el.closest(CONTROL_SELECTOR)` first, before the row walk). A test beside the bridge's other debugger checks: a property grid with a labelled button row and a button after it, focused by the first one's text. The result's types don't change, so `TEST_BRIDGE_VERSION` stays.

Done as above (`debug/_dbg__TestBridgeDebugger.ts`): a label's control inside the root (a label
outside one walks its row as before), and the test is the bridge's first unit test,
`debug/_dbg__TestBridgeDebugger.test.ts`, not in `devTools/verify/debuggerChecks.test.ts`, which
has no DOM. It runs on the kit's linkedom page (`stubKitDomAsync`), whose `Node` has no position
flags and whose `compareDocumentPosition` reads an element in another branch as preceding, so the
test gives elements the DOM's order: with it, the old code focused Dry, as in the browser. The
same test checks that the row's label (`Weather`) and the whole name (`Weather Rain shower`) still
focus the button.
