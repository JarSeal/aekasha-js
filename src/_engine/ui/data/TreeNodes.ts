// A tree's nodes (p805 D7), without the DOM: an entry per known node (its key, text, place and
// state), the walk that reads them from the roots, which lines show (the expanded nodes' children,
// a lazy node's loading or error line, the filter's matches with their ancestors), and the lazy
// loads' records. `Tree.ts` renders the shown lines and runs the loads.
import type { BadgeValue } from '../components/Badge';
import { foldText, matchesWords } from './Filter';
import type { TreeRow } from './TreeRow';
import type { TreeProps } from './TreeTypes';

/**
 * A lazy node's load: running, failed or done (its children kept until `reloadChildren`). A
 * collapse before it ends, the node's removal or a reload drops the record, so the result is
 * dropped: the loader checks it's still the node's.
 * @internal
 */
export type TreeLoad<T> = {
  state: 'loading' | 'error' | 'loaded';
  children: readonly T[];
  error: unknown;
};

/**
 * An entry's parts as last read from its node.
 * @internal
 */
export type TreeEntryText = {
  title: string;
  suffix: string;
  icon: string;
  tooltip: string;
  badge: BadgeValue | null;
  isPlaceholder: boolean;
  isDisabled: boolean;
};

/**
 * One known node: its key, text and place, its children as known, and how it shows now.
 * @internal
 */
export type TreeEntry<T> = {
  kind: 'node';
  key: string;
  node: T;
  parent: TreeEntry<T> | null;
  /** 1 for a root */
  level: number;
  /** Its children as known: `getChildren`'s, or a lazy node's loaded ones */
  children: TreeEntry<T>[];
  childMode: 'none' | 'sync' | 'lazy';
  /** A lazy node not loaded yet: whether it may have children (`hasChildren`) */
  mayHaveChildren: boolean;
  /** Its index among the shown lines (-1: not shown) */
  shownIndex: number;
  /** Its place among its shown siblings, and their count */
  posInSet: number;
  setSize: number;
  /** As shown: whether it opens, whether it's open, whether its children are loading */
  isExpandable: boolean;
  isOpen: boolean;
  isLoading: boolean;
  /** The filter: whether it matches, whether a descendant does */
  isMatch: boolean;
  hasMatchBelow: boolean;
  isSelected: boolean;
  text: TreeEntryText;
  /** The text folded, for the filter */
  folded: string;
  /** The title folded, for the typeahead */
  foldedTitle: string;
  /** The row showing it, null where it doesn't render */
  view: TreeRow<T> | null;
};

/**
 * A lazy node's loading or error line under it. An error line is a tree item (Enter retries); a
 * loading one isn't focusable.
 * @internal
 */
export type TreeStatus<T> = {
  kind: 'status';
  /** `STATUS_KEY_PREFIX` and its node's key */
  key: string;
  parent: TreeEntry<T>;
  state: 'loading' | 'error';
  text: string;
  shownIndex: number;
  /** Its element, made on first show and kept */
  elem: HTMLElement | null;
};

/**
 * A shown line: a node, or a lazy node's status.
 * @internal
 */
export type TreeLine<T> = TreeEntry<T> | TreeStatus<T>;

/**
 * What a status line's key starts with (no app key does: a NUL).
 * @internal
 */
export const STATUS_KEY_PREFIX = '\u0000';

const DEFAULT_LOADING_TEXT = 'Loading…';
const DEFAULT_ERROR_TEXT = 'Couldn’t load the items.';

/** A badge's label (a count or a word), or '' */
const getBadgeLabel = (badge: BadgeValue | null) =>
  String((typeof badge === 'object' && badge !== null ? badge.label : badge) ?? '');

/**
 * A tree's model: its entries by key, the walk from the roots (`rebuild`), the filter
 * (`applyFilter`), what shows (`computeShown`), the expanded keys and the lazy loads.
 * @internal
 */
export const createTreeNodes = <T>(props: TreeProps<T>, getKey: (node: T) => string) => {
  const byKey = new Map<string, TreeEntry<T>>();
  const loads = new Map<string, TreeLoad<T>>();
  const statuses = new Map<string, TreeStatus<T>>();
  /** The user's and code's expanded keys; a key not known yet is kept (a lazy subtree's) */
  const expanded = new Set<string>(props.expanded ?? []);
  /** While filtering: the nodes the user closed (the filter opens the matches' ancestors) */
  const filterClosed = new Set<string>();
  let roots: TreeEntry<T>[] = [];
  /** Every known entry, in the tree's order (pre-order) */
  let all: TreeEntry<T>[] = [];
  let shown: TreeLine<T>[] = [];
  let words: readonly string[] = [];
  let query = '';
  let matchCount = 0;

  /** Reads the node's parts: whether its filter text changed */
  const readEntry = (entry: TreeEntry<T>) => {
    const { node, text } = entry;
    const title = props.title?.(node) ?? entry.key;
    const suffix = props.suffix?.(node) ?? '';
    const badge = props.badge?.(node) ?? null;
    const badgeLabel = getBadgeLabel(badge);
    const oldBadgeLabel = getBadgeLabel(text.badge);
    text.isDisabled = props.disabled?.(node) ?? false;
    text.tooltip = props.tooltip?.(node) ?? '';
    text.icon = props.icon?.(node) ?? '';
    text.isPlaceholder = props.isPlaceholder?.(node) ?? false;
    text.badge = badge;
    if (
      entry.foldedTitle &&
      title === text.title &&
      suffix === text.suffix &&
      badgeLabel === oldBadgeLabel
    ) {
      return false;
    }
    if (title !== text.title || !entry.foldedTitle) entry.foldedTitle = foldText(title);
    text.title = title;
    text.suffix = suffix;
    entry.folded = props.render ? entry.foldedTitle : foldText(`${title} ${suffix} ${badgeLabel}`);
    return true;
  };

  const createEntry = (key: string, node: T): TreeEntry<T> => {
    const entry: TreeEntry<T> = {
      kind: 'node',
      key,
      node,
      parent: null,
      level: 1,
      children: [],
      childMode: 'none',
      mayHaveChildren: false,
      shownIndex: -1,
      posInSet: 0,
      setSize: 0,
      isExpandable: false,
      isOpen: false,
      isLoading: false,
      isMatch: true,
      hasMatchBelow: false,
      isSelected: false,
      text: {
        title: '',
        suffix: '',
        icon: '',
        tooltip: '',
        badge: null,
        isPlaceholder: false,
        isDisabled: false,
      },
      folded: '',
      foldedTitle: '',
      view: null,
    };
    readEntry(entry);
    return entry;
  };

  /** Whether it has children, or may (a lazy node not loaded) */
  const hasChildren = (entry: TreeEntry<T>) => {
    if (entry.childMode === 'sync') return entry.children.length > 0;
    if (entry.childMode === 'none') return false;
    return loads.get(entry.key)?.state === 'loaded'
      ? entry.children.length > 0
      : entry.mayHaveChildren;
  };

  /**
   * Reads every known node from the roots: `getChildren`'s children, and a lazy node's loaded
   * ones (no load starts here). A repeated key is passed over (its first place wins, so a cycle
   * ends). `onKept(entry, isNewNode)` for each entry kept from before, after its parts were read.
   * @returns the entries gone, their records dropped
   */
  const rebuild = (
    nodes: readonly T[],
    onKept: (entry: TreeEntry<T>, isNewNode: boolean) => void
  ) => {
    const seen = new Set<string>();
    const next: TreeEntry<T>[] = [];

    const visit = (list: readonly T[], parent: TreeEntry<T> | null, level: number) => {
      const out: TreeEntry<T>[] = [];
      for (const node of list) {
        const key = getKey(node);
        if (seen.has(key)) continue;
        seen.add(key);
        let entry = byKey.get(key);
        if (entry) {
          const isNewNode = entry.node !== node;
          entry.node = node;
          readEntry(entry);
          onKept(entry, isNewNode);
        } else {
          entry = createEntry(key, node);
          byKey.set(key, entry);
        }
        entry.parent = parent;
        entry.level = level;
        out.push(entry);
        next.push(entry);
        const children = props.getChildren?.(node);
        if (children) {
          entry.childMode = 'sync';
          loads.delete(key);
          entry.children = visit(children, entry, level + 1);
        } else if (props.loadChildrenAsync) {
          entry.childMode = 'lazy';
          entry.mayHaveChildren = props.hasChildren?.(node) ?? true;
          const load = loads.get(key);
          entry.children = load?.state === 'loaded' ? visit(load.children, entry, level + 1) : [];
        } else {
          entry.childMode = 'none';
          entry.children = [];
        }
      }
      return out;
    };

    roots = visit(nodes, null, 1);
    const removed: TreeEntry<T>[] = [];
    for (const entry of all) {
      if (seen.has(entry.key)) continue;
      byKey.delete(entry.key);
      loads.delete(entry.key);
      statuses.delete(entry.key);
      removed.push(entry);
    }
    all = next;
    return removed;
  };

  /** Matches every entry against the query's words (none: everything matches), and marks the
   * ancestors of the matches */
  const applyFilter = (nextWords: readonly string[], nextQuery: string) => {
    const isNewQuery = nextQuery !== query;
    words = nextWords;
    query = nextQuery;
    if (isNewQuery) filterClosed.clear();
    matchCount = 0;
    for (const entry of all) {
      entry.isMatch =
        !words.length ||
        (props.filter?.match
          ? props.filter.match(entry.node, query)
          : matchesWords(entry.folded, words));
      entry.hasMatchBelow = false;
      if (entry.isMatch) matchCount++;
    }
    if (!words.length) return;
    // In reverse pre-order a node's descendants come before it
    for (let i = all.length - 1; i >= 0; i--) {
      const entry = all[i];
      if (entry.parent && (entry.isMatch || entry.hasMatchBelow)) {
        entry.parent.hasMatchBelow = true;
      }
    }
  };

  const getStatus = (entry: TreeEntry<T>, load: TreeLoad<T>) => {
    let status = statuses.get(entry.key);
    if (!status) {
      status = {
        kind: 'status',
        key: `${STATUS_KEY_PREFIX}${entry.key}`,
        parent: entry,
        state: 'loading',
        text: '',
        shownIndex: -1,
        elem: null,
      };
      statuses.set(entry.key, status);
    }
    status.parent = entry;
    status.state = load.state === 'error' ? 'error' : 'loading';
    const { errorText } = props;
    status.text =
      status.state === 'loading'
        ? props.loadingText ?? DEFAULT_LOADING_TEXT
        : typeof errorText === 'function'
          ? errorText(load.error, entry.node)
          : errorText ?? DEFAULT_ERROR_TEXT;
    return status;
  };

  /**
   * Works out the shown lines: the roots, an open node's children (while filtering only the
   * matches and their ancestors, each such ancestor open unless the user closed it), a lazy
   * node's status line while it loads or failed. An open lazy node with no load gets one.
   * @returns the entries whose load starts now
   */
  const computeShown = () => {
    const isFiltering = words.length > 0;
    const toLoad: TreeEntry<T>[] = [];
    for (const line of shown) line.shownIndex = -1;
    shown = [];

    const visit = (siblings: readonly TreeEntry<T>[]) => {
      const visible = isFiltering
        ? siblings.filter((entry) => entry.isMatch || entry.hasMatchBelow)
        : siblings;
      for (let i = 0; i < visible.length; i++) {
        const entry = visible[i];
        entry.posInSet = i + 1;
        entry.setSize = visible.length;
        entry.shownIndex = shown.length;
        shown.push(entry);
        entry.isExpandable = isFiltering ? entry.hasMatchBelow : hasChildren(entry);
        entry.isOpen =
          entry.isExpandable &&
          (isFiltering ? !filterClosed.has(entry.key) : expanded.has(entry.key));
        entry.isLoading = false;
        if (!entry.isOpen) continue;
        if (entry.childMode === 'lazy') {
          let load = loads.get(entry.key);
          if (!load) {
            load = { state: 'loading', children: [], error: undefined };
            loads.set(entry.key, load);
            toLoad.push(entry);
          }
          if (load.state !== 'loaded') {
            entry.isLoading = load.state === 'loading';
            const status = getStatus(entry, load);
            status.shownIndex = shown.length;
            shown.push(status);
            continue;
          }
        }
        visit(entry.children);
      }
    };

    visit(roots);
    // A status line not shown now goes with its element
    for (const [key, status] of statuses) {
      if (status.shownIndex !== -1) continue;
      status.elem?.remove();
      statuses.delete(key);
    }
    return toLoad;
  };

  /**
   * Opens or closes a node in the view: while filtering only the filter's view (the expanded
   * keys are restored after it), else the expanded keys. Closing drops a load that hasn't ended.
   * `isUser` is the user's change: while filtering, code's changes the expanded keys too.
   * @returns whether the expanded keys changed
   */
  const setOpen = (entry: TreeEntry<T>, isOpen: boolean, isUser: boolean) => {
    const { key } = entry;
    if (words.length) {
      if (isOpen) filterClosed.delete(key);
      else filterClosed.add(key);
      if (isUser) return false;
    }
    if (isOpen === expanded.has(key)) return false;
    if (isOpen) expanded.add(key);
    else {
      expanded.delete(key);
      if (loads.get(key)?.state !== 'loaded') loads.delete(key);
    }
    return true;
  };

  /** The expanded keys: the known ones in the tree's order, then the others */
  const getExpanded = () => {
    const keys: string[] = [];
    for (const entry of all) if (expanded.has(entry.key)) keys.push(entry.key);
    if (keys.length === expanded.size) return keys;
    for (const key of expanded) if (!byKey.has(key)) keys.push(key);
    return keys;
  };

  return {
    byKey,
    loads,
    expanded,
    readEntry,
    rebuild,
    applyFilter,
    computeShown,
    setOpen,
    getExpanded,
    getRoots: () => roots,
    getAll: () => all,
    getShown: () => shown,
    getMatchCount: () => matchCount,
    isFiltering: () => words.length > 0,
    /** A shown line by its key (a status line's too) */
    findLine: (key: string): TreeLine<T> | undefined =>
      key.startsWith(STATUS_KEY_PREFIX)
        ? statuses.get(key.slice(STATUS_KEY_PREFIX.length))
        : byKey.get(key),
  };
};
