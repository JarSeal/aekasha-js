/**
 * The game item pieces' checks (`gameItems.ts`' demos): the item slot, the hotbar, the inventory
 * grid and the item details.
 */
import type { UiDemoChecks } from '../_componentChecks';

const SLOT_POTION = '#hubDemoSlotPotion';
const SLOT_SELECTED = '#hubDemoSlotSelected';
const SLOT_STATUS = '#hubDemoSlotStatus';
const HOTBAR = '#hubDemoHotbarBar';
const HOTBAR_SLOT = (n: number) => `${HOTBAR} .aekItemSlot:nth-child(${n})`;
const HOTBAR_STATUS = '#hubDemoHotbarStatus';
const BAG = '#hubDemoInventoryBag';
const CHEST = '#hubDemoInventoryChest';
const CELL = (grid: string, index: number) => `${grid} .aekItemSlot[data-index="${index}"]`;
const INVENTORY_STATUS = '#hubDemoInventoryStatus';
const COMPARED_STAT = (n: number) =>
  `#hubDemoDetailsCompared .aekItemDetails__stat:nth-child(${n})`;

/** The game items group's checks by their demo's key (`data-hub-demo`) */
export const GAME_ITEMS_CHECKS: Record<string, UiDemoChecks> = {
  itemSlot: {
    keyboard: [
      {
        name: 'a button named by its item; a toggle only when selected; Enter uses the potion',
        steps: [
          { expectText: `${SLOT_POTION} .aekItemSlot__spoken`, text: 'Health potion, 5, Uncommon' },
          { expectAttr: SLOT_POTION, name: 'aria-pressed', value: null },
          { expectAttr: SLOT_SELECTED, name: 'aria-pressed', value: 'true' },
          { expectAttr: SLOT_SELECTED, name: 'aria-keyshortcuts', value: '1' },
          { focusInBox: SLOT_POTION },
          { press: 'Enter' },
          { expectText: SLOT_STATUS, text: 'Drank a potion: 4 left' },
          { expectAttr: SLOT_POTION, name: 'aria-disabled', value: 'true' },
        ],
      },
    ],
  },
  hotbar: {
    keyboard: [
      {
        name: 'a toolbar: the arrows round the slots, Enter uses one, the selection follows',
        steps: [
          { expectAttr: HOTBAR, name: 'role', value: 'toolbar' },
          { focusInBox: HOTBAR_SLOT(1) },
          { press: 'ArrowRight' },
          { expectFocus: HOTBAR_SLOT(2) },
          { press: 'ArrowLeft' },
          { press: 'ArrowLeft' },
          { expectFocus: HOTBAR_SLOT(5) },
          { press: 'Enter' },
          { expectText: HOTBAR_STATUS, text: 'Used: Ember gem' },
          { expectAttr: HOTBAR_SLOT(5), name: 'aria-pressed', value: 'true' },
          { expectAttr: HOTBAR_SLOT(1), name: 'aria-pressed', value: 'false' },
        ],
      },
    ],
  },
  inventoryGrid: {
    keyboard: [
      {
        name: 'Enter picks up, the arrows carry it, Enter drops it (a swap); Escape puts one back',
        steps: [
          { focusInBox: CELL(BAG, 0) },
          { press: 'Enter' },
          { expectAttr: CELL(BAG, 0), name: 'data-held', value: '' },
          { press: 'ArrowRight' },
          { expectFocus: CELL(BAG, 1) },
          { press: 'Enter' },
          { expectText: INVENTORY_STATUS, text: 'swap: Iron sword' },
          { expectText: `${CELL(BAG, 0)} .aekItemSlot__spoken`, text: 'Swift dagger, Rare' },
          { press: 'Enter' },
          { press: 'Escape' },
          { expectCount: `${BAG} [data-held]`, count: 0 },
          { expectFocus: CELL(BAG, 1) },
        ],
      },
      {
        name: 'a veto: the beacon key can’t go in the chest, and stays held',
        steps: [
          { focusInBox: CELL(BAG, 6) },
          { press: 'Enter' },
          { focusInBox: CELL(CHEST, 2) },
          { expectAttr: CELL(CHEST, 2), name: 'data-drop-target', value: 'blocked' },
          { press: 'Enter' },
          { expectAttr: CELL(BAG, 6), name: 'data-held', value: '' },
          { press: 'Escape' },
          { expectCount: `${BAG} [data-held]`, count: 0 },
        ],
      },
    ],
  },
  itemDetails: {
    keyboard: [
      {
        name: 'no keys; a comparison is an arrow, a sign and words; the slot’s tooltip on a focus',
        steps: [
          { expectAttr: COMPARED_STAT(1), name: 'data-change', value: 'worse' },
          { expectText: `${COMPARED_STAT(1)} .aekVisuallyHidden`, text: ', 5 less, worse' },
          {
            expectAttr: `${COMPARED_STAT(1)} .aekItemDetails__arrow`,
            name: 'data-direction',
            value: 'down',
          },
          { expectAttr: COMPARED_STAT(2), name: 'data-change', value: 'better' },
          { focusBox: 'Show the slot’s tooltip' },
          { press: 'Shift+Tab' },
          { expectFocus: '#hubDemoDetailsSlot' },
          { expectCount: '#hudRoot [role="tooltip"] .aekItemDetails', count: 1 },
        ],
      },
    ],
  },
};
