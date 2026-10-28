import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { countListeners, dispatchKey, stubKitDomAsync } from '../testing/KitDom';
import { CMP } from '../core/CMP';
import { createHudRoot, getHUDRootCMP } from '../core/HUD';
import { createAccordion, type AccordionItem, type AccordionProps } from './Accordion';

/** A section whose content is a CMP with its key as text */
const item = (key: string, extra: Partial<AccordionItem> = {}): AccordionItem => ({
  key,
  title: key.toUpperCase(),
  content: CMP({ text: `${key} panel` }),
  ...extra,
});

/** An accordion of `keys` at level 3, added to the HUD root */
const addAccordion = (keys: string[], props: Partial<AccordionProps> = {}) => {
  const accordion = createAccordion({ level: 3, items: keys.map((key) => item(key)), ...props });
  getHUDRootCMP().add(accordion.cmp);
  const elem = accordion.cmp.elem;
  const triggers = [...elem.querySelectorAll('.aekAccordion__trigger')] as HTMLButtonElement[];
  const regions = [...elem.querySelectorAll('.aekAccordion__region')] as HTMLElement[];
  const items = [...elem.querySelectorAll('.aekAccordion__item')] as HTMLElement[];
  return { accordion, elem, triggers, regions, items };
};

const getExpandedFlags = (triggers: HTMLElement[]) =>
  triggers.map((t) => t.getAttribute('aria-expanded'));
const getHidden = (elems: HTMLElement[]) => elems.map((e) => e.hasAttribute('hidden'));

beforeAll(async () => {
  await stubKitDomAsync();
  createHudRoot({ slot: document.getElementById('hudSlot') as HTMLElement });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('accordion (p805 D10)', () => {
  it('is headings of its level holding buttons over named regions, all shut by default', () => {
    const { accordion, elem, triggers, regions, items } = addAccordion(['a', 'b']);
    expect(elem.className).toBe('aekAccordion');
    for (let i = 0; i < 2; i++) {
      const heading = triggers[i].parentElement as HTMLElement;
      expect(heading.tagName).toBe('H3');
      expect(heading.className).toBe('aekAccordion__heading');
      expect(triggers[i].getAttribute('type')).toBe('button');
      expect(triggers[i].getAttribute('aria-controls')).toBe(regions[i].id);
      expect(regions[i].getAttribute('role')).toBe('region');
      expect(regions[i].getAttribute('aria-labelledby')).toBe(triggers[i].id);
    }
    expect(items.map((e) => e.getAttribute('data-key'))).toEqual(['a', 'b']);
    expect(triggers.map((t) => t.textContent)).toEqual(['A', 'B']);
    expect(triggers[0].querySelector('.aekAccordion__chevron')?.getAttribute('aria-hidden')).toBe(
      'true'
    );
    expect(getExpandedFlags(triggers)).toEqual(['false', 'false']);
    expect(getHidden(regions)).toEqual([true, true]);
    // Not built while shut
    expect(regions[0].textContent).toBe('');
    expect(accordion.getExpanded()).toEqual([]);
    accordion.cmp.remove();
  });

  it('past six sections the panels aren’t landmarks', () => {
    const { accordion, regions } = addAccordion(['a', 'b', 'c', 'd', 'e', 'f', 'g']);
    expect(regions.some((r) => r.hasAttribute('role'))).toBe(false);
    expect(regions.some((r) => r.hasAttribute('aria-labelledby'))).toBe(false);
    accordion.cmp.remove();
  });

  it('starts with its expanded keys open, drawn at once (one without multiple)', () => {
    const one = addAccordion(['a', 'b', 'c'], { expanded: ['b', 'c'] });
    expect(one.accordion.getExpanded()).toEqual(['b']);
    expect(one.items[1].hasAttribute('data-expanded')).toBe(true);
    expect(one.items[1].hasAttribute('data-animating')).toBe(false);
    expect(one.regions[1].textContent).toBe('b panel');
    one.accordion.cmp.remove();
    const several = addAccordion(['a', 'b', 'c'], { expanded: ['c', 'a'], multiple: true });
    expect(several.accordion.getExpanded()).toEqual(['a', 'c']);
    several.accordion.cmp.remove();
  });

  it('a click opens a section animated and reports it; one open at a time; again shuts it', () => {
    vi.useFakeTimers();
    const onExpandedChange = vi.fn();
    const { accordion, triggers, regions, items } = addAccordion(['a', 'b'], {
      expanded: ['a'],
      onExpandedChange,
    });
    // A click on the title's text is the header's
    (triggers[1].querySelector('.aekAccordion__title') as HTMLElement).click();
    expect(getExpandedFlags(triggers)).toEqual(['false', 'true']);
    expect(onExpandedChange).toHaveBeenLastCalledWith(['b']);
    expect(items[1].hasAttribute('data-expanded')).toBe(true);
    expect(items[1].hasAttribute('data-animating')).toBe(true);
    expect(regions[1].hasAttribute('hidden')).toBe(false);
    // The shut one is still shown while its height eases out
    expect(regions[0].hasAttribute('hidden')).toBe(false);
    vi.advanceTimersByTime(200);
    expect(getHidden(regions)).toEqual([true, false]);
    expect(items.some((e) => e.hasAttribute('data-animating'))).toBe(false);
    triggers[1].click();
    expect(onExpandedChange).toHaveBeenLastCalledWith([]);
    vi.advanceTimersByTime(200);
    expect(getHidden(regions)).toEqual([true, true]);
    expect(accordion.getExpanded()).toEqual([]);
    accordion.cmp.remove();
  });

  it('multiple: several open; a click in a panel isn’t a header’s', () => {
    const onExpandedChange = vi.fn();
    const { accordion, triggers, regions } = addAccordion(['a', 'b'], {
      multiple: true,
      onExpandedChange,
    });
    triggers[0].click();
    triggers[1].click();
    expect(accordion.getExpanded()).toEqual(['a', 'b']);
    expect(onExpandedChange).toHaveBeenLastCalledWith(['a', 'b']);
    (regions[0].querySelector('.aekAccordion__content > div') as HTMLElement).click();
    expect(onExpandedChange).toHaveBeenCalledTimes(2);
    accordion.cmp.remove();
  });

  it('builds a function panel on its first open and keeps it', () => {
    const build = vi.fn(() => CMP({ text: 'built' }));
    const accordion = createAccordion({
      level: 2,
      items: [item('a'), { key: 'lazy', title: 'Lazy', content: build }],
    });
    getHUDRootCMP().add(accordion.cmp);
    expect(build).not.toHaveBeenCalled();
    accordion.expand('lazy');
    accordion.collapse('lazy');
    accordion.expand('lazy');
    expect(build).toHaveBeenCalledTimes(1);
    expect(accordion.isExpanded('lazy')).toBe(true);
    expect(accordion.cmp.elem.querySelector('h2')).not.toBeNull();
    accordion.cmp.remove();
  });

  it('expand and collapse don’t report; expand shuts the open one; an unknown key does nothing', () => {
    const onExpandedChange = vi.fn();
    const { accordion } = addAccordion(['a', 'b'], { expanded: ['a'], onExpandedChange });
    accordion.expand('b');
    expect(accordion.getExpanded()).toEqual(['b']);
    accordion.expand('nope');
    accordion.collapse('nope');
    expect(accordion.isExpanded('nope')).toBe(false);
    accordion.collapse('b');
    expect(accordion.getExpanded()).toEqual([]);
    expect(onExpandedChange).not.toHaveBeenCalled();
    accordion.cmp.remove();
  });

  it('Up, Down, Home and End move between the enabled headers, wrapping; not from a panel', () => {
    const accordion = createAccordion({
      level: 3,
      items: [item('a'), item('b', { disabled: true }), item('c')],
      expanded: ['a'],
    });
    getHUDRootCMP().add(accordion.cmp);
    const triggers = [
      ...accordion.cmp.elem.querySelectorAll('.aekAccordion__trigger'),
    ] as HTMLButtonElement[];
    expect(triggers[1].disabled).toBe(true);
    triggers[0].focus();
    expect(dispatchKey(triggers[0], 'keydown', 'ArrowDown').defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(triggers[2]);
    dispatchKey(triggers[2], 'keydown', 'ArrowDown');
    expect(document.activeElement).toBe(triggers[0]);
    dispatchKey(triggers[0], 'keydown', 'ArrowUp');
    expect(document.activeElement).toBe(triggers[2]);
    dispatchKey(triggers[2], 'keydown', 'Home');
    expect(document.activeElement).toBe(triggers[0]);
    dispatchKey(triggers[0], 'keydown', 'End');
    expect(document.activeElement).toBe(triggers[2]);
    // Not its keys: the focus doesn't move and the browser's go on
    expect(dispatchKey(triggers[2], 'keydown', 'ArrowRight').defaultPrevented).toBe(false);
    const content = accordion.cmp.elem.querySelector('.aekAccordion__content') as HTMLElement;
    expect(dispatchKey(content, 'keydown', 'ArrowDown').defaultPrevented).toBe(false);
    // A disabled header's click does nothing
    triggers[1].dispatchEvent(new window.Event('click', { bubbles: true }));
    expect(accordion.getExpanded()).toEqual(['a']);
    accordion.cmp.remove();
  });

  it('shut with the focus inside, the focus goes to its header', () => {
    const input = CMP({ tag: 'input' });
    const accordion = createAccordion({
      level: 3,
      items: [{ key: 'a', title: 'A', content: input }],
      expanded: ['a'],
    });
    getHUDRootCMP().add(accordion.cmp);
    input.elem.focus();
    accordion.collapse('a');
    expect(document.activeElement).toBe(accordion.cmp.elem.querySelector('.aekAccordion__trigger'));
    accordion.cmp.remove();
  });

  it('under reduced motion opens and shuts at once', () => {
    const page = window as unknown as { getComputedStyle?: unknown };
    page.getComputedStyle = () => ({ getPropertyValue: () => '0' });
    const { accordion, regions, items } = addAccordion(['a']);
    accordion.expand('a');
    expect(items[0].hasAttribute('data-animating')).toBe(false);
    accordion.collapse('a');
    expect(regions[0].hasAttribute('hidden')).toBe(true);
    accordion.cmp.remove();
    delete page.getComputedStyle;
  });

  it('removes its listeners, content and timers with itself, mid-animation too', () => {
    vi.useFakeTimers();
    const removed: string[] = [];
    const accordion = createAccordion({
      level: 3,
      items: [{ key: 'a', title: 'A', content: CMP({ onRemoveCmp: () => removed.push('a') }) }],
    });
    getHUDRootCMP().add(accordion.cmp);
    expect(countListeners(accordion.cmp.elem)).toBe(2);
    accordion.expand('a');
    accordion.cmp.remove();
    expect(vi.getTimerCount()).toBe(0);
    expect(removed).toEqual(['a']);
    expect(countListeners(accordion.cmp.elem)).toBe(0);
  });
});
