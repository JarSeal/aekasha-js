/**
 * The fields' checks (`fields.ts`' demos): the drop-down, the number field, the slider and range
 * slider, the radio group, the select field, the text field, the checkbox and the monitor.
 */
import type { UiDemoChecks } from '../_componentChecks';

/** An open drop-down's list (the dialog's drop-down too: `overlaysChecks.ts`) */
export const LIST = '#hudRoot .aekDropDownList';
const TRIGGER = '#hudRoot .aekDropDownTrigger';
/** The searchable drop-down's trigger: the panel's sixth row (`createDropDownPanel`) */
const SEARCHABLE_TRIGGER = '.hubDemoDropDowns > .aekDropDown:nth-of-type(6) .aekDropDownTrigger';
const SEARCH = '#hudRoot .aekDropDownSearch';
const SEARCH_LIST = '#hudRoot .aekDropDownPopup .aekDropDownList';
/** A number field's input by its label (`fields.ts`' `NUMBER_ID`), its reset button, and
 * the box's status line */
const NUMBER = (name: string) => `#hubDemoNumber${name}`;
const NUMBER_RESET = (name: string) => `.aekField:has(${NUMBER(name)}) .aekField__reset`;
const NUMBER_STATUS = '#hubDemoNumberStatus';
/** A slider's control by its name (`fields.ts`' `SLIDER_ID`: the spin button, or the thumb
 * without the input), and the box's status line */
const SLIDER = (name: string) => `#hubDemoSlider${name}`;
const SLIDER_STATUS = '#hubDemoSliderStatus';
/** A range slider's stop by its name (`fields.ts`' `RANGE_ID`) and part (`min`, `max`,
 * `range`: the span), and the box's status line */
const RANGE = (name: string, part: 'min' | 'max' | 'range') => `#hubDemoRange${name}-${part}`;
const RANGE_STATUS = '#hubDemoRangeStatus';
/** A radio of the radio group box by its group's name (`fields.ts`' `RADIO_ID`) and place,
 * the same checked, and the box's status line */
const RADIO = (name: string, index: number) => `#hubDemoRadio${name}-${index}`;
const RADIO_CHECKED = (name: string, index: number) => `${RADIO(name, index)}:checked`;
const RADIO_STATUS = '#hubDemoRadioStatus';
/** A select field's trigger by its name (`fields.ts`' `SELECT_ID`), its shown value, and the
 * box's status line */
const SELECT = (name: string) => `#hubDemoSelect${name}`;
const SELECT_VALUE = (name: string) => `${SELECT(name)} .aekDropDownLabel`;
const SELECT_STATUS = '#hubDemoSelectStatus';
/** The select box's open list and filter: in the field (the Popover API's top layer leaves it in
 * its place), not in the HUD root as a window's drop-down is */
const SELECT_LIST = '[data-hub-demo="selectField"] .aekDropDownList';
const SELECT_SEARCH = '[data-hub-demo="selectField"] .aekDropDownSearch';
/** A text field's input by its label (`fields.ts`' `TEXT_ID`), and the box's lines */
const TEXT = (name: string) => `#hubDemoText${name}`;
const TEXT_STATUS = '#hubDemoTextStatus';
const TEXT_RESULTS = '#hubDemoTextResults';
const SEARCH_CLEAR = `.aekField:has(${TEXT('Search')}) .aekTextField__clear`;
/** A checkbox's or a switch's input by its name (`TOGGLE_ID`), and the box's status line */
const TOGGLE = (name: string) => `#hubDemoToggle${name}`;
const TOGGLE_STATUS = '#hubDemoToggleStatus';
const LAYERS_ON = '[data-hub-demo="checkbox"] .hubDemoNestedToggles input:checked';
/** A monitor by its name (`MONITOR_ID`): the line's element, or the multiline text area */
const MONITOR = (name: string) => `#hubDemoMonitor${name}`;

/** The fields group's checks by their demo's key (`data-hub-demo`) */
export const FIELDS_CHECKS: Record<string, UiDemoChecks> = {
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
};
