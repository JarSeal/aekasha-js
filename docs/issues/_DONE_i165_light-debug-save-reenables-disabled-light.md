**Title:** Saving a light's helper or symbol in the debugger saves `enabled: true` too: a light created disabled comes back enabled after a reload

Status: fixed | p355 Phase 5
Category: Debugger, Lights
Found: 2026-11-24, p150 Phase 2 (the edit window's "Local storage override" row read "Active: enabled" after a helper toggle)
Our workaround: after toggling a disabled light's helper or symbol, or the Lights tab's global helpers, use its edit window's "Clear local storage"

## What happens

A light's saved debugger entry (`AEK_debugLights`, per scene and app id) holds both its value
overrides and the debugger's own preferences (helper and symbol visibility, the shadow folders'
open states). The first save for a light creates its entry with defaults, and they include
`enabled: true`:

- `saveLightToLS` (`kernel/light/debug/_dbg__LightDebugState.ts`): `{ enabled: true, helperVisible: false, symbolVisible: true }`, then the saved key. The edit window's "Show helper" and "Show symbol" toggles and its folders save through it.
- `setLightDebugPreference` (the same module): the same defaults.
- `_toggleAllLightHelpers` (the Lights tab's global helpers toggle): an entry with `enabled: true` for every light with a fixed app id that has none.

`createLightEntity` (`kernel/light/Light.ts`) merges the whole entry over the creation props
(`loadPersistentProps`), so `enabled: true` replaces the JSON's or the code's `enabled: false`, and
the light is created enabled on the next load. Only a cosmetic toggle was made, and nothing in the
edit window says the light's state was saved.

Debug env only today; p150 Phase 3 reads the overrides in prod test mode too.

No app light is created with `enabled: false` today, so no scene shows it yet.

## A way out

- Leave `enabled` out of a new entry's defaults: a missing key already means "not overridden"
  (`loadPersistentProps` spreads only what's there), and the Enabled toggle saves it when it's
  changed. `getLightDebugVisibilityPref` reads `helperVisible` and `symbolVisible` with their own
  defaults, so they can go from the defaults too.
- Check the other readers of `LightEntityDebugState.enabled` first (it's typed required), and an
  entry saved before the fix: it keeps its `enabled: true` until it's cleared.

## Fixed

p355 Phase 5 (the lights' save source needs it: a record's `enabled` is saved into the light's
JSON): `saveLightToLS`, `setLightDebugPreference` and `_toggleAllLightHelpers` start a new record
with `helperVisible` and `symbolVisible` only, and `LightEntityDebugState.enabled` is optional, set
only by the Enabled toggle. `helperVisible` and `symbolVisible` stay in the defaults: with a record
there, `getLightDebugVisibilityPref` reads `helperVisible` as false when it's missing. A record
saved before the fix keeps its `enabled: true` until it's cleared (no app light is created
disabled). Test: `_dbg__LightEditWindow.test.ts`' "where its values come from".
