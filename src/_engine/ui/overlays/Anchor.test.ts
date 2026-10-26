import { beforeAll, describe, expect, it, vi } from 'vitest';
import { countListeners, stubKitDomAsync } from '../testing/KitDom';
import { createHudRoot, getHUDRootCMP } from '../core/HUD';
import { computeAnchorPlacement, hasTopLayer, showAnchored } from './Anchor';

const BOUNDS = { left: 0, top: 0, width: 1000, height: 700 };
const GAP = 4;

describe('computeAnchorPlacement (p803 D7)', () => {
  it('places on the preferred side when it fits, aligned to the anchor’s start', () => {
    const anchor = { left: 100, top: 100, width: 120, height: 30 };
    const placed = computeAnchorPlacement({
      anchor,
      size: { width: 200, height: 150 },
      bounds: BOUNDS,
      side: 'bottom',
      gap: GAP,
    });
    expect(placed).toEqual({ side: 'bottom', x: 100, y: 134, maxWidth: 992, maxHeight: 562 });
  });

  it('flips to the other side when it doesn’t fit and that side has more room', () => {
    const anchor = { left: 100, top: 600, width: 120, height: 30 };
    const size = { width: 200, height: 150 };
    const placed = computeAnchorPlacement({
      anchor,
      size,
      bounds: BOUNDS,
      side: 'bottom',
      gap: GAP,
    });
    expect(placed).toMatchObject({ side: 'top', y: 446, maxHeight: 592 });
    // ... and back: a top list near the top opens downward
    const high = { left: 100, top: 40, width: 120, height: 30 };
    expect(
      computeAnchorPlacement({ anchor: high, size, bounds: BOUNDS, side: 'top', gap: GAP })
    ).toMatchObject({ side: 'bottom', y: 74 });
  });

  it('stays on the preferred side when the other has less room, as tall as its space', () => {
    const bounds = { left: 0, top: 0, width: 1000, height: 340 };
    const anchor = { left: 100, top: 150, width: 120, height: 30 };
    const placed = computeAnchorPlacement({
      anchor,
      size: { width: 200, height: 200 },
      bounds,
      side: 'bottom',
      gap: GAP,
    });
    expect(placed).toMatchObject({ side: 'bottom', y: 184, maxHeight: 152 });
  });

  it('shifts along the side to stay inside the bounds, and fits a too wide one to them', () => {
    const size = { width: 200, height: 100 };
    const nearRight = { left: 950, top: 100, width: 40, height: 20 };
    expect(
      computeAnchorPlacement({ anchor: nearRight, size, bounds: BOUNDS, side: 'bottom', gap: GAP })
        .x
    ).toBe(796);
    const nearLeft = { left: 10, top: 100, width: 40, height: 20 };
    expect(
      computeAnchorPlacement({
        anchor: nearLeft,
        size,
        bounds: BOUNDS,
        side: 'bottom',
        align: 'end',
        gap: GAP,
      }).x
    ).toBe(4);
    const wide = computeAnchorPlacement({
      anchor: nearRight,
      size: { width: 2000, height: 100 },
      bounds: BOUNDS,
      side: 'bottom',
      gap: GAP,
    });
    expect(wide).toMatchObject({ x: 4, maxWidth: 992 });
  });

  it('centres on the anchor, and keeps inside an embed’s container (its viewport box)', () => {
    const container = { left: 200, top: 100, width: 640, height: 360 };
    const anchor = { left: 300, top: 400, width: 100, height: 20 };
    const placed = computeAnchorPlacement({
      anchor,
      size: { width: 60, height: 120 },
      bounds: container,
      side: 'bottom',
      align: 'center',
      gap: GAP,
    });
    // 40 px below the anchor: too little, the container's top part has more
    expect(placed).toEqual({ side: 'top', x: 320, y: 276, maxWidth: 632, maxHeight: 292 });
  });

  it('places at the left or right side, flipping between them', () => {
    const anchor = { left: 500, top: 300, width: 40, height: 20 };
    const size = { width: 100, height: 40 };
    expect(
      computeAnchorPlacement({ anchor, size, bounds: BOUNDS, side: 'left', gap: GAP })
    ).toEqual({ side: 'left', x: 396, y: 300, maxWidth: 492, maxHeight: 692 });
    const nearRight = { left: 930, top: 300, width: 40, height: 20 };
    expect(
      computeAnchorPlacement({ anchor: nearRight, size, bounds: BOUNDS, side: 'right', gap: GAP })
    ).toMatchObject({ side: 'left', x: 826 });
  });

  it('gives no negative max size when neither side has room', () => {
    const anchor = { left: 0, top: 0, width: 1000, height: 700 };
    const placed = computeAnchorPlacement({
      anchor,
      size: { width: 10, height: 10 },
      bounds: BOUNDS,
      side: 'bottom',
      gap: GAP,
    });
    expect(placed.maxHeight).toBe(0);
  });
});

describe('showAnchored', () => {
  let windowElem: HTMLElement;
  let anchor: HTMLButtonElement;

  beforeAll(async () => {
    await stubKitDomAsync();
    createHudRoot({ slot: document.getElementById('hudSlot') as HTMLElement });
    // A debug window: a forced theme and density, which the fallback's overlay takes along
    windowElem = document.createElement('div');
    windowElem.setAttribute('data-aek-theme', 'dark');
    windowElem.setAttribute('data-aek-density', 'compact');
    anchor = document.createElement('button');
    windowElem.appendChild(anchor);
    getHUDRootCMP().elem.appendChild(windowElem);
  });

  const createList = () => {
    const list = document.createElement('ul');
    windowElem.appendChild(list);
    return list;
  };

  it('without the Popover API moves the overlay to the HUD root, with its theme and density', () => {
    expect(hasTopLayer()).toBe(false);
    const list = createList();
    const hide = showAnchored({ elem: list, anchor, side: 'top', matchAnchorWidth: true });
    expect(list.parentElement).toBe(getHUDRootCMP().elem);
    expect(list.getAttribute('data-aek-theme')).toBe('dark');
    expect(list.getAttribute('data-aek-density')).toBe('compact');
    expect(list.style.zIndex).toBe('var(--aek-z-tooltip)');
    expect(list.style.position).toBe('fixed');
    // The side it took (linkedom has no sizes, so it keeps its preferred one)
    expect(list.getAttribute('data-side')).toBe('top');
    expect(list.hasAttribute('popover')).toBe(false);
    hide();
    list.remove();
  });

  it('in the top layer keeps its place, a manual popover, and hides it again', () => {
    const proto = window.HTMLElement.prototype as HTMLElement;
    const showPopover = vi.fn();
    const hidePopover = vi.fn();
    Object.assign(proto, { showPopover, hidePopover });
    try {
      const list = createList();
      const hide = showAnchored({ elem: list, anchor });
      expect(list.parentElement).toBe(windowElem);
      expect(list.getAttribute('popover')).toBe('manual');
      expect(showPopover).toHaveBeenCalledTimes(1);
      expect(list.hasAttribute('data-aek-theme')).toBe(false);
      hide();
      expect(hidePopover).toHaveBeenCalledTimes(1);
      list.remove();
    } finally {
      Object.assign(proto, { showPopover: undefined, hidePopover: undefined });
    }
  });

  it('follows scrolls and resizes while shown, and leaves no listener after', () => {
    const list = createList();
    const hide = showAnchored({ elem: list, anchor });
    expect(countListeners(document, 'scroll')).toBe(1);
    // Its own, and the bounds' resize source (the window's, without a mount's container)
    expect(countListeners(window, 'resize')).toBe(2);
    hide();
    expect(countListeners(document, 'scroll')).toBe(0);
    expect(countListeners(window, 'resize')).toBe(0);
    list.remove();
  });
});
