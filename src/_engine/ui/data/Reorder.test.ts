import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  countListeners,
  dispatchKey,
  dispatchPointer,
  stubKitDomAsync,
  type KitPointerInit,
} from '../testing/KitDom';
import { createHudRoot, getHUDRootCMP } from '../core/HUD';
import { createList } from './List';
import type { ListProps } from './ListTypes';
import { createListReorder, useListReorder, type ListReorderProps } from './Reorder';
import { createVirtualRows } from './VirtualRows';

type Item = { id: string; name: string };

const ITEMS: Item[] = ['Terrain', 'Water', 'Props', 'Foliage', 'Lights'].map((name) => ({
  id: name.toLowerCase(),
  name,
}));
const ROW_HEIGHT = 20;

beforeAll(async () => {
  await stubKitDomAsync();
  createHudRoot({ slot: document.getElementById('hudSlot') as HTMLElement });
});

afterEach(() => {
  vi.useRealTimers();
});

const add = (
  reorderProps: Partial<ListReorderProps> = {},
  props: Partial<ListProps<Item>> = {}
) => {
  const onReorder = vi.fn();
  const list = createList<Item>({
    label: 'Layers',
    items: ITEMS,
    title: (item) => item.name,
    reorder: createListReorder({ onReorder, ...reorderProps }),
    ...props,
  });
  getHUDRootCMP().add(list.cmp);
  const box = list.cmp.elem.querySelector('.aekList__rows') as HTMLElement;
  const row = (key: string) => box.querySelector(`[data-key="${key}"]`) as HTMLElement;
  const getKeys = () =>
    [...box.querySelectorAll('.aekList__row')].map((elem) => elem.getAttribute('data-key'));
  /** Lays the rows out one under another from the box's top (linkedom lays nothing out) */
  const layOut = () => {
    box.getBoundingClientRect = () => new DOMRectStub(0, 0, 200, 300);
    for (const elem of box.querySelectorAll<HTMLElement>('.aekList__row')) {
      const index = getKeys().indexOf(elem.getAttribute('data-key'));
      elem.getBoundingClientRect = () => new DOMRectStub(0, index * ROW_HEIGHT, 200, ROW_HEIGHT);
      Object.defineProperty(elem, 'offsetTop', { configurable: true, value: index * ROW_HEIGHT });
      Object.defineProperty(elem, 'offsetHeight', { configurable: true, value: ROW_HEIGHT });
    }
  };
  return { list, box, row, getKeys, layOut, onReorder };
};

/** A rect the drop's maths read */
class DOMRectStub {
  constructor(
    public left: number,
    public top: number,
    public width: number,
    public height: number
  ) {}
  get right() {
    return this.left + this.width;
  }
  get bottom() {
    return this.top + this.height;
  }
  get x() {
    return this.left;
  }
  get y() {
    return this.top;
  }
  toJSON() {
    return {};
  }
}

const pointer = (
  target: EventTarget,
  type: Parameters<typeof dispatchPointer>[1],
  y: number,
  init: KitPointerInit = {}
) => dispatchPointer(target, type, { clientX: 10, clientY: y, ...init });

describe('reorder (p805 D8): keys', () => {
  it('makes a list a listbox with a handle per row', () => {
    const { list, box, row } = add();
    expect(box.getAttribute('role')).toBe('listbox');
    expect(box.hasAttribute('data-reorder')).toBe(true);
    const handle = row('water').querySelector('.aekList__handle') as HTMLElement;
    expect(handle.getAttribute('aria-hidden')).toBe('true');
    list.cmp.remove();
  });

  it('Alt + ArrowDown / ArrowUp report the move and announce it; the list waits for the app', () => {
    vi.useFakeTimers();
    const { list, row, getKeys, onReorder } = add();
    row('water').focus();
    expect(
      dispatchKey(row('water'), 'keydown', 'ArrowDown', { altKey: true }).defaultPrevented
    ).toBe(true);
    expect(onReorder).toHaveBeenCalledWith({ key: 'water', from: 1, to: 2 });
    expect(getKeys()).toEqual(['terrain', 'water', 'props', 'foliage', 'lights']);
    vi.advanceTimersByTime(50);
    const region = getHUDRootCMP().elem.querySelector(':scope > [role="status"]');
    expect(region?.textContent).toBe('Water moved to 3 of 5');
    // At the top: used, nothing moves
    row('terrain').focus();
    dispatchKey(row('terrain'), 'keydown', 'ArrowUp', { altKey: true });
    expect(onReorder).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(row('terrain'));
    list.cmp.remove();
  });

  it('optimistic: the list moves the row itself, the focus on it', () => {
    const { list, row, getKeys, onReorder } = add({ optimistic: true });
    const water = row('water');
    water.focus();
    const insertBefore = vi.spyOn(water.parentNode as Node, 'insertBefore');
    dispatchKey(water, 'keydown', 'ArrowDown', { altKey: true });
    dispatchKey(water, 'keydown', 'ArrowDown', { altKey: true });
    // Never taken out of the page (a browser would blur it): the others moved around it
    expect(insertBefore.mock.calls.some(([node]) => node === water)).toBe(false);
    insertBefore.mockRestore();
    expect(getKeys()).toEqual(['terrain', 'props', 'foliage', 'water', 'lights']);
    expect(onReorder).toHaveBeenLastCalledWith({ key: 'water', from: 2, to: 3 });
    expect(document.activeElement).toBe(water);
    dispatchKey(water, 'keydown', 'ArrowUp', { altKey: true });
    expect(getKeys()).toEqual(['terrain', 'props', 'water', 'foliage', 'lights']);
    list.cmp.remove();
  });

  it('not while filtered, nor a disabled row', () => {
    const { list, row, onReorder } = add(
      {},
      { filter: { query: 'r' }, disabled: (item) => item.id === 'lights' }
    );
    row('terrain').focus();
    dispatchKey(row('terrain'), 'keydown', 'ArrowDown', { altKey: true });
    list.setQuery('');
    row('lights').focus();
    dispatchKey(row('lights'), 'keydown', 'ArrowUp', { altKey: true });
    expect(onReorder).not.toHaveBeenCalled();
    list.cmp.remove();
  });

  it('a handle that isn’t the kit’s has no code', () => {
    expect(useListReorder(undefined)).toBe(null);
    expect(useListReorder({ kind: 'listReorder' })).toBe(null);
  });
});

describe('reorder: the pointer', () => {
  it('a drag past the threshold lifts the row, shows the drop line, reports the drop; its click is stopped', () => {
    const onActivate = vi.fn();
    const { list, box, row, layOut, onReorder } = add({}, { onActivate });
    layOut();
    const terrain = row('terrain');
    pointer(terrain, 'pointerdown', 10);
    pointer(terrain, 'pointermove', 12);
    expect(terrain.hasAttribute('data-dragging')).toBe(false);
    pointer(terrain, 'pointermove', 40);
    expect(terrain.hasAttribute('data-dragging')).toBe(true);
    expect(terrain.style.transform).toBe('translateY(30px)');
    const line = box.querySelector('.aekList__dropLine') as HTMLElement;
    expect(line.getAttribute('aria-hidden')).toBe('true');
    // Above Props' middle (50): before it
    expect(line.style.top).toBe('40px');
    pointer(terrain, 'pointermove', 65);
    expect(line.style.top).toBe('60px');
    pointer(terrain, 'pointerup', 65);
    expect(onReorder).toHaveBeenCalledWith({ key: 'terrain', from: 0, to: 2 });
    expect(terrain.hasAttribute('data-dragging')).toBe(false);
    expect(terrain.style.transform).toBe('');
    expect(box.querySelector('.aekList__dropLine')).toBe(null);
    dispatchPointer(terrain, 'click');
    expect(onActivate).not.toHaveBeenCalled();
    dispatchPointer(terrain, 'click');
    expect(onActivate).toHaveBeenCalledTimes(1);
    list.cmp.remove();
  });

  it('a press without a move is a click; past the last row drops at the end', () => {
    const onActivate = vi.fn();
    const { list, row, layOut, onReorder } = add({}, { onActivate });
    layOut();
    const water = row('water');
    pointer(water, 'pointerdown', 30);
    pointer(water, 'pointerup', 30);
    dispatchPointer(water, 'click');
    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(onReorder).not.toHaveBeenCalled();
    pointer(water, 'pointerdown', 30);
    pointer(water, 'pointermove', 200);
    pointer(water, 'pointerup', 200);
    expect(onReorder).toHaveBeenCalledWith({ key: 'water', from: 1, to: 4 });
    list.cmp.remove();
  });

  it('a touch drags from the handle only; Escape cancels a drag', () => {
    const { list, row, layOut, onReorder } = add();
    layOut();
    const props = row('props');
    pointer(props, 'pointerdown', 50, { pointerType: 'touch' });
    pointer(props, 'pointermove', 90, { pointerType: 'touch' });
    expect(props.hasAttribute('data-dragging')).toBe(false);
    pointer(props, 'pointerup', 90);
    const handle = props.querySelector('.aekList__handle') as HTMLElement;
    pointer(handle, 'pointerdown', 50, { pointerType: 'touch' });
    pointer(handle, 'pointermove', 90, { pointerType: 'touch' });
    expect(props.hasAttribute('data-dragging')).toBe(true);
    dispatchKey(props, 'keydown', 'Escape');
    expect(props.hasAttribute('data-dragging')).toBe(false);
    pointer(handle, 'pointerup', 90);
    expect(onReorder).not.toHaveBeenCalled();
    list.cmp.remove();
  });

  it('with virtual rows, the dragged row stays rendered while the box scrolls past it', () => {
    const items = Array.from({ length: 100 }, (_, i) => ({ id: `k${i}`, name: `Item ${i}` }));
    const { list, box, row } = add({}, { items, virtual: createVirtualRows({ rowHeight: 20 }) });
    const dragged = row('k1');
    const handle = dragged.querySelector('.aekList__handle') as HTMLElement;
    pointer(handle, 'pointerdown', 30, { pointerType: 'touch' });
    pointer(handle, 'pointermove', 60, { pointerType: 'touch' });
    box.scrollTop = 1000;
    box.dispatchEvent(new window.Event('scroll'));
    expect(row('k1')).toBe(dragged);
    expect(dragged.hasAttribute('data-pinned')).toBe(true);
    expect(dragged.hasAttribute('data-dragging')).toBe(true);
    pointer(handle, 'pointerup', 60, { pointerType: 'touch' });
    // Let go of: no longer kept
    expect(row('k1')).toBe(null);
    list.cmp.remove();
  });

  it('removal mid-drag leaves no listener, timer or drop line', () => {
    vi.useFakeTimers();
    const { list, box, row, layOut } = add();
    layOut();
    const root = list.cmp.elem;
    pointer(row('water'), 'pointerdown', 30);
    pointer(row('water'), 'pointermove', 60);
    list.cmp.remove();
    expect(countListeners(box)).toBe(0);
    expect(countListeners(root)).toBe(0);
    expect(box.querySelector('.aekList__dropLine')).toBe(null);
    expect(vi.getTimerCount()).toBe(0);
  });
});
