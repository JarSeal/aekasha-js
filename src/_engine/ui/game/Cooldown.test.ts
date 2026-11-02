import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { stubKitDomAsync } from '../testing/KitDom';
import { createCooldown } from './Cooldown';

const part = (elem: HTMLElement, name: string) =>
  elem.querySelector(`.aekCooldown__${name}`) as HTMLElement;

beforeAll(async () => {
  await stubKitDomAsync();
});

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('cooldown (p808 D6)', () => {
  it('runs a CSS sweep from the start, writes the seconds once a second and is ready at the end', () => {
    const onReady = vi.fn();
    const cooldown = createCooldown({ onReady });
    const elem = cooldown.cmp.elem;
    const sweep = part(elem, 'sweep');
    expect(elem.getAttribute('aria-hidden')).toBe('true');
    expect(cooldown.isRunning()).toBe(false);
    cooldown.start(2500);
    expect(cooldown.isRunning()).toBe(true);
    expect(elem.getAttribute('data-state')).toBe('running');
    expect(elem.getAttribute('data-run')).toBe('1');
    expect(sweep.style.animationDuration).toBe('2500ms');
    expect(sweep.style.animationTimingFunction).toBe('linear');
    expect(part(elem, 'time').textContent).toBe('3');
    vi.advanceTimersByTime(600);
    expect(part(elem, 'time').textContent).toBe('2');
    vi.advanceTimersByTime(1000);
    expect(part(elem, 'time').textContent).toBe('1');
    expect(onReady).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(cooldown.isRunning()).toBe(false);
    expect(cooldown.getRemainingMs()).toBe(0);
    expect(elem.getAttribute('data-state')).toBe('ready');
    expect(elem.hasAttribute('data-run')).toBe(false);
    expect(part(elem, 'time').textContent).toBe('');
    cooldown.cmp.remove();
  });

  it('starts part way through, and restarts the sweep on a new start', () => {
    const cooldown = createCooldown({});
    const sweep = part(cooldown.cmp.elem, 'sweep');
    cooldown.start(4000, 1500);
    expect(sweep.style.animationDelay).toBe('-1500ms');
    expect(cooldown.getRemainingMs()).toBe(2500);
    cooldown.start(4000);
    expect(cooldown.cmp.elem.getAttribute('data-run')).toBe('2');
    expect(sweep.style.animationDelay).toBe('0ms');
    cooldown.cmp.remove();
  });

  it("marks its target disabled with the time left as a description, and puts the target's back", () => {
    const button = document.createElement('button');
    button.setAttribute('aria-describedby', 'hint');
    const cooldown = createCooldown({ target: button });
    button.append(cooldown.cmp.elem);
    cooldown.start(2000);
    expect(button.getAttribute('aria-disabled')).toBe('true');
    const ids = (button.getAttribute('aria-describedby') ?? '').split(' ');
    expect(ids[0]).toBe('hint');
    const description = button.querySelector(`#${ids[1]}`) as HTMLElement;
    expect(description.hidden).toBe(true);
    expect(description.textContent).toBe('Ready in 2 seconds');
    vi.advanceTimersByTime(1100);
    expect(description.textContent).toBe('Ready in 1 second');
    cooldown.cancel();
    expect(button.hasAttribute('aria-disabled')).toBe(false);
    expect(button.getAttribute('aria-describedby')).toBe('hint');
    expect(description.parentNode).toBeNull();
    expect(cooldown.cmp.elem.hasAttribute('data-state')).toBe(false);
    cooldown.cmp.remove();
  });

  it('cancels without onReady, and stops its timer when removed', () => {
    const onReady = vi.fn();
    const cooldown = createCooldown({ onReady });
    cooldown.start(1000);
    cooldown.cancel();
    vi.advanceTimersByTime(2000);
    expect(onReady).not.toHaveBeenCalled();
    cooldown.start(1000);
    cooldown.cmp.remove();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(2000);
    expect(onReady).not.toHaveBeenCalled();
  });
});
