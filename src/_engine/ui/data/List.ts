import type { CMPAttr, CMPHandle } from '../core/CMPTypes';
import { CMP, classes } from '../core/CMP';
import { announce } from '../components/Announcer';
import type { BadgeValue } from '../components/Badge';
import { createTypeahead, getMoveTarget, isTypeaheadKey } from '../components/RovingFocus';
import {
  addScheduledRefresh,
  getPageScheduler,
  type BindingScheduler,
} from '../forms/binding/BindingScheduler';
import { pushOverlay, swallowNextKeyUp } from '../overlays/OverlayStack';
import { getQueryWords, matchesWords } from './Filter';
import {
  createElem,
  createListRows,
  ROW_CLASS,
  writeAttr,
  type ListMarks,
  type ListRow,
} from './ListRow';
import {
  createSelection,
  getSelectionGesture,
  type SelectionGesture,
  type SelectionMode,
} from './Selection';
import './List.scss';
import '../styles/kit.scss';

/**
 * A button on every row of a {@link createList} (the list is a grid then: one row per item, the
 * row's content and its actions its cells), such as a visibility toggle.
 * @template T the items' type
 */
export type ListAction<T> = {
  /** Its key, unique among the actions */
  key: string;
  /** Its accessible name and tooltip ('Show'), or a function of the item. */
  label: string | ((item: T) => string);
  /** Raw HTML of its icon (`getSvgIcon('eye')`). */
  icon: string;
  /** Raw HTML of its icon while `pressed` says false (`getSvgIcon('eyeOff')`); default `icon`. */
  iconOff?: string;
  /** Makes it a toggle (`aria-pressed`) with this state for the item, read again after a press. */
  pressed?: (item: T) => boolean;
  /** Disables it on the item's row (a disabled row's actions are disabled too). */
  disabled?: (item: T) => boolean;
  /** Leaves its cell empty on the item's row, keeping the other actions aligned. */
  hidden?: (item: T) => boolean;
  /** Its press (a click, Enter or Space on it). The row is read again after it, so an action that
   * changes the item in place shows the change. */
  onPress: (item: T, key: string) => void;
};

/**
 * The filter of a {@link createList}: a query that shows only the rows matching it, the matches
 * marked.
 * @template T the items' type
 */
export type ListFilter<T> = {
  /** The query at the start (default none). */
  query?: string;
  /** Whether an item matches a query that isn't empty. Default: every word of the query is in
   * the row's text (its title, sub title, description, suffix and badge), case and accents
   * ignored. */
  match?: (item: T, query: string) => boolean;
  /** Puts a search field above the list (default false): ArrowDown goes from it into the list,
   * Escape empties it. Without it the app sets the query with `setQuery`. */
  field?: boolean;
  /** The search field's accessible name (default 'Filter'). */
  fieldLabel?: string;
  /** The search field's placeholder (default 'Filter'). */
  placeholder?: string;
  /** The user's queries (the search field, the "Clear the filter" button): keeping it is the
   * app's. */
  onQueryChange?: (query: string) => void;
};

/**
 * What {@link createList} makes a list from: its items, how each row shows one, and how the rows
 * are used.
 * @template T the items' type
 */
export type ListProps<T> = {
  /** The items, in order, or a function returning them, read again on `refresh` and on the
   * scheduler's tick (`interval`). */
  items: readonly T[] | (() => readonly T[]);
  /** An item's key, unique in the list (default its `id`, as a string): a kept key keeps its row
   * (its focus, selection and scroll) when the items change. */
  getKey?: (item: T) => string;
  /** A row's title (default its key). With `render`, still its text for the typeahead and the
   * filter. */
  title?: (item: T) => string;
  /** A small line above the title (`'[app 2] [entity 14]'`). */
  subTitle?: (item: T) => string | null | undefined;
  /** A dimmed line under the title. */
  description?: (item: T) => string | null | undefined;
  /** Short text at the row's end (a count), in tabular figures. */
  suffix?: (item: T) => string | null | undefined;
  /** Raw HTML of an icon before the title (`getSvgIcon('lightbulb')`). */
  icon?: (item: T) => string | null | undefined;
  /** A badge before the title (a type's shorthand, a count). */
  badge?: (item: T) => BadgeValue | null | undefined;
  /** The row's tooltip. */
  tooltip?: (item: T) => string | null | undefined;
  /** Whether the title is a stand-in (an unnamed object's): italic and muted. */
  isPlaceholder?: (item: T) => boolean;
  /** Disables a row: dimmed, not selected or activated, its actions disabled. */
  disabled?: (item: T) => boolean;
  /** A row's content as a CMP in place of the parts above, called again when the item changes
   * (another object for its key), the old one removed. */
  render?: (item: T) => CMPHandle;
  /** A heading above the list with its count ("12 of 340" while filtered), which names it. */
  heading?: string;
  /** The heading's level (`h2` to `h6`); a paragraph by default. */
  headingLevel?: 2 | 3 | 4 | 5 | 6;
  /** The list's accessible name without a heading. A selectable list or one with actions needs
   * one of the two. */
  label?: string;
  /** What the user can select (default 'none'): one row, or several (Ctrl / ⌘ and Shift). */
  selection?: SelectionMode;
  /** The selected keys at the start. */
  selected?: readonly string[];
  /** The user's changes to the selection (and a selected key the items lost), in the list's
   * order. */
  onSelectionChange?: (keys: string[]) => void;
  /** The buttons on every row (a visibility toggle): the list is an APG grid then. */
  actions?: ListAction<T>[];
  /** A row's activation: a click without Shift, Ctrl or ⌘, or Enter (the debugger's open the
   * entity's window). A list with it and no selection is still a listbox. */
  onActivate?: (item: T, key: string) => void;
  /** Filters the rows by a query, marking the matches. */
  filter?: ListFilter<T>;
  /** What shows in place of the rows when there are none: a text, or a CMP (`createEmptyState`'s),
   * which the list removes with itself. */
  empty?: string | CMPHandle;
  /** Reads `items` (a function) on this scheduler: its `refresh()`, and its tick every
   * `interval` ms while the list shows. */
  scheduler?: BindingScheduler;
  /** Reads `items` (a function) every this many ms while the list shows (0: every frame), on
   * `scheduler` or the page's. */
  interval?: number;
  /** Extra classes for the list's element. */
  class?: string | string[];
  /** Extra attributes for the list's element. */
  attr?: CMPAttr;
  /** The list's element id (default: a generated one, not written to the element). */
  id?: string;
};

/** A list {@link createList} made: its CMP and its controls. */
export type List<T> = {
  /** The list's element: its heading, search field, rows and empty state. `cmp.remove()` removes
   * the rows' tooltips and rendered CMPs with it. */
  cmp: CMPHandle;
  /** Replaces the items (an array, or a function read again on `refresh`): a kept key keeps its
   * row, a part is written only when its text changed. */
  setItems: (items: readonly T[] | (() => readonly T[])) => void;
  /** Replaces one item by its key and writes its row's changed parts: a live figure, with no
   * allocation of the list's own. An unknown key does nothing. */
  setItem: (key: string, item: T) => void;
  /** Sets the selected keys without calling `onSelectionChange`. */
  setSelected: (keys: readonly string[]) => void;
  /** The selected keys, in the list's order */
  getSelected: () => string[];
  /** Sets the filter's query (and the search field's text) without calling `onQueryChange`. */
  setQuery: (query: string) => void;
  /** The filter's query */
  getQuery: () => string;
  /** Focuses a row by its key (a shown one) and makes it the list's tab stop. */
  focusKey: (key: string) => void;
  /** Scrolls the list's box (never the page) so a row shows. */
  scrollToKey: (key: string) => void;
  /** The key of the row holding an element (a context menu's), or null: what a
   * `createContextMenu` on `cmp.elem` finds its row by. */
  getKeyAt: (elem: Element) => string | null;
  /** Reads `items` again (a function's) and writes what changed. */
  refresh: () => void;
};

/** The page size of PageUp and PageDown when the list doesn't scroll */
const DEFAULT_PAGE_SIZE = 10;

const defaultGetKey = (item: unknown) => String((item as { id?: unknown }).id);

/**
 * Creates a list (p805 D6): rows of an app's items, each a title with an optional icon, badge,
 * sub title, description, suffix and tooltip (or a CMP of `render`), kept by key, so new items
 * write only what changed. Static (a `<ul>`), selectable (the APG listbox), or with `actions` on
 * every row (the APG grid); filtered by a query with the matches marked.
 * - Parts: `.aekList`, `.aekList__header` with `__heading` (`__headingText`, `__count`), `__filter`
 *   with `__search`, `.aekList__rows` (`data-mode="static" | "listbox" | "grid"`), a `.aekList__row`
 *   per item (`data-key`, `aria-selected`, `aria-disabled`, `hidden` while filtered out) with
 *   `__main` (a grid row's first cell) and `__content`: `__icon`, `__badge`, `__text` (`__subTitle`,
 *   `__title` with `data-placeholder`, `__description`), `__suffix`; a grid row's `__actionCell`s
 *   with an `__action` button each (`aria-pressed`); `.aekList__empty` and `.aekList__noMatch`
 *   (with `__clear`). The matches are `<mark class="aekMark">`s.
 * - Custom properties (read on any ancestor, the token as the fallback): `--aek-list-max-height`
 *   (the rows' box scrolls past it; default none), `--aek-list-selected-color` (the selected
 *   row's bar, default the accent).
 * - Keys (a listbox, a grid): the list is one tab stop. Up / Down move between the shown rows (no
 *   wrapping), Home / End to the ends, PageUp / PageDown by the box's height, a letter to the next
 *   title starting with it; Space selects (toggles in a multiple selection), Enter activates (and
 *   selects in a single one); with a multiple selection Shift + a move or a click selects the range
 *   from the last picked row, Ctrl / ⌘ + click toggles and Ctrl / ⌘ + A selects every row (or
 *   none). In a grid, Left / Right move between a row's cells, Up / Down keep the column, and Enter
 *   or Space presses an action. The search field's ArrowDown enters the list, its Escape empties
 *   it. The keys it uses reach no key binding.
 * - ARIA: `role="listbox"` (`aria-multiselectable`) of `option`s, or `role="grid"` of `row`s and
 *   `gridcell`s, named by the heading or `label`; `aria-selected`, `aria-disabled`; a toggle's
 *   `aria-pressed`. A filter's count ("12 of 340", "No matches for …") is announced politely.
 *
 * A context menu over the rows is the app's: `createContextMenu({ target: list.cmp.elem, … })`,
 * its items found by `getKeyAt` (as below), so a list without one carries none of its code.
 * @template T the items' type
 * @example
 * ```ts
 * type Light = { id: string; name: string; kind: string; visible: boolean };
 *
 * const lightList = createList<Light>({
 *   heading: 'Lights',
 *   items: () => getSceneLights(),
 *   title: (light) => light.name,
 *   badge: (light) => light.kind,
 *   selection: 'single',
 *   onActivate: (light) => openLightWindow(light.id),
 *   actions: [
 *     {
 *       key: 'visible',
 *       label: 'Visible',
 *       icon: getSvgIcon('eye'),
 *       iconOff: getSvgIcon('eyeClosed'),
 *       pressed: (light) => light.visible,
 *       onPress: (light) => setLightVisible(light.id, !light.visible),
 *     },
 *   ],
 *   filter: { field: true },
 *   empty: 'No lights in this scene',
 *   scheduler,
 *   interval: 500,
 * });
 * lightsPanel.add(lightList.cmp);
 *
 * createContextMenu({
 *   target: lightList.cmp.elem,
 *   items: (elem) => {
 *     const key = lightList.getKeyAt(elem);
 *     return key ? [{ label: 'Focus', onSelect: () => focusLight(key) }] : [];
 *   },
 * });
 * ```
 */
export const createList = <T>(props: ListProps<T>): List<T> => {
  const { actions = [], filter } = props;
  const getKey = props.getKey ?? defaultGetKey;
  const selectionMode = props.selection ?? 'none';
  const mode =
    actions.length > 0
      ? 'grid'
      : selectionMode !== 'none' || props.onActivate
        ? 'listbox'
        : 'static';
  const isInteractive = mode !== 'static';
  let source = props.items;
  let rows: ListRow<T>[] = [];
  const byKey = new Map<string, ListRow<T>>();
  let query = filter?.query ?? '';
  let queryWords = getQueryWords(query);
  let shownCount = 0;
  /** The element with `tabindex="0"`: a row's main element or an action's button */
  let stop: HTMLElement | null = null;
  let removeScheduled: (() => void) | null = null;

  const selection = createSelection({
    mode: selectionMode,
    getOrder: () => rows.filter((row) => row.isShown && !row.written.isDisabled).map((r) => r.key),
  });
  const typeahead = createTypeahead({
    getCount: () => rows.length,
    getText: (index) => (rows[index].isShown ? rows[index].foldedTitle : ''),
  });

  const marks: ListMarks = { query, words: queryWords };
  const { createRow, writeRow, disposeRow } = createListRows({ props, mode, marks });

  // --- The list's state: filter, selection, tab stop, count ---

  const isMatch = (row: ListRow<T>) => {
    if (!queryWords.length) return true;
    if (filter?.match) return filter.match(row.item, query);
    return matchesWords(row.folded, queryWords);
  };

  const writeSelected = (row: ListRow<T>) => {
    const isSelected = selection.has(row.key);
    if (row.isSelected === isSelected) return;
    row.isSelected = isSelected;
    row.elem.setAttribute('aria-selected', String(isSelected));
  };

  /** The focusable elements of a row: its main element, then its shown actions' buttons */
  const getCells = (row: ListRow<T>) => {
    const cells: HTMLElement[] = [row.main];
    for (const cell of row.actions) if (!cell.isHidden) cells.push(cell.button);
    return cells;
  };

  const setStop = (elem: HTMLElement | null) => {
    if (elem === stop) return;
    stop?.setAttribute('tabindex', '-1');
    elem?.setAttribute('tabindex', '0');
    stop = elem;
  };

  const findRow = (target: EventTarget | null) => {
    const elem = (target as Element | null)?.closest?.(`.${ROW_CLASS}`);
    if (!elem || elem.parentNode !== rowsCmp.elem) return null;
    return byKey.get(elem.getAttribute('data-key') ?? '') ?? null;
  };

  /** Puts the tab stop on a shown row when it's on none: the shown row nearest `near` (where a
   * focused row was), else the first selected one, else the first */
  const ensureStop = (near: number | null = null) => {
    if (!isInteractive) return;
    const stopRow = stop ? findRow(stop) : null;
    if (stopRow?.isShown && stop?.isConnected && !stop.hasAttribute('hidden')) return;
    let next: ListRow<T> | null = null;
    if (near !== null) {
      for (let d = 0; d < rows.length && !next; d++) {
        const after = rows[near + d];
        const before = rows[near - d];
        next = after?.isShown ? after : before?.isShown ? before : null;
      }
    }
    next ??= rows.find((row) => row.isShown && row.isSelected) ?? null;
    next ??= rows.find((row) => row.isShown) ?? null;
    setStop(next ? next.main : null);
  };

  const writeCount = () => {
    if (!countElem) return;
    const total = rows.length;
    countElem.textContent = queryWords.length ? `${shownCount} of ${total}` : String(total);
  };

  /** Shows the rows, the empty state or the no match line, by the counts */
  const writeEmpty = () => {
    const total = rows.length;
    writeAttr(rowsCmp.elem, 'hidden', shownCount ? null : '');
    writeAttr(emptyElem, 'hidden', total ? '' : null);
    writeAttr(noMatchElem, 'hidden', total && !shownCount ? null : '');
    if (!total || shownCount) return;
    const text = `No matches for “${query}”`;
    if (noMatchText.textContent !== text) noMatchText.textContent = text;
  };

  /** Shows or hides each row by the query (and rewrites its marks when the query changed) */
  const applyFilter = () => {
    shownCount = 0;
    for (const row of rows) {
      if (!props.render && row.written.query !== query) writeRow(row, false);
      const isShown = isMatch(row);
      if (row.isShown !== isShown) {
        row.isShown = isShown;
        writeAttr(row.elem, 'hidden', isShown ? null : '');
      }
      if (isShown) shownCount++;
    }
    writeCount();
    writeEmpty();
  };

  /** Drops the selected keys the rows lost, reporting it */
  const retainSelection = (report: boolean) => {
    const changed = selection.retain((key) => byKey.has(key));
    for (const row of rows) writeSelected(row);
    if (changed && report) props.onSelectionChange?.(selection.get());
  };

  /** The focused element in the rows, and its row's index, before a change that may remove or hide
   * it: the focus goes to the tab stop after it, if it went */
  const captureFocus = () => {
    const active = document.activeElement as HTMLElement | null;
    if (!active || !rowsCmp.elem.contains(active)) return null;
    return { active, index: findRow(active)?.index ?? 0 };
  };

  const restoreFocus = (focus: { active: HTMLElement; index: number } | null) => {
    ensureStop(focus ? Math.min(focus.index, rows.length - 1) : null);
    if (!focus) return;
    const { active } = focus;
    const row = findRow(active);
    if (active.isConnected && row?.isShown && !active.hasAttribute('hidden')) {
      if (document.activeElement !== active) active.focus();
    } else stop?.focus();
  };

  /** Puts the rows' elements in `next`'s order, moving only those out of place */
  const placeRows = (next: ListRow<T>[]) => {
    const parent = rowsCmp.elem;
    let cursor = parent.firstElementChild;
    for (let i = 0; i < next.length; i++) {
      const row = next[i];
      row.index = i;
      if (row.elem === cursor) cursor = cursor.nextElementSibling;
      else parent.insertBefore(row.elem, cursor);
    }
  };

  const setRowsFrom = (items: readonly T[], report: boolean) => {
    const focus = captureFocus();
    const next: ListRow<T>[] = [];
    const seen = new Set<string>();
    for (const item of items) {
      const key = getKey(item);
      if (seen.has(key)) continue;
      seen.add(key);
      let row = byKey.get(key);
      if (row) {
        const isNewItem = row.item !== item;
        row.item = item;
        writeRow(row, isNewItem);
      } else {
        row = createRow(key, item);
        byKey.set(key, row);
      }
      next.push(row);
    }
    for (const row of rows) {
      if (seen.has(row.key)) continue;
      byKey.delete(row.key);
      disposeRow(row);
    }
    rows = next;
    placeRows(rows);
    applyFilter();
    retainSelection(report);
    restoreFocus(focus);
  };

  const readItems = () => (typeof source === 'function' ? source() : source);

  // --- The user's input ---

  /** Uses a key up: no default, no further listener, its keyup swallowed */
  const useKey = (e: KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();
    swallowNextKeyUp(e.key);
  };

  const reportSelection = () => {
    for (const row of rows) writeSelected(row);
    props.onSelectionChange?.(selection.get());
  };

  const pick = (row: ListRow<T>, gesture: SelectionGesture) => {
    if (row.written.isDisabled || selectionMode === 'none') return;
    if (selection.pick(row.key, gesture)) reportSelection();
  };

  const activate = (row: ListRow<T>) => {
    if (row.written.isDisabled) return;
    if (selectionMode === 'single') pick(row, 'replace');
    props.onActivate?.(row.item, row.key);
  };

  /** Focuses a row's cell (`column` 0 its main element; a hidden action's falls back to it) */
  const focusRow = (row: ListRow<T>, column = 0) => {
    const cell = column > 0 ? row.actions[column - 1] : null;
    const elem = cell && !cell.isHidden ? cell.button : row.main;
    setStop(elem);
    elem.focus();
  };

  /** The page size: the rows that fit the box when it scrolls */
  const getPageSize = (row: ListRow<T>) => {
    const box = rowsCmp.elem;
    const height = row.elem.offsetHeight;
    if (!height || !(box.scrollHeight > box.clientHeight)) return DEFAULT_PAGE_SIZE;
    return Math.max(1, Math.floor(box.clientHeight / height));
  };

  const onKeyDown = (e: Event) => {
    const ke = e as KeyboardEvent;
    const row = findRow(e.target);
    if (!row) return;
    const target = e.target as HTMLElement;
    const actionIndex = row.actions.findIndex((cell) => cell.button === target);
    const column = actionIndex + 1;
    const { key } = ke;
    const isMod = ke.ctrlKey || ke.metaKey;

    if (isMod && !ke.altKey && key.toLowerCase() === 'a' && selectionMode === 'multiple') {
      useKey(ke);
      if (selection.all()) reportSelection();
      return;
    }
    if (mode === 'grid' && (key === 'ArrowLeft' || key === 'ArrowRight') && !isMod) {
      useKey(ke);
      const cells = getCells(row);
      const at = cells.indexOf(target);
      const next = cells[at + (key === 'ArrowRight' ? 1 : -1)];
      if (next) {
        setStop(next);
        next.focus();
      }
      return;
    }
    if (!ke.altKey && !isMod) {
      const next = getMoveTarget(key, row.index, {
        count: rows.length,
        pageSize: key.startsWith('Page') ? getPageSize(row) : undefined,
        isSkipped: (index) => !rows[index].isShown,
      });
      if (next !== null) {
        useKey(ke);
        if (next === -1) return;
        const to = rows[next];
        focusRow(to, column);
        if (ke.shiftKey && selectionMode === 'multiple') pick(to, 'range');
        return;
      }
    }
    if (actionIndex !== -1) return;
    if (key === ' ' && !isMod) {
      useKey(ke);
      pick(row, getSelectionGesture(ke, selectionMode === 'multiple'));
      return;
    }
    if (key === 'Enter' && !isMod && !ke.shiftKey) {
      useKey(ke);
      activate(row);
      return;
    }
    if (isTypeaheadKey(ke) && key !== ' ') {
      useKey(ke);
      const index = typeahead.type(key, row.index);
      if (index !== -1) focusRow(rows[index]);
    }
  };

  const onClick = (e: Event) => {
    const row = findRow(e.target);
    if (!row) return;
    const button = (e.target as Element).closest('.aekList__action');
    if (button) {
      const index = Number(button.getAttribute('data-action'));
      const cell = row.actions[index];
      if (!cell || cell.isDisabled) return;
      actions[index].onPress(row.item, row.key);
      // Its row read again: an action that changed the item in place shows it
      const live = byKey.get(row.key);
      if (live) writeRow(live, false);
      return;
    }
    if (row.written.isDisabled) return;
    const me = e as MouseEvent;
    pick(row, getSelectionGesture(me));
    if (!me.shiftKey && !me.ctrlKey && !me.metaKey) props.onActivate?.(row.item, row.key);
  };

  const onFocusIn = (e: Event) => {
    const target = e.target as HTMLElement;
    const row = findRow(target);
    if (row && (target === row.main || row.actions.some((cell) => cell.button === target))) {
      setStop(target);
    }
  };

  /** While the search field has a query and the focus, an overlay stack entry: Escape empties it
   * before closing a dialog the list is in */
  let removeEscapeEntry: ((returnFocus?: boolean) => void) | null = null;
  const syncEscapeEntry = () => {
    const isWanted = Boolean(searchElem && query && document.activeElement === searchElem);
    if (isWanted && !removeEscapeEntry && searchElem) {
      removeEscapeEntry = pushOverlay({ elem: searchElem, close: () => setQueryFrom('', true) });
    } else if (!isWanted && removeEscapeEntry) {
      removeEscapeEntry(false);
      removeEscapeEntry = null;
    }
  };

  const setQueryFrom = (next: string, byUser: boolean) => {
    if (next === query) return;
    const focus = captureFocus();
    query = next;
    queryWords = getQueryWords(next);
    marks.query = query;
    marks.words = queryWords;
    if (searchElem && searchElem.value !== next) searchElem.value = next;
    applyFilter();
    restoreFocus(focus);
    if (queryWords.length) {
      announce(
        cmp.elem,
        shownCount ? `${shownCount} of ${rows.length}` : `No matches for ${query.trim()}`
      );
    }
    syncEscapeEntry();
    if (byUser) filter?.onQueryChange?.(next);
  };

  // --- The elements ---

  const cmp = CMP({
    id: props.id,
    idAttr: props.id !== undefined,
    class: classes('aekList', props.class),
    attr: props.attr,
    onRemoveCmp: () => {
      removeScheduled?.();
      removeScheduled = null;
      removeEscapeEntry?.(false);
      removeEscapeEntry = null;
      typeahead.clear();
      for (const row of rows) disposeRow(row);
      rows = [];
      byKey.clear();
    },
  });

  let countElem: HTMLElement | null = null;
  let headingTextId: string | null = null;
  if (props.heading !== undefined) {
    const header = cmp.add({ class: 'aekList__header' });
    const heading = createElem(
      props.headingLevel ? `h${props.headingLevel}` : 'p',
      'aekList__heading'
    );
    const text = createElem('span', 'aekList__headingText');
    text.textContent = props.heading;
    headingTextId = `${cmp.id}-heading`;
    text.id = headingTextId;
    countElem = createElem('span', 'aekList__count');
    heading.append(text, ' ', countElem);
    header.elem.append(heading);
  }

  let searchElem: HTMLInputElement | null = null;
  if (filter?.field) {
    const onSearchKeyDown = (e: Event) => {
      const ke = e as KeyboardEvent;
      if (ke.key === 'ArrowDown' && stop && shownCount) {
        useKey(ke);
        stop.focus();
      } else if (ke.key === 'Escape' && query) {
        // Outside a HUD root (the overlay stack's entry takes it first under one)
        useKey(ke);
        setQueryFrom('', true);
      }
    };
    searchElem = cmp.add({ class: 'aekList__filter' }).add({
      tag: 'input',
      class: 'aekList__search',
      attr: {
        // Not type="search": the browsers' own clear button and Escape differ (the text field's)
        type: 'text',
        role: 'searchbox',
        'aria-label': filter.fieldLabel ?? 'Filter',
        placeholder: filter.placeholder ?? 'Filter',
        autocomplete: 'off',
        spellcheck: 'false',
      },
      listeners: [
        { type: 'input', fn: () => setQueryFrom((searchElem as HTMLInputElement).value, true) },
        { type: 'keydown', fn: onSearchKeyDown },
        { type: 'focus', fn: () => syncEscapeEntry() },
        { type: 'blur', fn: () => syncEscapeEntry() },
      ],
    }).elem as HTMLInputElement;
    searchElem.value = query;
  }

  const rowsAttr: CMPAttr = { 'data-mode': mode };
  if (isInteractive) {
    rowsAttr.role = mode;
    if (selectionMode === 'multiple') rowsAttr['aria-multiselectable'] = 'true';
    if (headingTextId) rowsAttr['aria-labelledby'] = headingTextId;
    else if (props.label) rowsAttr['aria-label'] = props.label;
  } else if (headingTextId) rowsAttr['aria-labelledby'] = headingTextId;
  else if (props.label) rowsAttr['aria-label'] = props.label;
  const rowsCmp = cmp.add({
    tag: mode === 'static' ? 'ul' : 'div',
    idAttr: true,
    class: 'aekList__rows',
    attr: rowsAttr,
    listeners: isInteractive
      ? [
          { type: 'keydown', fn: onKeyDown },
          { type: 'click', fn: onClick },
          { type: 'focusin', fn: onFocusIn },
        ]
      : [],
  });
  searchElem?.setAttribute('aria-controls', rowsCmp.id);

  const emptyCmp = cmp.add({ class: 'aekList__empty' });
  if (typeof props.empty === 'string') {
    emptyCmp.add({ tag: 'p', class: 'aekList__emptyText', text: props.empty });
  } else if (props.empty) emptyCmp.add(props.empty);
  const emptyElem = emptyCmp.elem;
  const noMatchCmp = cmp.add({ class: 'aekList__noMatch' });
  const noMatchElem = noMatchCmp.elem;
  const noMatchText = noMatchCmp.add({ tag: 'p', class: 'aekList__noMatchText' }).elem;
  noMatchCmp.add({
    tag: 'button',
    class: 'aekList__clear',
    text: 'Clear the filter',
    attr: { type: 'button' },
    onClick: () => {
      setQueryFrom('', true);
      (searchElem ?? stop)?.focus();
    },
  });

  if (props.selected) selection.set(props.selected);
  setRowsFrom(readItems(), false);

  if (props.scheduler || props.interval !== undefined) {
    removeScheduled = addScheduledRefresh(
      props.scheduler ?? getPageScheduler(),
      () => setRowsFrom(readItems(), true),
      {
        interval: props.interval,
        isShown: () => cmp.elem.isConnected && !cmp.elem.closest('[hidden]'),
      }
    );
  }

  return {
    cmp,
    setItems: (items) => {
      source = items;
      setRowsFrom(readItems(), true);
    },
    setItem: (key, item) => {
      const row = byKey.get(key);
      if (!row || getKey(item) !== key) return;
      const isNewItem = row.item !== item;
      row.item = item;
      writeRow(row, isNewItem);
      const isShown = isMatch(row);
      if (isShown === row.isShown) return;
      // Its match changed: the counts and the tab stop follow
      const focus = captureFocus();
      applyFilter();
      restoreFocus(focus);
    },
    setSelected: (keys) => {
      selection.set(keys.filter((key) => byKey.has(key)));
      for (const row of rows) writeSelected(row);
    },
    getSelected: () => selection.get(),
    setQuery: (next) => setQueryFrom(next, false),
    getQuery: () => query,
    focusKey: (key) => {
      const row = byKey.get(key);
      if (row?.isShown) focusRow(row);
    },
    scrollToKey: (key) => {
      const row = byKey.get(key);
      if (!row?.isShown) return;
      const box = rowsCmp.elem;
      const top = row.elem.offsetTop;
      const bottom = top + row.elem.offsetHeight;
      if (top < box.scrollTop) box.scrollTop = top;
      else if (bottom > box.scrollTop + box.clientHeight) box.scrollTop = bottom - box.clientHeight;
    },
    getKeyAt: (elem) => findRow(elem)?.key ?? null,
    refresh: () => setRowsFrom(readItems(), true),
  };
};
