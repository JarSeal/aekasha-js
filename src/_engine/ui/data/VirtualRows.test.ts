import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  countListeners,
  dispatchKey,
  stubKitDomAsync,
  stubResizeObserver,
} from '../testing/KitDom';
import { createHudRoot, getHUDRootCMP } from '../core/HUD';
import { createList } from './List';
import type { ListProps } from './ListTypes';
import { createVirtualRows, getVirtualWindow, useVirtualRows } from './VirtualRows';

type Item = { id: string; name: string };

const makeItems = (count: number) =>
  Array.from({ length: count }, (_, i) => ({ id: `k${i}`, name: `Item ${i}` }));

let observers: ReturnType<typeof stubResizeObserver>;

beforeAll(async () => {
  await stubKitDomAsync();
  createHudRoot({ slot: document.getElementById('hudSlot') as HTMLElement });
});

beforeEach(() => {
  observers = stubResizeObserver();
});

afterEach(() => {
  observers.restore();
  vi.useRealTimers();
});

describe('getVirtualWindow (p805 D8)', () => {
  const base = { count: 1000, rowHeight: 20, scrollTop: 0, viewportHeight: 100, overscan: 4 };

  it('the rows the box shows, with the overscan past each edge', () => {
    expect(getVirtualWindow(base)).toEqual({ start: 0, end: 9 });
    expect(getVirtualWindow({ ...base, scrollTop: 500 })).toEqual({ start: 21, end: 34 });
    // A row cut at the bottom edge is in
    expect(getVirtualWindow({ ...base, scrollTop: 510, overscan: 0 })).toEqual({
      start: 25,
      end: 31,
    });
  });

  it('clamped at the ends, and empty for no rows or no height', () => {
    expect(getVirtualWindow({ ...base, scrollTop: 19900 })).toEqual({ start: 991, end: 1000 });
    expect(getVirtualWindow({ ...base, scrollTop: 50000 })).toEqual({ start: 996, end: 1000 });
    expect(getVirtualWindow({ ...base, count: 3 })).toEqual({ start: 0, end: 3 });
    expect(getVirtualWindow({ ...base, count: 0 })).toEqual({ start: 0, end: 0 });
    expect(getVirtualWindow({ ...base, rowHeight: 0 })).toEqual({ start: 0, end: 0 });
    expect(getVirtualWindow({ ...base, scrollTop: -40, viewportHeight: 0 })).toEqual({
      start: 0,
      end: 5,
    });
  });
});

describe('virtual rows on a box', () => {
  it('spacers, the window as the box scrolls and resizes, the page size, scrolling to a row', () => {
    const box = document.createElement('div');
    document.body.append(box);
    const onChange = vi.fn();
    const impl = useVirtualRows(createVirtualRows({ rowHeight: 20, overscan: 0 }));
    const view = impl?.attach(box, 'div', onChange);
    if (!view) throw new Error('no virtual rows');
    expect(view.top.getAttribute('aria-hidden')).toBe('true');
    expect(view.top.getAttribute('role')).toBe('presentation');
    // No height yet: 20 rows' worth
    expect(view.getWindow(100)).toEqual({ start: 0, end: 20 });
    observers.resize(box, { height: 100 });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(view.getWindow(100)).toEqual({ start: 0, end: 5 });
    view.layout(100, 0, 5);
    expect(view.bottom.style.height).toBe('1900px');
    box.scrollTop = 200;
    box.dispatchEvent(new window.Event('scroll'));
    expect(onChange).toHaveBeenCalledTimes(2);
    view.layout(100, 10, 15);
    expect(view.top.style.height).toBe('200px');
    // The same scroll again: no change
    box.dispatchEvent(new window.Event('scroll'));
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(view.getPageSize()).toBe(5);
    view.scrollToIndex(40);
    expect(box.scrollTop).toBe(720);
    view.scrollToIndex(2);
    expect(box.scrollTop).toBe(40);
    view.dispose();
    expect(countListeners(box)).toBe(0);
    expect(observers.observerCount()).toBe(0);
    box.remove();
  });

  it('measures the first row once when no height was given, and writes it', () => {
    const box = document.createElement('div');
    const view = useVirtualRows(createVirtualRows())?.attach(box, 'li', () => {});
    if (!view) throw new Error('no virtual rows');
    expect(view.top.tagName).toBe('LI');
    expect(view.top.hasAttribute('role')).toBe(false);
    expect(view.getRowHeight()).toBe(28);
    const row = document.createElement('div');
    expect(view.measure(row)).toBe(false);
    Object.defineProperty(row, 'offsetHeight', { value: 32 });
    expect(view.measure(row)).toBe(true);
    expect(view.measure(row)).toBe(false);
    expect(view.getRowHeight()).toBe(32);
    expect(box.style.getPropertyValue('--aek-list-row-height')).toBe('32px');
    view.dispose();
  });

  it('a handle that isn’t the kit’s has no code', () => {
    expect(useVirtualRows(undefined)).toBe(null);
    expect(useVirtualRows({ kind: 'virtualRows' })).toBe(null);
  });
});

describe('a list with virtual rows', () => {
  const add = (props: Partial<ListProps<Item>> = {}, count = 1000) => {
    const list = createList<Item>({
      label: 'Items',
      items: makeItems(count),
      title: (item) => item.name,
      selection: 'single',
      virtual: createVirtualRows({ rowHeight: 20 }),
      ...props,
    });
    getHUDRootCMP().add(list.cmp);
    const box = list.cmp.elem.querySelector('.aekList__rows') as HTMLElement;
    observers.resize(box, { height: 100 });
    const getRows = () => [...box.querySelectorAll('.aekList__row')] as HTMLElement[];
    const getKeys = () =>
      getRows()
        .filter((row) => !row.hasAttribute('data-pinned'))
        .map((row) => row.getAttribute('data-key'));
    const scrollTo = (top: number) => {
      box.scrollTop = top;
      box.dispatchEvent(new window.Event('scroll'));
    };
    return { list, box, getRows, getKeys, scrollTo };
  };

  it('renders only the window between its spacers, with each row’s place', () => {
    const { list, box, getRows, getKeys, scrollTo } = add();
    expect(box.hasAttribute('data-virtual')).toBe(true);
    expect(getKeys()).toEqual(['k0', 'k1', 'k2', 'k3', 'k4', 'k5', 'k6', 'k7', 'k8']);
    const [top, bottom] = [...box.querySelectorAll('.aekList__spacer')] as HTMLElement[];
    expect(box.firstElementChild).toBe(top);
    expect(top.style.height).toBe('0px');
    expect(bottom.style.height).toBe(`${991 * 20}px`);
    expect(getRows()[3].getAttribute('aria-posinset')).toBe('4');
    expect(getRows()[3].getAttribute('aria-setsize')).toBe('1000');
    scrollTo(500);
    // The tab stop's row (k0) stays rendered, pinned at its offset
    expect(getKeys()).toEqual(Array.from({ length: 13 }, (_, i) => `k${21 + i}`));
    const pinned = box.querySelector('[data-pinned]') as HTMLElement;
    expect(pinned.getAttribute('data-key')).toBe('k0');
    expect(pinned.style.top).toBe('0px');
    expect(pinned.getAttribute('tabindex')).toBe('0');
    expect(top.style.height).toBe('420px');
    list.cmp.remove();
  });

  it('recycles the rows it lets go of: as many elements as the window needs', () => {
    const { list, box, getRows, scrollTo } = add();
    const seen = new Set(getRows());
    for (let top = 0; top <= 2000; top += 100) scrollTo(top);
    for (const row of getRows()) seen.add(row);
    // The window (9 to 13 rows), the pinned row and the rows the first window had
    expect(seen.size).toBeLessThanOrEqual(15);
    // A recycled row shows its new entry's key and title, and isn't a tab stop
    const row = getRows().find((elem) => elem.getAttribute('data-key') === 'k100') as HTMLElement;
    expect(row.querySelector('.aekList__title')?.textContent).toBe('Item 100');
    expect(row.getAttribute('tabindex')).toBe('-1');
    expect(box.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
    list.cmp.remove();
  });

  it('the keys render and scroll to a row out of the window, the focus kept on it', () => {
    const { list, box, getKeys } = add();
    const first = box.querySelector('[data-key="k0"]') as HTMLElement;
    first.focus();
    dispatchKey(first, 'keydown', 'End');
    const last = box.querySelector('[data-key="k999"]') as HTMLElement;
    expect(document.activeElement).toBe(last);
    expect(box.scrollTop).toBe(1000 * 20 - 100);
    expect(getKeys()).toContain('k999');
    expect(last.hasAttribute('data-pinned')).toBe(false);
    dispatchKey(last, 'keydown', 'PageUp');
    expect((document.activeElement as HTMLElement).getAttribute('data-key')).toBe('k994');
    // A letter finds a title out of the window
    dispatchKey(document.activeElement as HTMLElement, 'keydown', 'i');
    expect((document.activeElement as HTMLElement).getAttribute('data-key')).toBe('k995');
    list.focusKey('k10');
    expect((document.activeElement as HTMLElement).getAttribute('data-key')).toBe('k10');
    list.scrollToKey('k500');
    expect(box.scrollTop).toBe(500 * 20 - 100 + 20);
    list.cmp.remove();
  });

  it('the filter’s rows only; the selection of a row not rendered is kept and shown again', () => {
    const { list, box, getKeys, scrollTo } = add({ filter: {}, selected: ['k3'] });
    list.setQuery('item 99');
    // Every word anywhere: 99, 199 … 899 and 990 … 999
    expect(getKeys()).toEqual([99, 199, 299, 399, 499, 599, 699, 799, 899].map((i) => `k${i}`));
    expect(box.querySelector('.aekList__row')?.getAttribute('aria-setsize')).toBe('19');
    list.setQuery('');
    scrollTo(0);
    expect(box.querySelector('[data-key="k3"]')?.getAttribute('aria-selected')).toBe('true');
    expect(list.getSelected()).toEqual(['k3']);
    list.cmp.remove();
  });

  it('a grid’s row count and row indices; the removal leaves no listener or observer', () => {
    const { list, box, getRows } = add({
      actions: [{ key: 'x', label: 'X', icon: '', onPress: () => {} }],
    });
    expect(box.getAttribute('aria-rowcount')).toBe('1000');
    expect(getRows()[2].getAttribute('aria-rowindex')).toBe('3');
    expect(getRows()[2].hasAttribute('aria-posinset')).toBe(false);
    list.cmp.remove();
    expect(countListeners(box)).toBe(0);
    expect(observers.observerCount()).toBe(0);
  });
});
