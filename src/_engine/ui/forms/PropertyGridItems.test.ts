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

  it('infers colours as Tweakpane does: a hex string, an { r, g, b } object; a number says so', () => {
    const state = {
      sky: '#87ceeb',
      fog: '#9fb4c780',
      grid: { r: 0.2, g: 0.4, b: 0.6 },
      collider: 0x00ff00,
      tag: '#tag',
      code: '#abc',
    };
    const { rows } = makeGrid([
      { target: state, key: 'sky', label: 'Sky' },
      { target: state, key: 'fog', label: 'Fog' },
      { target: state, key: 'grid', label: 'Grid' },
      { target: state, key: 'collider', label: 'Collider', kind: 'color' },
      { target: state, key: 'collider', label: 'Collider id' },
      { target: state, key: 'tag', label: 'Tag' },
      { target: state, key: 'code', label: 'Code', kind: 'text' },
      { target: state, key: 'sky', label: 'Sky', readonly: true },
    ]);
    expect(rows.map(kindOf)).toEqual([
      'color',
      'color',
      'color',
      'color',
      'number',
      'text',
      'text',
      'monitor',
    ]);
    const text = (row: HTMLElement) => row.querySelector<HTMLInputElement>('input')!.value;
    expect(text(rows[2])).toBe('#336699');
    expect(text(rows[3])).toBe('#00ff00');
    // A string with alpha digits has the alpha part
    expect(rows[1].querySelectorAll('.aekColorField__part')).toHaveLength(1);
    expect(rows[7].textContent).toContain('#87ceeb');
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

  it('infers a vector from an { x, y } object or 2 to 4 numbers, not from an Euler', () => {
    const state = {
      position: { x: 1, y: 2, z: 3 },
      size: [4, 5],
      quat: { x: 0, y: 0, z: 0, w: 1 },
      many: [1, 2, 3, 4, 5],
    };
    const { rows } = makeGrid([
      { target: state, key: 'position', label: 'Position' },
      { target: state, key: 'size', label: 'Size' },
      { target: state, key: 'quat', label: 'Raw quaternion' },
      { target: state, key: 'position', label: 'Read', readonly: true, precision: 0 },
      { target: state, key: 'position', label: 'Linked', linkable: true, linked: true },
    ]);
    expect(rows.map(kindOf)).toEqual(['vector', 'vector', 'vector', 'monitor', 'vector']);
    expect(rows[1].querySelectorAll('input')).toHaveLength(2);
    expect(rows[2].querySelectorAll('input')).toHaveLength(4);
    expect(rows[3].textContent).toContain('1, 2, 3');
    expect(rows[4].querySelector('.aekVectorField__link')!.getAttribute('aria-pressed')).toBe(
      'true'
    );
  });

  it('an angle dial, a 2D pad and a gradient say their kinds, their props passed through', () => {
    const state = {
      azimuth: 90,
      wind: { x: 0.5, y: -0.5 },
      ramp: {
        stops: [
          { t: 0, color: '#000000' },
          { t: 1, color: '#ffffff' },
        ],
      },
    };
    const { rows } = makeGrid([
      {
        target: state,
        key: 'azimuth',
        label: 'Azimuth',
        kind: 'angle',
        angleUnit: 'degrees',
        min: 0,
        max: 360,
        convention: 'compass',
      },
      { target: state, key: 'wind', label: 'Wind', kind: 'pad2d', invertY: true },
      { target: state, key: 'ramp', label: 'Ramp', kind: 'gradient', maxStops: 2 },
    ]);
    expect(rows.map(kindOf)).toEqual(['angle', 'pad2d', 'gradient']);
    expect(rows[2].querySelector('.aekGradientEditor__add')!.hasAttribute('disabled')).toBe(true);
    expect(rows[0].querySelector('.aekAngleDial')!.getAttribute('data-convention')).toBe('compass');
    expect(rows[0].querySelector('input')!.value).toBe('90');
    expect(rows[1].querySelector<HTMLElement>('.aekPad2D__point')!.style.top).toBe('25%');
  });

  it('infers a rotation from an Euler’s shape; a quaternion says its kind', () => {
    const state = {
      rotation: { x: 0, y: Math.PI / 4, z: 0, order: 'XYZ' },
      quaternion: { x: 0, y: 0, z: 0, w: 1 },
    };
    const { rows } = makeGrid([
      { target: state, key: 'rotation', label: 'Rotation', step: Math.PI / 8 },
      { target: state, key: 'quaternion', label: 'Facing', kind: 'quaternion', showRaw: true },
      { target: state, key: 'rotation', label: 'Read', readonly: true },
    ]);
    expect(rows.map(kindOf)).toEqual(['rotation', 'quaternion', 'monitor']);
    expect(rows[0].querySelectorAll('input')[1].value).toBe('45.0');
    expect(rows[1].querySelector('.aekQuaternionField__raw')).not.toBe(null);
    expect(rows[2].textContent).toContain('0°, 45°, 0°');
  });

  it('shows a value no field edits as a monitor, warning unless it’s read-only', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const state = { stats: { bodies: 3, sleeping: 1 } };
    const { rows } = makeGrid([
      { target: state, key: 'stats', label: 'Stats', format: (v) => JSON.stringify(v) },
      { target: state, key: 'stats', label: 'Read', readonly: true, format: () => 'ok' },
    ]);
    expect(rows.map(kindOf)).toEqual(['monitor', 'monitor']);
    expect(rows[0].textContent).toContain('"bodies":3');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('"Stats"');
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
