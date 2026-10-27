import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { stubKitDomAsync } from '../testing/KitDom';
import { createHudRoot, getHUDRootCMP, KIT_ROOT_CLASS } from '../core/HUD';
import { pushOverlay } from '../overlays/OverlayStack';
import { announce } from './Announcer';

const getRegions = (parent: Element) =>
  [...parent.children].filter((child) => child.getAttribute('role') === 'status');

beforeAll(async () => {
  await stubKitDomAsync();
  createHudRoot({ slot: document.getElementById('hudSlot') as HTMLElement });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('announce (p805 D4)', () => {
  it('reads through one polite, visually hidden region of the kit root, made on first use', () => {
    vi.useFakeTimers();
    const hud = getHUDRootCMP().elem;
    const piece = document.createElement('div');
    hud.append(piece);
    announce(piece, 'Sorted by Size, descending');
    const [region] = getRegions(hud);
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.className).toBe('aekVisuallyHidden');
    expect(region.textContent).toBe('');
    vi.advanceTimersByTime(50);
    expect(region.textContent).toBe('Sorted by Size, descending');
    announce(piece, '12 of 340');
    expect(getRegions(hud)).toEqual([region]);
    piece.remove();
  });

  it('empties the region first, so the same text is read again; a newer one replaces it', () => {
    vi.useFakeTimers();
    const hud = getHUDRootCMP().elem;
    announce(hud, 'Lamp moved to 3 of 8');
    vi.advanceTimersByTime(50);
    const [region] = getRegions(hud);
    announce(hud, 'Lamp moved to 3 of 8');
    expect(region.textContent).toBe('');
    announce(hud, 'Lamp moved to 4 of 8');
    vi.advanceTimersByTime(50);
    expect(region.textContent).toBe('Lamp moved to 4 of 8');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a kit root of the app’s own gets its region; outside every kit root the body does', () => {
    vi.useFakeTimers();
    const appRoot = document.createElement('div');
    appRoot.className = KIT_ROOT_CLASS;
    const piece = document.createElement('div');
    appRoot.append(piece);
    document.body.append(appRoot);
    announce(piece, 'Loaded');
    expect(getRegions(appRoot)).toHaveLength(1);
    const loose = document.createElement('div');
    document.body.append(loose);
    announce(loose, 'Loaded');
    expect(getRegions(document.body)).toHaveLength(1);
    appRoot.remove();
    loose.remove();
  });

  it('stays live under a modal’s inert', () => {
    const hud = getHUDRootCMP().elem;
    announce(hud, 'Ready');
    const [region] = getRegions(hud);
    const dialog = document.createElement('div');
    const other = document.createElement('div');
    hud.append(dialog, other);
    const remove = pushOverlay({ elem: dialog, inert: true });
    expect(other.hasAttribute('inert')).toBe(true);
    expect(region.hasAttribute('inert')).toBe(false);
    remove(false);
    dialog.remove();
    other.remove();
  });

  it('does nothing for an empty text', () => {
    const elem = document.createElement('div');
    document.body.append(elem);
    const before = document.body.children.length;
    announce(elem, '');
    expect(document.body.children.length).toBe(before);
    elem.remove();
  });
});
