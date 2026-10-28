// The table's columns, rows and cells (p805 D5), out of `Table.ts` so it stays under 800 lines:
// a column's header with its sort button and tooltip, a cell's text, CMP or bar written only where
// it changed, the bars' lengths, and the sort's comparison.
import type { CMPHandle } from '../core/CMPTypes';
import { createTooltip, type Tooltip } from '../overlays/Tooltip';
import { createElem, writeAttr } from './CollectionParts';
import type { TableColumn, TableSort } from './TableTypes';

/**
 * A row the grid's keys move over: the header row, a data row, a group's header row or the empty
 * row, its cells in order.
 * @internal
 */
export type TableNavRow = {
  elem: HTMLElement;
  cells: HTMLElement[];
  /** A data row's key (the rows', a group's or the footer's), else null */
  key: string | null;
  /** Its place among the grid's rows at the last render, -1 when it isn't there */
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
};

/** A bar cell's parts: the bar, its segments and their last written lengths, the text's box */
type TableBar = { bar: HTMLElement; parts: HTMLElement[]; widths: string[]; textBox: HTMLElement };

/**
 * A cell and what it last showed: its text node (or its CMP, `cell`'s), its value (the sort's and
 * the bars'), tone and alignment.
 * @internal
 */
export type TableCell = {
  elem: HTMLElement;
  text: Text;
  written: string;
  value: unknown;
  tone: string | null;
  align: string | null;
  cmp: CMPHandle | null;
  /** The row `cmp` was made for */
  cmpRow: unknown;
  bar: TableBar | null;
};

/**
 * A row's record: its key, its row, its element and cells, its place in what it was given (the
 * sort's tie-break) and whether it's a footer row.
 * @internal
 */
export type TableRowRecord<T> = {
  key: string;
  row: T;
  elem: HTMLElement;
  cells: TableCell[];
  nav: TableNavRow;
  order: number;
  isFoot: boolean;
};

/** What a cell's or header's setup needs from the table */
type TablePartsContext = {
  /** Writes a role when the table writes them (a stacked layout's, a grid's) */
  withRole: <E extends HTMLElement>(elem: E, role: string) => E;
  isGrid: boolean;
};

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
  return { def, col, header, sortButton, tooltip, align: def.align ?? null };
};

/** A px number as a length, a string as it is */
const toLength = (value: number | string) => (typeof value === 'number' ? `${value}px` : value);

/**
 * Makes a cell for a column: a `<th scope="row">` for a row header, a stacked layout's label
 * (`aria-hidden`), a bar column's bar and text box, the text node.
 * @internal
 */
export const createTableCell = <T>(
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
    bar = { bar: barElem, parts: [], widths: [], textBox };
  } else elem.append(text);
  return {
    elem,
    text,
    written: '',
    value: undefined,
    tone: null,
    align: null,
    cmp: null,
    cmpRow: null,
    bar,
  };
};

/** Takes a CMP's controls out of the tab order (the grid's arrows and Enter reach them) */
const untabControls = (root: HTMLElement) => {
  const controls = root.querySelectorAll<HTMLElement>(CONTROL_SELECTOR);
  for (let i = 0; i < controls.length; i++) controls[i].setAttribute('tabindex', '-1');
  if (root.matches(CONTROL_SELECTOR)) root.setAttribute('tabindex', '-1');
};

/**
 * Reads a row's value for each column and writes its cells where their text (or CMP), tone or
 * alignment changed. A bar's lengths are `writeTableBars`', after every row is read.
 * @internal
 */
export const writeTableRow = <T>(
  columns: readonly TableColumnState<T>[],
  record: TableRowRecord<T>,
  isGrid: boolean
) => {
  const { row, cells } = record;
  for (let i = 0; i < columns.length; i++) {
    const column = columns[i];
    const cell = cells[i];
    const value = readValue(column.def, row);
    cell.value = value;
    if (column.def.cell) {
      if (cell.cmpRow !== row || !cell.cmp) {
        cell.cmp?.remove();
        cell.cmp = column.def.cell(row);
        cell.cmpRow = row;
        cell.elem.append(cell.cmp.elem);
        if (isGrid) untabControls(cell.cmp.elem);
      }
    } else {
      const text = formatValue(column.def, value, row);
      if (cell.written !== text) {
        cell.written = text;
        cell.text.data = text;
        if (cell.bar) writeAttr(cell.bar.textBox, 'hidden', text ? null : '');
      }
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

/**
 * Removes a cell's CMP (a row's removal, the table's).
 * @internal
 */
export const disposeTableRow = <T>(record: TableRowRecord<T>) => {
  for (const cell of record.cells) {
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

/**
 * Writes the bar columns' lengths: each segment's share of the column's `barMax` (default the
 * largest total among `records`), a width written only when its text (to a tenth of a percent)
 * changed; a segment the value lacks is hidden.
 * @internal
 */
export const writeTableBars = <T>(
  columns: readonly TableColumnState<T>[],
  records: readonly TableRowRecord<T>[]
) => {
  for (let i = 0; i < columns.length; i++) {
    const { def } = columns[i];
    if (def.kind !== 'bar') continue;
    let max = def.barMax ?? 0;
    if (def.barMax === undefined) {
      for (const record of records) max = Math.max(max, sumSegments(record.cells[i].value));
    }
    for (const record of records) {
      const cell = record.cells[i];
      const bar = cell.bar as TableBar;
      const count = countSegments(cell.value);
      while (bar.parts.length < count) {
        const part = createElem('span', 'aekTable__barPart');
        part.setAttribute('data-part', String(bar.parts.length + 1));
        bar.bar.append(part);
        bar.parts.push(part);
        bar.widths.push('');
      }
      for (let p = 0; p < bar.parts.length; p++) {
        const share = p < count && max > 0 ? Math.min(1, readSegment(cell.value, p) / max) : 0;
        const width = `${(share * 100).toFixed(1)}%`;
        writeAttr(bar.parts[p], 'hidden', p < count ? null : '');
        if (bar.widths[p] === width) continue;
        bar.widths[p] = width;
        bar.parts[p].style.width = width;
      }
    }
  }
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
 * the cells' values with the empty ones last either way, a tie in the order the rows were given
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
      const va = a.cells[index].value;
      const vb = b.cells[index].value;
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
