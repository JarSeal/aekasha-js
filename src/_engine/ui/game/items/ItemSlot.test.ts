import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { countListeners, dispatchPointer, stubKitDomAsync } from '../../testing/KitDom';
import { CMP } from '../../core/CMP';
import { registerIcon } from '../../core/icons/SvgIcon';
import { createItemSlot } from './ItemSlot';
import type { GameItem } from './ItemTypes';

const part = (elem: Element, name: string) =>
  elem.querySelector(`.aekItemSlot__${name}`) as HTMLElement;

const SWORD: GameItem = { id: 'sword', name: 'Iron sword', icon: 'testSword', rarity: 'rare' };
const POTION: GameItem = { id: 'potion', name: 'Health potion', image: '/potion.png', count: 5 };

beforeAll(async () => {
  await stubKitDomAsync();
  registerIcon('testSword', '<svg viewBox="0 0 16 16"><path d="M0 0h16"/></svg>');
});

afterEach(() => {
  vi.useRealTimers();
});

describe('item slot (p808 D11)', () => {
  it('is a button named by its item, its picture, count and key hint hidden', () => {
    const slot = createItemSlot({ item: POTION, keyHint: '1' });
    const elem = slot.cmp.elem;
    expect(elem.tagName).toBe('BUTTON');
    expect(elem.getAttribute('type')).toBe('button');
    expect(elem.getAttribute('data-size')).toBe('md');
    expect(elem.hasAttribute('aria-pressed')).toBe(false);
    expect(part(elem, 'spoken').textContent).toBe('Health potion, 5');
    expect(part(elem, 'icon').getAttribute('aria-hidden')).toBe('true');
    const img = part(elem, 'icon').querySelector('img') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe('/potion.png');
    expect(img.getAttribute('alt')).toBe('');
    expect(part(elem, 'count').textContent).toBe('5');
    expect(part(elem, 'count').getAttribute('aria-hidden')).toBe('true');
    expect(part(elem, 'key').getAttribute('aria-hidden')).toBe('true');
    expect(part(elem, 'key').querySelector('.aekKbd')?.textContent).toBe('1');
    expect(elem.getAttribute('aria-keyshortcuts')).toBe('1');
    slot.cmp.remove();
  });

  it('reads the rarity, and an empty slot as empty', () => {
    const slot = createItemSlot({ item: SWORD, size: 'lg' });
    const elem = slot.cmp.elem;
    expect(elem.getAttribute('data-rarity')).toBe('rare');
    expect(elem.getAttribute('data-size')).toBe('lg');
    expect(part(elem, 'spoken').textContent).toBe('Iron sword, Rare');
    expect(part(elem, 'icon').querySelector('svg')).not.toBeNull();
    expect(part(elem, 'count').textContent).toBe('');
    slot.setItem({ ...SWORD, rarityLabel: 'Masterwork' });
    expect(part(elem, 'spoken').textContent).toBe('Iron sword, Masterwork');
    slot.setItem(null);
    expect(slot.getItem()).toBeNull();
    expect(elem.hasAttribute('data-empty')).toBe(true);
    expect(elem.hasAttribute('data-rarity')).toBe(false);
    expect(part(elem, 'spoken').textContent).toBe('Empty slot');
    expect(part(elem, 'icon').childNodes.length).toBe(0);
    slot.cmp.remove();
    const named = createItemSlot({ emptyLabel: 'Off hand' });
    expect(part(named.cmp.elem, 'spoken').textContent).toBe('Off hand');
    named.cmp.remove();
  });

  it('makes the picture again only when the icon changes, and a function’s for each slot', () => {
    const makeIcon = vi.fn(() => document.createElement('canvas'));
    const gem: GameItem = { id: 'gem', name: 'Gem', icon: makeIcon, count: 2 };
    const slot = createItemSlot({ item: gem });
    const other = createItemSlot({ item: gem });
    expect(makeIcon).toHaveBeenCalledTimes(2);
    slot.setItem({ ...gem, count: 3 });
    expect(makeIcon).toHaveBeenCalledTimes(2);
    expect(part(slot.cmp.elem, 'count').textContent).toBe('3');
    slot.setItem(POTION);
    expect(part(slot.cmp.elem, 'icon').querySelector('img')).not.toBeNull();
    slot.cmp.remove();
    other.cmp.remove();
  });

  it('writes a count only when it changes', () => {
    const slot = createItemSlot({ item: POTION });
    const elem = slot.cmp.elem;
    part(elem, 'count').textContent = 'marked';
    part(elem, 'spoken').textContent = 'marked';
    slot.setCount(5);
    expect(part(elem, 'count').textContent).toBe('marked');
    expect(part(elem, 'spoken').textContent).toBe('marked');
    slot.setCount(1);
    expect(part(elem, 'count').textContent).toBe('');
    expect(part(elem, 'spoken').textContent).toBe('Health potion');
    // The item object is the app's: unchanged
    expect(slot.getItem()).toBe(POTION);
    expect(POTION.count).toBe(5);
    slot.cmp.remove();
  });

  it('is a toggle once selected', () => {
    const slot = createItemSlot({ item: SWORD });
    expect(slot.isSelected()).toBe(false);
    slot.setSelected(true);
    expect(slot.cmp.elem.getAttribute('aria-pressed')).toBe('true');
    expect(slot.isSelected()).toBe(true);
    slot.setSelected(false);
    expect(slot.cmp.elem.getAttribute('aria-pressed')).toBe('false');
    slot.cmp.remove();
    const pressed = createItemSlot({ item: SWORD, selected: true });
    expect(pressed.cmp.elem.getAttribute('aria-pressed')).toBe('true');
    pressed.cmp.remove();
  });

  it('runs a cooldown over itself, marking itself disabled while it runs', () => {
    vi.useFakeTimers();
    const onReady = vi.fn();
    const slot = createItemSlot({ item: POTION, cooldown: { onReady } });
    const elem = slot.cmp.elem;
    expect(elem.querySelector('.aekCooldown')).not.toBeNull();
    slot.cooldown?.start(1000);
    expect(elem.getAttribute('aria-disabled')).toBe('true');
    // The cooldown's description is hidden: not part of the name
    expect(part(elem, 'spoken').textContent).toBe('Health potion, 5');
    vi.advanceTimersByTime(1000);
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(elem.hasAttribute('aria-disabled')).toBe(false);
    slot.cooldown?.start(1000);
    slot.cmp.remove();
    expect(vi.getTimerCount()).toBe(0);
    expect(createItemSlot({}).cooldown).toBeNull();
  });

  it('calls onClick, draws a handle’s key hint and removes it with itself', () => {
    const onClick = vi.fn();
    const glyph = CMP({ tag: 'span', class: 'glyph', text: 'A' });
    const slot = createItemSlot({ item: SWORD, onClick, keyHint: { cmp: glyph } });
    const elem = slot.cmp.elem;
    expect(part(elem, 'key').contains(glyph.elem)).toBe(true);
    expect(elem.hasAttribute('aria-keyshortcuts')).toBe(false);
    dispatchPointer(part(elem, 'icon'), 'click');
    expect(onClick).toHaveBeenCalledTimes(1);
    slot.cmp.remove();
    expect(glyph.elem.parentNode).toBeNull();
    expect(countListeners(elem)).toBe(0);
  });
});
