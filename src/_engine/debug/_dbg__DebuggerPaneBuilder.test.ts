import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { dispatchKey, stubKitDomAsync } from '../ui/testing/KitDom';
import type { CMPHandle } from '../ui/core/CMPTypes';
import type { Field } from '../ui/forms/Field';
import type { DebuggerPaneItem, DebuggerPaneSection } from './DebuggerGUI';
import { _buildDebuggerPane, type DebuggerPaneOwner } from './_dbg__DebuggerPaneBuilder';

// p806 D4, D14: a section's items on the UI kit's property grid, with the debugger's state keys,
// persistence and saved UI states (in the 5.x formats)

/** localStorage with its items as own properties (`lsGetItem` checks them so) */
const storage = {
  getItem(key: string) {
    return Object.prototype.hasOwnProperty.call(storage, key)
      ? String((storage as unknown as Record<string, unknown>)[key])
      : null;
  },
  setItem(key: string, value: string) {
    (storage as unknown as Record<string, unknown>)[key] = String(value);
  },
  removeItem(key: string) {
    delete (storage as unknown as Record<string, unknown>)[key];
  },
};
const STORAGE_METHODS = new Set(['getItem', 'setItem', 'removeItem']);
const clearStorage = () => {
  for (const key of Object.keys(storage)) if (!STORAGE_METHODS.has(key)) storage.removeItem(key);
};
const readLS = (key: string) => {
  const text = storage.getItem(key);
  return text === null ? null : (JSON.parse(text) as unknown);
};

beforeAll(async () => {
  await stubKitDomAsync();
  vi.stubGlobal('localStorage', storage);
});

const built: CMPHandle[] = [];
afterEach(() => {
  for (const cmp of built.splice(0)) cmp.remove();
  clearStorage();
});

type State = Record<string, unknown>;
const build = (
  owner: Partial<DebuggerPaneOwner> & { state?: State },
  content: DebuggerPaneItem<State>[],
  section: Partial<DebuggerPaneSection<State>> = {}
) => {
  const pane = _buildDebuggerPane({ id: 'testTab', ...owner }, {
    pane: true,
    ...section,
    content,
  } as DebuggerPaneSection<State>);
  document.body.append(pane.cmp.elem);
  built.push(pane.cmp);
  return pane;
};

/** The field the item made, through its onCreate */
const fieldOf = <T = unknown>(holder: { field: Field<unknown> | null }) =>
  holder.field as unknown as Field<T>;
const capture = () => {
  const holder: { field: Field<unknown> | null } = { field: null };
  return { holder, onCreate: (field: Field<unknown>) => (holder.field = field) };
};

const inputOf = (field: Field<unknown>) => field.cmp.elem.querySelector('input')!;
describe('the pane builder on the property grid (p806 D4)', () => {
  it('binds state keys, one-level paths and targets, a binding without a label named by its key', () => {
    const state = { speed: 1, helpers: { showGrid: true } };
    const target = { name: 'box' };
    const pane = build({ state }, [
      { key: 'speed', label: 'Speed' },
      { key: 'helpers.showGrid', label: 'Show grid' },
      { key: 'name', target },
    ]);
    const labels = [...pane.cmp.elem.querySelectorAll('.aekField__label')].map((l) =>
      l.textContent?.trim()
    );
    expect(labels).toEqual(['Speed', 'Show grid', 'name']);
    const checkbox = pane.cmp.elem.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    checkbox.click();
    expect(state.helpers.showGrid).toBe(false);
  });

  it('persists a persistKeys root on the gesture’s end only, then calls onChange with the kit’s change', () => {
    const state = { speed: 1, other: 5 };
    const { holder, onCreate } = capture();
    const changes: { last: boolean; prev: unknown; lsAtCall: unknown }[] = [];
    build({ state, lsKey: 'AEK_test', persistKeys: ['speed'] }, [
      {
        key: 'speed',
        label: 'Speed',
        step: 1,
        onCreate,
        onChange: (_value, change) =>
          changes.push({ last: change.last, prev: change.prev, lsAtCall: readLS('AEK_test') }),
      },
    ]);
    const field = fieldOf<number>(holder);
    const input = inputOf(field as Field<unknown>);
    dispatchKey(input, 'keydown', 'ArrowUp');
    // A step: written, not persisted
    expect(state.speed).toBe(2);
    expect(readLS('AEK_test')).toBeNull();
    dispatchKey(input, 'keyup', 'ArrowUp');
    expect(readLS('AEK_test')).toEqual({ speed: 2 });
    expect(changes).toEqual([
      { last: false, prev: 1, lsAtCall: null },
      // Persisted before the handler; prev the value before the gesture
      { last: true, prev: 1, lsAtCall: { speed: 2 } },
    ]);
  });

  it('fires no onChange on a refresh, and takes `type: "binding"`', () => {
    const state = { speed: 1 };
    const onChange = vi.fn();
    const { holder, onCreate } = capture();
    const pane = build({ state }, [
      { type: 'binding', key: 'speed', label: 'Speed', onChange, onCreate },
    ]);
    state.speed = 7;
    pane.refresh();
    expect(inputOf(fieldOf(holder)).value).toBe('7.00');
    expect(onChange).not.toHaveBeenCalled();
  });

  it("maps `interval: 0` to the kit's refresh-only monitor", () => {
    vi.useFakeTimers();
    try {
      const stats = { count: 1 };
      const { holder, onCreate } = capture();
      const pane = build({}, [
        { key: 'count', target: stats, label: 'Count', readonly: true, interval: 0, onCreate },
      ]);
      const text = () => fieldOf(holder).cmp.elem.querySelector('.aekMonitor__value')!.textContent;
      stats.count = 2;
      vi.advanceTimersByTime(1000);
      expect(text()).toBe('1.00');
      pane.refresh();
      expect(text()).toBe('2.00');
    } finally {
      vi.useRealTimers();
    }
  });

  it('names the binding and the field a kit field doesn’t take', () => {
    const color = {
      key: 'tint',
      target: { tint: 0xff0000 },
      label: 'Tint',
      color: { type: 'float' },
    };
    expect(() => build({}, [color as unknown as DebuggerPaneItem<State>])).toThrow(
      'Debugger tab "testTab": the binding "Tint" has the field "color", which no UI kit field takes (a colour number is `kind: \'color\'` now)'
    );
    const view = { key: 'tint', target: { tint: 0xff0000 }, label: 'Tint', view: 'color' };
    expect(() => build({}, [view as unknown as DebuggerPaneItem<State>])).toThrow(
      /the binding "Tint" has `view: "color"` \(a colour is `kind: 'color'` now/
    );
  });

  it("gives a custom item its container and runs its function on every refresh; onCreate gets the field's handle", () => {
    const refreshes = vi.fn();
    let container: CMPHandle | null = null;
    const { holder, onCreate } = capture();
    const pane = build({}, [
      {
        type: 'custom',
        build: (cmp) => {
          container = cmp;
          cmp.add({ class: 'customRow', text: 'Mine' });
          return refreshes;
        },
      },
      { key: 'x', target: { x: 1 }, label: 'X', onCreate },
    ]);
    expect(container!.elem.querySelector('.customRow')?.textContent).toBe('Mine');
    expect(pane.cmp.elem.contains(container!.elem)).toBe(true);
    expect(typeof fieldOf(holder).setValue).toBe('function');
    pane.refresh();
    pane.refresh();
    expect(refreshes).toHaveBeenCalledTimes(2);
  });
});

describe('the saved UI states (5.x formats, p806 D3)', () => {
  const folder = (title: string, extra: object = {}): DebuggerPaneItem<State> => ({
    type: 'folder',
    title,
    ...extra,
    content: [{ key: 'v', target: { v: 1 }, label: `${title} value` }],
  });
  const isOpen = (pane: { cmp: CMPHandle }, title: string) =>
    [...pane.cmp.elem.querySelectorAll('.aekFolder')]
      .find((f) => f.querySelector('.aekFolder__title')?.textContent === title)
      ?.getAttribute('data-expanded') !== null;

  it("reads a 5.x uiLsKey's folder states by id and title path, and writes them back merged", () => {
    // What a 5.x drawer saved: an id, a title path inside a titled section, another module field
    storage.setItem(
      'AEK_testUI',
      JSON.stringify({ folders: { scenes: false, 'Section/Inner': false, Section: true }, x: 1 })
    );
    const pane = build(
      { state: {}, lsKey: 'AEK_test' },
      [folder('Scenes', { id: 'scenes' }), folder('Inner'), folder('Open')],
      { title: 'Section' }
    );
    expect(isOpen(pane, 'Scenes')).toBe(false);
    expect(isOpen(pane, 'Inner')).toBe(false);
    expect(isOpen(pane, 'Open')).toBe(true);
    expect(isOpen(pane, 'Section')).toBe(true);
    const toggle = [
      ...pane.cmp.elem.querySelectorAll<HTMLButtonElement>('.aekFolder__toggle'),
    ].find((b) => b.textContent?.includes('Open'))!;
    toggle.click();
    expect(readLS('AEK_testUI')).toEqual({
      folders: { scenes: false, 'Section/Inner': false, Section: true, 'Section/Open': false },
      x: 1,
    });
  });

  it('keeps a `persistExpanded: false` folder out of the saved states', () => {
    storage.setItem('AEK_testUI', JSON.stringify({ folders: { Live: false } }));
    const pane = build({ state: {}, lsKey: 'AEK_test' }, [
      folder('Live', { persistExpanded: false }),
    ]);
    expect(isOpen(pane, 'Live')).toBe(true);
    pane.cmp.elem.querySelector<HTMLButtonElement>('.aekFolder__toggle')!.click();
    expect(readLS('AEK_testUI')).toEqual({ folders: { Live: false } });
  });

  it('starts the label column at 50 %, or the saved labelWidth (a new key next to 5.x’s folders)', () => {
    const width = (pane: { cmp: CMPHandle }) =>
      pane.cmp.elem
        .querySelector<HTMLElement>('.aekPropertyGrid')
        ?.style.getPropertyValue('--aek-property-grid-label-width') ??
      (pane.cmp.elem as HTMLElement).style.getPropertyValue('--aek-property-grid-label-width');
    expect(width(build({ state: {}, lsKey: 'AEK_test' }, [folder('A')]))).toBe('50%');
    storage.setItem('AEK_testUI', JSON.stringify({ folders: {}, labelWidth: 35 }));
    expect(width(build({ state: {}, lsKey: 'AEK_test' }, [folder('B')]))).toBe('35%');
  });
});
