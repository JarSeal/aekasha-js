import { beforeAll, describe, expect, it, vi } from 'vitest';
import { countListeners, dispatchKey, stubKitDomAsync } from '../testing/KitDom';
import { CMP } from '../core/CMP';
import { createHudRoot, getHUDRootCMP } from '../core/HUD';
import { createTabs, type TabDef, type TabsProps } from './Tabs';

const click = (target: EventTarget) =>
  target.dispatchEvent(new window.Event('click', { bubbles: true }));

/** A tab whose content is a panel CMP with its label as text */
const tab = (key: string, extra: Partial<TabDef> = {}): TabDef => ({
  key,
  label: key.toUpperCase(),
  content: CMP({ text: `${key} panel` }),
  ...extra,
});

/** Tabs of `keys` added to the HUD root */
const addTabs = (keys: string[], props: Partial<TabsProps> = {}) => {
  const tabs = createTabs({ label: 'Inspector', tabs: keys.map((key) => tab(key)), ...props });
  getHUDRootCMP().add(tabs.cmp);
  const list = tabs.cmp.elem.querySelector('.aekTabs__list') as HTMLElement;
  const getTabs = () => [...list.querySelectorAll('.aekTabs__tab')] as HTMLElement[];
  const getPanels = () => [...tabs.cmp.elem.querySelectorAll('.aekTabs__panel')] as HTMLElement[];
  return { tabs, list, getTabs, getPanels };
};

const getSelectedFlags = (elems: HTMLElement[]) =>
  elems.map((e) => e.getAttribute('aria-selected'));
const getTabIndices = (elems: HTMLElement[]) => elems.map((e) => e.getAttribute('tabindex'));
const getHidden = (elems: HTMLElement[]) => elems.map((e) => e.hasAttribute('hidden'));

beforeAll(async () => {
  await stubKitDomAsync();
  createHudRoot({ slot: document.getElementById('hudSlot') as HTMLElement });
});

describe('tabs (p805 D10)', () => {
  it('is a named tab list over panels, the first tab selected', () => {
    const { tabs, list, getTabs, getPanels } = addTabs(['a', 'b', 'c']);
    const elem = tabs.cmp.elem;
    expect(elem.className).toBe('aekTabs');
    expect(elem.getAttribute('data-orientation')).toBe('horizontal');
    expect(list.getAttribute('role')).toBe('tablist');
    expect(list.getAttribute('aria-label')).toBe('Inspector');
    expect(list.hasAttribute('aria-orientation')).toBe(false);
    const tabElems = getTabs();
    const panels = getPanels();
    expect(tabElems.map((t) => t.getAttribute('role'))).toEqual(['tab', 'tab', 'tab']);
    expect(tabElems.map((t) => t.getAttribute('data-tab-key'))).toEqual(['a', 'b', 'c']);
    expect(tabElems.map((t) => t.textContent)).toEqual(['A', 'B', 'C']);
    expect(getSelectedFlags(tabElems)).toEqual(['true', 'false', 'false']);
    expect(getTabIndices(tabElems)).toEqual(['0', '-1', '-1']);
    for (let i = 0; i < 3; i++) {
      expect(panels[i].getAttribute('role')).toBe('tabpanel');
      expect(panels[i].getAttribute('tabindex')).toBe('0');
      expect(tabElems[i].getAttribute('aria-controls')).toBe(panels[i].id);
      expect(panels[i].getAttribute('aria-labelledby')).toBe(tabElems[i].id);
    }
    expect(getHidden(panels)).toEqual([false, true, true]);
    // Only the shown panel's content is in
    expect(panels.map((p) => p.textContent)).toEqual(['a panel', '', '']);
    expect(tabs.getSelected()).toBe('a');
    tabs.cmp.remove();
  });

  it('a click selects a tab and reports it; the selected one again changes nothing', () => {
    const onSelect = vi.fn();
    const { tabs, getTabs, getPanels } = addTabs(['a', 'b'], { onSelect });
    click(getTabs()[1].querySelector('.aekTabs__label') as HTMLElement);
    expect(onSelect).toHaveBeenCalledWith('b');
    expect(getSelectedFlags(getTabs())).toEqual(['false', 'true']);
    expect(getHidden(getPanels())).toEqual([true, false]);
    expect(getTabIndices(getTabs())).toEqual(['-1', '0']);
    click(getTabs()[1]);
    expect(onSelect).toHaveBeenCalledTimes(1);
    tabs.cmp.remove();
  });

  it('automatic: the arrows, Home and End move the focus and select, wrapping, skipping disabled', () => {
    const onSelect = vi.fn();
    const tabs = createTabs({
      label: 'Views',
      tabs: [tab('a'), tab('b'), tab('c', { disabled: true }), tab('d')],
      onSelect,
    });
    getHUDRootCMP().add(tabs.cmp);
    const elems = [...tabs.cmp.elem.querySelectorAll('.aekTabs__tab')] as HTMLElement[];
    expect(elems[2].hasAttribute('disabled')).toBe(true);
    elems[0].focus();
    expect(dispatchKey(elems[0], 'keydown', 'ArrowRight').defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(elems[1]);
    expect(tabs.getSelected()).toBe('b');
    dispatchKey(elems[1], 'keydown', 'ArrowRight');
    expect(document.activeElement).toBe(elems[3]);
    dispatchKey(elems[3], 'keydown', 'ArrowRight');
    expect(document.activeElement).toBe(elems[0]);
    dispatchKey(elems[0], 'keydown', 'ArrowLeft');
    expect(document.activeElement).toBe(elems[3]);
    dispatchKey(elems[3], 'keydown', 'Home');
    expect(document.activeElement).toBe(elems[0]);
    dispatchKey(elems[0], 'keydown', 'End');
    expect(tabs.getSelected()).toBe('d');
    expect(onSelect.mock.calls.map(([key]) => key)).toEqual(['b', 'd', 'a', 'd', 'a', 'd']);
    expect(getTabIndices(elems)).toEqual(['-1', '-1', '-1', '0']);
    // Not its keys
    expect(dispatchKey(elems[3], 'keydown', 'ArrowDown').defaultPrevented).toBe(false);
    expect(dispatchKey(elems[3], 'keydown', 'Tab').defaultPrevented).toBe(false);
    // A disabled tab's click does nothing
    click(elems[2]);
    expect(tabs.getSelected()).toBe('d');
    tabs.cmp.remove();
  });

  it('manual: the arrows move only the focus; a click (Enter, Space) selects; leaving the list puts the tab stop back', () => {
    const onSelect = vi.fn();
    const { tabs, getTabs } = addTabs(['a', 'b', 'c'], { activation: 'manual', onSelect });
    const elems = getTabs();
    elems[0].focus();
    dispatchKey(elems[0], 'keydown', 'ArrowRight');
    expect(document.activeElement).toBe(elems[1]);
    expect(tabs.getSelected()).toBe('a');
    expect(getTabIndices(elems)).toEqual(['-1', '0', '-1']);
    dispatchKey(elems[1], 'keydown', 'ArrowRight');
    // Out of the list: back in lands on the selected tab
    const outside = document.createElement('button');
    document.body.append(outside);
    outside.focus();
    expect(getTabIndices(elems)).toEqual(['0', '-1', '-1']);
    elems[2].focus();
    // The button's own Enter or Space is a click
    click(elems[2]);
    expect(tabs.getSelected()).toBe('c');
    expect(onSelect).toHaveBeenCalledWith('c');
    outside.focus();
    expect(getTabIndices(elems)).toEqual(['-1', '-1', '0']);
    outside.remove();
    tabs.cmp.remove();
  });

  it('vertical: Up and Down move, and the tab list says its orientation', () => {
    const { tabs, list, getTabs } = addTabs(['a', 'b'], { orientation: 'vertical' });
    expect(list.getAttribute('aria-orientation')).toBe('vertical');
    expect(tabs.cmp.elem.getAttribute('data-orientation')).toBe('vertical');
    const elems = getTabs();
    elems[0].focus();
    expect(dispatchKey(elems[0], 'keydown', 'ArrowRight').defaultPrevented).toBe(false);
    dispatchKey(elems[0], 'keydown', 'ArrowDown');
    expect(document.activeElement).toBe(elems[1]);
    expect(tabs.getSelected()).toBe('b');
    tabs.cmp.remove();
  });

  it('builds a function panel on its first selection and keeps it, or removes it without keepMounted', () => {
    for (const keepMounted of [true, false]) {
      const build = vi.fn(() => CMP({ text: 'stats', onRemoveCmp: () => removed.push('stats') }));
      const removed: string[] = [];
      const tabs = createTabs({
        label: 'Inspector',
        tabs: [tab('a'), { key: 'stats', label: 'Stats', content: build }],
        keepMounted,
      });
      getHUDRootCMP().add(tabs.cmp);
      expect(build).not.toHaveBeenCalled();
      tabs.select('stats');
      expect(build).toHaveBeenCalledTimes(1);
      const panel = tabs.cmp.elem.querySelectorAll('.aekTabs__panel')[1] as HTMLElement;
      expect(panel.textContent).toBe('stats');
      tabs.select('a');
      expect(panel.hasAttribute('hidden')).toBe(true);
      expect(removed).toEqual(keepMounted ? [] : ['stats']);
      tabs.select('stats');
      expect(build).toHaveBeenCalledTimes(keepMounted ? 1 : 2);
      tabs.cmp.remove();
      expect(removed.length).toBe(keepMounted ? 1 : 2);
    }
  });

  it('select and the given selected key don’t report; an unknown key does nothing', () => {
    const onSelect = vi.fn();
    const { tabs, getTabs } = addTabs(['a', 'b', 'c'], { selected: 'c', onSelect });
    expect(tabs.getSelected()).toBe('c');
    expect(getTabIndices(getTabs())).toEqual(['-1', '-1', '0']);
    tabs.select('b');
    tabs.select('nope');
    expect(tabs.getSelected()).toBe('b');
    expect(onSelect).not.toHaveBeenCalled();
    tabs.cmp.remove();
  });

  it('an icon-only tab: the label visually hidden and its tooltip; a badge in its name, set in place', () => {
    const tabs = createTabs({
      label: 'Debugger',
      tabs: [
        tab('lights', { icon: '<svg></svg>', iconOnly: true, badge: 3 }),
        tab('errors', { badge: { label: 2, tone: 'danger', spokenLabel: '2 errors' } }),
      ],
    });
    getHUDRootCMP().add(tabs.cmp);
    const [lights, errors] = [...tabs.cmp.elem.querySelectorAll('.aekTabs__tab')] as HTMLElement[];
    expect(lights.hasAttribute('data-icon-only')).toBe(true);
    expect(lights.querySelector('.aekTabs__icon')?.getAttribute('aria-hidden')).toBe('true');
    expect(lights.querySelector('.aekTabs__label')?.className).toBe(
      'aekTabs__label aekVisuallyHidden'
    );
    expect(lights.textContent).toBe('LIGHTS3');
    // The tooltip describes it
    expect(lights.getAttribute('aria-describedby')).toBeTruthy();
    const badge = errors.querySelector('.aekTabs__badge') as HTMLElement;
    expect(badge.getAttribute('data-tone')).toBe('danger');
    expect(errors.textContent).toBe('ERRORS22 errors');
    tabs.setBadge('errors', 5);
    expect(errors.querySelector('.aekTabs__badge')).toBe(badge);
    expect(badge.getAttribute('data-tone')).toBe('neutral');
    expect(errors.textContent).toBe('ERRORS5');
    tabs.setBadge('errors', null);
    expect(errors.querySelector('.aekTabs__badge')).toBeNull();
    tabs.setBadge('errors', 'New');
    expect(errors.textContent).toBe('ERRORSNew');
    tabs.cmp.remove();
    expect(lights.hasAttribute('aria-describedby')).toBe(false);
  });

  it('setTabs keeps a kept key’s elements and content, adds and removes, and reorders', () => {
    const onSelect = vi.fn();
    const a = tab('a');
    const b = tab('b');
    const { tabs, getTabs, getPanels } = addTabs([], { onSelect });
    tabs.setTabs([a, b]);
    expect(tabs.getSelected()).toBeNull();
    tabs.select('b');
    const [tabA, tabB] = getTabs();
    const panelB = getPanels()[1];
    tabs.setTabs([tab('c'), { ...b, label: 'Bee' }, a]);
    expect(getTabs()).toEqual([expect.anything(), tabB, tabA]);
    expect(getPanels()[1]).toBe(panelB);
    expect(tabB.textContent).toBe('Bee');
    expect(panelB.textContent).toBe('b panel');
    expect(getTabIndices(getTabs())).toEqual(['-1', '0', '-1']);
    // New content for a kept key: built again
    tabs.setTabs([tab('c'), { ...b, content: CMP({ text: 'new b' }) }, a]);
    expect(panelB.textContent).toBe('new b');
    // The selected tab gone: the first enabled one takes its place, reported
    tabs.setTabs([tab('c', { disabled: true }), a]);
    expect(panelB.isConnected).toBe(false);
    expect(tabs.getSelected()).toBe('a');
    expect(onSelect).toHaveBeenCalledWith('a');
    expect(getTabIndices(getTabs())).toEqual(['-1', '0']);
    tabs.cmp.remove();
  });

  it('marks a tab with a divider before it, which the arrows cross (p806 D6)', () => {
    const { tabs, getTabs } = addTabs([], { orientation: 'vertical' });
    tabs.setTabs([tab('a'), tab('b', { separatorBefore: true })]);
    const elems = getTabs();
    expect(elems.map((e) => e.hasAttribute('data-separator-before'))).toEqual([false, true]);
    // The list holds the tabs alone
    expect(elems[0].parentElement?.children.length).toBe(2);
    elems[0].focus();
    dispatchKey(elems[0], 'keydown', 'ArrowDown');
    expect(document.activeElement).toBe(elems[1]);
    // setTabs writes it in place
    tabs.setTabs([tab('a'), tab('b')]);
    expect(elems[1].hasAttribute('data-separator-before')).toBe(false);
    tabs.cmp.remove();
  });

  it('removes its listeners, panels and tooltips with itself', () => {
    const { tabs, list, getTabs } = addTabs(['a', 'b'], { activation: 'manual' });
    expect(countListeners(list)).toBe(5);
    getTabs()[0].focus();
    dispatchKey(getTabs()[0], 'keydown', 'ArrowRight');
    tabs.cmp.remove();
    expect(countListeners(list)).toBe(0);
    expect(countListeners(tabs.cmp.elem)).toBe(0);
  });
});
