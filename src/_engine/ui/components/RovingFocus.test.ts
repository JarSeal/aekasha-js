import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { stubKitDomAsync } from '../testing/KitDom';
import { createRovingTabStop, createTypeahead, getMoveTarget, isTypeaheadKey } from './RovingFocus';

beforeAll(async () => {
  await stubKitDomAsync();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('getMoveTarget (p805 D4)', () => {
  it('moves along the orientation’s arrows only', () => {
    expect(getMoveTarget('ArrowDown', 1, { count: 4 })).toBe(2);
    expect(getMoveTarget('ArrowUp', 1, { count: 4 })).toBe(0);
    expect(getMoveTarget('ArrowRight', 1, { count: 4 })).toBeNull();
    expect(getMoveTarget('ArrowRight', 1, { count: 4, orientation: 'horizontal' })).toBe(2);
    expect(getMoveTarget('ArrowDown', 1, { count: 4, orientation: 'horizontal' })).toBeNull();
    expect(getMoveTarget('a', 1, { count: 4 })).toBeNull();
  });

  it('wraps at the ends with `wrap`, else has nowhere to go (-1)', () => {
    expect(getMoveTarget('ArrowDown', 3, { count: 4, wrap: true })).toBe(0);
    expect(getMoveTarget('ArrowUp', 0, { count: 4, wrap: true })).toBe(3);
    expect(getMoveTarget('ArrowDown', 3, { count: 4 })).toBe(-1);
    expect(getMoveTarget('ArrowUp', 0, { count: 4 })).toBe(-1);
  });

  it('from nowhere (-1): the next is the first, the previous the last', () => {
    expect(getMoveTarget('ArrowDown', -1, { count: 4 })).toBe(0);
    expect(getMoveTarget('ArrowUp', -1, { count: 4 })).toBe(3);
    expect(getMoveTarget('ArrowUp', -1, { count: 4, wrap: true })).toBe(3);
  });

  it('Home and End go to the ends, never wrapping', () => {
    expect(getMoveTarget('Home', 2, { count: 4, wrap: true })).toBe(0);
    expect(getMoveTarget('End', 2, { count: 4, wrap: true })).toBe(3);
  });

  it('passes over the skipped items, the ends’ keys too', () => {
    const isSkipped = (index: number) => index === 0 || index === 2 || index === 4;
    const options = { count: 5, isSkipped };
    expect(getMoveTarget('ArrowDown', 1, options)).toBe(3);
    expect(getMoveTarget('ArrowDown', 3, options)).toBe(-1);
    expect(getMoveTarget('ArrowDown', 3, { ...options, wrap: true })).toBe(1);
    expect(getMoveTarget('Home', 3, options)).toBe(1);
    expect(getMoveTarget('End', 1, options)).toBe(3);
    expect(getMoveTarget('Home', 3, { count: 3, isSkipped: () => true })).toBe(-1);
  });

  it('PageUp and PageDown move by `pageSize`, clamped, to the nearest item not skipped', () => {
    const options = { count: 30, pageSize: 10 };
    expect(getMoveTarget('PageDown', 3, options)).toBe(13);
    expect(getMoveTarget('PageDown', 25, options)).toBe(29);
    expect(getMoveTarget('PageUp', 5, options)).toBe(0);
    expect(getMoveTarget('PageDown', -1, options)).toBe(10);
    expect(getMoveTarget('PageDown', 3, { ...options, isSkipped: (i) => i >= 12 })).toBe(11);
    expect(getMoveTarget('PageDown', 29, options)).toBe(-1);
    // Without `pageSize` they aren't move keys (a menu)
    expect(getMoveTarget('PageDown', 3, { count: 30 })).toBeNull();
  });

  it('has nowhere to go without items', () => {
    expect(getMoveTarget('ArrowDown', -1, { count: 0, wrap: true })).toBe(-1);
    expect(getMoveTarget('End', -1, { count: 0 })).toBe(-1);
    expect(getMoveTarget('PageDown', -1, { count: 0, pageSize: 5 })).toBe(-1);
  });
});

describe('createTypeahead (p805 D4)', () => {
  const texts = ['apple', 'avocado', 'banana', 'blueberry', 'cherry'];
  const typeahead = () =>
    createTypeahead({ getCount: () => texts.length, getText: (index) => texts[index] });

  it('a letter goes to the next item starting with it, round past the end', () => {
    vi.useFakeTimers();
    const { type } = typeahead();
    expect(type('b', 0)).toBe(2);
    expect(type('b', 2)).toBe(3);
    expect(type('b', 3)).toBe(2);
  });

  it('letters typed within 500 ms are one search, which includes the focused item', () => {
    vi.useFakeTimers();
    const { type } = typeahead();
    expect(type('B', 2)).toBe(3);
    expect(type('a', 3)).toBe(2);
    vi.advanceTimersByTime(500);
    expect(type('a', 2)).toBe(0);
    expect(type('z', 0)).toBe(-1);
  });

  it('`clear` ends the search and its timer', () => {
    vi.useFakeTimers();
    const { type, clear } = typeahead();
    type('c', 0);
    clear();
    expect(vi.getTimerCount()).toBe(0);
    expect(type('a', 0)).toBe(1);
  });

  it('types printable characters without Ctrl, ⌘ or Alt', () => {
    // linkedom has no KeyboardEvent: the check reads only these fields
    const key = (init: Partial<KeyboardEvent>) =>
      ({ ctrlKey: false, metaKey: false, altKey: false, ...init }) as KeyboardEvent;
    expect(isTypeaheadKey(key({ key: 'a' }))).toBe(true);
    expect(isTypeaheadKey(key({ key: 'a', ctrlKey: true }))).toBe(false);
    expect(isTypeaheadKey(key({ key: 'a', altKey: true }))).toBe(false);
    expect(isTypeaheadKey(key({ key: 'ArrowDown' }))).toBe(false);
  });
});

describe('createRovingTabStop (p805 D4)', () => {
  const makeElems = (count: number) => {
    const container = document.createElement('div');
    const elems = Array.from({ length: count }, () => {
      const elem = document.createElement('button');
      container.append(elem);
      return elem;
    });
    return { container, elems };
  };
  const tabIndices = (elems: HTMLElement[]) => elems.map((elem) => elem.getAttribute('tabindex'));

  it('`reset` makes one item the tab stop and the rest -1; -1 leaves none', () => {
    const { elems } = makeElems(3);
    const stop = createRovingTabStop({ getElems: () => elems });
    stop.reset(1);
    expect(tabIndices(elems)).toEqual(['-1', '0', '-1']);
    expect(stop.getIndex()).toBe(1);
    stop.reset(-1);
    expect(tabIndices(elems)).toEqual(['-1', '-1', '-1']);
    expect(stop.getIndex()).toBe(-1);
  });

  it('`setIndex` moves the stop, writing only the old item and the new one', () => {
    const { elems } = makeElems(3);
    const stop = createRovingTabStop({ getElems: () => elems });
    stop.reset(0);
    elems[2].removeAttribute('tabindex');
    stop.setIndex(1);
    expect(tabIndices(elems)).toEqual(['-1', '0', null]);
    expect(stop.getIndex()).toBe(1);
  });

  it('a focus reaching an item another way moves the stop to it', () => {
    const { container, elems } = makeElems(3);
    const stop = createRovingTabStop({ getElems: () => elems });
    stop.reset(0);
    container.addEventListener('focusin', stop.onFocusIn);
    document.body.append(container);
    elems[2].focus();
    expect(tabIndices(elems)).toEqual(['-1', '-1', '0']);
    container.remove();
  });
});
