/**
 * The data display's checks (`data.ts`' demos): the list so far.
 */
import type { UiDemoChecks } from '../_componentChecks';

/** A list demo's row by its id's name (`data.ts`' `LIST_ID`) and its key */
const ROW = (name: string, key: string) => `#hubDemoList${name} .aekList__row[data-key="${key}"]`;
/** A grid row's cell: its main cell, or its action button by the action's index */
const MAIN = (name: string, key: string) => `${ROW(name, key)} .aekList__main`;
const ACTION = (name: string, key: string, index: number) =>
  `${ROW(name, key)} .aekList__action[data-action="${index}"]`;
const SEARCH = (name: string) => `#hubDemoList${name} .aekList__search`;
const COUNT = (name: string) => `#hubDemoList${name} .aekList__count`;
const LIST_STATUS = '#hubDemoListStatus';

/** The data group's checks by their demo's key (`data-hub-demo`) */
export const DATA_CHECKS: Record<string, UiDemoChecks> = {
  list: {
    states: [
      { name: 'Objects: a row clicked', steps: [{ clickInBox: ROW('Objects', 'terrain') }] },
    ],
    keyboard: [
      {
        name: 'selectable: the arrows don’t wrap, a letter finds a title, Enter opens and selects; one tab stop',
        steps: [
          { focusInBox: ROW('Objects', 'camera') },
          { press: 'ArrowUp' },
          { expectFocus: ROW('Objects', 'camera') },
          { press: 'ArrowDown' },
          { expectFocus: ROW('Objects', 'sun') },
          { press: 'End' },
          { expectFocus: ROW('Objects', 'gate') },
          { press: 'Home' },
          { press: 'p' },
          { expectFocus: ROW('Objects', 'player') },
          { press: 'p' },
          { expectFocus: ROW('Objects', 'tree') },
          { press: 'Enter' },
          { expectAttr: ROW('Objects', 'tree'), name: 'aria-selected', value: 'true' },
          { expectText: LIST_STATUS, text: 'Opened: Pine tree' },
          { press: 'Tab' },
          { expectFocus: ROW('Layers', 'water') },
          { press: 'Shift+Tab' },
          { expectFocus: ROW('Objects', 'tree') },
        ],
      },
      {
        name: 'the filter field: typing filters (the suffix too) and counts, ArrowDown enters the list, Escape empties it',
        steps: [
          { focusInBox: SEARCH('Objects') },
          { press: 'r' },
          { press: 'o' },
          { expectText: COUNT('Objects'), text: '2 of 12' },
          { expectText: `${ROW('Objects', 'rock')} .aekList__title mark`, text: 'Ro' },
          { expectText: `${ROW('Objects', 'player')} .aekList__suffix mark`, text: 'ro' },
          { press: 'ArrowDown' },
          { expectFocus: ROW('Objects', 'player') },
          { press: 'ArrowDown' },
          { expectFocus: ROW('Objects', 'rock') },
          { press: 'ArrowDown' },
          { expectFocus: ROW('Objects', 'rock') },
          { press: 'Shift+Tab' },
          { expectFocus: SEARCH('Objects') },
          { press: 'Escape' },
          { expectValue: SEARCH('Objects'), value: '' },
          { expectText: COUNT('Objects'), text: '12' },
        ],
      },
      {
        name: 'multiple: Space toggles, Shift + ArrowDown selects a range, Control + A every row and none',
        steps: [
          { focusInBox: ROW('Layers', 'terrain') },
          { press: 'Space' },
          { expectText: LIST_STATUS, text: 'Layers: terrain, water, props' },
          { press: 'ArrowDown' },
          { press: 'Space' },
          { expectAttr: ROW('Layers', 'water'), name: 'aria-selected', value: 'false' },
          { press: 'Shift+ArrowDown' },
          { press: 'Shift+ArrowDown' },
          { expectText: LIST_STATUS, text: 'Layers: water, props, foliage' },
          { press: 'Control+a' },
          { expectText: LIST_STATUS, text: 'Layers: terrain, water, props, foliage, lights' },
          { press: 'Control+a' },
          { expectText: LIST_STATUS, text: 'Layers: none' },
        ],
      },
      {
        name: 'virtual rows: End renders and focuses the last of 5,000, its place said; the filter finds one far down',
        steps: [
          { focusInBox: ROW('Assets', 'asset0') },
          { expectAttr: ROW('Assets', 'asset0'), name: 'aria-setsize', value: '5000' },
          { press: 'End' },
          { expectFocus: ROW('Assets', 'asset4999') },
          { expectAttr: ROW('Assets', 'asset4999'), name: 'aria-posinset', value: '5000' },
          { expectCount: ROW('Assets', 'asset2500'), count: 0 },
          { press: 'Home' },
          { expectFocus: ROW('Assets', 'asset0') },
          { focusInBox: SEARCH('Assets') },
          { press: '4' },
          { press: '9' },
          { press: '9' },
          { press: '9' },
          { expectText: COUNT('Assets'), text: '1 of 5000' },
          { press: 'ArrowDown' },
          { expectFocus: ROW('Assets', 'asset4998') },
        ],
      },
      {
        name: 'reorder: Alt + ArrowDown moves the focused row and keeps the focus on it; Alt + ArrowUp back',
        steps: [
          // A plain arrow first: Chromium shows no focus ring for a key pressed with Alt after a
          // scripted focus, as for a click
          { focusInBox: ROW('Order', 'sky') },
          { press: 'ArrowDown' },
          { expectFocus: ROW('Order', 'opaque') },
          { press: 'Alt+ArrowDown' },
          { expectText: LIST_STATUS, text: 'Moved Opaque to 3' },
          {
            expectAttr: '#hubDemoListOrder .aekList__row:nth-child(3)',
            name: 'data-key',
            value: 'opaque',
          },
          { expectFocus: ROW('Order', 'opaque') },
          { press: 'Alt+ArrowUp' },
          { press: 'Alt+ArrowUp' },
          { expectText: LIST_STATUS, text: 'Moved Opaque to 1' },
          {
            expectAttr: '#hubDemoListOrder .aekList__row:nth-child(1)',
            name: 'data-key',
            value: 'opaque',
          },
          { press: 'Alt+ArrowUp' },
          { expectFocus: ROW('Order', 'opaque') },
        ],
      },
      {
        name: 'actions: Right to a toggle, Space presses it, Down keeps the column, past a hidden one to the row',
        steps: [
          { focusInBox: MAIN('Lights', 'sun') },
          { press: 'ArrowRight' },
          { expectFocus: ACTION('Lights', 'sun', 0) },
          { press: 'Space' },
          { expectAttr: ACTION('Lights', 'sun', 0), name: 'aria-pressed', value: 'false' },
          { expectText: LIST_STATUS, text: 'Sun off' },
          { press: 'ArrowRight' },
          { expectFocus: ACTION('Lights', 'sun', 0) },
          { press: 'ArrowDown' },
          { expectFocus: ACTION('Lights', 'lamp', 0) },
          { press: 'ArrowRight' },
          { expectFocus: ACTION('Lights', 'lamp', 1) },
          { press: 'Enter' },
          { expectAttr: ACTION('Lights', 'lamp', 1), name: 'aria-pressed', value: 'false' },
          { press: 'ArrowUp' },
          { expectFocus: MAIN('Lights', 'sun') },
          { press: 'Enter' },
          { expectText: LIST_STATUS, text: 'Opened: Sun' },
          { expectAttr: ROW('Lights', 'sun'), name: 'aria-selected', value: 'true' },
        ],
      },
    ],
  },
};
