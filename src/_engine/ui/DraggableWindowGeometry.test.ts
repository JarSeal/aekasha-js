import { afterEach, describe, expect, it } from 'vitest';
import { getGeometryStyle, keepOnScreen, placeWindow } from './DraggableWindowGeometry';
import type { DraggableWindowConfig, WindowEntry } from './DraggableWindowTypes';
import { getWindowSize, setWindowBoundsElement } from './Window';

type Rect = { left: number; top: number; width: number; height: number };

/** A mount's container: at (100, 50) in the viewport with a 1 px border, 640 × 360 inside */
const createContainer = () =>
  ({
    getBoundingClientRect: () => ({ left: 100, top: 50, width: 642, height: 362 }),
    clientLeft: 1,
    clientTop: 1,
    clientWidth: 640,
    clientHeight: 360,
  }) as unknown as HTMLElement;

/** A mounted window whose element reports `rect` (viewport coordinates) */
const createEntry = (config: Partial<DraggableWindowConfig>, rect: Rect) => {
  const elem = { style: {} as Record<string, string>, getBoundingClientRect: () => rect };
  const entry = {
    config: { geometry: { x: 0, y: 0, w: 200, h: 100 }, minSize: { w: 100, h: 120 }, ...config },
    runtime: { windowCMP: { elem } },
  } as unknown as WindowEntry;
  return { entry, elem };
};

afterEach(() => {
  setWindowBoundsElement(null);
});

describe("draggable windows in a mount's container (p801 D4)", () => {
  it("measures the container's padding box, with its position in the viewport", () => {
    setWindowBoundsElement(createContainer());
    expect(getWindowSize()).toEqual({
      left: 101,
      top: 51,
      width: 640,
      height: 360,
      aspect: 640 / 360,
    });
  });

  it("converts a centred window's position to the container's px, not the viewport's", () => {
    setWindowBoundsElement(createContainer());
    const { entry, elem } = createEntry(
      { geometry: { x: 50, y: 50, w: 200, h: 100 }, units: { position: { x: '%', y: '%' } } },
      { left: 321, top: 181, width: 200, height: 100 }
    );
    placeWindow(entry);
    expect(entry.config.geometry).toMatchObject({ x: 220, y: 130 });
    expect(entry.config.units?.position).toBeUndefined();
    expect(elem.style).toMatchObject({ left: '220px', top: '130px' });
  });

  it('keeps a window inside the container', () => {
    setWindowBoundsElement(createContainer());
    const { entry } = createEntry(
      { geometry: { x: 600, y: 300, w: 200, h: 100 } },
      { left: 701, top: 351, width: 200, height: 100 }
    );
    expect(keepOnScreen(entry)).toBe(true);
    expect(entry.config.geometry).toMatchObject({ x: 440, y: 260 });
  });

  it('defaults the max size to 100 % of the bounds, not the viewport units', () => {
    const { entry } = createEntry({}, { left: 0, top: 0, width: 200, height: 100 });
    expect(getGeometryStyle(entry.config)).toMatchObject({ maxWidth: '100%', maxHeight: '100%' });
  });
});
