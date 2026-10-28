// The table's columns, rows and cells (p805 D5), out of `Table.ts` so it stays under 800 lines:
// a column's header with its sort button and tooltip, a row's record (its values, read for every
// row) and view (its elements, only a rendered row's: virtual rows bind a view to another record),
// a cell's text, CMP or bar written only where it changed, the bars' lengths, and the sort's
// comparison.
import type { CMPHandle } from '../core/CMPTypes';
import { createTooltip, type Tooltip } from '../overlays/Tooltip';
import { createElem, writeAttr } from './CollectionParts';
import type { TableColumn, TableSort } from './TableTypes';

/**
 * A row the grid's keys move over and `aria-rowindex` counts: the header row, a data row, a
 * group's header row or the empty row. A data row not rendered (virtual rows) has no element.
 * @internal
 */
export type TableNavRow = {
  elem: HTMLElement | null;
  /** Its cells in order while rendered, else none */
  cells: readonly HTMLElement[];
  /** Its cell count, rendered or not */
  size: number;
  /** A data row's key (the rows', a group's or the footer's), else null */
  key: string | null;
  /** Its place among the rows at the last render, -1 when it isn't there */
  index: number;
};

/**
 * A shown column: its definition, its `<col>`, its header (with a sortable one's button) and its
 * alignment once known.
 * @internal
 */
export type TableColumnState<T> = {
  def: TableColumn<T>;
  col: HTMLElement;
  header: HTMLElement;
  sortButton: HTMLButtonElement | null;
  tooltip: Tooltip | null;
  /** `start`, `center`, `end`, or null until a value says (a number: `end`) */
  align: 'start' | 'center' | 'end' | null;
  /** A bar column's full length at the last read (`barMax`, or its largest total) */
  barMax: number;
};

/** A bar cell's parts: the bar, its segments and their last written shares (a thousandth), the
 * text's box */
type TableBar = { bar: HTMLElement; parts: HTMLElement[]; shares: number[]; textBox: HTMLElement };

/**
 * A cell of a view and what it last showed: its text node (or its CMP, `cell`'s), tone,
 * alignment and bar.
 * @internal
 */
export type TableCell = {
  elem: HTMLElement;
  text: Text;
  written: string;
  /** The value last written by the default format (a column without `format`: the same value is
   * the same text, nothing to make) */
  value: unknown;
  tone: string | null;
  align: string | null;
  cmp: CMPHandle | null;
  /** The row `cmp` was made for */
  cmpRow: unknown;
  bar: TableBar | null;
};

/**
 * A row's elements: its `<tr>` and cells, the record they show (null in the pool) and the
 * record's read they were last written for.
 * @internal
 */
export type TableRowView<T> = {
  elem: HTMLElement;
  cells: TableCell[];
  cellElems: HTMLElement[];
  record: TableRowRecord<T> | null;
  writtenRead: number;
};

/**
 * A row's record: its key, its row, its values (one per shown column: the sort's and the bars',
 * written by `setCell` too), its place in what it was given (the sort's tie-break) and in the
 * ungrouped rows as shown, whether it's a footer row, and its view while rendered.
 * @internal
 */
export type TableRowRecord<T> = {
  key: string;
  row: T;
  values: unknown[];
  /** Counts the reads, so a view knows when it's behind */
  read: number;
  nav: TableNavRow;
  order: number;
  /** Its place among the ungrouped rows as shown, -1 in a group or the footer */
  bodyIndex: number;
  isFoot: boolean;
  view: TableRowView<T> | null;
};

/** What a cell's or header's setup needs from the table */
type TablePartsContext = {
  /** Writes a role when the table writes them (a stacked layout's, a grid's) */
  withRole: <E extends HTMLElement>(elem: E, role: string) => E;
  isGrid: boolean;
};

/** A cell's value before its first write */
const UNSET = Symbol('unset');

/** A control the grid's Enter and F2 go into; made unreachable by Tab in a grid (one tab stop) */
const CONTROL_SELECTOR =
  'button:not([disabled]), a[href], input:not([disabled]):not([type="hidden"]), ' +
  'select:not([disabled]), textarea:not([disabled]), [tabindex]';

/**
 * The first control inside a cell (not the cell itself), or null.
 * @internal
 */
export const findCellControl = (cell: HTMLElement) =>
  cell.querySelector<HTMLElement>(CONTROL_SELECTOR);

/**
 * Whether an event's target is in a control inside the cell (a click there is the control's, not
 * the row's).
 * @internal
 */
export const isInCellControl = (target: EventTarget | null, cell: HTMLElement) => {
  const control = (target as Element | null)?.closest?.(`${CONTROL_SELECTOR}, label`);
  return Boolean(control && control !== cell && cell.contains(control));
};

const readValue = <T>(column: TableColumn<T>, row: T) =>
  column.value ? column.value(row) : (row as Record<string, unknown>)[column.key];

const formatValue = <T>(column: TableColumn<T>, value: unknown, row: T) => {
  if (column.format) return column.format(value, row);
  if (value === null || value === undefined) return '';
  return Array.isArray(value) ? value.join(' / ') : String(value);
};

/** A px number as a length, a string as it is */
const toLength = (value: number | string) => (typeof value === 'number' ? `${value}px` : value);

/**
 * Makes a column's `<col>` and header: a sortable column's label in a button with its mark
 * (`aria-hidden`; its click is the table's), a tooltip on the button or the header.
 * @internal
 */
export const createTableColumn = <T>(
  def: TableColumn<T>,
  { withRole, isGrid }: TablePartsContext
): TableColumnState<T> => {
  const col = createElem('col', 'aekTable__col');
  col.setAttribute('data-key', def.key);
  if (def.width !== undefined) col.style.width = toLength(def.width);
  const header = withRole(createElem('th', 'aekTable__header'), 'columnheader');
  header.setAttribute('scope', 'col');
  header.setAttribute('data-key', def.key);
  if (def.minWidth !== undefined) header.style.minWidth = toLength(def.minWidth);
  let sortButton: HTMLButtonElement | null = null;
  if (def.sortable) {
    header.setAttribute('data-sortable', '');
    sortButton = createElem('button', 'aekTable__sort') as HTMLButtonElement;
    sortButton.type = 'button';
    const label = createElem('span', 'aekTable__headerLabel');
    label.textContent = def.label;
    const mark = createElem('span', 'aekTable__sortMark');
    mark.setAttribute('aria-hidden', 'true');
    sortButton.append(label, mark);
    header.append(sortButton);
  } else header.textContent = def.label;
  // In a grid the arrows reach the headers: one tab stop
  if (isGrid) (sortButton ?? header).setAttribute('tabindex', '-1');
  const tooltip = def.headerTooltip
    ? createTooltip({ anchor: sortButton ?? header, text: def.headerTooltip })
    : null;
  return { def, col, header, sortButton, tooltip, align: def.align ?? null, barMax: 0 };
};

/** Makes a cell for a column: a `<th scope="row">` for a row header, a stacked layout's label
 * (`aria-hidden`), a bar column's bar and text box, the text node */
const createTableCell = <T>(
  column: TableColumnState<T>,
  { withRole, isGrid }: TablePartsContext,
  hasLabel: boolean
): TableCell => {
  const isHeader = column.def.rowHeader;
  const elem = withRole(
    createElem(isHeader ? 'th' : 'td', 'aekTable__cell'),
    isHeader ? 'rowheader' : isGrid ? 'gridcell' : 'cell'
  );
  if (isHeader) elem.setAttribute('scope', 'row');
  if (isGrid) elem.setAttribute('tabindex', '-1');
  if (hasLabel) {
    const label = createElem('span', 'aekTable__cellLabel');
    label.setAttribute('aria-hidden', 'true');
    label.textContent = column.def.label;
    elem.append(label);
  }
  const text = document.createTextNode('');
  let bar: TableBar | null = null;
  if (column.def.kind === 'bar') {
    elem.setAttribute('data-kind', 'bar');
    const box = createElem('span', 'aekTable__barBox');
    const barElem = createElem('span', 'aekTable__bar');
    barElem.setAttribute('aria-hidden', 'true');
    const textBox = createElem('span', 'aekTable__barText');
    // Hidden until a text is written (an empty one is the text written already)
    textBox.setAttribute('hidden', '');
    textBox.append(text);
    box.append(barElem, textBox);
    elem.append(box);
    bar = { bar: barElem, parts: [], shares: [], textBox };
  } else elem.append(text);
  return {
    elem,
    text,
    written: '',
    value: UNSET,
    tone: null,
    align: null,
    cmp: null,
    cmpRow: null,
    bar,
  };
};

/**
 * Makes a row's view: its `<tr>` (`row` role when the table writes roles) and a cell per column.
 * @internal
 */
export const createTableView = <T>(
  columns: readonly TableColumnState<T>[],
  context: TablePartsContext,
  hasLabel: boolean
): TableRowView<T> => {
  const elem = context.withRole(createElem('tr', 'aekTable__row'), 'row');
  const cells = columns.map((column) => createTableCell(column, context, hasLabel));
  const cellElems = cells.map((cell) => cell.elem);
  elem.append(...cellElems);
  return { elem, cells, cellElems, record: null, writtenRead: -1 };
};

/**
 * Reads a row's value for each column into its record (the sort, the bars and the views read
 * them there).
 * @internal
 */
export const readTableRow = <T>(
  columns: readonly TableColumnState<T>[],
  record: TableRowRecord<T>
) => {
  for (let i = 0; i < columns.length; i++) record.values[i] = readValue(columns[i].def, record.row);
  record.read++;
};

/** Takes a CMP's controls out of the tab order (the grid's arrows and Enter reach them) */
const untabControls = (root: HTMLElement) => {
  const controls = root.querySelectorAll<HTMLElement>(CONTROL_SELECTOR);
  for (let i = 0; i < controls.length; i++) controls[i].setAttribute('tabindex', '-1');
  if (root.matches(CONTROL_SELECTOR)) root.setAttribute('tabindex', '-1');
};

/**
 * Writes one cell from a value: its text where it changed (one text node), or its CMP when the
 * row is another object; its tone and alignment; a bar's segments against the column's
 * `barMax`. Nothing allocated of its own when nothing changed.
 * @internal
 */
export const writeTableCell = <T>(
  column: TableColumnState<T>,
  cell: TableCell,
  value: unknown,
  row: T,
  isGrid: boolean
) => {
  const { def } = column;
  if (def.cell) {
    if (cell.cmpRow !== row || !cell.cmp) {
      cell.cmp?.remove();
      cell.cmp = def.cell(row);
      cell.cmpRow = row;
      cell.elem.append(cell.cmp.elem);
      if (isGrid) untabControls(cell.cmp.elem);
    }
  } else if (def.format || typeof value === 'object' || value !== cell.value) {
    // The default format's text depends on a primitive value alone: an unchanged one makes no
    // string (an array may have changed in place)
    cell.value = value;
    const text = formatValue(def, value, row);
    if (cell.written !== text) {
      cell.written = text;
      cell.text.data = text;
      if (cell.bar) writeAttr(cell.bar.textBox, 'hidden', text ? null : '');
    }
  }
  const tone = def.tone?.(row) ?? null;
  if (cell.tone !== tone) {
    cell.tone = tone;
    writeAttr(cell.elem, 'data-tone', tone);
  }
  const align = column.align === 'start' ? null : column.align;
  if (cell.align !== align) {
    cell.align = align;
    writeAttr(cell.elem, 'data-align', align);
  }
  if (cell.bar) writeBar(cell.bar, value, column.barMax);
};

/**
 * Writes a record's view: every cell from its values, when the view shows another record or is
 * behind its read.
 * @internal
 */
export const writeTableView = <T>(
  columns: readonly TableColumnState<T>[],
  view: TableRowView<T>,
  isGrid: boolean
) => {
  const record = view.record;
  if (!record || view.writtenRead === record.read) return;
  view.writtenRead = record.read;
  for (let i = 0; i < columns.length; i++) {
    writeTableCell(columns[i], view.cells[i], record.values[i], record.row, isGrid);
  }
};

/**
 * Removes a view's cells' CMPs (a row's removal, the table's, a view going to the pool).
 * @internal
 */
export const disposeTableView = <T>(view: TableRowView<T>) => {
  for (const cell of view.cells) {
    cell.cmp?.remove();
    cell.cmp = null;
    cell.cmpRow = null;
  }
};

/** A bar value's segments: a number one, an array each of its numbers; not finite or below 0
 * is 0 */
const readSegment = (value: unknown, index: number) => {
  const n = Array.isArray(value) ? value[index] : index === 0 ? value : 0;
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0;
};

const countSegments = (value: unknown) => (Array.isArray(value) ? value.length : 1);

const sumSegments = (value: unknown) => {
  let total = 0;
  for (let i = 0; i < countSegments(value); i++) total += readSegment(value, i);
  return total;
};

/** Writes a bar's segments: each its share of `max` to a thousandth, a width written only when
 * that changed; a segment the value lacks hidden */
const writeBar = (bar: TableBar, value: unknown, max: number) => {
  const count = countSegments(value);
  while (bar.parts.length < count) {
    const part = createElem('span', 'aekTable__barPart');
    part.setAttribute('data-part', String(bar.parts.length + 1));
    bar.bar.append(part);
    bar.parts.push(part);
    bar.shares.push(-1);
  }
  for (let p = 0; p < bar.parts.length; p++) {
    const isShown = p < count;
    const share =
      isShown && max > 0 ? Math.round(Math.min(1, readSegment(value, p) / max) * 1000) : 0;
    writeAttr(bar.parts[p], 'hidden', isShown ? null : '');
    if (bar.shares[p] === share) continue;
    bar.shares[p] = share;
    bar.parts[p].style.width = `${share / 10}%`;
  }
};

/**
 * Works out a bar column's full length from the records' values: its `barMax`, else the largest
 * total among them (the footer's included). Whether it changed (every bar then needs writing).
 * @internal
 */
export const measureTableBar = <T>(
  column: TableColumnState<T>,
  index: number,
  records: readonly TableRowRecord<T>[]
) => {
  let max = column.def.barMax ?? 0;
  if (column.def.barMax === undefined) {
    for (const record of records) max = Math.max(max, sumSegments(record.values[index]));
  }
  if (max === column.barMax) return false;
  column.barMax = max;
  return true;
};

/**
 * Writes one column's bars in the rendered views (after its full length changed).
 * @internal
 */
export const writeTableBars = <T>(
  column: TableColumnState<T>,
  index: number,
  records: readonly TableRowRecord<T>[]
) => {
  for (const record of records) {
    const cell = record.view?.cells[index];
    if (cell?.bar) writeBar(cell.bar, record.values[index], column.barMax);
  }
};

/**
 * The column highlight (`highlight: 'column' | 'cross'`): the `<col>` of the cell under the
 * pointer or holding the focus gets `data-highlight` (one attribute per change, not one per cell;
 * none for a group's header, which spans them all), taken off when the pointer or the focus
 * leaves the table.
 * @internal
 */
export const listenColumnHighlight = <T>(
  table: HTMLElement,
  columns: readonly TableColumnState<T>[],
  listen: (type: string, fn: (e: Event) => void) => void
) => {
  let highlighted: HTMLElement | null = null;
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
  listen('pointerover', (e) => setHighlighted(findCol(e.target)));
  listen('pointerleave', () => setHighlighted(null));
  listen('focusin', (e) => setHighlighted(findCol(e.target)));
  listen('focusout', (e) => {
    if (!table.contains((e as FocusEvent).relatedTarget as Node | null)) setHighlighted(null);
  });
};

/** The collation of text values, made on the first sort (none at load) */
let collator: Intl.Collator | null = null;

const isEmptyValue = (value: unknown) =>
  value === null ||
  value === undefined ||
  value === '' ||
  (typeof value === 'number' && Number.isNaN(value));

/**
 * Compares two values that aren't empty, ascending: numbers as numbers, booleans false first, a
 * bar's array by its total, text by the browser's collation with its numbers as numbers.
 * @internal
 */
export const compareTableValues = (a: unknown, b: unknown) => {
  if (Array.isArray(a) && Array.isArray(b)) return sumSegments(a) - sumSegments(b);
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b);
  collator ??= new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  return collator.compare(String(a), String(b));
};

/**
 * The comparison a sort puts records in order by: the column's `compare` (negated descending) or
 * the records' values with the empty ones last either way, a tie in the order the rows were given
 * (a stable sort).
 * @internal
 */
export const createTableSorter = <T>(
  column: TableColumnState<T>,
  index: number,
  direction: TableSort['direction']
) => {
  const sign = direction === 'descending' ? -1 : 1;
  const { compare } = column.def;
  return (a: TableRowRecord<T>, b: TableRowRecord<T>) => {
    let result: number;
    if (compare) result = sign * compare(a.row, b.row);
    else {
      const va = a.values[index];
      const vb = b.values[index];
      const isEmptyA = isEmptyValue(va);
      const isEmptyB = isEmptyValue(vb);
      result =
        isEmptyA || isEmptyB
          ? Number(isEmptyA) - Number(isEmptyB)
          : sign * compareTableValues(va, vb);
    }
    return result || a.order - b.order;
  };
};
