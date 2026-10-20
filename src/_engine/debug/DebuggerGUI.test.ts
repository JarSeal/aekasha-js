import { describe, expect, it, vi } from 'vitest';

// localStorage before anything reads it (the storage helpers check it once): items as own
// properties, as the browser's
const ls = vi.hoisted(() => {
  type Items = { [key: string]: string };
  const storage = Object.create({
    getItem(this: Items, key: string) {
      return Object.prototype.hasOwnProperty.call(this, key) ? this[key] : null;
    },
    setItem(this: Items, key: string, value: string) {
      this[key] = String(value);
    },
    removeItem(this: Items, key: string) {
      delete this[key];
    },
  }) as Storage & Items;
  vi.stubGlobal('localStorage', storage);
  return storage;
});

// The toaster builds DOM: whether the debug toaster exists, and what it was handed
const toaster = vi.hoisted(() => ({ exists: false }));
vi.mock(import('../ui/Toaster'), async (importOriginal) => ({
  ...(await importOriginal()),
  hasToaster: () => toaster.exists,
  addToast: vi.fn(() => ({}) as never),
}));

import { initEnvironment } from '../kernel/config/Config';
import { addToast } from '../ui/Toaster';
import {
  addDebugToastWhenReady,
  DEBUG_TOASTER_ID,
  flushQueuedDebugToasts,
  hydrateDebuggerTabState,
} from './DebuggerGUI';

const DEBUG = { search: '?isDebug=true', env: { VITE_APP_ENV: 'development' } };

describe('debug toasts (p618 D11)', () => {
  // First in the file: before initEnvironment every flag reads as production
  it('queues nothing outside the debug env', () => {
    addDebugToastWhenReady({ title: 'Ignored', message: 'production' });
    toaster.exists = true;
    flushQueuedDebugToasts();
    expect(addToast).not.toHaveBeenCalled();
    toaster.exists = false;
  });

  it('queues a toast until the debug toaster exists, then shows it once', () => {
    initEnvironment(DEBUG);
    addDebugToastWhenReady({ title: 'Early', message: 'from the boot' });
    expect(addToast).not.toHaveBeenCalled();

    toaster.exists = true;
    flushQueuedDebugToasts();
    expect(addToast).toHaveBeenCalledWith({
      title: 'Early',
      message: 'from the boot',
      toasterId: DEBUG_TOASTER_ID,
    });
    flushQueuedDebugToasts();
    expect(addToast).toHaveBeenCalledTimes(1);

    // With the toaster there, it shows at once
    addDebugToastWhenReady({ title: 'Late', message: 'after' });
    expect(addToast).toHaveBeenCalledTimes(2);
  });
});

describe('hydrateDebuggerTabState (p618 D11)', () => {
  type State = { speed: number; name: string; helpers: { grid: boolean; axes: boolean } };
  const createState = (): State => ({
    speed: 1,
    name: 'default',
    helpers: { grid: false, axes: false },
  });

  it('restores only the persisted keys, a nested object whole', () => {
    initEnvironment(DEBUG);
    ls.setItem(
      'AEK_test',
      JSON.stringify({ speed: 3, name: 'saved', helpers: { grid: true }, other: 1 })
    );
    const state = createState();
    hydrateDebuggerTabState({ lsKey: 'AEK_test', state, persistKeys: ['speed', 'helpers'] });
    expect(state).toEqual({ speed: 3, name: 'default', helpers: { grid: true } });
  });

  it('leaves the state alone for a malformed or non-object value', () => {
    initEnvironment(DEBUG);
    for (const value of ['{not json', '[1,2]', '42']) {
      ls.setItem('AEK_test', value);
      const state = createState();
      expect(() =>
        hydrateDebuggerTabState({ lsKey: 'AEK_test', state, persistKeys: ['speed'] })
      ).not.toThrow();
      expect(state).toEqual(createState());
    }
  });

  it('reads nothing outside the debug env and prod test mode', () => {
    initEnvironment({ search: '', env: { VITE_APP_ENV: 'development' } });
    ls.setItem('AEK_test', JSON.stringify({ speed: 3 }));
    const state = createState();
    hydrateDebuggerTabState({ lsKey: 'AEK_test', state, persistKeys: ['speed'] });
    expect(state.speed).toBe(1);
  });
});
