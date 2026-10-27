// What every collection selects with (p805 D3): the list's now, the table's and the tree's later.
// Keys only, no DOM: the collection writes `aria-selected` from `has`, and reports `get()` after a
// user's gesture changed it.

/** What a collection's user can select (a list's `selection`): nothing, one row, or several
 * (Ctrl / ⌘ and Shift). */
export type SelectionMode = 'none' | 'single' | 'multiple';

/**
 * A user's selection gesture: `replace` (a click, Space in a single selection), `toggle` (Ctrl / ⌘ +
 * click, Space in a multiple one) or `range` (Shift + click, Shift + an arrow: from the anchor to
 * the key, in place of the selection).
 * @internal
 */
export type SelectionGesture = 'replace' | 'toggle' | 'range';

/**
 * What `createSelection` reads.
 * @internal
 */
export type SelectionProps = {
  mode: SelectionMode;
  /** The keys a range or "all" can take, in the collection's order: the shown rows that aren't
   * disabled. Read on a range, `all` and `get`, never per frame. */
  getOrder: () => readonly string[];
};

/**
 * A collection's selected keys and its anchor (where a range starts: the last key a `replace` or a
 * `toggle` picked). A single selection holds one key at most, and every gesture is a `replace`.
 * @internal
 * @returns `has`, `get` (the keys in the collection's order, then any not in it), `set` (from
 * code: no anchor moved for a kept key), `pick(key, gesture)` and `all()` (Ctrl / ⌘ + A: every key
 * of the order, or none when they all were), each returning whether the selection changed, and
 * `retain(isKept)`, which drops the keys a new set of rows doesn't keep (whether any went)
 */
export const createSelection = ({ mode, getOrder }: SelectionProps) => {
  const keys = new Set<string>();
  let anchor: string | null = null;

  const replaceWith = (next: readonly string[]) => {
    const changed = next.length !== keys.size || next.some((key) => !keys.has(key));
    keys.clear();
    for (const key of next) keys.add(key);
    return changed;
  };

  const get = () => {
    if (keys.size < 2) return [...keys];
    const ordered = getOrder().filter((key) => keys.has(key));
    if (ordered.length === keys.size) return ordered;
    const inOrder = new Set(ordered);
    for (const key of keys) if (!inOrder.has(key)) ordered.push(key);
    return ordered;
  };

  const set = (next: readonly string[]) => {
    if (mode === 'none') return false;
    const changed = replaceWith(mode === 'single' ? next.slice(0, 1) : next);
    if (anchor === null || !keys.has(anchor)) anchor = next[next.length - 1] ?? null;
    return changed;
  };

  const pick = (key: string, gesture: SelectionGesture) => {
    if (mode === 'none') return false;
    if (mode === 'single' || gesture === 'replace') {
      anchor = key;
      return replaceWith([key]);
    }
    if (gesture === 'toggle') {
      anchor = key;
      if (keys.has(key)) keys.delete(key);
      else keys.add(key);
      return true;
    }
    const order = getOrder();
    const to = order.indexOf(key);
    const from = anchor === null ? -1 : order.indexOf(anchor);
    if (to === -1) return false;
    if (from === -1) {
      anchor = key;
      return replaceWith([key]);
    }
    return replaceWith(order.slice(Math.min(from, to), Math.max(from, to) + 1));
  };

  const all = () => {
    if (mode !== 'multiple') return false;
    const order = getOrder();
    const isAll = order.length > 0 && order.every((key) => keys.has(key));
    return replaceWith(isAll ? [] : order);
  };

  const retain = (isKept: (key: string) => boolean) => {
    let changed = false;
    for (const key of keys) {
      if (isKept(key)) continue;
      keys.delete(key);
      changed = true;
    }
    if (anchor !== null && !isKept(anchor)) anchor = null;
    return changed;
  };

  return { has: (key: string) => keys.has(key), get, set, pick, all, retain };
};

/**
 * The gesture a click or a key makes from its modifiers: Shift a range, Ctrl / ⌘ a toggle, none
 * a replace (`toggleByDefault`: Space in a multiple selection toggles without Ctrl).
 * @internal
 */
export const getSelectionGesture = (
  e: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean },
  toggleByDefault = false
): SelectionGesture =>
  e.shiftKey ? 'range' : e.ctrlKey || e.metaKey || toggleByDefault ? 'toggle' : 'replace';
