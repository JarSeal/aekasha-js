import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createElementSizeSource,
  getCanvasSize,
  onCanvasResize,
  setCanvasSizeSource,
} from './CanvasSize';

// The window (an event target with a size) and a ResizeObserver that the test triggers by hand
const dom = vi.hoisted(() => {
  const win = Object.assign(new EventTarget(), { innerWidth: 1200, innerHeight: 600 });
  const observers: { callback: () => void; targets: unknown[]; isConnected: boolean }[] = [];
  class FakeResizeObserver {
    entry: (typeof observers)[number];
    constructor(callback: () => void) {
      this.entry = { callback, targets: [], isConnected: true };
      observers.push(this.entry);
    }
    observe(target: unknown) {
      this.entry.targets.push(target);
    }
    disconnect() {
      this.entry.isConnected = false;
    }
  }
  vi.stubGlobal('window', win);
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  return { win, observers };
});

const removers: (() => void)[] = [];
afterEach(() => {
  for (const remove of removers.splice(0)) remove();
  setCanvasSizeSource(null);
  dom.observers.length = 0;
});

describe('getCanvasSize', () => {
  it('reads the window by default', () => {
    expect(getCanvasSize()).toEqual({ width: 1200, height: 600, aspect: 2 });
  });

  it('reads an element source, and an aspect of 1 while its height is 0', () => {
    const elem = { clientWidth: 300, clientHeight: 0 } as HTMLElement;
    setCanvasSizeSource(createElementSizeSource(elem));
    expect(getCanvasSize()).toEqual({ width: 300, height: 0, aspect: 1 });
    (elem as { clientHeight: number }).clientHeight = 150;
    expect(getCanvasSize().aspect).toBe(2);
  });
});

describe('onCanvasResize', () => {
  it("runs on the window's resize until removed", () => {
    const fn = vi.fn();
    const remove = onCanvasResize(fn);
    dom.win.dispatchEvent(new Event('resize'));
    expect(fn).toHaveBeenCalledTimes(1);
    remove();
    dom.win.dispatchEvent(new Event('resize'));
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("moves to an element source: called once on the switch, then on its observer's and the window's changes", () => {
    const fn = vi.fn();
    removers.push(onCanvasResize(fn));
    const elem = { clientWidth: 300, clientHeight: 150 } as HTMLElement;
    setCanvasSizeSource(createElementSizeSource(elem));
    expect(fn).toHaveBeenCalledTimes(1);
    expect(dom.observers).toHaveLength(1);
    expect(dom.observers[0].targets).toEqual([elem]);

    dom.observers[0].callback();
    expect(fn).toHaveBeenCalledTimes(2);
    // The window too, for what is sized against it (the debug windows)
    dom.win.dispatchEvent(new Event('resize'));
    expect(fn).toHaveBeenCalledTimes(3);

    // Back to the window: the observer is disconnected, and the window's resize runs it once
    setCanvasSizeSource(null);
    expect(dom.observers[0].isConnected).toBe(false);
    expect(fn).toHaveBeenCalledTimes(4);
    dom.win.dispatchEvent(new Event('resize'));
    expect(fn).toHaveBeenCalledTimes(5);
  });

  it('observes nothing without listeners', () => {
    setCanvasSizeSource(
      createElementSizeSource({ clientWidth: 1, clientHeight: 1 } as HTMLElement)
    );
    expect(dom.observers).toHaveLength(0);
  });
});
