**Title:** The on-screen debug tools stay clickable during a scene load, while the drawer and the debug keys don't

Status: open
Category: Debug, UI
Found: 2026-10-21, p618 Phase 4 (H2: the `@TODO` in `_dbg__DebuggerGUI.ts`' `_disableDebugger`)
Our workaround: none needed in practice; wait for a load to finish before using the on-screen tools

## What happens

A scene load (`loadScene`, `kernel/scene/SceneLoader.ts`) turns the debugger off for its length:
`disableDebugger(true)` dims the drawer and makes it click-through (`styles.debuggerDisabled`),
and the debug keys stop, since their action maps don't run during a load. The on-screen tools
(`debug/_dbg__OnScreenTools.ts`: the scene and camera drop-downs, the undo / redo buttons, the
view switch, the play buttons) stay as they are, so they can be clicked mid-load.

Most of it is harmless: a scene picked from the drop-down queues behind the running load
(`loadScene` runs one load at a time, p613 D3). Plausible, not reproduced:

- The undo / redo buttons apply a `perScene` entry's handler while the previous scene is being
  torn down or the next one built, against entities that are going away or not there yet. The
  undo keys can't, since they stop with the other debug keys.
- The view switch enters an editor view mid-load. Views suspend a scene that exists, and one
  loaded meanwhile is suspended as soon as it exists (`Views.ts`), so this is likely fine, but it
  isn't tested.

## A way out

`_disableDebugger` also disables the on-screen tools (a class on their row, as the "Disable
on-screen tools" option sets, `_applyOnScreenToolsDisabled`), or each button checks
`isCurrentlyLoading()` (`SceneLoader.ts`) on click. Either is small; p800 replaces the on-screen
tools' UI, so it can also land there.
