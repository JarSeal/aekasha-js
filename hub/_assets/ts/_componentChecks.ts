/**
 * The component library's checks (`yarn verify:ui`, p803 D11), next to its demos
 * (`_components.ts`, whose `DEMOS` keys these are). The runner opens every Hub button of a demo
 * box as a state of its own (on its own page load, in both themes and both densities) and runs
 * axe-core over the box and the HUD root; a demo lists here only the states a button alone
 * doesn't open. Plain data: no page imports it, and it imports nothing.
 */

/** A step of a state: a button in the demo box by its text, or an element in the HUD root */
export type UiCheckStep =
  /** The demo box's button whose text is this, exactly */
  | { click: string }
  /** The first element in the HUD root matching this selector */
  | { clickHud: string };

/** A state that needs more than a button: its name in the runner's output, and its steps */
export type UiCheckState = { name: string; steps: UiCheckStep[] };

/** A demo's checks beyond its buttons */
export type UiDemoChecks = { states?: UiCheckState[] };

export const UI_DEMO_CHECKS: Record<string, UiDemoChecks> = {
  dialog: {
    states: [
      {
        name: 'with a drop-down, its list open',
        steps: [{ click: 'With a drop-down' }, { clickHud: '.aekDropDownTrigger' }],
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
  },
};
