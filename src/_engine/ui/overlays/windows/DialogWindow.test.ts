import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock(import('../../../kernel/scene/SceneHooks'), () => ({ addSceneHooks: () => () => {} }));
vi.mock(import('../../../kernel/init/BootHooks'), () => ({ addBootAfterStartHook: () => true }));

type Modules = {
  dialogs: typeof import('./DialogWindow');
  windows: typeof import('./DraggableWindow');
};
let m: Modules;
let win: Window;
/** linkedom's Event (its window dispatches only its own) */
let DomEvent: typeof Event;
/** Every addEventListener call on the window, recorded */
const addListener = vi.fn<(type: string, fn: unknown, options?: unknown) => void>();

/** An Escape key event on the window; whether a listener added after the dialogs' got it */
const escape = (type: 'keydown' | 'keyup', repeat = false) => {
  const later = vi.fn();
  win.addEventListener(type, later);
  win.dispatchEvent(
    Object.assign(new DomEvent(type, { cancelable: true }), { key: 'Escape', repeat })
  );
  win.removeEventListener(type, later);
  return later.mock.calls.length > 0;
};

const isOpen = (id: string) => Boolean(m.windows.getDraggableWindow(id)?.isOpen);

describe('dialogs: Escape', () => {
  beforeAll(async () => {
    const { parseHTML } = await import('linkedom');
    const { document, window } = parseHTML(
      '<!doctype html><html><head></head><body><div id="hudSlot"></div></body></html>'
    );
    Object.assign(window, { innerWidth: 1280, innerHeight: 720 });
    Object.assign(window.HTMLElement.prototype, { getClientRects: () => [{}] });
    vi.stubGlobal('document', document);
    vi.stubGlobal('window', window);
    vi.stubGlobal('HTMLInputElement', window.HTMLInputElement);
    win = window as unknown as Window;
    DomEvent = window.Event as unknown as typeof Event;
    // linkedom's window is a proxy (no spyOn): a wrapper that records each call
    const addEventListener = window.addEventListener.bind(window);
    Object.assign(window, {
      addEventListener: (...args: Parameters<typeof addEventListener>) => {
        addListener(args[0], args[1], args[2]);
        addEventListener(...args);
      },
    });
    const hud = await import('../../core/HUD');
    hud.createHudRoot({ slot: document.getElementById('hudSlot') as HTMLElement });
    m = { dialogs: await import('./DialogWindow'), windows: await import('./DraggableWindow') };
  });

  it('adds no listener before the first closeOnEscape dialog (G1)', () => {
    const keyListeners = () =>
      addListener.mock.calls.filter(([type]) => type === 'keydown' || type === 'keyup');
    expect(keyListeners()).toEqual([]);
    m.dialogs.openDialog({ id: 'noEscape', title: 'No Escape' });
    expect(keyListeners()).toEqual([]);
    m.dialogs.openDialog({ id: 'first', title: 'First', closeOnEscape: true });
    expect(keyListeners().map(([type, , capture]) => [type, capture])).toEqual([
      ['keydown', true],
      ['keyup', true],
    ]);
    m.windows.closeDraggableWindow('noEscape');
  });

  it('closes the top closeOnEscape dialog, and no later listener gets the press', () => {
    m.dialogs.openDialog({ id: 'second', title: 'Second', closeOnEscape: true });
    expect(escape('keydown')).toBe(false);
    expect(isOpen('second')).toBe(false);
    expect(isOpen('first')).toBe(true);
    // Its keyup is swallowed too (a KEY_UP Escape binding mustn't fire), the next one isn't
    expect(escape('keyup')).toBe(false);
    expect(escape('keyup')).toBe(true);
  });

  it('closes one dialog per press, not one per key repeat', () => {
    m.dialogs.openDialog({ id: 'other', title: 'Other', closeOnEscape: true });
    escape('keydown');
    expect(isOpen('other')).toBe(false);
    expect(isOpen('first')).toBe(true);
    escape('keydown', true);
    expect(isOpen('first')).toBe(true);
    escape('keyup');
  });

  it('lets Escape through without a closeOnEscape dialog', () => {
    m.windows.closeDraggableWindow('first');
    m.dialogs.openDialog({ id: 'plain', title: 'Plain' });
    expect(escape('keydown')).toBe(true);
    expect(isOpen('plain')).toBe(true);
  });
});
