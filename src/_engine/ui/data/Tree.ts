import type { CMPAttr } from '../core/CMPTypes';
import { CMP, classes } from '../core/CMP';
import { announce } from '../components/Announcer';
import { createTypeahead, getMoveTarget, isTypeaheadKey } from '../components/RovingFocus';
import { addScheduledRefresh, getPageScheduler } from '../forms/binding/BindingScheduler';
import {
  addCollectionEmpty,
  addCollectionHeader,
  addCollectionSearch,
  placeElems,
  useCollectionKey,
  writeAttr,
  writeCollectionCount,
} from './CollectionParts';
import { getQueryWords } from './Filter';
import { createSelection, getSelectionGesture, type SelectionGesture } from './Selection';
import { createTreeNodes, STATUS_KEY_PREFIX, type TreeEntry, type TreeLine } from './TreeNodes';
import {
  createTreeRows,
  TREE_ROW_CLASS,
  TREE_STATUS_CLASS,
  writeStatusRow,
  type TreeMarks,
  type TreeRow,
} from './TreeRow';
import type { Tree, TreeProps } from './TreeTypes';
import { useVirtualRows } from './VirtualRows';
import './Tree.scss';
import '../styles/kit.scss';

/** The page size of PageUp and PageDown when the tree doesn't scroll */
const DEFAULT_PAGE_SIZE = 10;

/** Where the focus was in the rows before a change: its line's key and index */
type FocusMark = { key: string; index: number };

const defaultGetKey = (node: unknown) => String((node as { id?: unknown }).id);

const isFocusable = <T>(line: TreeLine<T>) => line.kind === 'node' || line.state === 'error';

/** Whether a line is under an entry, at any depth */
const isBelow = <T>(line: TreeLine<T>, entry: TreeEntry<T>) => {
  for (let parent = line.parent; parent; parent = parent.parent) if (parent === entry) return true;
  return false;
};

/**
 * Creates a tree (p805 D7): an app's nested nodes as rows, each a title with an optional icon,
 * badge, suffix and tooltip (or a CMP of `render`), opened and closed by the user, kept by key so
 * new nodes write only what changed. A node's children are `getChildren`'s, or loaded on its first
 * open (`loadChildrenAsync`: a loading row meanwhile, an error row with a retry). Selectable
 * (`selection`), filtered by a query (the matches with their ancestors, opened, the matches
 * marked), and a big tree renders only the rows its box shows (`virtual`).
 * - Parts: `.aekTree`, `.aekTree__header` with `__heading` (`__headingText`, `__count`), `__filter`
 *   with `__search`, `.aekTree__rows`, a `.aekTree__row` per shown node (`data-key`,
 *   `aria-expanded`, `aria-selected`, `aria-disabled`, `aria-busy`, `data-pinned`; its indent from
 *   `--aek-tree-level`) with `__twisty` (the open mark) and `__content`: `__icon`, `__badge`,
 *   `__title` (`data-placeholder`), `__suffix`; a lazy node's `.aekTree__status`
 *   (`data-status="loading" | "error"`: `__statusMark`, `__statusText`, `__retry`);
 *   `.aekTree__empty` and `.aekTree__noMatch` (with `__clear`); virtual rows' `__spacer`s. The
 *   matches are `<mark class="aekMark">`s.
 * - Custom properties (read on any ancestor, the token as the fallback): `--aek-tree-max-height`
 *   (the rows' box scrolls past it; default none, 12 rows with `virtual`), `--aek-tree-indent`
 *   (each level's step), `--aek-tree-selected-color` (the selected row's bar, default the accent),
 *   `--aek-tree-row-height` (virtual rows' height, written by the tree once measured).
 * - Keys (the APG tree): the tree is one tab stop. Up / Down move between the shown rows (no
 *   wrapping), Home / End to the ends, PageUp / PageDown by the box's height; Right opens a closed
 *   node or goes to an open one's first child, Left closes an open node or goes to its parent; `*`
 *   opens the node's siblings; a letter goes to the next title starting with it. Enter activates
 *   (`onActivate`; without it, opens or closes); Space selects (toggles in a multiple selection);
 *   with a multiple selection Shift + a move or a click selects the range from the last picked
 *   node, Ctrl / ⌘ + click toggles and Ctrl / ⌘ + A selects every shown node (or none). Enter or
 *   Space on an error row retries. The search field's ArrowDown enters the tree, its Escape
 *   empties it. The keys it uses reach no key binding.
 * - ARIA: one flat `role="tree"` (`aria-multiselectable`) of `treeitem`s named by the heading or
 *   `label`, each with `aria-level`, `aria-setsize` and `aria-posinset` (among its shown
 *   siblings), `aria-expanded` when it opens, `aria-selected` (with a `selection`),
 *   `aria-disabled`, `aria-busy` while its children load; an error row is a tree item one level
 *   down. A filter's count ("12 of 340", "No matches for …") and a load's end are announced
 *   politely.
 *
 * A context menu over the nodes is the app's: `createContextMenu({ target: tree.cmp.elem, … })`,
 * its items found by `getKeyAt`, so a tree without one carries none of its code.
 * @template T the nodes' type
 * @example
 * ```ts
 * type SceneNode = { id: string; name: string; children: SceneNode[] };
 *
 * const outline = createTree<SceneNode>({
 *   label: 'Scene',
 *   roots: () => [getSceneRoot()],
 *   getChildren: (node) => node.children,
 *   title: (node) => node.name,
 *   suffix: (node) => (node.children.length ? String(node.children.length) : null),
 *   selection: 'single',
 *   expanded: savedExpandedKeys,
 *   onExpandedChange: (keys) => saveExpandedKeys(keys),
 *   onActivate: (node) => openNodeWindow(node.id),
 *   filter: { field: true },
 *   scheduler,
 *   interval: 500,
 * });
 * outlinePanel.add(outline.cmp);
 *
 * outline.focusKey(pickedNodeId); // opens its ancestors, scrolls it into the box
 * ```
 */
export const createTree = <T>(props: TreeProps<T>): Tree<T> => {
  const { filter } = props;
  const getKey = props.getKey ?? defaultGetKey;
  const selectionMode = props.selection ?? 'none';
  const virtualImpl = useVirtualRows(props.virtual);
  const model = createTreeNodes(props, getKey);
  const { byKey } = model;
  let source = props.roots;
  /** The roots last read: a load's end walks them again */
  let lastRoots: readonly T[] = [];
  let query = filter?.query ?? '';
  let queryWords = getQueryWords(query);
  const marks: TreeMarks = { query, words: queryWords };
  /** The tab stop: a line's key, and the element with `tabindex="0"` */
  let stopKey: string | null = null;
  let stopElem: HTMLElement | null = null;
  /** The rendered lines, and the rows they let go of */
  let mounted: TreeLine<T>[] = [];
  const pool: TreeRow<T>[] = [];
  let isRemoved = false;
  let removeScheduled: (() => void) | null = null;

  const { createRow, bindRow, writeRow, writePlace, disposeRow } = createTreeRows({ props, marks });
  const getShownNodes = () =>
    model.getShown().filter((line): line is TreeEntry<T> => line.kind === 'node');
  const selection = createSelection({
    mode: selectionMode,
    getOrder: () =>
      getShownNodes()
        .filter((entry) => !entry.text.isDisabled)
        .map((entry) => entry.key),
  });
  const typeahead = createTypeahead({
    getCount: () => model.getShown().length,
    getText: (index) => {
      const line = model.getShown()[index];
      return line.kind === 'node' ? line.foldedTitle : '';
    },
  });

  // --- The tab stop and the focus ---

  const getLineElem = (line: TreeLine<T>) =>
    line.kind === 'node' ? line.view?.elem ?? null : line.elem;

  const isShownLine = (line: TreeLine<T> | undefined): line is TreeLine<T> =>
    Boolean(line && line.shownIndex !== -1);

  /** Writes the tab stop's `tabindex` where it is now (a recycled row may have taken the old one) */
  const writeStop = () => {
    const line = stopKey === null ? undefined : model.findLine(stopKey);
    const next = isShownLine(line) && isFocusable(line) ? getLineElem(line) : null;
    // A status row that stopped being focusable has no tabindex left to reset
    if (stopElem && stopElem !== next && stopElem.hasAttribute('tabindex')) {
      stopElem.setAttribute('tabindex', '-1');
    }
    next?.setAttribute('tabindex', '0');
    stopElem = next;
  };

  const findLineAt = (target: EventTarget | null) => {
    const elem = (target as Element | null)?.closest?.(`.${TREE_ROW_CLASS}, .${TREE_STATUS_CLASS}`);
    if (!elem || elem.parentNode !== rowsElem) return null;
    return model.findLine(elem.getAttribute('data-key') ?? '') ?? null;
  };

  /** Puts the tab stop on a shown, focusable line when it's on none: a status line's node, a
   * hidden node's nearest shown ancestor, the line nearest `near` (where a focused one was), the
   * first selected node, the first line */
  const ensureStop = (near: number | null) => {
    const current = stopKey === null ? undefined : model.findLine(stopKey);
    if (isShownLine(current) && isFocusable(current)) return;
    const shown = model.getShown();
    let next: TreeLine<T> | null = null;
    for (let parent = current?.parent ?? null; parent && !next; parent = parent.parent) {
      if (parent.shownIndex !== -1) next = parent;
    }
    if (!next && near !== null && shown.length) {
      const at = Math.min(near, shown.length - 1);
      for (let d = 0; d <= shown.length && !next; d++) {
        const after = shown[at + d];
        const before = shown[at - d];
        next = after && isFocusable(after) ? after : before && isFocusable(before) ? before : null;
      }
    }
    next ??= getShownNodes().find((entry) => entry.isSelected) ?? shown.find(isFocusable) ?? null;
    stopKey = next?.key ?? null;
  };

  /** The focus in the rows before a change that may remove, hide or move its row */
  const captureFocus = (): FocusMark | null => {
    const active = document.activeElement;
    if (!active || !rowsElem.contains(active)) return null;
    const line = findLineAt(active);
    return line ? { key: line.key, index: line.shownIndex } : null;
  };

  /** After the change: the focus back on its line, or on the tab stop when its line went */
  const restoreFocus = (focus: FocusMark | null) => {
    if (!focus) return;
    const line = model.findLine(focus.key);
    const elem = isShownLine(line) && isFocusable(line) ? getLineElem(line) : null;
    const target = elem ?? stopElem;
    if (target && document.activeElement !== target) target.focus();
  };

  // --- Rendering ---

  /** Lets go of a line's element: a node's row back to the pool */
  const unmount = (line: TreeLine<T>) => {
    const elem = line.kind === 'node' ? line.view?.elem : line.elem;
    if (!elem) return;
    elem.remove();
    elem.removeAttribute('data-pinned');
    elem.style.removeProperty('top');
    if (line.kind === 'status' || !line.view) return;
    line.view.entry = null;
    pool.push(line.view);
    line.view = null;
  };

  const mount = (line: TreeLine<T>) => {
    if (line.kind === 'status') return writeStatusRow(line);
    let row = line.view;
    if (!row) {
      row = pool.pop() ?? createRow();
      // A recycled row was another node's: not the stop until `writeStop`
      row.elem.setAttribute('tabindex', '-1');
      bindRow(row, line);
    }
    writePlace(row);
    return row.elem;
  };

  /** The shown lines (with virtual rows the window's and the tab stop's, placed at its offset when
   * out of the window, between the spacers) */
  const renderLines = () => {
    const shown = model.getShown();
    const { start, end } = virtualView
      ? virtualView.getWindow(shown.length)
      : { start: 0, end: shown.length };
    const kept = new Set<TreeLine<T>>(shown.slice(start, end));
    const stop = stopKey === null ? undefined : model.findLine(stopKey);
    const pinned: TreeLine<T>[] = [];
    if (isShownLine(stop) && !kept.has(stop)) {
      kept.add(stop);
      pinned.push(stop);
    }
    for (const line of mounted) if (!kept.has(line)) unmount(line);
    mounted = [...kept];
    const height = virtualView?.getRowHeight() ?? 0;
    const elems: HTMLElement[] = virtualView ? [virtualView.top] : [];
    for (const line of mounted) {
      const elem = mount(line);
      if (!virtualView) {
        elems.push(elem);
        continue;
      }
      const isPinned = line.shownIndex < start || line.shownIndex >= end;
      writeAttr(elem, 'data-pinned', isPinned ? '' : null);
      if (isPinned) elem.style.top = `${line.shownIndex * height}px`;
      else {
        elem.style.removeProperty('top');
        elems.push(elem);
      }
    }
    if (virtualView) {
      elems.push(virtualView.bottom);
      for (const line of pinned) elems.push(getLineElem(line) as HTMLElement);
    }
    placeElems(rowsElem, elems);
    writeStop();
    if (!virtualView) return;
    virtualView.layout(shown.length, start, end);
    // The first row shown gives the height when none was given: the window again with it
    const first = mounted[0];
    const firstElem = first && getLineElem(first);
    if (firstElem && virtualView.measure(firstElem)) renderLines();
  };

  /** After the nodes, the query or an open state changed: the shown lines, the counts, the tab
   * stop, the rows, the focus; then the loads an open lazy node needs */
  const settle = (focus: FocusMark | null) => {
    const toLoad = model.computeShown();
    const total = model.getAll().length;
    const shownCount = model.getShown().length;
    writeCollectionCount(countElem, model.getMatchCount(), total, model.isFiltering());
    emptyParts.write(rowsElem, total, shownCount, query);
    ensureStop(focus?.index ?? null);
    renderLines();
    restoreFocus(focus);
    for (const entry of toLoad) void loadChildrenAsync(entry);
  };

  /** Writes each entry's selected state where it changed */
  const writeSelection = () => {
    for (const entry of model.getAll()) {
      const isSelected = selection.has(entry.key);
      if (entry.isSelected === isSelected) continue;
      entry.isSelected = isSelected;
      if (entry.view) writeRow(entry.view, false);
    }
  };

  const setRootsFrom = (nodes: readonly T[], report: boolean) => {
    const focus = captureFocus();
    lastRoots = nodes;
    model.rebuild(nodes, (entry, isNewNode) => {
      if (entry.view) writeRow(entry.view, isNewNode);
    });
    model.applyFilter(queryWords, query);
    const changed = selection.retain((key) => byKey.has(key));
    writeSelection();
    if (changed && report) props.onSelectionChange?.(selection.get());
    settle(focus);
  };

  const readRoots = () => (typeof source === 'function' ? source() : source);

  /** Runs an open lazy node's load. A close, the node's removal, a reload or the tree's removal
   * before it ends drops its record, and so the result. */
  const loadChildrenAsync = async (entry: TreeEntry<T>) => {
    const { key } = entry;
    const load = model.loads.get(key);
    const loader = props.loadChildrenAsync;
    if (!load || !loader) return;
    let children: readonly T[] = [];
    let error: unknown;
    let isFailed = false;
    try {
      children = [...(await loader(entry.node))];
    } catch (e) {
      isFailed = true;
      error = e;
    }
    if (isRemoved || model.loads.get(key) !== load) return;
    load.state = isFailed ? 'error' : 'loaded';
    load.children = children;
    load.error = error;
    setRootsFrom(lastRoots, true);
    const title = byKey.get(key)?.text.title ?? key;
    const status = model.findLine(`${STATUS_KEY_PREFIX}${key}`);
    const count = children.length;
    announce(
      cmp.elem,
      isFailed
        ? `${title}: ${status?.kind === 'status' ? status.text : 'not loaded'}`
        : `${title}: ${count} ${count === 1 ? 'item' : 'items'}`
    );
  };

  // --- Opening and closing ---

  const reportExpanded = () => props.onExpandedChange?.(model.getExpanded());

  /** Opens or closes a node; closed with the tab stop under it, the stop (and the focus) go to it */
  const setOpen = (entry: TreeEntry<T>, isOpen: boolean, isUser: boolean) => {
    let focus = captureFocus();
    const changed = model.setOpen(entry, isOpen, isUser);
    const stop = stopKey === null ? undefined : model.findLine(stopKey);
    if (!isOpen && stop && isBelow(stop, entry)) {
      stopKey = entry.key;
      if (focus) focus = { key: entry.key, index: entry.shownIndex };
    }
    settle(focus);
    if (changed && isUser) reportExpanded();
  };

  /** `*`: every shown sibling that opens, opened */
  const openSiblings = (entry: TreeEntry<T>) => {
    const siblings = entry.parent ? entry.parent.children : model.getRoots();
    let changed = false;
    for (const sibling of siblings) {
      if (sibling.shownIndex === -1 || !sibling.isExpandable || sibling.isOpen) continue;
      if (model.setOpen(sibling, true, true)) changed = true;
    }
    settle(captureFocus());
    if (changed) reportExpanded();
  };

  /** Opens a node's ancestors (code's: unreported) */
  const revealAncestors = (entry: TreeEntry<T>) => {
    let changed = false;
    for (let parent = entry.parent; parent; parent = parent.parent) {
      if (model.setOpen(parent, true, false)) changed = true;
    }
    return changed;
  };

  /** Shows a node, opening its ancestors: whether it shows */
  const reveal = (key: string) => {
    const entry = byKey.get(key);
    if (!entry) return null;
    // While filtering an ancestor may open only in the filter's view: settled when it's hidden
    if (revealAncestors(entry) || entry.shownIndex === -1) settle(captureFocus());
    return entry.shownIndex === -1 ? null : entry;
  };

  const retry = (entry: TreeEntry<T>) => {
    let focus = captureFocus();
    model.loads.delete(entry.key);
    // The error row stops being focusable while it loads again: the stop goes to its node
    if (stopKey === `${STATUS_KEY_PREFIX}${entry.key}`) {
      stopKey = entry.key;
      if (focus) focus = { key: entry.key, index: entry.shownIndex };
    }
    settle(focus);
  };

  // --- The user's input ---

  const reportSelection = () => {
    writeSelection();
    props.onSelectionChange?.(selection.get());
  };

  const pick = (entry: TreeEntry<T>, gesture: SelectionGesture) => {
    if (entry.text.isDisabled || selectionMode === 'none') return;
    if (selection.pick(entry.key, gesture)) reportSelection();
  };

  const activate = (entry: TreeEntry<T>) => {
    if (entry.text.isDisabled) return;
    if (selectionMode === 'single') pick(entry, 'replace');
    props.onActivate?.(entry.node, entry.key);
  };

  /** Focuses a line, rendering it first (virtual rows scroll to it) */
  const focusLine = (line: TreeLine<T>) => {
    virtualView?.scrollToIndex(line.shownIndex);
    stopKey = line.key;
    renderLines();
    stopElem?.focus();
  };

  /** The page size: the rows that fit the box when it scrolls */
  const getPageSize = () => {
    if (virtualView) return virtualView.getPageSize();
    const height = stopElem?.offsetHeight;
    if (!height || !(rowsElem.scrollHeight > rowsElem.clientHeight)) return DEFAULT_PAGE_SIZE;
    return Math.max(1, Math.floor(rowsElem.clientHeight / height));
  };

  const onKeyDown = (e: Event) => {
    const ke = e as KeyboardEvent;
    const line = findLineAt(e.target);
    if (!line || e.target !== getLineElem(line)) return;
    const { key } = ke;
    const isMod = ke.ctrlKey || ke.metaKey;
    const shown = model.getShown();

    if (isMod && !ke.altKey && key.toLowerCase() === 'a' && selectionMode === 'multiple') {
      useCollectionKey(ke);
      if (selection.all()) reportSelection();
      return;
    }
    if (ke.altKey || isMod) return;
    const next = getMoveTarget(key, line.shownIndex, {
      count: shown.length,
      pageSize: key.startsWith('Page') ? getPageSize() : undefined,
      isSkipped: (index) => !isFocusable(shown[index]),
    });
    if (next !== null) {
      useCollectionKey(ke);
      if (next === -1) return;
      const to = shown[next];
      focusLine(to);
      if (ke.shiftKey && selectionMode === 'multiple' && to.kind === 'node') pick(to, 'range');
      return;
    }
    if (key === 'ArrowRight') {
      useCollectionKey(ke);
      if (line.kind !== 'node') return;
      if (line.isExpandable && !line.isOpen) setOpen(line, true, true);
      else if (line.isOpen) {
        const child = shown[line.shownIndex + 1];
        if (child && isFocusable(child) && child.parent === line) focusLine(child);
      }
      return;
    }
    if (key === 'ArrowLeft') {
      useCollectionKey(ke);
      if (line.kind === 'node' && line.isOpen) setOpen(line, false, true);
      else if (line.parent && line.parent.shownIndex !== -1) focusLine(line.parent);
      return;
    }
    if (key === '*') {
      useCollectionKey(ke);
      if (line.kind === 'node') openSiblings(line);
      return;
    }
    if ((key === 'Enter' && !ke.shiftKey) || key === ' ') {
      useCollectionKey(ke);
      if (line.kind === 'status') retry(line.parent);
      else if (key === ' ') pick(line, getSelectionGesture(ke, selectionMode === 'multiple'));
      else if (props.onActivate) activate(line);
      else if (line.isExpandable) setOpen(line, !line.isOpen, true);
      return;
    }
    if (isTypeaheadKey(ke)) {
      useCollectionKey(ke);
      const index = typeahead.type(key, line.shownIndex);
      if (index !== -1) focusLine(shown[index]);
    }
  };

  const onClick = (e: Event) => {
    const line = findLineAt(e.target);
    if (!line) return;
    if (line.kind === 'status') {
      if (line.state === 'error') retry(line.parent);
      return;
    }
    if ((e.target as Element).closest('.aekTree__twisty')) {
      if (line.isExpandable) setOpen(line, !line.isOpen, true);
      return;
    }
    if (line.text.isDisabled) return;
    const me = e as MouseEvent;
    pick(line, getSelectionGesture(me));
    if (me.shiftKey || me.ctrlKey || me.metaKey) return;
    if (props.onActivate) props.onActivate(line.node, line.key);
    else if (selectionMode === 'none' && line.isExpandable) setOpen(line, !line.isOpen, true);
  };

  const onFocusIn = (e: Event) => {
    const line = findLineAt(e.target);
    if (!line || !isFocusable(line) || e.target !== getLineElem(line)) return;
    stopKey = line.key;
    writeStop();
  };

  const setQueryFrom = (next: string, byUser: boolean) => {
    if (next === query) return;
    const focus = captureFocus();
    const wasFiltering = queryWords.length > 0;
    query = next;
    queryWords = getQueryWords(next);
    marks.query = query;
    marks.words = queryWords;
    search?.setValue(next);
    // The rendered rows' marks for the new query (a row bound later marks itself)
    if (!props.render) {
      for (const line of mounted) if (line.kind === 'node' && line.view) writeRow(line.view, false);
    }
    model.applyFilter(queryWords, query);
    // Cleared: the focused node's ancestors open, so it stays where the filter showed it
    const stop = stopKey === null ? undefined : model.findLine(stopKey);
    const isRevealed =
      wasFiltering && !queryWords.length && stop?.kind === 'node' && revealAncestors(stop);
    settle(focus);
    if (queryWords.length) {
      const matches = model.getMatchCount();
      announce(
        cmp.elem,
        matches ? `${matches} of ${model.getAll().length}` : `No matches for ${query.trim()}`
      );
    }
    search?.syncEscapeEntry();
    if (!byUser) return;
    filter?.onQueryChange?.(next);
    if (isRevealed) reportExpanded();
  };

  // --- The elements ---

  const cmp = CMP({
    id: props.id,
    idAttr: props.id !== undefined,
    class: classes('aekTree', props.class),
    attr: props.attr,
    onRemoveCmp: () => {
      isRemoved = true;
      removeScheduled?.();
      removeScheduled = null;
      search?.dispose();
      typeahead.clear();
      virtualView?.dispose();
      for (const line of mounted) if (line.kind === 'node' && line.view) disposeRow(line.view);
      for (const row of pool) disposeRow(row);
      pool.length = 0;
      mounted = [];
      model.loads.clear();
    },
  });

  const { countElem, headingTextId } = addCollectionHeader(cmp, {
    block: 'aekTree',
    heading: props.heading,
    headingLevel: props.headingLevel,
  });

  const search = filter?.field
    ? addCollectionSearch(cmp, {
        block: 'aekTree',
        label: filter.fieldLabel,
        placeholder: filter.placeholder,
        query,
        getQuery: () => query,
        onInput: (text) => setQueryFrom(text, true),
        onArrowDown: () => {
          if (!stopElem) return false;
          stopElem.focus();
          return true;
        },
        onEscape: () => setQueryFrom('', true),
      })
    : null;

  const rowsAttr: CMPAttr = { role: 'tree' };
  if (selectionMode === 'multiple') rowsAttr['aria-multiselectable'] = 'true';
  if (headingTextId) rowsAttr['aria-labelledby'] = headingTextId;
  else if (props.label) rowsAttr['aria-label'] = props.label;
  if (virtualImpl) rowsAttr['data-virtual'] = '';
  const rowsCmp = cmp.add({
    idAttr: true,
    class: 'aekTree__rows',
    attr: rowsAttr,
    listeners: [
      { type: 'keydown', fn: onKeyDown },
      { type: 'click', fn: onClick },
      { type: 'focusin', fn: onFocusIn },
    ],
  });
  const rowsElem = rowsCmp.elem;
  search?.elem.setAttribute('aria-controls', rowsCmp.id);

  const emptyParts = addCollectionEmpty(cmp, {
    block: 'aekTree',
    empty: props.empty,
    onClear: () => {
      setQueryFrom('', true);
      (search?.elem ?? stopElem)?.focus();
    },
  });

  const virtualView =
    virtualImpl?.attach(
      rowsElem,
      {
        spacerTag: 'div',
        spacerClass: 'aekTree__spacer',
        rowHeightProperty: '--aek-tree-row-height',
      },
      () => renderLines()
    ) ?? null;

  if (props.selected) selection.set(props.selected);
  setRootsFrom(readRoots(), false);

  if (props.scheduler || props.interval !== undefined) {
    removeScheduled = addScheduledRefresh(
      props.scheduler ?? getPageScheduler(),
      () => setRootsFrom(readRoots(), true),
      {
        interval: props.interval,
        isShown: () => cmp.elem.isConnected && !cmp.elem.closest('[hidden]'),
      }
    );
  }

  return {
    cmp,
    setRoots: (roots) => {
      source = roots;
      setRootsFrom(readRoots(), true);
    },
    setNode: (key, node) => {
      const entry = byKey.get(key);
      if (!entry || getKey(node) !== key) return;
      const isNewNode = entry.node !== node;
      entry.node = node;
      const isTextChanged = model.readEntry(entry);
      if (entry.view) writeRow(entry.view, isNewNode);
      if (!isTextChanged || !model.isFiltering()) return;
      // Its match may have changed: the counts, the rows and the tab stop follow
      const focus = captureFocus();
      model.applyFilter(queryWords, query);
      settle(focus);
    },
    expand: (key) => {
      const entry = byKey.get(key);
      if (entry) setOpen(entry, true, false);
    },
    collapse: (key) => {
      const entry = byKey.get(key);
      if (entry) setOpen(entry, false, false);
    },
    isExpanded: (key) => model.expanded.has(key),
    getExpanded: () => model.getExpanded(),
    reloadChildren: (key) => {
      if (byKey.get(key)?.childMode !== 'lazy') return;
      model.loads.delete(key);
      setRootsFrom(lastRoots, true);
    },
    setSelected: (keys) => {
      selection.set(keys.filter((key) => byKey.has(key)));
      writeSelection();
    },
    getSelected: () => selection.get(),
    setQuery: (next) => setQueryFrom(next, false),
    getQuery: () => query,
    focusKey: (key) => {
      const entry = reveal(key);
      if (entry) focusLine(entry);
    },
    scrollToKey: (key) => {
      const entry = reveal(key);
      if (!entry) return;
      if (virtualView) {
        virtualView.scrollToIndex(entry.shownIndex);
        renderLines();
        return;
      }
      const elem = entry.view?.elem;
      if (!elem) return;
      const top = elem.offsetTop;
      const bottom = top + elem.offsetHeight;
      if (top < rowsElem.scrollTop) rowsElem.scrollTop = top;
      else if (bottom > rowsElem.scrollTop + rowsElem.clientHeight) {
        rowsElem.scrollTop = bottom - rowsElem.clientHeight;
      }
    },
    getKeyAt: (elem) => {
      const line = findLineAt(elem);
      return line?.kind === 'node' ? line.key : null;
    },
    refresh: () => setRootsFrom(readRoots(), true),
  };
};
