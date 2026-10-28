import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  countListeners,
  dispatchKey,
  stubKitDomAsync,
  stubResizeObserver,
  type KitKeyInit,
} from '../testing/KitDom';
import { CMP } from '../core/CMP';
import { createHudRoot, getHUDRootCMP } from '../core/HUD';
import { createBindingScheduler } from '../forms/binding/BindingScheduler';
import { createTable } from './Table';
import { createVirtualRows } from './VirtualRows';
import type { Table, TableColumn, TableProps } from './TableTypes';

type Item = { id: string; name: string; size: number; count?: number | null; state?: string };

const ITEMS: Item[] = [
  { id: 'tex', name: 'Textures', size: 1024, count: 12 },
  { id: 'geo', name: 'Geometry', size: 512, count: 40 },
  { id: 'rt', name: 'Render targets', size: 2048, count: null },
];

const COLUMNS: TableColumn<Item>[] = [
  { key: 'name', label: 'Category', rowHeader: true },
  { key: 'size', label: 'Size', format: (size) => `${size as number} kB` },
  { key: 'count', label: 'Count' },
];

const add = (props: Partial<TableProps<Item>> = {}) => {
  const table = createTable<Item>({ caption: 'Memory', columns: COLUMNS, rows: ITEMS, ...props });
  getHUDRootCMP().add(table.cmp);
  return table;
};

/** A table as the helpers read it (`Table<T>` is invariant in `T`) */
type Shown = Pick<Table<never>, 'cmp'>;

const query = (table: Shown, selector: string) =>
  table.cmp.elem.querySelector(selector) as HTMLElement;
const queryAll = (table: Shown, selector: string) =>
  [...table.cmp.elem.querySelectorAll(selector)] as HTMLElement[];
const getRow = (table: Shown, key: string) => query(table, `.aekTable__row[data-key="${key}"]`);
const getKeys = (table: Shown, section = 'tbody.aekTable__body') =>
  queryAll(table, `${section} > .aekTable__row`).map((row) => row.getAttribute('data-key'));
const getTexts = (row: HTMLElement) =>
  [...row.children].map((cell) => (cell.lastChild as Text | null)?.data ?? '');

const press = (key: string, init: KitKeyInit = {}) =>
  dispatchKey(document.activeElement as HTMLElement, 'keydown', key, init);

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

/** The focused element's row key (null in the header row) and its cell's column */
const focused = () => {
  const active = document.activeElement as HTMLElement;
  const cell = active.closest('td, th') as HTMLElement;
  const row = cell.parentNode as HTMLElement;
  return { key: row.getAttribute('data-key'), column: [...row.children].indexOf(cell) };
};

const getSortButton = (table: Shown, key: string) =>
  query(table, `th[data-key="${key}"] .aekTable__sort`);

let observers: ReturnType<typeof stubResizeObserver>;

beforeAll(async () => {
  await stubKitDomAsync();
  createHudRoot({ slot: document.getElementById('hudSlot') as HTMLElement });
});

beforeEach(() => {
  observers = stubResizeObserver();
});

afterEach(() => {
  observers.restore();
  vi.useRealTimers();
});

describe('table (p805 D5): its parts', () => {
  it('a caption, a column and a header per shown column, a row per item with its cells’ text', () => {
    const table = add({
      columns: [...COLUMNS, { key: 'state', label: 'State', hidden: true }],
    });
    const caption = query(table, 'caption');
    expect(caption.textContent).toBe('Memory');
    expect(caption.id).toBe(`${table.cmp.id}-caption`);
    expect(queryAll(table, 'col').map((col) => col.getAttribute('data-key'))).toEqual([
      'name',
      'size',
      'count',
    ]);
    const headers = queryAll(table, 'thead th');
    expect(headers.map((th) => th.textContent)).toEqual(['Category', 'Size', 'Count']);
    expect(headers.every((th) => th.getAttribute('scope') === 'col')).toBe(true);
    expect(getKeys(table)).toEqual(['tex', 'geo', 'rt']);
    const row = getRow(table, 'tex');
    expect(row.children[0].tagName).toBe('TH');
    expect(row.children[0].getAttribute('scope')).toBe('row');
    expect(row.children[1].tagName).toBe('TD');
    expect(getTexts(row)).toEqual(['Textures', '1024 kB', '12']);
    // null is no text
    expect(getTexts(getRow(table, 'rt'))[2]).toBe('');
    // No table roles without a stacked layout
    expect(query(table, 'table').hasAttribute('role')).toBe(false);
    table.cmp.remove();
  });

  it('aligns a column by its first value (a number: end) unless it says; a fixed layout when every column has a width', () => {
    const table = add({
      columns: [
        { key: 'name', label: 'Category', width: 160, align: 'center' },
        { key: 'size', label: 'Size', width: '6em', format: (size) => String(size) },
        { key: 'count', label: 'Count', width: 80, minWidth: 60 },
      ],
      rows: [{ id: 'a', name: 'A', size: 1, count: null }, ...ITEMS],
    });
    const headers = queryAll(table, 'thead th');
    expect(headers.map((th) => th.getAttribute('data-align'))).toEqual(['center', 'end', 'end']);
    expect(getRow(table, 'a').children[0].getAttribute('data-align')).toBe('center');
    expect(getRow(table, 'a').children[1].getAttribute('data-align')).toBe('end');
    // count's first value is null: the next one (12) says
    expect(getRow(table, 'a').children[2].getAttribute('data-align')).toBe('end');
    expect(queryAll(table, 'col').map((col) => col.style.width)).toEqual(['160px', '6em', '80px']);
    expect(headers[2].style.minWidth).toBe('60px');
    expect(query(table, 'table').hasAttribute('data-fixed')).toBe(true);
    table.cmp.remove();

    const auto = add({ columns: [{ ...COLUMNS[0], width: 100 }, COLUMNS[1]] });
    expect(query(auto, 'table').hasAttribute('data-fixed')).toBe(false);
    auto.cmp.remove();
  });

  it('setRows keeps a row by key and writes only the cells whose text changed', () => {
    const table = add();
    const tex = getRow(table, 'tex');
    const sizeText = tex.children[1].lastChild as Text;
    const nameText = tex.children[0].lastChild as Text;
    table.setRows([
      { id: 'rt', name: 'Render targets', size: 2048 },
      { id: 'tex', name: 'Textures', size: 1100, count: 12 },
      { id: 'new', name: 'Buffers', size: 64, count: 3 },
    ]);
    expect(getKeys(table)).toEqual(['rt', 'tex', 'new']);
    expect(getRow(table, 'tex')).toBe(tex);
    expect(tex.children[1].lastChild).toBe(sizeText);
    expect(sizeText.data).toBe('1100 kB');
    expect(tex.children[0].lastChild).toBe(nameText);
    expect(getRow(table, 'geo')).toBe(null);
    // A repeated key: its first place wins
    table.setRows([ITEMS[0], { ...ITEMS[0], name: 'Again' }]);
    expect(getKeys(table)).toEqual(['tex']);
    expect(getTexts(tex)[0]).toBe('Textures');
    table.cmp.remove();
  });

  it('groups: a <tbody> each with its header row, an empty one hidden; a row moving between them keeps its element', () => {
    const table = add({
      rows: [ITEMS[0]],
      groups: [
        { key: 'app', label: 'App', rows: [ITEMS[1], ITEMS[2]] },
        { key: 'none', label: 'Nothing', rows: [] },
      ],
    });
    const groups = queryAll(table, 'tbody.aekTable__group');
    expect(groups.map((group) => group.getAttribute('data-key'))).toEqual(['app', 'none']);
    const header = groups[0].querySelector('th') as HTMLElement;
    expect(header.getAttribute('scope')).toBe('rowgroup');
    expect(header.getAttribute('colspan')).toBe('3');
    expect(header.textContent).toBe('App');
    expect(getKeys(table, 'tbody[data-key="app"]')).toEqual(['geo', 'rt']);
    expect(groups[1].hasAttribute('hidden')).toBe(true);
    const geo = getRow(table, 'geo');
    table.setRows([ITEMS[1]]);
    table.setGroups([{ key: 'app', label: 'App metrics', rows: [ITEMS[0]] }]);
    expect(getRow(table, 'geo')).toBe(geo);
    expect(getKeys(table)).toEqual(['geo']);
    expect(getKeys(table, 'tbody[data-key="app"]')).toEqual(['tex']);
    expect(queryAll(table, 'tbody.aekTable__group')).toHaveLength(1);
    expect(header.textContent).toBe('App metrics');
    table.cmp.remove();
  });

  it('the footer’s rows in a <tfoot>, gone without any', () => {
    const table = add({ footer: [{ id: 'total', name: 'Total', size: 3584, count: 52 }] });
    const foot = query(table, 'tfoot');
    expect(foot.parentNode).toBe(query(table, 'table'));
    expect(getTexts(getRow(table, 'total'))).toEqual(['Total', '3584 kB', '52']);
    table.setFooter([]);
    expect(query(table, 'tfoot')).toBe(null);
    table.cmp.remove();
  });

  it('the empty row across every column: a text, or a CMP removed with the table', () => {
    const table = add({ rows: [], empty: 'No allocations' });
    const empty = query(table, '.aekTable__empty');
    expect(empty.getAttribute('colspan')).toBe('3');
    expect(empty.textContent).toBe('No allocations');
    table.setRows(ITEMS);
    expect(query(table, '.aekTable__empty')).toBe(null);
    table.setRows([]);
    expect(query(table, '.aekTable__empty')).toBe(empty);
    table.cmp.remove();

    const state = CMP({ text: 'Nothing yet' });
    const withCmp = add({ rows: [], empty: state });
    expect(query(withCmp, '.aekTable__empty').textContent).toBe('Nothing yet');
    withCmp.cmp.remove();
    expect(state.elem.isConnected).toBe(false);
  });

  it('a tone is written on the cell and taken off', () => {
    let isLow = true;
    const table = add({
      columns: [
        COLUMNS[0],
        {
          key: 'count',
          label: 'Count',
          tone: (item) => (isLow && item.id === 'tex' ? 'danger' : null),
        },
      ],
    });
    const cell = getRow(table, 'tex').children[1];
    expect(cell.getAttribute('data-tone')).toBe('danger');
    isLow = false;
    table.refresh();
    expect(cell.hasAttribute('data-tone')).toBe(false);
    table.cmp.remove();
  });

  it('a function’s rows, groups and footer are read again on refresh; getKeyAt', () => {
    let items = ITEMS.slice(0, 1);
    const table = add({ rows: () => items, footer: () => [ITEMS[2]] });
    items = ITEMS.slice(0, 2);
    table.refresh();
    expect(getKeys(table)).toEqual(['tex', 'geo']);
    const cell = getRow(table, 'geo').children[1] as HTMLElement;
    expect(table.getKeyAt(cell)).toBe('geo');
    expect(table.getKeyAt(query(table, 'thead th'))).toBe(null);
    table.cmp.remove();
  });
});

describe('table: the box, the highlight, the stacked layout', () => {
  it('the parts’ flags; a caption hidden but read', () => {
    const table = add({
      captionHidden: true,
      striped: true,
      highlight: 'row',
      sticky: { header: true, firstColumn: true },
    });
    const root = table.cmp.elem;
    expect(root.hasAttribute('data-striped')).toBe(true);
    expect(root.getAttribute('data-highlight')).toBe('row');
    expect(root.hasAttribute('data-sticky-header')).toBe(true);
    expect(root.hasAttribute('data-sticky-column')).toBe(true);
    expect(query(table, 'caption').classList.contains('aekVisuallyHidden')).toBe(true);
    table.cmp.remove();
  });

  it('while it overflows, its box is a region named by the caption and a tab stop', () => {
    const table = add();
    const box = query(table, '.aekTable__scroll');
    let scrollHeight = 400;
    Object.defineProperties(box, {
      scrollHeight: { get: () => scrollHeight },
      clientHeight: { get: () => 200 },
      scrollWidth: { get: () => 300 },
      clientWidth: { get: () => 300 },
    });
    expect(box.hasAttribute('role')).toBe(false);
    observers.resize(query(table, 'table'), { width: 300, height: 400 });
    expect(box.getAttribute('role')).toBe('region');
    expect(box.getAttribute('aria-labelledby')).toBe(query(table, 'caption').id);
    expect(box.getAttribute('tabindex')).toBe('0');
    scrollHeight = 200;
    observers.resize(query(table, 'table'), { width: 300, height: 200 });
    expect(box.hasAttribute('role')).toBe(false);
    expect(box.hasAttribute('tabindex')).toBe(false);
    table.cmp.remove();
    expect(observers.observerCount()).toBe(0);
  });

  it('a column’s highlight is its <col>, on the pointer and the focus; none for a group’s header', () => {
    const table = add({
      highlight: 'cross',
      groups: [{ key: 'app', label: 'App', rows: [ITEMS[2]] }],
    });
    const tableElem = query(table, 'table');
    const [, sizeCol] = queryAll(table, 'col');
    const sizeCell = getRow(table, 'geo').children[1];
    sizeCell.dispatchEvent(new window.Event('pointerover', { bubbles: true }));
    expect(sizeCol.hasAttribute('data-highlight')).toBe(true);
    query(table, '.aekTable__groupHeader').dispatchEvent(
      new window.Event('pointerover', { bubbles: true })
    );
    expect(queryAll(table, 'col[data-highlight]')).toHaveLength(0);
    sizeCell.dispatchEvent(new window.Event('pointerover', { bubbles: true }));
    tableElem.dispatchEvent(new window.Event('pointerleave'));
    expect(sizeCol.hasAttribute('data-highlight')).toBe(false);
    expect(countListeners(tableElem)).toBe(4);
    table.cmp.remove();
    expect(countListeners(tableElem)).toBe(0);
  });

  it('stackBelow: the table roles and the cells’ labels; stacked below the width', () => {
    const table = add({
      stackBelow: 400,
      groups: [{ key: 'app', label: 'App', rows: [ITEMS[2]] }],
    });
    expect(query(table, 'table').getAttribute('role')).toBe('table');
    expect(query(table, 'thead').getAttribute('role')).toBe('rowgroup');
    expect(query(table, 'thead th').getAttribute('role')).toBe('columnheader');
    const row = getRow(table, 'tex');
    expect(row.getAttribute('role')).toBe('row');
    expect(row.children[0].getAttribute('role')).toBe('rowheader');
    expect(row.children[1].getAttribute('role')).toBe('cell');
    const label = row.children[1].querySelector('.aekTable__cellLabel') as HTMLElement;
    expect(label.textContent).toBe('Size');
    expect(label.getAttribute('aria-hidden')).toBe('true');
    expect(getTexts(row)).toEqual(['Textures', '1024 kB', '12']);
    observers.resize(table.cmp.elem, { width: 320, height: 200 });
    expect(table.cmp.elem.hasAttribute('data-stacked')).toBe(true);
    observers.resize(table.cmp.elem, { width: 640, height: 200 });
    expect(table.cmp.elem.hasAttribute('data-stacked')).toBe(false);
    table.cmp.remove();
  });
});

describe('table: sort (p805 D5)', () => {
  const SORTABLE: TableColumn<Item>[] = [
    { key: 'name', label: 'Category', rowHeader: true, sortable: true },
    { key: 'size', label: 'Size', sortable: true },
    { key: 'count', label: 'Count', sortable: true },
  ];

  it('a sortable header is a button with its mark; a click sorts ascending, then descending, then ascending again', () => {
    vi.useFakeTimers();
    const onSortChange = vi.fn();
    const table = add({ columns: [...SORTABLE, { key: 'state', label: 'State' }], onSortChange });
    const header = query(table, 'th[data-key="size"]');
    const button = getSortButton(table, 'size') as HTMLButtonElement;
    expect(header.hasAttribute('data-sortable')).toBe(true);
    expect(button.type).toBe('button');
    expect(button.textContent).toBe('Size');
    expect(button.querySelector('.aekTable__sortMark')?.getAttribute('aria-hidden')).toBe('true');
    expect(query(table, 'th[data-key="state"] button')).toBe(null);
    expect(header.hasAttribute('aria-sort')).toBe(false);

    click(button);
    expect(getKeys(table)).toEqual(['geo', 'tex', 'rt']);
    expect(header.getAttribute('aria-sort')).toBe('ascending');
    expect(onSortChange).toHaveBeenLastCalledWith({ key: 'size', direction: 'ascending' });
    vi.advanceTimersByTime(50);
    const region = getHUDRootCMP().elem.querySelector(':scope > [role="status"]');
    expect(region?.textContent).toBe('Sorted by Size, ascending');

    click(button);
    expect(getKeys(table)).toEqual(['rt', 'tex', 'geo']);
    expect(header.getAttribute('aria-sort')).toBe('descending');
    click(button);
    expect(header.getAttribute('aria-sort')).toBe('ascending');
    // Another column: its own sort, the first one's mark gone
    click(getSortButton(table, 'name'));
    expect(getKeys(table)).toEqual(['geo', 'rt', 'tex']);
    expect(header.hasAttribute('aria-sort')).toBe(false);
    table.cmp.remove();
  });

  it('sortUnset goes back to the rows’ own order after descending', () => {
    const onSortChange = vi.fn();
    const table = add({ columns: SORTABLE, sortUnset: true, onSortChange });
    const button = getSortButton(table, 'size');
    click(button);
    click(button);
    click(button);
    expect(getKeys(table)).toEqual(['tex', 'geo', 'rt']);
    expect(query(table, 'th[data-key="size"]').hasAttribute('aria-sort')).toBe(false);
    expect(onSortChange).toHaveBeenLastCalledWith(null);
    table.cmp.remove();
  });

  it('stable, empty values last in either direction, numbers in text as numbers', () => {
    const rows: Item[] = [
      { id: 'a', name: 'Item 10', size: 2, count: null },
      { id: 'b', name: 'Item 9', size: 1, count: 5 },
      { id: 'c', name: 'item 9', size: 2, count: 5 },
      { id: 'd', name: 'Item 1', size: 2 },
    ];
    const table = add({ columns: SORTABLE, rows, sort: { key: 'count', direction: 'ascending' } });
    expect(getKeys(table)).toEqual(['b', 'c', 'a', 'd']);
    table.setSort({ key: 'count', direction: 'descending' });
    expect(getKeys(table)).toEqual(['b', 'c', 'a', 'd']);
    table.setSort({ key: 'size', direction: 'descending' });
    expect(getKeys(table)).toEqual(['a', 'c', 'd', 'b']);
    table.setSort({ key: 'name', direction: 'ascending' });
    expect(getKeys(table)).toEqual(['d', 'b', 'c', 'a']);
    table.cmp.remove();
  });

  it('the initial sort and setSort aren’t reported; each group is sorted apart, the footer never', () => {
    const onSortChange = vi.fn();
    const table = add({
      columns: SORTABLE,
      rows: [ITEMS[0], ITEMS[1]],
      groups: [
        {
          key: 'app',
          label: 'App',
          rows: [ITEMS[2], { id: 'x', name: 'Extra', size: 4, count: 1 }],
        },
      ],
      footer: [
        { id: 'total', name: 'Total', size: 9999, count: 0 },
        { id: 'avg', name: 'Average', size: 1, count: 0 },
      ],
      sort: { key: 'size', direction: 'ascending' },
      onSortChange,
    });
    expect(getKeys(table)).toEqual(['geo', 'tex']);
    expect(getKeys(table, 'tbody[data-key="app"]')).toEqual(['x', 'rt']);
    expect(getKeys(table, 'tfoot')).toEqual(['total', 'avg']);
    expect(table.getSort()).toEqual({ key: 'size', direction: 'ascending' });
    table.setSort(null);
    expect(getKeys(table)).toEqual(['tex', 'geo']);
    expect(table.getSort()).toBe(null);
    expect(onSortChange).not.toHaveBeenCalled();
    table.cmp.remove();
  });

  it('a column’s compare; a live value moving its row keeps its element', () => {
    const sizes: Record<string, number> = { tex: 3, geo: 2, rt: 1 };
    const table = add({
      columns: [
        COLUMNS[0],
        {
          key: 'size',
          label: 'Size',
          sortable: true,
          compare: (a, b) => sizes[a.id] - sizes[b.id],
        },
      ],
      sort: { key: 'size', direction: 'ascending' },
    });
    expect(getKeys(table)).toEqual(['rt', 'geo', 'tex']);
    const tex = getRow(table, 'tex');
    sizes.tex = 0;
    table.refresh();
    expect(getKeys(table)).toEqual(['tex', 'rt', 'geo']);
    expect(getRow(table, 'tex')).toBe(tex);
    table.cmp.remove();
  });

  it('manualSort: the sort shown and reported, the rows kept in their order', () => {
    const onSortChange = vi.fn();
    const table = add({ columns: SORTABLE, manualSort: true, onSortChange });
    click(getSortButton(table, 'size'));
    expect(getKeys(table)).toEqual(['tex', 'geo', 'rt']);
    expect(query(table, 'th[data-key="size"]').getAttribute('aria-sort')).toBe('ascending');
    expect(onSortChange).toHaveBeenLastCalledWith({ key: 'size', direction: 'ascending' });
    table.cmp.remove();
  });
});

describe('table: the grid (selection, onRowActivate)', () => {
  const GRID_COLUMNS: TableColumn<Item>[] = [
    { key: 'name', label: 'Category', rowHeader: true },
    { key: 'size', label: 'Size', sortable: true },
    { key: 'count', label: 'Count' },
  ];

  it('the grid’s roles, its name and one tab stop on the first data row', () => {
    const table = add({ columns: GRID_COLUMNS, selection: 'multiple' });
    const tableElem = query(table, 'table');
    expect(tableElem.getAttribute('role')).toBe('grid');
    expect(tableElem.getAttribute('aria-labelledby')).toBe(query(table, 'caption').id);
    expect(tableElem.getAttribute('aria-multiselectable')).toBe('true');
    expect(table.cmp.elem.hasAttribute('data-grid')).toBe(true);
    const tex = getRow(table, 'tex');
    expect(tex.getAttribute('role')).toBe('row');
    expect(tex.getAttribute('aria-selected')).toBe('false');
    expect(tex.children[0].getAttribute('role')).toBe('rowheader');
    expect(tex.children[1].getAttribute('role')).toBe('gridcell');
    expect(query(table, 'thead th').getAttribute('role')).toBe('columnheader');
    // No stacked labels without stackBelow
    expect(query(table, '.aekTable__cellLabel')).toBe(null);
    const stops = queryAll(table, '[tabindex="0"]');
    expect(stops).toEqual([tex.children[0]]);
    expect(getSortButton(table, 'size').getAttribute('tabindex')).toBe('-1');
    table.cmp.remove();
  });

  it('the arrows over the cells (the headers’ buttons too), Home / End, Ctrl + Home / End, the column kept through a group’s header', () => {
    const table = add({
      columns: GRID_COLUMNS,
      rows: [ITEMS[0], ITEMS[1]],
      groups: [{ key: 'app', label: 'App', rows: [ITEMS[2]] }],
      onRowActivate: () => {},
    });
    (getRow(table, 'tex').children[0] as HTMLElement).focus();
    press('ArrowRight');
    press('ArrowRight');
    expect(focused()).toEqual({ key: 'tex', column: 2 });
    press('ArrowRight');
    expect(focused()).toEqual({ key: 'tex', column: 2 });
    press('ArrowUp');
    // The header row: Count isn't sortable, so its cell
    expect(document.activeElement).toBe(query(table, 'th[data-key="count"]'));
    press('ArrowLeft');
    expect(document.activeElement).toBe(getSortButton(table, 'size'));
    press('ArrowDown');
    press('ArrowDown');
    press('ArrowDown');
    // The group's header: one cell
    expect(
      (document.activeElement as HTMLElement).classList.contains('aekTable__groupHeader')
    ).toBe(true);
    press('ArrowDown');
    expect(focused()).toEqual({ key: 'rt', column: 1 });
    press('ArrowDown');
    expect(focused()).toEqual({ key: 'rt', column: 1 });
    press('Home');
    expect(focused()).toEqual({ key: 'rt', column: 0 });
    press('End');
    expect(focused()).toEqual({ key: 'rt', column: 2 });
    press('Home', { ctrlKey: true });
    expect(document.activeElement).toBe(query(table, 'thead th'));
    press('End', { ctrlKey: true });
    expect(focused()).toEqual({ key: 'rt', column: 2 });
    press('PageUp');
    expect(document.activeElement).toBe(query(table, 'th[data-key="count"]'));
    // One tab stop, where the focus is
    expect(queryAll(table, '[tabindex="0"]')).toEqual([document.activeElement]);
    table.cmp.remove();
  });

  it('a single selection: Space and a click select, Enter activates and selects; the footer neither', () => {
    const onSelectionChange = vi.fn();
    const onRowActivate = vi.fn();
    const table = add({
      columns: GRID_COLUMNS,
      footer: [{ id: 'total', name: 'Total', size: 3584 }],
      selection: 'single',
      onSelectionChange,
      onRowActivate,
    });
    (getRow(table, 'tex').children[1] as HTMLElement).focus();
    press(' ');
    expect(onSelectionChange).toHaveBeenLastCalledWith(['tex']);
    expect(getRow(table, 'tex').getAttribute('aria-selected')).toBe('true');
    expect(onRowActivate).not.toHaveBeenCalled();
    press('ArrowDown');
    press('Enter');
    expect(onRowActivate).toHaveBeenLastCalledWith(ITEMS[1], 'geo');
    expect(table.getSelected()).toEqual(['geo']);
    expect(getRow(table, 'tex').getAttribute('aria-selected')).toBe('false');
    click(getRow(table, 'rt').children[2]);
    expect(table.getSelected()).toEqual(['rt']);
    expect(onRowActivate).toHaveBeenLastCalledWith(ITEMS[2], 'rt');
    onRowActivate.mockClear();
    onSelectionChange.mockClear();
    const total = getRow(table, 'total');
    expect(total.hasAttribute('aria-selected')).toBe(false);
    click(total.children[1]);
    (total.children[1] as HTMLElement).focus();
    press(' ');
    press('Enter');
    expect(onRowActivate).not.toHaveBeenCalled();
    expect(onSelectionChange).not.toHaveBeenCalled();
    table.cmp.remove();
  });

  it('a multiple selection: Ctrl + click toggles, Shift + a move or a click a range, Ctrl + A all or none', () => {
    const onSelectionChange = vi.fn();
    const table = add({
      columns: GRID_COLUMNS,
      rows: [...ITEMS, { id: 'buf', name: 'Buffers', size: 64 }],
      selection: 'multiple',
      selected: ['geo'],
      onSelectionChange,
    });
    expect(getRow(table, 'geo').getAttribute('aria-selected')).toBe('true');
    // The tab stop starts on the selected row
    expect(queryAll(table, '[tabindex="0"]')).toEqual([getRow(table, 'geo').children[0]]);
    click(getRow(table, 'tex').children[0], { ctrlKey: true });
    expect(onSelectionChange).toHaveBeenLastCalledWith(['tex', 'geo']);
    // A Shift press selects no text: its default prevented, the cell focused
    const shiftPress = Object.assign(
      new window.Event('mousedown', { bubbles: true, cancelable: true }),
      { shiftKey: true, button: 0 }
    );
    getRow(table, 'rt').children[0].dispatchEvent(shiftPress);
    expect(shiftPress.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(getRow(table, 'rt').children[0]);
    click(getRow(table, 'rt').children[0], { shiftKey: true });
    expect(table.getSelected()).toEqual(['tex', 'geo', 'rt']);
    (getRow(table, 'rt').children[0] as HTMLElement).focus();
    press(' ');
    expect(table.getSelected()).toEqual(['tex', 'geo']);
    press('ArrowDown', { shiftKey: true });
    expect(table.getSelected()).toEqual(['rt', 'buf']);
    press('a', { ctrlKey: true });
    expect(table.getSelected()).toEqual(['tex', 'geo', 'rt', 'buf']);
    press('a', { ctrlKey: true });
    expect(table.getSelected()).toEqual([]);
    table.setSelected(['buf']);
    expect(getRow(table, 'buf').getAttribute('aria-selected')).toBe('true');
    expect(onSelectionChange).toHaveBeenLastCalledWith([]);
    table.cmp.remove();
  });

  it('setRows: a lost selected key reported, the focus on the row now at the focused one’s place', () => {
    const onSelectionChange = vi.fn();
    const table = add({
      columns: GRID_COLUMNS,
      selection: 'single',
      selected: ['geo'],
      onSelectionChange,
    });
    (getRow(table, 'geo').children[1] as HTMLElement).focus();
    table.setRows([ITEMS[0], ITEMS[2]]);
    expect(onSelectionChange).toHaveBeenLastCalledWith([]);
    expect(focused()).toEqual({ key: 'rt', column: 1 });
    table.cmp.remove();
  });

  it('Enter and F2 go into a cell’s control (out of the tab order), Escape and F2 back to the cell', () => {
    const onPress = vi.fn();
    const table = add({
      columns: [
        ...GRID_COLUMNS,
        {
          key: 'open',
          label: 'Open',
          cell: (item) =>
            CMP({
              tag: 'button',
              text: `Open ${item.name}`,
              attr: { type: 'button' },
              onClick: onPress,
            }),
        },
      ],
      onRowActivate: () => {},
    });
    const cell = getRow(table, 'tex').children[3] as HTMLElement;
    const button = cell.querySelector('button') as HTMLButtonElement;
    expect(button.getAttribute('tabindex')).toBe('-1');
    cell.focus();
    press('Enter');
    expect(document.activeElement).toBe(button);
    // The control's own keys
    expect(press('ArrowDown').defaultPrevented).toBe(false);
    press('Escape');
    expect(document.activeElement).toBe(cell);
    press('F2');
    expect(document.activeElement).toBe(button);
    press('F2');
    expect(document.activeElement).toBe(cell);
    // A click on the control isn't the row's
    const onRowActivate = vi.fn();
    table.cmp.remove();
    const second = add({
      columns: [
        GRID_COLUMNS[0],
        { key: 'x', label: 'X', cell: () => CMP({ tag: 'button', text: 'X' }) },
      ],
      onRowActivate,
    });
    click(getRow(second, 'tex').querySelector('button') as HTMLElement);
    expect(onRowActivate).not.toHaveBeenCalled();
    click(getRow(second, 'tex').children[0]);
    expect(onRowActivate).toHaveBeenCalledTimes(1);
    second.cmp.remove();
  });

  it('a sortable header’s button sorts from the keys; no listener left after the removal', () => {
    const table = add({ columns: GRID_COLUMNS, selection: 'single' });
    const tableElem = query(table, 'table');
    const button = getSortButton(table, 'size');
    (getRow(table, 'tex').children[1] as HTMLElement).focus();
    press('ArrowUp');
    expect(document.activeElement).toBe(button);
    // Enter is the button's own (its click)
    expect(press('Enter').defaultPrevented).toBe(false);
    expect(countListeners(tableElem)).toBe(5);
    expect(countListeners(button)).toBe(1);
    table.cmp.remove();
    expect(countListeners(tableElem)).toBe(0);
    expect(countListeners(button)).toBe(0);
  });
});

describe('table: cells, bars and header tooltips', () => {
  it('a cell’s CMP, made again for another row object and removed with its row and the table', () => {
    const made: string[] = [];
    const cmps: ReturnType<typeof CMP>[] = [];
    const table = add({
      columns: [
        COLUMNS[0],
        {
          key: 'two',
          label: 'Owner',
          value: (item) => item.name,
          cell: (item) => {
            made.push(item.id);
            const cmp = CMP({ class: 'twoLines', text: `${item.name} · scene` });
            cmps.push(cmp);
            return cmp;
          },
        },
      ],
    });
    expect(made).toEqual(['tex', 'geo', 'rt']);
    expect(getRow(table, 'tex').querySelector('.twoLines')?.textContent).toBe('Textures · scene');
    table.refresh();
    expect(made).toHaveLength(3);
    table.setRows([{ ...ITEMS[0], name: 'Images' }, ITEMS[1]]);
    expect(made).toEqual(['tex', 'geo', 'rt', 'tex']);
    expect(cmps[0].elem.isConnected).toBe(false);
    expect(cmps[2].elem.isConnected).toBe(false);
    expect(getRow(table, 'tex').querySelector('.twoLines')?.textContent).toBe('Images · scene');
    table.cmp.remove();
    expect(cmps[1].elem.isConnected).toBe(false);
  });

  it('a bar column: a segment per number against the largest total (the footer’s too), its text', () => {
    type Kind = { id: string; inView: number; culled: number };
    const kinds: Kind[] = [
      { id: 'mesh', inView: 30, culled: 10 },
      { id: 'light', inView: 5, culled: 0 },
    ];
    const table = createTable<Kind>({
      caption: 'Objects',
      columns: [
        { key: 'id', label: 'Kind' },
        {
          key: 'bar',
          label: 'Share',
          kind: 'bar',
          value: (kind) => [kind.inView, kind.culled],
        },
      ],
      rows: kinds,
      footer: [{ id: 'total', inView: 35, culled: 15 }],
    });
    getHUDRootCMP().add(table.cmp);
    const widths = (key: string) =>
      [...getRow(table, key).querySelectorAll('.aekTable__barPart')].map(
        (part) => (part as HTMLElement).style.width
      );
    const mesh = getRow(table, 'mesh');
    const cell = mesh.children[1] as HTMLElement;
    expect(cell.getAttribute('data-kind')).toBe('bar');
    expect(cell.querySelector('.aekTable__bar')?.getAttribute('aria-hidden')).toBe('true');
    expect(widths('mesh')).toEqual(['60%', '20%']);
    expect(widths('light')).toEqual(['10%', '0%']);
    expect(widths('total')).toEqual(['70%', '30%']);
    expect(cell.querySelector('.aekTable__barText')?.textContent).toBe('30 / 10');
    table.cmp.remove();

    const budget = createTable<Kind>({
      caption: 'Budget',
      columns: [
        {
          key: 'inView',
          label: 'In view',
          kind: 'bar',
          barMax: 100,
          format: () => '',
        },
      ],
      rows: kinds,
    });
    getHUDRootCMP().add(budget.cmp);
    const meshBar = budget.cmp.elem.querySelector('[data-key="mesh"] .aekTable__barPart');
    expect((meshBar as HTMLElement).style.width).toBe('30%');
    expect(
      budget.cmp.elem.querySelector('[data-key="mesh"] .aekTable__barText')?.hasAttribute('hidden')
    ).toBe(true);
    budget.cmp.remove();
  });

  it('a header’s tooltip describes its sort button, or the header', () => {
    const table = add({
      columns: [
        { ...COLUMNS[0], sortable: true, headerTooltip: 'The kind of memory' },
        { ...COLUMNS[1], headerTooltip: 'Bytes on the GPU' },
      ],
    });
    const button = getSortButton(table, 'name');
    const sizeHeader = query(table, 'th[data-key="size"]');
    expect(button.getAttribute('aria-describedby')).toBeTruthy();
    expect(sizeHeader.getAttribute('aria-describedby')).toBeTruthy();
    table.cmp.remove();
    expect(button.hasAttribute('aria-describedby')).toBe(false);
  });
});

describe('table: live data (p805 D3)', () => {
  it('setCell writes one text node only when its text changed, until the row is read again', () => {
    const format = vi.fn((size: unknown) => `${size as number} kB`);
    const table = add({
      columns: [COLUMNS[0], { key: 'size', label: 'Size', format, sortable: true }],
      sort: { key: 'size', direction: 'ascending' },
    });
    const cell = getRow(table, 'tex').children[1];
    const text = cell.lastChild as Text;
    let writes = 0;
    // linkedom's accessor is up the prototype chain
    let proto: object | null = Object.getPrototypeOf(text);
    let data = proto ? Object.getOwnPropertyDescriptor(proto, 'data') : undefined;
    while (!data && proto) {
      proto = Object.getPrototypeOf(proto);
      data = proto ? Object.getOwnPropertyDescriptor(proto, 'data') : undefined;
    }
    Object.defineProperty(text, 'data', {
      get: () => data?.get?.call(text) as string,
      set: (value: string) => {
        writes++;
        data?.set?.call(text, value);
      },
    });
    table.setCell('tex', 'size', 4096);
    expect(text.data).toBe('4096 kB');
    expect(cell.lastChild).toBe(text);
    expect(writes).toBe(1);
    table.setCell('tex', 'size', 4096);
    expect(writes).toBe(1);
    // Not sorted again until the next read; an unknown key or column does nothing
    expect(getKeys(table)).toEqual(['geo', 'tex', 'rt']);
    table.setCell('nope', 'size', 1);
    table.setCell('tex', 'nope', 1);
    // The next read takes the row's value back
    table.refresh();
    expect(text.data).toBe('1024 kB');
    table.cmp.remove();
  });

  it('setCell on a bar column measures its bars again', () => {
    type Kind = { id: string; count: number };
    const table = createTable<Kind>({
      caption: 'Kinds',
      columns: [{ key: 'count', label: 'Count', kind: 'bar' }],
      rows: [
        { id: 'a', count: 50 },
        { id: 'b', count: 100 },
      ],
    });
    getHUDRootCMP().add(table.cmp);
    const width = (key: string) =>
      (getRow(table, key).querySelector('.aekTable__barPart') as HTMLElement).style.width;
    expect([width('a'), width('b')]).toEqual(['50%', '100%']);
    table.setCell('a', 'count', 200);
    expect([width('a'), width('b')]).toEqual(['100%', '50%']);
    table.cmp.remove();
  });

  it('a function’s rows read on the scheduler’s refresh while shown; its entry gone with the table', () => {
    let items = ITEMS.slice(0, 1);
    const scheduler = createBindingScheduler();
    const table = add({ rows: () => items, scheduler });
    items = ITEMS;
    scheduler.refresh();
    expect(getKeys(table)).toEqual(['tex', 'geo', 'rt']);
    table.cmp.remove();
    items = [];
    expect(() => scheduler.refresh()).not.toThrow();
    scheduler.dispose();
  });
});

describe('table: virtual rows (p805 D8)', () => {
  type Big = { id: string; name: string; size: number };
  const makeRows = (count: number) =>
    Array.from({ length: count }, (_, i) => ({ id: `k${i}`, name: `Row ${i}`, size: i }));

  const addVirtual = (props: Partial<TableProps<Big>> = {}) => {
    const table = createTable<Big>({
      caption: 'Big',
      columns: [
        { key: 'name', label: 'Name', rowHeader: true },
        { key: 'size', label: 'Size', sortable: true },
      ],
      rows: makeRows(1000),
      virtual: createVirtualRows({ rowHeight: 20 }),
      ...props,
    });
    getHUDRootCMP().add(table.cmp);
    const box = table.cmp.elem.querySelector('.aekTable__scroll') as HTMLElement;
    observers.resize(box, { height: 100 });
    const bodyKeys = () =>
      [...box.querySelectorAll('tbody.aekTable__body > .aekTable__row:not([data-pinned])')].map(
        (row) => row.getAttribute('data-key')
      );
    const scrollTo = (top: number) => {
      box.scrollTop = top;
      box.dispatchEvent(new window.Event('scroll'));
    };
    return { table, box, bodyKeys, scrollTo };
  };

  it('renders the window between spacer rows, with the row count and each row’s index', () => {
    const { table, box, bodyKeys, scrollTo } = addVirtual({
      footer: [{ id: 'total', name: 'Total', size: 0 }],
    });
    const tableElem = box.querySelector('table') as HTMLElement;
    const tbody = box.querySelector('tbody.aekTable__body') as HTMLElement;
    expect(tbody.hasAttribute('data-virtual')).toBe(true);
    expect(bodyKeys()).toEqual(Array.from({ length: 9 }, (_, i) => `k${i}`));
    const [top, bottom] = [...tbody.querySelectorAll('.aekTable__spacer')] as HTMLElement[];
    expect(tbody.firstElementChild).toBe(top);
    expect(top.getAttribute('aria-hidden')).toBe('true');
    expect(top.querySelector('td')?.getAttribute('colspan')).toBe('2');
    expect(bottom.style.height).toBe(`${991 * 20}px`);
    // The header row, 1000 rows and the footer's
    expect(tableElem.getAttribute('aria-rowcount')).toBe('1002');
    expect(box.querySelector('thead tr')?.getAttribute('aria-rowindex')).toBe('1');
    expect(getRow(table, 'k3').getAttribute('aria-rowindex')).toBe('5');
    expect(getRow(table, 'total').getAttribute('aria-rowindex')).toBe('1002');
    expect(getRow(table, 'k3').hasAttribute('data-stripe')).toBe(true);
    expect(getRow(table, 'k2').hasAttribute('data-stripe')).toBe(false);
    scrollTo(500);
    expect(bodyKeys()).toEqual(Array.from({ length: 13 }, (_, i) => `k${21 + i}`));
    expect(top.style.height).toBe('420px');
    // The footer always renders
    expect(getRow(table, 'total')).not.toBe(null);
    table.cmp.remove();
  });

  it('recycles the views it lets go of; a recycled one shows its new row', () => {
    const { table, box, scrollTo } = addVirtual();
    const seen = new Set(box.querySelectorAll('tbody .aekTable__row'));
    for (let top = 0; top <= 4000; top += 100) scrollTo(top);
    for (const row of box.querySelectorAll('tbody .aekTable__row')) seen.add(row);
    expect(seen.size).toBeLessThanOrEqual(15);
    expect(getTexts(getRow(table, 'k200'))).toEqual(['Row 200', '200']);
    table.cmp.remove();
  });

  it('sorts every row, not the window’s; setCell on a row not rendered shows when it renders', () => {
    const { table, bodyKeys, scrollTo } = addVirtual();
    table.setSort({ key: 'size', direction: 'descending' });
    expect(bodyKeys().slice(0, 3)).toEqual(['k999', 'k998', 'k997']);
    table.setCell('k500', 'size', -1);
    expect(getRow(table, 'k500')).toBe(null);
    scrollTo(499 * 20);
    expect(getTexts(getRow(table, 'k500'))).toEqual(['Row 500', '-1']);
    table.scrollToKey('k10');
    expect(getRow(table, 'k10')).not.toBe(null);
    table.cmp.remove();
  });

  it('a grid: the keys render a row out of the window, the tab stop’s row kept while scrolled away', () => {
    const { table, box, scrollTo } = addVirtual({ selection: 'single' });
    const first = getRow(table, 'k0').children[1] as HTMLElement;
    first.focus();
    press('End', { ctrlKey: true });
    expect(focused()).toEqual({ key: 'k999', column: 1 });
    expect(box.scrollTop).toBe(1000 * 20 - 100);
    press('PageUp');
    expect(focused().key).toBe('k994');
    press(' ');
    expect(table.getSelected()).toEqual(['k994']);
    scrollTo(0);
    const pinned = box.querySelector('[data-pinned]') as HTMLElement;
    expect(pinned.getAttribute('data-key')).toBe('k994');
    expect(pinned.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(pinned.children[1]);
    expect(box.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
    // Moving on from it renders the next row
    press('ArrowDown');
    expect(focused().key).toBe('k995');
    expect(getRow(table, 'k995').hasAttribute('data-pinned')).toBe(false);
    table.cmp.remove();
    expect(countListeners(box)).toBe(0);
    expect(observers.observerCount()).toBe(0);
  });

  it('no stacked layout with virtual rows', () => {
    const { table } = addVirtual({ stackBelow: 400 });
    expect(query(table, '.aekTable__cellLabel')).toBe(null);
    observers.resize(table.cmp.elem, { width: 300, height: 200 });
    expect(table.cmp.elem.hasAttribute('data-stacked')).toBe(false);
    table.cmp.remove();
  });
});
