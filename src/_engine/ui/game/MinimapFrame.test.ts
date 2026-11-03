import { beforeAll, describe, expect, it, vi } from 'vitest';
import { countListeners, dispatchKey, stubKitDomAsync } from '../testing/KitDom';
import { createMinimapFrame } from './MinimapFrame';

const part = (elem: Element, name: string) =>
  elem.querySelector(`.aekMinimapFrame__${name}`) as HTMLElement;
const zoomButton = (elem: Element, direction: 'in' | 'out') =>
  elem.querySelector(`[data-zoom="${direction}"]`) as HTMLButtonElement;
const click = (target: Element) =>
  target.dispatchEvent(new window.Event('click', { bubbles: true, cancelable: true }));
const DEG = Math.PI / 180;

beforeAll(async () => {
  await stubKitDomAsync();
});

describe('minimap frame (p808 D7)', () => {
  it('is a named group, its pictures hidden, the heading said in words', () => {
    const frame = createMinimapFrame({ label: 'Arena map', playerHeading: 100 * DEG });
    const elem = frame.cmp.elem;
    expect(elem.className).toBe('aekMinimapFrame');
    expect(elem.getAttribute('role')).toBe('group');
    expect(elem.getAttribute('aria-label')).toBe('Arena map');
    expect(part(elem, 'ring').getAttribute('aria-hidden')).toBe('true');
    expect(part(elem, 'player').getAttribute('aria-hidden')).toBe('true');
    expect(part(elem, 'north').textContent).toBe('N');
    expect(part(elem, 'spoken').textContent).toBe('Facing east');
    // No zoom without onZoom
    expect(part(elem, 'zoom')).toBeNull();
    frame.setLabel('Map');
    expect(elem.getAttribute('aria-label')).toBe('Map');
    frame.cmp.remove();
  });

  it('turns the arrow, writing only a changed degree', () => {
    const frame = createMinimapFrame();
    const player = part(frame.cmp.elem, 'player');
    expect(player.style.getPropertyValue('--aek-minimap-player-angle')).toBe('0deg');
    frame.setPlayerHeading(-90 * DEG);
    expect(player.style.getPropertyValue('--aek-minimap-player-angle')).toBe('270deg');
    player.style.setProperty('--aek-minimap-player-angle', 'marked');
    frame.setPlayerHeading(-90.3 * DEG);
    expect(player.style.getPropertyValue('--aek-minimap-player-angle')).toBe('marked');
    expect(part(frame.cmp.elem, 'spoken').textContent).toBe('Facing west');
    frame.cmp.remove();
  });

  it('moves the north mark round the edge and turns the arrow against a turning map', () => {
    const frame = createMinimapFrame({ playerHeading: 90 * DEG });
    const elem = frame.cmp.elem;
    const north = part(elem, 'north');
    expect([north.style.left, north.style.top]).toEqual(['50%', '0%']);
    // The map turns with the player: up is east, so north is on the left, the arrow straight up
    frame.setMapHeading(90 * DEG);
    expect([north.style.left, north.style.top]).toEqual(['0%', '50%']);
    expect(part(elem, 'player').style.getPropertyValue('--aek-minimap-player-angle')).toBe('0deg');
    // 45°: a corner of the square
    frame.setMapHeading(45 * DEG);
    expect([north.style.left, north.style.top]).toEqual(['0%', '0%']);
    north.style.left = 'marked';
    frame.setMapHeading(45.2 * DEG);
    expect(north.style.left).toBe('marked');
    frame.cmp.remove();
    const plain = createMinimapFrame({ showNorth: false, texts: { north: 'P' } });
    expect(part(plain.cmp.elem, 'north').hidden).toBe(true);
    expect(part(plain.cmp.elem, 'north').textContent).toBe('P');
    plain.cmp.remove();
  });

  it('zooms with its buttons, not a disabled one, keeping Enter and Space from the maps', () => {
    const onZoom = vi.fn();
    const frame = createMinimapFrame({ onZoom, texts: { zoomIn: 'Lähemmäs' } });
    const elem = frame.cmp.elem;
    document.body.append(elem);
    const zoomIn = zoomButton(elem, 'in');
    expect(zoomIn.tagName).toBe('BUTTON');
    expect(zoomIn.getAttribute('type')).toBe('button');
    expect(zoomIn.getAttribute('aria-label')).toBe('Lähemmäs');
    expect(zoomButton(elem, 'out').getAttribute('aria-label')).toBe('Zoom out');
    click(zoomIn);
    click(zoomButton(elem, 'out'));
    expect(onZoom.mock.calls).toEqual([[1], [-1]]);
    frame.setZoomEnabled({ zoomIn: false });
    expect(zoomIn.getAttribute('aria-disabled')).toBe('true');
    expect(zoomButton(elem, 'out').hasAttribute('aria-disabled')).toBe(false);
    click(zoomIn);
    expect(onZoom).toHaveBeenCalledTimes(2);
    frame.setZoomEnabled({ zoomIn: true, zoomOut: false });
    expect(zoomIn.hasAttribute('aria-disabled')).toBe(false);
    expect(zoomButton(elem, 'out').getAttribute('aria-disabled')).toBe('true');
    const onWindowKey = vi.fn();
    window.addEventListener('keydown', onWindowKey);
    const enter = dispatchKey(zoomIn, 'keydown', 'Enter');
    expect(enter.defaultPrevented).toBe(false);
    expect(onWindowKey).not.toHaveBeenCalled();
    window.removeEventListener('keydown', onWindowKey);
    frame.cmp.remove();
    expect(countListeners(elem)).toBe(0);
  });

  it('adds no listener without zoom buttons', () => {
    const frame = createMinimapFrame();
    expect(countListeners(frame.cmp.elem)).toBe(0);
    frame.setZoomEnabled({ zoomIn: false });
    frame.cmp.remove();
  });
});
