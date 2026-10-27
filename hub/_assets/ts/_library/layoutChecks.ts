/**
 * The layout pieces' checks (`layout.ts`' demos): the tabs; the accordion and the splitter come
 * next.
 */
import type { UiDemoChecks } from '../_componentChecks';

/** A tab of a tabs demo by its id's name (`layout.ts`' `TABS_ID`) and its key */
const TAB = (name: string, key: string) => `#hubDemoTabs${name} [data-tab-key="${key}"]`;
const TABS_LIST = (name: string) => `#hubDemoTabs${name} .aekTabs__list`;
const SHOWN_PANEL = (name: string) => `#hubDemoTabs${name} .aekTabs__panel:not([hidden])`;
const TABS_STATUS = '#hubDemoTabsStatus';

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
        name: 'vertical: Up and Down move and select, Left and Right don’t',
        steps: [
          { focusInBox: TAB('Drawer', 'scene') },
          { press: 'ArrowDown' },
          { expectFocus: TAB('Drawer', 'info') },
          { expectAttr: TAB('Drawer', 'info'), name: 'aria-selected', value: 'true' },
          { press: 'ArrowRight' },
          { expectFocus: TAB('Drawer', 'info') },
          { press: 'ArrowUp' },
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
};
