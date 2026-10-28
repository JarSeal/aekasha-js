import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { countListeners, dispatchKey, stubKitDomAsync, type KitKeyInit } from '../testing/KitDom';
import { CMP } from '../core/CMP';
import { createHudRoot, getHUDRootCMP } from '../core/HUD';
import { createBindingScheduler } from '../forms/binding/BindingScheduler';
import { createList } from './List';
import type { List, ListProps } from './ListTypes';

type Item = { id: string; name: string; kind?: string; count?: number; on?: boolean };

const ITEMS: Item[] = [
  { id: 'sun', name: 'Sun', kind: 'DL' },
  { id: 'lamp', name: 'Lamp', kind: 'PL' },
  { id: 'spot', name: 'Spot', kind: 'SL' },
  { id: 'fill', name: 'Fill', kind: 'PL' },
];

const click = (target: EventTarget, init: KitKeyInit = {}) =>
  target.dispatchEvent(
    Object.assign(new window.Event('click', { bubbles: true, cancelable: true }), {
      shiftKey: false,
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      ...init,
    })
  );

const press = (key: string, init: KitKeyInit = {}) =>
  dispatchKey(document.activeElement as HTMLElement, 'keydown', key, init);

const add = (props: Partial<ListProps<Item>> & Pick<ListProps<Item>, 'items'>) => {
  const list = createList<Item>({ title: (item) => item.name, ...props });
  getHUDRootCMP().add(list.cmp);
  return list;
};

/** A list as the helpers read it (`List<T>` is invariant in `T`) */
type Shown = Pick<List<never>, 'cmp'>;

const getRows = (list: Shown) =>
  [...list.cmp.elem.querySelectorAll('.aekList__row')] as HTMLElement[];
const getRow = (list: Shown, key: string) =>
  list.cmp.elem.querySelector(`.aekList__row[data-key="${key}"]`) as HTMLElement;
const getTitles = (list: Shown) =>
  getRows(list).map((row) => row.querySelector('.aekList__title')?.textContent);
const getShownKeys = (list: Shown) =>
  getRows(list)
    .filter((row) => !row.hasAttribute('hidden'))
    .map((row) => row.getAttribute('data-key'));
const getSelectedFlags = (list: Shown) =>
  getRows(list).map((row) => row.getAttribute('aria-selected'));
const getTabIndices = (list: Shown) => getRows(list).map((row) => row.getAttribute('tabindex'));
const focusedKey = () =>
  (document.activeElement as HTMLElement).closest('.aekList__row')?.getAttribute('data-key');

beforeAll(async () => {
  await stubKitDomAsync();
  createHudRoot({ slot: document.getElementById('hudSlot') as HTMLElement });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('list (p805 D6): static', () => {
  it('is a <ul> of <li>s with the parts made as they have text, named by its heading', () => {
    const list = add({
      items: [
        { id: 'a', name: 'Alpha', kind: 'DL', count: 3 },
        { id: 'b', name: 'Beta' },
      ],
      heading: 'Lights',
      headingLevel: 3,
      subTitle: (item) => `[${item.id}]`,
      description: (item) => (item.kind ? `Kind ${item.kind}` : null),
      suffix: (item) => (item.count === undefined ? null : String(item.count)),
      badge: (item) => item.kind,
      icon: (item) => (item.kind ? '<svg></svg>' : null),
      isPlaceholder: (item) => item.id === 'b',
    });
    const rowsElem = list.cmp.elem.querySelector('.aekList__rows') as HTMLElement;
    expect(rowsElem.tagName).toBe('UL');
    expect(rowsElem.getAttribute('data-mode')).toBe('static');
    expect(rowsElem.hasAttribute('role')).toBe(false);
    const heading = list.cmp.elem.querySelector('.aekList__heading') as HTMLElement;
    expect(heading.tagName).toBe('H3');
    expect(heading.textContent).toBe('Lights 2');
    const headingText = heading.querySelector('.aekList__headingText') as HTMLElement;
    expect(rowsElem.getAttribute('aria-labelledby')).toBe(headingText.id);
    const [a, b] = getRows(list);
    expect(a.tagName).toBe('LI');
    expect(a.hasAttribute('tabindex')).toBe(false);
    expect(a.querySelector('.aekList__subTitle')?.textContent).toBe('[a]');
    expect(a.querySelector('.aekList__description')?.textContent).toBe('Kind DL');
    expect(a.querySelector('.aekList__suffix')?.textContent).toBe('3');
    expect(a.querySelector('.aekList__badge')?.textContent).toBe('DL');
    expect(a.querySelector('.aekList__icon')?.getAttribute('aria-hidden')).toBe('true');
    // Icon, badge, the text, the suffix
    const content = a.querySelector('.aekList__content') as HTMLElement;
    expect([...content.children].map((child) => child.className)).toEqual([
      'aekList__icon',
      'aekBadge aekList__badge',
      'aekList__text',
      'aekList__suffix',
    ]);
    // No description, suffix, badge or icon made for the row without them
    expect(b.querySelector('.aekList__description, .aekList__suffix, .aekList__badge')).toBe(null);
    expect(b.querySelector('.aekList__icon')).toBe(null);
    expect(b.querySelector('.aekList__title')?.hasAttribute('data-placeholder')).toBe(true);
    list.cmp.remove();
  });

  it('setItems keeps a row by key, writes only what changed, moves, adds and removes', () => {
    const list = add({ items: ITEMS, description: (item) => item.kind });
    const sunRow = getRow(list, 'sun');
    const sunTitle = sunRow.querySelector('.aekList__title') as HTMLElement;
    const titleNode = sunTitle.firstChild;
    list.setItems([
      { id: 'spot', name: 'Spot', kind: 'SL' },
      { id: 'sun', name: 'Sun', kind: 'DL' },
      { id: 'new', name: 'New' },
    ]);
    expect(getRows(list).map((row) => row.getAttribute('data-key'))).toEqual([
      'spot',
      'sun',
      'new',
    ]);
    expect(getRow(list, 'sun')).toBe(sunRow);
    // An unchanged title isn't written
    expect(sunTitle.firstChild).toBe(titleNode);
    expect(getRow(list, 'lamp')).toBe(null);
    // A part emptied is hidden, kept for its next text
    list.setItem('sun', { id: 'sun', name: 'Sun 2' });
    expect(sunTitle.textContent).toBe('Sun 2');
    const description = sunRow.querySelector('.aekList__description') as HTMLElement;
    expect(description.hasAttribute('hidden')).toBe(true);
    list.setItem('sun', { id: 'sun', name: 'Sun 2', kind: 'DL' });
    expect(description.hasAttribute('hidden')).toBe(false);
    // Another key, or one not in the list: nothing
    list.setItem('sun', { id: 'other', name: 'X' });
    list.setItem('nope', { id: 'nope', name: 'X' });
    expect(getTitles(list)).toEqual(['Spot', 'Sun 2', 'New']);
    list.cmp.remove();
  });

  it('an empty list shows its text or its CMP, removed with it', () => {
    const list = add({ items: [], empty: 'No lights' });
    const rowsElem = list.cmp.elem.querySelector('.aekList__rows') as HTMLElement;
    expect(rowsElem.hasAttribute('hidden')).toBe(true);
    const empty = list.cmp.elem.querySelector('.aekList__empty') as HTMLElement;
    expect(empty.hasAttribute('hidden')).toBe(false);
    expect(empty.textContent).toBe('No lights');
    list.setItems(ITEMS);
    expect(empty.hasAttribute('hidden')).toBe(true);
    expect(rowsElem.hasAttribute('hidden')).toBe(false);
    list.cmp.remove();

    const onRemove = vi.fn();
    const own = CMP({ text: 'Nothing here', onRemoveCmp: onRemove });
    const withCmp = add({ items: [], empty: own });
    expect(withCmp.cmp.elem.querySelector('.aekList__empty')?.textContent).toBe('Nothing here');
    withCmp.cmp.remove();
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it('render: a CMP per row, rendered again for another object, removed with the row', () => {
    const removed = vi.fn();
    const list = add({
      items: ITEMS.slice(0, 2),
      render: (item) => CMP({ class: 'own', text: item.name, onRemoveCmp: removed }),
    });
    expect(getRows(list).map((row) => row.querySelector('.own')?.textContent)).toEqual([
      'Sun',
      'Lamp',
    ]);
    const first = getRow(list, 'sun').querySelector('.own');
    list.setItems(ITEMS.slice(0, 2));
    expect(getRow(list, 'sun').querySelector('.own')).toBe(first);
    list.setItem('sun', { id: 'sun', name: 'Sol' });
    expect(removed).toHaveBeenCalledTimes(1);
    expect(getRow(list, 'sun').querySelector('.own')?.textContent).toBe('Sol');
    list.cmp.remove();
    expect(removed).toHaveBeenCalledTimes(3);
  });

  it('a row tooltip comes and goes with its text; getKeyAt finds a row from inside it', () => {
    const list = add({ items: ITEMS.slice(0, 2), tooltip: (item) => item.kind });
    const row = getRow(list, 'sun');
    expect(row.hasAttribute('aria-describedby')).toBe(true);
    list.setItem('sun', { id: 'sun', name: 'Sun' });
    expect(row.hasAttribute('aria-describedby')).toBe(false);
    expect(list.getKeyAt(row.querySelector('.aekList__title') as Element)).toBe('sun');
    expect(list.getKeyAt(list.cmp.elem)).toBe(null);
    list.cmp.remove();
  });
});

describe('list: listbox', () => {
  it('is a named listbox of options with one tab stop; the arrows don’t wrap', () => {
    const list = add({ items: ITEMS, label: 'Lights', selection: 'single' });
    const rowsElem = list.cmp.elem.querySelector('.aekList__rows') as HTMLElement;
    expect(rowsElem.getAttribute('role')).toBe('listbox');
    expect(rowsElem.getAttribute('aria-label')).toBe('Lights');
    expect(rowsElem.hasAttribute('aria-multiselectable')).toBe(false);
    expect(getRows(list).map((row) => row.getAttribute('role'))).toEqual(Array(4).fill('option'));
    expect(getSelectedFlags(list)).toEqual(['false', 'false', 'false', 'false']);
    expect(getTabIndices(list)).toEqual(['0', '-1', '-1', '-1']);
    getRows(list)[0].focus();
    expect(press('ArrowUp').defaultPrevented).toBe(true);
    expect(focusedKey()).toBe('sun');
    press('ArrowDown');
    expect(focusedKey()).toBe('lamp');
    expect(getTabIndices(list)).toEqual(['-1', '0', '-1', '-1']);
    press('End');
    expect(focusedKey()).toBe('fill');
    press('ArrowDown');
    expect(focusedKey()).toBe('fill');
    press('Home');
    expect(focusedKey()).toBe('sun');
    press('PageDown');
    expect(focusedKey()).toBe('fill');
    // A letter: the next title starting with it, round
    press('s');
    expect(focusedKey()).toBe('sun');
    press('s');
    expect(focusedKey()).toBe('spot');
    list.cmp.remove();
  });

  it('single: Space selects, Enter selects and activates, a click both; disabled rows neither', () => {
    const onSelectionChange = vi.fn();
    const onActivate = vi.fn();
    const list = add({
      items: ITEMS,
      label: 'Lights',
      selection: 'single',
      selected: ['spot'],
      disabled: (item) => item.id === 'fill',
      onSelectionChange,
      onActivate,
    });
    expect(getSelectedFlags(list)).toEqual(['false', 'false', 'true', 'false']);
    // The tab stop starts on the selected row
    expect(getTabIndices(list)).toEqual(['-1', '-1', '0', '-1']);
    getRow(list, 'sun').focus();
    press(' ');
    expect(onSelectionChange).toHaveBeenLastCalledWith(['sun']);
    expect(onActivate).not.toHaveBeenCalled();
    press('ArrowDown');
    expect(getSelectedFlags(list)).toEqual(['true', 'false', 'false', 'false']);
    press('Enter');
    expect(onSelectionChange).toHaveBeenLastCalledWith(['lamp']);
    expect(onActivate).toHaveBeenCalledWith(ITEMS[1], 'lamp');
    click(getRow(list, 'spot').querySelector('.aekList__title') as HTMLElement);
    expect(onSelectionChange).toHaveBeenLastCalledWith(['spot']);
    expect(onActivate).toHaveBeenLastCalledWith(ITEMS[2], 'spot');
    // Disabled: focusable, not selected or activated
    const fill = getRow(list, 'fill');
    expect(fill.getAttribute('aria-disabled')).toBe('true');
    press('End');
    expect(focusedKey()).toBe('fill');
    press('Enter');
    click(fill);
    expect(onActivate).toHaveBeenCalledTimes(2);
    expect(list.getSelected()).toEqual(['spot']);
    // From code: not reported
    list.setSelected(['sun']);
    expect(getSelectedFlags(list)).toEqual(['true', 'false', 'false', 'false']);
    expect(onSelectionChange).toHaveBeenCalledTimes(3);
    list.cmp.remove();
  });

  it('onActivate alone is a listbox with no selection', () => {
    const onActivate = vi.fn();
    const list = add({ items: ITEMS, label: 'Lights', onActivate });
    const rowsElem = list.cmp.elem.querySelector('.aekList__rows') as HTMLElement;
    expect(rowsElem.getAttribute('role')).toBe('listbox');
    expect(getRows(list)[0].hasAttribute('aria-selected')).toBe(false);
    getRows(list)[0].focus();
    press(' ');
    press('Enter');
    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(getRows(list)[0].hasAttribute('aria-selected')).toBe(false);
    list.cmp.remove();
  });

  it('multiple: Space toggles, Shift + arrows and Shift + click a range, Ctrl + A all or none', () => {
    const onSelectionChange = vi.fn();
    const onActivate = vi.fn();
    const list = add({
      items: ITEMS,
      label: 'Lights',
      selection: 'multiple',
      onSelectionChange,
      onActivate,
    });
    const rowsElem = list.cmp.elem.querySelector('.aekList__rows') as HTMLElement;
    expect(rowsElem.getAttribute('aria-multiselectable')).toBe('true');
    getRow(list, 'sun').focus();
    press(' ');
    press('ArrowDown');
    press(' ');
    expect(onSelectionChange).toHaveBeenLastCalledWith(['sun', 'lamp']);
    press(' ');
    expect(onSelectionChange).toHaveBeenLastCalledWith(['sun']);
    // The range from the last row picked (lamp, toggled off)
    press('ArrowDown', { shiftKey: true });
    press('ArrowDown', { shiftKey: true });
    expect(onSelectionChange).toHaveBeenLastCalledWith(['lamp', 'spot', 'fill']);
    press('a', { ctrlKey: true });
    expect(onSelectionChange).toHaveBeenLastCalledWith(['sun', 'lamp', 'spot', 'fill']);
    press('a', { metaKey: true });
    expect(onSelectionChange).toHaveBeenLastCalledWith([]);
    // A plain click replaces and activates; Ctrl toggles, Shift a range, neither activating
    click(getRow(list, 'lamp'));
    expect(onSelectionChange).toHaveBeenLastCalledWith(['lamp']);
    click(getRow(list, 'sun'), { ctrlKey: true });
    expect(onSelectionChange).toHaveBeenLastCalledWith(['sun', 'lamp']);
    click(getRow(list, 'spot'), { shiftKey: true });
    expect(onSelectionChange).toHaveBeenLastCalledWith(['sun', 'lamp', 'spot']);
    expect(onActivate).toHaveBeenCalledTimes(1);
    list.cmp.remove();
  });

  it('a selected key the items lose leaves the selection, reported', () => {
    const onSelectionChange = vi.fn();
    const list = add({
      items: ITEMS,
      label: 'Lights',
      selection: 'multiple',
      selected: ['sun', 'spot'],
      onSelectionChange,
    });
    list.setItems(ITEMS.filter((item) => item.id !== 'spot'));
    expect(onSelectionChange).toHaveBeenCalledWith(['sun']);
    expect(list.getSelected()).toEqual(['sun']);
    list.cmp.remove();
  });

  it('the focused row removed: the focus goes to the row now at its place', () => {
    const list = add({ items: ITEMS, label: 'Lights', selection: 'single', selected: ['fill'] });
    getRow(list, 'lamp').focus();
    list.setItems(ITEMS.filter((item) => item.id !== 'lamp'));
    // Not the selected row: the one at its place
    expect(focusedKey()).toBe('spot');
    expect(getTabIndices(list)).toEqual(['-1', '0', '-1']);
    // A kept row moved keeps the focus
    list.setItems([ITEMS[3], ITEMS[2], ITEMS[0]]);
    expect(focusedKey()).toBe('spot');
    list.cmp.remove();
  });
});

describe('list: grid (actions)', () => {
  const makeGrid = (onPress = vi.fn()) => {
    const items: Item[] = ITEMS.map((item) => ({ ...item, on: item.id !== 'lamp' }));
    const list = add({
      items,
      label: 'Lights',
      selection: 'single',
      disabled: (item) => item.id === 'fill',
      actions: [
        {
          key: 'visible',
          label: (item) => `Show ${item.name}`,
          icon: '<svg class="on"></svg>',
          iconOff: '<svg class="off"></svg>',
          pressed: (item) => Boolean(item.on),
          onPress: (item, key) => {
            onPress(key);
            item.on = !item.on;
          },
        },
        {
          key: 'lock',
          label: 'Lock',
          icon: '<svg></svg>',
          hidden: (item) => item.id === 'spot',
          onPress,
        },
      ],
    });
    return { list, items, onPress };
  };
  const getCell = (list: Shown, key: string, index: number) =>
    getRow(list, key).querySelectorAll('[role="gridcell"]')[index] as HTMLElement;
  const getButton = (list: Shown, key: string, index: number) =>
    getCell(list, key, index + 1).querySelector('button') as HTMLButtonElement;

  it('is a grid of rows, a main cell and a cell per action; one tab stop', () => {
    const { list } = makeGrid();
    const rowsElem = list.cmp.elem.querySelector('.aekList__rows') as HTMLElement;
    expect(rowsElem.getAttribute('role')).toBe('grid');
    const row = getRow(list, 'sun');
    expect(row.getAttribute('role')).toBe('row');
    expect(row.getAttribute('aria-selected')).toBe('false');
    expect(row.hasAttribute('tabindex')).toBe(false);
    expect(getCell(list, 'sun', 0).getAttribute('tabindex')).toBe('0');
    const toggle = getButton(list, 'sun', 0);
    expect(toggle.getAttribute('tabindex')).toBe('-1');
    expect(toggle.getAttribute('aria-label')).toBe('Show Sun');
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(toggle.querySelector('svg')?.getAttribute('class')).toBe('on');
    expect(getButton(list, 'lamp', 0).querySelector('svg')?.getAttribute('class')).toBe('off');
    expect(getButton(list, 'sun', 1).hasAttribute('aria-pressed')).toBe(false);
    // A hidden action keeps its cell; a disabled row's actions are disabled
    expect(getButton(list, 'spot', 1).hasAttribute('hidden')).toBe(true);
    expect(getButton(list, 'fill', 0).hasAttribute('disabled')).toBe(true);
    list.cmp.remove();
  });

  it('Left / Right between a row’s cells; Up / Down keep the column, the main cell past a hidden one', () => {
    const { list } = makeGrid();
    getCell(list, 'sun', 0).focus();
    press('ArrowLeft');
    expect(document.activeElement).toBe(getCell(list, 'sun', 0));
    press('ArrowRight');
    expect(document.activeElement).toBe(getButton(list, 'sun', 0));
    press('ArrowRight');
    expect(document.activeElement).toBe(getButton(list, 'sun', 1));
    press('ArrowRight');
    expect(document.activeElement).toBe(getButton(list, 'sun', 1));
    expect(getButton(list, 'sun', 1).getAttribute('tabindex')).toBe('0');
    expect(getCell(list, 'sun', 0).getAttribute('tabindex')).toBe('-1');
    press('ArrowDown');
    expect(document.activeElement).toBe(getButton(list, 'lamp', 1));
    press('ArrowDown');
    expect(document.activeElement).toBe(getCell(list, 'spot', 0));
    list.cmp.remove();
  });

  it('a press calls the action and reads the row again; Space and Enter on a button aren’t the row’s', () => {
    const onSelectionChange = vi.fn();
    const onActivate = vi.fn();
    const { list, onPress } = makeGrid();
    list.cmp.remove();
    const grid = add({
      items: ITEMS.map((item) => ({ ...item, on: true })),
      label: 'Lights',
      selection: 'single',
      onSelectionChange,
      onActivate,
      actions: [
        {
          key: 'visible',
          label: 'Visible',
          icon: '<svg class="on"></svg>',
          iconOff: '<svg class="off"></svg>',
          pressed: (item) => Boolean(item.on),
          onPress: (item, key) => {
            onPress(key);
            item.on = !item.on;
          },
        },
      ],
    });
    const toggle = getButton(grid, 'lamp', 0);
    click(toggle);
    expect(onPress).toHaveBeenCalledWith('lamp');
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(toggle.querySelector('svg')?.getAttribute('class')).toBe('off');
    toggle.focus();
    press(' ');
    press('Enter');
    expect(onSelectionChange).not.toHaveBeenCalled();
    expect(onActivate).not.toHaveBeenCalled();
    // The main cell's keys
    press('ArrowLeft');
    press('Enter');
    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(onSelectionChange).toHaveBeenLastCalledWith(['lamp']);
    grid.cmp.remove();
  });
});

describe('list: filter', () => {
  it('shows the matching rows with the matches marked, the count in the heading', () => {
    const list = add({
      items: ITEMS,
      heading: 'Lights',
      description: (item) => `Kind ${item.kind}`,
      filter: { query: 'pl' },
    });
    expect(getShownKeys(list)).toEqual(['lamp', 'fill']);
    const description = getRow(list, 'lamp').querySelector('.aekList__description') as HTMLElement;
    expect(description.querySelector('mark')?.textContent).toBe('PL');
    expect(description.textContent).toBe('Kind PL');
    expect(list.cmp.elem.querySelector('.aekList__count')?.textContent).toBe('2 of 4');
    list.setQuery('su');
    expect(getShownKeys(list)).toEqual(['sun']);
    expect(getRow(list, 'sun').querySelector('.aekList__title mark')?.textContent).toBe('Su');
    // Marks gone with the query
    list.setQuery('');
    expect(getShownKeys(list)).toEqual(['sun', 'lamp', 'spot', 'fill']);
    expect(list.cmp.elem.querySelector('mark')).toBe(null);
    expect(list.cmp.elem.querySelector('.aekList__count')?.textContent).toBe('4');
    list.cmp.remove();
  });

  it('a custom match; a new row is filtered too', () => {
    const list = add({
      items: ITEMS,
      filter: { query: 'P', match: (item, query) => item.kind?.startsWith(query) ?? false },
    });
    expect(getShownKeys(list)).toEqual(['lamp', 'fill']);
    list.setItems([...ITEMS, { id: 'pt', name: 'Point', kind: 'PL' }]);
    expect(getShownKeys(list)).toEqual(['lamp', 'fill', 'pt']);
    list.cmp.remove();
  });

  it('the field: typing filters and reports, ArrowDown enters the list, Escape empties it', () => {
    vi.useFakeTimers();
    const onQueryChange = vi.fn();
    const list = add({
      items: ITEMS,
      label: 'Lights',
      selection: 'single',
      filter: { field: true, onQueryChange },
    });
    const search = list.cmp.elem.querySelector('.aekList__search') as HTMLInputElement;
    const rowsElem = list.cmp.elem.querySelector('.aekList__rows') as HTMLElement;
    expect(search.getAttribute('role')).toBe('searchbox');
    expect(search.getAttribute('aria-controls')).toBe(rowsElem.id);
    search.focus();
    search.value = 'sp';
    search.dispatchEvent(new window.Event('input', { bubbles: true }));
    expect(onQueryChange).toHaveBeenLastCalledWith('sp');
    expect(getShownKeys(list)).toEqual(['spot']);
    vi.advanceTimersByTime(50);
    const region = getHUDRootCMP().elem.querySelector(':scope > [role="status"]');
    expect(region?.textContent).toBe('1 of 4');
    // The tab stop moved to the shown row
    press('ArrowDown');
    expect(focusedKey()).toBe('spot');
    search.focus();
    press('Escape');
    expect(search.value).toBe('');
    expect(onQueryChange).toHaveBeenLastCalledWith('');
    expect(getShownKeys(list)).toHaveLength(4);
    // Nothing to empty: Escape goes on
    expect(press('Escape').defaultPrevented).toBe(false);
    list.cmp.remove();
  });

  it('no match: the line with the query and its clear button; setQuery isn’t reported', () => {
    const onQueryChange = vi.fn();
    const list = add({ items: ITEMS, label: 'Lights', filter: { onQueryChange } });
    list.setQuery('zz');
    expect(onQueryChange).not.toHaveBeenCalled();
    const rowsElem = list.cmp.elem.querySelector('.aekList__rows') as HTMLElement;
    expect(rowsElem.hasAttribute('hidden')).toBe(true);
    const noMatch = list.cmp.elem.querySelector('.aekList__noMatch') as HTMLElement;
    expect(noMatch.hasAttribute('hidden')).toBe(false);
    expect(noMatch.querySelector('p')?.textContent).toBe('No matches for “zz”');
    click(noMatch.querySelector('.aekList__clear') as HTMLElement);
    expect(onQueryChange).toHaveBeenCalledWith('');
    expect(noMatch.hasAttribute('hidden')).toBe(true);
    expect(list.getQuery()).toBe('');
    list.cmp.remove();
  });

  it('a filtered out row keeps its selection; the focused one gives the focus to a shown one', () => {
    const list = add({
      items: ITEMS,
      label: 'Lights',
      selection: 'multiple',
      selected: ['sun', 'lamp'],
      filter: {},
    });
    getRow(list, 'sun').focus();
    list.setQuery('l');
    expect(getShownKeys(list)).toEqual(['lamp', 'fill']);
    expect(focusedKey()).toBe('lamp');
    expect(list.getSelected()).toEqual(['lamp', 'sun']);
    // Ctrl + A selects the shown rows, in place of the selection; again, none
    press('a', { ctrlKey: true });
    expect(list.getSelected()).toEqual(['lamp', 'fill']);
    press('a', { ctrlKey: true });
    expect(list.getSelected()).toEqual([]);
    list.cmp.remove();
  });
});

describe('list: live data', () => {
  it('a function’s items are read on refresh and on the scheduler', () => {
    let items = ITEMS.slice(0, 2);
    const scheduler = createBindingScheduler();
    const list = add({ items: () => items, scheduler });
    items = ITEMS.slice(1);
    list.refresh();
    expect(getTitles(list)).toEqual(['Lamp', 'Spot', 'Fill']);
    items = ITEMS.slice(0, 1);
    scheduler.refresh();
    expect(getTitles(list)).toEqual(['Sun']);
    list.cmp.remove();
    items = ITEMS;
    scheduler.refresh();
    scheduler.dispose();
  });

  it('removal leaves no listener, the tooltips and the scheduler entry gone, mid-typeahead too', () => {
    vi.useFakeTimers();
    const scheduler = createBindingScheduler();
    const read = vi.fn(() => ITEMS);
    const list = add({
      items: read,
      label: 'Lights',
      selection: 'single',
      tooltip: (item) => item.name,
      actions: [{ key: 'x', label: 'X', icon: '', onPress: () => {} }],
      filter: { field: true },
      scheduler,
    });
    const rowsElem = list.cmp.elem.querySelector('.aekList__rows') as HTMLElement;
    const search = list.cmp.elem.querySelector('.aekList__search') as HTMLElement;
    const cell = getRow(list, 'sun').querySelector('.aekList__main') as HTMLElement;
    const button = getRow(list, 'sun').querySelector('button') as HTMLElement;
    expect(countListeners(rowsElem)).toBe(3);
    expect(countListeners(search)).toBe(4);
    expect(countListeners(cell)).toBeGreaterThan(0);
    cell.focus();
    press('s');
    list.cmp.remove();
    expect(countListeners(rowsElem)).toBe(0);
    expect(countListeners(search)).toBe(0);
    expect(countListeners(cell)).toBe(0);
    expect(countListeners(button)).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    read.mockClear();
    scheduler.refresh();
    expect(read).not.toHaveBeenCalled();
    scheduler.dispose();
  });
});
