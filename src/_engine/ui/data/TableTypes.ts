// The table's public types (p805 D5), out of `Table.ts` so it stays under 800 lines.
import type { CMPAttr, CMPHandle } from '../core/CMPTypes';
import type { BindingScheduler } from '../forms/binding/BindingScheduler';
import type { SelectionMode } from './Selection';
import type { VirtualRows } from './VirtualRows';

/** A cell's status (p800 D6): the status role's colour and a mark, never the colour alone. */
export type TableTone = 'info' | 'success' | 'warning' | 'danger';

/** A `createTable`'s sort: a column's key and its direction. */
export type TableSort = {
  /** The sorted column's key. */
  key: string;
  /** `ascending` (the smallest value, the first word, first) or `descending`. */
  direction: 'ascending' | 'descending';
};

/**
 * A column of a `createTable`: its key, its header, and how a row's cell shows.
 * @template T the rows' type
 */
export type TableColumn<T> = {
  /** Its key, unique among the columns (default `value`: the row's own key of this name). */
  key: string;
  /** Its header's text. */
  label: string;
  /** A row's value in this column (default `row[key]`). */
  value?: (row: T) => unknown;
  /** The value as text (default: a number or a string as it is, nothing for `null` /
   * `undefined`). Called again only when the row is read again. */
  format?: (value: unknown, row: T) => string;
  /** The text's alignment (default: `end` when the first value in the column is a number, else
   * `start`). */
  align?: 'start' | 'center' | 'end';
  /** Makes its cells the rows' headers (`<th scope="row">`): a name column. */
  rowHeader?: boolean;
  /** Its width (px as a number, or a CSS length). When every shown column has one, the table's
   * layout is fixed (faster to lay out). */
  width?: number | string;
  /** Its least width (px as a number, or a CSS length). */
  minWidth?: number | string;
  /** A cell's status: the role's colour and a mark before the text. The text says it too. */
  tone?: (row: T) => TableTone | null | undefined;
  /** Makes its header a button that sorts the rows by it: ascending, then descending (then the
   * rows' own order with the table's `sortUnset`). */
  sortable?: boolean;
  /** How two rows compare for its sort, ascending (negative: `a` first). Default: by value, a
   * number as a number, text by the browser's collation with its numbers as numbers, an empty
   * value (`null`, `undefined`, `NaN`) last in either direction. */
  compare?: (a: T, b: T) => number;
  /** A tooltip on its header saying what it holds ('In view / total'): on the sort button of a
   * sortable column, else on the header (its description). */
  headerTooltip?: string;
  /** A cell's content as a CMP in place of its text (two lines, a button), called again when the
   * row is another object (the old CMP removed). The value still sorts the column. */
  cell?: (row: T) => CMPHandle;
  /** `'bar'` draws a bar before the text, its length the value (a number, or an array of numbers:
   * a segment each) against the column's largest (`barMax`). The bar is decorative: the text
   * (`format`; an array's default its numbers joined by ' / ') says the figures. */
  kind?: 'text' | 'bar';
  /** A bar column's full length (default the column's largest total, the footer's included: a
   * total row in the footer makes every bar its share). */
  barMax?: number;
  /** Leaves the column out. */
  hidden?: boolean;
};

/**
 * A group of a `createTable`'s rows: a `<tbody>` after the ungrouped rows with a header row of its
 * label (the profiler's "App" metrics).
 * @template T the rows' type
 */
export type TableGroup<T> = {
  /** Its key, unique among the groups. */
  key: string;
  /** Its header row's text. */
  label: string;
  /** Its rows, in order. A group without rows isn't shown. */
  rows: readonly T[];
};

/**
 * What `createTable` makes a table from: its columns, its rows, and how the table looks.
 * @template T the rows' type
 */
export type TableProps<T> = {
  /** The columns, in order. */
  columns: TableColumn<T>[];
  /** The rows not in a group, in order, or a function returning them, read again on `refresh`. */
  rows?: readonly T[] | (() => readonly T[]);
  /** Groups after the rows, each with a header row, or a function returning them. */
  groups?: readonly TableGroup<T>[] | (() => readonly TableGroup<T>[]);
  /** Rows at the end in a `<tfoot>` (a total), or a function returning them. */
  footer?: readonly T[] | (() => readonly T[]);
  /** A row's key, unique in the whole table (default its `id`, as a string): a kept key keeps its
   * row, and a cell is written only when its text changed. */
  getKey?: (row: T) => string;
  /** The table's caption, which names it (and its scroll box while it scrolls). */
  caption: string;
  /** Hides the caption visually (a heading above says it): screen readers still read it. */
  captionHidden?: boolean;
  /** Keeps the header row, or the first column, in view as the table scrolls in its box (which
   * needs a height for the header: `--aek-table-max-height`). */
  sticky?: { header?: boolean; firstColumn?: boolean };
  /** Tints every other row (`--aek-table-stripe`). */
  striped?: boolean;
  /** What the pointer and the focus tint: the row, the column, the cell, or both the row and the
   * column (`--aek-table-highlight`). */
  highlight?: 'row' | 'column' | 'cell' | 'cross';
  /** Below this width (px) of the table's own box, each row is a card of "label: value" lines.
   * Not with `virtual` (its rows are one height). */
  stackBelow?: number;
  /** Renders only the ungrouped rows its box shows (`createVirtualRows()`): for a long table, past
   * about 200 rows. Every row is one height, its cells on one line, and the box needs one
   * (`--aek-table-max-height`); give every column a `width`, or the widths follow the rows shown.
   * The groups and the footer always render. */
  virtual?: VirtualRows;
  /** Reads `rows`, `groups` and `footer` (functions) on this scheduler: its `refresh()`, and its
   * tick every `interval` ms while the table shows. */
  scheduler?: BindingScheduler;
  /** Reads `rows`, `groups` and `footer` (functions) every this many ms while the table shows (0:
   * every frame), on `scheduler` or the page's. */
  interval?: number;
  /** What shows in place of the rows when there are none: a text, or a CMP (`createEmptyState`'s),
   * which the table removes with itself. */
  empty?: string | CMPHandle;
  /** The sort at the start (default none: the rows' own order). The rows, each group's and the
   * footer's apart, are sorted; the footer isn't. */
  sort?: TableSort | null;
  /** Lets a header's button go back to the rows' own order after descending. */
  sortUnset?: boolean;
  /** The app sorts: the table shows the sort and reports the user's changes (`onSortChange`),
   * keeping the rows in the order they're given (a sort on a server, a paged source). */
  manualSort?: boolean;
  /** The user's sorts (a header's button), `null` for the rows' own order: keeping it is the
   * app's. */
  onSortChange?: (sort: TableSort | null) => void;
  /** What the user can select (default 'none'): one row, or several (Ctrl / ⌘ and Shift). A
   * table with a selection or `onRowActivate` is an APG grid: one tab stop, the arrows over its
   * cells. The footer's rows aren't selected. */
  selection?: SelectionMode;
  /** The selected keys at the start. */
  selected?: readonly string[];
  /** The user's changes to the selection (and a selected key the rows lost), in the table's
   * order. */
  onSelectionChange?: (keys: string[]) => void;
  /** A row's activation: a click without Shift, Ctrl or ⌘, or Enter on a cell with no control
   * (the profiler's open a metric's graph). Makes the table a grid; the footer's rows aren't
   * activated. */
  onRowActivate?: (row: T, key: string) => void;
  /** Extra classes for the table's element. */
  class?: string | string[];
  /** Extra attributes for the table's element. */
  attr?: CMPAttr;
  /** The table's element id (default: a generated one, not written to the element). */
  id?: string;
};

/** A table `createTable` made: its CMP and its controls. */
export type Table<T> = {
  /** The table's element: its scroll box with the `<table>`. `cmp.remove()` removes the empty
   * state's CMP, the cells' CMPs, the tooltips and the observer with it. */
  cmp: CMPHandle;
  /** Replaces the ungrouped rows (an array, or a function read again on `refresh`): a kept key
   * keeps its row, a cell is written only when its text changed. */
  setRows: (rows: readonly T[] | (() => readonly T[])) => void;
  /** Replaces the groups, as `setRows`. */
  setGroups: (groups: readonly TableGroup<T>[] | (() => readonly TableGroup<T>[])) => void;
  /** Replaces the footer's rows, as `setRows`. */
  setFooter: (rows: readonly T[] | (() => readonly T[])) => void;
  /** Sets one cell's value (a live figure) until its row is read again, and writes its text node
   * when the text changed: nothing allocated of the table's own. The rows aren't sorted again
   * (the next read does), a bar column's bars are measured again. An unknown key or column does
   * nothing. */
  setCell: (key: string, column: string, value: unknown) => void;
  /** Sets the sort without calling `onSortChange`, sorting the rows unless `manualSort`; `null`
   * for the rows' own order. */
  setSort: (sort: TableSort | null) => void;
  /** The sort, or null. */
  getSort: () => TableSort | null;
  /** Sets the selected keys without calling `onSelectionChange`. */
  setSelected: (keys: readonly string[]) => void;
  /** The selected keys, in the table's order. */
  getSelected: () => string[];
  /** Scrolls the table's box (never the page) so a row shows. */
  scrollToKey: (key: string) => void;
  /** The key of the row holding an element, or null: what a `createContextMenu` on `cmp.elem`
   * finds its row by. */
  getKeyAt: (elem: Element) => string | null;
  /** Reads the rows, groups and footer again (each given as a function) and writes what changed. */
  refresh: () => void;
};
