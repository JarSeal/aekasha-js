import { beforeEach, describe, expect, it, vi } from 'vitest';

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

// The current scene, which picks the 'perScene' bucket
const scene = vi.hoisted(() => ({ id: 'sceneA' as string | null }));
vi.mock(import('../kernel/scene/Scene'), async (importOriginal) => ({
  ...(await importOriginal()),
  getCurrentSceneId: () => scene.id,
}));

import { initEnvironment } from '../kernel/config/Config';
import {
  canRedo,
  canUndo,
  clearUndoRedoHistory,
  getUndoRedoHistory,
  initUndoRedo,
  recordOrCoalesceUndoRedoAction,
  recordUndoRedoAction,
  redoLastAction,
  registerUndoRedoActionHandler,
  registerUndoRedoModule,
  undoLastAction,
} from './UndoRedo';

initEnvironment({ search: '?isDebug=true', env: { VITE_APP_ENV: 'development' } });

type ValuePayload = { prev: number; next: number };

/** A value the handlers set, so a test reads what undo and redo applied. */
const createValueHandler = () => {
  const target = { value: 0 };
  return {
    target,
    handler: {
      undo: vi.fn((p: ValuePayload) => (target.value = p.prev)),
      redo: vi.fn((p: ValuePayload) => (target.value = p.next)),
    },
  };
};

describe('undo / redo: registration (p618 §1.4)', () => {
  // B1: a handler registered before the undo module loads was dropped without a word. First in
  // the file: the module isn't loaded yet.
  it('keeps a handler registered before the module loads (B1)', async () => {
    const undo = vi.fn();
    registerUndoRedoActionHandler('test.early', { undo, redo: vi.fn() }, 'global');

    await registerUndoRedoModule();
    initUndoRedo();
    recordUndoRedoAction('test.early', 'Early', { value: 1 });

    expect(undoLastAction()).toBe(true);
    expect(undo).toHaveBeenCalledWith({ value: 1 });
  });
});

describe('undo / redo', () => {
  beforeEach(async () => {
    await registerUndoRedoModule();
    initUndoRedo();
    clearUndoRedoHistory('all');
    scene.id = 'sceneA';
    vi.useRealTimers();
  });

  it('records, undoes and redoes an action', () => {
    const { target, handler } = createValueHandler();
    registerUndoRedoActionHandler('test.value', handler);
    target.value = 5;
    recordUndoRedoAction<ValuePayload>('test.value', 'Value', { prev: 0, next: 5 });

    expect(canUndo()).toBe(true);
    expect(undoLastAction()).toBe(true);
    expect(target.value).toBe(0);
    expect(canRedo()).toBe(true);
    expect(redoLastAction()).toBe(true);
    expect(target.value).toBe(5);
    expect(redoLastAction()).toBe(false);
  });

  it('drops the redo tail when a new action is recorded', () => {
    const { handler } = createValueHandler();
    registerUndoRedoActionHandler('test.value', handler);
    recordUndoRedoAction<ValuePayload>('test.value', 'One', { prev: 0, next: 1 });
    recordUndoRedoAction<ValuePayload>('test.value', 'Two', { prev: 1, next: 2 });
    undoLastAction();
    recordUndoRedoAction<ValuePayload>('test.value', 'Three', { prev: 1, next: 3 });

    expect(canRedo()).toBe(false);
    expect(getUndoRedoHistory()?.map((e) => e.label)).toEqual(['One', 'Three']);
  });

  it('coalesces ticks within the window into one entry, and starts a new one after it', () => {
    // After the earlier tests' timestamps (the module keeps its last one, strictly increasing)
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 60_000 });
    const { target, handler } = createValueHandler();
    registerUndoRedoActionHandler('test.value', handler);

    recordOrCoalesceUndoRedoAction<ValuePayload>('test.value', 'Drag', { prev: 0, next: 1 }, 'k');
    vi.advanceTimersByTime(300);
    recordOrCoalesceUndoRedoAction<ValuePayload>('test.value', 'Drag', { prev: 1, next: 2 }, 'k');
    vi.advanceTimersByTime(300);
    recordOrCoalesceUndoRedoAction<ValuePayload>('test.value', 'Drag', { prev: 2, next: 3 }, 'k');

    const history = getUndoRedoHistory() ?? [];
    expect(history).toHaveLength(1);
    expect(history[0].payload).toEqual({ prev: 0, next: 3 });

    // Past the window (800 ms of no ticks): a new gesture
    vi.advanceTimersByTime(1000);
    recordOrCoalesceUndoRedoAction<ValuePayload>('test.value', 'Drag', { prev: 3, next: 4 }, 'k');
    expect(getUndoRedoHistory()).toHaveLength(2);

    // Another key never joins the gesture
    recordOrCoalesceUndoRedoAction<ValuePayload>('test.value', 'Other', { prev: 0, next: 9 }, 'x');
    expect(getUndoRedoHistory()).toHaveLength(3);

    target.value = 4;
    undoLastAction();
    undoLastAction();
    expect(target.value).toBe(3);
    undoLastAction();
    expect(target.value).toBe(0);
  });

  it("keeps a scene's entries in its bucket and the global ones in every scene", () => {
    const scoped = createValueHandler();
    const global = createValueHandler();
    registerUndoRedoActionHandler('test.scene', scoped.handler);
    registerUndoRedoActionHandler('test.global', global.handler, 'global');

    recordUndoRedoAction<ValuePayload>('test.scene', 'Scene A', { prev: 0, next: 1 });
    recordUndoRedoAction<ValuePayload>('test.global', 'Global', { prev: 0, next: 2 });

    scene.id = 'sceneB';
    expect(getUndoRedoHistory()?.map((e) => [e.label, e.scope])).toEqual([['Global', 'global']]);
    expect(undoLastAction()).toBe(true);
    expect(global.handler.undo).toHaveBeenCalledTimes(1);
    expect(undoLastAction()).toBe(false);
    expect(scoped.handler.undo).not.toHaveBeenCalled();

    // Back in scene A: its entry is undoable, the global one is still undone
    scene.id = 'sceneA';
    expect(undoLastAction()).toBe(true);
    expect(scoped.handler.undo).toHaveBeenCalledTimes(1);
    expect(redoLastAction()).toBe(true);
    expect(scoped.handler.redo).toHaveBeenCalledTimes(1);
    expect(redoLastAction()).toBe(true);
    expect(global.handler.redo).toHaveBeenCalledTimes(1);
  });

  it('clears only the current scene, or every bucket', () => {
    const { handler } = createValueHandler();
    registerUndoRedoActionHandler('test.scene', handler);
    registerUndoRedoActionHandler('test.global', handler, 'global');
    recordUndoRedoAction<ValuePayload>('test.scene', 'Scene A', { prev: 0, next: 1 });
    recordUndoRedoAction<ValuePayload>('test.global', 'Global', { prev: 0, next: 2 });

    clearUndoRedoHistory('currentScene');
    expect(getUndoRedoHistory()?.map((e) => e.label)).toEqual(['Global']);
    clearUndoRedoHistory('all');
    expect(getUndoRedoHistory()).toEqual([]);
  });

  it('keeps the history through LocalStorage (a reload)', () => {
    const { target, handler } = createValueHandler();
    registerUndoRedoActionHandler('test.value', handler);
    recordUndoRedoAction<ValuePayload>('test.value', 'One', { prev: 0, next: 1 });
    recordUndoRedoAction<ValuePayload>('test.value', 'Two', { prev: 1, next: 2 });
    undoLastAction();

    initUndoRedo();
    expect(getUndoRedoHistory()?.map((e) => [e.label, e.applied])).toEqual([
      ['One', true],
      ['Two', false],
    ]);
    target.value = 1;
    expect(redoLastAction()).toBe(true);
    expect(target.value).toBe(2);
  });

  it('ignores a malformed stored history', () => {
    ls.setItem('AEK_debugUndoRedo', '{not json');
    expect(() => initUndoRedo()).not.toThrow();
    expect(getUndoRedoHistory()).toEqual([]);
  });

  // F5: skipping a missing handler's entry would apply the later ones out of order
  it("stops at an entry whose handler isn't registered", () => {
    recordUndoRedoAction('test.unknown', 'Unknown', { value: 1 });
    expect(undoLastAction()).toBe(false);
    expect(canUndo()).toBe(true);
  });
});
