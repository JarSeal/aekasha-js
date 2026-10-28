import { CMP, classes } from '../core/CMP';
import type { CMPHandle } from '../core/CMPTypes';
import { createElem, placeElems, writeAttr } from './CollectionParts';
import type { Table, TableColumn, TableProps } from './TableTypes';
import './Table.scss';
import '../styles/kit.scss';

/** A shown column: its definition, its `<col>`, its header and its alignment once known */
type ColumnState<T> = {
  def: TableColumn<T>;
  col: HTMLElement;
  header: HTMLElement;
  /** `start`, `center`, `end`, or null until a value says (a number: `end`) */
  align: 'start' | 'center' | 'end' | null;
};

/** A cell and what it last showed */
type TableCell = {
  elem: HTMLElement;
  text: Text;
  written: string;
  tone: string | null;
  align: string | null;
};

/** A row's record: its key, its row, its element and cells */
type RowRecord<T> = { key: string; row: T; elem: HTMLElement; cells: TableCell[] };

/** A group's record: its `<tbody>`, its header row and label */
type GroupRecord = { key: string; body: HTMLElement; header: HTMLElement; label: Text };

const ROW_CLASS = 'aekTable__row';

const defaultGetKey = (row: unknown) => String((row as { id?: unknown }).id);

/** A px number as a length, a string as it is */
const toLength = (value: number | string) => (typeof value === 'number' ? `${value}px` : value);

const readValue = <T>(column: TableColumn<T>, row: T) =>
  column.value ? column.value(row) : (row as Record<string, unknown>)[column.key];

const formatValue = <T>(column: TableColumn<T>, value: unknown, row: T) => {
  if (column.format) return column.format(value, row);
  return value === null || value === undefined ? '' : String(value);
};

const read = <V>(source: V | (() => V)) =>
  typeof source === 'function' ? (source as () => V)() : source;

/**
 * Creates a table (p805 D5): an app's rows under its columns, each cell a value as text (`format`)
 * aligned by its kind, with groups (a `<tbody>` each, under a header row), a footer, a caption,
 * sticky parts, stripes, a highlight on hover and focus, and a stacked layout for a narrow box.
 * Rows are kept by key, so new rows write only the cells whose text changed (one text node each).
 * - Parts: `.aekTable` (`data-striped`, `data-highlight`, `data-sticky-header`,
 *   `data-sticky-column`, `data-stacked`) with `__scroll` (the scroll box) holding
 *   `table.aekTable__table` (`data-fixed`): `__caption`, `__col`s (`data-highlight`), `__head` with
 *   `__header`s, `__body`, a `__group` `<tbody>` per group (`data-key`) with its `__groupRow`,
 *   `__foot`; each `__row` (`data-key`) of `__cell`s (`data-align`, `data-tone`; a stacked
 *   layout's `__cellLabel`); `__emptyRow` with `__empty`.
 * - Custom properties (read on any ancestor, the token as the fallback): `--aek-table-max-height`
 *   (the box scrolls past it; default none), `--aek-table-bg` (the box's background and the sticky
 *   parts', default the surface: set it to the surface the table is on), `--aek-table-stripe` (the
 *   text colour at 3 %), `--aek-table-highlight` (the text colour at 8 %), `--aek-table-cell-padding`.
 * - Keys: none of its own (a native table). While it overflows its box, the box is a tab stop, so
 *   the arrows scroll it.
 * - ARIA: a native `<table>` named by its caption, `<th scope="col">` headers (`scope="row"` for a
 *   `rowHeader` column, `scope="rowgroup"` for a group's header). While it overflows, its box is a
 *   `role="region"` named by the caption. With `stackBelow` every part also has its table role as
 *   an attribute, so the stacked layout's `display` changes keep them. A tone's mark is said as
 *   nothing: the text says the status.
 * @template T the rows' type
 * @example
 * ```ts
 * type Category = { id: string; name: string; bytes: number; count: number };
 *
 * const memory = createTable<Category>({
 *   caption: 'GPU memory by category',
 *   columns: [
 *     { key: 'name', label: 'Category', rowHeader: true },
 *     { key: 'bytes', label: 'Size', format: (bytes) => formatBytes(bytes as number) },
 *     { key: 'count', label: 'Count' },
 *   ],
 *   rows: () => getMemoryCategories(),
 *   footer: () => [getMemoryTotal()],
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
  const hasRoles = stackBelow !== undefined;
  const isColumnHighlight = props.highlight === 'column' || props.highlight === 'cross';
  let rowsSource = props.rows ?? [];
  let groupsSource = props.groups ?? [];
  let footerSource = props.footer ?? [];
  const byKey = new Map<string, RowRecord<T>>();
  const groupsByKey = new Map<string, GroupRecord>();
  let observer: ResizeObserver | null = null;
  let highlighted: HTMLElement | null = null;
  let emptyCmp: CMPHandle | null = null;
  /** The listeners on the `<table>` (not a CMP), removed with the table */
  const removers: (() => void)[] = [];

  const withRole = <E extends HTMLElement>(elem: E, role: string) => {
    if (hasRoles) elem.setAttribute('role', role);
    return elem;
  };

  const columns: ColumnState<T>[] = props.columns
    .filter((def) => !def.hidden)
    .map((def) => {
      const col = createElem('col', 'aekTable__col');
      col.setAttribute('data-key', def.key);
      if (def.width !== undefined) col.style.width = toLength(def.width);
      const header = withRole(createElem('th', 'aekTable__header'), 'columnheader');
      header.setAttribute('scope', 'col');
      header.setAttribute('data-key', def.key);
      header.textContent = def.label;
      if (def.minWidth !== undefined) header.style.minWidth = toLength(def.minWidth);
      return { def, col, header, align: def.align ?? null };
    });

  // --- The elements ---

  const rootAttr: Record<string, string> = {};
  if (props.striped) rootAttr['data-striped'] = '';
  if (props.highlight) rootAttr['data-highlight'] = props.highlight;
  if (sticky.header) rootAttr['data-sticky-header'] = '';
  if (sticky.firstColumn) rootAttr['data-sticky-column'] = '';

  const cmp = CMP({
    id: props.id,
    idAttr: props.id !== undefined,
    class: classes('aekTable', props.class),
    attr: { ...rootAttr, ...props.attr },
    onRemoveCmp: () => {
      observer?.disconnect();
      observer = null;
      for (const remove of removers.splice(0)) remove();
      emptyCmp?.remove();
      emptyCmp = null;
      byKey.clear();
      groupsByKey.clear();
    },
  });
  const box = cmp.add({ class: 'aekTable__scroll' }).elem;
  const table = withRole(createElem('table', 'aekTable__table'), 'table');
  if (columns.every((column) => column.def.width !== undefined)) {
    table.setAttribute('data-fixed', '');
  }
  const caption = createElem('caption', 'aekTable__caption');
  caption.id = `${cmp.id}-caption`;
  caption.textContent = props.caption;
  if (props.captionHidden) caption.classList.add('aekVisuallyHidden');
  const colgroup = createElem('colgroup', 'aekTable__cols');
  colgroup.append(...columns.map((column) => column.col));
  const head = withRole(createElem('thead', 'aekTable__head'), 'rowgroup');
  const headRow = withRole(createElem('tr', 'aekTable__headRow'), 'row');
  headRow.append(...columns.map((column) => column.header));
  head.append(headRow);
  const body = withRole(createElem('tbody', 'aekTable__body'), 'rowgroup');
  const foot = withRole(createElem('tfoot', 'aekTable__foot'), 'rowgroup');
  table.append(caption, colgroup, head, body);
  box.append(table);

  const emptyRow = withRole(createElem('tr', 'aekTable__emptyRow'), 'row');
  const emptyCell = withRole(createElem('td', 'aekTable__empty'), 'cell');
  emptyCell.setAttribute('colspan', String(Math.max(1, columns.length)));
  emptyRow.append(emptyCell);
  if (typeof props.empty === 'string') emptyCell.textContent = props.empty;
  else if (props.empty) {
    emptyCmp = props.empty;
    emptyCell.append(emptyCmp.elem);
  }

  // --- Rows ---

  /** A column's alignment from its first value, once (a number: `end`) */
  const resolveAlign = (rows: readonly T[]) => {
    for (const column of columns) {
      if (column.align) continue;
      for (const row of rows) {
        const value = readValue(column.def, row);
        if (value === null || value === undefined) continue;
        column.align = typeof value === 'number' ? 'end' : 'start';
        writeAttr(column.header, 'data-align', column.align === 'start' ? null : column.align);
        break;
      }
    }
  };

  const createCell = (column: ColumnState<T>): TableCell => {
    const isHeader = column.def.rowHeader;
    const elem = withRole(
      createElem(isHeader ? 'th' : 'td', 'aekTable__cell'),
      isHeader ? 'rowheader' : 'cell'
    );
    if (isHeader) elem.setAttribute('scope', 'row');
    if (hasRoles) {
      const label = createElem('span', 'aekTable__cellLabel');
      label.setAttribute('aria-hidden', 'true');
      label.textContent = column.def.label;
      elem.append(label);
    }
    const text = document.createTextNode('');
    elem.append(text);
    return { elem, text, written: '', tone: null, align: null };
  };

  /** Writes a row's cells where their text, tone or alignment changed */
  const writeRow = (record: RowRecord<T>) => {
    const { row, cells } = record;
    for (let i = 0; i < columns.length; i++) {
      const column = columns[i];
      const cell = cells[i];
      const text = formatValue(column.def, readValue(column.def, row), row);
      if (cell.written !== text) {
        cell.written = text;
        cell.text.data = text;
      }
      const tone = column.def.tone?.(row) ?? null;
      if (cell.tone !== tone) {
        cell.tone = tone;
        writeAttr(cell.elem, 'data-tone', tone);
      }
      const align = column.align === 'start' ? null : column.align;
      if (cell.align !== align) {
        cell.align = align;
        writeAttr(cell.elem, 'data-align', align);
      }
    }
  };

  const createRecord = (key: string, row: T): RowRecord<T> => {
    const elem = withRole(createElem('tr', ROW_CLASS), 'row');
    elem.setAttribute('data-key', key);
    const cells = columns.map(createCell);
    elem.append(...cells.map((cell) => cell.elem));
    return { key, row, elem, cells };
  };

  const createGroup = (key: string): GroupRecord => {
    const groupBody = withRole(createElem('tbody', 'aekTable__group'), 'rowgroup');
    groupBody.setAttribute('data-key', key);
    const header = withRole(createElem('tr', 'aekTable__groupRow'), 'row');
    const cell = withRole(createElem('th', 'aekTable__groupHeader'), 'rowheader');
    cell.setAttribute('scope', 'rowgroup');
    cell.setAttribute('colspan', String(Math.max(1, columns.length)));
    const label = document.createTextNode('');
    cell.append(label);
    header.append(cell);
    groupBody.append(header);
    return { key, body: groupBody, header, label };
  };

  /** Reads the rows, groups and footer and writes them: kept keys keep their rows (a key's first
   * place wins), the others made or removed, the elements moved only where out of place */
  const render = () => {
    const rows = read(rowsSource);
    const groups = read(groupsSource);
    const footer = read(footerSource);
    resolveAlign(rows);
    for (const group of groups) resolveAlign(group.rows);
    resolveAlign(footer);

    const seen = new Set<string>();
    const takeRows = (list: readonly T[]) => {
      const elems: HTMLElement[] = [];
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
        writeRow(record);
        elems.push(record.elem);
      }
      return elems;
    };

    const bodyElems = takeRows(rows);
    let total = bodyElems.length;
    const groupBodies: HTMLElement[] = [];
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
      const elems = takeRows(group.rows);
      total += elems.length;
      writeAttr(record.body, 'hidden', elems.length ? null : '');
      placeElems(record.body, [record.header, ...elems]);
      groupBodies.push(record.body);
    }
    const footElems = takeRows(footer);

    // What went: rows first (a moved row is in its new place already)
    for (const [key, record] of byKey) {
      if (seen.has(key)) continue;
      record.elem.remove();
      byKey.delete(key);
    }
    for (const [key, record] of groupsByKey) {
      if (seenGroups.has(key)) continue;
      record.body.remove();
      groupsByKey.delete(key);
    }

    placeElems(body, total ? bodyElems : [emptyRow]);
    if (total) emptyRow.remove();
    placeElems(foot, footElems);
    const parts: HTMLElement[] = [caption, colgroup, head, body, ...groupBodies];
    if (footElems.length) parts.push(foot);
    else foot.remove();
    placeElems(table, parts);
  };

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

  const listen = (type: string, fn: (e: Event) => void) => {
    table.addEventListener(type, fn);
    removers.push(() => table.removeEventListener(type, fn));
  };

  if (isColumnHighlight) {
    listen('pointerover', (e) => setHighlighted(findCol(e.target)));
    listen('pointerleave', () => setHighlighted(null));
    listen('focusin', (e) => setHighlighted(findCol(e.target)));
    listen('focusout', (e) => {
      if (!table.contains((e as FocusEvent).relatedTarget as Node | null)) setHighlighted(null);
    });
  }

  /** While the table overflows its box, the box is a named region and a tab stop (axe's
   * `scrollable-region-focusable`), so a keyboard can scroll it */
  const writeOverflow = () => {
    const isOverflowing = box.scrollWidth > box.clientWidth || box.scrollHeight > box.clientHeight;
    writeAttr(box, 'role', isOverflowing ? 'region' : null);
    writeAttr(box, 'aria-labelledby', isOverflowing ? caption.id : null);
    writeAttr(box, 'tabindex', isOverflowing ? '0' : null);
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

  render();

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
