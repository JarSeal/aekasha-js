// The table's grid mode (p805 D4, D5: a table with a selection or `onRowActivate`), out of
// `Table.ts` so it stays under 800 lines: one tab stop over the cells (a sortable header's
// button), the APG grid's keys, a click on a row, and the way into and out of a cell's control.
// What a key or a click does to a row (select, activate) is the table's.
import { getMoveTarget } from '../components/RovingFocus';
import { pushOverlay } from '../overlays/OverlayStack';
import { useCollectionKey } from './CollectionParts';
import { findCellControl, isInCellControl, type TableNavRow } from './TableRows';

/**
 * What the grid reads from the table and calls on it.
 * @internal
 */
export type TableGridProps = {
  table: HTMLElement;
  /** The grid's rows in order at the last render (their `index` set) */
  getRows: () => readonly TableNavRow[];
  /** The grid row of a `<tr>` */
  getRow: (elem: Element) => TableNavRow | undefined;
  /** A cell's focus target: the cell, or a sortable header's button */
  getTarget: (row: TableNavRow, column: number) => HTMLElement;
  /** Where the tab stop starts: the first selected row, else the first data row */
  getStartIndex: () => number;
  /** Renders a row that isn't (virtual rows: scrolls the box to it), before the focus goes there */
  reveal: (row: TableNavRow) => void;
  /** Renders the rows again, the tab stop's kept (a stop moved to a row not rendered) */
  place: () => void;
  /** PageUp's and PageDown's step from a row */
  getPageSize: (row: TableNavRow) => number;
  /** Space on a data row's cell */
  onSpace: (key: string, e: KeyboardEvent) => void;
  /** Enter on a data row's cell holding no control */
  onEnter: (key: string) => void;
  /** Shift + a move landing on a data row */
  onRange: (key: string) => void;
  /** Ctrl / ⌘ + A: whether it was used (a multiple selection) */
  onAll: () => boolean;
  /** A click on a data row, not in a cell's control */
  onClick: (key: string, e: MouseEvent) => void;
  /** Adds a listener on the `<table>`, removed with the table */
  listen: (type: string, fn: (e: Event) => void) => void;
};

/**
 * The grid's tab stop and keys: the arrows over the cells (Up / Down keeping the column a
 * one-cell row doesn't have), Home / End in the row, Ctrl / ⌘ + Home / End to the grid's corners,
 * PageUp / PageDown by the rows the box shows; Enter or F2 into a cell's control, Escape or F2
 * back to the cell (through an overlay stack entry while the focus is in one, so a dialog around
 * the table stays open).
 * @internal
 * @returns `settle(hadFocus)` after a render (the tab stop on a row that's still there, else the
 * one now at its place; the focus given back when its row went), `hasFocus`, `getStop` and
 * `dispose`
 */
export const createTableGrid = (props: TableGridProps) => {
  const { table } = props;
  let stopRow: TableNavRow | null = null;
  /** The stop's place, for when its row goes; -1 before the first */
  let stopIndex = -1;
  let stopColumn = 0;
  /** The column Up / Down keep (a one-cell row in between doesn't change it) */
  let wantedColumn = 0;
  let stopElem: HTMLElement | null = null;
  let removeEntry: ((returnFocus?: boolean) => void) | null = null;
  let entryCell: HTMLElement | null = null;

  const writeStop = () => {
    const rows = props.getRows();
    let row = stopRow && stopRow.index !== -1 ? stopRow : null;
    if (!row && rows.length) {
      row = rows[stopIndex === -1 ? props.getStartIndex() : Math.min(stopIndex, rows.length - 1)];
    }
    stopRow = row;
    stopIndex = row ? row.index : -1;
    // A row not rendered (virtual rows) is rendered as the stop's
    if (row && !row.elem) props.place();
    const next = row && row.elem ? props.getTarget(row, Math.min(stopColumn, row.size - 1)) : null;
    if (stopElem && stopElem !== next) stopElem.setAttribute('tabindex', '-1');
    next?.setAttribute('tabindex', '0');
    stopElem = next;
  };

  const focusAt = (row: TableNavRow, column: number) => {
    props.reveal(row);
    stopRow = row;
    stopIndex = row.index;
    stopColumn = column;
    writeStop();
    stopElem?.focus();
  };

  const locate = (target: EventTarget | null) => {
    const cell = (target as Element | null)?.closest?.('td, th') as HTMLElement | null;
    if (!cell || !table.contains(cell)) return null;
    const row = props.getRow(cell.parentNode as Element);
    if (!row || row.index === -1) return null;
    const column = row.cells.indexOf(cell);
    return column === -1 ? null : { row, column, cell };
  };

  /** An overlay stack entry while the focus is in a cell's control: Escape goes back to the cell */
  const syncEntry = (active: Element | null) => {
    const at = active ? locate(active) : null;
    const target = at ? props.getTarget(at.row, at.column) : null;
    const inside = at && target && active !== target && active !== at.cell ? at.cell : null;
    if (inside === entryCell) return;
    removeEntry?.(false);
    removeEntry = null;
    entryCell = inside;
    if (inside && target) removeEntry = pushOverlay({ elem: inside, close: () => target.focus() });
  };

  const onKeyDown = (e: Event) => {
    const ke = e as KeyboardEvent;
    const at = locate(ke.target);
    if (!at) return;
    const { row, column, cell } = at;
    const target = props.getTarget(row, column);
    const { key } = ke;
    if (ke.target !== target && ke.target !== cell) {
      // In a cell's control: its keys, but these (Escape outside a HUD root: the stack's entry
      // takes it first under one)
      if (key === 'Escape' || key === 'F2') {
        useCollectionKey(ke);
        target.focus();
      }
      return;
    }
    if (ke.altKey) return;
    const isMod = ke.ctrlKey || ke.metaKey;
    const rows = props.getRows();
    if (key === 'ArrowLeft' || key === 'ArrowRight') {
      if (isMod) return;
      useCollectionKey(ke);
      const next = column + (key === 'ArrowRight' ? 1 : -1);
      if (next < 0 || next >= row.size) return;
      wantedColumn = next;
      focusAt(row, next);
      return;
    }
    if (key === 'Home' || key === 'End') {
      useCollectionKey(ke);
      const toRow = isMod ? rows[key === 'Home' ? 0 : rows.length - 1] : row;
      wantedColumn = key === 'Home' ? 0 : toRow.size - 1;
      focusAt(toRow, wantedColumn);
      return;
    }
    if (!isMod) {
      const next = getMoveTarget(key, row.index, {
        count: rows.length,
        pageSize: key.startsWith('Page') ? props.getPageSize(row) : undefined,
      });
      if (next !== null) {
        useCollectionKey(ke);
        if (next === -1) return;
        const toRow = rows[next];
        focusAt(toRow, Math.min(wantedColumn, toRow.size - 1));
        if (ke.shiftKey && toRow.key !== null) props.onRange(toRow.key);
        return;
      }
    }
    // A sortable header's button: Enter and Space are its own click
    if (target !== cell && (key === 'Enter' || key === ' ')) return;
    if ((key === 'Enter' || key === 'F2') && !isMod && !ke.shiftKey) {
      const control = findCellControl(cell);
      if (control) {
        useCollectionKey(ke);
        control.focus();
      } else if (key === 'Enter' && row.key !== null) {
        useCollectionKey(ke);
        props.onEnter(row.key);
      }
      return;
    }
    if (key === ' ' && !isMod) {
      if (row.key === null) return;
      useCollectionKey(ke);
      props.onSpace(row.key, ke);
      return;
    }
    if (isMod && key.toLowerCase() === 'a' && props.onAll()) useCollectionKey(ke);
  };

  const onClick = (e: Event) => {
    const at = locate(e.target);
    if (!at || at.row.key === null || isInCellControl(e.target, at.cell)) return;
    props.onClick(at.row.key, e as MouseEvent);
  };

  /** A Shift press on a row selects a range, not the text between it and the last press: no
   * default (the browser's text selection), the cell focused by hand */
  const onMouseDown = (e: Event) => {
    const me = e as MouseEvent;
    if (!me.shiftKey || me.button !== 0) return;
    const at = locate(e.target);
    if (!at || at.row.key === null || isInCellControl(e.target, at.cell)) return;
    me.preventDefault();
    props.getTarget(at.row, at.column).focus();
  };

  const onFocusIn = (e: Event) => {
    const at = locate(e.target);
    if (at) {
      stopRow = at.row;
      stopIndex = at.row.index;
      stopColumn = at.column;
      // A one-cell row (a group's header, the empty row) keeps the column Up / Down come back to
      if (at.row.size > 1) wantedColumn = at.column;
      writeStop();
    }
    syncEntry(e.target as Element);
  };

  const onFocusOut = (e: Event) => {
    const next = (e as FocusEvent).relatedTarget as Element | null;
    if (!next || !table.contains(next)) syncEntry(null);
  };

  props.listen('keydown', onKeyDown);
  props.listen('click', onClick);
  props.listen('mousedown', onMouseDown);
  props.listen('focusin', onFocusIn);
  props.listen('focusout', onFocusOut);

  return {
    settle: (hadFocus: boolean) => {
      writeStop();
      if (hadFocus && !table.contains(document.activeElement)) stopElem?.focus();
    },
    hasFocus: () => table.contains(document.activeElement),
    /** The tab stop's row (the table keeps it rendered), or null */
    getStop: () => (stopRow && stopRow.index !== -1 ? stopRow : null),
    dispose: () => {
      removeEntry?.(false);
      removeEntry = null;
      entryCell = null;
    },
  };
};
