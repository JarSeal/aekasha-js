import { CMP, classes } from '../core/CMP';
import type { CMPHandle } from '../core/CMPTypes';
import { announce } from '../components/Announcer';
import { createElem, placeElems, writeAttr } from './CollectionParts';
import { createSelection, getSelectionGesture } from './Selection';
import { createTableGrid } from './TableGrid';
import {
  createTableCell,
  createTableColumn,
  createTableSorter,
  disposeTableRow,
  writeTableBars,
  writeTableRow,
  type TableColumnState,
  type TableNavRow,
  type TableRowRecord,
} from './TableRows';
import type { Table, TableProps, TableSort } from './TableTypes';
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

const ROW_CLASS = 'aekTable__row';

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
 * (one text node each).
 * - Parts: `.aekTable` (`data-striped`, `data-highlight`, `data-sticky-header`,
 *   `data-sticky-column`, `data-stacked`, `data-grid`) with `__scroll` (the scroll box) holding
 *   `table.aekTable__table` (`data-fixed`): `__caption`, `__col`s (`data-highlight`), `__head`
 *   with `__header`s (`data-sortable` with `__sort`, a button of `__headerLabel` and `__sortMark`),
 *   `__body`, a `__group` `<tbody>` per group (`data-key`) with its `__groupRow`, `__foot`; each
 *   `__row` (`data-key`, `aria-selected`) of `__cell`s (`data-align`, `data-tone`, `data-kind`; a
 *   stacked layout's `__cellLabel`; a bar's `__barBox` of `__bar` with its `__barPart`s
 *   (`data-part`) and `__barText`); `__emptyRow` with `__empty`.
 * - Custom properties (read on any ancestor, the token as the fallback): `--aek-table-max-height`
 *   (the box scrolls past it; default none), `--aek-table-bg` (the box's background and the sticky
 *   parts', default the surface: set it to the surface the table is on), `--aek-table-stripe` (the
 *   text colour at 3 %), `--aek-table-highlight` (the text colour at 8 %), `--aek-table-cell-padding`,
 *   `--aek-table-selected-color` (the selected row's bar, default the accent),
 *   `--aek-table-bar-height`, `--aek-table-bar-track`, `--aek-table-bar-1` to `-4` (a bar's
 *   segments).
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
 *   `columnheader` and `rowheader` roles, `aria-selected` on its rows. While it overflows, its box
 *   is a `role="region"` named by the caption. With `stackBelow` every part also has its table role
 *   as an attribute, so the stacked layout's `display` changes keep them. A tone's mark and a bar
 *   are said as nothing: the text says the status and the figures. A user's sort is announced
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
 * });
 * memoryPanel.add(memory.cmp);
 * memory.refresh(); // the figures again
 * ```
 */
export const createTable = <T>(props: TableProps<T>): Table<T> => {
  const getKey = props.getKey ?? defaultGetKey;
  const { sticky = {}, stackBelow } = props;
  const selectionMode = props.selection ?? 'none';
  const isGrid = selectionMode !== 'none' || Boolean(props.onRowActivate);
  const hasRoles = stackBelow !== undefined || isGrid;
  const isColumnHighlight = props.highlight === 'column' || props.highlight === 'cross';
  let rowsSource = props.rows ?? [];
  let groupsSource = props.groups ?? [];
  let footerSource = props.footer ?? [];
  let sort: TableSort | null = props.sort ?? null;
  const byKey = new Map<string, TableRowRecord<T>>();
  const groupsByKey = new Map<string, GroupRecord>();
  /** Each grid row by its `<tr>` (records keep theirs until they go) */
  const navByElem = new WeakMap<Element, TableNavRow>();
  /** The grid's rows in order at the last render */
  let navRows: TableNavRow[] = [];
  /** The rows a selection can take, in the table's order */
  let selectableKeys: string[] = [];
  let observer: ResizeObserver | null = null;
  let highlighted: HTMLElement | null = null;
  let emptyCmp: CMPHandle | null = null;
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
  const hasBars = columns.some((column) => column.def.kind === 'bar');

  const createNav = (elem: HTMLElement, cells: HTMLElement[], key: string | null) => {
    const nav: TableNavRow = { elem, cells, key, index: -1 };
    navByElem.set(elem, nav);
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
      observer?.disconnect();
      observer = null;
      for (const remove of removers.splice(0)) remove();
      grid?.dispose();
      for (const column of columns) column.tooltip?.cmp.remove();
      for (const record of byKey.values()) disposeTableRow(record);
      emptyCmp?.remove();
      emptyCmp = null;
      byKey.clear();
      groupsByKey.clear();
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
    const index = columns.findIndex((column) => column.def.key === key);
    return index === -1 ? null : createTableSorter(columns[index], index, direction);
  };

  const writeSortAttrs = () => {
    for (const column of columns) {
      if (!column.sortButton) continue;
      const direction = sort?.key === column.def.key ? sort.direction : null;
      writeAttr(column.header, 'aria-sort', direction);
    }
  };

  // --- Rows ---

  /** A column's alignment from its first value, once (a number: `end`) */
  const resolveAlign = (rows: readonly T[]) => {
    for (const column of columns) {
      if (column.align) continue;
      for (const row of rows) {
        const value = column.def.value
          ? column.def.value(row)
          : (row as Record<string, unknown>)[column.def.key];
        if (value === null || value === undefined) continue;
        column.align = typeof value === 'number' ? 'end' : 'start';
        writeAttr(column.header, 'data-align', column.align === 'start' ? null : column.align);
        break;
      }
    }
  };

  const createRecord = (key: string, row: T): TableRowRecord<T> => {
    const elem = withRole(createElem('tr', ROW_CLASS), 'row');
    elem.setAttribute('data-key', key);
    const cells = columns.map((column) =>
      createTableCell(column, partsContext, stackBelow !== undefined)
    );
    const cellElems = cells.map((cell) => cell.elem);
    elem.append(...cellElems);
    return { key, row, elem, cells, nav: createNav(elem, cellElems, key), order: 0, isFoot: false };
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

  /** Writes each data row's selected state where it changed (a grid with a selection) */
  const writeSelection = () => {
    if (selectionMode === 'none') return;
    for (const record of byKey.values()) {
      writeAttr(
        record.elem,
        'aria-selected',
        record.isFoot ? null : String(selection.has(record.key))
      );
    }
  };

  /** Reads the rows, groups and footer and writes them: kept keys keep their rows (a key's first
   * place wins), the others made or removed, each section sorted, the elements moved only where
   * out of place; a selected key the rows lost is reported when `report` */
  const render = (report = true) => {
    const hadFocus = grid?.hasFocus() ?? false;
    const rows = read(rowsSource);
    const groups = read(groupsSource);
    const footer = read(footerSource);
    resolveAlign(rows);
    for (const group of groups) resolveAlign(group.rows);
    resolveAlign(footer);
    const sorter = getSorter();

    const seen = new Set<string>();
    const all: TableRowRecord<T>[] = [];
    const takeRows = (list: readonly T[], isFoot: boolean) => {
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
        record.order = records.length;
        record.isFoot = isFoot;
        writeTableRow(columns, record, isGrid);
        records.push(record);
        all.push(record);
      }
      if (sorter && !isFoot) records.sort(sorter);
      return records;
    };

    const bodyRecords = takeRows(rows, false);
    let total = bodyRecords.length;
    const shownGroups: { record: GroupRecord; rows: TableRowRecord<T>[] }[] = [];
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
      const records = takeRows(group.rows, false);
      total += records.length;
      writeAttr(record.body, 'hidden', records.length ? null : '');
      placeElems(record.body, [record.header, ...records.map((r) => r.elem)]);
      shownGroups.push({ record, rows: records });
    }
    const footRecords = takeRows(footer, true);
    if (hasBars) writeTableBars(columns, all);

    // What went: rows first (a moved row is in its new place already)
    for (const [key, record] of byKey) {
      if (seen.has(key)) continue;
      record.elem.remove();
      record.nav.index = -1;
      disposeTableRow(record);
      byKey.delete(key);
    }
    for (const [key, record] of groupsByKey) {
      if (seenGroups.has(key)) continue;
      record.body.remove();
      record.nav.index = -1;
      groupsByKey.delete(key);
    }

    placeElems(body, total ? bodyRecords.map((record) => record.elem) : [emptyRow]);
    if (total) emptyRow.remove();
    placeElems(
      foot,
      footRecords.map((record) => record.elem)
    );
    const parts: HTMLElement[] = [caption, colgroup, head, body];
    for (const group of shownGroups) parts.push(group.record.body);
    if (footRecords.length) parts.push(foot);
    else foot.remove();
    placeElems(table, parts);

    // The selection's order and the grid's rows, in the order shown
    selectableKeys = bodyRecords.map((record) => record.key);
    for (const group of shownGroups) {
      for (const record of group.rows) selectableKeys.push(record.key);
    }
    const changed = selection.retain((key) => byKey.get(key)?.isFoot === false);
    writeSelection();
    if (isGrid) {
      for (const nav of navRows) nav.index = -1;
      navRows = [headNav];
      if (!total) navRows.push(emptyNav);
      for (const record of bodyRecords) navRows.push(record.nav);
      for (const group of shownGroups) {
        if (!group.rows.length) continue;
        navRows.push(group.record.nav);
        for (const record of group.rows) navRows.push(record.nav);
      }
      for (const record of footRecords) navRows.push(record.nav);
      navRows.forEach((nav, index) => (nav.index = index));
      grid?.settle(hadFocus);
    }
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

  const grid = isGrid
    ? createTableGrid({
        table,
        box,
        getRows: () => navRows,
        getRow: (elem) => navByElem.get(elem),
        getTarget: (row, column) =>
          (row === headNav ? columns[column]?.sortButton : null) ?? row.cells[column],
        getStartIndex: () => {
          const selected = navRows.findIndex((nav) => nav.key !== null && selection.has(nav.key));
          if (selected !== -1) return selected;
          const first = navRows.findIndex((nav) => nav.key !== null);
          return first === -1 ? 0 : first;
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

  // --- Highlight, overflow, the stacked layout ---

  /** The column of a cell holding the target: its `<col>` (none for a group's header) */
  const findCol = (target: EventTarget | null) => {
    const cell = (target as Element | null)?.closest?.('td, th');
    const row = cell?.parentNode as Element | null;
    if (!cell || !row || !table.contains(cell) || cell.hasAttribute('colspan')) return null;
    const index = Array.prototype.indexOf.call(row.children, cell) as number;
    return columns[index]?.col ?? null;
  };

  const setHighlighted = (col: HTMLElement | null) => {
    if (col === highlighted) return;
    highlighted?.removeAttribute('data-highlight');
    col?.setAttribute('data-highlight', '');
    highlighted = col;
  };

  if (isColumnHighlight) {
    listenOn(table, 'pointerover', (e) => setHighlighted(findCol(e.target)));
    listenOn(table, 'pointerleave', () => setHighlighted(null));
    listenOn(table, 'focusin', (e) => setHighlighted(findCol(e.target)));
    listenOn(table, 'focusout', (e) => {
      if (!table.contains((e as FocusEvent).relatedTarget as Node | null)) setHighlighted(null);
    });
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
    });
    observer.observe(cmp.elem);
    observer.observe(table);
  }

  if (props.selected) selection.set(props.selected);
  writeSortAttrs();
  render(false);

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
      const elem = byKey.get(key)?.elem;
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
    refresh: render,
  };
};
