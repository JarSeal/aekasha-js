import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { stubKitDomAsync, stubMatchMedia } from '../testing/KitDom';
import { onKitThemeChange } from './ThemeWatch';

beforeAll(async () => {
  await stubKitDomAsync();
});

/** A MutationObserver's records arrive in a microtask */
const settleAsync = () => new Promise((resolve) => setTimeout(resolve, 0));

const media = { current: null as ReturnType<typeof stubMatchMedia> | null };

afterEach(() => {
  media.current?.restore();
  media.current = null;
  document.body.replaceChildren();
});

describe('the theme watch (p805 D9)', () => {
  // linkedom's observer reports only the observed node's own attributes, not a descendant's (a
  // browser reports both): a write under the page (the library's switches on a kit root) is a
  // browser check, so these write on <html>
  it('calls the subscribers under an element whose theme or density changed', async () => {
    media.current = stubMatchMedia();
    const html = document.documentElement;
    const inside = document.createElement('span');
    document.body.append(inside);
    // Not under <html>: a change there isn't its
    const detached = document.createElement('span');
    const insideFn = vi.fn();
    const detachedFn = vi.fn();
    const removeInside = onKitThemeChange(inside, insideFn);
    const removeDetached = onKitThemeChange(detached, detachedFn);
    try {
      html.setAttribute('data-aek-theme', 'light');
      html.setAttribute('data-aek-density', 'compact');
      await settleAsync();
      // Once per batch of writes, and not for an element elsewhere
      expect(insideFn).toHaveBeenCalledTimes(1);
      expect(detachedFn).not.toHaveBeenCalled();

      // Another attribute isn't the theme
      html.setAttribute('data-other', '1');
      await settleAsync();
      expect(insideFn).toHaveBeenCalledTimes(1);

      html.removeAttribute('data-aek-theme');
      await settleAsync();
      expect(insideFn).toHaveBeenCalledTimes(2);
    } finally {
      removeInside();
      removeDetached();
      html.removeAttribute('data-aek-density');
      html.removeAttribute('data-other');
      await settleAsync();
    }
  });

  it('calls every subscriber on a system colour scheme change', () => {
    media.current = stubMatchMedia();
    const fn = vi.fn();
    const remove = onKitThemeChange(document.body, fn);
    media.current.setDark(true);
    expect(fn).toHaveBeenCalledTimes(1);
    remove();
    media.current.setDark(false);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('listens only while it has a subscriber', async () => {
    media.current = stubMatchMedia();
    const fn = vi.fn();
    const removeFirst = onKitThemeChange(document.body, fn);
    const removeSecond = onKitThemeChange(document.body, fn);
    expect(media.current.listenerCount()).toBe(1);
    removeFirst();
    // Twice is harmless
    removeFirst();
    expect(media.current.listenerCount()).toBe(1);
    removeSecond();
    expect(media.current.listenerCount()).toBe(0);
    document.documentElement.setAttribute('data-aek-theme', 'light');
    await settleAsync();
    expect(fn).not.toHaveBeenCalled();
    document.documentElement.removeAttribute('data-aek-theme');
  });

  it('works without matchMedia', () => {
    const remove = onKitThemeChange(document.body, () => {});
    remove();
  });
});
