import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { countListeners, dispatchKey, stubKitDomAsync } from '../testing/KitDom';
import { CMP } from '../core/CMP';
import { createHudRoot, getHUDRootCMP } from '../core/HUD';
import { createTooltip } from './Tooltip';

/** linkedom has no getComputedStyle: the delay's fallback, the token's default */
const DELAY_MS = 500;

let anchor: HTMLButtonElement;

const pointer = (target: EventTarget, type: string, relatedTarget: Node | null = null) =>
  target.dispatchEvent(Object.assign(new window.Event(type), { relatedTarget }));

const getTooltipElems = () => getHUDRootCMP().elem.querySelectorAll('.aekTooltip');

beforeAll(async () => {
  await stubKitDomAsync();
  createHudRoot({ slot: document.getElementById('hudSlot') as HTMLElement });
});

beforeEach(() => {
  vi.useFakeTimers();
  anchor = document.createElement('button');
  anchor.setAttribute('aria-describedby', 'hint');
  getHUDRootCMP().elem.appendChild(anchor);
});

afterEach(() => {
  anchor.remove();
  vi.useRealTimers();
});

describe('tooltip (p803 D10)', () => {
  it('describes its anchor, and its removal leaves the anchor as it was', () => {
    const tooltip = createTooltip({ anchor, text: 'Saves the scene' });
    expect(anchor.getAttribute('aria-describedby')).toBe(`hint ${tooltip.cmp.id}`);
    expect(tooltip.cmp.elem.getAttribute('role')).toBe('tooltip');
    tooltip.cmp.remove();
    expect(anchor.getAttribute('aria-describedby')).toBe('hint');
    expect(countListeners(anchor)).toBe(0);
  });

  it('shows after the delay of hover, in the HUD root, and hides when the pointer leaves', () => {
    const tooltip = createTooltip({ anchor, text: 'Saves the scene' });
    pointer(anchor, 'pointerenter');
    vi.advanceTimersByTime(DELAY_MS - 1);
    expect(tooltip.isShown()).toBe(false);
    vi.advanceTimersByTime(1);
    expect(tooltip.isShown()).toBe(true);
    expect(getTooltipElems()).toHaveLength(1);
    expect(tooltip.cmp.elem.textContent).toBe('Saves the scene');

    // Onto the tooltip (hoverable, WCAG 1.4.13): it stays; off it, it goes after the grace
    pointer(anchor, 'pointerleave', tooltip.cmp.elem);
    vi.advanceTimersByTime(1000);
    expect(tooltip.isShown()).toBe(true);
    pointer(tooltip.cmp.elem, 'pointerleave', document.body);
    vi.advanceTimersByTime(100);
    expect(tooltip.isShown()).toBe(false);
    expect(getTooltipElems()).toHaveLength(0);
    tooltip.cmp.remove();
  });

  it('a leave before the delay shows nothing', () => {
    const tooltip = createTooltip({ anchor, text: 'Tip' });
    pointer(anchor, 'pointerenter');
    pointer(anchor, 'pointerleave', document.body);
    vi.advanceTimersByTime(DELAY_MS * 2);
    expect(tooltip.isShown()).toBe(false);
    tooltip.cmp.remove();
  });

  it('shows at once on focus and hides on blur, a press of the anchor or Escape', () => {
    const tooltip = createTooltip({ anchor, text: 'Tip' });
    anchor.focus();
    expect(tooltip.isShown()).toBe(true);
    anchor.blur();
    expect(tooltip.isShown()).toBe(false);

    anchor.focus();
    pointer(anchor, 'pointerdown');
    expect(tooltip.isShown()).toBe(false);

    tooltip.show();
    const binding = vi.fn();
    window.addEventListener('keydown', binding);
    dispatchKey(anchor, 'keydown', 'Escape');
    window.removeEventListener('keydown', binding);
    expect(tooltip.isShown()).toBe(false);
    expect(binding).not.toHaveBeenCalled();
    dispatchKey(anchor, 'keyup', 'Escape');
    tooltip.cmp.remove();
  });

  it('hides when its anchor leaves the document, and leaves no timer or listener', () => {
    const tooltip = createTooltip({ anchor, text: 'Tip' });
    tooltip.show();
    anchor.remove();
    vi.advanceTimersByTime(16);
    expect(tooltip.isShown()).toBe(false);
    tooltip.cmp.remove();
    expect(vi.getTimerCount()).toBe(0);
    expect(countListeners(document, 'scroll')).toBe(0);
  });

  it('shows a CMP content, kept, and describes the anchor with it (p808)', () => {
    const content = CMP({ class: 'details', text: 'Iron sword' });
    const tooltip = createTooltip({ anchor, content });
    expect(tooltip.cmp.elem.hasAttribute('data-content')).toBe(true);
    expect(anchor.getAttribute('aria-describedby')).toBe(`hint ${tooltip.cmp.id}`);
    tooltip.show();
    expect(tooltip.cmp.elem.firstElementChild).toBe(content.elem);
    tooltip.hide();
    expect(content.elem.parentElement).toBe(tooltip.cmp.elem);
    // The content is the app's to change
    tooltip.setText('Other');
    expect(tooltip.cmp.elem.firstElementChild).toBe(content.elem);
    tooltip.cmp.remove();
    expect(content.elem.parentElement).toBeNull();
  });

  it('builds a function content on each show and removes it on hide (p808)', () => {
    const removed = vi.fn();
    const make = vi.fn(() => CMP({ text: 'Built', onRemoveCmp: removed }));
    const tooltip = createTooltip({ anchor, content: make });
    expect(make).not.toHaveBeenCalled();
    tooltip.show();
    expect(make).toHaveBeenCalledTimes(1);
    expect(tooltip.cmp.elem.textContent).toBe('Built');
    tooltip.hide();
    expect(removed).toHaveBeenCalledTimes(1);
    expect(tooltip.cmp.elem.textContent).toBe('');
    tooltip.show();
    expect(make).toHaveBeenCalledTimes(2);
    tooltip.cmp.remove();
    expect(removed).toHaveBeenCalledTimes(2);
  });

  it('setText writes the text in place', () => {
    const tooltip = createTooltip({ anchor, text: 'One' });
    tooltip.setText('Two');
    expect(tooltip.cmp.elem.textContent).toBe('Two');
    tooltip.cmp.remove();
  });

  it('describes nothing its anchor’s aria-label already says, until its text differs', () => {
    anchor.removeAttribute('aria-describedby');
    anchor.setAttribute('aria-label', 'Close');
    const tooltip = createTooltip({ anchor, text: 'Close' });
    expect(anchor.getAttribute('aria-describedby')).toBeNull();
    tooltip.setText('Closes the window');
    expect(anchor.getAttribute('aria-describedby')).toBe(tooltip.cmp.id);
    tooltip.setText('Close');
    expect(anchor.getAttribute('aria-describedby')).toBeNull();
    tooltip.cmp.remove();
  });

  it('onlyWhenTruncated: shows only while the anchor’s text is cut, and describes nothing', () => {
    const tooltip = createTooltip({ anchor, text: 'A long title', onlyWhenTruncated: true });
    expect(anchor.getAttribute('aria-describedby')).toBe('hint');
    Object.defineProperties(anchor, {
      scrollWidth: { value: 100, configurable: true },
      clientWidth: { value: 100, configurable: true },
    });
    tooltip.show();
    expect(tooltip.isShown()).toBe(false);
    Object.defineProperty(anchor, 'scrollWidth', { value: 180, configurable: true });
    tooltip.show();
    expect(tooltip.isShown()).toBe(true);
    tooltip.cmp.remove();
  });
});
