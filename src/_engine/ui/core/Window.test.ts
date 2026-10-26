import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { onBoundsResize, setWindowBoundsElement } from './Window';

/** A window whose `resize` listeners are kept, so a test can fire them */
const stubWindow = () => {
  const listeners = new Set<() => void>();
  vi.stubGlobal('window', {
    addEventListener: (type: string, fn: () => void) => type === 'resize' && listeners.add(fn),
    removeEventListener: (type: string, fn: () => void) =>
      type === 'resize' && listeners.delete(fn),
  });
  return { listeners, fire: () => listeners.forEach((fn) => fn()) };
};

/** A ResizeObserver whose instances are kept with what they observe */
const stubResizeObserver = () => {
  const observers: { callback: () => void; targets: Element[]; isConnected: boolean }[] = [];
  vi.stubGlobal(
    'ResizeObserver',
    class {
      private entry;
      constructor(callback: () => void) {
        this.entry = { callback, targets: [] as Element[], isConnected: true };
        observers.push(this.entry);
      }
      observe(target: Element) {
        this.entry.targets.push(target);
      }
      disconnect() {
        this.entry.isConnected = false;
      }
    }
  );
  return observers;
};

describe('onBoundsResize (p803 D4)', () => {
  let win: ReturnType<typeof stubWindow>;
  let observers: ReturnType<typeof stubResizeObserver>;
  beforeEach(() => {
    win = stubWindow();
    observers = stubResizeObserver();
  });
  afterEach(() => {
    setWindowBoundsElement(null);
    vi.unstubAllGlobals();
  });

  it("follows the browser window's resize from the first listener to the last", () => {
    expect(win.listeners.size).toBe(0);
    const first = vi.fn();
    const second = vi.fn();
    const removeFirst = onBoundsResize(first);
    const removeSecond = onBoundsResize(second);
    expect(win.listeners.size).toBe(1);

    win.fire();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);

    removeFirst();
    win.fire();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(2);
    removeSecond();
    expect(win.listeners.size).toBe(0);
    expect(observers).toEqual([]);
  });

  it('observes the bounds element instead, and moves with setWindowBoundsElement', () => {
    const container = {} as HTMLElement;
    setWindowBoundsElement(container);
    const listener = vi.fn();
    const remove = onBoundsResize(listener);
    expect(win.listeners.size).toBe(0);
    expect(observers).toHaveLength(1);
    expect(observers[0].targets).toEqual([container]);

    observers[0].callback();
    expect(listener).toHaveBeenCalledTimes(1);

    // An unmount: back to the window
    setWindowBoundsElement(null);
    expect(observers[0].isConnected).toBe(false);
    expect(win.listeners.size).toBe(1);
    // A mount after the first listener: onto the container
    setWindowBoundsElement(container);
    expect(win.listeners.size).toBe(0);
    expect(observers[1].targets).toEqual([container]);

    remove();
    expect(observers[1].isConnected).toBe(false);
  });

  it('attaches nothing to set the bounds while no listener is there', () => {
    setWindowBoundsElement({} as HTMLElement);
    setWindowBoundsElement(null);
    expect(win.listeners.size).toBe(0);
    expect(observers).toEqual([]);
  });
});
