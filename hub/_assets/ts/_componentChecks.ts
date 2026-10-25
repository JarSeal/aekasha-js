/**
 * The component library's checks (`yarn verify:ui`, p803 D11), next to its demos
 * (`_components.ts`, whose `DEMOS` keys these are). The runner opens every Hub button of a demo
 * box as a state of its own (on its own page load, in both themes and both densities) and runs
 * axe-core over the box and the HUD root; a demo lists here only the states a button alone
 * doesn't open, and its keyboard scripts. Plain data: no page imports it, and it imports nothing.
 *
 * A keyboard script is what a keyboard user does and sees, step by step: what's true of the
 * piece today. A phase that adds a key or fixes one (Escape, focus return, F6) adds or changes
 * the steps with it. After each key pressed, the focused element (other than the body) must show
 * an outline.
 */

/** A step that opens a state: a button in the demo box by its text, or an element in the HUD root */
export type UiCheckStep =
  /** The demo box's button whose text is this, exactly */
  | { click: string }
  /** The first element in the HUD root matching this selector */
  | { clickHud: string };

/**
 * A keyboard script's step. Selectors are the page's (`#hudRoot …` for the kit's). Each `expect*`
 * waits up to 3 s for its state (a close may animate), and the script stops at the first one that
 * doesn't come.
 */
export type UiKeyStep =
  | UiCheckStep
  /** Focuses the first element in the HUD root matching this selector, as a script would (a
   * piece no key reaches yet: F6 does from p803 Phase 5) */
  | { focusHud: string }
  /** Focuses the demo box's button whose text is this, exactly, without a click (the focus
   * outside the HUD root: an embed's host page) */
  | { focusBox: string }
  /** Presses a key or a chord, in Playwright's names (`Tab`, `Shift+Tab`, `ArrowDown`, `Escape`) */
  | { press: string }
  /** The focused element matches this selector (`body`: nothing focused) */
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
  /** The option the focused element's `aria-activedescendant` names has this text, trimmed */
  | { expectActiveOption: string };

/** A state that needs more than a button: its name in the runner's output, and its steps */
export type UiCheckState = { name: string; steps: UiCheckStep[] };

/** A keyboard script: its name in the runner's output, and its steps */
export type UiKeyScript = { name: string; steps: UiKeyStep[] };

/** A demo's checks beyond its buttons */
export type UiDemoChecks = { states?: UiCheckState[]; keyboard?: UiKeyScript[] };

const WINDOW = '#hudRoot #hubDemoWindow';
const LIST = '#hudRoot .aekDropDownList';
const TRIGGER = '#hudRoot .aekDropDownTrigger';
const DIALOG = (index: number) => `#hudRoot #hubDemoDialog${index}`;
const TOOLTIP = '#hudRoot .aekTooltip';
const POPOVER = '#hudRoot .aekPopover';
const POPOVER_TRIGGER = '#hubDemoPopoverTrigger';

export const UI_DEMO_CHECKS: Record<string, UiDemoChecks> = {
  window: {
    keyboard: [
      {
        name: 'collapse, expand and close by the header’s buttons',
        steps: [
          { click: 'Default' },
          { focusHud: '#hubDemoWindow button[title="Collapse / Expand"]' },
          { press: 'Enter' },
          { expectCount: `${WINDOW}[class*="collapsed"]`, count: 1 },
          { press: 'Space' },
          { expectCount: `${WINDOW}[class*="collapsed"]`, count: 0 },
          { press: 'Tab' },
          { expectFocus: `${WINDOW} button[title="Close"]` },
          { press: 'Enter' },
          { expectCount: WINDOW, count: 0 },
        ],
      },
    ],
  },
  dialog: {
    states: [
      {
        name: 'with a drop-down, its list open',
        steps: [{ click: 'With a drop-down' }, { clickHud: '.aekDropDownTrigger' }],
      },
    ],
    keyboard: [
      {
        name: 'Escape in a closeOnEscape dialog closes it; the focus goes back to its opener',
        steps: [
          { click: 'Closes on Escape' },
          { expectFocus: `${DIALOG(1)} *` },
          { press: 'Escape' },
          { expectCount: DIALOG(1), count: 0 },
          { expectFocusBox: 'Closes on Escape' },
        ],
      },
      {
        name: 'Escape outside the HUD leaves a closeOnEscape dialog open',
        steps: [
          { click: 'Closes on Escape' },
          { focusBox: 'Closes on Escape' },
          { press: 'Escape' },
          { expectCount: DIALOG(1), count: 1 },
        ],
      },
      {
        name: 'Escape leaves a default dialog open; its button closes it',
        steps: [
          { click: 'Default' },
          { expectFocus: `${DIALOG(0)} *` },
          { press: 'Escape' },
          { expectCount: DIALOG(0), count: 1 },
          { focusHud: '#hubDemoDialog0 .hubButton' },
          { press: 'Enter' },
          { expectCount: DIALOG(0), count: 0 },
          { expectFocusBox: 'Default' },
        ],
      },
      {
        name: 'Escape in its open list closes the list, the next one the dialog',
        steps: [
          { click: 'With a drop-down' },
          { focusHud: '#hubDemoDialog3 .aekDropDownTrigger' },
          { press: 'Enter' },
          { expectFocus: LIST },
          { press: 'Escape' },
          { expectCount: LIST, count: 0 },
          { expectCount: DIALOG(3), count: 1 },
          { expectFocus: `${DIALOG(3)} .aekDropDownTrigger` },
          { press: 'Escape' },
          { expectCount: DIALOG(3), count: 0 },
          { expectFocusBox: 'With a drop-down' },
        ],
      },
    ],
  },
  dropDown: {
    states: [
      {
        name: 'a list open',
        steps: [{ click: 'Open the drop-downs' }, { clickHud: '.aekDropDownTrigger' }],
      },
    ],
    keyboard: [
      {
        name: 'Enter opens the list, the arrows, Home and End move, Enter picks and returns the focus',
        steps: [
          { click: 'Open the drop-downs' },
          { focusHud: '.aekDropDownTrigger' },
          { press: 'Enter' },
          { expectAttr: TRIGGER, name: 'aria-expanded', value: 'true' },
          { expectFocus: LIST },
          { expectActiveOption: 'Orange' },
          { press: 'ArrowDown' },
          { expectActiveOption: 'Teal' },
          { press: 'End' },
          { expectActiveOption: 'Violet' },
          { press: 'Home' },
          { expectActiveOption: 'Orange' },
          { press: 'ArrowDown' },
          { press: 'Enter' },
          { expectCount: LIST, count: 0 },
          { expectAttr: TRIGGER, name: 'aria-expanded', value: 'false' },
          { expectText: `${TRIGGER} .aekDropDownLabel`, text: 'Teal' },
          { expectFocus: TRIGGER },
        ],
      },
      {
        name: 'Escape closes the list without a change; the focus goes back to the trigger',
        steps: [
          { click: 'Open the drop-downs' },
          { focusHud: '.aekDropDownTrigger' },
          { press: 'Space' },
          { expectFocus: LIST },
          { press: 'ArrowDown' },
          { press: 'Escape' },
          { expectCount: LIST, count: 0 },
          { expectText: `${TRIGGER} .aekDropDownLabel`, text: 'Orange' },
          { expectFocus: TRIGGER },
        ],
      },
    ],
  },
  tooltip: {
    keyboard: [
      {
        name: 'Tab shows the focused button’s tooltip at once; Escape hides it, not the window',
        steps: [
          { click: 'Open the tooltips' },
          { focusHud: '#hubDemoTooltips .hubButton' },
          { press: 'Tab' },
          { expectCount: TOOLTIP, count: 1 },
          { expectText: TOOLTIP, text: 'Left' },
          { press: 'Escape' },
          { expectCount: TOOLTIP, count: 0 },
          { expectCount: '#hudRoot #hubDemoTooltips', count: 1 },
          { press: 'Tab' },
          { expectText: TOOLTIP, text: 'Right' },
        ],
      },
    ],
  },
  popover: {
    states: [
      {
        name: 'open',
        steps: [{ click: 'Open the popover window' }, { clickHud: POPOVER_TRIGGER }],
      },
    ],
    keyboard: [
      {
        name: 'Enter opens it with the focus in; Escape closes it, the focus back on the trigger',
        steps: [
          { click: 'Open the popover window' },
          { focusHud: POPOVER_TRIGGER },
          { press: 'Enter' },
          { expectAttr: `#hudRoot ${POPOVER_TRIGGER}`, name: 'aria-expanded', value: 'true' },
          { expectFocus: `${POPOVER} .hubButton` },
          { press: 'Tab' },
          { expectText: `${POPOVER} .hubButton:focus`, text: 'Reset' },
          { press: 'Escape' },
          { expectCount: POPOVER, count: 0 },
          { expectFocus: `#hudRoot ${POPOVER_TRIGGER}` },
          { expectAttr: `#hudRoot ${POPOVER_TRIGGER}`, name: 'aria-expanded', value: 'false' },
        ],
      },
    ],
  },
  toaster: {
    keyboard: [
      {
        name: 'a closable toast’s button closes it',
        steps: [
          { click: 'Until closed' },
          { expectCount: '#hudRoot .toast', count: 1 },
          { focusHud: '.toast .toastCloseBtn' },
          { press: 'Enter' },
          { expectCount: '#hudRoot .toast', count: 0 },
        ],
      },
    ],
  },
};
