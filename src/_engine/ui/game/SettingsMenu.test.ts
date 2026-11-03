import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { countListeners, dispatchKey, dispatchPointer, stubKitDomAsync } from '../testing/KitDom';
import { CMP } from '../core/CMP';
import { createHudRoot, getHUDRootCMP } from '../core/HUD';
import { createSettingsMenu, type SettingsMenuProps, type SettingsPage } from './SettingsMenu';

const part = (elem: Element, name: string) =>
  elem.querySelector(`.aekSettingsMenu__${name}`) as HTMLElement;

const getTabs = (elem: Element) => [...elem.querySelectorAll('[role="tab"]')] as HTMLElement[];

const getRegion = () =>
  [...getHUDRootCMP().elem.children].find((child) => child.getAttribute('role') === 'status');

const click = (target: Element) => dispatchPointer(target, 'click');

/** The app's settings, fresh for each test */
const makeSettings = () => ({ volume: 0.8, music: true, uiScale: 1, quality: 'high' });

const makePages = (settings: ReturnType<typeof makeSettings>): SettingsPage[] => [
  {
    key: 'display',
    label: 'Display',
    items: [
      { target: settings, key: 'uiScale', label: 'UI scale', min: 0.5, max: 2, step: 0.1 },
      {
        type: 'folder',
        title: 'Graphics',
        items: [
          {
            target: settings,
            key: 'quality',
            label: 'Quality',
            options: { Low: 'low', High: 'high' },
          },
          { get: () => 60, label: 'FPS', readonly: true },
        ],
      },
    ],
  },
  {
    key: 'audio',
    label: 'Audio',
    items: [
      { target: settings, key: 'volume', label: 'Volume', min: 0, max: 1, step: 0.05 },
      { target: settings, key: 'music', label: 'Music', kind: 'switch' },
    ],
  },
];

const addMenu = (props: Partial<SettingsMenuProps> = {}) => {
  const settings = makeSettings();
  const menu = createSettingsMenu({ pages: makePages(settings), ...props });
  getHUDRootCMP().add(menu.cmp);
  return { menu, elem: menu.cmp.elem, settings };
};

beforeAll(async () => {
  await stubKitDomAsync();
  createHudRoot({ slot: document.getElementById('hudSlot') as HTMLElement });
});

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  // The announcer's region outlives a test: its pending text is written before the fake clock goes
  vi.runAllTimers();
  vi.useRealTimers();
});

describe('settings menu (p808 D9)', () => {
  it('shows its pages on named tabs, each a property grid of the app’s settings', () => {
    const { menu, elem } = addMenu({ selected: 'audio' });
    const list = elem.querySelector('[role="tablist"]');
    expect(list?.getAttribute('aria-label')).toBe('Settings');
    expect(getTabs(elem).map((tab) => tab.textContent)).toEqual(['Display', 'Audio']);
    expect(menu.getSelected()).toBe('audio');
    expect(elem.getAttribute('data-orientation')).toBe('horizontal');
    const audio = elem.querySelector('[data-page="audio"]');
    expect(audio?.querySelector('.aekPropertyGrid')).not.toBeNull();
    // Not resizable: a game's settings have no column separator
    expect(audio?.querySelector('.aekPropertyGrid__separator')).toBeNull();
    // Only the shown page is in the panels; the other is built but not added yet
    expect(elem.querySelector('[data-page="display"]')).toBeNull();
    // Its fields, not the read-only monitor
    expect(menu.getFields('display')).toHaveLength(2);
    expect(menu.getFields('audio').map((field) => field.getValue())).toEqual([0.8, true]);
    expect(menu.getFields('nope')).toEqual([]);
    menu.cmp.remove();
  });

  it('reports each change with its page and item, after the item’s own onChange', () => {
    const calls: string[] = [];
    const settings = makeSettings();
    const pages = makePages(settings);
    const volume = pages[1].items?.[0];
    if (!volume || volume.type) throw new Error('the volume item');
    const onItemChange = vi.fn(() => calls.push('item'));
    volume.onChange = onItemChange;
    const onChange = vi.fn(() => calls.push('menu'));
    const menu = createSettingsMenu({ pages, onChange });
    getHUDRootCMP().add(menu.cmp);
    const [volumeField] = menu.getFields('audio');
    volumeField.setValue(0.5, { silent: true });
    expect(onChange).not.toHaveBeenCalled();
    // A user's write (a reset is one); the switch at its default changes nothing
    volumeField.reset();
    menu.getFields('audio')[1].reset();
    expect(onChange).not.toHaveBeenCalledWith(expect.objectContaining({ page: 'display' }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        page: 'audio',
        item: volume,
        value: 0.8,
        change: expect.objectContaining({ last: true }),
      })
    );
    expect(settings.volume).toBe(0.8);
    expect(calls).toEqual(['item', 'menu']);
    menu.cmp.remove();
  });

  it('resets the shown page, or every page (never shown ones too), and announces it', () => {
    const onReset = vi.fn();
    const onChange = vi.fn();
    const onContentReset = vi.fn();
    const settings = makeSettings();
    const pages = makePages(settings);
    pages.push({ key: 'controls', label: 'Controls', content: CMP({}), onReset: onContentReset });
    const menu = createSettingsMenu({ pages, onReset, onChange, confirmResetAll: false });
    getHUDRootCMP().add(menu.cmp);
    const elem = menu.cmp.elem;
    Object.assign(settings, { volume: 0.1, music: false, uiScale: 1.5, quality: 'low' });
    menu.refresh();
    // The display page is shown: its reset leaves the audio page alone
    click(part(elem, 'resetPage'));
    expect(settings).toMatchObject({ uiScale: 1, quality: 'high', volume: 0.1, music: false });
    expect(onReset).toHaveBeenLastCalledWith('display');
    expect(onContentReset).not.toHaveBeenCalled();
    vi.advanceTimersByTime(50);
    expect(getRegion()?.textContent).toBe('Display reset to defaults');
    // Reset all reaches the audio page, never shown, and the content's reset
    onChange.mockClear();
    click(part(elem, 'resetAll'));
    expect(settings).toMatchObject({ volume: 0.8, music: true });
    expect(onChange.mock.calls.map(([change]) => change.item.key)).toEqual(['volume', 'music']);
    expect(onContentReset).toHaveBeenCalledTimes(1);
    expect(onReset).toHaveBeenLastCalledWith(null);
    vi.advanceTimersByTime(50);
    expect(getRegion()?.textContent).toBe('Every setting reset to its default');
    // A content page with its onReset can be reset; the API's reset announces nothing
    menu.resetPage('controls');
    expect(onContentReset).toHaveBeenCalledTimes(2);
    expect(onReset).toHaveBeenLastCalledWith('controls');
    menu.cmp.remove();
  });

  it('refreshes a page not shown, and one in a menu not in the document', () => {
    const { menu, elem, settings } = addMenu();
    settings.music = false;
    menu.refresh();
    menu.select('audio');
    const music = elem.querySelector<HTMLInputElement>(
      '[data-page="audio"] input[type="checkbox"]'
    );
    expect(music?.checked).toBe(false);
    elem.remove();
    settings.music = true;
    menu.refresh();
    expect(music?.checked).toBe(true);
    menu.cmp.remove();
  });

  it('disables Reset page on a page with nothing to reset', () => {
    const pages: SettingsPage[] = [
      { key: 'about', label: 'About', content: CMP({ text: 'v1' }) },
      { key: 'audio', label: 'Audio', items: makePages(makeSettings())[1].items },
    ];
    const menu = createSettingsMenu({ pages });
    getHUDRootCMP().add(menu.cmp);
    const button = part(menu.cmp.elem, 'resetPage');
    expect(button.hasAttribute('disabled')).toBe(true);
    menu.select('audio');
    expect(button.hasAttribute('disabled')).toBe(false);
    // The user's selection too
    click(getTabs(menu.cmp.elem)[0]);
    expect(button.hasAttribute('disabled')).toBe(true);
    menu.cmp.remove();
  });

  it('asks before Reset all, the focus on Cancel, and leaving the question cancels it', () => {
    const onReset = vi.fn();
    const { menu, elem, settings } = addMenu({ onReset });
    settings.volume = 0.2;
    menu.refresh();
    const actions = part(elem, 'actions');
    const question = part(elem, 'confirm');
    expect(question.hidden).toBe(true);
    expect(question.getAttribute('role')).toBe('group');
    expect(
      document.getElementById(question.getAttribute('aria-labelledby') ?? '')?.textContent
    ).toBe('Reset every setting to its default?');
    const resetAll = part(elem, 'resetAll');
    resetAll.focus();
    click(resetAll);
    expect(actions.hasAttribute('data-confirming')).toBe(true);
    expect(question.hidden).toBe(false);
    expect(resetAll.hasAttribute('hidden')).toBe(true);
    expect(part(elem, 'resetPage').hasAttribute('hidden')).toBe(true);
    expect(document.activeElement).toBe(part(elem, 'cancel'));
    expect(onReset).not.toHaveBeenCalled();
    // Cancel: the buttons back, the focus on Reset all
    click(part(elem, 'cancel'));
    expect(question.hidden).toBe(true);
    expect(resetAll.hasAttribute('hidden')).toBe(false);
    expect(document.activeElement).toBe(resetAll);
    expect(settings.volume).toBe(0.2);
    // The focus leaving it (Back in a game menu) is Cancel, without moving the focus
    click(resetAll);
    getTabs(elem)[0].focus();
    expect(question.hidden).toBe(true);
    expect(document.activeElement).toBe(getTabs(elem)[0]);
    // Moving within it isn't
    click(resetAll);
    part(elem, 'confirmReset').focus();
    expect(question.hidden).toBe(false);
    click(part(elem, 'confirmReset'));
    expect(settings.volume).toBe(0.8);
    expect(onReset).toHaveBeenCalledWith(null);
    expect(question.hidden).toBe(true);
    expect(document.activeElement).toBe(resetAll);
    menu.cmp.remove();
  });

  it('takes the question’s and the buttons’ texts', () => {
    const { menu, elem } = addMenu({
      resetPageLabel: 'Defaults',
      resetAllLabel: 'All defaults',
      confirmResetAll: { text: 'Sure?', cancelLabel: 'No' },
      resetDoneText: (label) => `Done: ${label ?? 'all'}`,
    });
    expect(part(elem, 'resetPage').textContent).toBe('Defaults');
    expect(part(elem, 'confirmText').textContent).toBe('Sure?');
    expect(part(elem, 'cancel').textContent).toBe('No');
    expect(part(elem, 'confirmReset').textContent).toBe('All defaults');
    click(part(elem, 'resetPage'));
    vi.advanceTimersByTime(50);
    expect(getRegion()?.textContent).toBe('Done: Display');
    menu.cmp.remove();
  });

  it('goes round its pages with selectNext, the focus following when it was in the menu', () => {
    const onSelect = vi.fn();
    const { menu, elem } = addMenu({ onSelect });
    menu.selectNext(1);
    expect(menu.getSelected()).toBe('audio');
    expect(onSelect).toHaveBeenLastCalledWith('audio');
    expect(elem.querySelector('[data-page="audio"]')).not.toBeNull();
    menu.selectNext(1);
    expect(menu.getSelected()).toBe('display');
    menu.selectNext(0.4);
    expect(onSelect).toHaveBeenCalledTimes(2);
    // In the shown page: the focus goes to the new page's tab, not into a hidden panel
    menu.getFields('display')[0].focus();
    menu.selectNext(-1);
    expect(document.activeElement).toBe(getTabs(elem)[1]);
    // select() reports nothing
    menu.select('display');
    expect(onSelect).toHaveBeenCalledTimes(3);
    menu.cmp.remove();
  });

  it('keeps Enter and Space on its buttons from the action maps', () => {
    const { menu, elem } = addMenu();
    const onWindowKey = vi.fn();
    window.addEventListener('keydown', onWindowKey);
    dispatchKey(part(elem, 'resetPage'), 'keydown', 'Enter');
    dispatchKey(part(elem, 'resetAll'), 'keydown', ' ');
    expect(onWindowKey).not.toHaveBeenCalled();
    dispatchKey(part(elem, 'resetAll'), 'keydown', 'a');
    expect(onWindowKey).toHaveBeenCalledTimes(1);
    window.removeEventListener('keydown', onWindowKey);
    menu.cmp.remove();
  });

  it('removes every page, shown or not, and leaves no listener', () => {
    const settings = makeSettings();
    const onShownRemoved = vi.fn();
    const onUnshownRemoved = vi.fn();
    const pages: SettingsPage[] = [
      { key: 'a', label: 'A', content: CMP({ onRemoveCmp: onShownRemoved }) },
      { key: 'b', label: 'B', content: CMP({ onRemoveCmp: onUnshownRemoved }) },
      ...makePages(settings),
    ];
    const before = countListeners(document);
    const menu = createSettingsMenu({ pages });
    getHUDRootCMP().add(menu.cmp);
    const actions = part(menu.cmp.elem, 'actions');
    click(part(menu.cmp.elem, 'resetAll'));
    menu.cmp.remove();
    expect(onShownRemoved).toHaveBeenCalledTimes(1);
    expect(onUnshownRemoved).toHaveBeenCalledTimes(1);
    expect(countListeners(actions)).toBe(0);
    expect(countListeners(part(actions, 'confirm') ?? actions)).toBe(0);
    expect(countListeners(document)).toBe(before);
    expect(menu.cmp.elem.isConnected).toBe(false);
  });
});
