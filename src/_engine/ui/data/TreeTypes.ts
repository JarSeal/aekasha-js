// The tree's public types (p805 D7), out of `Tree.ts` so it stays under 800 lines.
import type { CMPAttr, CMPHandle } from '../core/CMPTypes';
import type { BadgeValue } from '../components/Badge';
import type { BindingScheduler } from '../forms/binding/BindingScheduler';
import type { SelectionMode } from './Selection';
import type { VirtualRows } from './VirtualRows';

/**
 * The filter of a `createTree`: a query that shows only the nodes matching it and their
 * ancestors, opened, the matches marked.
 * @template T the nodes' type
 */
export type TreeFilter<T> = {
  /** The query at the start (default none). */
  query?: string;
  /** Whether a node matches a query that isn't empty. Default: every word of the query is in the
   * node's text (its title, suffix and badge), case and accents ignored. */
  match?: (node: T, query: string) => boolean;
  /** Puts a search field above the tree (default false): ArrowDown goes from it into the tree,
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
 * What `createTree` makes a tree from: its roots, how it finds a node's children, how each row
 * shows a node, and how the rows are used.
 * @template T the nodes' type
 */
export type TreeProps<T> = {
  /** The top-level nodes, in order, or a function returning them, read again on `refresh` and on
   * the scheduler's tick (`interval`). */
  roots: readonly T[] | (() => readonly T[]);
  /** A node's key, unique in the whole tree (default its `id`, as a string): a kept key keeps its
   * row, its expanded state and its selection when the nodes change. */
  getKey?: (node: T) => string;
  /** A node's children, read on every refresh. `null` or `undefined`: not known here, so
   * `loadChildrenAsync` loads them (without it the node is a leaf). */
  getChildren?: (node: T) => readonly T[] | null | undefined;
  /** Loads the children `getChildren` doesn't give when the node first opens, a loading row
   * under it meanwhile (an error row with a retry if it fails). The result is kept until
   * `reloadChildren`; a node closed or removed before it ends drops it. */
  loadChildrenAsync?: (node: T) => Promise<readonly T[]>;
  /** Whether a node not loaded yet may have children, so it shows as one that opens (default
   * true). Once loaded, its children say. */
  hasChildren?: (node: T) => boolean;
  /** A row's title (default its key). With `render`, still its text for the typeahead and the
   * filter. */
  title?: (node: T) => string;
  /** Short text at the row's end (a count), in tabular figures. */
  suffix?: (node: T) => string | null | undefined;
  /** Raw HTML of an icon before the title (`getSvgIcon('folder')`). */
  icon?: (node: T) => string | null | undefined;
  /** A badge before the title (a type's shorthand, a count). */
  badge?: (node: T) => BadgeValue | null | undefined;
  /** The row's tooltip. */
  tooltip?: (node: T) => string | null | undefined;
  /** Whether the title is a stand-in (an unnamed object's): italic and muted. */
  isPlaceholder?: (node: T) => boolean;
  /** Disables a node: dimmed, not selected or activated (it still opens and closes). */
  disabled?: (node: T) => boolean;
  /** A row's content as a CMP in place of the parts above, called again when the node changes
   * (another object for its key), the old one removed. */
  render?: (node: T) => CMPHandle;
  /** A heading above the tree with its count of known nodes ("3 of 120" while filtered), which
   * names it. */
  heading?: string;
  /** The heading's level (`h2` to `h6`); a paragraph by default. */
  headingLevel?: 2 | 3 | 4 | 5 | 6;
  /** The tree's accessible name without a heading: one of the two is needed. */
  label?: string;
  /** The expanded keys at the start (a key not known yet opens when its node shows: a restored
   * lazy subtree loads level by level). */
  expanded?: readonly string[];
  /** The user's opens and closes (not while filtering: the filter's are its own), in the tree's
   * order. Keeping them is the app's. */
  onExpandedChange?: (keys: string[]) => void;
  /** What the user can select (default 'none'): one node, or several (Ctrl / ⌘ and Shift). */
  selection?: SelectionMode;
  /** The selected keys at the start. */
  selected?: readonly string[];
  /** The user's changes to the selection (and a selected key the nodes lost), in the tree's
   * order. */
  onSelectionChange?: (keys: string[]) => void;
  /** A node's activation: a click without Shift, Ctrl or ⌘, or Enter. Without it Enter, and a
   * click in a tree without `selection`, opens or closes a node. */
  onActivate?: (node: T, key: string) => void;
  /** Filters the nodes by a query, marking the matches. */
  filter?: TreeFilter<T>;
  /** Renders only the rows the box shows (`createVirtualRows()`): for a big tree, past about 200
   * shown rows. Every row is one height then, and the box needs one (`--aek-tree-max-height`). */
  virtual?: VirtualRows;
  /** What shows in place of the rows when there are no roots: a text, or a CMP
   * (`createEmptyState`'s), which the tree removes with itself. */
  empty?: string | CMPHandle;
  /** The loading row's text (default 'Loading…'). */
  loadingText?: string;
  /** The error row's text (default 'Couldn’t load the items.'), or a function of the error and the
   * node. The row's Retry follows it. */
  errorText?: string | ((error: unknown, node: T) => string);
  /** Reads `roots` (a function) on this scheduler: its `refresh()`, and its tick every `interval`
   * ms while the tree shows. */
  scheduler?: BindingScheduler;
  /** Reads `roots` (a function) every this many ms while the tree shows (0: every frame), on
   * `scheduler` or the page's. */
  interval?: number;
  /** Extra classes for the tree's element. */
  class?: string | string[];
  /** Extra attributes for the tree's element. */
  attr?: CMPAttr;
  /** The tree's element id (default: a generated one, not written to the element). */
  id?: string;
};

/** A tree `createTree` made: its CMP and its controls. */
export type Tree<T> = {
  /** The tree's element: its heading, search field, rows and empty state. `cmp.remove()` removes
   * the rows' tooltips and rendered CMPs with it, and drops the loads still running. */
  cmp: CMPHandle;
  /** Replaces the roots (an array, or a function read again on `refresh`): a kept key keeps its
   * row, a part is written only when its text changed. */
  setRoots: (roots: readonly T[] | (() => readonly T[])) => void;
  /** Replaces one node by its key and writes its row's changed parts: a live figure. Its
   * children aren't read again (`refresh` does); an unknown key does nothing. */
  setNode: (key: string, node: T) => void;
  /** Opens a node (loading its children if they're lazy), without calling `onExpandedChange`. */
  expand: (key: string) => void;
  /** Closes a node, without calling `onExpandedChange`. */
  collapse: (key: string) => void;
  /** Whether a node is in the expanded keys */
  isExpanded: (key: string) => boolean;
  /** The expanded keys: the known ones in the tree's order, then the others */
  getExpanded: () => string[];
  /** Drops a lazy node's loaded children and, while it's open, loads them again. */
  reloadChildren: (key: string) => void;
  /** Sets the selected keys without calling `onSelectionChange`. */
  setSelected: (keys: readonly string[]) => void;
  /** The selected keys, in the tree's order */
  getSelected: () => string[];
  /** Sets the filter's query (and the search field's text) without calling `onQueryChange`. */
  setQuery: (query: string) => void;
  /** The filter's query */
  getQuery: () => string;
  /** Focuses a node by its key, opening its ancestors first (unreported, as `expand`), and makes
   * it the tree's tab stop. A node the filter hides does nothing. */
  focusKey: (key: string) => void;
  /** Scrolls the tree's box (never the page) so a node shows, opening its ancestors first. */
  scrollToKey: (key: string) => void;
  /** The key of the node holding an element (a context menu's), or null: what a
   * `createContextMenu` on `cmp.elem` finds its node by. */
  getKeyAt: (elem: Element) => string | null;
  /** Reads `roots` (a function) and the children again and writes what changed. */
  refresh: () => void;
};
