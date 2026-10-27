// The list's public types (p805 D6), out of `List.ts` so it stays under 800 lines.
import type { CMPAttr, CMPHandle } from '../core/CMPTypes';
import type { BadgeValue } from '../components/Badge';
import type { BindingScheduler } from '../forms/binding/BindingScheduler';
import type { ListReorder } from './Reorder';
import type { SelectionMode } from './Selection';
import type { VirtualRows } from './VirtualRows';

/**
 * A button on every row of a `createList` (the list is a grid then: one row per item, the
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
 * The filter of a `createList`: a query that shows only the rows matching it, the matches
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
 * What `createList` makes a list from: its items, how each row shows one, and how the rows
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
  /** Renders only the rows the box shows (`createVirtualRows()`): for a long list, past about 200
   * rows. Every row is one height then, and the box needs one (`--aek-list-max-height`). */
  virtual?: VirtualRows;
  /** Lets the user move the rows (`createListReorder({ onReorder })`): Alt + ArrowUp / ArrowDown
   * and a drag, each row with a drag handle. A list with it is a listbox at least. */
  reorder?: ListReorder;
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

/** A list `createList` made: its CMP and its controls. */
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
