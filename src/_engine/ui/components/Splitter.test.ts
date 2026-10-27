import { beforeAll, describe, expect, it } from 'vitest';
import { countListeners, dispatchKey, dispatchPointer, stubKitDomAsync } from '../testing/KitDom';
import { CMP } from '../core/CMP';
import { createHudRoot, getHUDRootCMP } from '../core/HUD';
import { createSplitter, type SplitterProps } from './Splitter';

/** A splitter of two text panes added to the HUD root, its reports collected */
const makeSplitter = (props: Partial<SplitterProps> = {}) => {
  const sizes: number[] = [];
  const collapses: boolean[] = [];
  const splitter = createSplitter({
    label: 'Outline width',
    first: CMP({ text: 'outline' }),
    second: CMP({ text: 'properties' }),
    onSizeChange: (size) => sizes.push(size),
    onCollapsedChange: (on) => collapses.push(on),
    ...props,
  });
  getHUDRootCMP().add(splitter.cmp);
  const root = splitter.cmp.elem;
  const separator = root.querySelector<HTMLElement>('.aekSplitter__separator')!;
  const [first, second] = [...root.querySelectorAll<HTMLElement>('.aekSplitter__pane')];
  const size = () => root.style.getPropertyValue('--aek-splitter-size');
  return { splitter, root, separator, first, second, sizes, collapses, size };
};

/** Presses a key on the separator and releases it */
const press = (
  target: HTMLElement,
  key: string,
  init: { shiftKey?: boolean; altKey?: boolean } = {}
) => {
  const down = dispatchKey(target, 'keydown', key, init);
  dispatchKey(target, 'keyup', key);
  return down;
};

beforeAll(async () => {
  await stubKitDomAsync();
  createHudRoot({ slot: document.getElementById('hudSlot') as HTMLElement });
});

describe('splitter (p805 D10)', () => {
  it('is two panes and a focusable separator between them, at 50 % by default', () => {
    const { splitter, root, separator, first, second, size } = makeSplitter();
    expect(root.className).toBe('aekSplitter');
    expect(root.getAttribute('data-orientation')).toBe('horizontal');
    expect([...root.children]).toEqual([first, separator, second]);
    expect(first.getAttribute('data-pane')).toBe('first');
    expect(first.textContent).toBe('outline');
    expect(second.textContent).toBe('properties');
    expect(separator.getAttribute('role')).toBe('separator');
    expect(separator.getAttribute('tabindex')).toBe('0');
    expect(separator.getAttribute('aria-label')).toBe('Outline width');
    expect(separator.getAttribute('aria-orientation')).toBe('vertical');
    expect(separator.getAttribute('aria-controls')).toBe(first.id);
    expect(separator.getAttribute('aria-valuenow')).toBe('50');
    expect(separator.getAttribute('aria-valuemin')).toBe('10');
    expect(separator.getAttribute('aria-valuemax')).toBe('90');
    expect(separator.getAttribute('aria-valuetext')).toBe('50 %');
    expect(size()).toBe('50%');
    expect(splitter.getSize()).toBe(50);
    splitter.cmp.remove();
  });

  it('the arrows move it (Shift ×10, Alt ×0.1), Home and End to its range; each keyup reports', () => {
    const { splitter, separator, sizes, size } = makeSplitter({ size: 30 });
    expect(press(separator, 'ArrowRight').defaultPrevented).toBe(true);
    expect(splitter.getSize()).toBe(31);
    press(separator, 'ArrowLeft', { shiftKey: true });
    expect(splitter.getSize()).toBe(21);
    press(separator, 'ArrowRight', { altKey: true });
    expect(splitter.getSize()).toBe(21.1);
    press(separator, 'Home');
    expect(splitter.getSize()).toBe(10);
    press(separator, 'End');
    expect(size()).toBe('90%');
    expect(sizes).toEqual([31, 21, 21.1, 10, 90]);
    // Not its keys: Up and Down move a vertical one; Enter only collapses a collapsible one
    expect(press(separator, 'ArrowDown').defaultPrevented).toBe(false);
    expect(press(separator, 'Enter').defaultPrevented).toBe(false);
    expect(sizes.length).toBe(5);
    splitter.cmp.remove();
  });

  it('vertical: the panes stacked, Up and Down move it', () => {
    const { splitter, root, separator } = makeSplitter({ orientation: 'vertical' });
    expect(root.getAttribute('data-orientation')).toBe('vertical');
    expect(separator.getAttribute('aria-orientation')).toBe('horizontal');
    expect(press(separator, 'ArrowRight').defaultPrevented).toBe(false);
    press(separator, 'ArrowDown');
    expect(splitter.getSize()).toBe(51);
    press(separator, 'ArrowUp');
    press(separator, 'ArrowUp');
    expect(splitter.getSize()).toBe(49);
    splitter.cmp.remove();
  });

  it('a drag moves it to the pointer, keeping the grab’s offset; the release reports', () => {
    const { splitter, root, separator, sizes } = makeSplitter();
    root.getBoundingClientRect = () => ({ left: 100, top: 0, width: 500, height: 300 }) as DOMRect;
    separator.getBoundingClientRect = () =>
      ({ left: 350, top: 0, width: 8, height: 300 }) as DOMRect;
    // Grabbed 4 px into the separator
    dispatchPointer(separator, 'pointerdown', { clientX: 354, pointerId: 1 });
    expect(separator.hasAttribute('data-dragging')).toBe(true);
    dispatchPointer(separator, 'pointermove', { clientX: 404, pointerId: 1 });
    expect(splitter.getSize()).toBe(60);
    dispatchPointer(separator, 'pointermove', { clientX: 104, pointerId: 1 });
    expect(splitter.getSize()).toBe(10);
    expect(sizes).toEqual([]);
    dispatchPointer(separator, 'pointerup', { clientX: 104, pointerId: 1 });
    expect(separator.hasAttribute('data-dragging')).toBe(false);
    expect(sizes).toEqual([10]);
    splitter.cmp.remove();
  });

  it('in px: its own min, max and step, the size as px', () => {
    const { splitter, separator, size } = makeSplitter({ unit: 'px', size: 200, max: 400 });
    expect(size()).toBe('200px');
    expect(separator.getAttribute('aria-valuetext')).toBe('200 px');
    expect(separator.getAttribute('aria-valuemin')).toBe('0');
    press(separator, 'ArrowRight');
    expect(splitter.getSize()).toBe(210);
    press(separator, 'End');
    expect(splitter.getSize()).toBe(400);
    splitter.setSize(1000);
    expect(splitter.getSize()).toBe(400);
    splitter.cmp.remove();
    // Without a max, unmeasured: no aria-valuemax
    const open = makeSplitter({ unit: 'px' });
    expect(open.splitter.getSize()).toBe(240);
    expect(open.separator.hasAttribute('aria-valuemax')).toBe(false);
    open.splitter.cmp.remove();
  });

  it('collapsible: Enter collapses the first pane and restores it, reported; an arrow restores it', () => {
    const { splitter, root, separator, first, sizes, collapses, size } = makeSplitter({
      size: 35,
      collapsible: true,
    });
    expect(separator.getAttribute('aria-valuemin')).toBe('0');
    expect(press(separator, 'Enter').defaultPrevented).toBe(true);
    expect(splitter.isCollapsed()).toBe(true);
    expect(root.hasAttribute('data-collapsed')).toBe(true);
    expect(first.hasAttribute('hidden')).toBe(true);
    expect(size()).toBe('0px');
    expect(separator.getAttribute('aria-valuenow')).toBe('0');
    expect(separator.getAttribute('aria-valuetext')).toBe('Collapsed');
    // The size it restores to is kept
    expect(splitter.getSize()).toBe(35);
    press(separator, 'Enter');
    expect(splitter.isCollapsed()).toBe(false);
    expect(size()).toBe('35%');
    expect(collapses).toEqual([true, false]);
    expect(sizes).toEqual([]);
    press(separator, 'Enter');
    // From collapsed, an arrow starts at nothing: the smallest size
    press(separator, 'ArrowRight');
    expect(splitter.isCollapsed()).toBe(false);
    expect(splitter.getSize()).toBe(10);
    expect(collapses).toEqual([true, false, true, false]);
    expect(sizes).toEqual([10]);
    splitter.cmp.remove();
  });

  it('collapse and restore from code don’t report; collapsing moves the focus out of the pane', () => {
    const input = CMP({ tag: 'input' });
    const { splitter, separator, collapses } = makeSplitter({
      first: input,
      collapsible: true,
      collapsed: true,
    });
    expect(splitter.isCollapsed()).toBe(true);
    splitter.restore();
    input.elem.focus();
    splitter.collapse();
    expect(document.activeElement).toBe(separator);
    expect(collapses).toEqual([]);
    splitter.cmp.remove();
    // Not collapsible: collapse does nothing
    const fixed = makeSplitter({ collapsed: true });
    fixed.splitter.collapse();
    expect(fixed.splitter.isCollapsed()).toBe(false);
    fixed.splitter.cmp.remove();
  });

  it('removes its listeners and both panes’ content with itself, mid-drag too', () => {
    const removed: string[] = [];
    const { splitter, separator } = makeSplitter({
      first: CMP({ onRemoveCmp: () => removed.push('first') }),
      second: CMP({ onRemoveCmp: () => removed.push('second') }),
    });
    dispatchPointer(separator, 'pointerdown', { clientX: 10, pointerId: 1 });
    splitter.cmp.remove();
    expect(removed).toEqual(['first', 'second']);
    expect(countListeners(separator)).toBe(0);
  });
});
