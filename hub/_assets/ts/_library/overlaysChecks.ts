/**
 * The overlays' checks (`overlays.ts`' demos): the window, the dialog, the tooltip, the popover,
 * the menu and the toaster.
 */
import type { UiDemoChecks } from '../_componentChecks';
import { LIST } from './fieldsChecks';

const WINDOW = '#hudRoot #hubDemoWindow';
const WINDOW_HEADER = `${WINDOW} .aekWindow__header`;
const KIND_WINDOW = (n: number) => `#hudRoot #hubDemoKind_${n}`;
const BEHIND_DIALOG = '#hudRoot #hubDemoBehindDialog';
const TOAST = '#hudRoot .aekToast';
const DIALOG = (index: number) => `#hudRoot #hubDemoDialog${index}`;
const TOOLTIP = '#hudRoot .aekTooltip';
const POPOVER = '#hudRoot .aekPopover';
const POPOVER_TRIGGER = '#hubDemoPopoverTrigger';
/** The menu box's File button, its split button's parts, the open menu and its focused item */
const MENU_FILE = '#hubDemoMenuFile';
const SPLIT_ACTION = '#hubDemoMenuSplit > .aekButton:first-child';
const SPLIT_MENU_BUTTON = '#hubDemoMenuSplit > [aria-haspopup="menu"]';
const MENU = '#hudRoot .aekMenu';
const MENU_FOCUSED = `${MENU} .aekMenu__item:focus .aekMenu__label`;
const MENU_STATUS = '#hubDemoMenuStatus';
/** The View menu button (submenus, p805 D11); an item of its root level and of its open submenu
 * by place, in the HUD root (a `clickHud` step adds the `#hudRoot`), and the same in the page */
const MENU_VIEW = '#hubDemoMenuView';
const VIEW_ITEM = (n: number) => `.aekMenu:not([data-submenu]) > .aekMenu__item:nth-child(${n})`;
const VIEW_SUBITEM = (n: number) => `.aekMenu[data-submenu] > .aekMenu__item:nth-child(${n})`;
const ROOT_ITEM = (n: number) => `#hudRoot ${VIEW_ITEM(n)}`;
/** The context menu box's row by its place (`overlays.ts`' `CONTEXT_ID`) and its status line */
const CONTEXT_ROW = (n: number) => `#hubDemoContextRow${n}`;
const CONTEXT_STATUS = '#hubDemoContextStatus';

/** The overlays group's checks by their demo's key (`data-hub-demo`) */
export const OVERLAYS_CHECKS: Record<string, UiDemoChecks> = {
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
  menu: {
    states: [
      { name: 'the menu open', steps: [{ clickInBox: MENU_FILE }] },
      { name: 'the split button’s menu open', steps: [{ clickInBox: SPLIT_MENU_BUTTON }] },
      {
        name: 'the View menu with a submenu open in a submenu',
        steps: [
          { clickInBox: MENU_VIEW },
          { clickHud: VIEW_ITEM(2) },
          { clickHud: VIEW_SUBITEM(3) },
        ],
      },
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
        name: 'submenus: ArrowRight opens one on its first item, ArrowLeft goes back, Escape closes one level',
        steps: [
          { focusInBox: MENU_VIEW },
          { press: 'Enter' },
          { expectText: MENU_FOCUSED, text: 'Zoom' },
          { expectAttr: ROOT_ITEM(1), name: 'aria-haspopup', value: 'menu' },
          { expectAttr: ROOT_ITEM(1), name: 'aria-expanded', value: 'false' },
          { press: 'ArrowRight' },
          { expectCount: MENU, count: 2 },
          { expectText: MENU_FOCUSED, text: 'Zoom in' },
          { expectAttr: ROOT_ITEM(1), name: 'aria-expanded', value: 'true' },
          { press: 'ArrowLeft' },
          { expectCount: MENU, count: 1 },
          { expectText: MENU_FOCUSED, text: 'Zoom' },
          { press: 'ArrowDown' },
          { press: 'Enter' },
          { expectText: MENU_FOCUSED, text: 'Outline' },
          { press: 'End' },
          { expectText: MENU_FOCUSED, text: 'Layout' },
          { press: 'ArrowRight' },
          { expectCount: MENU, count: 3 },
          { expectText: MENU_FOCUSED, text: 'Default' },
          { press: 'ArrowDown' },
          { press: 'Space' },
          { expectText: MENU_STATUS, text: 'Layout: compact' },
          { expectCount: MENU, count: 3 },
          { press: 'Escape' },
          { expectCount: MENU, count: 2 },
          { expectText: MENU_FOCUSED, text: 'Layout' },
          { press: 'Escape' },
          { expectCount: MENU, count: 1 },
          { expectText: MENU_FOCUSED, text: 'Panels' },
          { press: 'Escape' },
          { expectCount: MENU, count: 0 },
          { expectFocus: MENU_VIEW },
        ],
      },
      {
        name: 'a pick in a submenu closes every level; a disabled submenu opens nothing; Tab closes them all',
        steps: [
          { focusInBox: MENU_VIEW },
          { press: 'ArrowDown' },
          { press: 'ArrowRight' },
          { press: 'ArrowDown' },
          { expectText: MENU_FOCUSED, text: 'Zoom out' },
          { press: 'Enter' },
          { expectCount: MENU, count: 0 },
          { expectText: MENU_STATUS, text: 'View: Zoom out' },
          { expectFocus: MENU_VIEW },
          { press: 'ArrowDown' },
          { press: 'ArrowDown' },
          { press: 'ArrowDown' },
          { expectText: MENU_FOCUSED, text: 'Recent views' },
          { expectAttr: ROOT_ITEM(3), name: 'aria-disabled', value: 'true' },
          { press: 'ArrowRight' },
          { expectCount: MENU, count: 1 },
          { press: 'ArrowUp' },
          { press: 'Space' },
          { expectCount: MENU, count: 2 },
          { expectText: MENU_FOCUSED, text: 'Outline' },
          { press: 'Tab' },
          { expectCount: MENU, count: 0 },
          { expectFocus: MENU_VIEW },
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
  contextMenu: {
    states: [
      {
        name: 'a row’s menu open by a right click',
        steps: [{ contextClickInBox: CONTEXT_ROW(0) }],
      },
      {
        name: 'a row’s menu with its submenu open',
        steps: [{ contextClickInBox: CONTEXT_ROW(0) }, { clickHud: VIEW_ITEM(3) }],
      },
    ],
    keyboard: [
      {
        name: 'the ContextMenu key opens a row’s menu on its first item; a pick in its submenu closes it, the focus back on the row',
        steps: [
          { focusInBox: CONTEXT_ROW(1) },
          { press: 'ContextMenu' },
          { expectCount: MENU, count: 1 },
          { expectAttr: `${MENU}:not([data-submenu])`, name: 'aria-label', value: 'Crate actions' },
          { expectText: MENU_FOCUSED, text: 'Focus' },
          { press: 'ArrowDown' },
          { press: 'Space' },
          { expectText: CONTEXT_STATUS, text: 'Crate: hidden' },
          { expectCount: MENU, count: 1 },
          { press: 'ArrowDown' },
          { press: 'ArrowRight' },
          { expectText: MENU_FOCUSED, text: 'Front' },
          { press: 'Enter' },
          { expectCount: MENU, count: 0 },
          { expectText: CONTEXT_STATUS, text: 'Crate moved to the front' },
          { expectFocus: CONTEXT_ROW(1) },
        ],
      },
      {
        name: 'Shift+F10 opens it too; Escape closes it, the focus back on the row',
        steps: [
          { focusInBox: CONTEXT_ROW(2) },
          { press: 'Shift+F10' },
          { expectCount: MENU, count: 1 },
          { expectText: MENU_FOCUSED, text: 'Focus' },
          { press: 'Escape' },
          { expectCount: MENU, count: 0 },
          { expectFocus: CONTEXT_ROW(2) },
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
