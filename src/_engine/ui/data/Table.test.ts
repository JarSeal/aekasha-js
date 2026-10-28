import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { countListeners, stubKitDomAsync, stubResizeObserver } from '../testing/KitDom';
import { CMP } from '../core/CMP';
import { createHudRoot, getHUDRootCMP } from '../core/HUD';
import { createTable } from './Table';
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
    expect(headers.map((th) => th.getAttribute('data-align'))).toEqual([null, 'end', 'end']);
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
