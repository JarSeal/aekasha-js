/**
 * The command palette's checks (`yarn verify:ui`), next to its demo (`palette.ts`): plain data.
 * Its four Hub buttons are its states; the scripts type, move, choose and close, and one drives
 * the Hub's header search, which is this palette (p805 Phase 7 section 2).
 */
import type { UiDemoChecks } from '../_componentChecks';

const PALETTE = '#hudRoot .aekCommandPalette';
const INPUT = `${PALETTE} .aekCommandPalette__input`;
const STATUS = `${PALETTE} .aekCommandPalette__status`;
const ACTIVE = `${PALETTE} .aekCommandPalette__option[aria-selected='true']`;
/** The Hub's header search (`_search.ts`: the palette with the id `hubSearch`) */
const HUB_SEARCH = '#hudRoot #hubSearch';
const HUB_INPUT = `${HUB_SEARCH} .aekCommandPalette__input`;
const HUB_STATUS = `${HUB_SEARCH} .aekCommandPalette__status`;
const HUB_ACTIVE = `${HUB_SEARCH} .aekCommandPalette__option[aria-selected='true']`;
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
      {
        // p805 Phase 7 section 2: the Hub's own search is this palette (`_search.ts`); the
        // library page has the header like every page
        name: 'the Hub’s header search: ⌘K / Ctrl+K opens it over an inert page, its index loads, Escape gives the focus back, the query is kept, Enter opens the result’s section',
        steps: [
          { focusPage: '[data-hub-search]' },
          { press: 'Control+k' },
          { expectFocus: HUB_INPUT },
          { expectText: HUB_STATUS, text: 'Search the pages, their sections and code.' },
          { expectCount: 'body > .hubHeader[inert], body > .hubLayout[inert]', count: 2 },
          { expectCount: 'html.hubSearchOpen', count: 1 },
          { type: 'showing live data' },
          { expectText: `${HUB_SEARCH} .aekCommandPalette__groupLabel`, text: 'Features' },
          { expectText: `${HUB_ACTIVE} .hubSearchTitle`, text: 'Showing live data' },
          { expectText: `${HUB_ACTIVE} .hubSearchCrumbs`, text: 'UI kit › Data display' },
          { press: 'ArrowDown' },
          { press: 'ArrowUp' },
          { expectText: `${HUB_ACTIVE} .hubSearchTitle`, text: 'Showing live data' },
          { press: 'Escape' },
          { expectCount: HUB_SEARCH, count: 0 },
          { expectFocus: '[data-hub-search]' },
          { expectCount: '[inert]', count: 0 },
          { press: 'Control+k' },
          { expectValue: HUB_INPUT, value: 'showing live data' },
          { expectText: `${HUB_ACTIVE} .hubSearchTitle`, text: 'Showing live data' },
          { pressToNavigate: 'Enter' },
          { expectUrl: '/features/ui-kit/data/#showing-live-data' },
        ],
      },
    ],
  },
};
