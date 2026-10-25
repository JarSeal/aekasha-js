import { beforeAll, describe, expect, it, vi } from 'vitest';
import { countListeners, stubKitDomAsync } from '../testing/KitDom';
import { createHudRoot, getHUDRootCMP } from '../core/HUD';
import { createEmptyState } from './EmptyState';

beforeAll(async () => {
  await stubKitDomAsync();
  createHudRoot({ slot: document.getElementById('hudSlot') as HTMLElement });
});

describe('empty state (p803 D10)', () => {
  it('shows its title and text, the text hidden when empty', () => {
    const empty = createEmptyState({ title: 'No matches' });
    const elem = empty.cmp.elem;
    const title = elem.querySelector('.aekEmptyState__title');
    const text = elem.querySelector('.aekEmptyState__text');
    expect(title?.tagName).toBe('P');
    expect(title?.textContent).toBe('No matches');
    expect(text?.hasAttribute('hidden')).toBe(true);
    expect(elem.querySelector('.aekEmptyState__icon')).toBe(null);
    expect(empty.action).toBe(null);
    empty.setText('Try another word.');
    expect(text?.textContent).toBe('Try another word.');
    expect(text?.hasAttribute('hidden')).toBe(false);
    empty.setTitle('Nothing found');
    expect(title?.textContent).toBe('Nothing found');
    empty.cmp.remove();
  });

  it('draws a hidden icon, a heading at its level and its action, removed with it', () => {
    const onClick = vi.fn();
    const empty = createEmptyState({
      title: 'No saved games',
      text: 'Your saves show here.',
      icon: '<svg></svg>',
      headingLevel: 3,
      action: { label: 'New game', variant: 'primary', onClick },
    });
    getHUDRootCMP().add(empty.cmp);
    const elem = empty.cmp.elem;
    expect(elem.querySelector('.aekEmptyState__icon')?.getAttribute('aria-hidden')).toBe('true');
    expect(elem.querySelector('.aekEmptyState__title')?.tagName).toBe('H3');
    const button = empty.action?.cmp.elem as HTMLElement;
    expect(button.parentElement).toBe(elem);
    expect(button.classList.contains('aekEmptyState__action')).toBe(true);
    expect(button.getAttribute('data-variant')).toBe('primary');
    button.dispatchEvent(new window.Event('click'));
    expect(onClick).toHaveBeenCalledTimes(1);
    empty.cmp.remove();
    expect(elem.isConnected).toBe(false);
    expect(countListeners(button)).toBe(0);
  });
});
