/**
 * The component library's checks (`yarn verify:ui`, p803 D11), next to its demos
 * (`_components.ts`, whose `DEMOS` keys these are). The runner opens every Hub button of a demo
 * box (`.hubButton`, the page's own: a kit button drawn in the box is the demo) as a state of its own (on its own page load, in both themes and both densities) and runs
 * axe-core over the box and the HUD root; a demo lists here only the states a button alone
 * doesn't open, and its keyboard scripts. Plain data: no page imports it, and it imports only its
 * group modules.
 *
 * A keyboard script is what a keyboard user does and sees, step by step: what's true of the
 * piece today. A phase that adds a key or fixes one (Escape, focus return, F6) adds or changes
 * the steps with it. After each key pressed, the focused element (other than the body) must show
 * an outline.
 *
 * The checks are in `_library/`, a module per group next to its demos' (`coreChecks.ts` beside
 * `core.ts`), plain data too; this holds the types and merges them.
 */
import { CONTAINERS_CHECKS } from './_library/containersChecks';
import { CORE_CHECKS } from './_library/coreChecks';
import { DATA_CHECKS } from './_library/dataChecks';
import { EDITORS_CHECKS } from './_library/editorsChecks';
import { FIELDS_CHECKS } from './_library/fieldsChecks';
import { GRAPHS_CHECKS } from './_library/graphsChecks';
import { LAYOUT_CHECKS } from './_library/layoutChecks';
import { OVERLAYS_CHECKS } from './_library/overlaysChecks';

/** A step that opens a state: a Hub button in the demo box by its text, an element in the HUD
 * root, or a kit element drawn in the box */
export type UiCheckStep =
  /** The demo box's Hub button (`.hubButton`) whose text is this, exactly */
  | { click: string }
  /** The first element in the HUD root matching this selector */
  | { clickHud: string }
  /** The first element in the demo box matching this selector (a kit button drawn in the page) */
  | { clickInBox: string }
  /** A right click on the first element in the demo box matching this selector (a context menu,
   * p805 D11: the browser's own `contextmenu` event) */
  | { contextClickInBox: string };

/**
 * A keyboard script's step. Selectors are the page's (`#hudRoot …` for the kit's). Each `expect*`
 * waits up to 3 s for its state (a close may animate), and the script stops at the first one that
 * doesn't come.
 */
export type UiKeyStep =
  | UiCheckStep
  /** Focuses the first element in the HUD root matching this selector, as a script would (a
   * window's part F6 doesn't land on) */
  | { focusHud: string }
  /** Focuses the demo box's Hub button whose text is this, exactly, without a click (the focus
   * outside the HUD root: an embed's host page) */
  | { focusBox: string }
  /** Focuses the first element in the demo box matching this selector, as a script would (a kit
   * piece drawn in the page) */
  | { focusInBox: string }
  /** Presses a key or a chord, in Playwright's names (`Tab`, `Shift+Tab`, `ArrowDown`, `Escape`) */
  | { press: string }
  /** Holds a key down until a `keyUp` of it (a hold to confirm), in Playwright's names */
  | { keyDown: string }
  /** Releases a key a `keyDown` held */
  | { keyUp: string }
  /** The focused element matches this selector (`body`: nothing focused); in an open shadow root,
   * the element focused there (a colour picker's `[part="saturation"]`) */
  | { expectFocus: string }
  /** The focused element is the demo box's button whose text is this, exactly (an overlay's
   * opener, which its close gives the focus back to) */
  | { expectFocusBox: string }
  /** The first element matching `expectAttr` has the attribute `name` at `value` (null: absent) */
  | { expectAttr: string; name: string; value: string | null }
  /** This many elements match the selector (0: none, e.g. a closed window) */
  | { expectCount: string; count: number }
  /** The first element matching `expectText` has this text, trimmed */
  | { expectText: string; text: string }
  /** The first element matching `expectValue` (an input, a textarea) has this `value`, as is */
  | { expectValue: string; value: string }
  /** The first element matching `expectStyle` has the computed style property `name` (CSS's name:
   * `left`, `border-top-width`) at `value` (a used length in px: `576px`) */
  | { expectStyle: string; name: string; value: string }
  /** The option the focused element's `aria-activedescendant` names has this text, trimmed */
  | { expectActiveOption: string };

/** A state that needs more than a button: its name in the runner's output, and its steps */
export type UiCheckState = { name: string; steps: UiCheckStep[] };

/** A keyboard script: its name in the runner's output, and its steps */
export type UiKeyScript = { name: string; steps: UiKeyStep[] };

/** A demo's checks beyond its buttons */
export type UiDemoChecks = {
  states?: UiCheckState[];
  keyboard?: UiKeyScript[];
  /** Where in its duration (0-1) the settle pauses an infinite animation for the shot (a spinner,
   * the indeterminate bar's slide): default 0.4 (`ui.ts`' `DEFAULT_PAUSE_AT`), where both show */
  pauseAt?: number;
};

/** Every demo's checks by its key (`_components.ts`' `DEMOS`) */
export const UI_DEMO_CHECKS: Record<string, UiDemoChecks> = {
  ...CORE_CHECKS,
  ...LAYOUT_CHECKS,
  ...OVERLAYS_CHECKS,
  ...FIELDS_CHECKS,
  ...EDITORS_CHECKS,
  ...CONTAINERS_CHECKS,
  ...DATA_CHECKS,
  ...GRAPHS_CHECKS,
};
