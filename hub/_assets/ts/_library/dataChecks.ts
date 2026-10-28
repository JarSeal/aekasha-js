/**
 * The data display's checks (`data.ts`' demos): the list, the tree and the table so far.
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

/** A tree demo's node row by its id's name (`data.ts`' `TREE_ID`) and its key */
const NODE = (name: string, key: string) => `#hubDemoTree${name} .aekTree__row[data-key="${key}"]`;
const TREE_SEARCH = (name: string) => `#hubDemoTree${name} .aekTree__search`;
const TREE_COUNT = (name: string) => `#hubDemoTree${name} .aekTree__count`;
const TREE_STATUS_ROW = (name: string) => `#hubDemoTree${name} .aekTree__status`;
const TREE_STATUS = '#hubDemoTreeStatus';

/** A table demo by its id's name (`data.ts`' `TABLE_ID`), its scroll box and a row by its key */
const TABLE = (name: string) => `#hubDemoTable${name}`;
const TABLE_BOX = (name: string) => `${TABLE(name)} .aekTable__scroll`;
const TABLE_ROW = (name: string, key: string) => `${TABLE(name)} .aekTable__row[data-key="${key}"]`;
/** A table row's cell by its place (1: the first) */
const TABLE_CELL = (name: string, key: string, place: number) =>
  `${TABLE_ROW(name, key)} > :nth-child(${place})`;
const TABLE_HEADER = (name: string, key: string) => `${TABLE(name)} th[data-key="${key}"]`;
const TABLE_SORT = (name: string, key: string) => `${TABLE_HEADER(name, key)} .aekTable__sort`;
const TABLE_STATUS = '#hubDemoTableStatus';

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
  tree: {
    states: [{ name: 'Outline: a row clicked', steps: [{ clickInBox: NODE('Outline', 'props') }] }],
    keyboard: [
      {
        name: 'the APG tree: Left and Right close, open, enter and leave; a letter; * opens the siblings; Enter opens and selects',
        steps: [
          { focusInBox: NODE('Outline', 'world') },
          { press: 'ArrowLeft' },
          { expectAttr: NODE('Outline', 'world'), name: 'aria-expanded', value: 'false' },
          { press: 'ArrowDown' },
          { expectFocus: NODE('Outline', 'player') },
          { press: 'ArrowUp' },
          { press: 'ArrowRight' },
          { expectAttr: NODE('Outline', 'world'), name: 'aria-expanded', value: 'true' },
          { expectFocus: NODE('Outline', 'world') },
          { press: 'ArrowRight' },
          { expectFocus: NODE('Outline', 'camera') },
          { press: 'p' },
          { expectFocus: NODE('Outline', 'props') },
          { press: 'ArrowRight' },
          { press: 'ArrowRight' },
          { expectFocus: NODE('Outline', 'crate') },
          { expectAttr: NODE('Outline', 'crate'), name: 'aria-level', value: '3' },
          { press: 'ArrowLeft' },
          { expectFocus: NODE('Outline', 'props') },
          { press: '*' },
          { expectAttr: NODE('Outline', 'vegetation'), name: 'aria-expanded', value: 'true' },
          { press: 'Enter' },
          { expectText: TREE_STATUS, text: 'Opened: Props' },
          { expectAttr: NODE('Outline', 'props'), name: 'aria-selected', value: 'true' },
          { press: 'End' },
          { expectFocus: NODE('Outline', 'ui') },
          { press: 'Home' },
          { expectFocus: NODE('Outline', 'world') },
        ],
      },
      {
        name: 'the filter: the matches with their ancestors, opened and counted; a cleared query keeps the focused node shown',
        steps: [
          { focusInBox: TREE_SEARCH('Outline') },
          { press: 'r' },
          { press: 'o' },
          { expectText: TREE_COUNT('Outline'), text: '2 of 19' },
          { expectText: `${NODE('Outline', 'rock')} .aekTree__title mark`, text: 'Ro' },
          { expectCount: NODE('Outline', 'crate'), count: 0 },
          { press: 'ArrowDown' },
          { expectFocus: NODE('Outline', 'world') },
          { press: 'End' },
          { expectFocus: NODE('Outline', 'rock') },
          { press: 'Shift+Tab' },
          { expectFocus: TREE_SEARCH('Outline') },
          { press: 'Escape' },
          { expectValue: TREE_SEARCH('Outline'), value: '' },
          { expectText: TREE_COUNT('Outline'), text: '19' },
          { expectAttr: NODE('Outline', 'vegetation'), name: 'aria-expanded', value: 'true' },
          { expectAttr: NODE('Outline', 'rock'), name: 'tabindex', value: '0' },
        ],
      },
      {
        name: 'lazy children: Right loads and enters, a failure’s row takes the focus and Enter retries',
        steps: [
          { focusInBox: NODE('Assets', 'textures') },
          { press: 'ArrowRight' },
          { expectCount: NODE('Assets', 'textures/stone'), count: 1 },
          { press: 'ArrowRight' },
          { expectFocus: NODE('Assets', 'textures/stone') },
          { press: 'ArrowRight' },
          { expectCount: NODE('Assets', 'textures/stone/albedo.ktx2'), count: 1 },
          { press: 'ArrowLeft' },
          { expectAttr: NODE('Assets', 'textures/stone'), name: 'aria-expanded', value: 'false' },
          { press: 'ArrowLeft' },
          { press: 'ArrowLeft' },
          { expectFocus: NODE('Assets', 'textures') },
          { expectCount: NODE('Assets', 'textures/stone'), count: 0 },
          { press: 'ArrowDown' },
          { press: 'ArrowDown' },
          { press: 'ArrowRight' },
          { expectAttr: TREE_STATUS_ROW('Assets'), name: 'data-status', value: 'error' },
          { press: 'ArrowRight' },
          { expectFocus: TREE_STATUS_ROW('Assets') },
          { press: 'Enter' },
          { expectCount: NODE('Assets', 'remote/props.glb'), count: 1 },
          { expectFocus: NODE('Assets', 'remote') },
        ],
      },
      {
        name: 'virtual rows: * opens every chunk, End renders and focuses the last of 5,040, its place said; the filter finds one far down',
        steps: [
          { focusInBox: NODE('Tiles', 'c0') },
          { press: '*' },
          // The last chunk is far below the box, so its row isn't rendered: End shows it opened
          { press: 'End' },
          { expectFocus: NODE('Tiles', 'c39t124') },
          { expectAttr: NODE('Tiles', 'c39t124'), name: 'aria-level', value: '2' },
          { expectAttr: NODE('Tiles', 'c39t124'), name: 'aria-posinset', value: '125' },
          { expectCount: NODE('Tiles', 'c20t0'), count: 0 },
          { press: 'Home' },
          { expectFocus: NODE('Tiles', 'c0') },
          { focusInBox: TREE_SEARCH('Tiles') },
          { press: '3' },
          { press: '9' },
          { press: '.' },
          { press: '1' },
          { press: '2' },
          { press: '4' },
          { expectText: TREE_COUNT('Tiles'), text: '1 of 5040' },
          { press: 'ArrowDown' },
          { press: 'ArrowDown' },
          { expectFocus: NODE('Tiles', 'c39t124') },
        ],
      },
    ],
  },
  table: {
    states: [
      {
        name: 'Heaviest: a row clicked',
        steps: [{ clickInBox: TABLE_CELL('Heaviest', 'tree', 2) }],
      },
      {
        name: 'Heaviest: a row’s context menu',
        steps: [{ contextClickInBox: TABLE_CELL('Heaviest', 'rock', 3) }],
      },
    ],
    keyboard: [
      {
        name: 'a sortable header’s button: Enter sorts ascending, then descending, its mark and the report',
        steps: [
          { focusInBox: TABLE_SORT('Kinds', 'name') },
          { press: 'Enter' },
          { expectAttr: TABLE_HEADER('Kinds', 'name'), name: 'aria-sort', value: 'ascending' },
          { expectAttr: TABLE_HEADER('Kinds', 'triangles'), name: 'aria-sort', value: null },
          { expectText: TABLE_STATUS, text: 'Sorted: name, ascending' },
          {
            expectText: `${TABLE('Kinds')} tbody .aekTable__row:first-child th`,
            text: 'Impostors',
          },
          { press: 'Enter' },
          { expectAttr: TABLE_HEADER('Kinds', 'name'), name: 'aria-sort', value: 'descending' },
          { expectText: `${TABLE('Kinds')} tbody .aekTable__row:first-child th`, text: 'Sprites' },
          { expectFocus: TABLE_SORT('Kinds', 'name') },
        ],
      },
      {
        name: 'the grid: one tab stop, the arrows over the cells and into the headers, Space and Shift select, Enter opens',
        steps: [
          { focusInBox: TABLE_CELL('Heaviest', 'terrain', 1) },
          { press: 'ArrowDown' },
          { expectFocus: TABLE_CELL('Heaviest', 'tree', 1) },
          { press: 'ArrowRight' },
          { expectFocus: TABLE_CELL('Heaviest', 'tree', 2) },
          { press: 'Space' },
          { expectAttr: TABLE_ROW('Heaviest', 'tree'), name: 'aria-selected', value: 'true' },
          { press: 'Shift+ArrowDown' },
          { expectAttr: TABLE_ROW('Heaviest', 'rock'), name: 'aria-selected', value: 'true' },
          { expectText: TABLE_STATUS, text: 'Selected: tree, rock' },
          { expectFocus: TABLE_CELL('Heaviest', 'rock', 2) },
          { press: 'Enter' },
          { expectText: TABLE_STATUS, text: 'Opened: Rock' },
          { press: 'Control+Home' },
          { expectFocus: TABLE_SORT('Heaviest', 'name') },
          { press: 'ArrowRight' },
          { press: 'ArrowRight' },
          { press: 'ArrowRight' },
          { expectFocus: TABLE_HEADER('Heaviest', 'edit') },
          { press: 'Tab' },
          { expectCount: `${TABLE('Heaviest')} [tabindex="0"]`, count: 1 },
          { press: 'Shift+Tab' },
          { expectFocus: TABLE_HEADER('Heaviest', 'edit') },
        ],
      },
      {
        name: 'the grid: Enter into a cell’s button and Escape back; Shift+F10 opens the row’s context menu, Escape returns',
        steps: [
          { focusInBox: TABLE_CELL('Heaviest', 'water', 1) },
          { press: 'End' },
          { expectFocus: TABLE_CELL('Heaviest', 'water', 4) },
          { press: 'Enter' },
          { expectFocus: `${TABLE_CELL('Heaviest', 'water', 4)} button` },
          // The button's tooltip (a keyboard focus shows it) takes the first Escape, the kit's rule
          { press: 'Escape' },
          { press: 'Escape' },
          { expectFocus: TABLE_CELL('Heaviest', 'water', 4) },
          { press: 'F2' },
          { press: 'Enter' },
          { expectText: TABLE_STATUS, text: 'Edit: Water' },
          { press: 'F2' },
          { press: 'ArrowLeft' },
          { press: 'Shift+F10' },
          { expectFocus: '#hudRoot .aekMenu [role="menuitem"]' },
          { press: 'Escape' },
          { expectFocus: TABLE_CELL('Heaviest', 'water', 3) },
        ],
      },
      {
        name: 'the box that overflows is a tab stop named by the caption; the others aren’t; the narrow one stacks',
        steps: [
          { focusInBox: TABLE_BOX('Owners') },
          { expectFocus: TABLE_BOX('Owners') },
          { expectAttr: TABLE_BOX('Owners'), name: 'role', value: 'region' },
          {
            expectAttr: TABLE_BOX('Owners'),
            name: 'aria-labelledby',
            value: 'hubDemoTableOwners-caption',
          },
          { expectAttr: TABLE_BOX('Overview'), name: 'tabindex', value: null },
          { expectAttr: TABLE_ROW('Owners', 'total'), name: 'data-key', value: 'total' },
          { expectAttr: TABLE('Assets'), name: 'data-stacked', value: '' },
          { expectAttr: TABLE('Overview'), name: 'data-stacked', value: null },
        ],
      },
    ],
  },
};
