// What every composite of the kit moves its focus with (p805 D4): the arrows' target, the
// typeahead and the roving tab stop. The menu's keys and typeahead and the button group's tab stop
// moved here unchanged; the list, the tree and the tabs build on it. No DOM but the tab stop's.

/** How long typed letters make one search (the APG's typeahead) */
const TYPEAHEAD_MS = 500;

const ARROWS = {
  vertical: { next: 'ArrowDown', previous: 'ArrowUp' },
  horizontal: { next: 'ArrowRight', previous: 'ArrowLeft' },
};

/**
 * How `getMoveTarget` moves.
 * @internal
 */
export type MoveOptions = {
  /** The items' count */
  count: number;
  /** Which arrows move: Down / Up, or Right / Left (default 'vertical') */
  orientation?: 'vertical' | 'horizontal';
  /** Whether an arrow past an end goes round to the other one (a menu, tabs, a toolbar), or stays
   * (a list, a tree). Default false. */
  wrap?: boolean;
  /** How far PageUp and PageDown move, never wrapping (none: they aren't move keys) */
  pageSize?: number;
  /** An item the keys pass over (a disabled button); none skipped by default */
  isSkipped?: (index: number) => boolean;
};

/** The first item from `from` (excluded) in `dir`'s direction that isn't skipped (-1: none) */
const findFrom = (from: number, dir: 1 | -1, options: MoveOptions) => {
  const { count, wrap = false, isSkipped } = options;
  // From nowhere, the previous item is the last one
  const start = from < 0 && dir === -1 ? count : from;
  for (let k = 1; k <= count; k++) {
    let index = start + dir * k;
    if (wrap) index = ((index % count) + count) % count;
    else if (index < 0 || index >= count) return -1;
    if (!isSkipped?.(index)) return index;
  }
  return -1;
};

/** The item nearest `target` that isn't skipped, looking back toward `from` (-1: none) */
const findNearPage = (target: number, from: number, options: MoveOptions) => {
  const dir = target > from ? -1 : 1;
  for (let index = target; index !== from; index += dir) {
    if (!options.isSkipped?.(index)) return index;
  }
  return -1;
};

/**
 * Where a key moves the focus from the item at `from` (-1: none focused): the arrows along the
 * orientation to the next or previous item, Home and End to the first and last, PageUp and
 * PageDown by `pageSize`, each passing over the skipped items.
 * @internal
 * @returns the item's index; -1 for a move key with nowhere to go (an end without `wrap`, every
 * item skipped), which the caller still uses up; null for any other key
 */
export const getMoveTarget = (key: string, from: number, options: MoveOptions) => {
  const { count, orientation = 'vertical', pageSize } = options;
  const arrows = ARROWS[orientation];
  let target: number;
  if (key === arrows.next) target = findFrom(from, 1, options);
  else if (key === arrows.previous) target = findFrom(from, -1, options);
  else if (key === 'Home') target = findFrom(-1, 1, { ...options, wrap: false });
  else if (key === 'End') target = findFrom(count, -1, { ...options, wrap: false });
  else if (pageSize !== undefined && (key === 'PageDown' || key === 'PageUp')) {
    if (count === 0) return -1;
    const page = key === 'PageDown' ? pageSize : -pageSize;
    const to = Math.min(count - 1, Math.max(0, Math.max(from, 0) + page));
    target = findNearPage(to, from, options);
  } else return null;
  return count === 0 ? -1 : target;
};

/**
 * What `createTypeahead` reads its items with.
 * @internal
 */
export type TypeaheadProps = {
  /** The items' count now */
  getCount: () => number;
  /** An item's text, lowercased (its label) */
  getText: (index: number) => string;
};

/**
 * The APG's typeahead: letters typed within 500 ms make one search for the next item whose text
 * starts with them. One letter, or one typed again (`ss`), looks past the focused item, so
 * pressing it again goes on to the next; more letters include it. The search goes round.
 * @internal
 * @returns `type(letter, from)`, which adds a letter and returns the item to focus (-1: none), and
 * `clear()`, which ends the search and its timer (on a close, a removal)
 */
export const createTypeahead = ({ getCount, getText }: TypeaheadProps) => {
  let typed = '';
  let timer: ReturnType<typeof setTimeout> | null = null;
  const clear = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    typed = '';
  };
  const find = (from: number) => {
    const count = getCount();
    const needle = /^(.)\1*$/.test(typed) ? typed[0] : typed;
    const start = needle.length === 1 ? 1 : 0;
    for (let k = start; k < count + start; k++) {
      const index = (from + k) % count;
      if (getText(index).startsWith(needle)) return index;
    }
    return -1;
  };
  const type = (letter: string, from: number) => {
    if (timer) clearTimeout(timer);
    typed += letter.toLowerCase();
    timer = setTimeout(clear, TYPEAHEAD_MS);
    return find(from);
  };
  return { type, clear };
};

/**
 * Whether a keydown types a letter for the typeahead: one printable character, without Ctrl, ⌘ or
 * Alt (Space is one: a piece that uses Space checks it first).
 * @internal
 */
export const isTypeaheadKey = (e: KeyboardEvent) =>
  e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey;

/**
 * What `createRovingTabStop` keeps the tab stop over.
 * @internal
 */
export type RovingTabStopProps = {
  /** The items now, in order */
  getElems: () => readonly HTMLElement[];
  /** The item holding an event's target (-1: none); default a search of `getElems()` */
  indexOf?: (target: Node) => number;
};

/**
 * A composite's one tab stop (the APG's roving `tabindex`): its item at `tabindex="0"`, the
 * others at -1, so Tab enters the composite once and comes back to the item last focused.
 * @internal
 * @returns `reset(index)` writes every item's `tabindex` (at creation, after the items changed:
 * -1 leaves no tab stop); `setIndex(index)` moves the stop, writing only the old item and the new
 * one; `getIndex()`; and `onFocusIn`, the composite's `focusin` listener, which moves the stop to
 * an item the focus reached another way (a click, code)
 */
export const createRovingTabStop = ({ getElems, indexOf }: RovingTabStopProps) => {
  let current: HTMLElement | null = null;
  let currentIndex = -1;

  const findIndex =
    indexOf ?? ((target: Node) => getElems().findIndex((elem) => elem.contains(target)));

  const setIndex = (index: number) => {
    const elem = getElems()[index] ?? null;
    currentIndex = elem ? index : -1;
    if (elem === current) return;
    current?.setAttribute('tabindex', '-1');
    elem?.setAttribute('tabindex', '0');
    current = elem;
  };

  const reset = (index: number) => {
    const elems = getElems();
    for (let i = 0; i < elems.length; i++) {
      elems[i].setAttribute('tabindex', i === index ? '0' : '-1');
    }
    current = elems[index] ?? null;
    currentIndex = current ? index : -1;
  };

  const onFocusIn = (e: Event) => {
    const index = e.target ? findIndex(e.target as Node) : -1;
    if (index !== -1) setIndex(index);
  };

  return { reset, setIndex, getIndex: () => currentIndex, onFocusIn };
};
