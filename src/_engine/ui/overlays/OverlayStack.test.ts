import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { countListeners, dispatchKey, stubKitDomAsync } from '../testing/KitDom';
import { createHudRoot, getHUDRootCMP } from '../core/HUD';
import { DEBUGGER_ROOT_ATTR, pushOverlay } from './OverlayStack';

/** An element under the HUD root (a window, a backdrop, a debugger root), with a button in it */
const addHudChild = (attrs: Record<string, string> = {}) => {
  const elem = document.createElement('div');
  for (const [name, value] of Object.entries(attrs)) elem.setAttribute(name, value);
  const button = document.createElement('button');
  elem.appendChild(button);
  getHUDRootCMP().elem.appendChild(elem);
  return { elem, button };
};

/** A button on the page outside the HUD root (an embed's host page) */
let pageButton: HTMLButtonElement;
/** Removers of this test's entries, run after it */
const removers: (() => void)[] = [];
const push = (...args: Parameters<typeof pushOverlay>) => {
  const remove = pushOverlay(...args);
  removers.push(() => remove(false));
  return remove;
};

/** Escape at `target`; whether a bubble listener on the window (the input system's) got it */
const escapeReachesWindow = (target: EventTarget, type: 'keydown' | 'keyup' = 'keydown') => {
  const binding = vi.fn();
  window.addEventListener(type, binding);
  dispatchKey(target, type, 'Escape');
  window.removeEventListener(type, binding);
  return binding.mock.calls.length > 0;
};

beforeAll(async () => {
  await stubKitDomAsync(
    '<!doctype html><html><head></head><body><button id="page">Page</button><div id="hudSlot"></div></body></html>'
  );
  createHudRoot({ slot: document.getElementById('hudSlot') as HTMLElement });
  pageButton = document.getElementById('page') as HTMLButtonElement;
});

afterEach(() => {
  removers.splice(0).forEach((remove) => remove());
  getHUDRootCMP().elem.replaceChildren();
  pageButton.focus();
});

describe('the overlay stack: Escape (p803 D7)', () => {
  it('adds its key listener on the first push, on the HUD root, never at load', () => {
    const hud = getHUDRootCMP().elem;
    expect(countListeners(hud, 'keydown')).toBe(0);
    push({ elem: addHudChild().elem, close: () => {} });
    expect(countListeners(hud, 'keydown')).toBe(1);
    push({ elem: addHudChild().elem, close: () => {} });
    expect(countListeners(hud, 'keydown')).toBe(1);
  });

  it('closes only the top entry, and no later listener gets the press or its keyup', () => {
    const lower = { ...addHudChild(), close: vi.fn() };
    const upper = { ...addHudChild(), close: vi.fn() };
    push({ elem: lower.elem, close: lower.close });
    push({ elem: upper.elem, close: upper.close });
    // A piece's own listener on its element doesn't run either (the HUD root's is a capture one)
    const own = vi.fn();
    lower.button.addEventListener('keydown', own);

    expect(escapeReachesWindow(lower.button)).toBe(false);
    expect(upper.close).toHaveBeenCalledTimes(1);
    expect(lower.close).not.toHaveBeenCalled();
    expect(own).not.toHaveBeenCalled();
    // Its keyup is swallowed, wherever the focus went; the next one isn't
    expect(escapeReachesWindow(pageButton, 'keyup')).toBe(false);
    expect(escapeReachesWindow(pageButton, 'keyup')).toBe(true);
    expect(countListeners(window, 'keyup')).toBe(0);
  });

  it('leaves a key pressed outside the HUD root to the page', () => {
    const close = vi.fn();
    push({ elem: addHudChild().elem, close });
    expect(escapeReachesWindow(pageButton)).toBe(true);
    expect(close).not.toHaveBeenCalled();
  });

  it('stops Escape at an entry without close, which stays open', () => {
    const below = vi.fn();
    push({ elem: addHudChild().elem, close: below });
    const modal = addHudChild();
    push({ elem: modal.elem });
    expect(escapeReachesWindow(modal.button)).toBe(false);
    expect(below).not.toHaveBeenCalled();
    escapeReachesWindow(pageButton, 'keyup');
  });

  it('closes one entry per press, not one per key repeat', () => {
    const lower = vi.fn();
    const upper = vi.fn();
    const { button } = addHudChild();
    push({ elem: addHudChild().elem, close: lower });
    push({ elem: addHudChild().elem, close: upper });
    dispatchKey(button, 'keydown', 'Escape', { repeat: true });
    expect(upper).not.toHaveBeenCalled();
    expect(lower).not.toHaveBeenCalled();
    escapeReachesWindow(pageButton, 'keyup');
  });

  it('drops an entry whose element left the document: Escape goes to the next', () => {
    const lower = vi.fn();
    push({ elem: addHudChild().elem, close: lower });
    const gone = addHudChild();
    push({ elem: gone.elem, close: () => {} });
    gone.elem.remove();
    escapeReachesWindow(getHUDRootCMP().elem);
    expect(lower).toHaveBeenCalledTimes(1);
    escapeReachesWindow(pageButton, 'keyup');
  });

  it('lets Escape through when every entry is gone', () => {
    const remove = push({ elem: addHudChild().elem, close: () => {} });
    remove(false);
    remove(false); // twice: a no-op
    expect(escapeReachesWindow(addHudChild().button)).toBe(true);
  });
});

describe('the overlay stack: focus return', () => {
  it('gives the focus back to what had it at the push, when it was in the overlay', () => {
    const opener = addHudChild().button;
    opener.focus();
    const overlay = addHudChild();
    const remove = push({ elem: overlay.elem, close: () => {} });
    overlay.button.focus();
    remove();
    expect(document.activeElement).toBe(opener);
  });

  it('also when the focused element was removed with the overlay (the body has it)', () => {
    pageButton.focus();
    const overlay = addHudChild();
    const remove = push({ elem: overlay.elem });
    overlay.button.focus();
    overlay.elem.remove();
    expect(document.activeElement).toBe(document.body);
    remove();
    expect(document.activeElement).toBe(pageButton);
  });

  it('leaves the focus where the user moved it, or when asked to', () => {
    const elsewhere = addHudChild().button;
    const overlay = addHudChild();
    const remove = push({ elem: overlay.elem, returnFocus: pageButton });
    elsewhere.focus();
    remove();
    expect(document.activeElement).toBe(elsewhere);

    const other = addHudChild();
    const removeOther = push({ elem: other.elem, returnFocus: pageButton });
    other.button.focus();
    removeOther(false);
    expect(document.activeElement).toBe(other.button);
  });

  it('skips an opener that left the document', () => {
    const opener = addHudChild();
    opener.button.focus();
    const overlay = addHudChild();
    const remove = push({ elem: overlay.elem });
    overlay.button.focus();
    opener.elem.remove();
    remove();
    expect(document.activeElement).toBe(overlay.button);
  });
});

describe('the overlay stack: inert', () => {
  const isInert = (elem: Element) => elem.hasAttribute('inert');

  it("sets inert on the HUD root's other children, never outside it, and restores it", () => {
    const window1 = addHudChild();
    const dialog = addHudChild();
    const backdrop = addHudChild();
    const remove = push({ elem: dialog.elem, inert: true, keep: [backdrop.elem] });
    expect(isInert(window1.elem)).toBe(true);
    expect(isInert(dialog.elem)).toBe(false);
    expect(isInert(backdrop.elem)).toBe(false);
    expect(isInert(pageButton)).toBe(false);
    // Inert refuses the focus (the shim follows the browser)
    window1.button.focus();
    expect(document.activeElement).not.toBe(window1.button);
    remove(false);
    expect(isInert(window1.elem)).toBe(false);
  });

  it('keeps the entries above it live, and a second one makes the first inert', () => {
    const first = addHudChild();
    const removeFirst = push({ elem: first.elem, inert: true });
    const list = addHudChild();
    const removeList = push({ elem: list.elem, close: () => {} });
    expect(isInert(list.elem)).toBe(false);

    const second = addHudChild();
    const removeSecond = push({ elem: second.elem, inert: true });
    expect(isInert(first.elem)).toBe(true);
    expect(isInert(list.elem)).toBe(true);
    expect(isInert(second.elem)).toBe(false);

    removeSecond(false);
    expect(isInert(first.elem)).toBe(false);
    expect(isInert(list.elem)).toBe(false);
    expect(isInert(second.elem)).toBe(true);
    removeList(false);
    removeFirst(false);
    expect(isInert(second.elem)).toBe(false);
  });

  it("spares the debugger's roots for an app's entry, not for a debug one", () => {
    const drawer = addHudChild({ [DEBUGGER_ROOT_ATTR]: '' });
    const removeApp = push({ elem: addHudChild().elem, inert: true });
    expect(isInert(drawer.elem)).toBe(false);
    removeApp(false);
    const removeDebug = push({ elem: addHudChild().elem, inert: true, isDebug: true });
    expect(isInert(drawer.elem)).toBe(true);
    removeDebug(false);
    expect(isInert(drawer.elem)).toBe(false);
  });

  it("neither sets nor removes the app's own inert", () => {
    const appInert = addHudChild({ inert: '' });
    const remove = push({ elem: addHudChild().elem, inert: true });
    remove(false);
    expect(isInert(appInert.elem)).toBe(true);
  });
});
