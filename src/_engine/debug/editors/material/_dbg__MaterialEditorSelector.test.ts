import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { countListeners, dispatchKey, stubKitDomAsync } from '../../../ui/testing/KitDom';
import { CMP } from '../../../ui/core/CMP';
import type { CMPHandle } from '../../../ui/core/CMPTypes';
import {
  createMaterialSelector,
  type MaterialSelectorEntry,
  type MaterialSelectorOpts,
  SELECTOR_DEFAULT_HEIGHT,
} from './_dbg__MaterialEditorSelector';

beforeAll(async () => {
  await stubKitDomAsync();
});

const parents: CMPHandle[] = [];
afterEach(() => {
  for (const parent of parents.splice(0)) parent.remove();
});

const ENTRIES: MaterialSelectorEntry[] = [
  { id: 'rock', name: 'Rock', type: 'STANDARDNODEMATERIAL', isTsl: false, swatch: '#777' },
  { id: 'grid', name: 'Grid', type: 'BASICNODEMATERIAL', isTsl: true, swatch: null },
  {
    id: 'old',
    name: 'Old',
    type: 'STANDARDNODEMATERIAL',
    isTsl: true,
    swatch: null,
    unavailableReason: 'no TSL graph',
  },
  { id: 'water', name: 'Water', type: 'PHYSICALNODEMATERIAL', isTsl: false, swatch: null },
];

const mount = (opts: Partial<MaterialSelectorOpts> = {}) => {
  const parent = CMP({});
  document.body.append(parent.elem);
  parents.push(parent);
  const onSelect = vi.fn();
  const onStateChange = vi.fn();
  const selector = createMaterialSelector({
    parent,
    entries: ENTRIES,
    onSelect,
    getSelectedId: () => null,
    getLoadingId: () => null,
    getFailure: () => undefined,
    onStateChange,
    ...opts,
  });
  const cards = () => [...selector.elem.querySelectorAll<HTMLButtonElement>('button[data-id]')];
  const shownIds = () =>
    cards()
      .filter((c) => !c.hidden)
      .map((c) => c.dataset.id);
  return { selector, parent, onSelect, onStateChange, cards, shownIds };
};

/** A key's keydown and keyup (a used key's keyup is swallowed once: none may be left over) */
const press = (target: HTMLElement, key: string) => {
  const down = dispatchKey(target, 'keydown', key);
  dispatchKey(target, 'keyup', key);
  return down;
};

const getHandle = (elem: HTMLElement) =>
  elem.querySelector<HTMLElement>('[role="separator"]') as HTMLElement;

describe('the material selector on the kit (p806 D10)', () => {
  it('is a named region of kit-button cards in a toolbar, sorted by name, one tab stop', () => {
    const { selector, cards } = mount();
    const title = selector.elem.querySelector('h3');
    expect(selector.elem.tagName).toBe('SECTION');
    expect(selector.elem.getAttribute('aria-labelledby')).toBe(title?.id);
    const toolbar = selector.elem.querySelector('[role="toolbar"]');
    expect(toolbar?.getAttribute('aria-label')).toBe('Materials');
    expect(cards().map((c) => c.dataset.id)).toEqual(['grid', 'old', 'rock', 'water']);
    expect(cards().every((c) => c.classList.contains('aekButton'))).toBe(true);
    expect(cards().map((c) => c.getAttribute('tabindex'))).toEqual(['0', '-1', '-1', '-1']);
    // The id and the badges after the name
    expect(cards()[0].textContent).toContain('Grid');
    expect(cards()[0].textContent).toContain('grid');
    expect(cards()[0].textContent).toContain('TSL');
    expect(cards()[1].getAttribute('aria-disabled')).toBe('true');
  });

  it('filters by id and name from its search field, counting the shown cards', () => {
    const { selector, shownIds, onStateChange } = mount();
    const input = selector.elem.querySelector<HTMLInputElement>('[role="searchbox"]')!;
    expect(input).toBeTruthy();
    input.value = 'r';
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    expect(shownIds()).toEqual(['grid', 'rock', 'water']);
    expect(selector.elem.textContent).toContain('3 / 4');
    expect(selector.getState().filterText).toBe('r');
    expect(onStateChange).toHaveBeenLastCalledWith(expect.objectContaining({ filterText: 'r' }));
    input.value = 'zzz';
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    expect(shownIds()).toEqual([]);
    expect(selector.elem.textContent).toContain('No material matches the filter.');
  });

  it('starts from the saved filter', () => {
    const { shownIds } = mount({ initialState: { filterText: 'wat' } });
    expect(shownIds()).toEqual(['water']);
  });

  it('moves the focus with the arrows and Home / End over the shown cards, rows by Up / Down', () => {
    const { cards } = mount();
    const [grid, old, rock, water] = cards();
    // Two columns: the first two cards share a row
    const tops = [0, 0, 40, 40];
    cards().forEach((card, i) => Object.defineProperty(card, 'offsetTop', { value: tops[i] }));
    grid.focus();
    expect(press(grid, 'ArrowRight').defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(old);
    expect(old.getAttribute('tabindex')).toBe('0');
    press(old, 'ArrowDown');
    expect(document.activeElement).toBe(water);
    press(water, 'ArrowUp');
    expect(document.activeElement).toBe(old);
    press(old, 'End');
    expect(document.activeElement).toBe(water);
    press(water, 'Home');
    expect(document.activeElement).toBe(grid);
    // At an end the key is used up, the focus stays
    expect(press(grid, 'ArrowLeft').defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(grid);
    void rock;
  });

  it('picks a card by its click, never an unavailable one', () => {
    const { cards, onSelect } = mount();
    cards()[2].click();
    expect(onSelect).toHaveBeenCalledWith('rock');
    cards()[1].click();
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('marks the shown, loading and failed materials on refresh', () => {
    let selected: string | null = 'rock';
    const failures = new Map<string, string>();
    const { selector, cards } = mount({
      getSelectedId: () => selected,
      getLoadingId: () => 'water',
      getFailure: (id) => failures.get(id),
    });
    const byId = (id: string) => cards().find((c) => c.dataset.id === id)!;
    expect(byId('rock').getAttribute('aria-current')).toBe('true');
    expect(byId('water').getAttribute('aria-busy')).toBe('true');
    selected = 'grid';
    failures.set('grid', 'compile error');
    selector.refresh();
    expect(byId('rock').hasAttribute('aria-current')).toBe(false);
    expect(byId('grid').getAttribute('aria-current')).toBe('true');
    expect(byId('grid').hasAttribute('data-failed')).toBe(true);
  });

  it('collapses and restores by its button and by Enter on its height handle', () => {
    const { selector, onStateChange } = mount();
    const toggle = selector.elem.querySelector<HTMLButtonElement>('[aria-expanded]')!;
    const body = selector.elem.querySelector<HTMLElement>(
      `#${toggle.getAttribute('aria-controls')}`
    )!;
    expect(toggle.getAttribute('aria-label')).toBe('Collapse the materials');
    toggle.click();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.getAttribute('aria-label')).toBe('Expand the materials');
    expect(body.hidden).toBe(true);
    expect(onStateChange).toHaveBeenLastCalledWith(expect.objectContaining({ isOpen: false }));
    const handle = getHandle(selector.elem);
    expect(handle.getAttribute('aria-valuetext')).toBe('Collapsed');
    dispatchKey(handle, 'keydown', 'Enter');
    expect(body.hidden).toBe(false);
    expect(selector.getState().isOpen).toBe(true);
  });

  it('heightens by ArrowUp on its handle, saving the height on the keyup', () => {
    const { selector, onStateChange } = mount();
    const handle = getHandle(selector.elem);
    expect(handle.getAttribute('aria-label')).toBe('Materials height');
    expect(handle.getAttribute('aria-orientation')).toBe('horizontal');
    expect(handle.getAttribute('aria-valuenow')).toBe(String(SELECTOR_DEFAULT_HEIGHT));
    dispatchKey(handle, 'keydown', 'ArrowUp');
    expect(handle.getAttribute('aria-valuenow')).toBe(String(SELECTOR_DEFAULT_HEIGHT + 10));
    expect(selector.getState().height).toBeUndefined();
    dispatchKey(handle, 'keyup', 'ArrowUp');
    expect(selector.getState().height).toBe(SELECTOR_DEFAULT_HEIGHT + 10);
    expect(onStateChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ height: SELECTOR_DEFAULT_HEIGHT + 10 })
    );
    dispatchKey(handle, 'keydown', 'Home');
    expect(handle.getAttribute('aria-valuenow')).toBe('80');
  });

  it('starts at the saved height, and leaves no listener on its toolbar and handle', () => {
    const { selector } = mount({ initialState: { height: 220 } });
    const handle = getHandle(selector.elem);
    const toolbar = selector.elem.querySelector<HTMLElement>('[role="toolbar"]')!;
    expect(handle.getAttribute('aria-valuenow')).toBe('220');
    expect(countListeners(toolbar)).toBeGreaterThan(0);
    selector.dispose();
    expect(countListeners(toolbar)).toBe(0);
    expect(countListeners(handle)).toBe(0);
    expect(selector.elem.isConnected).toBe(false);
  });
});
