import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { countListeners, stubKitDomAsync } from '../../testing/KitDom';
import { createBinding, getPrimitiveValueKind } from './Binding';
import {
  addScheduledBinding,
  createBindingScheduler,
  createFlash,
  revealScheduledBindings,
  type ScheduledBinding,
} from './BindingScheduler';

beforeAll(async () => {
  await stubKitDomAsync();
});

/** The fake frame clock: frames run only when a test says, at the time it gives */
let frames = new Map<number, FrameRequestCallback>();
let nextFrameId = 1;
const runFrame = (now: number) => {
  const due = [...frames.values()];
  frames = new Map();
  for (const fn of due) fn(now);
};
const pendingFrames = () => frames.size;

let pageVisibility: 'visible' | 'hidden' = 'visible';
const setPageVisibility = (state: 'visible' | 'hidden') => {
  pageVisibility = state;
  document.dispatchEvent(new window.Event('visibilitychange'));
};

beforeEach(() => {
  frames = new Map();
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => {
    frames.set(nextFrameId, fn);
    return nextFrameId++;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  pageVisibility = 'visible';
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => pageVisibility,
  });
});

afterEach(() => {
  // Back to KitDom's frames for the next file's tests
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) =>
    setTimeout(() => fn(Date.now()), 16)
  );
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
});

/** A scheduled entry that logs its reads */
const createEntry = (props: Partial<ScheduledBinding> = {}) => {
  const reads: boolean[] = [];
  let shown = true;
  let stateReads = 0;
  const entry: ScheduledBinding = {
    read: (fromRefresh) => reads.push(fromRefresh),
    readState: () => stateReads++,
    isShown: () => shown,
    ...props,
  };
  return {
    entry,
    reads,
    setShown: (on: boolean) => (shown = on),
    getStateReads: () => stateReads,
  };
};

describe('the scheduler’s refresh (p804 D4)', () => {
  it('reads every shown field as a refresh, and each one’s hidden and disabled functions', () => {
    const scheduler = createBindingScheduler();
    const a = createEntry();
    const b = createEntry({ interval: 100 });
    addScheduledBinding(scheduler, a.entry);
    addScheduledBinding(scheduler, b.entry);
    scheduler.refresh();
    expect(a.reads).toEqual([true]);
    expect(b.reads).toEqual([true]);
    expect(a.getStateReads()).toBe(1);
    scheduler.dispose();
  });

  it('skips a hidden field, still re-reading its functions, and reads it once when it shows', () => {
    const scheduler = createBindingScheduler();
    const field = createEntry();
    addScheduledBinding(scheduler, field.entry);
    field.setShown(false);
    scheduler.refresh();
    expect(field.reads).toEqual([]);
    expect(field.getStateReads()).toBe(1);
    // Still hidden: nothing
    revealScheduledBindings(scheduler);
    expect(field.reads).toEqual([]);
    field.setShown(true);
    revealScheduledBindings(scheduler);
    // Read once, with no flash
    expect(field.reads).toEqual([false]);
    revealScheduledBindings(scheduler);
    expect(field.reads).toEqual([false]);
    scheduler.dispose();
  });

  it('stops reading a removed field', () => {
    const scheduler = createBindingScheduler();
    const field = createEntry();
    const remove = addScheduledBinding(scheduler, field.entry);
    remove();
    remove();
    scheduler.refresh();
    expect(field.reads).toEqual([]);
    scheduler.dispose();
  });
});

describe('the scheduler’s tick (p804 D4)', () => {
  it('runs no loop without a live field', () => {
    const scheduler = createBindingScheduler();
    addScheduledBinding(scheduler, createEntry().entry);
    expect(pendingFrames()).toBe(0);
    scheduler.dispose();
  });

  it('reads each live field at its interval, against the frame’s time', () => {
    const scheduler = createBindingScheduler();
    const slow = createEntry({ interval: 100 });
    const everyFrame = createEntry({ interval: 0 });
    const editField = createEntry();
    addScheduledBinding(scheduler, slow.entry);
    addScheduledBinding(scheduler, everyFrame.entry);
    addScheduledBinding(scheduler, editField.entry);
    expect(pendingFrames()).toBe(1);
    runFrame(1000);
    runFrame(1016);
    runFrame(1099);
    runFrame(1100);
    expect(slow.reads).toEqual([false, false]);
    expect(everyFrame.reads).toEqual([false, false, false, false]);
    // The tick reads live fields only
    expect(editField.reads).toEqual([]);
    expect(pendingFrames()).toBe(1);
    scheduler.dispose();
  });

  it('skips a hidden live field, and reads it on the first frame it shows again', () => {
    const scheduler = createBindingScheduler();
    const monitor = createEntry({ interval: 500 });
    addScheduledBinding(scheduler, monitor.entry);
    runFrame(0);
    monitor.setShown(false);
    runFrame(600);
    expect(monitor.reads).toEqual([false]);
    monitor.setShown(true);
    // Within its interval of the last read, but it missed one
    runFrame(616);
    expect(monitor.reads).toEqual([false, false]);
    runFrame(632);
    expect(monitor.reads).toEqual([false, false]);
    scheduler.dispose();
  });

  it('runs only while the host shows', () => {
    const scheduler = createBindingScheduler({ visible: false });
    const monitor = createEntry({ interval: 0 });
    addScheduledBinding(scheduler, monitor.entry);
    expect(pendingFrames()).toBe(0);
    scheduler.setVisible(true);
    expect(pendingFrames()).toBe(1);
    runFrame(0);
    scheduler.setVisible(false);
    expect(pendingFrames()).toBe(0);
    scheduler.setVisible(true);
    scheduler.setVisible(true);
    expect(pendingFrames()).toBe(1);
    scheduler.dispose();
  });

  it('stops while the page is hidden, listening to it only while a live field exists', () => {
    const before = countListeners(document, 'visibilitychange');
    const scheduler = createBindingScheduler();
    const monitor = createEntry({ interval: 0 });
    const remove = addScheduledBinding(scheduler, monitor.entry);
    expect(countListeners(document, 'visibilitychange')).toBe(before + 1);
    setPageVisibility('hidden');
    expect(pendingFrames()).toBe(0);
    setPageVisibility('visible');
    expect(pendingFrames()).toBe(1);
    remove();
    expect(pendingFrames()).toBe(0);
    expect(countListeners(document, 'visibilitychange')).toBe(before);
    scheduler.dispose();
  });

  it('lets go of everything on dispose, and ignores a field added after', () => {
    const before = countListeners(document, 'visibilitychange');
    const scheduler = createBindingScheduler();
    const monitor = createEntry({ interval: 0 });
    addScheduledBinding(scheduler, monitor.entry);
    scheduler.dispose();
    scheduler.dispose();
    expect(pendingFrames()).toBe(0);
    expect(countListeners(document, 'visibilitychange')).toBe(before);
    const late = createEntry({ interval: 0 });
    addScheduledBinding(scheduler, late.entry)();
    scheduler.refresh();
    scheduler.setVisible(true);
    expect(pendingFrames()).toBe(0);
    expect(late.reads).toEqual([]);
  });
});

describe('reads through a binding (p804 D4: no write on an unchanged value, no monitor flash)', () => {
  /** A field-like entry: a binding, a draw count, a flash count */
  const createBoundEntry = (target: { value: number }, interval?: number) => {
    const binding = createBinding<number>({
      target,
      key: 'value',
      kind: getPrimitiveValueKind(),
    });
    const counts = { draws: 0, flashes: 0 };
    const isMonitor = interval !== undefined;
    const entry: ScheduledBinding = {
      interval,
      isShown: () => true,
      read: (fromRefresh) => {
        if (!binding.sync()) return;
        counts.draws++;
        if (fromRefresh && !isMonitor) counts.flashes++;
      },
    };
    return { entry, counts };
  };

  it('draws only a changed value, and flashes an edit field changed from outside', () => {
    const scheduler = createBindingScheduler();
    const target = { value: 1 };
    const field = createBoundEntry(target);
    addScheduledBinding(scheduler, field.entry);
    scheduler.refresh();
    scheduler.refresh();
    expect(field.counts).toEqual({ draws: 0, flashes: 0 });
    target.value = 2;
    scheduler.refresh();
    expect(field.counts).toEqual({ draws: 1, flashes: 1 });
    scheduler.dispose();
  });

  it('never flashes a monitor, on a refresh or a tick', () => {
    const scheduler = createBindingScheduler();
    const target = { value: 1 };
    const monitor = createBoundEntry(target, 0);
    addScheduledBinding(scheduler, monitor.entry);
    runFrame(0);
    expect(monitor.counts.draws).toBe(0);
    target.value = 2;
    runFrame(16);
    target.value = 3;
    scheduler.refresh();
    expect(monitor.counts).toEqual({ draws: 2, flashes: 0 });
    scheduler.dispose();
  });
});

describe('the flash (p804 D4)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('sets data-flash for 200 ms, restarted by a second flash', () => {
    const elem = document.createElement('div');
    const { flash, dispose } = createFlash(elem);
    flash();
    expect(elem.hasAttribute('data-flash')).toBe(true);
    vi.advanceTimersByTime(150);
    flash();
    vi.advanceTimersByTime(150);
    expect(elem.hasAttribute('data-flash')).toBe(true);
    vi.advanceTimersByTime(50);
    expect(elem.hasAttribute('data-flash')).toBe(false);
    flash();
    dispose();
    expect(elem.hasAttribute('data-flash')).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});
