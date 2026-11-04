import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  countListeners,
  dispatchKey,
  dispatchPointer,
  stubKitDomAsync,
} from '../../testing/KitDom';
import { createHudRoot, getHUDRootCMP } from '../../core/HUD';
import { setPromptDevice } from '../InputPrompt';
import {
  createControlsPage,
  type ControlsAction,
  type ControlsPageProps,
  type ControlsRebind,
} from './ControlsPage';

const part = (elem: Element, name: string) =>
  elem.querySelector(`.aekControlsPage__${name}`) as HTMLElement;

const getRegion = () =>
  [...getHUDRootCMP().elem.children].find((child) => child.getAttribute('role') === 'status');

/** A row's slot buttons in a column */
const getSlots = (elem: Element, action: string, column = 'KEYBOARD_MOUSE') =>
  [
    ...elem.querySelectorAll(
      `[data-action="${action}"] [data-column="${column}"] .aekControlsPage__bind`
    ),
  ] as HTMLButtonElement[];

/** The glyphs' names a slot shows */
const glyphNames = (button: Element) =>
  [...button.querySelectorAll('.aekInputGlyph')].map((glyph) => glyph.getAttribute('aria-label'));

/** An element's name from its `aria-labelledby` */
const labelOf = (elem: Element) =>
  (elem.getAttribute('aria-labelledby') ?? '')
    .split(' ')
    .map((id) => {
      const target = document.getElementById(id);
      if (target === elem) return glyphNames(elem).join(' ') || elem.textContent;
      return target?.textContent;
    })
    .join(' ');

const makeActions = (): ControlsAction[] => [
  {
    id: 'jump',
    name: 'Jump',
    bindings: [
      { device: 'KEYBOARD', keys: [' '] },
      { device: 'GAMEPAD', button: 'SOUTH' },
    ],
  },
  {
    id: 'interact',
    name: 'Interact',
    description: 'Talk, open, pick up',
    bindings: [
      { device: 'KEYBOARD', keys: ['e'] },
      { device: 'GAMEPAD', button: 'WEST' },
    ],
  },
  {
    id: 'move',
    name: 'Move',
    type: 'AXIS_2D',
    bindings: [
      { device: 'KEYBOARD', up: ['w'], down: ['s'], left: ['a'], right: ['d'] },
      { device: 'GAMEPAD', stick: 'LEFT' },
    ],
  },
  { id: 'fire', name: 'Fire', bindings: [{ device: 'MOUSE', button: 'LEFT' }] },
  {
    id: 'pause',
    name: 'Pause',
    rebindable: false,
    bindings: [{ device: 'KEYBOARD', keys: ['Escape'] }],
  },
];

const addPage = (props: Partial<ControlsPageProps> = {}) => {
  const onRebind = vi.fn<(change: ControlsRebind) => void>();
  const page = createControlsPage({ actions: makeActions(), onRebind, ...props });
  getHUDRootCMP().add(page.cmp);
  return { page, elem: page.cmp.elem, onRebind };
};

/** A window bubble listener: what an action map would see */
const watchWindow = () => {
  const seen = vi.fn();
  window.addEventListener('keydown', seen);
  return { seen, end: () => window.removeEventListener('keydown', seen) };
};

beforeAll(async () => {
  await stubKitDomAsync();
  createHudRoot({ slot: document.getElementById('hudSlot') as HTMLElement });
});

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  // The announcer's region outlives a test: its pending text is written before the fake clock goes
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

describe('controls page (p808 D9)', () => {
  it('is a table of actions, each slot a button named by its action, column and input', () => {
    const { page, elem } = addPage();
    const table = part(elem, 'table');
    expect(table.tagName).toBe('TABLE');
    expect(table.getAttribute('aria-label')).toBe('Controls');
    expect(
      [...elem.querySelectorAll('.aekControlsPage__columnHeader')].map((th) => th.textContent)
    ).toEqual(['Action', 'Keyboard and mouse', 'Gamepad']);
    const [space] = getSlots(elem, 'jump');
    expect(space.getAttribute('type')).toBe('button');
    expect(labelOf(space)).toBe('Jump Keyboard and mouse Space');
    expect(glyphNames(getSlots(elem, 'jump', 'GAMEPAD')[0])).toEqual(['Bottom face button']);
    expect(part(elem, 'actionDescription').textContent).toBe('Talk, open, pick up');
    // A composite's four keys, each its part
    const move = getSlots(elem, 'move');
    expect(move.map((button) => button.getAttribute('data-part'))).toEqual([
      'up',
      'left',
      'down',
      'right',
    ]);
    expect(labelOf(move[1])).toBe('Move Keyboard and mouse Left A');
    // A stick is shown, not rebound; a mouse button is a slot; no gamepad binding is an empty slot
    expect(getSlots(elem, 'move', 'GAMEPAD')).toHaveLength(0);
    expect(
      glyphNames(elem.querySelector('[data-action="move"] [data-column="GAMEPAD"]') as Element)
    ).toHaveLength(1);
    expect(glyphNames(getSlots(elem, 'fire')[0])).toEqual(['Left mouse button']);
    const empty = getSlots(elem, 'fire', 'GAMEPAD')[0];
    expect(empty.hasAttribute('data-empty')).toBe(true);
    expect(empty.textContent).toBe('Unbound');
    // A locked action: its keys, no button
    expect(getSlots(elem, 'pause')).toHaveLength(0);
    expect(part(elem.querySelector('[data-action="pause"]') as Element, 'fixed')).not.toBeNull();
    page.cmp.remove();
  });

  it('captures the next key, stopped before every other listener, and reports the new list', () => {
    const onCaptureChange = vi.fn();
    const { page, elem, onRebind } = addPage({ onCaptureChange });
    const watch = watchWindow();
    const [slot] = getSlots(elem, 'jump');
    slot.focus();
    slot.click();
    expect(page.isCapturing()).toBe(true);
    expect(onCaptureChange).toHaveBeenLastCalledWith(true);
    const capturing = getSlots(elem, 'jump')[0];
    expect(capturing.hasAttribute('data-capturing')).toBe(true);
    expect(capturing.textContent).toBe('Press a key');
    expect(document.activeElement).toBe(capturing);
    vi.advanceTimersByTime(50);
    expect(getRegion()?.textContent).toBe('Press a key or mouse button for Jump. Escape cancels.');
    // A held key's repeat is no input
    dispatchKey(capturing, 'keydown', 'F', { repeat: true });
    expect(page.isCapturing()).toBe(true);
    const event = dispatchKey(capturing, 'keydown', 'F', { shiftKey: true });
    expect(event.defaultPrevented).toBe(true);
    expect(watch.seen).not.toHaveBeenCalled();
    expect(onRebind).toHaveBeenCalledWith({
      action: 'jump',
      bindings: [
        { device: 'KEYBOARD', keys: ['f'] },
        { device: 'GAMEPAD', button: 'SOUTH' },
      ],
      column: 'KEYBOARD_MOUSE',
      reason: 'rebind',
    });
    expect(page.isCapturing()).toBe(false);
    expect(onCaptureChange).toHaveBeenLastCalledWith(false);
    const rebound = getSlots(elem, 'jump')[0];
    expect(glyphNames(rebound)).toEqual(['F']);
    expect(document.activeElement).toBe(rebound);
    vi.advanceTimersByTime(50);
    expect(getRegion()?.textContent).toBe('Jump: F');
    expect(page.getBindings('jump')?.[0]).toEqual({ device: 'KEYBOARD', keys: ['f'] });
    // The key it has already: nothing to report
    getSlots(elem, 'jump')[0].click();
    dispatchKey(document.body, 'keydown', 'f');
    expect(onRebind).toHaveBeenCalledTimes(1);
    // The capture's listeners are gone: the next key goes on
    dispatchKey(getSlots(elem, 'jump')[0], 'keydown', 'g');
    expect(watch.seen).toHaveBeenCalledTimes(1);
    watch.end();
    page.cmp.remove();
  });

  it('cancels on Escape, the timeout, or a press of the other device, changing nothing', () => {
    const { page, elem, onRebind } = addPage({ captureTimeoutMs: 1000 });
    getSlots(elem, 'jump')[0].click();
    dispatchKey(document.body, 'keydown', 'Escape');
    expect(page.isCapturing()).toBe(false);
    expect(document.activeElement).toBe(getSlots(elem, 'jump')[0]);
    vi.advanceTimersByTime(50);
    expect(getRegion()?.textContent).toBe('Jump not changed');
    getSlots(elem, 'jump')[0].click();
    vi.advanceTimersByTime(1000);
    expect(page.isCapturing()).toBe(false);
    // The gamepad column: a pointer press cancels and goes on (not stopped)
    getSlots(elem, 'jump', 'GAMEPAD')[0].click();
    const press = dispatchPointer(document.body, 'pointerdown');
    expect(press.defaultPrevented).toBe(false);
    expect(page.isCapturing()).toBe(false);
    // ...and every key meanwhile is stopped, none bound
    getSlots(elem, 'jump', 'GAMEPAD')[0].click();
    const watch = watchWindow();
    dispatchKey(document.body, 'keydown', 'f');
    expect(watch.seen).not.toHaveBeenCalled();
    expect(page.isCapturing()).toBe(true);
    page.cancelCapture();
    watch.end();
    expect(onRebind).not.toHaveBeenCalled();
    page.cmp.remove();
  });

  it('captures a mouse button, dropping the click and the menu that follow it', () => {
    const { page, elem, onRebind } = addPage();
    getSlots(elem, 'jump')[0].click();
    const press = dispatchPointer(document.body, 'pointerdown', { button: 2 });
    expect(press.defaultPrevented).toBe(true);
    expect(onRebind.mock.calls[0][0].bindings[0]).toEqual({ device: 'MOUSE', button: 'RIGHT' });
    const onClick = vi.fn();
    document.body.addEventListener('click', onClick);
    const menu = Object.assign(
      new window.Event('contextmenu', { bubbles: true, cancelable: true })
    );
    document.body.dispatchEvent(menu);
    expect(menu.defaultPrevented).toBe(true);
    dispatchPointer(document.body, 'pointerup', { button: 2 });
    dispatchPointer(document.body, 'click');
    expect(onClick).not.toHaveBeenCalled();
    // The task after the release: clicks go through again
    vi.advanceTimersByTime(1);
    dispatchPointer(document.body, 'click');
    expect(onClick).toHaveBeenCalledTimes(1);
    document.body.removeEventListener('click', onClick);
    // A touch cancels
    getSlots(elem, 'fire')[0].click();
    dispatchPointer(document.body, 'pointerdown', { pointerType: 'touch' });
    expect(page.isCapturing()).toBe(false);
    page.cmp.remove();
  });

  it('rebinds a composite’s part with a key only, a mouse press cancelling it', () => {
    const { page, elem, onRebind } = addPage();
    getSlots(elem, 'move')[2].click();
    dispatchPointer(document.body, 'pointerdown');
    expect(page.isCapturing()).toBe(false);
    getSlots(elem, 'move')[2].click();
    dispatchKey(document.body, 'keydown', 'k');
    expect(onRebind).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'move',
        bindings: [
          { device: 'KEYBOARD', up: ['w'], down: ['k'], left: ['a'], right: ['d'] },
          { device: 'GAMEPAD', stick: 'LEFT' },
        ],
      })
    );
    vi.advanceTimersByTime(50);
    expect(getRegion()?.textContent).toBe('Move, Down: K');
    page.cmp.remove();
  });

  it('captures a gamepad button pressed after the start, a held one once released', () => {
    const buttons = Array.from({ length: 17 }, () => ({ pressed: false }));
    const realNavigator = globalThis.navigator;
    vi.stubGlobal('navigator', { getGamepads: () => [{ index: 0, buttons }, null] });
    const { page, elem, onRebind } = addPage();
    // SOUTH clicked the slot (the app's map): still held as the capture starts
    buttons[0].pressed = true;
    getSlots(elem, 'interact', 'GAMEPAD')[0].click();
    vi.advanceTimersByTime(48);
    expect(page.isCapturing()).toBe(true);
    buttons[0].pressed = false;
    vi.advanceTimersByTime(16);
    buttons[3].pressed = true;
    vi.advanceTimersByTime(16);
    expect(onRebind).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'interact',
        bindings: [
          { device: 'KEYBOARD', keys: ['e'] },
          { device: 'GAMEPAD', button: 'NORTH' },
        ],
        column: 'GAMEPAD',
      })
    );
    expect(page.isCapturing()).toBe(false);
    // In the keyboard column a gamepad press cancels
    buttons[3].pressed = false;
    getSlots(elem, 'interact')[0].click();
    vi.advanceTimersByTime(16);
    buttons[1].pressed = true;
    vi.advanceTimersByTime(16);
    expect(page.isCapturing()).toBe(false);
    expect(onRebind).toHaveBeenCalledTimes(1);
    page.cmp.remove();
    vi.stubGlobal('navigator', realNavigator);
  });

  it('asks about an input another action has: swap, keep both or cancel', () => {
    const { page, elem, onRebind } = addPage();
    const capture = (key: string) => {
      getSlots(elem, 'jump')[0].click();
      dispatchKey(document.body, 'keydown', key);
    };
    capture('e');
    expect(onRebind).not.toHaveBeenCalled();
    const question = part(elem, 'conflict');
    expect(question.getAttribute('role')).toBe('group');
    expect(labelOf(question)).toBe('E Also bound to Interact.');
    expect(document.activeElement).toBe(part(elem, 'swap'));
    // The row stays as it was meanwhile
    expect(glyphNames(getSlots(elem, 'jump')[0])).toEqual(['Space']);
    part(elem, 'swap').click();
    expect(
      onRebind.mock.calls.map(([change]) => [change.action, change.reason, change.bindings[0]])
    ).toEqual([
      ['jump', 'rebind', { device: 'KEYBOARD', keys: ['e'] }],
      ['interact', 'swap', { device: 'KEYBOARD', keys: [' '] }],
    ]);
    expect(part(elem, 'conflict')).toBeNull();
    expect(document.activeElement).toBe(getSlots(elem, 'jump')[0]);
    vi.advanceTimersByTime(50);
    expect(getRegion()?.textContent).toBe('Jump: E. Interact: Space');
    // Keep both: only the rebound action changes
    onRebind.mockClear();
    capture(' ');
    part(elem, 'keepBoth').click();
    expect(onRebind.mock.calls.map(([change]) => change.action)).toEqual(['jump']);
    // Both have Space now. The focus leaving the question cancels it
    onRebind.mockClear();
    capture(' ');
    expect(part(elem, 'conflict')).not.toBeNull();
    getSlots(elem, 'fire')[0].focus();
    expect(part(elem, 'conflict')).toBeNull();
    capture(' ');
    part(elem, 'conflictCancel').click();
    expect(onRebind).not.toHaveBeenCalled();
    page.cmp.remove();
  });

  it('offers no swap that would leave a part empty, and no conflict across groups', () => {
    const actions = makeActions();
    actions[1] = { ...actions[1], group: 'menu' };
    const { page, elem } = addPage({ actions });
    // Jump to W, which Move's up has: Jump's space can go there
    getSlots(elem, 'jump')[0].click();
    dispatchKey(document.body, 'keydown', 'w');
    expect(part(elem, 'swap')).not.toBeNull();
    part(elem, 'conflictCancel').click();
    // Fire (a mouse button) to W: Move's up can't take a mouse button
    getSlots(elem, 'fire')[0].click();
    dispatchKey(document.body, 'keydown', 'w');
    expect(part(elem, 'swap')).toBeNull();
    expect(document.activeElement).toBe(part(elem, 'keepBoth'));
    part(elem, 'conflictCancel').click();
    // Interact is in another group: E on Jump is no conflict
    getSlots(elem, 'jump')[0].click();
    dispatchKey(document.body, 'keydown', 'e');
    expect(part(elem, 'conflict')).toBeNull();
    page.cmp.remove();
  });

  it('resets to the defaults, reporting only the actions that changed', () => {
    const { page, elem, onRebind } = addPage();
    getSlots(elem, 'jump')[0].click();
    dispatchKey(document.body, 'keydown', 'f');
    onRebind.mockClear();
    part(elem, 'reset').click();
    expect(onRebind).toHaveBeenCalledTimes(1);
    expect(onRebind).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'jump', column: null, reason: 'reset' })
    );
    expect(glyphNames(getSlots(elem, 'jump')[0])).toEqual(['Space']);
    vi.advanceTimersByTime(50);
    expect(getRegion()?.textContent).toBe('Controls reset to defaults');
    // setBindings shows a change made elsewhere, reporting nothing
    page.setBindings('jump', [{ device: 'KEYBOARD', keys: ['j'] }]);
    expect(glyphNames(getSlots(elem, 'jump')[0])).toEqual(['J']);
    expect(onRebind).toHaveBeenCalledTimes(1);
    page.cmp.remove();
    // Without the button: a settings menu's Reset page calls reset()
    const bare = addPage({ showReset: false });
    expect(part(bare.elem, 'reset')).toBeNull();
    bare.page.cmp.remove();
  });

  it('shows the gamepad column in the prompts’ family, or a fixed one', () => {
    const { page, elem } = addPage();
    const family = () =>
      getSlots(elem, 'jump', 'GAMEPAD')[0]
        .querySelector('.aekInputGlyph')
        ?.getAttribute('data-family');
    expect(family()).toBe('generic');
    setPromptDevice({ device: 'GAMEPAD', family: 'PLAYSTATION' });
    expect(family()).toBe('playstation');
    // Back on the keyboard: the last gamepad's labels stay
    setPromptDevice({ device: 'KEYBOARD_MOUSE' });
    expect(family()).toBe('playstation');
    page.setFamily('XBOX');
    expect(family()).toBe('xbox');
    setPromptDevice({ device: 'GAMEPAD', family: 'NINTENDO' });
    expect(family()).toBe('xbox');
    setPromptDevice({ device: 'KEYBOARD_MOUSE' });
    page.cmp.remove();
  });

  it('keeps Enter and Space on its buttons from the action maps', () => {
    const { page, elem } = addPage();
    const watch = watchWindow();
    dispatchKey(getSlots(elem, 'jump')[0], 'keydown', 'Enter');
    dispatchKey(getSlots(elem, 'jump')[0], 'keydown', ' ');
    expect(watch.seen).not.toHaveBeenCalled();
    watch.end();
    page.cmp.remove();
  });

  it('leaves no listener or timer after removal, mid-capture too', () => {
    const before = countListeners(window);
    const onCaptureChange = vi.fn();
    const { page, elem } = addPage({ onCaptureChange });
    getSlots(elem, 'jump')[0].click();
    expect(countListeners(window)).toBeGreaterThan(before);
    // The start's announcement is the announcer's, not the page's
    vi.advanceTimersByTime(50);
    page.cmp.remove();
    expect(countListeners(window)).toBe(before);
    expect(onCaptureChange).toHaveBeenLastCalledWith(false);
    expect(vi.getTimerCount()).toBe(0);
    expect(elem.isConnected).toBe(false);
  });
});
