import { beforeAll, describe, expect, it, vi } from 'vitest';
import { countListeners, stubKitDomAsync } from '../testing/KitDom';
import { createHudRoot, getHUDRootCMP } from '../core/HUD';
import { createLink, type LinkProps } from './Link';

/** A link added to the HUD root (so it's in the document) */
const addLink = (props: LinkProps) => {
  const link = createLink(props);
  getHUDRootCMP().add(link.cmp);
  return link;
};

const getHiddenText = (elem: HTMLElement) => elem.querySelector('.aekVisuallyHidden')?.textContent;

beforeAll(async () => {
  await stubKitDomAsync();
  createHudRoot({ slot: document.getElementById('hudSlot') as HTMLElement });
});

describe('link (p803 D10)', () => {
  it('is an <a> to its href with its label; a local one opens in place', () => {
    const { cmp } = addLink({ href: '/credits', label: 'Credits' });
    const elem = cmp.elem;
    expect(elem.tagName).toBe('A');
    expect(elem.className).toBe('aekLink');
    expect(elem.getAttribute('href')).toBe('/credits');
    expect(elem.querySelector('.aekLink__label')?.textContent).toBe('Credits');
    expect(elem.hasAttribute('target')).toBe(false);
    expect(elem.querySelector('.aekLink__external')).toBeNull();
    cmp.remove();
  });

  it('opens another origin in a new tab, marked, and says so to assistive tech', () => {
    const { cmp } = addLink({ href: 'https://example.com/manual', label: 'The manual' });
    const elem = cmp.elem;
    expect(elem.getAttribute('target')).toBe('_blank');
    expect(elem.getAttribute('rel')).toBe('noopener noreferrer');
    expect(elem.querySelector('.aekLink__external svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(getHiddenText(elem)).toBe(' (opens in a new tab)');
    cmp.remove();
  });

  it('reads the origin from the page: its own absolute address opens in place', () => {
    const original = (globalThis as { location?: Location }).location;
    vi.stubGlobal('location', { href: 'https://my.game/menu', origin: 'https://my.game' });
    const own = addLink({ href: 'https://my.game/credits', label: 'Credits' });
    expect(own.cmp.elem.hasAttribute('target')).toBe(false);
    const other = addLink({ href: 'https://example.com', label: 'Example' });
    expect(other.cmp.elem.getAttribute('target')).toBe('_blank');
    const mail = addLink({ href: 'mailto:team@my.game', label: 'Mail us' });
    expect(mail.cmp.elem.hasAttribute('target')).toBe(false);
    vi.stubGlobal('location', original);
    for (const link of [own, other, mail]) link.cmp.remove();
  });

  it('takes external from its prop, and setHref moves the mark in and out', () => {
    const forced = addLink({ href: '/manual.pdf', label: 'Manual', external: true });
    expect(forced.cmp.elem.getAttribute('target')).toBe('_blank');
    forced.cmp.remove();

    const link = addLink({ href: '/docs', label: 'Docs' });
    link.setHref('https://example.com/docs');
    expect(link.cmp.elem.getAttribute('href')).toBe('https://example.com/docs');
    expect(link.cmp.elem.querySelectorAll('.aekLink__external')).toHaveLength(1);
    link.setHref('https://example.org/docs');
    expect(link.cmp.elem.querySelectorAll('.aekLink__external')).toHaveLength(1);
    link.setHref('/docs');
    expect(link.cmp.elem.hasAttribute('target')).toBe(false);
    expect(link.cmp.elem.hasAttribute('rel')).toBe(false);
    expect(link.cmp.elem.querySelector('.aekLink__external')).toBeNull();
    expect(getHiddenText(link.cmp.elem)).toBeUndefined();
    link.setLabel('The docs');
    expect(link.cmp.elem.querySelector('.aekLink__label')?.textContent).toBe('The docs');
    link.cmp.remove();
  });

  it('as a button: a link with the button’s classes; its click and tooltip go with it', () => {
    const onClick = vi.fn();
    const link = addLink({
      href: '/play',
      label: 'Play',
      appearance: 'button',
      variant: 'primary',
      icon: '<svg></svg>',
      tooltip: 'Starts the game',
      onClick,
    });
    const elem = link.cmp.elem;
    expect(elem.className).toBe('aekLink aekButton');
    expect(elem.getAttribute('data-variant')).toBe('primary');
    expect(elem.getAttribute('data-size')).toBe('md');
    expect([...elem.children].map((c) => c.className)).toEqual(['aekLink__icon', 'aekLink__label']);
    expect(elem.getAttribute('aria-describedby')).toMatch(/\S/);
    elem.dispatchEvent(new window.Event('click'));
    expect(onClick).toHaveBeenCalledTimes(1);
    link.cmp.remove();
    expect(countListeners(elem)).toBe(0);
    expect(elem.hasAttribute('aria-describedby')).toBe(false);
  });
});
