import { CMP, classes } from '../core/CMP';
import type { CMPHandle } from '../core/CMPTypes';
import { announce } from '../components/Announcer';
import { addScheduledRefresh, getPageScheduler } from '../forms/binding/BindingScheduler';
import { createElem, placeElems, writeAttr } from './CollectionParts';
import { createSelection, getSelectionGesture } from './Selection';
import { createTableGrid } from './TableGrid';
import {
  createTableColumn,
  createTableSorter,
  createTableView,
  disposeTableView,
  listenColumnHighlight,
  measureTableBar,
  readTableRow,
  writeTableBars,
  writeTableCell,
  writeTableView,
  type TableColumnState,
  type TableNavRow,
  type TableRowRecord,
  type TableRowView,
} from './TableRows';
import type { Table, TableProps, TableSort } from './TableTypes';
import { useVirtualRows } from './VirtualRows';
import './Table.scss';
import '../styles/kit.scss';

/** A group's record: its `<tbody>`, its header row (a grid row of one cell) and label */
type GroupRecord = {
  key: string;
  body: HTMLElement;
  header: HTMLElement;
  label: Text;
  nav: TableNavRow;
};

/** A group as shown: its record and its rows' records in order */
type ShownGroup<T> = { record: GroupRecord; rows: TableRowRecord<T>[] };

const ROW_CLASS = 'aekTable__row';

/** The page size of PageUp and PageDown when the table's box doesn't scroll */
const DEFAULT_PAGE_SIZE = 10;

const NO_CELLS: readonly HTMLElement[] = [];

/** What a view's row wrote that its next record writes again (or not at all) */
const RELEASED_ATTRS = ['data-pinned', 'data-stripe', 'aria-rowindex', 'aria-selected'];

const defaultGetKey = (row: unknown) => String((row as { id?: unknown }).id);

const read = <V>(source: V | (() => V)) =>
  typeof source === 'function' ? (source as () => V)() : source;

/**
 * Creates a table (p805 D5): an app's rows under its columns, each cell a value as text (`format`)
 * aligned by its kind, a CMP (`cell`) or a bar (`kind: 'bar'`), with groups (a `<tbody>` each,
 * under a header row), a footer, a caption, sticky parts, stripes, a highlight on hover and focus,
 * and a stacked layout for a narrow box. Sortable columns sort the rows (stable; or the app does,
 * `manualSort`). With a `selection` or `onRowActivate` the table is an APG grid: one tab stop, the
 * arrows over its cells. Rows are kept by key, so new rows write only the cells whose text changed
 * (one text node each), and `setCell` writes one live figure; `scheduler` and `interval` read the
 * rows again while the table shows, and `virtual` renders only the rows its box shows.
 * - Parts: `.aekTable` (`data-striped`, `data-highlight`, `data-sticky-header`,
 *   `data-sticky-column`, `data-stacked`, `data-grid`) with `__scroll` (the scroll box) holding
 *   `table.aekTable__table` (`data-fixed`): `__caption`, `__col`s (`data-highlight`), `__head`
 *   with `__header`s (`data-sortable` with `__sort`, a button of `__headerLabel` and `__sortMark`),
 *   `__body` (`data-virtual`, with virtual rows its `__spacer`s), a `__group` `<tbody>` per group
 *   (`data-key`) with its `__groupRow`, `__foot`; each `__row` (`data-key`, `aria-selected`;
 *   virtual rows' `data-stripe`, `data-pinned`) of `__cell`s (`data-align`, `data-tone`,
 *   `data-kind`; a stacked layout's `__cellLabel`; a bar's `__barBox` of `__bar` with its
 *   `__barPart`s (`data-part`) and `__barText`); `__emptyRow` with `__empty`.
 * - Custom properties (read on any ancestor, the token as the fallback): `--aek-table-max-height`
 *   (the box scrolls past it; default none), `--aek-table-bg` (the box's background and the sticky
 *   parts', default the surface: set it to the surface the table is on), `--aek-table-stripe` (the
 *   text colour at 3 %), `--aek-table-highlight` (the text colour at 8 %), `--aek-table-cell-padding`,
 *   `--aek-table-selected-color` (the selected row's bar, default the accent),
 *   `--aek-table-bar-height`, `--aek-table-bar-track`, `--aek-table-bar-1` to `-4` (a bar's
 *   segments), `--aek-table-row-height` (virtual rows' height, written by the table once measured).
 * - Keys: a sortable header's button sorts (Enter, Space). A plain table has no others: Tab reaches
 *   the sort buttons and the cells' controls, and while it overflows its box, the box is a tab stop
 *   the arrows scroll. A grid is one tab stop: the arrows move between the cells (the headers'
 *   too), Home / End to the row's ends, Ctrl / ⌘ + Home / End to the first and last cell,
 *   PageUp / PageDown by the box's rows; Space selects the row (toggles in a multiple selection),
 *   Enter activates it (and selects in a single one), Shift + a move or a click selects the range
 *   from the last picked row, Ctrl / ⌘ + click toggles, Ctrl / ⌘ + A selects every row (or none);
 *   Enter or F2 on a cell holding a control goes into it, Escape or F2 back to the cell.
 * - ARIA: a native `<table>` named by its caption, `<th scope="col">` headers (`scope="row"` for a
 *   `rowHeader` column, `scope="rowgroup"` for a group's header), `aria-sort` on the sorted
 *   column's header; a grid's `role="grid"` (`aria-multiselectable`) with `row`, `gridcell`,
 *   `columnheader` and `rowheader` roles, `aria-selected` on its rows; with virtual rows
 *   `aria-rowcount` on the table and `aria-rowindex` on each rendered row. While it overflows, its
 *   box is a `role="region"` named by the caption. With `stackBelow` every part also has its table
 *   role as an attribute, so the stacked layout's `display` changes keep them. A tone's mark and a
 *   bar are said as nothing: the text says the status and the figures. A user's sort is announced
 *   politely ("Sorted by Size, descending").
 *
 * A context menu over the rows is the app's: `createContextMenu({ target: table.cmp.elem, … })`,
 * its items found by `getKeyAt`, so a table without one carries none of its code.
 * @template T the rows' type
 * @example
 * ```ts
 * type Category = { id: string; name: string; bytes: number; count: number };
 *
 * const memory = createTable<Category>({
 *   caption: 'GPU memory by category',
 *   columns: [
 *     { key: 'name', label: 'Category', rowHeader: true, sortable: true },
 *     {
 *       key: 'bytes',
 *       label: 'Size',
 *       format: (bytes) => formatBytes(bytes as number),
 *       sortable: true,
 *     },
 *     { key: 'share', label: 'Share', value: (row) => row.bytes, kind: 'bar', format: () => '' },
 *     { key: 'count', label: 'Count', sortable: true },
 *   ],
 *   rows: () => getMemoryCategories(),
 *   footer: () => [getMemoryTotal()],
 *   sort: { key: 'bytes', direction: 'descending' },
 *   selection: 'single',
 *   onRowActivate: (category) => openCategoryWindow(category.id),
 *   striped: true,
 *   sticky: { header: true },
 *   scheduler, // the rows read again on the panel's refresh, and every 500 ms while shown
 *   interval: 500,
 * });
 * memoryPanel.add(memory.cmp);
 * memory.setCell('textures', 'bytes', textureBytes); // one live figure, one text node
 * ```
 */
export const createTable = <T>(props: TableProps<T>): Table<T> => {
  const getKey = props.getKey ?? defaultGetKey;
  const { sticky = {} } = props;
  const virtualImpl = useVirtualRows(props.virtual);
  // Virtual rows are one height: no stacked cards
  const stackBelow = virtualImpl ? undefined : props.stackBelow;
  const selectionMode = props.selection ?? 'none';
  const isGrid = selectionMode !== 'none' || Boolean(props.onRowActivate);
  const hasRoles = stackBelow !== undefined || isGrid;
  /** Rows the grid's keys or `aria-rowindex` count */
  const hasNav = isGrid || Boolean(virtualImpl);
  let rowsSource = props.rows ?? [];
  let groupsSource = props.groups ?? [];
  let footerSource = props.footer ?? [];
  let sort: TableSort | null = props.sort ?? null;
  const byKey = new Map<string, TableRowRecord<T>>();
  const groupsByKey = new Map<string, GroupRecord>();
  /** Each grid row by its `<tr>` (a view's, rebound as it shows another record) */
  const navByElem = new WeakMap<Element, TableNavRow>();
  /** The rows as shown at the last read: the ungrouped ones, each group's, the footer's, all */
  let bodyRecords: TableRowRecord<T>[] = [];
  let shownGroups: ShownGroup<T>[] = [];
  let footRecords: TableRowRecord<T>[] = [];
  let allRecords: TableRowRecord<T>[] = [];
  /** The ungrouped rows with a view (virtual rows: the window's and the tab stop's) */
  let mounted: TableRowRecord<T>[] = [];
  const pool: TableRowView<T>[] = [];
  /** The grid's rows in order at the last read */
  let navRows: TableNavRow[] = [];
  /** The rows a selection can take, in the table's order */
  let selectableKeys: string[] = [];
  let observer: ResizeObserver | null = null;
  let emptyCmp: CMPHandle | null = null;
  let removeScheduled: (() => void) | null = null;
  /** Virtual rows: where the rows start in the box is measured again (a resize) */
  let isInsetDirty = true;
  /** The listeners on the `<table>` and the sort buttons (not CMPs), removed with the table */
  const removers: (() => void)[] = [];

  const withRole = <E extends HTMLElement>(elem: E, role: string) => {
    if (hasRoles) elem.setAttribute('role', role);
    return elem;
  };
  const partsContext = { withRole, isGrid };

  const listenOn = (target: EventTarget, type: string, fn: (e: Event) => void) => {
    target.addEventListener(type, fn);
    removers.push(() => target.removeEventListener(type, fn));
  };

  const columns: TableColumnState<T>[] = props.columns
    .filter((def) => !def.hidden)
    .map((def) => createTableColumn(def, partsContext));
  const columnIndex = new Map(columns.map((column, index) => [column.def.key, index]));
  const barColumns = columns.flatMap((column, index) =>
    column.def.kind === 'bar' ? [{ column, index }] : []
  );

  const createNav = (
    elem: HTMLElement | null,
    cells: readonly HTMLElement[],
    key: string | null,
    size = cells.length
  ) => {
    const nav: TableNavRow = { elem, cells, size, key, index: -1 };
    if (elem) navByElem.set(elem, nav);
    return nav;
  };

  // --- The elements ---

  const rootAttr: Record<string, string> = {};
  if (props.striped) rootAttr['data-striped'] = '';
  if (props.highlight) rootAttr['data-highlight'] = props.highlight;
  if (sticky.header) rootAttr['data-sticky-header'] = '';
  if (sticky.firstColumn) rootAttr['data-sticky-column'] = '';
  if (isGrid) rootAttr['data-grid'] = '';

  const cmp = CMP({
    id: props.id,
    idAttr: props.id !== undefined,
    class: classes('aekTable', props.class),
    attr: { ...rootAttr, ...props.attr },
    onRemoveCmp: () => {
      removeScheduled?.();
      removeScheduled = null;
      observer?.disconnect();
      observer = null;
      for (const remove of removers.splice(0)) remove();
      grid?.dispose();
      virtualView?.dispose();
      for (const column of columns) column.tooltip?.cmp.remove();
      for (const record of byKey.values()) if (record.view) disposeTableView(record.view);
      for (const view of pool) disposeTableView(view);
      pool.length = 0;
      emptyCmp?.remove();
      emptyCmp = null;
      byKey.clear();
      groupsByKey.clear();
      bodyRecords = [];
      shownGroups = [];
      footRecords = [];
      allRecords = [];
      mounted = [];
      navRows = [];
    },
  });
  const box = cmp.add({ class: 'aekTable__scroll' }).elem;
  const table = withRole(createElem('table', 'aekTable__table'), isGrid ? 'grid' : 'table');
  if (columns.every((column) => column.def.width !== undefined)) {
    table.setAttribute('data-fixed', '');
  }
  const caption = createElem('caption', 'aekTable__caption');
  caption.id = `${cmp.id}-caption`;
  caption.textContent = props.caption;
  if (props.captionHidden) caption.classList.add('aekVisuallyHidden');
  if (isGrid) {
    // The caption names a native table; a grid role is named for every browser by the reference
    table.setAttribute('aria-labelledby', caption.id);
    if (selectionMode === 'multiple') table.setAttribute('aria-multiselectable', 'true');
  }
  const colgroup = createElem('colgroup', 'aekTable__cols');
  colgroup.append(...columns.map((column) => column.col));
  const head = withRole(createElem('thead', 'aekTable__head'), 'rowgroup');
  const headRow = withRole(createElem('tr', 'aekTable__headRow'), 'row');
  headRow.append(...columns.map((column) => column.header));
  head.append(headRow);
  const headNav = createNav(
    headRow,
    columns.map((column) => column.header),
    null
  );
  const body = withRole(createElem('tbody', 'aekTable__body'), 'rowgroup');
  const foot = withRole(createElem('tfoot', 'aekTable__foot'), 'rowgroup');
  table.append(caption, colgroup, head, body);
  box.append(table);

  const emptyRow = withRole(createElem('tr', 'aekTable__emptyRow'), 'row');
  const emptyCell = withRole(createElem('td', 'aekTable__empty'), isGrid ? 'gridcell' : 'cell');
  emptyCell.setAttribute('colspan', String(Math.max(1, columns.length)));
  if (isGrid) emptyCell.setAttribute('tabindex', '-1');
  emptyRow.append(emptyCell);
  const emptyNav = createNav(emptyRow, [emptyCell], null);
  if (typeof props.empty === 'string') emptyCell.textContent = props.empty;
  else if (props.empty) {
    emptyCmp = props.empty;
    emptyCell.append(emptyCmp.elem);
  }

  // --- Sort ---

  /** The comparison the shown sort puts rows in order by, or null (none, the app's, a column
   * that isn't shown) */
  const getSorter = () => {
    if (!sort || props.manualSort) return null;
    const { key, direction } = sort;
    const index = columnIndex.get(key);
    return index === undefined ? null : createTableSorter(columns[index], index, direction);
  };

  const writeSortAttrs = () => {
    for (const column of columns) {
      if (!column.sortButton) continue;
      const direction = sort?.key === column.def.key ? sort.direction : null;
      writeAttr(column.header, 'aria-sort', direction);
    }
  };

  // --- Records and views ---

  /** A column's alignment from its first value, once (a number: `end`) */
  const resolveAlign = (records: readonly TableRowRecord<T>[]) => {
    for (let i = 0; i < columns.length; i++) {
      const column = columns[i];
      if (column.align) continue;
      for (const record of records) {
        const value = record.values[i];
        if (value === null || value === undefined) continue;
        column.align = typeof value === 'number' ? 'end' : 'start';
        writeAttr(column.header, 'data-align', column.align === 'start' ? null : column.align);
        break;
      }
    }
  };

  const createRecord = (key: string, row: T): TableRowRecord<T> => ({
    key,
    row,
    values: [],
    read: 0,
    nav: createNav(null, NO_CELLS, key, columns.length),
    order: 0,
    bodyIndex: -1,
    isFoot: false,
    view: null,
  });

  /** Gives a record a view (the pool's, else a new one), written from its values */
  const bind = (record: TableRowRecord<T>) => {
    let view = record.view;
    if (!view) {
      view = pool.pop() ?? createTableView(columns, partsContext, stackBelow !== undefined);
      view.record = record;
      view.writtenRead = -1;
      record.view = view;
      view.elem.setAttribute('data-key', record.key);
      record.nav.elem = view.elem;
      record.nav.cells = view.cellElems;
      navByElem.set(view.elem, record.nav);
    }
    writeTableView(columns, view, isGrid);
    return view;
  };

  /** Lets go of a record's view: out of the page, its CMPs removed, to the pool */
  const release = (record: TableRowRecord<T>) => {
    const view = record.view;
    if (!view) return;
    record.view = null;
    record.nav.elem = null;
    record.nav.cells = NO_CELLS;
    view.record = null;
    view.elem.remove();
    disposeTableView(view);
    for (const name of RELEASED_ATTRS) view.elem.removeAttribute(name);
    pool.push(view);
  };

  const createGroup = (key: string): GroupRecord => {
    const groupBody = withRole(createElem('tbody', 'aekTable__group'), 'rowgroup');
    groupBody.setAttribute('data-key', key);
    const header = withRole(createElem('tr', 'aekTable__groupRow'), 'row');
    const cell = withRole(createElem('th', 'aekTable__groupHeader'), 'rowheader');
    cell.setAttribute('scope', 'rowgroup');
    cell.setAttribute('colspan', String(Math.max(1, columns.length)));
    if (isGrid) cell.setAttribute('tabindex', '-1');
    const label = document.createTextNode('');
    cell.append(label);
    header.append(cell);
    groupBody.append(header);
    return { key, body: groupBody, header, label, nav: createNav(header, [cell], null) };
  };

  const selection = createSelection({ mode: selectionMode, getOrder: () => selectableKeys });

  /** A rendered row's selected state (a grid with a selection; not the footer's) and place */
  const writeRowState = (record: TableRowRecord<T>) => {
    const view = record.view;
    if (!view) return;
    if (selectionMode !== 'none') {
      const selected = record.isFoot ? null : String(selection.has(record.key));
      writeAttr(view.elem, 'aria-selected', selected);
    }
    if (virtualView) writeAttr(view.elem, 'aria-rowindex', String(record.nav.index + 1));
  };

  const writeSelection = () => {
    for (const record of allRecords) writeRowState(record);
  };

  /** Reads the rows, groups and footer into records (a key's first place wins), sorts each
   * section, works out the bars' lengths, drops the records that went and lists the selection's
   * order and the grid's rows: whether a selected key went */
  const readRows = () => {
    const rows = read(rowsSource);
    const groups = read(groupsSource);
    const footer = read(footerSource);
    const sorter = getSorter();
    const seen = new Set<string>();
    const all: TableRowRecord<T>[] = [];
    const take = (list: readonly T[], isFoot: boolean) => {
      const records: TableRowRecord<T>[] = [];
      for (const row of list) {
        const key = getKey(row);
        if (seen.has(key)) continue;
        seen.add(key);
        let record = byKey.get(key);
        if (record) record.row = row;
        else {
          record = createRecord(key, row);
          byKey.set(key, record);
        }
        readTableRow(columns, record);
        record.order = records.length;
        record.isFoot = isFoot;
        record.bodyIndex = -1;
        records.push(record);
        all.push(record);
      }
      return records;
    };

    bodyRecords = take(rows, false);
    shownGroups = [];
    const seenGroups = new Set<string>();
    for (const group of groups) {
      if (seenGroups.has(group.key)) continue;
      seenGroups.add(group.key);
      let record = groupsByKey.get(group.key);
      if (!record) {
        record = createGroup(group.key);
        groupsByKey.set(group.key, record);
      }
      if (record.label.data !== group.label) record.label.data = group.label;
      shownGroups.push({ record, rows: take(group.rows, false) });
    }
    footRecords = take(footer, true);
    allRecords = all;
    resolveAlign(all);
    if (sorter) {
      bodyRecords.sort(sorter);
      for (const group of shownGroups) group.rows.sort(sorter);
    }
    bodyRecords.forEach((record, index) => (record.bodyIndex = index));
    for (const { column, index } of barColumns) measureTableBar(column, index, all);

    // What went
    for (const [key, record] of byKey) {
      if (seen.has(key)) continue;
      release(record);
      record.nav.index = -1;
      byKey.delete(key);
    }
    for (const [key, record] of groupsByKey) {
      if (seenGroups.has(key)) continue;
      record.body.remove();
      record.nav.index = -1;
      groupsByKey.delete(key);
    }

    if (selectionMode !== 'none') {
      selectableKeys = bodyRecords.map((record) => record.key);
      for (const group of shownGroups) {
        for (const record of group.rows) selectableKeys.push(record.key);
      }
    }
    if (hasNav) {
      for (const nav of navRows) nav.index = -1;
      navRows = [headNav];
      if (all.length === footRecords.length) navRows.push(emptyNav);
      for (const record of bodyRecords) navRows.push(record.nav);
      for (const group of shownGroups) {
        if (!group.rows.length) continue;
        navRows.push(group.record.nav);
        for (const record of group.rows) navRows.push(record.nav);
      }
      for (const record of footRecords) navRows.push(record.nav);
      navRows.forEach((nav, index) => (nav.index = index));
    }
    return selection.retain((key) => byKey.get(key)?.isFoot === false);
  };

  /** The ungrouped rows' elements: every row's, or (virtual rows) the window's between the spacers
   * and the tab stop's after them (hidden but focused) */
  const placeBody = (view: NonNullable<typeof virtualView>) => {
    const { start, end } = view.getWindow(bodyRecords.length);
    const stop = grid?.getStop();
    const stopRecord = stop?.key ? byKey.get(stop.key) : undefined;
    const pinned =
      stopRecord &&
      stopRecord.bodyIndex !== -1 &&
      (stopRecord.bodyIndex < start || stopRecord.bodyIndex >= end)
        ? stopRecord
        : null;
    for (const record of mounted) {
      // A row now in a group or the footer keeps its view; one out of the window lets it go
      if (record.bodyIndex === -1 || record === pinned) continue;
      if (record.bodyIndex < start || record.bodyIndex >= end) release(record);
    }
    mounted = bodyRecords.slice(start, end);
    const elems: HTMLElement[] = [view.top];
    for (const record of mounted) {
      const { elem } = bind(record);
      writeAttr(elem, 'data-pinned', null);
      writeAttr(elem, 'data-stripe', record.bodyIndex % 2 ? '' : null);
      elems.push(elem);
    }
    elems.push(view.bottom);
    if (pinned) {
      const { elem } = bind(pinned);
      writeAttr(elem, 'data-pinned', '');
      elems.push(elem);
      mounted.push(pinned);
    }
    view.layout(bodyRecords.length, start, end);
    return elems;
  };

  /** Puts the rows in the page: the views bound and written where behind, the elements moved
   * only where out of place */
  const place = () => {
    const bodyElems = virtualView
      ? placeBody(virtualView)
      : bodyRecords.map((record) => bind(record).elem);
    const total = allRecords.length - footRecords.length;
    const parts: HTMLElement[] = [caption, colgroup, head, body];
    for (const group of shownGroups) {
      writeAttr(group.record.body, 'hidden', group.rows.length ? null : '');
      const elems = [group.record.header];
      for (const record of group.rows) elems.push(bind(record).elem);
      placeElems(group.record.body, elems);
      parts.push(group.record.body);
    }
    const footElems = footRecords.map((record) => bind(record).elem);
    for (const record of virtualView ? mounted : bodyRecords) writeRowState(record);
    for (const group of shownGroups) for (const record of group.rows) writeRowState(record);
    for (const record of footRecords) writeRowState(record);

    placeElems(body, total ? bodyElems : [emptyRow]);
    if (total) emptyRow.remove();
    placeElems(foot, footElems);
    if (footElems.length) parts.push(foot);
    else foot.remove();
    placeElems(table, parts);

    if (virtualView) {
      writeAttr(table, 'aria-rowcount', String(navRows.length));
      writeAttr(headRow, 'aria-rowindex', '1');
      writeAttr(emptyRow, 'aria-rowindex', total ? null : '2');
      for (const group of shownGroups) {
        writeAttr(group.record.header, 'aria-rowindex', String(group.record.nav.index + 1));
      }
      // The first row rendered gives the height when none was given: the window again with it
      const first = mounted[0]?.view;
      if (first && first.elem.isConnected && virtualView.measure(first.elem)) place();
    }
  };

  /** Virtual rows: where the rows start in the box's content and the sticky header's cover,
   * measured when the table is in the page (a layout read: at the first render and a resize) */
  const measureInset = () => {
    if (!virtualView || !isInsetDirty || !cmp.elem.isConnected) return;
    const boxRect = box.getBoundingClientRect();
    if (!boxRect.height) return;
    isInsetDirty = false;
    const top =
      virtualView.top.getBoundingClientRect().top - boxRect.top - box.clientTop + box.scrollTop;
    const covered = sticky.header ? head.getBoundingClientRect().height : 0;
    virtualView.setInset(Math.max(0, top), covered);
  };

  /** Reads the rows, groups and footer and puts them in the page; a selected key the rows lost is
   * reported when `report` */
  const render = (report = true) => {
    const hadFocus = grid?.hasFocus() ?? false;
    const changed = readRows();
    place();
    measureInset();
    grid?.settle(hadFocus);
    if (changed && report) props.onSelectionChange?.(selection.get());
  };

  // --- The user's input ---

  const reportSelection = () => {
    writeSelection();
    props.onSelectionChange?.(selection.get());
  };

  const pick = (key: string, gesture: ReturnType<typeof getSelectionGesture>) => {
    if (byKey.get(key)?.isFoot !== false) return;
    if (selection.pick(key, gesture)) reportSelection();
  };

  const activate = (key: string) => {
    const record = byKey.get(key);
    if (!record || record.isFoot) return;
    if (selectionMode === 'single') pick(key, 'replace');
    props.onRowActivate?.(record.row, key);
  };

  const onSortPress = (column: TableColumnState<T>) => {
    const { key, label } = column.def;
    let next: TableSort | null;
    if (sort?.key !== key) next = { key, direction: 'ascending' };
    else if (sort.direction === 'ascending') next = { key, direction: 'descending' };
    else next = props.sortUnset ? null : { key, direction: 'ascending' };
    sort = next;
    writeSortAttrs();
    render();
    announce(cmp.elem, next ? `Sorted by ${label}, ${next.direction}` : 'Not sorted');
    props.onSortChange?.(next);
  };

  for (const column of columns) {
    if (column.sortButton) listenOn(column.sortButton, 'click', () => onSortPress(column));
  }

  /** Scrolls the box to an ungrouped row (virtual rows) and renders it */
  const revealRecord = (record: TableRowRecord<T> | undefined) => {
    if (!virtualView || !record || record.bodyIndex === -1) return false;
    virtualView.scrollToIndex(record.bodyIndex);
    place();
    return true;
  };

  const grid = isGrid
    ? createTableGrid({
        table,
        getRows: () => navRows,
        getRow: (elem) => navByElem.get(elem),
        getTarget: (row, column) =>
          (row === headNav ? columns[column]?.sortButton : null) ??
          (row.cells[column] as HTMLElement),
        getStartIndex: () => {
          const selected = navRows.findIndex((nav) => nav.key !== null && selection.has(nav.key));
          if (selected !== -1) return selected;
          const first = navRows.findIndex((nav) => nav.key !== null);
          return first === -1 ? 0 : first;
        },
        reveal: (row) => {
          revealRecord(row.key ? byKey.get(row.key) : undefined);
        },
        place,
        getPageSize: (row) => {
          if (virtualView) return virtualView.getPageSize();
          const height = row.elem?.offsetHeight ?? 0;
          if (!height || !(box.scrollHeight > box.clientHeight)) return DEFAULT_PAGE_SIZE;
          return Math.max(1, Math.floor(box.clientHeight / height));
        },
        onSpace: (key, e) => pick(key, getSelectionGesture(e, selectionMode === 'multiple')),
        onEnter: activate,
        onRange: (key) => {
          if (selectionMode === 'multiple') pick(key, 'range');
        },
        onAll: () => {
          if (selectionMode !== 'multiple') return false;
          if (selection.all()) reportSelection();
          return true;
        },
        onClick: (key, e) => {
          pick(key, getSelectionGesture(e));
          if (!e.shiftKey && !e.ctrlKey && !e.metaKey) {
            const record = byKey.get(key);
            if (record && !record.isFoot) props.onRowActivate?.(record.row, key);
          }
        },
        listen: (type, fn) => listenOn(table, type, fn),
      })
    : null;

  const virtualView =
    virtualImpl?.attach(
      box,
      {
        spacerTag: 'tr',
        spacerClass: 'aekTable__spacer',
        rowHeightProperty: '--aek-table-row-height',
      },
      () => place()
    ) ?? null;
  if (virtualView) {
    body.setAttribute('data-virtual', '');
    for (const spacer of [virtualView.top, virtualView.bottom]) {
      const cell = createElem('td', 'aekTable__spacerCell');
      cell.setAttribute('colspan', String(Math.max(1, columns.length)));
      spacer.append(cell);
    }
  }

  // --- Highlight, overflow, the stacked layout ---

  if (props.highlight === 'column' || props.highlight === 'cross') {
    listenColumnHighlight(table, columns, (type, fn) => listenOn(table, type, fn));
  }

  /** While the table overflows its box, the box is a named region and a tab stop (axe's
   * `scrollable-region-focusable`), so a keyboard can scroll it; a grid's arrows scroll it */
  const writeOverflow = () => {
    const isOverflowing = box.scrollWidth > box.clientWidth || box.scrollHeight > box.clientHeight;
    writeAttr(box, 'role', isOverflowing ? 'region' : null);
    writeAttr(box, 'aria-labelledby', isOverflowing ? caption.id : null);
    writeAttr(box, 'tabindex', isOverflowing && !isGrid ? '0' : null);
  };

  if (typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.target !== cmp.elem || stackBelow === undefined) continue;
        const { width } = entry.contentRect;
        writeAttr(cmp.elem, 'data-stacked', width > 0 && width < stackBelow ? '' : null);
      }
      writeOverflow();
      // The caption and the header may have wrapped: where the rows start again
      isInsetDirty = true;
      measureInset();
    });
    observer.observe(cmp.elem);
    observer.observe(table);
  }

  if (props.selected) selection.set(props.selected);
  writeSortAttrs();
  render(false);

  if (props.scheduler || props.interval !== undefined) {
    removeScheduled = addScheduledRefresh(props.scheduler ?? getPageScheduler(), () => render(), {
      interval: props.interval,
      isShown: () => cmp.elem.isConnected && !cmp.elem.closest('[hidden]'),
    });
  }

  return {
    cmp,
    setRows: (rows) => {
      rowsSource = rows;
      render();
    },
    setGroups: (groups) => {
      groupsSource = groups;
      render();
    },
    setFooter: (rows) => {
      footerSource = rows;
      render();
    },
    setCell: (key, columnKey, value) => {
      const record = byKey.get(key);
      const index = columnIndex.get(columnKey);
      if (!record || index === undefined) return;
      record.values[index] = value;
      const column = columns[index];
      if (column.def.kind === 'bar' && measureTableBar(column, index, allRecords)) {
        writeTableBars(column, index, allRecords);
      }
      const view = record.view;
      if (view) writeTableCell(column, view.cells[index], value, record.row, isGrid);
    },
    setSort: (next) => {
      sort = next;
      writeSortAttrs();
      render();
    },
    getSort: () => sort,
    setSelected: (keys) => {
      selection.set(keys.filter((key) => byKey.get(key)?.isFoot === false));
      writeSelection();
    },
    getSelected: () => selection.get(),
    scrollToKey: (key) => {
      const record = byKey.get(key);
      if (revealRecord(record)) return;
      const elem = record?.view?.elem;
      if (!elem || !elem.isConnected) return;
      const boxRect = box.getBoundingClientRect();
      const rect = elem.getBoundingClientRect();
      const top = boxRect.top + (sticky.header ? head.offsetHeight : 0);
      if (rect.top < top) box.scrollTop -= top - rect.top;
      else if (rect.bottom > boxRect.bottom) box.scrollTop += rect.bottom - boxRect.bottom;
    },
    getKeyAt: (elem) => {
      const row = elem.closest(`.${ROW_CLASS}`);
      return row && table.contains(row) ? row.getAttribute('data-key') : null;
    },
    refresh: () => render(),
  };
};
