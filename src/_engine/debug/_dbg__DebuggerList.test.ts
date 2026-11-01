import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { stubKitDomAsync } from '../ui/testing/KitDom';
import type { CMPHandle } from '../ui/core/CMPTypes';
import type { DebuggerListItem } from './DebuggerGUI';
import {
  _clickDebuggerListRow,
  _debuggerListCMP,
  _refreshDebuggerLists,
} from './_dbg__DebuggerList';

beforeAll(async () => {
  await stubKitDomAsync();
});

const lists: CMPHandle[] = [];
afterEach(() => {
  for (const list of lists.splice(0)) list.remove();
});

const mount = (list: CMPHandle) => {
  document.body.append(list.elem);
  lists.push(list);
  return list.elem;
};

const getRows = (elem: HTMLElement) =>
  [...elem.querySelectorAll<HTMLElement>('[data-key]')].filter((row) => !row.hidden);

describe('the debugger list on the kit’s list (p806 D6, p805 §4)', () => {
  it('maps an item’s parts to a row, a static list without a click or toggles', () => {
    const elem = mount(
      _debuggerListCMP({
        heading: 'Lanes',
        data: [
          { itemId: 'a', title: 'Alpha', subTitle: '[1]', suffix: '3 ms', description: 'First' },
          { itemId: 'b', title: 'Unnamed', titlePlaceholder: true, disabled: true },
        ],
      })
    );
    expect(elem.querySelector('.aekList__rows')?.getAttribute('data-mode')).toBe('static');
    expect(elem.querySelector('.aekList__headingText')?.textContent).toBe('Lanes');
    const [alpha, unnamed] = getRows(elem);
    expect(alpha.textContent).toContain('[1]');
    expect(alpha.textContent).toContain('Alpha');
    expect(alpha.textContent).toContain('First');
    expect(alpha.textContent).toContain('3 ms');
    // A static row says it with data-disabled (not a control)
    expect(unnamed.hasAttribute('data-disabled')).toBe(true);
  });

  it('is a listbox whose activation opens the item and whose selection is the open windows’', () => {
    const open = new Set<string>(['b']);
    const onClick = vi.fn((id: string) => (open.has(id) ? open.delete(id) : open.add(id)));
    const elem = mount(
      _debuggerListCMP({
        label: 'Assets',
        data: () => [
          { itemId: 'a', title: 'A' },
          { itemId: 'b', title: 'B' },
        ],
        selectedItemId: () => [...open],
        perItemConfig: { onClick },
      })
    );
    const box = elem.querySelector('[role="listbox"]');
    expect(box?.getAttribute('aria-label')).toBe('Assets');
    const selected = () => getRows(elem).map((row) => row.getAttribute('aria-selected') === 'true');
    expect(selected()).toEqual([false, true]);
    getRows(elem)[0].click();
    expect(onClick).toHaveBeenCalledWith('a');
    expect(selected()).toEqual([true, true]);
    // A window closed elsewhere: the refresh reads it
    open.clear();
    _refreshDebuggerLists(document.body);
    expect(selected()).toEqual([false, false]);
    // The test bridge's row click
    expect(_clickDebuggerListRow(document.body, 1)).toBe('b');
    expect(selected()).toEqual([false, true]);
  });

  it('makes the toggles the rows’ actions: pressed, hidden without a value, flipped', () => {
    const values = new Map<string, boolean>([['a', true]]);
    const fn = vi.fn((id: string, next: boolean) => values.set(id, next));
    const elem = mount(
      _debuggerListCMP({
        data: (): DebuggerListItem[] => [
          { itemId: 'a', title: 'A', toggleValues: [values.get('a') ?? null] },
          { itemId: 'b', title: 'B', toggleValues: [null] },
        ],
        perItemConfig: { toggles: [{ icon: 'gear', title: 'Wireframe', fn }] },
      })
    );
    expect(elem.querySelector('[role="grid"]')).not.toBeNull();
    const actionOf = (row: HTMLElement) =>
      row.querySelector<HTMLButtonElement>('.aekList__action') as HTMLButtonElement;
    const [a, b] = getRows(elem);
    expect(actionOf(a).getAttribute('aria-label')).toBe('Wireframe');
    expect(actionOf(a).getAttribute('aria-pressed')).toBe('true');
    // B's toggle hidden, its cell kept (the other rows' toggles stay aligned)
    expect(actionOf(b).hasAttribute('hidden')).toBe(true);
    expect(actionOf(a).hasAttribute('hidden')).toBe(false);
    actionOf(a).click();
    expect(fn).toHaveBeenCalledWith('a', false);
    expect(actionOf(getRows(elem)[0]).getAttribute('aria-pressed')).toBe('false');
  });

  it('flips a static list’s own copy of a toggle', () => {
    const fn = vi.fn();
    const data = [{ itemId: 'a', title: 'A', toggleValues: [false] }];
    const elem = mount(
      _debuggerListCMP({ data, perItemConfig: { toggles: [{ icon: 'gear', title: 'On', fn }] } })
    );
    const action = () => elem.querySelector<HTMLButtonElement>('.aekList__action');
    action()?.click();
    expect(fn).toHaveBeenCalledWith('a', true);
    expect(action()?.getAttribute('aria-pressed')).toBe('true');
    // The given array isn't changed
    expect(data[0].toggleValues).toEqual([false]);
  });

  it('shows its empty text without rows', () => {
    const elem = mount(_debuggerListCMP({ data: [], emptyText: 'No lights' }));
    expect(elem.textContent).toContain('No lights');
  });
});
