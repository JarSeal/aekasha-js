/**
 * The layout pieces' checks (`layout.ts`' demos): the tabs, the accordion and the splitter.
 */
import type { UiDemoChecks } from '../_componentChecks';

/** A tab of a tabs demo by its id's name (`layout.ts`' `TABS_ID`) and its key */
const TAB = (name: string, key: string) => `#hubDemoTabs${name} [data-tab-key="${key}"]`;
const TABS_LIST = (name: string) => `#hubDemoTabs${name} .aekTabs__list`;
const SHOWN_PANEL = (name: string) => `#hubDemoTabs${name} .aekTabs__panel:not([hidden])`;
const TABS_STATUS = '#hubDemoTabsStatus';
/** An accordion demo's section by its id's name (`layout.ts`' `ACCORDION_ID`) and its key: its
 * header and its panel */
const SECTION = (name: string, key: string) => `#hubDemoAccordion${name} [data-key="${key}"]`;
const HEADER = (name: string, key: string) => `${SECTION(name, key)} .aekAccordion__trigger`;
const PANEL = (name: string, key: string) => `${SECTION(name, key)} .aekAccordion__region`;
const ACCORDION_STATUS = '#hubDemoAccordionStatus';
/** A splitter demo's separator and first pane by its id's name (`layout.ts`' `SPLITTER_ID`) */
const SEPARATOR = (name: string) => `#hubDemoSplitter${name} > .aekSplitter__separator`;
const FIRST_PANE = (name: string) => `#hubDemoSplitter${name} > [data-pane="first"]`;
const SPLITTER_STATUS = '#hubDemoSplitterStatus';

/** The layout group's checks by their demo's key (`data-hub-demo`) */
export const LAYOUT_CHECKS: Record<string, UiDemoChecks> = {
  tabs: {
    keyboard: [
      {
        name: 'automatic: the arrows select, wrapping past the disabled tab; Tab goes to the panel and back',
        steps: [
          { focusInBox: TAB('Scene', 'scene') },
          { press: 'ArrowRight' },
          { expectFocus: TAB('Scene', 'lighting') },
          { expectAttr: TAB('Scene', 'lighting'), name: 'aria-selected', value: 'true' },
          { expectText: TABS_STATUS, text: 'Scene settings: lighting' },
          { press: 'ArrowRight' },
          { expectFocus: TAB('Scene', 'render') },
          { press: 'ArrowRight' },
          { expectFocus: TAB('Scene', 'scene') },
          { press: 'End' },
          { expectFocus: TAB('Scene', 'render') },
          { expectText: SHOWN_PANEL('Scene'), text: 'PostFX and the tone map.' },
          { press: 'Tab' },
          { expectFocus: SHOWN_PANEL('Scene') },
          { press: 'Shift+Tab' },
          { expectFocus: TAB('Scene', 'render') },
        ],
      },
      {
        name: 'manual: the arrows move the focus only, Enter selects; back into the list lands on the selected tab',
        steps: [
          { focusInBox: TAB('Inspector', 'props') },
          { press: 'ArrowRight' },
          { expectFocus: TAB('Inspector', 'stats') },
          { expectAttr: TAB('Inspector', 'stats'), name: 'aria-selected', value: 'false' },
          { press: 'Enter' },
          { expectAttr: TAB('Inspector', 'stats'), name: 'aria-selected', value: 'true' },
          { expectText: TABS_STATUS, text: 'Inspector: stats' },
          { expectText: SHOWN_PANEL('Inspector'), text: 'Frame time and draw calls: built once.' },
          { press: 'ArrowRight' },
          { expectFocus: TAB('Inspector', 'log') },
          { press: 'Tab' },
          { expectFocus: SHOWN_PANEL('Inspector') },
          { press: 'Shift+Tab' },
          { expectFocus: TAB('Inspector', 'stats') },
          { press: 'ArrowLeft' },
          { press: 'Space' },
          { expectAttr: TAB('Inspector', 'props'), name: 'aria-selected', value: 'true' },
          { press: 'ArrowRight' },
          { press: 'Enter' },
          { expectText: SHOWN_PANEL('Inspector'), text: 'Frame time and draw calls: built once.' },
        ],
      },
      {
        name: 'vertical: Up and Down move and select, Left and Right don’t; across the divider',
        steps: [
          { focusInBox: TAB('Drawer', 'scene') },
          { press: 'ArrowDown' },
          { expectFocus: TAB('Drawer', 'info') },
          { expectAttr: TAB('Drawer', 'info'), name: 'aria-selected', value: 'true' },
          { press: 'ArrowRight' },
          { expectFocus: TAB('Drawer', 'info') },
          { press: 'ArrowUp' },
          { press: 'ArrowUp' },
          { expectFocus: TAB('Drawer', 'boxes') },
          { press: 'ArrowUp' },
          { expectFocus: TAB('Drawer', 'history') },
        ],
      },
      {
        name: 'overflowing: End scrolls the last tab into view, the start edge faded; Home back',
        steps: [
          { focusInBox: TAB('Layers', 't1') },
          { expectAttr: TABS_LIST('Layers'), name: 'data-overflow', value: 'end' },
          { press: 'End' },
          { expectFocus: TAB('Layers', 't10') },
          { expectAttr: TABS_LIST('Layers'), name: 'data-overflow', value: 'start' },
          { press: 'Home' },
          { expectFocus: TAB('Layers', 't1') },
          { expectAttr: TABS_LIST('Layers'), name: 'data-overflow', value: 'end' },
        ],
      },
    ],
  },
  accordion: {
    keyboard: [
      {
        name: 'one open: Enter and Space open a section and shut the other; the arrows move between headers, wrapping; each header a tab stop',
        steps: [
          { focusInBox: HEADER('Help', 'move') },
          { expectAttr: HEADER('Help', 'move'), name: 'aria-expanded', value: 'true' },
          { press: 'ArrowDown' },
          { expectFocus: HEADER('Help', 'save') },
          { press: 'Enter' },
          { expectAttr: HEADER('Help', 'save'), name: 'aria-expanded', value: 'true' },
          { expectAttr: HEADER('Help', 'move'), name: 'aria-expanded', value: 'false' },
          { expectAttr: PANEL('Help', 'move'), name: 'hidden', value: '' },
          { expectText: ACCORDION_STATUS, text: 'Help: save open' },
          { press: 'End' },
          { expectFocus: HEADER('Help', 'quit') },
          { press: 'ArrowDown' },
          { expectFocus: HEADER('Help', 'move') },
          { press: 'Space' },
          { expectAttr: HEADER('Help', 'move'), name: 'aria-expanded', value: 'true' },
          { press: 'Tab' },
          { expectFocus: HEADER('Help', 'save') },
        ],
      },
      {
        name: 'several open: the arrows pass the disabled section; Audio is built once',
        steps: [
          { focusInBox: HEADER('Settings', 'video') },
          { press: 'Enter' },
          { press: 'ArrowDown' },
          { expectFocus: HEADER('Settings', 'audio') },
          { press: 'Space' },
          { expectText: PANEL('Settings', 'audio'), text: 'Volumes and the output: built once.' },
          { expectText: ACCORDION_STATUS, text: 'Settings: video, audio open' },
          { press: 'ArrowDown' },
          { expectFocus: HEADER('Settings', 'controls') },
          { press: 'ArrowUp' },
          { press: 'Enter' },
          { expectAttr: PANEL('Settings', 'audio'), name: 'hidden', value: '' },
          { press: 'Enter' },
          { expectText: PANEL('Settings', 'audio'), text: 'Volumes and the output: built once.' },
          { expectAttr: HEADER('Settings', 'video'), name: 'aria-expanded', value: 'true' },
        ],
      },
    ],
  },
  splitter: {
    keyboard: [
      {
        name: 'side by side: Left and Right move it (Shift ×10), Home and End to its range, Enter collapses and restores',
        steps: [
          { focusInBox: SEPARATOR('Outline') },
          { expectAttr: SEPARATOR('Outline'), name: 'aria-valuenow', value: '35' },
          { press: 'ArrowRight' },
          { expectAttr: SEPARATOR('Outline'), name: 'aria-valuenow', value: '36' },
          { expectText: SPLITTER_STATUS, text: 'Outline width: 36 %' },
          { press: 'Shift+ArrowLeft' },
          { expectAttr: SEPARATOR('Outline'), name: 'aria-valuenow', value: '26' },
          { press: 'ArrowDown' },
          { expectAttr: SEPARATOR('Outline'), name: 'aria-valuenow', value: '26' },
          { press: 'Home' },
          { expectAttr: SEPARATOR('Outline'), name: 'aria-valuetext', value: '15 %' },
          { press: 'End' },
          { expectText: SPLITTER_STATUS, text: 'Outline width: 70 %' },
          { press: 'Enter' },
          { expectAttr: SEPARATOR('Outline'), name: 'aria-valuetext', value: 'Collapsed' },
          { expectAttr: FIRST_PANE('Outline'), name: 'hidden', value: '' },
          { expectText: SPLITTER_STATUS, text: 'Outline collapsed' },
          { press: 'Enter' },
          { expectAttr: SEPARATOR('Outline'), name: 'aria-valuenow', value: '70' },
          { expectAttr: FIRST_PANE('Outline'), name: 'hidden', value: null },
          { expectText: SPLITTER_STATUS, text: 'Outline restored' },
        ],
      },
      {
        name: 'stacked in px: Up and Down move it by 10 px, Home and End to its range',
        steps: [
          { focusInBox: SEPARATOR('Console') },
          { press: 'ArrowDown' },
          { expectAttr: SEPARATOR('Console'), name: 'aria-valuetext', value: '90 px' },
          { expectStyle: FIRST_PANE('Console'), name: 'height', value: '90px' },
          { press: 'ArrowRight' },
          { expectAttr: SEPARATOR('Console'), name: 'aria-valuenow', value: '90' },
          { press: 'End' },
          { expectText: SPLITTER_STATUS, text: 'Editor height: 160 px' },
          { press: 'Home' },
          { expectAttr: SEPARATOR('Console'), name: 'aria-valuenow', value: '40' },
        ],
      },
    ],
  },
};
