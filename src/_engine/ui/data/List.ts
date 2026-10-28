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
import { getQueryWords, matchesWords } from './Filter';
import { createListRows, ROW_CLASS, type ListEntry, type ListMarks, type ListRow } from './ListRow';
import type { List, ListProps } from './ListTypes';
import { useListReorder } from './Reorder';
import { createSelection, getSelectionGesture, type SelectionGesture } from './Selection';
import { useVirtualRows } from './VirtualRows';
import './List.scss';
import '../styles/kit.scss';

/** The page size of PageUp and PageDown when the list doesn't scroll */
const DEFAULT_PAGE_SIZE = 10;

/** Where the focus was in the rows before a change: its entry's key, its cell and its index */
type FocusMark = { key: string; column: number; index: number; elem: HTMLElement };

const defaultGetKey = (item: unknown) => String((item as { id?: unknown }).id);

/**
 * Creates a list (p805 D6): rows of an app's items, each a title with an optional icon, badge,
 * sub title, description, suffix and tooltip (or a CMP of `render`), kept by key, so new items
 * write only what changed. Static (a `<ul>`), selectable (the APG listbox), or with `actions` on
 * every row (the APG grid); filtered by a query with the matches marked. Long lists render only
 * the rows their box shows (`virtual`), and the user can move the rows (`reorder`): both are
 * values the app passes, so a list without them carries neither's code.
 * - Parts: `.aekList`, `.aekList__header` with `__heading` (`__headingText`, `__count`), `__filter`
 *   with `__search`, `.aekList__rows` (`data-mode="static" | "listbox" | "grid"`), a `.aekList__row`
 *   per item (`data-key`, `aria-selected`, `aria-disabled`, `hidden` while filtered out,
 *   `data-dragging`, `data-pinned`) with `__main` (a grid row's first cell), `__handle` (a
 *   reorder's) and `__content`: `__icon`, `__badge`, `__text` (`__subTitle`,
 *   `__title` with `data-placeholder`, `__description`), `__suffix`; a grid row's `__actionCell`s
 *   with an `__action` button each (`aria-pressed`); `.aekList__empty` and `.aekList__noMatch`
 *   (with `__clear`); virtual rows' `__spacer`s, a drag's `__dropLine`. The matches are
 *   `<mark class="aekMark">`s.
 * - Custom properties (read on any ancestor, the token as the fallback): `--aek-list-max-height`
 *   (the rows' box scrolls past it; default none, 12 rows with `virtual`),
 *   `--aek-list-selected-color` (the selected row's bar, default the accent),
 *   `--aek-list-row-height` (virtual rows' height, written by the list once measured).
 * - Keys (a listbox, a grid): the list is one tab stop. Up / Down move between the shown rows (no
 *   wrapping), Home / End to the ends, PageUp / PageDown by the box's height, a letter to the next
 *   title starting with it; Space selects (toggles in a multiple selection), Enter activates (and
 *   selects in a single one); with a multiple selection Shift + a move or a click selects the range
 *   from the last picked row, Ctrl / ⌘ + click toggles and Ctrl / ⌘ + A selects every row (or
 *   none). In a grid, Left / Right move between a row's cells, Up / Down keep the column, and Enter
 *   or Space presses an action. With `reorder`, Alt + ArrowUp / ArrowDown move the focused row.
 *   The search field's ArrowDown enters the list, its Escape empties it. The keys it uses reach no
 *   key binding.
 * - ARIA: `role="listbox"` (`aria-multiselectable`) of `option`s, or `role="grid"` of `row`s and
 *   `gridcell`s, named by the heading or `label`; `aria-selected`, `aria-disabled`; a toggle's
 *   `aria-pressed`; with `virtual`, `aria-setsize` / `aria-posinset` (`aria-rowcount` /
 *   `aria-rowindex` in a grid). A filter's count ("12 of 340", "No matches for …") and a move
 *   ("Lamp moved to 3 of 8") are announced politely.
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
  const virtualImpl = useVirtualRows(props.virtual);
  const reorderImpl = useListReorder(props.reorder);
  const mode =
    actions.length > 0
      ? 'grid'
      : selectionMode !== 'none' || props.onActivate || reorderImpl
        ? 'listbox'
        : 'static';
  const isInteractive = mode !== 'static';
  let source = props.items;
  let entries: ListEntry<T>[] = [];
  /** The entries the filter shows, in order */
  let shown: ListEntry<T>[] = [];
  const byKey = new Map<string, ListEntry<T>>();
  let query = filter?.query ?? '';
  let queryWords = getQueryWords(query);
  const marks: ListMarks = { query, words: queryWords };
  /** The tab stop: an entry's key and its cell (0 the main element, n the nth action) */
  let stopKey: string | null = null;
  let stopColumn = 0;
  /** The element with `tabindex="0"` */
  let stopElem: HTMLElement | null = null;
  /** A row a drag keeps rendered */
  let heldKey: string | null = null;
  /** Virtual rows' rendered entries, and the rows they let go of */
  let mounted: ListEntry<T>[] = [];
  const pool: ListRow<T>[] = [];
  let removeScheduled: (() => void) | null = null;

  const { createEntry, readEntry, createRow, bindRow, writeRow, disposeRow } = createListRows({
    props,
    mode,
    marks,
    hasHandle: Boolean(reorderImpl),
  });
  const selection = createSelection({
    mode: selectionMode,
    getOrder: () => shown.filter((entry) => !entry.text.isDisabled).map((entry) => entry.key),
  });
  const typeahead = createTypeahead({
    getCount: () => entries.length,
    getText: (index) => (entries[index].isShown ? entries[index].foldedTitle : ''),
  });

  // --- The tab stop and the focus ---

  /** An entry's focusable cell (`column` 0 its main element; a hidden action's falls back to it) */
  const getCellElem = (entry: ListEntry<T>, column: number) => {
    const row = entry.view;
    if (!row) return null;
    const cell = column > 0 ? row.actions[column - 1] : null;
    return cell && !cell.isHidden ? cell.button : row.main;
  };

  /** Writes the tab stop's `tabindex` where it is now (a recycled row may have taken the old one) */
  const writeStop = () => {
    const entry = stopKey === null ? undefined : byKey.get(stopKey);
    const next = entry ? getCellElem(entry, stopColumn) : null;
    if (stopElem && stopElem !== next) stopElem.setAttribute('tabindex', '-1');
    next?.setAttribute('tabindex', '0');
    stopElem = next;
  };

  const setStop = (entry: ListEntry<T> | null, column = 0) => {
    stopKey = entry?.key ?? null;
    stopColumn = column;
    writeStop();
  };

  const findEntry = (target: EventTarget | null) => {
    const elem = (target as Element | null)?.closest?.(`.${ROW_CLASS}`);
    if (!elem || elem.parentNode !== rowsCmp.elem) return null;
    return byKey.get(elem.getAttribute('data-key') ?? '') ?? null;
  };

  /** Puts the tab stop on a shown entry when it's on none: the shown one nearest `near` (where a
   * focused row was), else the first selected, else the first */
  const ensureStop = (near: number | null) => {
    if (!isInteractive) return;
    const current = stopKey === null ? undefined : byKey.get(stopKey);
    if (current?.isShown) return;
    let next: ListEntry<T> | null = null;
    if (near !== null) {
      for (let d = 0; d < entries.length && !next; d++) {
        const after = entries[near + d];
        const before = entries[near - d];
        next = after?.isShown ? after : before?.isShown ? before : null;
      }
    }
    next ??= shown.find((entry) => entry.isSelected) ?? shown[0] ?? null;
    setStop(next);
  };

  /** The focus in the rows before a change that may remove, hide or move its row */
  const captureFocus = (): FocusMark | null => {
    const active = document.activeElement as HTMLElement | null;
    if (!active || !rowsCmp.elem.contains(active)) return null;
    const entry = findEntry(active);
    if (!entry) return null;
    const column = entry.view?.actions.findIndex((cell) => cell.button === active) ?? -1;
    return { key: entry.key, column: column + 1, index: entry.index, elem: active };
  };

  /** After the change: the focus back on its cell, or on the tab stop when its row went */
  const restoreFocus = (focus: FocusMark | null) => {
    if (!focus) return;
    const entry = byKey.get(focus.key);
    const elem = entry?.isShown ? getCellElem(entry, focus.column) : null;
    const target = elem ?? stopElem;
    if (target && document.activeElement !== target) target.focus();
  };

  // --- Rendering ---

  /** Lets go of an entry's row: back to the pool (virtual rows) */
  const unmount = (entry: ListEntry<T>) => {
    const row = entry.view;
    if (!row) return;
    entry.view = null;
    row.entry = null;
    row.elem.remove();
    row.elem.removeAttribute('data-pinned');
    row.elem.style.removeProperty('top');
    pool.push(row);
  };

  const mount = (entry: ListEntry<T>) => {
    if (entry.view) return entry.view;
    const row = pool.pop() ?? createRow();
    // A recycled row's focusables were another entry's: none is the stop until `writeStop`
    if (isInteractive) row.main.setAttribute('tabindex', '-1');
    for (const cell of row.actions) cell.button.setAttribute('tabindex', '-1');
    bindRow(row, entry);
    return row;
  };

  /** Every entry's row in the items' order, the filtered out ones hidden */
  const renderAll = () => {
    const elems: HTMLElement[] = [];
    for (const entry of entries) {
      const row = mount(entry);
      writeAttr(row.elem, 'hidden', entry.isShown ? null : '');
      elems.push(row.elem);
    }
    placeElems(rowsCmp.elem, elems);
  };

  /** The rows the box shows, the tab stop's and a dragged one (placed at their offset when out of
   * the window), between the spacers */
  const renderWindow = (view: NonNullable<typeof virtualView>) => {
    const { start, end } = view.getWindow(shown.length);
    const inWindow = shown.slice(start, end);
    const kept = new Set<ListEntry<T>>(inWindow);
    const pinned: ListEntry<T>[] = [];
    for (const key of [stopKey, heldKey]) {
      const entry = key === null ? undefined : byKey.get(key);
      if (!entry?.isShown || kept.has(entry)) continue;
      kept.add(entry);
      pinned.push(entry);
    }
    for (const entry of mounted) if (!kept.has(entry)) unmount(entry);
    mounted = [...kept];
    const height = view.getRowHeight();
    const elems: HTMLElement[] = [view.top];
    for (const entry of mounted) {
      const { elem } = mount(entry);
      const isPinned = entry.shownIndex < start || entry.shownIndex >= end;
      writeAttr(elem, 'data-pinned', isPinned ? '' : null);
      if (isPinned) elem.style.top = `${entry.shownIndex * height}px`;
      else elem.style.removeProperty('top');
      if (mode === 'grid') writeAttr(elem, 'aria-rowindex', String(entry.shownIndex + 1));
      else {
        writeAttr(elem, 'aria-setsize', String(shown.length));
        writeAttr(elem, 'aria-posinset', String(entry.shownIndex + 1));
      }
      if (!isPinned) elems.push(elem);
    }
    elems.push(view.bottom);
    for (const entry of pinned) elems.push((entry.view as ListRow<T>).elem);
    placeElems(rowsCmp.elem, elems);
    if (mode === 'grid') writeAttr(rowsCmp.elem, 'aria-rowcount', String(shown.length));
    view.layout(shown.length, start, end);
    // The first row shown gives the height when none was given: the window again with it
    const first = mounted[0]?.view;
    if (first && view.measure(first.elem)) renderWindow(view);
  };

  const renderRows = () => {
    if (virtualView) renderWindow(virtualView);
    else renderAll();
    writeStop();
  };

  // --- The list's state: filter, selection, count ---

  const isMatch = (entry: ListEntry<T>) => {
    if (!queryWords.length) return true;
    if (filter?.match) return filter.match(entry.item, query);
    return matchesWords(entry.folded, queryWords);
  };

  /** Matches every entry against the query (a rendered row's marks rewritten for a new one) */
  const applyFilter = () => {
    shown = [];
    for (const entry of entries) {
      const row = entry.view;
      if (row && !props.render && row.written.query !== query) writeRow(row, false);
      entry.isShown = isMatch(entry);
      entry.shownIndex = entry.isShown ? shown.length : -1;
      if (entry.isShown) shown.push(entry);
    }
    writeCollectionCount(countElem, shown.length, entries.length, queryWords.length > 0);
    emptyParts.write(rowsCmp.elem, entries.length, shown.length, query);
  };

  /** Writes each entry's selected state where it changed */
  const writeSelection = () => {
    for (const entry of entries) {
      const isSelected = selection.has(entry.key);
      if (entry.isSelected === isSelected) continue;
      entry.isSelected = isSelected;
      if (entry.view) writeRow(entry.view, false);
    }
  };

  /** After the entries or the query changed: the tab stop, the rows, the focus */
  const settle = (focus: FocusMark | null) => {
    ensureStop(focus ? Math.min(focus.index, entries.length - 1) : null);
    renderRows();
    restoreFocus(focus);
  };

  const setRowsFrom = (items: readonly T[], report: boolean) => {
    const focus = captureFocus();
    const next: ListEntry<T>[] = [];
    const seen = new Set<string>();
    for (const item of items) {
      const key = getKey(item);
      if (seen.has(key)) continue;
      seen.add(key);
      let entry = byKey.get(key);
      if (entry) {
        const isNewItem = entry.item !== item;
        entry.item = item;
        readEntry(entry);
        if (entry.view) writeRow(entry.view, isNewItem);
      } else {
        entry = createEntry(key, item);
        byKey.set(key, entry);
      }
      entry.index = next.length;
      next.push(entry);
    }
    for (const entry of entries) {
      if (seen.has(entry.key)) continue;
      byKey.delete(entry.key);
      if (virtualView) unmount(entry);
      else if (entry.view) disposeRow(entry.view);
    }
    if (virtualView) mounted = mounted.filter((entry) => seen.has(entry.key));
    entries = next;
    applyFilter();
    const changed = selection.retain((key) => byKey.has(key));
    writeSelection();
    if (changed && report) props.onSelectionChange?.(selection.get());
    settle(focus);
  };

  const readItems = () => (typeof source === 'function' ? source() : source);

  // --- The user's input ---

  const reportSelection = () => {
    writeSelection();
    props.onSelectionChange?.(selection.get());
  };

  const pick = (entry: ListEntry<T>, gesture: SelectionGesture) => {
    if (entry.text.isDisabled || selectionMode === 'none') return;
    if (selection.pick(entry.key, gesture)) reportSelection();
  };

  const activate = (entry: ListEntry<T>) => {
    if (entry.text.isDisabled) return;
    if (selectionMode === 'single') pick(entry, 'replace');
    props.onActivate?.(entry.item, entry.key);
  };

  /** Focuses an entry's cell, rendering it first (virtual rows scroll to it) */
  const focusRow = (entry: ListEntry<T>, column = 0) => {
    virtualView?.scrollToIndex(entry.shownIndex);
    stopKey = entry.key;
    stopColumn = column;
    renderRows();
    stopElem?.focus();
  };

  /** The page size: the rows that fit the box when it scrolls */
  const getPageSize = (entry: ListEntry<T>) => {
    if (virtualView) return virtualView.getPageSize();
    const box = rowsCmp.elem;
    const height = entry.view?.elem.offsetHeight;
    if (!height || !(box.scrollHeight > box.clientHeight)) return DEFAULT_PAGE_SIZE;
    return Math.max(1, Math.floor(box.clientHeight / height));
  };

  const onKeyDown = (e: Event) => {
    const ke = e as KeyboardEvent;
    const entry = findEntry(e.target);
    const row = entry?.view;
    if (!entry || !row) return;
    const target = e.target as HTMLElement;
    const actionIndex = row.actions.findIndex((cell) => cell.button === target);
    const column = actionIndex + 1;
    const { key } = ke;
    const isMod = ke.ctrlKey || ke.metaKey;

    if (reorderView?.onKeyDown(ke, entry.key)) {
      useCollectionKey(ke);
      return;
    }
    if (isMod && !ke.altKey && key.toLowerCase() === 'a' && selectionMode === 'multiple') {
      useCollectionKey(ke);
      if (selection.all()) reportSelection();
      return;
    }
    if (mode === 'grid' && (key === 'ArrowLeft' || key === 'ArrowRight') && !isMod) {
      useCollectionKey(ke);
      const cells = [row.main, ...row.actions.filter((c) => !c.isHidden).map((c) => c.button)];
      const next = cells[cells.indexOf(target) + (key === 'ArrowRight' ? 1 : -1)];
      if (next) {
        setStop(entry, next === row.main ? 0 : Number(next.getAttribute('data-action')) + 1);
        next.focus();
      }
      return;
    }
    if (!ke.altKey && !isMod) {
      const next = getMoveTarget(key, entry.index, {
        count: entries.length,
        pageSize: key.startsWith('Page') ? getPageSize(entry) : undefined,
        isSkipped: (index) => !entries[index].isShown,
      });
      if (next !== null) {
        useCollectionKey(ke);
        if (next === -1) return;
        const to = entries[next];
        focusRow(to, column);
        if (ke.shiftKey && selectionMode === 'multiple') pick(to, 'range');
        return;
      }
    }
    if (actionIndex !== -1) return;
    if (key === ' ' && !isMod) {
      useCollectionKey(ke);
      pick(entry, getSelectionGesture(ke, selectionMode === 'multiple'));
      return;
    }
    if (key === 'Enter' && !isMod && !ke.shiftKey) {
      useCollectionKey(ke);
      activate(entry);
      return;
    }
    if (isTypeaheadKey(ke) && key !== ' ') {
      useCollectionKey(ke);
      const index = typeahead.type(key, entry.index);
      if (index !== -1) focusRow(entries[index]);
    }
  };

  const onClick = (e: Event) => {
    const entry = findEntry(e.target);
    if (!entry) return;
    const button = (e.target as Element).closest('.aekList__action');
    if (button) {
      const index = Number(button.getAttribute('data-action'));
      const cell = entry.view?.actions[index];
      if (!cell || cell.isDisabled) return;
      actions[index].onPress(entry.item, entry.key);
      // Its item read again: an action that changed it in place shows it
      readEntry(entry);
      if (entry.view) writeRow(entry.view, false);
      return;
    }
    if (entry.text.isDisabled) return;
    const me = e as MouseEvent;
    pick(entry, getSelectionGesture(me));
    if (!me.shiftKey && !me.ctrlKey && !me.metaKey) props.onActivate?.(entry.item, entry.key);
  };

  const onFocusIn = (e: Event) => {
    const target = e.target as HTMLElement;
    const entry = findEntry(target);
    const row = entry?.view;
    if (!entry || !row) return;
    if (target === row.main) setStop(entry, 0);
    else {
      const index = row.actions.findIndex((cell) => cell.button === target);
      if (index !== -1) setStop(entry, index + 1);
    }
  };

  const setQueryFrom = (next: string, byUser: boolean) => {
    if (next === query) return;
    const focus = captureFocus();
    query = next;
    queryWords = getQueryWords(next);
    marks.query = query;
    marks.words = queryWords;
    search?.setValue(next);
    applyFilter();
    settle(focus);
    if (queryWords.length) {
      announce(
        cmp.elem,
        shown.length ? `${shown.length} of ${entries.length}` : `No matches for ${query.trim()}`
      );
    }
    search?.syncEscapeEntry();
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
      search?.dispose();
      typeahead.clear();
      reorderView?.dispose();
      virtualView?.dispose();
      for (const entry of entries) if (entry.view) disposeRow(entry.view);
      for (const row of pool) disposeRow(row);
      pool.length = 0;
      entries = [];
      shown = [];
      mounted = [];
      byKey.clear();
    },
  });

  const { countElem, headingTextId } = addCollectionHeader(cmp, {
    block: 'aekList',
    heading: props.heading,
    headingLevel: props.headingLevel,
  });

  const search = filter?.field
    ? addCollectionSearch(cmp, {
        block: 'aekList',
        label: filter.fieldLabel,
        placeholder: filter.placeholder,
        query,
        getQuery: () => query,
        onInput: (text) => setQueryFrom(text, true),
        onArrowDown: () => {
          if (!stopElem || !shown.length) return false;
          stopElem.focus();
          return true;
        },
        onEscape: () => setQueryFrom('', true),
      })
    : null;

  const rowsAttr: CMPAttr = { 'data-mode': mode };
  if (isInteractive) {
    rowsAttr.role = mode;
    if (selectionMode === 'multiple') rowsAttr['aria-multiselectable'] = 'true';
  }
  if (headingTextId) rowsAttr['aria-labelledby'] = headingTextId;
  else if (props.label) rowsAttr['aria-label'] = props.label;
  if (virtualImpl) rowsAttr['data-virtual'] = '';
  if (reorderImpl) rowsAttr['data-reorder'] = '';
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
  search?.elem.setAttribute('aria-controls', rowsCmp.id);

  const emptyParts = addCollectionEmpty(cmp, {
    block: 'aekList',
    empty: props.empty,
    onClear: () => {
      setQueryFrom('', true);
      (search?.elem ?? stopElem)?.focus();
    },
  });

  const virtualView =
    virtualImpl?.attach(
      rowsCmp.elem,
      {
        spacerTag: mode === 'static' ? 'li' : 'div',
        spacerClass: 'aekList__spacer',
        rowHeightProperty: '--aek-list-row-height',
      },
      () => renderRows()
    ) ?? null;
  const reorderView =
    reorderImpl?.attach({
      root: cmp.elem,
      box: rowsCmp.elem,
      getKeys: () => entries.map((entry) => entry.key),
      canMove: (key) => !queryWords.length && byKey.get(key)?.text.isDisabled === false,
      keyAt: (elem) => findEntry(elem)?.key ?? null,
      getRendered: () =>
        shown.flatMap((entry) => (entry.view ? [{ key: entry.key, elem: entry.view.elem }] : [])),
      holdRow: (key) => {
        heldKey = key;
        if (virtualView) renderRows();
      },
      move: (key, to) => {
        const items = entries.map((entry) => entry.item);
        const from = byKey.get(key)?.index ?? -1;
        if (from === -1) return;
        items.splice(to, 0, ...items.splice(from, 1));
        setRowsFrom(items, false);
      },
      getTitle: (key) => byKey.get(key)?.text.title ?? key,
    }) ?? null;

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
      const entry = byKey.get(key);
      if (!entry || getKey(item) !== key) return;
      const isNewItem = entry.item !== item;
      entry.item = item;
      const isTextChanged = readEntry(entry);
      if (entry.view) writeRow(entry.view, isNewItem);
      if (!isTextChanged || isMatch(entry) === entry.isShown) return;
      // Its match changed: the counts, the rows and the tab stop follow
      const focus = captureFocus();
      applyFilter();
      settle(focus);
    },
    setSelected: (keys) => {
      selection.set(keys.filter((key) => byKey.has(key)));
      writeSelection();
    },
    getSelected: () => selection.get(),
    setQuery: (next) => setQueryFrom(next, false),
    getQuery: () => query,
    focusKey: (key) => {
      const entry = byKey.get(key);
      if (entry?.isShown) focusRow(entry);
    },
    scrollToKey: (key) => {
      const entry = byKey.get(key);
      if (!entry?.isShown) return;
      if (virtualView) {
        virtualView.scrollToIndex(entry.shownIndex);
        renderRows();
        return;
      }
      const elem = entry.view?.elem;
      if (!elem) return;
      const box = rowsCmp.elem;
      const top = elem.offsetTop;
      const bottom = top + elem.offsetHeight;
      if (top < box.scrollTop) box.scrollTop = top;
      else if (bottom > box.scrollTop + box.clientHeight) box.scrollTop = bottom - box.clientHeight;
    },
    getKeyAt: (elem) => findEntry(elem)?.key ?? null,
    refresh: () => setRowsFrom(readItems(), true),
  };
};
