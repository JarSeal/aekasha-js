import { beforeAll, describe, expect, it, vi } from 'vitest';
import { countListeners, stubKitDomAsync } from '../testing/KitDom';
import { createHudRoot, getHUDRootCMP } from '../core/HUD';
import { createSplitButton } from './SplitButton';

const click = (target: EventTarget) =>
  target.dispatchEvent(new window.Event('click', { bubbles: true }));

beforeAll(async () => {
  await stubKitDomAsync();
  createHudRoot({ slot: document.getElementById('hudSlot') as HTMLElement });
});

describe('split button (p803 D10)', () => {
  it('is a group of the action and a menu button; each does its own', () => {
    const onClick = vi.fn();
    const onSelect = vi.fn();
    const split = createSplitButton({
      label: 'Save',
      variant: 'primary',
      onClick,
      items: [{ label: 'Save as…', onSelect }],
    });
    getHUDRootCMP().add(split.cmp);
    const elem = split.cmp.elem;
    expect(elem.className).toBe('aekButtonGroup aekSplitButton');
    expect(elem.getAttribute('role')).toBe('group');
    expect(elem.getAttribute('aria-label')).toBe('Save');
    expect([...elem.children]).toEqual([split.button.cmp.elem, split.menuButton.cmp.elem]);
    const menuButton = split.menuButton.cmp.elem;
    expect(menuButton.getAttribute('aria-label')).toBe('More options');
    expect(menuButton.getAttribute('aria-haspopup')).toBe('menu');
    expect(menuButton.getAttribute('data-variant')).toBe('primary');

    click(split.button.cmp.elem);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(split.menu.isOpen()).toBe(false);
    click(menuButton);
    expect(split.menu.isOpen()).toBe(true);
    expect(onClick).toHaveBeenCalledTimes(1);

    split.cmp.remove();
    expect(split.menu.isOpen()).toBe(false);
    expect(menuButton.hasAttribute('aria-haspopup')).toBe(false);
    expect(countListeners(menuButton)).toBe(0);
  });

  it('disables both buttons, and names the menu button as asked', () => {
    const split = createSplitButton({
      label: 'Export',
      menuLabel: 'Export formats',
      disabled: true,
      onClick: () => {},
      items: [],
    });
    expect(split.button.cmp.elem.hasAttribute('disabled')).toBe(true);
    expect(split.menuButton.cmp.elem.hasAttribute('disabled')).toBe(true);
    expect(split.menuButton.cmp.elem.getAttribute('aria-label')).toBe('Export formats');
    split.cmp.remove();
  });
});
