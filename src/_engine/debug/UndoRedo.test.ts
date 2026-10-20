import { describe, expect, it, vi } from 'vitest';

// localStorage before anything reads it (the storage helpers check it once): items as own
// properties, as the browser's
vi.hoisted(() => {
  type Items = { [key: string]: string };
  const ls = Object.create({
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
  vi.stubGlobal('localStorage', ls);
});

import { initEnvironment } from '../kernel/config/Config';
import {
  initUndoRedo,
  recordUndoRedoAction,
  registerUndoRedoActionHandler,
  registerUndoRedoModule,
  undoLastAction,
} from './UndoRedo';

describe('undo / redo: registration (p618 §1.4)', () => {
  // B1: a handler registered before the undo module loads was dropped without a word
  it.fails('keeps a handler registered before the module loads (B1)', async () => {
    initEnvironment({ search: '?isDebug=true', env: { VITE_APP_ENV: 'development' } });
    const undo = vi.fn();
    registerUndoRedoActionHandler('test.early', { undo, redo: vi.fn() }, 'global');

    await registerUndoRedoModule();
    initUndoRedo();
    recordUndoRedoAction('test.early', 'Early', { value: 1 });

    expect(undoLastAction()).toBe(true);
    expect(undo).toHaveBeenCalledWith({ value: 1 });
  });
});
