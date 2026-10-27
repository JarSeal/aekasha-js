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
/** A number field's input by its label (`_components.ts`' `NUMBER_ID`), its reset button, and
 * the box's status line */
const NUMBER = (name: string) => `#hubDemoNumber${name}`;
const NUMBER_RESET = (name: string) => `.aekField:has(${NUMBER(name)}) .aekField__reset`;
const NUMBER_STATUS = '#hubDemoNumberStatus';
/** A slider's control by its name (`_components.ts`' `SLIDER_ID`: the spin button, or the thumb
 * without the input), and the box's status line */
const SLIDER = (name: string) => `#hubDemoSlider${name}`;
const SLIDER_STATUS = '#hubDemoSliderStatus';
/** A range slider's stop by its name (`_components.ts`' `RANGE_ID`) and part (`min`, `max`,
 * `range`: the span), and the box's status line */
const RANGE = (name: string, part: 'min' | 'max' | 'range') => `#hubDemoRange${name}-${part}`;
const RANGE_STATUS = '#hubDemoRangeStatus';
/** A radio of the radio group box by its group's name (`_components.ts`' `RADIO_ID`) and place,
 * the same checked, and the box's status line */
const RADIO = (name: string, index: number) => `#hubDemoRadio${name}-${index}`;
const RADIO_CHECKED = (name: string, index: number) => `${RADIO(name, index)}:checked`;
const RADIO_STATUS = '#hubDemoRadioStatus';
/** A select field's trigger by its name (`_components.ts`' `SELECT_ID`), its shown value, and the
 * box's status line */
const SELECT = (name: string) => `#hubDemoSelect${name}`;
const SELECT_VALUE = (name: string) => `${SELECT(name)} .aekDropDownLabel`;
const SELECT_STATUS = '#hubDemoSelectStatus';
/** The select box's open list and filter: in the field (the Popover API's top layer leaves it in
 * its place), not in the HUD root as a window's drop-down is */
const SELECT_LIST = '[data-hub-demo="selectField"] .aekDropDownList';
const SELECT_SEARCH = '[data-hub-demo="selectField"] .aekDropDownSearch';
/** A text field's input by its label (`_components.ts`' `TEXT_ID`), and the box's lines */
const TEXT = (name: string) => `#hubDemoText${name}`;
const TEXT_STATUS = '#hubDemoTextStatus';
const TEXT_RESULTS = '#hubDemoTextResults';
const SEARCH_CLEAR = `.aekField:has(${TEXT('Search')}) .aekTextField__clear`;
/** A checkbox's or a switch's input by its name (`TOGGLE_ID`), and the box's status line */
const TOGGLE = (name: string) => `#hubDemoToggle${name}`;
const TOGGLE_STATUS = '#hubDemoToggleStatus';
const LAYERS_ON = '[data-hub-demo="checkbox"] .hubDemoNestedToggles input:checked';
/** A colour field's text input by its name (`_components.ts`' `COLOR_ID`), its swatch and its
 * alpha's spin button, the open panel's swatches, and the box's status line */
const COLOR = (name: string) => `#hubDemoColor${name}`;
const COLOR_SWATCH = (name: string) => `.aekField:has(${COLOR(name)}) .aekColorField__swatch`;
const COLOR_ALPHA = (name: string) => `.aekField:has(${COLOR(name)}) .aekColorField__part input`;
const COLOR_PANEL_SWATCH = (n: number) =>
  `#hudRoot .aekColorPopover .aekColorPanel__picker + .aekColorPanel__group .aekColorPanel__swatch:nth-child(${n})`;
/** The picker's parts, focused in its shadow root (`expectFocus` reads the element focused there) */
const PICKER_PART = (part: string) => `[part="${part}"]`;
const COLOR_STATUS = '#hubDemoColorStatus';
/** A vector field's axis by the field's name (`_components.ts`' `VECTOR_ID`, the group's id) and
 * the axis' place (`data-axis`), its link toggle, and the box's status line */
const VECTOR_AXIS = (name: string, axis: string) =>
  `#hubDemoVector${name} .aekVectorField__axis[data-axis="${axis}"] input`;
const VECTOR_LINK = (name: string) => `#hubDemoVector${name} .aekVectorField__link`;
const VECTOR_STATUS = '#hubDemoVectorStatus';
/** A rotation or quaternion field's part by the field's name (`_components.ts`' `ROTATION_ID`,
 * the group's id) and its place (`data-axis`), and the box's status line */
const ROTATION_PART = (name: string, axis: string) =>
  `#hubDemoRotation${name} .aekVectorField__axis[data-axis="${axis}"] input`;
const ROTATION_ORDER = '#hubDemoRotationRotation .aekDropDownTrigger';
const ROTATION_STATUS = '#hubDemoRotationStatus';
/** An angle dial's control by its name (`_components.ts`' `ANGLE_ID`: the spin button's id, or
 * the dial's without one), and the box's status line */
const ANGLE = (name: string) => `#hubDemoAngle${name}`;
const ANGLE_STATUS = '#hubDemoAngleStatus';
/** A 2D pad's pad and axis by the field's name (`PAD_ID`, the row's id), and the status line */
const PAD = (name: string) => `#hubDemoPad${name} .aekPad2D__pad`;
const PAD_AXIS = (name: string, axis: string) =>
  `#hubDemoPad${name} .aekVectorField__axis[data-axis="${axis}"] input`;
const PAD_STATUS = '#hubDemoPadStatus';
/** A gradient editor's stop handle by the editor's name (`GRADIENT_ID`, the group's id) and its
 * place in the array (1-based), its row's parts, and the box's status line */
const GRADIENT_STOP = (name: string, n: number) =>
  `#hubDemoGradient${name} .aekGradientEditor__stop:nth-child(${n})`;
const GRADIENT_STOPS = (name: string) => `#hubDemoGradient${name} .aekGradientEditor__stop`;
const GRADIENT_POSITION = (name: string) =>
  `#hubDemoGradient${name} input[aria-label="Stop position"]`;
const GRADIENT_SWATCH = (name: string) => `#hubDemoGradient${name} .aekColorField__swatch`;
const GRADIENT_STATUS = '#hubDemoGradientStatus';
/** A curve editor's point by the editor's name (`CURVE_ID`, the group's id) and its place in the
 * array (1-based), its row's parts, and the box's status line */
const CURVE_POINT = (name: string, n: number) =>
  `#hubDemoCurve${name} .aekCurveEditor__point:nth-child(${n})`;
const CURVE_POINTS = (name: string) => `#hubDemoCurve${name} .aekCurveEditor__point`;
const CURVE_X = (name: string) => `#hubDemoCurve${name} input[aria-label$=" X"]`;
const CURVE_PRESETS = (name: string) => `#hubDemoCurve${name} .aekCurveEditor__presets`;
const CURVE_STATUS = '#hubDemoCurveStatus';
/** A folder demo's element by its name (`FOLDER_ID`): a folder's button, a field's control */
const FOLDER = (name: string) => `#hubDemoFolder${name}`;
const FOLDER_STATUS = '#hubDemoFolderStatus';
/** A fieldset demo's control by its name (`FIELDSET_ID`) */
const FIELDSET = (name: string) => `#hubDemoFieldset${name}`;
/** A property grid demo's element by its name (`GRID_ID`) */
const GRID = (name: string) => `#hubDemoGrid${name}`;
/** A form demo's element by its name (`FORM_ID`): a field's control, the status line */
const FORM = (name: string) => `#hubDemoForm${name}`;
const FORM_SUMMARY = `${FORM('Form')} .aekForm__summary`;
const FORM_LINKS = `${FORM_SUMMARY} .aekForm__summaryLink`;
/** A monitor by its name (`MONITOR_ID`): the line's element, or the multiline text area */
const MONITOR = (name: string) => `#hubDemoMonitor${name}`;
const BADGE_INBOX = '#hubDemoBadgeInbox';
const TAG = (name: string) => `#hubDemoTag${name}`;
const TAG_STATUS = '#hubDemoTagStatus';
const SPINNER = '#hubDemoSpinnerDefault';
const SPINNER_DECORATIVE = '[data-hub-demo="spinner"] .hubDemoLine .aekSpinner';
const PROGRESS = (name: string) => `#hubDemoProgress${name}`;
const PROGRESS_TRACK = (name: string) => `${PROGRESS(name)} .aekProgress__track`;
const SKELETON_CARD = '#hubDemoSkeletonCard';
const DIVIDER_BOX = '[data-hub-demo="divider"]';
const EMPTY_SAVES = '#hubDemoEmptySaves';
const OVERLAY_PANEL = '#hubDemoOverlayPanel .aekLoadingOverlay';
const OVERLAY_BOUNDS = '#hudRoot #hubDemoOverlayBounds';

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
  numberField: {
    keyboard: [
      {
        name: 'the arrows step (Shift ×10), each keyup writing last: true; the reset button shows',
        steps: [
          { focusInBox: NUMBER('Speed') },
          { expectAttr: NUMBER('Speed'), name: 'aria-valuenow', value: '1.5' },
          { expectAttr: NUMBER_RESET('Speed'), name: 'hidden', value: '' },
          { press: 'ArrowUp' },
          { expectAttr: NUMBER('Speed'), name: 'aria-valuenow', value: '1.6' },
          { expectText: NUMBER_STATUS, text: 'Speed: 1.6 (last, user)' },
          { press: 'Shift+ArrowUp' },
          { expectAttr: NUMBER('Speed'), name: 'aria-valuenow', value: '2.6' },
          { expectAttr: NUMBER('Speed'), name: 'aria-valuetext', value: '2.6 m/s' },
          { expectAttr: NUMBER_RESET('Speed'), name: 'hidden', value: null },
        ],
      },
      {
        name: 'a typed expression is written on Enter, rounded; Escape puts the text back',
        steps: [
          { focusInBox: NUMBER('Speed') },
          { press: 'ControlOrMeta+A' },
          { press: '3' },
          { press: '*' },
          { press: '0' },
          { press: '.' },
          { press: '7' },
          { press: 'Enter' },
          { expectAttr: NUMBER('Speed'), name: 'aria-valuenow', value: '2.1' },
          { expectText: NUMBER_STATUS, text: 'Speed: 2.1 (last, user)' },
          { press: 'ControlOrMeta+A' },
          { press: '9' },
          { press: 'Escape' },
          { expectAttr: NUMBER('Speed'), name: 'aria-valuenow', value: '2.1' },
          { expectFocus: NUMBER('Speed') },
        ],
      },
      {
        name: 'Home and End go to the minimum and the maximum',
        steps: [
          { focusInBox: NUMBER('Volume') },
          { expectAttr: NUMBER('Volume'), name: 'aria-valuetext', value: '80 %' },
          { press: 'End' },
          { expectAttr: NUMBER('Volume'), name: 'aria-valuetext', value: '100 %' },
          { press: 'Home' },
          { expectAttr: NUMBER('Volume'), name: 'aria-valuetext', value: '0 %' },
        ],
      },
      {
        name: 'the reset button writes the default and gives the focus back to the input',
        steps: [
          { focusInBox: NUMBER('Heading') },
          { press: 'ArrowUp' },
          { expectAttr: NUMBER('Heading'), name: 'aria-valuenow', value: '105' },
          { press: 'Shift+Tab' },
          { expectFocus: NUMBER_RESET('Heading') },
          { press: 'Enter' },
          { expectAttr: NUMBER('Heading'), name: 'aria-valuenow', value: '90' },
          { expectAttr: NUMBER_RESET('Heading'), name: 'hidden', value: '' },
          { expectFocus: NUMBER('Heading') },
        ],
      },
    ],
  },
  slider: {
    keyboard: [
      {
        name: 'the spin button steps the slider; the track is no tab stop',
        steps: [
          { focusInBox: SLIDER('Fov') },
          { expectAttr: SLIDER('Fov'), name: 'role', value: 'spinbutton' },
          { press: 'ArrowUp' },
          { expectAttr: SLIDER('Fov'), name: 'aria-valuetext', value: '76 °' },
          { expectText: SLIDER_STATUS, text: 'Field of view: 76 (last, user)' },
          { press: 'Shift+ArrowDown' },
          { expectAttr: SLIDER('Fov'), name: 'aria-valuenow', value: '66' },
          // Past the track to the label row's reset button (shown: the value isn't the default)
          { press: 'Shift+Tab' },
          { expectFocus: `.aekField:has(${SLIDER('Fov')}) .aekField__reset` },
          { press: 'Shift+Tab' },
          { expectFocus: SLIDER('Volume') },
        ],
      },
      {
        name: 'without the input the thumb is the slider: the four arrows, Home and End',
        steps: [
          { focusInBox: SLIDER('Quality') },
          { expectAttr: SLIDER('Quality'), name: 'role', value: 'slider' },
          { expectAttr: SLIDER('Quality'), name: 'aria-valuetext', value: 'High' },
          { press: 'ArrowRight' },
          { expectAttr: SLIDER('Quality'), name: 'aria-valuetext', value: 'Ultra' },
          { expectText: SLIDER_STATUS, text: 'Quality: Ultra (last, user)' },
          { press: 'ArrowDown' },
          { press: 'ArrowLeft' },
          { expectAttr: SLIDER('Quality'), name: 'aria-valuenow', value: '1' },
          { press: 'End' },
          { expectAttr: SLIDER('Quality'), name: 'aria-valuetext', value: 'Max' },
          { press: 'Home' },
          { expectAttr: SLIDER('Quality'), name: 'aria-valuetext', value: 'Low' },
          { expectFocus: SLIDER('Quality') },
        ],
      },
    ],
  },
  rangeSlider: {
    keyboard: [
      {
        name: 'each thumb steps, stopping at the other less the gap; Tab goes thumb to thumb',
        steps: [
          { focusInBox: RANGE('Price', 'min') },
          { expectAttr: RANGE('Price', 'min'), name: 'aria-valuetext', value: '100 €' },
          { press: 'ArrowRight' },
          { expectAttr: RANGE('Price', 'min'), name: 'aria-valuenow', value: '110' },
          { expectText: RANGE_STATUS, text: 'Price: 110–350 (last, user)' },
          { press: 'End' },
          { expectAttr: RANGE('Price', 'min'), name: 'aria-valuenow', value: '300' },
          { expectAttr: RANGE('Price', 'max'), name: 'aria-valuemin', value: '350' },
          { press: 'Tab' },
          { expectFocus: RANGE('Price', 'max') },
          { press: 'Home' },
          { expectAttr: RANGE('Price', 'max'), name: 'aria-valuenow', value: '350' },
          { press: 'ArrowRight' },
          { expectAttr: RANGE('Price', 'max'), name: 'aria-valuenow', value: '360' },
        ],
      },
      {
        name: 'the span is the third stop: the arrows move both, Home and End to the ends',
        steps: [
          { focusInBox: RANGE('Years', 'max') },
          { press: 'Tab' },
          { expectFocus: RANGE('Years', 'range') },
          { expectAttr: RANGE('Years', 'range'), name: 'aria-valuetext', value: '2000 to 2020' },
          { press: 'ArrowRight' },
          { expectAttr: RANGE('Years', 'range'), name: 'aria-valuetext', value: '2001 to 2021' },
          { expectText: RANGE_STATUS, text: 'Years: 2001–2021 (last, user)' },
          { press: 'End' },
          { expectAttr: RANGE('Years', 'range'), name: 'aria-valuetext', value: '2010 to 2030' },
          { press: 'Home' },
          { expectAttr: RANGE('Years', 'min'), name: 'aria-valuenow', value: '1990' },
          { expectAttr: RANGE('Years', 'max'), name: 'aria-valuenow', value: '2010' },
        ],
      },
      {
        name: 'with spin buttons: a typed value on Enter, the keys, each end kept by the gap',
        steps: [
          { focusInBox: RANGE('Altitude', 'min') },
          { expectAttr: RANGE('Altitude', 'min'), name: 'role', value: 'spinbutton' },
          { press: 'ControlOrMeta+A' },
          { press: '2' },
          { press: '.' },
          { press: '5' },
          { press: 'k' },
          { press: 'm' },
          { press: 'Enter' },
          { expectAttr: RANGE('Altitude', 'min'), name: 'aria-valuenow', value: '2500' },
          { expectValue: RANGE('Altitude', 'min'), value: '2500' },
          { expectText: RANGE_STATUS, text: 'Altitude: 2500–6000 (last, user)' },
          { press: 'End' },
          { expectAttr: RANGE('Altitude', 'min'), name: 'aria-valuetext', value: '5500 m' },
          { press: 'Tab' },
          { expectFocus: RANGE('Altitude', 'max') },
          { expectAttr: RANGE('Altitude', 'max'), name: 'aria-valuemin', value: '6000' },
          { press: 'Shift+ArrowUp' },
          { expectAttr: RANGE('Altitude', 'max'), name: 'aria-valuenow', value: '7000' },
        ],
      },
    ],
  },
  radioGroup: {
    keyboard: [
      {
        name: 'a radio group is one tab stop: the arrows pick (wrapping), skipping a disabled one',
        steps: [
          { focusInBox: RADIO('Difficulty', 1) },
          { press: 'ArrowDown' },
          { expectFocus: RADIO('Difficulty', 2) },
          { expectCount: RADIO_CHECKED('Difficulty', 2), count: 1 },
          { expectText: RADIO_STATUS, text: 'Difficulty: hard' },
          { press: 'ArrowDown' },
          { expectFocus: RADIO('Difficulty', 0) },
          { expectText: RADIO_STATUS, text: 'Difficulty: easy' },
          // Out of the group to the next one's checked radio
          { press: 'Tab' },
          { expectFocus: RADIO('Shadows', 1) },
          { press: 'ArrowRight' },
          { expectFocus: RADIO('Shadows', 2) },
          { press: 'ArrowRight' },
          { expectFocus: RADIO('Shadows', 0) },
          { expectText: RADIO_STATUS, text: 'Shadows: off' },
        ],
      },
      {
        name: 'a segmented control is the same: one tab stop, the arrows pick',
        steps: [
          { focusInBox: RADIO('Camera', 0) },
          { press: 'ArrowRight' },
          { expectFocus: RADIO('Camera', 1) },
          { expectCount: RADIO_CHECKED('Camera', 1), count: 1 },
          { expectText: RADIO_STATUS, text: 'Camera: follow' },
          { press: 'Tab' },
          { expectFocus: RADIO('Simulation', 0) },
          { press: 'ArrowLeft' },
          { expectFocus: RADIO('Simulation', 2) },
          { expectText: RADIO_STATUS, text: 'Simulation: stop' },
        ],
      },
    ],
  },
  selectField: {
    keyboard: [
      {
        name: 'Enter opens the list on the value; the arrows and Enter pick, the focus comes back',
        steps: [
          { focusInBox: SELECT('ShadowMap') },
          { press: 'Enter' },
          { expectCount: SELECT_LIST, count: 1 },
          { expectActiveOption: '1024' },
          { press: 'ArrowDown' },
          { expectActiveOption: '2048' },
          { press: 'Enter' },
          { expectCount: SELECT_LIST, count: 0 },
          { expectText: SELECT_STATUS, text: 'Shadow map: 2048' },
          { expectText: SELECT_VALUE('ShadowMap'), text: '2048' },
          { expectFocus: SELECT('ShadowMap') },
        ],
      },
      {
        name: 'Escape closes the list without a change',
        steps: [
          { focusInBox: SELECT('ToneMapping') },
          { press: 'Space' },
          { expectCount: SELECT_LIST, count: 1 },
          { press: 'ArrowUp' },
          { press: 'Escape' },
          { expectCount: SELECT_LIST, count: 0 },
          { expectText: SELECT_VALUE('ToneMapping'), text: 'ACES Filmic' },
          { expectFocus: SELECT('ToneMapping') },
        ],
      },
      {
        name: 'searchable: typing filters the list, Enter picks the match',
        steps: [
          { focusInBox: SELECT('Spawn') },
          { press: 'Enter' },
          { expectFocus: SELECT_SEARCH },
          { press: 'r' },
          { press: 'i' },
          { expectActiveOption: 'Ridge' },
          { press: 'Enter' },
          { expectText: SELECT_STATUS, text: 'Spawn point: ridge' },
          { expectFocus: SELECT('Spawn') },
        ],
      },
    ],
  },
  textField: {
    keyboard: [
      {
        name: 'typed text is written on Enter; Escape puts the text back',
        steps: [
          { focusInBox: TEXT('Name') },
          { press: 'ControlOrMeta+A' },
          { press: 'b' },
          { press: 'o' },
          { press: 'b' },
          { press: 'Enter' },
          { expectText: TEXT_STATUS, text: 'Name: "bob" (last)' },
          { press: 'ControlOrMeta+A' },
          { press: 'x' },
          { expectValue: TEXT('Name'), value: 'x' },
          { press: 'Escape' },
          { expectValue: TEXT('Name'), value: 'bob' },
          { expectFocus: TEXT('Name') },
        ],
      },
      {
        name: 'multiline: Enter is a new line, Ctrl/⌘+Enter writes',
        steps: [
          { focusInBox: TEXT('Notes') },
          { press: 'ControlOrMeta+A' },
          { press: 'a' },
          { press: 'Enter' },
          { press: 'b' },
          { expectValue: TEXT('Notes'), value: 'a\nb' },
          { expectText: TEXT_STATUS, text: '' },
          { press: 'ControlOrMeta+Enter' },
          { expectText: TEXT_STATUS, text: 'Notes: "a / b" (last)' },
        ],
      },
      {
        name: 'search: typing filters the list; the clear button empties it and returns the focus',
        steps: [
          { focusInBox: TEXT('Search') },
          { press: 'm' },
          { press: 'e' },
          { expectText: TEXT_RESULTS, text: '2 of 8: Comet, Meteor' },
          { press: 'Tab' },
          { expectFocus: SEARCH_CLEAR },
          { press: 'Enter' },
          { expectValue: TEXT('Search'), value: '' },
          { expectFocus: TEXT('Search') },
          {
            expectText: TEXT_RESULTS,
            text: '8 of 8: Asteroid, Comet, Galaxy, Meteor, Moon, Nebula, Planet, Star',
          },
        ],
      },
    ],
  },
  checkbox: {
    keyboard: [
      {
        name: 'Space flips a checkbox; Tab goes on to the next',
        steps: [
          { focusInBox: TOGGLE('Shadows') },
          { press: 'Space' },
          { expectText: TOGGLE_STATUS, text: 'Shadows: off' },
          { press: 'Tab' },
          { expectFocus: TOGGLE('Fog') },
          { press: 'Space' },
          { expectText: TOGGLE_STATUS, text: 'Fog: on' },
        ],
      },
      {
        name: 'a mixed checkbox: Space sets all three, and again clears them',
        steps: [
          { focusInBox: TOGGLE('All') },
          { expectCount: `${TOGGLE('All')}:indeterminate`, count: 1 },
          { expectCount: LAYERS_ON, count: 2 },
          { press: 'Space' },
          { expectCount: `${TOGGLE('All')}:indeterminate`, count: 0 },
          { expectCount: LAYERS_ON, count: 3 },
          { press: 'Space' },
          { expectCount: LAYERS_ON, count: 0 },
          { expectText: TOGGLE_STATUS, text: 'All layers: off' },
        ],
      },
      {
        name: 'a switch: Space flips it and its text',
        steps: [
          { focusInBox: TOGGLE('Vsync') },
          { expectText: `.aekField:has(${TOGGLE('Vsync')}) .aekSwitch__text`, text: 'On' },
          { press: 'Space' },
          { expectText: `.aekField:has(${TOGGLE('Vsync')}) .aekSwitch__text`, text: 'Off' },
          { expectText: TOGGLE_STATUS, text: 'V-sync: off' },
        ],
      },
    ],
  },
  colorField: {
    keyboard: [
      {
        name: 'typed text is written on Enter; Escape puts the text back',
        steps: [
          { focusInBox: COLOR('Fog') },
          { press: 'ControlOrMeta+A' },
          { press: '#' },
          { press: 'f' },
          { press: '0' },
          { press: '0' },
          { press: 'Enter' },
          { expectValue: COLOR('Fog'), value: '#ff0000' },
          { expectText: COLOR_STATUS, text: 'Fog: 0xff0000 (last)' },
          { press: 'ControlOrMeta+A' },
          { press: 'x' },
          { press: 'Escape' },
          { expectValue: COLOR('Fog'), value: '#ff0000' },
          { expectFocus: COLOR('Fog') },
        ],
      },
      {
        name: 'the swatch opens the panel on the picker’s plane; the arrows step it; a palette swatch sets the colour; Escape returns',
        steps: [
          { focusInBox: COLOR_SWATCH('Fog') },
          { press: 'Enter' },
          { expectAttr: COLOR_SWATCH('Fog'), name: 'aria-expanded', value: 'true' },
          // Loaded on this first open, then focused
          { expectFocus: PICKER_PART('saturation') },
          // Saturation +1 %: h 208.5, s 20.1, v 78.0 rounded by the picker to 209, 21, 78
          { press: 'ArrowRight' },
          { expectText: COLOR_STATUS, text: 'Fog: 0x9db3c7 (last)' },
          { expectValue: COLOR('Fog'), value: '#9db3c7' },
          { press: 'Tab' },
          { expectFocus: PICKER_PART('hue') },
          // No alpha slider: the fog is a 24-bit number
          { press: 'Tab' },
          { expectFocus: COLOR_PANEL_SWATCH(1) },
          { press: 'Tab' },
          { expectFocus: COLOR_PANEL_SWATCH(2) },
          { press: 'Enter' },
          { expectText: COLOR_STATUS, text: 'Fog: 0xd7c4a3 (last)' },
          { expectAttr: COLOR_PANEL_SWATCH(2), name: 'aria-current', value: 'true' },
          // The focused swatch's tooltip is the top overlay: the first Escape closes it
          { press: 'Escape' },
          { expectCount: '#hudRoot .aekTooltip', count: 0 },
          { expectFocus: COLOR_PANEL_SWATCH(2) },
          { press: 'Escape' },
          { expectFocus: COLOR_SWATCH('Fog') },
          { expectCount: '#hudRoot .aekColorPopover', count: 0 },
          { expectValue: COLOR('Fog'), value: '#d7c4a3' },
        ],
      },
      {
        name: 'the alpha’s spin button steps it, the text following',
        steps: [
          { focusInBox: COLOR_ALPHA('Tint') },
          { press: 'ArrowUp' },
          { expectText: COLOR_STATUS, text: 'Tint: #3fd8f282 (last)' },
          { expectValue: COLOR('Tint'), value: '#3fd8f282' },
          { press: 'Shift+ArrowDown' },
          { expectValue: COLOR('Tint'), value: '#3fd8f269' },
        ],
      },
    ],
  },
  vectorField: {
    keyboard: [
      {
        name: 'the arrows step an axis; Tab goes axis by axis',
        steps: [
          { focusInBox: VECTOR_AXIS('Position', 'x') },
          { press: 'ArrowUp' },
          { expectText: VECTOR_STATUS, text: 'Position: 1.1, 2, 3 (last)' },
          { press: 'Tab' },
          { expectFocus: VECTOR_AXIS('Position', 'y') },
          { press: 'Shift+ArrowDown' },
          { expectText: VECTOR_STATUS, text: 'Position: 1.1, 1, 3 (last)' },
          { expectValue: VECTOR_AXIS('Position', 'y'), value: '1.0' },
        ],
      },
      {
        name: 'linked: an axis scales the others; the toggle after the axes unlinks them',
        steps: [
          { focusInBox: VECTOR_AXIS('Scale', 'x') },
          { press: 'ArrowUp' },
          { expectText: VECTOR_STATUS, text: 'Scale: 1.1, 1.1, 1.1 (last)' },
          { press: 'Tab' },
          { press: 'Tab' },
          { press: 'Tab' },
          { expectFocus: VECTOR_LINK('Scale') },
          { expectAttr: VECTOR_LINK('Scale'), name: 'aria-pressed', value: 'true' },
          { press: 'Space' },
          { expectAttr: VECTOR_LINK('Scale'), name: 'aria-pressed', value: 'false' },
          { press: 'Shift+Tab' },
          { expectFocus: VECTOR_AXIS('Scale', 'z') },
          { press: 'ArrowUp' },
          { expectText: VECTOR_STATUS, text: 'Scale: 1.1, 1.1, 1.2 (last)' },
        ],
      },
      {
        name: 'a typed value is written on Enter, kept to its axis’ own rules',
        steps: [
          { focusInBox: VECTOR_AXIS('Size', 'y') },
          { press: 'ControlOrMeta+A' },
          { press: '-' },
          { press: '5' },
          { press: 'Enter' },
          { expectText: VECTOR_STATUS, text: 'Size: 1920, 1 (last)' },
          { expectValue: VECTOR_AXIS('Size', 'y'), value: '1' },
        ],
      },
    ],
  },
  rotationField: {
    keyboard: [
      {
        name: 'an Euler angle steps by π / 8, shown as 22.5°; Tab reaches the order, a pick keeps the angles',
        steps: [
          { focusInBox: ROTATION_PART('Rotation', 'y') },
          { press: 'ArrowUp' },
          { expectValue: ROTATION_PART('Rotation', 'y'), value: '67.5' },
          { expectText: ROTATION_STATUS, text: 'Rotation: 0.000, 1.178, 0.000, XYZ (last)' },
          { press: 'Tab' },
          { press: 'Tab' },
          { expectFocus: ROTATION_ORDER },
          { press: 'Enter' },
          { press: 'ArrowDown' },
          { press: 'Enter' },
          { expectFocus: ROTATION_ORDER },
          { expectText: ROTATION_STATUS, text: 'Rotation: 0.000, 1.178, 0.000, YXZ (last)' },
          { expectValue: ROTATION_PART('Rotation', 'y'), value: '67.5' },
        ],
      },
      {
        name: 'a quaternion: a typed Euler angle, the raw components following',
        steps: [
          { focusInBox: ROTATION_PART('Facing', 'y') },
          { press: 'ControlOrMeta+A' },
          { press: '9' },
          { press: '0' },
          { press: 'Enter' },
          { expectText: ROTATION_STATUS, text: 'Facing: 0.000, 0.707, 0.000, 0.707 (last)' },
          {
            expectText: '#hubDemoRotationFacing .aekQuaternionField__raw',
            text: 'x 0.000, y 0.707, z 0.000, w 0.707',
          },
        ],
      },
      {
        name: 'axis-angle: the angle in degrees about the axis shown',
        steps: [
          { focusInBox: ROTATION_PART('Spin', 'angle') },
          { press: 'ControlOrMeta+A' },
          { press: '9' },
          { press: '0' },
          { press: 'Enter' },
          { expectText: ROTATION_STATUS, text: 'Spin: 0.707, 0.000, 0.000, 0.707 (last)' },
        ],
      },
    ],
  },
  angleDial: {
    keyboard: [
      {
        name: 'the spin button steps by π / 8, shown as 22.5°',
        steps: [
          { focusInBox: ANGLE('Heading') },
          { press: 'ArrowUp' },
          { expectValue: ANGLE('Heading'), value: '67.5' },
          { expectText: ANGLE_STATUS, text: 'Heading: 1.178 (last)' },
        ],
      },
      {
        name: 'a compass in degrees: a typed -90 wraps to 270',
        steps: [
          { focusInBox: ANGLE('Azimuth') },
          { press: 'ControlOrMeta+A' },
          { press: '-' },
          { press: '9' },
          { press: '0' },
          { press: 'Enter' },
          { expectValue: ANGLE('Azimuth'), value: '270' },
          { expectText: ANGLE_STATUS, text: 'Sun azimuth: 270 (last)' },
        ],
      },
      {
        name: 'without the spin button the dial is the slider: the arrows, Shift ×10, End',
        steps: [
          { focusInBox: ANGLE('Spin') },
          { press: 'ArrowRight' },
          { expectAttr: ANGLE('Spin'), name: 'aria-valuenow', value: '1' },
          { press: 'Shift+ArrowRight' },
          { expectAttr: ANGLE('Spin'), name: 'aria-valuenow', value: '11' },
          { press: 'End' },
          { expectAttr: ANGLE('Spin'), name: 'aria-valuenow', value: '180' },
          { expectText: ANGLE_STATUS, text: 'Spin: 3.142 (last)' },
        ],
      },
    ],
  },
  pad2d: {
    keyboard: [
      {
        name: 'the pad’s arrows move the point, Shift ×10; its axes follow',
        steps: [
          { focusInBox: PAD('Offset') },
          { press: 'ArrowRight' },
          { expectText: PAD_STATUS, text: 'Offset: 0.26, -0.5 (last)' },
          { press: 'Shift+ArrowUp' },
          { expectText: PAD_STATUS, text: 'Offset: 0.26, -0.4 (last)' },
          { expectValue: PAD_AXIS('Offset', 'y'), value: '-0.40' },
        ],
      },
      {
        name: 'Tab goes from the pad to its axes; y down: ArrowUp lowers y',
        steps: [
          { focusInBox: PAD('Anchor') },
          { press: 'ArrowUp' },
          { expectText: PAD_STATUS, text: 'Anchor: 50, 24 (last)' },
          { press: 'Tab' },
          { expectFocus: PAD_AXIS('Anchor', 'x') },
          { press: 'ControlOrMeta+A' },
          { press: '7' },
          { press: '5' },
          { press: 'Enter' },
          { expectText: PAD_STATUS, text: 'Anchor: 75, 24 (last)' },
        ],
      },
    ],
  },
  gradientEditor: {
    keyboard: [
      {
        name: 'a stop’s arrows move it; Insert adds one after it, focused; Delete removes it',
        steps: [
          { focusInBox: GRADIENT_STOP('Sky', 2) },
          { press: 'ArrowRight' },
          { expectAttr: GRADIENT_STOP('Sky', 2), name: 'aria-valuenow', value: '51' },
          {
            expectText: GRADIENT_STATUS,
            text: 'Sky ramp: #0b1d3a 0, #f2a65a 0.51, #9fd3ff 1 (last)',
          },
          { press: 'Insert' },
          { expectCount: GRADIENT_STOPS('Sky'), count: 4 },
          { expectFocus: GRADIENT_STOP('Sky', 3) },
          { press: 'Delete' },
          { expectCount: GRADIENT_STOPS('Sky'), count: 3 },
          { expectFocus: GRADIENT_STOP('Sky', 3) },
        ],
      },
      {
        name: 'Tab goes from the stops to the selected one’s position: a typed place',
        steps: [
          { focusInBox: GRADIENT_STOP('Sky', 3) },
          { press: 'Tab' },
          { expectFocus: GRADIENT_POSITION('Sky') },
          { press: 'ControlOrMeta+A' },
          { press: '9' },
          { press: '0' },
          { press: 'Enter' },
          { expectAttr: GRADIENT_STOP('Sky', 3), name: 'aria-valuenow', value: '90' },
          {
            expectText: GRADIENT_STATUS,
            text: 'Sky ramp: #0b1d3a 0, #f2a65a 0.5, #9fd3ff 0.9 (last)',
          },
        ],
      },
      {
        name: 'Enter on a stop opens its colour panel on the picker; Escape returns to the swatch',
        steps: [
          { focusInBox: GRADIENT_STOP('Fade', 2) },
          { press: 'Enter' },
          { expectAttr: GRADIENT_SWATCH('Fade'), name: 'aria-expanded', value: 'true' },
          { expectFocus: '[part="saturation"]' },
          { press: 'Escape' },
          { expectAttr: GRADIENT_SWATCH('Fade'), name: 'aria-expanded', value: 'false' },
          { expectFocus: GRADIENT_SWATCH('Fade') },
        ],
      },
    ],
  },
  curveEditor: {
    keyboard: [
      {
        name: 'a key’s arrows move it; Insert adds one after it, focused; Delete removes it',
        steps: [
          { focusInBox: CURVE_POINT('Falloff', 2) },
          { press: 'ArrowUp' },
          { expectAttr: CURVE_POINT('Falloff', 2), name: 'aria-valuenow', value: '0.61' },
          {
            expectText: CURVE_STATUS,
            text: 'Falloff: (0, 1), (8, 0.61), (20, 0) (last)',
          },
          { press: 'Insert' },
          { expectCount: CURVE_POINTS('Falloff'), count: 4 },
          { expectFocus: CURVE_POINT('Falloff', 3) },
          { press: 'Delete' },
          { expectCount: CURVE_POINTS('Falloff'), count: 3 },
          { expectFocus: CURVE_POINT('Falloff', 3) },
        ],
      },
      {
        name: 'Tab goes from the handles to the selected one’s X: a typed place',
        steps: [
          { focusInBox: CURVE_POINT('Easing', 2) },
          { press: 'Tab' },
          { expectFocus: CURVE_X('Easing') },
          { press: 'ControlOrMeta+A' },
          { press: '0' },
          { press: '.' },
          { press: '9' },
          { press: 'Enter' },
          {
            expectAttr: CURVE_POINT('Easing', 2),
            name: 'aria-valuetext',
            value: 'X 0.90, Y 1.00',
          },
          { expectText: CURVE_STATUS, text: 'Easing: 0.25, 0.1, 0.9, 1 (last)' },
        ],
      },
      {
        name: 'the presets menu: End and Enter pick smoothstep, the focus back on its button',
        steps: [
          { focusInBox: CURVE_PRESETS('Easing') },
          { press: 'Enter' },
          { expectAttr: CURVE_PRESETS('Easing'), name: 'aria-expanded', value: 'true' },
          { press: 'End' },
          { press: 'Enter' },
          { expectText: CURVE_STATUS, text: 'Easing: 0.333, 0, 0.667, 1 (last)' },
          { expectFocus: CURVE_PRESETS('Easing') },
        ],
      },
    ],
  },
  monitor: {
    keyboard: [
      {
        name: 'a step shows on the tick; Tab passes the lines and stops at the multiline block',
        steps: [
          { focusInBox: MONITOR('Step') },
          { press: 'Enter' },
          { expectText: `${MONITOR('Bodies')} .aekMonitor__value`, text: '132' },
          { expectText: `${MONITOR('Paused')} .aekMonitor__value`, text: 'On' },
          { expectText: `${MONITOR('Position')} .aekMonitor__value`, text: '1.25, 0.50, -3.50' },
          { press: 'Tab' },
          { expectFocus: MONITOR('Log') },
          {
            expectValue: MONITOR('Log'),
            value:
              'Loaded scene “Harbour”\nSpawned 128 bodies\nPhysics on the worker thread\nStep 1: 132 bodies',
          },
        ],
      },
    ],
  },
  folder: {
    keyboard: [
      {
        name: 'Enter shuts and opens a folder; Tab goes into it; no shadows hides the inner one',
        steps: [
          { focusInBox: FOLDER('Light') },
          { press: 'Enter' },
          { expectAttr: FOLDER('Light'), name: 'aria-expanded', value: 'false' },
          { expectText: FOLDER_STATUS, text: 'Sun light: shut' },
          { press: 'Enter' },
          { expectAttr: FOLDER('Light'), name: 'aria-expanded', value: 'true' },
          { press: 'Tab' },
          { expectFocus: FOLDER('Intensity') },
          { press: 'Tab' },
          { expectFocus: FOLDER('CastShadow') },
          { press: 'Space' },
          { expectAttr: `.aekFolder:has(> ${FOLDER('Shadow')})`, name: 'hidden', value: '' },
        ],
      },
      {
        name: 'a shut folder’s field is read when Space opens it',
        steps: [
          { focusInBox: FOLDER('Outside') },
          { press: 'Enter' },
          { focusInBox: FOLDER('Shadow') },
          { press: 'Space' },
          { expectAttr: FOLDER('Shadow'), name: 'aria-expanded', value: 'true' },
          { expectText: FOLDER_STATUS, text: 'Shadow: open' },
          // The bias isn't its default now: its reset button comes first
          { press: 'Tab' },
          { expectFocus: `.aekField:has(${FOLDER('Bias')}) .aekField__reset` },
          { press: 'Tab' },
          { expectFocus: FOLDER('Bias') },
          { expectValue: FOLDER('Bias'), value: '-0.0010' },
        ],
      },
    ],
  },
  fieldset: {
    keyboard: [
      {
        name: 'Tab goes from one section’s fields to the next’s',
        steps: [
          { focusInBox: FIELDSET('Region') },
          { press: 'Tab' },
          { expectFocus: FIELDSET('Email') },
        ],
      },
      {
        name: 'a disabled section’s fields are no tab stops',
        steps: [
          { click: 'Disable the notifications' },
          { focusInBox: FIELDSET('Region') },
          { press: 'Tab' },
          { expectFocus: FIELDSET('Done') },
        ],
      },
    ],
  },
  propertyGrid: {
    keyboard: [
      {
        name: 'the label column’s separator: the arrows, Shift and End move it; the keyup reports it',
        steps: [
          { focusInBox: GRID('Separator') },
          { press: 'ArrowRight' },
          { expectAttr: GRID('Separator'), name: 'aria-valuenow', value: '41' },
          { expectText: GRID('Status'), text: 'Label column: 41 %' },
          { press: 'Shift+ArrowLeft' },
          { expectAttr: GRID('Separator'), name: 'aria-valuenow', value: '31' },
          { press: 'End' },
          { expectAttr: GRID('Separator'), name: 'aria-valuenow', value: '80' },
          { expectText: GRID('Status'), text: 'Label column: 80 %' },
        ],
      },
      {
        name: 'Tab goes row by row, the separator after the rows',
        steps: [
          { focusInBox: GRID('Name') },
          { press: 'Tab' },
          { expectFocus: GRID('Speed') },
          { press: 'Tab' },
          { expectFocus: GRID('Wireframe') },
          { focusInBox: GRID('Outside') },
          { press: 'Shift+Tab' },
          { expectFocus: GRID('Separator') },
        ],
      },
    ],
  },
  form: {
    keyboard: [
      {
        name: 'Enter in a field submits: the summary takes the focus, and its link the field’s',
        steps: [
          { focusInBox: FORM('Name') },
          { press: 'Enter' },
          { expectFocus: FORM_SUMMARY },
          { expectCount: FORM_LINKS, count: 3 },
          { expectText: `${FORM_SUMMARY} li:first-child`, text: 'Enter a name' },
          { press: 'Tab' },
          { expectFocus: `${FORM_SUMMARY} li:first-child a` },
          { press: 'Enter' },
          { expectFocus: FORM('Name') },
        ],
      },
      {
        name: 'after a submit, a fixed field’s error and link go when the focus leaves it',
        steps: [
          { focusInBox: FORM('Name') },
          { press: 'Enter' },
          { focusInBox: FORM('Name') },
          { press: 'a' },
          { press: 'd' },
          { press: 'a' },
          { press: 'Tab' },
          { expectFocus: FORM('Region') },
          {
            expectAttr: `.aekField:has(> .aekField__control ${FORM('Name')})`,
            name: 'data-invalid',
            value: null,
          },
          { expectCount: FORM_LINKS, count: 2 },
        ],
      },
      {
        name: 'the reset button puts the defaults back and the summary away',
        steps: [
          { focusInBox: FORM('Name') },
          { press: 'Enter' },
          { focusInBox: `${FORM('Form')} button[type="reset"]` },
          { press: 'Enter' },
          { expectAttr: FORM_SUMMARY, name: 'hidden', value: '' },
          { expectText: FORM('Status'), text: 'Reset: every field at its default' },
        ],
      },
      {
        name: 'filled in, Enter submits: the status says so after the submit’s promise',
        steps: [
          { click: 'Fill it in' },
          { focusInBox: FORM('Name') },
          { press: 'Enter' },
          { expectText: FORM('Status'), text: 'Created Ada (Europe, 36)' },
          { expectAttr: FORM_SUMMARY, name: 'hidden', value: '' },
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
    // The indeterminate slide eases out fast (`--aek-ease-standard`): at a fifth of its time the
    // bar is mid-track (30-70 %), at the default 0.4 it's already past the right edge
    pauseAt: 0.2,
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
  skeleton: {
    keyboard: [
      {
        name: 'no keys; the skeletons are hidden, the card busy until its content is in',
        steps: [
          { expectAttr: `${SKELETON_CARD} .aekSkeleton`, name: 'aria-hidden', value: 'true' },
          { expectAttr: SKELETON_CARD, name: 'aria-busy', value: 'true' },
          { click: 'Load the content' },
          { expectCount: `${SKELETON_CARD} .aekSkeleton`, count: 0 },
          { expectAttr: SKELETON_CARD, name: 'aria-busy', value: null },
          { expectText: `${SKELETON_CARD} .hubDemoLine`, text: 'Best lap: 1:42.3, by Ada' },
        ],
      },
    ],
  },
  divider: {
    keyboard: [
      {
        name: 'no keys; an hr across, a vertical separator down the toolbar',
        steps: [
          { expectCount: `${DIVIDER_BOX} hr.aekDivider`, count: 1 },
          {
            expectAttr: `${DIVIDER_BOX} [data-orientation="vertical"]`,
            name: 'role',
            value: 'separator',
          },
          {
            expectAttr: `${DIVIDER_BOX} [data-orientation="vertical"]`,
            name: 'aria-orientation',
            value: 'vertical',
          },
        ],
      },
    ],
  },
  emptyState: {
    keyboard: [
      {
        name: 'its action is a button: Enter runs it',
        steps: [
          { expectText: `${EMPTY_SAVES} .aekEmptyState__title`, text: 'No saved games' },
          { focusInBox: `${EMPTY_SAVES} .aekEmptyState__action` },
          { press: 'Enter' },
          { expectText: '#hubDemoEmptyStatus', text: 'New game started' },
        ],
      },
    ],
  },
  loadingOverlay: {
    keyboard: [
      {
        name: 'no keys; its text is a status, its spinner hidden, a bar swapped in and a hide',
        steps: [
          { expectAttr: OVERLAY_PANEL, name: 'data-state', value: 'shown' },
          {
            expectAttr: `${OVERLAY_PANEL} .aekLoadingOverlay__text`,
            name: 'role',
            value: 'status',
          },
          { expectAttr: `${OVERLAY_PANEL} .aekSpinner`, name: 'aria-hidden', value: 'true' },
          { click: 'Show the progress' },
          { expectCount: `${OVERLAY_PANEL} .aekSpinner`, count: 0 },
          {
            expectAttr: `${OVERLAY_PANEL} [role="progressbar"]`,
            name: 'aria-valuenow',
            value: '60',
          },
          { click: 'Hide it' },
          { expectAttr: OVERLAY_PANEL, name: 'data-state', value: 'hidden' },
        ],
      },
      {
        name: 'over the HUD’s bounds: shown above the page, gone after the demo’s click',
        steps: [
          { click: 'Over the HUD’s bounds' },
          { expectAttr: OVERLAY_BOUNDS, name: 'data-state', value: 'shown' },
          { expectStyle: OVERLAY_BOUNDS, name: 'position', value: 'fixed' },
          { clickHud: '#hubDemoOverlayBounds' },
          { expectCount: OVERLAY_BOUNDS, count: 0 },
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
