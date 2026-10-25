import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { addToast, createToaster, hasToaster, removeToast, removeToaster } from './Toaster';

beforeAll(async () => {
  const { parseHTML } = await import('linkedom');
  const { document, window } = parseHTML('<!doctype html><html><head></head><body></body></html>');
  vi.stubGlobal('document', document);
  vi.stubGlobal('window', window);
});

afterEach(() => {
  vi.useRealTimers();
});

const createTestToaster = (id: string) => {
  const cmp = createToaster({ id, settings: { animationTimeMs: 100, showingTimeMs: 1000 } });
  document.body.appendChild(cmp.elem);
  return cmp;
};

describe('toasts', () => {
  it('appear, show for their time, fade and go, with one timer at a time', () => {
    vi.useFakeTimers();
    const toaster = createTestToaster('toasterA');
    const toast = addToast({ title: 'Saved', message: 'All good', toasterId: 'toasterA' });
    expect(toast).toMatchObject({ toasterId: 'toasterA', showingTime: 1000, totalTime: 1200 });
    expect(toaster.elem.textContent).toContain('Saved');
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(10 + 100); // the enter delay, the slide in
    expect(vi.getTimerCount()).toBe(1); // showing
    vi.advanceTimersByTime(1000);
    expect(toast.toastCmp.elem.classList.contains('toastEnd')).toBe(true);
    vi.advanceTimersByTime(100);
    expect(toaster.elem.textContent).not.toContain('Saved');
    expect(vi.getTimerCount()).toBe(0);
    removeToaster('toasterA');
  });

  it('removes a toast early, and a toaster with its pending timers and styles', () => {
    vi.useFakeTimers();
    createTestToaster('toasterB');
    const first = addToast({ title: 'One', toasterId: 'toasterB' });
    addToast({ title: 'Two', toasterId: 'toasterB' });
    removeToast(first.id);
    removeToast(first.id); // already fading: a no-op
    expect(vi.getTimerCount()).toBe(2);
    removeToaster('toasterB');
    expect(vi.getTimerCount()).toBe(0);
    expect(hasToaster('toasterB')).toBe(false);
    expect(document.getElementById('toasterB-styles')).toBeNull();
  });

  it('throws for a toaster that does not exist', () => {
    expect(() => addToast({ title: 'Lost', toasterId: 'nowhere' })).toThrow(
      /Could not find toaster/
    );
  });
});
