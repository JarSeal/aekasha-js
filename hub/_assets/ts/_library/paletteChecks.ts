/**
 * The command palette's checks (`yarn verify:ui`), next to its demo (`palette.ts`): plain data.
 * Its four Hub buttons are its states; the scripts type, move, choose and close.
 */
import type { UiDemoChecks } from '../_componentChecks';

const PALETTE = '#hudRoot .aekCommandPalette';
const INPUT = `${PALETTE} .aekCommandPalette__input`;
const STATUS = `${PALETTE} .aekCommandPalette__status`;
const ACTIVE = `${PALETTE} .aekCommandPalette__option[aria-selected='true']`;
/** The demo box's own status line, under its buttons */
const DEMO_STATUS = '[data-hub-demo="commandPalette"] .hubDemoLine';

export const PALETTE_CHECKS: Record<string, UiDemoChecks> = {
  commandPalette: {
    keyboard: [
      {
        name: 'it opens on the recent command; typing ranks the commands, Enter runs the active one and closes, the focus back on the opener',
        steps: [
          { focusBox: 'Open the commands' },
          { press: 'Enter' },
          { expectCount: PALETTE, count: 1 },
          { expectFocus: INPUT },
          { expectAttr: INPUT, name: 'aria-expanded', value: 'true' },
          { expectText: `${ACTIVE} .aekCommandPalette__optionLabel`, text: 'Frame the selection' },
          { press: 'ArrowDown' },
          { expectText: `${ACTIVE} .aekCommandPalette__optionLabel`, text: 'Reset the camera' },
          { press: 'ArrowUp' },
          { press: 'ArrowUp' },
          { expectText: `${ACTIVE} .aekCommandPalette__optionLabel`, text: 'Save the scene' },
          { press: 't' },
          { press: 'o' },
          { press: 'g' },
          { expectText: STATUS, text: '1 result' },
          { expectText: `${ACTIVE} .aekCommandPalette__optionLabel`, text: 'Toggle the grid' },
          { expectText: `${ACTIVE} mark`, text: 'Tog' },
          { press: 'Enter' },
          { expectCount: PALETTE, count: 0 },
          { expectText: DEMO_STATUS, text: 'Ran: Toggle the grid (hidden)' },
          { expectFocusBox: 'Open the commands' },
        ],
      },
      {
        name: 'Tab stays between the input and Close; Escape closes, the focus back on the opener',
        steps: [
          { focusBox: 'Open with “tog”' },
          { press: 'Enter' },
          { expectFocus: INPUT },
          { expectValue: INPUT, value: 'tog' },
          { press: 'Tab' },
          { expectFocus: `${PALETTE} .aekCommandPalette__close` },
          { press: 'Tab' },
          { expectFocus: INPUT },
          { press: 'Escape' },
          { expectCount: PALETTE, count: 0 },
          { expectFocusBox: 'Open with “tog”' },
        ],
      },
      {
        name: 'a search through a source: the first query loads its index, then its results come grouped; ArrowUp wraps to the last, Enter opens it',
        steps: [
          { focusBox: 'Search the pages' },
          { press: 'Enter' },
          { expectText: STATUS, text: 'Search the UI kit’s pages.' },
          { press: 't' },
          { expectText: STATUS, text: 'Loading the index…' },
          { press: 'a' },
          { press: 'b' },
          // Lists ("selectable"), Tables and Tabs, in two groups
          { expectText: STATUS, text: '3 results' },
          { expectText: `${ACTIVE} .hubDemoPaletteTitle`, text: 'Lists' },
          { press: 'ArrowUp' },
          { expectText: `${ACTIVE} .hubDemoPaletteTitle`, text: 'Tabs' },
          { press: 'Enter' },
          { expectCount: PALETTE, count: 0 },
          { expectText: DEMO_STATUS, text: 'Opened: Tabs' },
        ],
      },
    ],
  },
};
