import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { stubKitDomAsync } from '../testing/KitDom';
import { createBindingScheduler } from './binding/BindingScheduler';
import type { Field, FieldChange } from './Field';
import { createPropertyGrid, type PropertyGridProps } from './PropertyGrid';
import {
  addPropertyGridItems,
  type PropertyGridItem,
  type PropertyGridItemsOptions,
} from './PropertyGridItems';

beforeAll(async () => {
  await stubKitDomAsync();
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

const makeGrid = (
  items: PropertyGridItem[],
  options?: PropertyGridItemsOptions,
  props?: PropertyGridProps
) => {
  const grid = createPropertyGrid(props);
  addPropertyGridItems(grid, items, options);
  document.body.append(grid.cmp.elem);
  const rows = [...grid.content.elem.children] as HTMLElement[];
  return { grid, rows };
};

const kindOf = (elem: HTMLElement) => elem.getAttribute('data-kind');

describe('the property grid’s items (p804 D10)', () => {
  it('infers each field from the value, as Tweakpane does', () => {
    const state = { speed: 1, volume: 0.5, shadows: true, name: 'Ada', mode: 'a' };
    const { rows } = makeGrid([
      { target: state, key: 'speed', label: 'Speed', min: 0, step: 0.1 },
      { target: state, key: 'volume', label: 'Volume', min: 0, max: 1 },
      { target: state, key: 'shadows', label: 'Shadows' },
      { target: state, key: 'name', label: 'Name' },
      { target: state, key: 'mode', label: 'Mode', options: [{ text: 'A', value: 'a' }] },
      { target: state, key: 'speed', label: 'Speed', options: { Slow: 1, Fast: 2 } },
      { target: state, key: 'speed', label: 'Speed', readonly: true },
    ]);
    expect(rows.map(kindOf)).toEqual([
      'number',
      'slider',
      'checkbox',
      'text',
      'select',
      'select',
      'monitor',
    ]);
  });

  it('takes a kind over the inferred one, and Tweakpane’s options forms for radios', () => {
    const state = { on: false, mode: 'b', price: { min: 1, max: 5 }, query: '' };
    const { rows } = makeGrid([
      { target: state, key: 'on', label: 'On', kind: 'switch' },
      { target: state, key: 'mode', label: 'Mode', kind: 'radio', options: { A: 'a', B: 'b' } },
      {
        target: state,
        key: 'mode',
        label: 'Mode',
        kind: 'segmented',
        options: [
          { text: 'A', value: 'a' },
          { text: 'B', value: 'b' },
        ],
      },
      { target: state, key: 'price', label: 'Price', kind: 'range', min: 0, max: 10 },
      { target: state, key: 'query', label: 'Find', kind: 'search' },
      { target: state, key: 'on', label: 'On', kind: 'monitor' },
    ]);
    expect(rows.map(kindOf)).toEqual(['switch', 'radio', 'segmented', 'range', 'text', 'monitor']);
    const radios = rows[1].querySelectorAll<HTMLInputElement>('input');
    expect([...radios].map((radio) => radio.checked)).toEqual([false, true]);
    expect(rows[2].textContent).toContain('A');
    expect(rows[4].querySelector('[role="searchbox"]')).not.toBeNull();
    expect(rows[5].textContent).toContain('Off');
  });

  it('shows a value no field edits yet as a monitor, warning unless it’s read-only', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const state = { position: { x: 1, y: 2, z: 3 } };
    const { rows } = makeGrid([
      { target: state, key: 'position', label: 'Position', precision: 0 },
      { target: state, key: 'position', label: 'Read', readonly: true, precision: 0 },
    ]);
    expect(rows.map(kindOf)).toEqual(['monitor', 'monitor']);
    expect(rows[0].textContent).toContain('1, 2, 3');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('"Position"');
  });

  it('a field item’s onChange is the field’s; onCreate gets its handle', () => {
    const state = { on: false };
    const calls: { value: unknown; last: boolean; source: string }[] = [];
    let created: Field<unknown> | null = null;
    const { rows } = makeGrid([
      {
        target: state,
        key: 'on',
        label: 'On',
        onChange: (value: unknown, { last, source }: FieldChange<unknown>) =>
          calls.push({ value, last, source }),
        onCreate: (field) => (created = field),
      },
    ]);
    rows[0].querySelector('input')!.click();
    expect(state.on).toBe(true);
    expect(calls).toEqual([{ value: true, last: true, source: 'user' }]);
    expect(created!.cmp.elem).toBe(rows[0]);
  });

  it('an unbound select holds its value (Tweakpane’s list blade)', () => {
    let field: Field<unknown> | null = null;
    makeGrid([
      {
        kind: 'select',
        label: 'Map size',
        value: 1024,
        options: { '512': 512, '1024': 1024 },
        onCreate: (created) => (field = created),
      },
    ]);
    expect(field!.getValue()).toBe(1024);
  });

  it('a folder’s id is its title path (or its id): its open state in, its changes out', () => {
    const changes: [string, boolean][] = [];
    const { rows } = makeGrid(
      [
        {
          type: 'folder',
          title: 'Light',
          items: [
            { type: 'folder', title: 'Shadow', expanded: false, items: [] },
            { type: 'folder', title: 'Lens', id: 'lens', items: [] },
          ],
        },
      ],
      {
        path: 'Sky',
        folderExpanded: { 'Sky/Light/Shadow': true, lens: false },
        onFolderExpandedChange: (id, open) => changes.push([id, open]),
      }
    );
    const toggles = [...rows[0].querySelectorAll<HTMLButtonElement>('.aekFolder__toggle')];
    expect(toggles.map((toggle) => toggle.getAttribute('aria-expanded'))).toEqual([
      'true',
      'true',
      'false',
    ]);
    toggles[0].click();
    toggles[1].click();
    toggles[2].click();
    expect(changes).toEqual([
      ['Sky/Light', false],
      ['Sky/Light/Shadow', false],
      ['lens', true],
    ]);
  });

  it('a button item: its text and click; a label names it with its text', () => {
    const onClick = vi.fn();
    const { rows } = makeGrid([
      { type: 'button', title: 'Rebuild', onClick },
      { type: 'button', title: 'Rebuild', label: 'Shadow map', onClick },
    ]);
    const plain = rows[0].querySelector('button')!;
    expect(plain.textContent).toContain('Rebuild');
    expect(rows[0].hasAttribute('data-labelled')).toBe(false);
    plain.click();
    expect(onClick).toHaveBeenCalledTimes(1);
    const labelled = rows[1].querySelector('button')!;
    const label = rows[1].querySelector('.aekPropertyGrid__buttonLabel')!;
    expect(label.textContent).toBe('Shadow map');
    expect(labelled.getAttribute('aria-labelledby')).toBe(`${label.id} ${labelled.id}`);
  });

  it('re-reads hidden and disabled functions, and runs a custom item’s refresh, on refresh', () => {
    let isOff = true;
    const refreshes: number[] = [];
    let container: HTMLElement | null = null;
    const { grid, rows } = makeGrid([
      { type: 'button', title: 'Go', onClick: () => {}, disabled: () => isOff },
      { type: 'separator', hidden: () => isOff },
      { type: 'folder', title: 'More', hidden: () => isOff, items: [] },
      {
        type: 'custom',
        build: (cmp) => {
          container = cmp.elem;
          cmp.add({ text: 'Custom' });
          return () => refreshes.push(1);
        },
      },
    ]);
    const button = rows[0].querySelector('button')!;
    expect(button.hasAttribute('disabled')).toBe(true);
    expect(rows[1].hasAttribute('hidden')).toBe(true);
    expect(rows[1].querySelector('hr')).not.toBeNull();
    expect(rows[2].hasAttribute('hidden')).toBe(true);
    expect(container).toBe(rows[3]);
    expect(rows[3].textContent).toBe('Custom');
    expect(refreshes).toEqual([]);
    isOff = false;
    grid.refresh();
    expect(button.hasAttribute('disabled')).toBe(false);
    expect(rows[1].hasAttribute('hidden')).toBe(false);
    expect(rows[2].hasAttribute('hidden')).toBe(false);
    expect(refreshes).toEqual([1]);
  });

  it('its fields read on the grid’s refresh; a removed grid leaves nothing on a shared scheduler', () => {
    const shared = createBindingScheduler();
    const state = { speed: 1 };
    const hidden = vi.fn(() => false);
    const { grid, rows } = makeGrid(
      [
        { target: state, key: 'speed', label: 'Speed' },
        { type: 'separator', hidden },
      ],
      {},
      { scheduler: shared }
    );
    state.speed = 2;
    grid.refresh();
    expect(rows[0].querySelector('input')!.value).toBe('2.00');
    grid.cmp.remove();
    hidden.mockClear();
    shared.refresh();
    expect(hidden).not.toHaveBeenCalled();
    shared.dispose();
  });
});
