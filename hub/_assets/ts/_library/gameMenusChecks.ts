/**
 * The game navigation and menus' checks (`gameMenus.ts`' demos): the spatial navigation, the
 * radial menu, the game menu, the settings menu and the controls page.
 */
import type { UiDemoChecks } from '../_componentChecks';

const NAV = (name: string) => `#hubDemoNav${name}`;
const NAV_STATUS = NAV('Status');
const RADIAL = '#hudRoot #hubDemoRadialMenu';
const RADIAL_ITEM = (n: number) => `${RADIAL} .aekRadialMenu__item:nth-child(${n})`;
const RADIAL_STATUS = '#hubDemoRadialStatus';
const MENU = '#hudRoot #hubDemoGameMenuPanel';
const MENU_ITEM = (id: string) => `${MENU} .aekGameMenu__page:not([hidden]) [data-id="${id}"]`;
const MENU_STATUS = '#hubDemoGameMenuStatus';
const SETTINGS = '#hubDemoSettingsMenu';
const SETTINGS_TAB = (key: string) => `${SETTINGS} [data-tab-key="${key}"]`;
const CONTROLS = '#hubDemoControlsPage';
const CONTROLS_SLOT = (action: string, column: string) =>
  `${CONTROLS} [data-action="${action}"] .aekControlsPage__cell[data-column="${column}"] .aekControlsPage__bind`;
const CONTROLS_STATUS = '#hubDemoControlsStatus';

/** The game navigation and menus group's checks by their demo's key (`data-hub-demo`) */
export const GAME_MENUS_CHECKS: Record<string, UiDemoChecks> = {
  spatialNavigation: {
    keyboard: [
      {
        name: 'the arrows move by position, inside the focused group first, then to the next group',
        steps: [
          { focusInBox: NAV('Bag') },
          { press: 'ArrowDown' },
          { expectFocus: NAV('Map') },
          { press: 'ArrowUp' },
          { expectFocus: NAV('Bag') },
          { press: 'ArrowRight' },
          { expectFocus: NAV('Sword') },
          { press: 'ArrowRight' },
          { expectFocus: NAV('Shield') },
          { press: 'ArrowDown' },
          { expectFocus: NAV('Rope') },
          { press: 'Escape' },
          { expectText: NAV_STATUS, text: 'Back' },
        ],
      },
      {
        name: 'a gamepad: the d-pad moves without the focus leaving the panel',
        steps: [
          { focusInBox: NAV('Sword') },
          { click: 'D-pad: down' },
          { expectFocus: NAV('Potion') },
          { click: 'D-pad: left' },
          { expectText: NAV_STATUS, text: 'Focused: Map' },
        ],
      },
    ],
  },
  radialMenu: {
    keyboard: [
      {
        name: 'opens on the ring with nothing highlighted; the arrows go round past the disabled item; Enter picks',
        steps: [
          { click: 'Open the emotes' },
          { expectAttr: `${RADIAL} .aekRadialMenu__ring`, name: 'role', value: 'menu' },
          { press: 'ArrowRight' },
          { expectFocus: RADIAL_ITEM(1) },
          { press: 'ArrowLeft' },
          { expectFocus: RADIAL_ITEM(5) },
          { expectAttr: RADIAL_ITEM(5), name: 'aria-disabled', value: 'true' },
          { press: 'ArrowRight' },
          { press: 'ArrowRight' },
          { expectFocus: RADIAL_ITEM(2) },
          { press: 'Enter' },
          { expectText: RADIAL_STATUS, text: 'Emote: cheer' },
          { expectFocusBox: 'Open the emotes' },
        ],
      },
      {
        name: 'Escape closes it, the focus back on its opener',
        steps: [
          { click: 'Open the emotes' },
          { press: 'ArrowDown' },
          { press: 'Escape' },
          { expectText: RADIAL_STATUS, text: 'Closed' },
          { expectFocusBox: 'Open the emotes' },
        ],
      },
    ],
  },
  gameMenu: {
    keyboard: [
      {
        name: 'a page and back: Enter opens it, Escape goes back to its item, then closes the menu',
        steps: [
          { click: 'Open the pause menu' },
          { expectAttr: `${MENU} .aekGameMenu__panel`, name: 'aria-modal', value: 'true' },
          { expectFocus: MENU_ITEM('resume') },
          { press: 'ArrowDown' },
          { expectFocus: MENU_ITEM('options') },
          { press: 'Enter' },
          { expectFocus: MENU_ITEM('audio') },
          { press: 'ArrowDown' },
          { expectFocus: MENU_ITEM('video') },
          { expectAttr: MENU_ITEM('video'), name: 'aria-disabled', value: 'true' },
          { press: 'Escape' },
          { expectFocus: MENU_ITEM('options') },
          { press: 'Escape' },
          { expectText: MENU_STATUS, text: 'The menu closed' },
          { expectFocusBox: 'Open the pause menu' },
        ],
      },
    ],
  },
  settingsMenu: {
    keyboard: [
      {
        name: 'the tabs select the pages; Reset all asks first, the focus on Cancel',
        steps: [
          { focusInBox: SETTINGS_TAB('display') },
          { press: 'ArrowRight' },
          { expectFocus: SETTINGS_TAB('audio') },
          { expectAttr: SETTINGS_TAB('audio'), name: 'aria-selected', value: 'true' },
          { focusInBox: `${SETTINGS} .aekSettingsMenu__resetAll` },
          { press: 'Enter' },
          { expectFocus: `${SETTINGS} .aekSettingsMenu__cancel` },
          { press: 'Enter' },
          { expectCount: `${SETTINGS} .aekSettingsMenu__actions[data-confirming]`, count: 0 },
        ],
      },
    ],
  },
  controlsPage: {
    keyboard: [
      {
        name: 'a capture: Enter waits for a key, which rebinds the action; Escape cancels the next',
        steps: [
          { focusInBox: CONTROLS_SLOT('jump', 'KEYBOARD_MOUSE') },
          { press: 'Enter' },
          {
            expectAttr: CONTROLS_SLOT('jump', 'KEYBOARD_MOUSE'),
            name: 'data-capturing',
            value: '',
          },
          { press: 'q' },
          { expectText: CONTROLS_STATUS, text: 'rebind: jump' },
          { press: 'Enter' },
          { press: 'Escape' },
          { expectCount: `${CONTROLS} [data-capturing]`, count: 0 },
        ],
      },
      {
        name: 'a conflict: another action’s key asks, Swap trades them',
        steps: [
          { focusInBox: CONTROLS_SLOT('jump', 'KEYBOARD_MOUSE') },
          { press: 'Enter' },
          { press: 'e' },
          { expectFocus: `${CONTROLS} .aekControlsPage__swap` },
          { press: 'Enter' },
          {
            expectAttr: `${CONTROLS_SLOT('jump', 'KEYBOARD_MOUSE')} .aekInputGlyph`,
            name: 'aria-label',
            value: 'E',
          },
          {
            expectAttr: `${CONTROLS_SLOT('interact', 'KEYBOARD_MOUSE')} .aekInputGlyph`,
            name: 'aria-label',
            value: 'Space',
          },
          { expectText: CONTROLS_STATUS, text: 'swap: interact' },
        ],
      },
    ],
  },
};
