import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { countListeners, dispatchKey, stubKitDomAsync } from '../testing/KitDom';
import { createHudRoot, getHUDRootCMP } from '../core/HUD';
import { addToast, createToaster, hasToaster, removeToast, removeToaster } from './Toaster';

/** A button on the page outside the HUD root, where the focus was before a toast took it */
let pageButton: HTMLButtonElement;

beforeAll(async () => {
  await stubKitDomAsync(
    '<!doctype html><html><head></head><body><button id="page">Page</button><div id="hudSlot"></div></body></html>'
  );
  createHudRoot({ slot: document.getElementById('hudSlot') as HTMLElement });
  pageButton = document.getElementById('page') as HTMLButtonElement;
});

afterEach(() => {
  vi.useRealTimers();
});

const createTestToaster = (id: string) =>
  getHUDRootCMP().add(
    createToaster({ id, settings: { animationTimeMs: 100, showingTimeMs: 1000 } })
  );

/** The enter delay and the slide in: the toast shows from here */
const APPEAR_MS = 10 + 100;

const pointer = (target: EventTarget, type: string) => target.dispatchEvent(new window.Event(type));

describe('toasts', () => {
  it('appear, show for their time, fade and go, with one timer at a time', () => {
    vi.useFakeTimers();
    const toaster = createTestToaster('toasterA');
    const toast = addToast({ title: 'Saved', message: 'All good', toasterId: 'toasterA' });
    expect(toast).toMatchObject({ toasterId: 'toasterA', showingTime: 1000, totalTime: 1200 });
    expect(toaster.elem.textContent).toContain('Saved');
    expect(toast.toastCmp.elem.getAttribute('data-phase')).toBe('entering');
    vi.advanceTimersByTime(APPEAR_MS);
    expect(toast.toastCmp.elem.getAttribute('data-phase')).toBe('showing');
    expect(vi.getTimerCount()).toBe(1); // showing
    vi.advanceTimersByTime(1000);
    expect(toast.toastCmp.elem.getAttribute('data-phase')).toBe('removing');
    vi.advanceTimersByTime(100);
    expect(toaster.elem.querySelector('.aekToast')).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    removeToaster('toasterA');
  });

  it('removes a toast early, and a toaster with its pending timers and listeners', () => {
    vi.useFakeTimers();
    createTestToaster('toasterB');
    expect(countListeners(document, 'visibilitychange')).toBe(1);
    const first = addToast({ title: 'One', toasterId: 'toasterB' });
    addToast({ title: 'Two', toasterId: 'toasterB' });
    removeToast(first.id);
    removeToast(first.id); // already fading: a no-op
    removeToaster('toasterB');
    expect(vi.getTimerCount()).toBe(0);
    expect(hasToaster('toasterB')).toBe(false);
    // Nothing in the page's head (p803 D5), and the page's listener gone with the last toaster
    expect(document.head.children).toHaveLength(0);
    expect(countListeners(document, 'visibilitychange')).toBe(0);
  });

  it('throws for a toaster that does not exist', () => {
    expect(() => addToast({ title: 'Lost', toasterId: 'nowhere' })).toThrow(
      /Could not find toaster/
    );
  });
});

describe('toasts, accessible (p803 D9)', () => {
  it('are read once through the toaster’s live regions: an alert assertively', () => {
    vi.useFakeTimers();
    const toaster = createTestToaster('toasterC').elem;
    const polite = toaster.querySelector('[role="status"]')!;
    const assertive = toaster.querySelector('[role="alert"]')!;
    expect(polite.getAttribute('aria-live')).toBe('polite');
    expect(assertive.getAttribute('aria-live')).toBe('assertive');
    addToast({ type: 'success', title: 'Saved', message: 'All good', toasterId: 'toasterC' });
    vi.advanceTimersByTime(50);
    expect(polite.textContent).toBe('Saved. All good');
    addToast({ type: 'alert', message: 'Disconnected', toasterId: 'toasterC' });
    vi.advanceTimersByTime(50);
    expect(assertive.textContent).toBe('Disconnected');
    removeToaster('toasterC');
  });

  it('show their kind’s glyph, and a labelled close button', () => {
    createTestToaster('toasterD');
    const toast = addToast({ type: 'warning', message: 'Careful', toasterId: 'toasterD' });
    const elem = toast.toastCmp.elem;
    expect(elem.getAttribute('data-type')).toBe('warning');
    expect(elem.querySelector('.aekToast__icon')?.hasAttribute('data-glyph')).toBe(true);
    expect(elem.querySelector('.aekToast__icon')?.getAttribute('aria-hidden')).toBe('true');
    const closable = addToast({ message: 'x', isClosable: true, toasterId: 'toasterD' });
    expect(closable.toastCmp.elem.querySelector('button')?.getAttribute('aria-label')).toBe(
      'Close'
    );
    // An empty icon omits it
    const plain = addToast({ message: 'x', icon: '', toasterId: 'toasterD' });
    expect(plain.toastCmp.elem.querySelector('.aekToast__icon')).toBeNull();
    removeToaster('toasterD');
  });

  it('pause their time while hovered, focused or on a hidden page', () => {
    vi.useFakeTimers();
    createTestToaster('toasterE');
    const toast = addToast({ message: 'Wait', toasterId: 'toasterE', isClosable: true });
    const elem = toast.toastCmp.elem;
    vi.advanceTimersByTime(APPEAR_MS + 400);

    pointer(elem, 'pointerenter');
    vi.advanceTimersByTime(5000);
    expect(elem.getAttribute('data-phase')).toBe('showing');
    pointer(elem, 'pointerleave');
    vi.advanceTimersByTime(599); // the 600 ms it had left
    expect(elem.getAttribute('data-phase')).toBe('showing');

    elem.querySelector('button')!.focus();
    vi.advanceTimersByTime(5000);
    expect(elem.getAttribute('data-phase')).toBe('showing');
    pageButton.focus();

    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    document.dispatchEvent(new window.Event('visibilitychange'));
    vi.advanceTimersByTime(5000);
    expect(elem.getAttribute('data-phase')).toBe('showing');
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    document.dispatchEvent(new window.Event('visibilitychange'));
    vi.advanceTimersByTime(1);
    expect(elem.getAttribute('data-phase')).toBe('removing');
    removeToaster('toasterE');
  });

  it('close on Escape with the focus in them, which goes back where it was', () => {
    createTestToaster('toasterF');
    const toast = addToast({ message: 'Close me', toasterId: 'toasterF', isClosable: true });
    const close = toast.toastCmp.elem.querySelector('button')!;
    pageButton.focus();
    close.focus();
    const binding = vi.fn();
    window.addEventListener('keydown', binding);
    dispatchKey(close, 'keydown', 'Escape');
    window.removeEventListener('keydown', binding);
    expect(binding).not.toHaveBeenCalled();
    expect(toast.toastCmp.elem.getAttribute('data-phase')).toBe('removing');
    expect(document.activeElement).toBe(pageButton);
    removeToaster('toasterF');
  });
});
