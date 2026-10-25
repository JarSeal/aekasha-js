/**
 * The component library's checks (`yarn verify:ui`, p803 D11), next to its demos
 * (`_components.ts`, whose `DEMOS` keys these are). The runner opens every Hub button of a demo
 * box (`.hubButton`, the page's own: a kit button drawn in the box is the demo) as a state of its own (on its own page load, in both themes and both densities) and runs
 * axe-core over the box and the HUD root; a demo lists here only the states a button alone
 * doesn't open, and its keyboard scripts. Plain data: no page imports it, and it imports nothing.
 *
 * A keyboard script is what a keyboard user does and sees, step by step: what's true of the
 * piece today. A phase that adds a key or fixes one (Escape, focus return, F6) adds or changes
 * the steps with it. After each key pressed, the focused element (other than the body) must show
 * an outline.
 */

/** A step that opens a state: a Hub button in the demo box by its text, an element in the HUD
 * root, or a kit element drawn in the box */
export type UiCheckStep =
  /** The demo box's Hub button (`.hubButton`) whose text is this, exactly */
  | { click: string }
  /** The first element in the HUD root matching this selector */
  | { clickHud: string }
  /** The first element in the demo box matching this selector (a kit button drawn in the page) */
  | { clickInBox: string };

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
export type UiDemoChecks = { states?: UiCheckState[]; keyboard?: UiKeyScript[] };

const WINDOW = '#hudRoot #hubDemoWindow';
const WINDOW_HEADER = `${WINDOW} .aekWindow__header`;
const KIND_WINDOW = (n: number) => `#hudRoot #hubDemoKind_${n}`;
const BEHIND_DIALOG = '#hudRoot #hubDemoBehindDialog';
const TOAST = '#hudRoot .aekToast';
const LIST = '#hudRoot .aekDropDownList';
const TRIGGER = '#hudRoot .aekDropDownTrigger';
/** The searchable drop-down's trigger: the panel's sixth row (`createDropDownPanel`) */
const SEARCHABLE_TRIGGER = '.hubDemoDropDowns > .aekDropDown:nth-of-type(6) .aekDropDownTrigger';
const SEARCH = '#hudRoot .aekDropDownSearch';
const SEARCH_LIST = '#hudRoot .aekDropDownPopup .aekDropDownList';
const DIALOG = (index: number) => `#hudRoot #hubDemoDialog${index}`;
const TOOLTIP = '#hudRoot .aekTooltip';
const POPOVER = '#hudRoot .aekPopover';
const POPOVER_TRIGGER = '#hubDemoPopoverTrigger';
/** The first key hint of the Kbd box's macOS row (its second, `KBD_ROWS`) */
const KBD_MAC = '[data-hub-demo="kbd"] .hubComponentDemoGroup:nth-of-type(2) .aekKbd';
const GLYPH = '[data-hub-demo="inputGlyph"] .aekInputGlyph';
/** A button of the button box by its name (`_components.ts`' `BUTTON_ID`), and its status line */
const BUTTON = (name: string) => `#hubDemoButton${name}`;
const BUTTON_STATUS = BUTTON('Status');
/** A button group box's button by its label, and its status line (`_components.ts`' `GROUP_ID`) */
const GROUP_BUTTON = (label: string) => `#hubDemoGroupButton${label}`;
const GROUP_STATUS = '#hubDemoGroupStatus';
const LINK = (name: string) => `#hubDemoLink${name}`;
/** The menu box's File button, its split button's parts, the open menu and its focused item */
const MENU_FILE = '#hubDemoMenuFile';
const SPLIT_ACTION = '#hubDemoMenuSplit > .aekButton:first-child';
const SPLIT_MENU_BUTTON = '#hubDemoMenuSplit > [aria-haspopup="menu"]';
const MENU = '#hudRoot .aekMenu';
const MENU_FOCUSED = `${MENU} .aekMenu__item:focus .aekMenu__label`;
const MENU_STATUS = '#hubDemoMenuStatus';
const BADGE_INBOX = '#hubDemoBadgeInbox';
const TAG = (name: string) => `#hubDemoTag${name}`;
const TAG_STATUS = '#hubDemoTagStatus';
const SPINNER = '#hubDemoSpinnerDefault';
const SPINNER_DECORATIVE = '[data-hub-demo="spinner"] .hubDemoLine .aekSpinner';
const PROGRESS = (name: string) => `#hubDemoProgress${name}`;
const PROGRESS_TRACK = (name: string) => `${PROGRESS(name)} .aekProgress__track`;

export const UI_DEMO_CHECKS: Record<string, UiDemoChecks> = {
  window: {
    keyboard: [
      {
        name: 'collapse, expand and close by the header’s buttons',
        steps: [
          { click: 'Default' },
          { focusHud: '#hubDemoWindow .aekWindow__collapse' },
          { press: 'Enter' },
          { expectAttr: WINDOW, name: 'data-state', value: 'collapsed' },
          { expectAttr: `${WINDOW} .aekWindow__collapse`, name: 'aria-expanded', value: 'false' },
          { press: 'Space' },
          { expectAttr: WINDOW, name: 'data-state', value: 'expanded' },
          { press: 'Tab' },
          { expectFocus: `${WINDOW} .aekWindow__close` },
          { press: 'Enter' },
          { expectCount: WINDOW, count: 0 },
        ],
      },
      {
        name: 'the header: the arrows move it, Alt+arrows resize it, Enter collapses it',
        steps: [
          // Opened at the viewport's centre (320 × 320 px), the focus on its header
          { click: 'Default' },
          { expectFocus: WINDOW_HEADER },
          { expectStyle: WINDOW, name: 'left', value: '560px' },
          { press: 'ArrowRight' },
          { expectStyle: WINDOW, name: 'left', value: '576px' },
          { press: 'Shift+ArrowDown' },
          { expectStyle: WINDOW, name: 'top', value: '354px' },
          { press: 'Alt+ArrowRight' },
          { expectStyle: WINDOW, name: 'width', value: '336px' },
          { press: 'Enter' },
          { expectAttr: WINDOW, name: 'data-state', value: 'collapsed' },
          { press: 'Enter' },
          { expectAttr: WINDOW, name: 'data-state', value: 'expanded' },
        ],
      },
      {
        name: 'F6 and Shift+F6 move the focus from window to window, from the page too',
        steps: [
          { click: 'Default' },
          { click: 'Open a window of a kind' },
          { focusBox: 'Default' },
          { press: 'F6' },
          { expectFocus: WINDOW_HEADER },
          { press: 'F6' },
          { expectFocus: `${KIND_WINDOW(1)} .aekWindow__header` },
          { press: 'Shift+F6' },
          { expectFocus: WINDOW_HEADER },
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
      {
        name: 'an alert: modal, the focus on Cancel, Tab and Shift+Tab wrap inside it',
        steps: [
          { click: 'Alert' },
          { expectAttr: DIALOG(4), name: 'role', value: 'alertdialog' },
          { expectAttr: DIALOG(4), name: 'aria-modal', value: 'true' },
          { expectFocus: `${DIALOG(4)} .hubDemoCancel` },
          { press: 'Tab' },
          { expectFocus: `${DIALOG(4)} .hubDemoDelete` },
          { press: 'Tab' },
          { expectFocus: `${DIALOG(4)} .aekWindow__close` },
          { press: 'Shift+Tab' },
          { expectFocus: `${DIALOG(4)} .hubDemoDelete` },
          { press: 'Enter' },
          { expectCount: DIALOG(4), count: 0 },
          { expectFocusBox: 'Alert' },
        ],
      },
      {
        name: 'the window behind a dialog is inert until the dialog closes',
        steps: [
          { click: 'Over a window' },
          { expectAttr: BEHIND_DIALOG, name: 'inert', value: '' },
          { press: 'Escape' },
          { expectCount: DIALOG(5), count: 0 },
          { expectAttr: BEHIND_DIALOG, name: 'inert', value: null },
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
      {
        name: 'the searchable list open',
        steps: [{ click: 'Open the drop-downs' }, { clickHud: SEARCHABLE_TRIGGER }],
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
      {
        name: 'searchable: typing filters the list, the arrows move through the matches, Enter picks',
        steps: [
          { click: 'Open the drop-downs' },
          { focusHud: SEARCHABLE_TRIGGER },
          { press: 'Enter' },
          { expectFocus: `${SEARCH}[role="combobox"]` },
          { expectActiveOption: 'Orange' },
          { press: 'o' },
          { expectCount: `${SEARCH_LIST} [role="option"]`, count: 3 },
          { expectText: `${SEARCH_LIST} [role="option"] .aekDropDownMatch`, text: 'O' },
          { press: 'ArrowDown' },
          { expectActiveOption: 'Gold' },
          { press: 'l' },
          { expectCount: `${SEARCH_LIST} [role="option"]`, count: 2 },
          { expectActiveOption: 'Gold' },
          { press: 'ArrowDown' },
          { expectActiveOption: 'Violet' },
          { press: 'Enter' },
          { expectCount: SEARCH, count: 0 },
          { expectText: `#hudRoot ${SEARCHABLE_TRIGGER} .aekDropDownLabel`, text: 'Violet' },
          { expectFocus: `#hudRoot ${SEARCHABLE_TRIGGER}` },
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
  button: {
    keyboard: [
      {
        name: 'Enter and Space click a button; Tab goes on to the next',
        steps: [
          { focusInBox: BUTTON('Secondary') },
          { press: 'Enter' },
          { expectText: BUTTON_STATUS, text: 'Secondary clicked (1)' },
          { press: 'Space' },
          { expectText: BUTTON_STATUS, text: 'Secondary clicked (2)' },
          { press: 'Tab' },
          { expectFocus: BUTTON('Ghost') },
        ],
      },
      {
        name: 'a toggle: Space and Enter flip aria-pressed',
        steps: [
          { focusInBox: BUTTON('Mute') },
          { expectAttr: BUTTON('Mute'), name: 'aria-pressed', value: 'false' },
          { press: 'Space' },
          { expectAttr: BUTTON('Mute'), name: 'aria-pressed', value: 'true' },
          { expectText: BUTTON_STATUS, text: 'Mute: on' },
          { press: 'Enter' },
          { expectAttr: BUTTON('Mute'), name: 'aria-pressed', value: 'false' },
        ],
      },
      {
        name: 'a click loads: busy, with the focus kept, then done',
        steps: [
          { focusInBox: BUTTON('Save') },
          { expectAttr: BUTTON('Save'), name: 'aria-keyshortcuts', value: 'Control+S' },
          { press: 'Enter' },
          { expectAttr: BUTTON('Save'), name: 'aria-busy', value: 'true' },
          { expectText: BUTTON_STATUS, text: 'Saving…' },
          { expectFocus: BUTTON('Save') },
          { expectAttr: BUTTON('Save'), name: 'aria-busy', value: null },
          { expectText: BUTTON_STATUS, text: 'Saved' },
        ],
      },
      {
        name: 'hold to confirm: a short Enter does nothing, a held one acts',
        steps: [
          { focusInBox: BUTTON('Delete') },
          { press: 'Enter' },
          { expectAttr: BUTTON('Delete'), name: 'data-holding', value: null },
          { keyDown: 'Enter' },
          { expectAttr: BUTTON('Delete'), name: 'data-holding', value: 'filling' },
          { expectAttr: BUTTON('Delete'), name: 'data-holding', value: 'confirmed' },
          { expectText: BUTTON_STATUS, text: 'Deleted (held)' },
          { keyUp: 'Enter' },
          { expectAttr: BUTTON('Delete'), name: 'data-holding', value: null },
        ],
      },
    ],
  },
  buttonGroup: {
    keyboard: [
      {
        name: 'a group: each button is a tab stop',
        steps: [
          { focusInBox: GROUP_BUTTON('Cut') },
          { press: 'Tab' },
          { expectFocus: GROUP_BUTTON('Copy') },
          { press: 'ArrowRight' },
          { expectFocus: GROUP_BUTTON('Copy') },
        ],
      },
      {
        name: 'a toolbar: the arrows, Home and End move the focus, Space presses, Tab leaves and comes back',
        steps: [
          { focusInBox: GROUP_BUTTON('Lit') },
          { expectAttr: '#hubDemoGroupView', name: 'role', value: 'toolbar' },
          { press: 'ArrowRight' },
          { expectFocus: GROUP_BUTTON('Wireframe') },
          { expectAttr: GROUP_BUTTON('Lit'), name: 'aria-pressed', value: 'true' },
          { press: 'Space' },
          { expectAttr: GROUP_BUTTON('Wireframe'), name: 'aria-pressed', value: 'true' },
          { expectAttr: GROUP_BUTTON('Lit'), name: 'aria-pressed', value: 'false' },
          { expectText: GROUP_STATUS, text: 'View: Wireframe' },
          { press: 'End' },
          { expectFocus: GROUP_BUTTON('Normals') },
          { press: 'ArrowRight' },
          { expectFocus: GROUP_BUTTON('Lit') },
          { press: 'Tab' },
          { expectFocus: GROUP_BUTTON('Move') },
          // Back in at the last button focused there, as the APG toolbar
          { press: 'Shift+Tab' },
          { expectFocus: GROUP_BUTTON('Lit') },
        ],
      },
      {
        name: 'a vertical toolbar: Up and Down move, Left and Right don’t',
        steps: [
          { focusInBox: GROUP_BUTTON('Move') },
          { press: 'ArrowDown' },
          { expectFocus: GROUP_BUTTON('Rotate') },
          { press: 'ArrowRight' },
          { expectFocus: GROUP_BUTTON('Rotate') },
          { press: 'Enter' },
          { expectText: GROUP_STATUS, text: 'Tool: Rotate' },
        ],
      },
    ],
  },
  link: {
    keyboard: [
      {
        name: 'Enter follows a link (here an app’s handler takes it)',
        steps: [
          { focusInBox: LINK('Credits') },
          { press: 'Enter' },
          { expectText: '#hubDemoLinkStatus', text: 'Credits: followed by the app’s handler' },
        ],
      },
      {
        name: 'no keys; an external link opens in a new tab and says so',
        steps: [
          { expectAttr: LINK('Manual'), name: 'target', value: '_blank' },
          { expectAttr: LINK('Manual'), name: 'rel', value: 'noopener noreferrer' },
          { expectText: `${LINK('Manual')} .aekVisuallyHidden`, text: '(opens in a new tab)' },
        ],
      },
    ],
  },
  menu: {
    states: [
      { name: 'the menu open', steps: [{ clickInBox: MENU_FILE }] },
      { name: 'the split button’s menu open', steps: [{ clickInBox: SPLIT_MENU_BUTTON }] },
    ],
    keyboard: [
      {
        name: 'Enter opens the menu on its first item, the arrows move, Enter picks; the focus back',
        steps: [
          { focusInBox: MENU_FILE },
          { expectAttr: MENU_FILE, name: 'aria-haspopup', value: 'menu' },
          { press: 'Enter' },
          { expectAttr: MENU_FILE, name: 'aria-expanded', value: 'true' },
          { expectText: MENU_FOCUSED, text: 'New' },
          { press: 'ArrowDown' },
          { expectText: MENU_FOCUSED, text: 'Open…' },
          { press: 'End' },
          { expectText: MENU_FOCUSED, text: 'Revert' },
          { press: 'ArrowDown' },
          { expectText: MENU_FOCUSED, text: 'New' },
          { press: 'Enter' },
          { expectCount: MENU, count: 0 },
          { expectText: MENU_STATUS, text: 'File: New' },
          { expectFocus: MENU_FILE },
          { expectAttr: MENU_FILE, name: 'aria-expanded', value: 'false' },
        ],
      },
      {
        name: 'ArrowUp opens it on its last item; a letter goes to its item; Space flips and stays; Escape closes',
        steps: [
          { focusInBox: MENU_FILE },
          { press: 'ArrowUp' },
          { expectText: MENU_FOCUSED, text: 'Revert' },
          { press: 'Enter' },
          { expectCount: MENU, count: 1 },
          { press: 'a' },
          { expectText: MENU_FOCUSED, text: 'Autosave' },
          { press: 'Space' },
          { expectAttr: `${MENU} [role="menuitemcheckbox"]`, name: 'aria-checked', value: 'true' },
          { expectText: MENU_STATUS, text: 'Autosave: on' },
          { expectCount: MENU, count: 1 },
          { press: 'ArrowDown' },
          { press: 'ArrowDown' },
          { press: 'Space' },
          {
            expectAttr: `${MENU} [role="menuitemradio"]:nth-child(2)`,
            name: 'aria-checked',
            value: 'true',
          },
          { expectText: MENU_STATUS, text: 'Sort by: date' },
          { press: 'Escape' },
          { expectCount: MENU, count: 0 },
          { expectFocus: MENU_FILE },
        ],
      },
      {
        name: 'a split button: the action, then Tab to its menu button, whose arrows open the menu',
        steps: [
          { focusInBox: SPLIT_ACTION },
          { press: 'Enter' },
          { expectText: MENU_STATUS, text: 'Saved' },
          { press: 'Tab' },
          { expectFocus: SPLIT_MENU_BUTTON },
          { expectAttr: SPLIT_MENU_BUTTON, name: 'aria-label', value: 'More options' },
          { press: 'ArrowDown' },
          { expectText: MENU_FOCUSED, text: 'Save as…' },
          { press: 'Tab' },
          { expectCount: MENU, count: 0 },
          { expectFocus: SPLIT_MENU_BUTTON },
        ],
      },
    ],
  },
  badge: {
    keyboard: [
      {
        name: 'no keys; a count says its spoken label, and a change updates both',
        steps: [
          { expectText: `${BADGE_INBOX} .aekBadge__label`, text: '3' },
          { expectAttr: `${BADGE_INBOX} .aekBadge__label`, name: 'aria-hidden', value: 'true' },
          { expectText: `${BADGE_INBOX} .aekVisuallyHidden`, text: '3 unread' },
          { click: 'Add a message' },
          { expectText: `${BADGE_INBOX} .aekBadge__label`, text: '4' },
          { expectText: `${BADGE_INBOX} .aekVisuallyHidden`, text: '4 unread' },
        ],
      },
    ],
  },
  tag: {
    keyboard: [
      {
        name: 'a filter chip: Space flips aria-pressed',
        steps: [
          { focusInBox: `${TAG('Trees')} button` },
          { expectAttr: `${TAG('Trees')} button`, name: 'aria-pressed', value: 'false' },
          { press: 'Space' },
          { expectAttr: `${TAG('Trees')} button`, name: 'aria-pressed', value: 'true' },
          { expectText: TAG_STATUS, text: 'Filters: Rocks, Trees' },
          { press: 'Enter' },
          { expectAttr: `${TAG('Trees')} button`, name: 'aria-pressed', value: 'false' },
        ],
      },
      {
        name: 'a removable tag: Delete and Backspace remove it, the focus to the next, else the previous',
        steps: [
          { focusInBox: `${TAG('Level2')} .aekTag__remove` },
          {
            expectAttr: `${TAG('Level2')} .aekTag__remove`,
            name: 'aria-label',
            value: 'Remove level2.scene',
          },
          { press: 'Delete' },
          { expectCount: TAG('Level2'), count: 0 },
          { expectFocus: `${TAG('Level3')} .aekTag__remove` },
          { expectText: TAG_STATUS, text: 'Removed: level2.scene' },
          { press: 'Backspace' },
          { expectCount: TAG('Level3'), count: 0 },
          { expectFocus: `${TAG('Level1')} .aekTag__remove` },
          { press: 'Enter' },
          { expectCount: TAG('Level1'), count: 0 },
        ],
      },
    ],
  },
  spinner: {
    keyboard: [
      {
        name: 'no keys; alone it’s a status with its label, in text it’s hidden',
        steps: [
          { expectAttr: SPINNER, name: 'role', value: 'status' },
          { expectText: `${SPINNER} .aekVisuallyHidden`, text: 'Loading' },
          { expectAttr: SPINNER_DECORATIVE, name: 'aria-hidden', value: 'true' },
          { expectAttr: SPINNER_DECORATIVE, name: 'role', value: null },
        ],
      },
    ],
  },
  progressBar: {
    keyboard: [
      {
        name: 'no keys; the track is a progressbar with its value, none while indeterminate',
        steps: [
          { expectAttr: PROGRESS_TRACK('Download'), name: 'role', value: 'progressbar' },
          { expectAttr: PROGRESS_TRACK('Download'), name: 'aria-valuenow', value: '40' },
          { expectText: `${PROGRESS('Download')} .aekProgress__value`, text: '40 %' },
          { click: 'Add 10 %' },
          { expectAttr: PROGRESS_TRACK('Download'), name: 'aria-valuenow', value: '50' },
          { expectText: `${PROGRESS('Download')} .aekProgress__value`, text: '50 %' },
          { expectAttr: PROGRESS_TRACK('Connecting'), name: 'aria-valuenow', value: null },
          { expectAttr: PROGRESS_TRACK('Health'), name: 'aria-valuemax', value: '5' },
          { expectAttr: PROGRESS_TRACK('Health'), name: 'aria-valuenow', value: '2.5' },
        ],
      },
    ],
  },
  kbd: {
    keyboard: [
      {
        name: 'no keys; assistive tech hears a macOS hint’s words, not its symbols',
        steps: [
          { expectText: `${KBD_MAC} .aekKbd__key`, text: '⌘' },
          { expectAttr: `${KBD_MAC} .aekKbd__keys`, name: 'aria-hidden', value: 'true' },
          { expectText: `${KBD_MAC} .aekVisuallyHidden`, text: 'Command+S' },
        ],
      },
    ],
  },
  inputGlyph: {
    keyboard: [
      {
        name: 'no keys; each glyph is an image named by its input',
        steps: [
          { expectAttr: GLYPH, name: 'role', value: 'img' },
          { expectAttr: GLYPH, name: 'aria-label', value: 'E' },
          {
            expectAttr: `${GLYPH}[data-device="mouse"]`,
            name: 'aria-label',
            value: 'Left mouse button',
          },
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
          { expectCount: TOAST, count: 1 },
          { expectAttr: `${TOAST} .aekToast__close`, name: 'aria-label', value: 'Close' },
          { focusHud: '.aekToast .aekToast__close' },
          { press: 'Enter' },
          { expectCount: TOAST, count: 0 },
        ],
      },
      {
        name: 'Escape in a toast closes it; the focus goes back to its Hub button',
        steps: [
          { click: 'Until closed' },
          { focusHud: '.aekToast .aekToast__close' },
          { press: 'Escape' },
          { expectCount: TOAST, count: 0 },
          { expectFocusBox: 'Until closed' },
        ],
      },
      {
        name: 'a toast is read once through the toaster’s polite live region',
        steps: [
          { click: 'With a title' },
          {
            expectText: '#hudRoot #hubDemoToaster [role="status"]',
            text: 'Saved. The scene was written to disk.',
          },
        ],
      },
    ],
  },
};
