// What the collections (the list and the tree; the table later) share around their rows (p805 D3,
// D6): the heading with its count, the filter's search field, the empty and no match lines, and
// putting the rows' elements in order. The classes are each piece's own (`aekList__search`,
// `aekTree__search`: `block` names them), and `CollectionParts.scss` styles them all.
import type { CMPHandle } from '../core/CMPTypes';
import { pushOverlay, swallowNextKeyUp } from '../overlays/OverlayStack';
import './CollectionParts.scss';
import '../styles/kit.scss';

/**
 * An element with its class.
 * @internal
 */
export const createElem = (tag: string, className: string) => {
  const elem = document.createElement(tag);
  elem.className = className;
  return elem;
};

/**
 * Writes an attribute only when it changes; `null` removes it.
 * @internal
 */
export const writeAttr = (elem: Element, name: string, value: string | null) => {
  if (value === null) {
    if (elem.hasAttribute(name)) elem.removeAttribute(name);
  } else if (elem.getAttribute(name) !== value) elem.setAttribute(name, value);
};

/**
 * Uses a key up: no default, no further listener, its keyup swallowed.
 * @internal
 */
export const useCollectionKey = (e: KeyboardEvent) => {
  e.preventDefault();
  e.stopPropagation();
  swallowNextKeyUp(e.key);
};

/**
 * Puts `elems` in `parent` in this order, moving only those out of place. The one holding the
 * focus stays put and the others move around it: a moved element loses the focus, and one given
 * back by script shows no focus ring in Chromium.
 * @internal
 */
export const placeElems = (parent: HTMLElement, elems: readonly HTMLElement[]) => {
  const active = document.activeElement;
  const at = active ? elems.findIndex((elem) => elem.contains(active)) : -1;
  if (at === -1 || elems[at].parentNode !== parent) {
    let cursor = parent.firstElementChild;
    for (const elem of elems) {
      if (elem === cursor) cursor = cursor.nextElementSibling;
      else parent.insertBefore(elem, cursor);
    }
    return;
  }
  let ref: HTMLElement = elems[at];
  for (let i = at - 1; i >= 0; i--) {
    if (elems[i].nextElementSibling !== ref) parent.insertBefore(elems[i], ref);
    ref = elems[i];
  }
  ref = elems[at];
  for (let i = at + 1; i < elems.length; i++) {
    if (ref.nextElementSibling !== elems[i]) parent.insertBefore(elems[i], ref.nextSibling);
    ref = elems[i];
  }
};

/**
 * A collection's heading: its text, its level (a paragraph without one), and the piece's class
 * prefix (`aekList`).
 * @internal
 */
export type CollectionHeaderProps = {
  block: string;
  heading?: string;
  headingLevel?: 2 | 3 | 4 | 5 | 6;
};

/**
 * Adds the heading with its count (`__header`, `__heading`, `__headingText`, `__count`) when
 * there's a `heading`.
 * @internal
 * @returns the count's element and the heading text's id, which names the rows (both null
 * without a heading)
 */
export const addCollectionHeader = (
  cmp: CMPHandle,
  { block, heading, headingLevel }: CollectionHeaderProps
) => {
  if (heading === undefined) return { countElem: null, headingTextId: null };
  const header = cmp.add({ class: `${block}__header` });
  const headingElem = createElem(headingLevel ? `h${headingLevel}` : 'p', `${block}__heading`);
  const text = createElem('span', `${block}__headingText`);
  text.textContent = heading;
  const headingTextId = `${cmp.id}-heading`;
  text.id = headingTextId;
  const countElem = createElem('span', `${block}__count`);
  headingElem.append(text, ' ', countElem);
  header.elem.append(headingElem);
  return { countElem, headingTextId };
};

/**
 * Writes the count: the total, or "12 of 340" while a query filters.
 * @internal
 */
export const writeCollectionCount = (
  countElem: HTMLElement | null,
  shown: number,
  total: number,
  isFiltered: boolean
) => {
  if (!countElem) return;
  const text = isFiltered ? `${shown} of ${total}` : String(total);
  if (countElem.textContent !== text) countElem.textContent = text;
};

/**
 * What a collection's search field reads and calls.
 * @internal
 */
export type CollectionSearchProps = {
  block: string;
  /** Its accessible name and placeholder (default 'Filter') */
  label?: string;
  placeholder?: string;
  /** The query at the start */
  query: string;
  /** The collection's query now (its Escape empties one) */
  getQuery: () => string;
  /** The user's text */
  onInput: (text: string) => void;
  /** ArrowDown: the focus into the rows (whether it went) */
  onArrowDown: () => boolean;
  /** Escape with a query: empty it */
  onEscape: () => void;
};

/**
 * Adds the search field above the rows (`__filter`, `__search`): a searchbox whose ArrowDown
 * enters the rows and whose Escape empties a query, through an overlay stack entry while it has
 * a query and the focus (so a dialog around it stays open).
 * @internal
 * @returns the input, `setValue` (code's query: no input event), `syncEscapeEntry` (after a query
 * change) and `dispose` (the stack entry)
 */
export const addCollectionSearch = (cmp: CMPHandle, props: CollectionSearchProps) => {
  let removeEscapeEntry: ((returnFocus?: boolean) => void) | null = null;

  const syncEscapeEntry = () => {
    const isWanted = Boolean(props.getQuery() && document.activeElement === elem);
    if (isWanted && !removeEscapeEntry) {
      removeEscapeEntry = pushOverlay({ elem, close: () => props.onEscape() });
    } else if (!isWanted && removeEscapeEntry) {
      removeEscapeEntry(false);
      removeEscapeEntry = null;
    }
  };

  const onKeyDown = (e: Event) => {
    const ke = e as KeyboardEvent;
    if (ke.key === 'ArrowDown') {
      if (props.onArrowDown()) useCollectionKey(ke);
    } else if (ke.key === 'Escape' && props.getQuery()) {
      // Outside a HUD root (the overlay stack's entry takes it first under one)
      useCollectionKey(ke);
      props.onEscape();
    }
  };

  const elem = cmp.add({ class: `${props.block}__filter` }).add({
    tag: 'input',
    class: `${props.block}__search`,
    attr: {
      // Not type="search": the browsers' own clear button and Escape differ (the text field's)
      type: 'text',
      role: 'searchbox',
      'aria-label': props.label ?? 'Filter',
      placeholder: props.placeholder ?? 'Filter',
      autocomplete: 'off',
      spellcheck: 'false',
    },
    listeners: [
      { type: 'input', fn: () => props.onInput(elem.value) },
      { type: 'keydown', fn: onKeyDown },
      { type: 'focus', fn: () => syncEscapeEntry() },
      { type: 'blur', fn: () => syncEscapeEntry() },
    ],
  }).elem as HTMLInputElement;
  elem.value = props.query;

  return {
    elem,
    setValue: (text: string) => {
      if (elem.value !== text) elem.value = text;
    },
    syncEscapeEntry,
    dispose: () => {
      removeEscapeEntry?.(false);
      removeEscapeEntry = null;
    },
  };
};

/**
 * Adds the empty line (`__empty`: `empty`'s text, or its CMP, removed with the collection) and the
 * no match line (`__noMatch`: its text and a "Clear the filter" button, `__clear`, calling
 * `onClear`).
 * @internal
 * @returns `write(rows, total, shown, query)`: the rows, the empty line or the no match line shown
 * by the counts
 */
export const addCollectionEmpty = (
  cmp: CMPHandle,
  { block, empty, onClear }: { block: string; empty?: string | CMPHandle; onClear: () => void }
) => {
  const emptyCmp = cmp.add({ class: `${block}__empty` });
  if (typeof empty === 'string') {
    emptyCmp.add({ tag: 'p', class: `${block}__emptyText`, text: empty });
  } else if (empty) emptyCmp.add(empty);
  const emptyElem = emptyCmp.elem;
  const noMatchCmp = cmp.add({ class: `${block}__noMatch` });
  const noMatchElem = noMatchCmp.elem;
  const noMatchText = noMatchCmp.add({ tag: 'p', class: `${block}__noMatchText` }).elem;
  noMatchCmp.add({
    tag: 'button',
    class: `${block}__clear`,
    text: 'Clear the filter',
    attr: { type: 'button' },
    onClick: onClear,
  });

  return {
    write: (rows: HTMLElement, total: number, shown: number, query: string) => {
      writeAttr(rows, 'hidden', shown ? null : '');
      writeAttr(emptyElem, 'hidden', total ? '' : null);
      writeAttr(noMatchElem, 'hidden', total && !shown ? null : '');
      if (!total || shown) return;
      const text = `No matches for “${query}”`;
      if (noMatchText.textContent !== text) noMatchText.textContent = text;
    },
  };
};
