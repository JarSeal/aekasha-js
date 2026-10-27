import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { countListeners, dispatchKey, dispatchPointer, stubKitDomAsync } from '../testing/KitDom';
import { createBindingScheduler } from './binding/BindingScheduler';
import { createFolder } from './Folder';
import { createMonitor } from './Monitor';
import { createNumberField } from './NumberField';
import { createPropertyGrid, type PropertyGridProps } from './PropertyGrid';

beforeAll(async () => {
  await stubKitDomAsync();
});

afterEach(() => {
  vi.useRealTimers();
});

const makeGrid = (props: PropertyGridProps = {}) => {
  const widths: number[] = [];
  const grid = createPropertyGrid({ onLabelWidthChange: (w) => widths.push(w), ...props });
  document.body.append(grid.cmp.elem);
  const separator = grid.cmp.elem.querySelector<HTMLElement>('.aekPropertyGrid__separator')!;
  const width = () => grid.cmp.elem.style.getPropertyValue('--aek-property-grid-label-width');
  return { grid, separator, widths, width };
};

const inputOf = (field: { cmp: { elem: HTMLElement } }) => field.cmp.elem.querySelector('input')!;

describe('the property grid (p804 D9)', () => {
  it('lays its children in its content; its separator is a focusable vertical separator', () => {
    const speed = createNumberField({ label: 'Speed', value: 1 });
    const { grid, separator, width } = makeGrid({ children: [speed], id: 'gridSeparator' });
    expect(grid.cmp.elem.className).toBe('aekPropertyGrid');
    expect([...grid.content.elem.children]).toEqual([speed.cmp.elem]);
    expect(width()).toBe('40%');
    expect(separator.id).toBe('gridSeparator');
    expect(separator.getAttribute('role')).toBe('separator');
    expect(separator.getAttribute('tabindex')).toBe('0');
    expect(separator.getAttribute('aria-orientation')).toBe('vertical');
    expect(separator.getAttribute('aria-label')).toBe('Label column');
    expect(separator.getAttribute('aria-controls')).toBe(grid.content.elem.id);
    expect(separator.getAttribute('aria-valuenow')).toBe('40');
    expect(separator.getAttribute('aria-valuemin')).toBe('20');
    expect(separator.getAttribute('aria-valuemax')).toBe('80');
    grid.cmp.remove();
  });

  it('takes a label width, kept from 20 to 80; resizable: false has no separator', () => {
    const { grid, separator, width } = makeGrid({ labelWidth: 55 });
    expect(width()).toBe('55%');
    expect(separator.getAttribute('aria-valuetext')).toBe('55 %');
    grid.setLabelWidth(95);
    expect(grid.getLabelWidth()).toBe(80);
    grid.cmp.remove();
    const fixed = makeGrid({ resizable: false, labelWidth: 10 });
    expect(fixed.grid.cmp.elem.querySelector('.aekPropertyGrid__separator')).toBeNull();
    expect(fixed.width()).toBe('20%');
    fixed.grid.cmp.remove();
  });

  it('the arrows move the column (Shift ×10, Alt ×0.1), Home and End; each keyup reports it', () => {
    const { grid, separator, widths } = makeGrid();
    const right = dispatchKey(separator, 'keydown', 'ArrowRight');
    expect(right.defaultPrevented).toBe(true);
    expect(grid.getLabelWidth()).toBe(41);
    dispatchKey(separator, 'keydown', 'ArrowRight');
    expect(widths).toEqual([]);
    dispatchKey(separator, 'keyup', 'ArrowRight');
    expect(widths).toEqual([42]);
    dispatchKey(separator, 'keydown', 'ArrowLeft', { shiftKey: true });
    expect(grid.getLabelWidth()).toBe(32);
    dispatchKey(separator, 'keydown', 'ArrowRight', { altKey: true });
    expect(grid.getLabelWidth()).toBe(32.1);
    dispatchKey(separator, 'keydown', 'Home');
    expect(grid.getLabelWidth()).toBe(20);
    dispatchKey(separator, 'keydown', 'End');
    expect(grid.getLabelWidth()).toBe(80);
    dispatchKey(separator, 'keyup', 'End');
    expect(widths).toEqual([42, 80]);
    // Another key goes on
    expect(dispatchKey(separator, 'keydown', 'a').defaultPrevented).toBe(false);
    grid.cmp.remove();
  });

  it('a drag moves the column to the pointer; the release reports it', () => {
    const { grid, separator, widths } = makeGrid();
    grid.cmp.elem.getBoundingClientRect = () => ({ left: 100, width: 500 }) as DOMRect;
    dispatchPointer(separator, 'pointerdown', { clientX: 300, pointerId: 1 });
    expect(separator.hasAttribute('data-dragging')).toBe(true);
    dispatchPointer(separator, 'pointermove', { clientX: 350, pointerId: 1 });
    expect(grid.getLabelWidth()).toBe(50);
    dispatchPointer(separator, 'pointermove', { clientX: 120, pointerId: 1 });
    expect(grid.getLabelWidth()).toBe(20);
    expect(widths).toEqual([]);
    dispatchPointer(separator, 'pointerup', { clientX: 120, pointerId: 1 });
    expect(separator.hasAttribute('data-dragging')).toBe(false);
    expect(widths).toEqual([20]);
    grid.cmp.remove();
  });

  it('its refresh reads the fields added without a scheduler, not one with its own', () => {
    const settings = { speed: 1, size: 1 };
    const other = createBindingScheduler();
    const speed = createNumberField({ label: 'Speed', target: settings, key: 'speed' });
    const size = createNumberField({
      label: 'Size',
      target: settings,
      key: 'size',
      scheduler: other,
    });
    const { grid } = makeGrid({ children: [speed, size] });
    settings.speed = 2;
    settings.size = 2;
    grid.refresh();
    expect(inputOf(speed).value).toBe('2.00');
    expect(inputOf(size).value).toBe('1.00');
    grid.cmp.remove();
    other.dispose();
  });

  it('a live field added moves from the page’s tick to the grid’s', () => {
    vi.useFakeTimers();
    const stats = { ms: 1 };
    const monitor = createMonitor({ label: 'Frame', target: stats, key: 'ms', interval: 0 });
    document.body.append(monitor.cmp.elem);
    const { grid } = makeGrid({ visible: false });
    grid.add(monitor);
    stats.ms = 2;
    vi.advanceTimersByTime(100);
    // The grid's host doesn't show: no tick reads it
    expect(monitor.cmp.elem.textContent).toContain('1.00');
    grid.scheduler.setVisible(true);
    vi.advanceTimersByTime(32);
    expect(monitor.cmp.elem.textContent).toContain('2.00');
    grid.cmp.remove();
    expect(countListeners(document, 'visibilitychange')).toBe(0);
  });

  it('a folder in it, and its fields, take its scheduler: refresh, hidden, the open', () => {
    vi.useFakeTimers();
    const settings = { bias: 1, mapSize: 1 };
    let isHidden = false;
    const bias = createNumberField({ label: 'Bias', target: settings, key: 'bias' });
    const folder = createFolder({ title: 'Shadow', hidden: () => isHidden, children: [bias] });
    const { grid } = makeGrid({ children: [folder] });
    settings.bias = 2;
    grid.refresh();
    expect(inputOf(bias).value).toBe('2.00');
    isHidden = true;
    grid.refresh();
    expect(folder.cmp.elem.hasAttribute('hidden')).toBe(true);
    isHidden = false;
    grid.refresh();
    // Added later to the folder in the grid: the grid's too
    const mapSize = createNumberField({ label: 'Map', target: settings, key: 'mapSize' });
    folder.add(mapSize);
    folder.setExpanded(false);
    // Shown while its height eases out, then hidden
    vi.advanceTimersByTime(200);
    settings.mapSize = 3;
    grid.refresh();
    expect(inputOf(mapSize).value).toBe('1.00');
    folder.setExpanded(true);
    expect(inputOf(mapSize).value).toBe('3.00');
    grid.cmp.remove();
  });

  it('leaves no listener after it’s removed; a shared scheduler stays', () => {
    const shared = createBindingScheduler();
    const settings = { speed: 1 };
    const speed = createNumberField({ label: 'Speed', target: settings, key: 'speed' });
    const { grid, separator } = makeGrid({ scheduler: shared, children: [speed] });
    expect(grid.scheduler).toBe(shared);
    grid.cmp.remove();
    expect(countListeners(separator)).toBe(0);
    // The shared one still reads a field added to it later
    const other = createNumberField({
      label: 'Other',
      target: settings,
      key: 'speed',
      scheduler: shared,
    });
    document.body.append(other.cmp.elem);
    settings.speed = 5;
    shared.refresh();
    expect(inputOf(other).value).toBe('5.00');
    other.cmp.remove();
    shared.dispose();
  });
});
