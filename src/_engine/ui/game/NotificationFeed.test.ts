import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { countListeners, stubKitDomAsync } from '../testing/KitDom';
import { createHudRoot, getHUDRootCMP } from '../core/HUD';
import { registerIcon } from '../core/icons/SvgIcon';
import { createNotificationFeed, type NotificationFeedProps } from './NotificationFeed';

/** A feed added to the HUD root */
const addFeed = (props: NotificationFeedProps = {}) => {
  const feed = createNotificationFeed(props);
  getHUDRootCMP().add(feed.cmp);
  return feed;
};

const getLines = (elem: HTMLElement) =>
  [...elem.querySelectorAll('.aekNotificationFeed__item')] as HTMLElement[];

const getSpoken = (elem: HTMLElement) =>
  getLines(elem).map((line) => line.querySelector('.aekNotificationFeed__spoken')?.textContent);

const getRegion = () =>
  [...getHUDRootCMP().elem.children].find((child) => child.getAttribute('role') === 'status');

/** `--aek-motion: 0` on every element, as a reduced motion setting gives */
const stubReducedMotion = () => {
  const original = window.getComputedStyle;
  window.getComputedStyle = (() => ({ getPropertyValue: () => '0' })) as never;
  return () => {
    window.getComputedStyle = original;
  };
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

describe('notification feed (p808 D10)', () => {
  it('is a named list in a corner, the newest line on top, its words for assistive tech', () => {
    registerIcon('coin', '<svg></svg>');
    const feed = addFeed();
    const elem = feed.cmp.elem;
    expect(elem.tagName).toBe('UL');
    expect(elem.getAttribute('aria-label')).toBe('Notifications');
    expect(elem.getAttribute('data-placement')).toBe('top-right');
    feed.add({ text: '+25 ⛁', spokenText: '25 gold', icon: 'coin', tone: 'warning' });
    feed.add({ text: 'Quest updated' });
    const [newest, older] = getLines(elem);
    expect(newest.tagName).toBe('LI');
    expect(newest.getAttribute('data-tone')).toBe('neutral');
    expect(newest.querySelector('.aekNotificationFeed__icon')).toBeNull();
    expect(older.getAttribute('data-tone')).toBe('warning');
    const icon = older.querySelector('.aekNotificationFeed__icon');
    expect(icon?.getAttribute('aria-hidden')).toBe('true');
    expect(icon?.querySelector('svg')).not.toBeNull();
    const text = older.querySelector('.aekNotificationFeed__text');
    expect(text?.textContent).toBe('+25 ⛁');
    expect(text?.getAttribute('aria-hidden')).toBe('true');
    expect(getSpoken(elem)).toEqual(['Quest updated', '25 gold']);
    feed.cmp.remove();
  });

  it('reads the lines added together as one text, once', () => {
    const feed = addFeed();
    feed.add({ text: '+25 gold' });
    feed.add({ text: 'Quest updated' });
    vi.advanceTimersByTime(50);
    expect(getRegion()?.textContent).toBe('+25 gold. Quest updated');
    vi.advanceTimersByTime(500);
    feed.add({ text: 'Level up' });
    vi.advanceTimersByTime(50);
    expect(getRegion()?.textContent).toBe('Level up');
    feed.cmp.remove();
  });

  it('merges a repeat by its key into a count, on top, its time from the start', () => {
    const feed = addFeed({ durationMs: 1000 });
    const elem = feed.cmp.elem;
    feed.add({ text: '+25 gold', key: 'gold' });
    feed.add({ text: 'Quest updated' });
    vi.advanceTimersByTime(800);
    feed.add({ text: '+50 gold', key: 'gold' });
    const lines = getLines(elem);
    expect(lines).toHaveLength(2);
    const count = lines[0].querySelector('.aekNotificationFeed__count') as HTMLElement;
    expect(lines[0].querySelector('.aekNotificationFeed__text')?.textContent).toBe('+50 gold');
    expect(count.hidden).toBe(false);
    expect(count.textContent).toBe('×2');
    expect(count.getAttribute('aria-hidden')).toBe('true');
    expect(count.getAttribute('data-run')).toBe('1');
    expect(getSpoken(elem)[0]).toBe('+50 gold, 2 times');
    vi.advanceTimersByTime(50);
    expect(getRegion()?.textContent).toBe('+50 gold, 2 times');
    feed.add({ text: '+10 gold', key: 'gold' });
    // The other name restarts the pop
    expect(count.getAttribute('data-run')).toBe('2');
    expect(count.textContent).toBe('×3');
    // The quest line's time is up; the gold line's started again
    vi.advanceTimersByTime(200);
    expect(getLines(elem)[1].getAttribute('data-state')).toBe('leaving');
    vi.advanceTimersByTime(200);
    expect(getLines(elem)).toHaveLength(1);
    vi.advanceTimersByTime(700);
    expect(getLines(elem)[0].getAttribute('data-state')).toBe('leaving');
    feed.cmp.remove();
  });

  it('fades a line out after its time, then removes it; a leaving line takes no merge', () => {
    const feed = addFeed({ durationMs: 1000 });
    const elem = feed.cmp.elem;
    feed.add({ text: 'Saved', key: 'save', durationMs: 300 });
    vi.advanceTimersByTime(300);
    const [leaving] = getLines(elem);
    expect(leaving.getAttribute('data-state')).toBe('leaving');
    feed.add({ text: 'Saved', key: 'save' });
    const lines = getLines(elem);
    expect(lines).toHaveLength(2);
    expect(lines[0]).not.toBe(leaving);
    expect(lines[0].hasAttribute('data-state')).toBe(false);
    vi.advanceTimersByTime(200);
    expect(getLines(elem)).toEqual([lines[0]]);
    feed.cmp.remove();
  });

  it('pushes the oldest line out past its maximum', () => {
    const feed = addFeed({ max: 2 });
    const elem = feed.cmp.elem;
    feed.add({ text: 'One' });
    feed.add({ text: 'Two' });
    feed.add({ text: 'Three' });
    expect(getLines(elem).map((line) => line.getAttribute('data-state'))).toEqual([
      null,
      null,
      'leaving',
    ]);
    vi.advanceTimersByTime(200);
    expect(getSpoken(elem)).toEqual(['Three', 'Two']);
    feed.cmp.remove();
  });

  it('holds every line while hovered or holding the focus, then shows the time left', () => {
    const feed = addFeed({ durationMs: 1000 });
    const elem = feed.cmp.elem;
    feed.add({ text: 'One' });
    vi.advanceTimersByTime(600);
    elem.dispatchEvent(new window.Event('pointerenter'));
    vi.advanceTimersByTime(5000);
    expect(getLines(elem)[0].hasAttribute('data-state')).toBe(false);
    // A line added while held waits too
    feed.add({ text: 'Two' });
    elem.dispatchEvent(new window.Event('focusin'));
    elem.dispatchEvent(new window.Event('pointerleave'));
    vi.advanceTimersByTime(5000);
    expect(getLines(elem).some((line) => line.hasAttribute('data-state'))).toBe(false);
    elem.dispatchEvent(new window.Event('focusout'));
    vi.advanceTimersByTime(400);
    expect(getLines(elem)[1].getAttribute('data-state')).toBe('leaving');
    expect(getLines(elem)[0].hasAttribute('data-state')).toBe(false);
    feed.cmp.remove();
  });

  it('places itself in a corner or inline, and adds and goes without a fade under reduced motion', () => {
    const feed = addFeed({ placement: 'inline', label: 'Loot', durationMs: 100, max: 1 });
    const elem = feed.cmp.elem;
    expect(elem.getAttribute('data-placement')).toBe('inline');
    expect(elem.getAttribute('aria-label')).toBe('Loot');
    const restore = stubReducedMotion();
    feed.add({ text: 'One' });
    feed.add({ text: 'Two' });
    expect(getSpoken(elem)).toEqual(['Two']);
    vi.advanceTimersByTime(100);
    expect(getLines(elem)).toHaveLength(0);
    restore();
    feed.cmp.remove();
  });

  it('clears its lines at once, and leaves no timer or listener after its removal', () => {
    const before = countListeners(document);
    const feed = addFeed();
    const elem = feed.cmp.elem;
    expect(countListeners(document)).toBe(before + 1);
    feed.add({ text: 'One' });
    feed.add({ text: 'Two' });
    feed.clear();
    expect(getLines(elem)).toHaveLength(0);
    feed.add({ text: 'Three', key: 'three' });
    vi.advanceTimersByTime(50);
    feed.cmp.remove();
    expect(vi.getTimerCount()).toBe(0);
    expect(countListeners(elem)).toBe(0);
    expect(countListeners(document)).toBe(before);
  });
});
