// The table's public types (p805 D5), out of `Table.ts` so it stays under 800 lines.
import type { CMPAttr, CMPHandle } from '../core/CMPTypes';

/** A cell's status (p800 D6): the status role's colour and a mark, never the colour alone. */
export type TableTone = 'info' | 'success' | 'warning' | 'danger';

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
  /** Below this width (px) of the table's own box, each row is a card of "label: value" lines. */
  stackBelow?: number;
  /** What shows in place of the rows when there are none: a text, or a CMP (`createEmptyState`'s),
   * which the table removes with itself. */
  empty?: string | CMPHandle;
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
   * state's CMP and the observer with it. */
  cmp: CMPHandle;
  /** Replaces the ungrouped rows (an array, or a function read again on `refresh`): a kept key
   * keeps its row, a cell is written only when its text changed. */
  setRows: (rows: readonly T[] | (() => readonly T[])) => void;
  /** Replaces the groups, as `setRows`. */
  setGroups: (groups: readonly TableGroup<T>[] | (() => readonly TableGroup<T>[])) => void;
  /** Replaces the footer's rows, as `setRows`. */
  setFooter: (rows: readonly T[] | (() => readonly T[])) => void;
  /** Scrolls the table's box (never the page) so a row shows. */
  scrollToKey: (key: string) => void;
  /** The key of the row holding an element (a context menu's), or null. */
  getKeyAt: (elem: Element) => string | null;
  /** Reads the rows, groups and footer again (each given as a function) and writes what changed. */
  refresh: () => void;
};
