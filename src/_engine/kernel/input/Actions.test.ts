import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { lwarn } from '../../utils/Logger';
import { playActionRecording, recordActions } from './ActionRecording';
import {
  createActionMap,
  getActionMap,
  isKeyEventInActiveMaps,
  pollActionsFrame,
  sampleActions,
  setActionContextEnabled,
  skipActionSample,
} from './Actions';
import type { ActionMap } from './ActionTypes';
import { onGamepadConnected } from './GamepadInput';
import { setAllInputsEnabled, setAppInputsSuspended } from './InputState';

// The devices' DOM: window and the canvas are event targets, the gamepads a stubbed list
const dom = vi.hoisted(() => {
  const win = new EventTarget();
  const canvas = new EventTarget();
  const doc = {
    getElementById: () => canvas,
    documentElement: new EventTarget(),
    pointerLockElement: null,
  };
  const pads: (Gamepad | null)[] = [];
  vi.stubGlobal('window', win);
  vi.stubGlobal('document', doc);
  vi.stubGlobal('navigator', { getGamepads: () => pads });
  return { win, canvas, pads };
});

vi.mock(import('../../utils/Logger'), async (importOriginal) => ({
  ...(await importOriginal()),
  lwarn: vi.fn(),
}));

const held = new Set<string>();

const keyEvent = (
  type: 'keydown' | 'keyup',
  key: string,
  mods: { ctrl?: boolean; meta?: boolean; repeat?: boolean } = {}
) => {
  if (type === 'keydown') held.add(key);
  else held.delete(key);
  const e = Object.assign(new Event(type, { cancelable: true }), {
    key,
    repeat: !!mods.repeat,
    shiftKey: held.has('Shift'),
    ctrlKey: !!mods.ctrl || held.has('Control'),
    altKey: false,
    metaKey: !!mods.meta || held.has('Meta'),
  });
  dom.win.dispatchEvent(e);
  return e;
};
const down = (key: string, mods?: { ctrl?: boolean; meta?: boolean; repeat?: boolean }) =>
  keyEvent('keydown', key, mods);
const up = (key: string) => keyEvent('keyup', key);

/** A mouse event whose target is the canvas (dispatched on window, where the listeners are). */
const mouseEvent = (type: string, fields: object) => {
  const e = Object.assign(new Event(type), fields);
  Object.defineProperty(e, 'target', { value: dom.canvas });
  dom.win.dispatchEvent(e);
};

let padTimestamp = 0;
const setPad = (
  index: number,
  pad: { buttons?: { [button: number]: number }; axes?: number[] } | null
) => {
  if (!pad) {
    dom.pads[index] = null;
    return;
  }
  dom.pads[index] = {
    index,
    id: `pad ${index}`,
    connected: true,
    mapping: 'standard',
    timestamp: ++padTimestamp,
    axes: pad.axes ?? [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, (_, b) => {
      const value = pad.buttons?.[b] ?? 0;
      return { value, pressed: value >= 0.5, touched: value > 0 };
    }),
  } as unknown as Gamepad;
};

const maps: ActionMap[] = [];
const track = <T extends ActionMap>(map: T) => {
  maps.push(map);
  return map;
};

const createPlayerMap = (id = 'player') =>
  track(
    createActionMap({
      id,
      actions: {
        jump: { type: 'BUTTON', name: 'Jump' },
        move: { type: 'AXIS_2D' },
        turn: { type: 'AXIS_1D' },
      },
      bindings: {
        jump: [{ device: 'KEYBOARD', keys: [' ', 'Enter'] }],
        move: [{ device: 'KEYBOARD', up: ['w'], down: ['s'], left: ['a'], right: ['d'] }],
        turn: [{ device: 'KEYBOARD', negative: ['q'], positive: ['e'] }],
      },
    })
  );

beforeEach(() => {
  vi.mocked(lwarn).mockClear();
});

afterEach(() => {
  for (const key of [...held]) up(key);
  while (maps.length) maps.pop()!.delete();
  dom.pads.length = 0;
  pollActionsFrame();
  setActionContextEnabled('GAMEPLAY', true);
  setAllInputsEnabled(true);
  setAppInputsSuspended(false);
});

describe('sampling', () => {
  it('counts a tap shorter than a step, on one sample only', () => {
    const map = createPlayerMap();
    down(' ');
    up(' ');
    sampleActions(0);
    expect(map.read('jump')).toEqual({
      isDown: false,
      pressedCount: 1,
      releasedCount: 1,
      value: 0,
      x: 0,
      y: 0,
    });
    sampleActions(1);
    expect(map.read('jump').pressedCount).toBe(0);
  });

  it('gives a press to the first sub-step only, and the held state to every one', () => {
    const map = createPlayerMap();
    down(' ');
    sampleActions(0);
    expect(map.read('jump')).toMatchObject({ isDown: true, pressedCount: 1, value: 1 });
    sampleActions(1);
    expect(map.read('jump')).toMatchObject({ isDown: true, pressedCount: 0, value: 1 });
  });

  it('reads the same object every time, updated in place', () => {
    const map = createPlayerMap();
    const state = map.read('jump');
    down('Enter');
    sampleActions(0);
    expect(map.read('jump')).toBe(state);
    expect(state.isDown).toBe(true);
  });

  it('keeps a button down while any of its keys is', () => {
    const map = createPlayerMap();
    down(' ');
    down('Enter'); // a press too (see below)
    up(' ');
    sampleActions(0);
    expect(map.read('jump')).toMatchObject({ isDown: true, pressedCount: 2, releasedCount: 0 });
  });

  it('drops the counts on a skipped sample, keeping what is held', () => {
    const map = createPlayerMap();
    down(' ');
    skipActionSample();
    sampleActions(0);
    expect(map.read('jump')).toMatchObject({ isDown: true, pressedCount: 0 });
  });

  it('reads a key held before the map was made as down, without a press', () => {
    down(' ');
    const map = createPlayerMap();
    sampleActions(0);
    expect(map.read('jump')).toMatchObject({ isDown: true, pressedCount: 0 });
  });
});

describe('event callbacks', () => {
  it('fire at the device event, before any sample, with the event', () => {
    const map = createPlayerMap();
    const pressed = vi.fn();
    const released = vi.fn();
    map.onPressed('jump', pressed);
    const removeReleased = map.onReleased('jump', released);
    const e = down(' ');
    expect(pressed).toHaveBeenCalledWith(e);
    up(' ');
    expect(released).toHaveBeenCalledTimes(1);
    removeReleased();
    down(' ');
    up(' ');
    expect(pressed).toHaveBeenCalledTimes(2);
    expect(released).toHaveBeenCalledTimes(1);
  });

  it('fire for an axis leaving 0 and coming back', () => {
    const map = createPlayerMap();
    const pressed = vi.fn();
    map.onPressed('move', pressed);
    down('w');
    down('d');
    expect(pressed).toHaveBeenCalledTimes(1);
  });
});

describe('keyboard bindings', () => {
  it('make a composite of length 1, diagonals included', () => {
    const map = createPlayerMap();
    down('w');
    sampleActions(0);
    expect(map.read('move')).toMatchObject({ x: 0, y: 1, value: 1, isDown: true });
    down('d');
    sampleActions(1);
    const { x, y, value } = map.read('move');
    expect([x, y, value].map((n) => n.toFixed(6))).toEqual(['0.707107', '0.707107', '1.000000']);
    up('w');
    sampleActions(2);
    expect(map.read('move')).toMatchObject({ x: 1, y: 0 });
    down('a');
    sampleActions(3);
    expect(map.read('move')).toMatchObject({ x: 0, y: 0, isDown: false, releasedCount: 1 });
  });

  it('make a 1D axis from two sets of keys', () => {
    const map = createPlayerMap();
    down('q');
    sampleActions(0);
    expect(map.read('turn').value).toBe(-1);
    down('e');
    sampleActions(1);
    expect(map.read('turn')).toMatchObject({ value: 0, isDown: false });
  });

  it('ignore modifiers in a gameplay map, match them exactly in a debug one', () => {
    const player = createPlayerMap();
    const debug = track(
      createActionMap({
        id: 'debug',
        context: 'DEBUG',
        actions: { undo: { type: 'BUTTON' } },
        bindings: { undo: [{ device: 'KEYBOARD', keys: [{ key: 'z', ctrl: true }] }] },
      })
    );
    down('Shift');
    down('W');
    down('z');
    sampleActions(0);
    expect(player.read('move').y).toBe(1);
    expect(debug.read('undo').isDown).toBe(false);
    up('z');
    up('W');
    up('Shift');
    down('z', { ctrl: true });
    sampleActions(1);
    expect(debug.read('undo').isDown).toBe(true);
  });

  it('prevent the default of a bound key in a gameplay map only', () => {
    createPlayerMap();
    track(
      createActionMap({
        id: 'debug',
        context: 'DEBUG',
        actions: { help: { type: 'BUTTON' } },
        bindings: { help: [{ device: 'KEYBOARD', keys: ['h'] }] },
      })
    );
    expect(down(' ').defaultPrevented).toBe(true);
    expect(down('h').defaultPrevented).toBe(false);
    expect(down('x').defaultPrevented).toBe(false);
  });

  it("count a new keydown of a held button's key as a press, not a key-repeat", () => {
    const map = createPlayerMap();
    const pressed = vi.fn();
    map.onPressed('jump', pressed);
    down(' ');
    down(' ', { repeat: true });
    down('Enter'); // another of its keys
    // A key whose keyup never came (macOS sends none while ⌘ is held)
    down(' ');
    sampleActions(0);
    expect(map.read('jump')).toMatchObject({ isDown: true, pressedCount: 3, releasedCount: 0 });
    expect(pressed).toHaveBeenCalledTimes(3);
  });

  it('count ⌘Z pressed again while ⌘ is held, without a keyup of Z between', () => {
    const debug = track(
      createActionMap({
        id: 'debug',
        context: 'DEBUG',
        actions: { undo: { type: 'BUTTON' } },
        bindings: { undo: [{ device: 'KEYBOARD', keys: [{ key: 'z', meta: true }] }] },
      })
    );
    const undo = vi.fn();
    debug.onPressed('undo', undo);
    down('Meta');
    down('z', { meta: true });
    down('z', { meta: true });
    expect(undo).toHaveBeenCalledTimes(2);
  });

  it('do not count a press again for an axis', () => {
    const map = createPlayerMap();
    const pressed = vi.fn();
    map.onPressed('move', pressed);
    down('w');
    down('w');
    expect(pressed).toHaveBeenCalledTimes(1);
  });

  it('tell whether another active map takes a key event', () => {
    createPlayerMap();
    const e = down(' ') as unknown as KeyboardEvent;
    expect(isKeyEventInActiveMaps(e, 'other')).toBe(true);
    expect(isKeyEventInActiveMaps(e, 'player')).toBe(false);
    expect(isKeyEventInActiveMaps(down('x') as unknown as KeyboardEvent, 'other')).toBe(false);
    setActionContextEnabled('GAMEPLAY', false);
    expect(isKeyEventInActiveMaps(e, 'other')).toBe(false);
  });

  it('follow replaced bindings, releasing a dropped held key', () => {
    const map = createPlayerMap();
    down(' ');
    map.setBindings('jump', [{ device: 'KEYBOARD', keys: ['j'] }]);
    sampleActions(0);
    expect(map.read('jump')).toMatchObject({ isDown: false, releasedCount: 1 });
    expect(map.getBindings('jump')).toEqual([{ device: 'KEYBOARD', keys: ['j'] }]);
  });

  it('leave out a binding that does not fit its action, with a warning', () => {
    const map = track(
      createActionMap({
        id: 'wrong',
        actions: { jump: { type: 'BUTTON' } },
        // Plain data from a config can be anything
        bindings: { jump: [{ device: 'GAMEPAD', stick: 'LEFT' } as never] },
      })
    );
    expect(lwarn).toHaveBeenCalledTimes(1);
    setPad(0, { axes: [1, 0, 0, 0] });
    pollActionsFrame();
    sampleActions(0);
    expect(map.read('jump').isDown).toBe(false);
  });
});

describe('contexts and activity', () => {
  it('a disabled context reads idle and calls nothing; a key held through it reads down after', () => {
    const map = createPlayerMap();
    const pressed = vi.fn();
    map.onPressed('jump', pressed);
    setActionContextEnabled('GAMEPLAY', false);
    down(' ');
    sampleActions(0);
    expect(map.read('jump').isDown).toBe(false);
    expect(map.isActive()).toBe(false);
    expect(pressed).not.toHaveBeenCalled();
    setActionContextEnabled('GAMEPLAY', true);
    sampleActions(1);
    expect(map.read('jump')).toMatchObject({ isDown: true, pressedCount: 0 });
  });

  it('editor views suspend gameplay maps but not debug ones; a scene load turns both off', () => {
    const player = createPlayerMap();
    const debug = track(
      createActionMap({ id: 'debug', context: 'DEBUG', actions: { a: { type: 'BUTTON' } } })
    );
    setAppInputsSuspended(true);
    expect([player.isActive(), debug.isActive()]).toEqual([false, true]);
    setAppInputsSuspended(false);
    setAllInputsEnabled(false);
    expect([player.isActive(), debug.isActive()]).toEqual([false, false]);
  });

  it('a map of another scene, or a disabled map, is inactive', () => {
    const map = track(
      createActionMap({ id: 'scened', sceneId: 'notThisScene', actions: { a: { type: 'BUTTON' } } })
    );
    expect(map.isActive()).toBe(false);
    const player = createPlayerMap();
    player.setEnabled(false);
    expect(player.isActive()).toBe(false);
  });

  it('a map with a taken id replaces the old one', () => {
    const first = createPlayerMap();
    const second = createPlayerMap();
    expect(getActionMap('player')).toBe(second);
    expect(first.isActive()).toBe(false);
  });
});

describe('the gamepad', () => {
  const createPadMap = (gamepadIndex?: number) =>
    track(
      createActionMap({
        id: 'pad',
        gamepadIndex,
        actions: {
          jump: { type: 'BUTTON' },
          fire: { type: 'BUTTON' },
          move: { type: 'AXIS_2D' },
          dpad: { type: 'AXIS_2D' },
          zoom: { type: 'AXIS_1D' },
        },
        bindings: {
          jump: [{ device: 'GAMEPAD', button: 'SOUTH' }],
          fire: [{ device: 'GAMEPAD', button: 'RIGHT_TRIGGER' }],
          move: [{ device: 'GAMEPAD', stick: 'LEFT', deadzone: 0.2 }],
          dpad: [{ device: 'GAMEPAD', stick: 'DPAD' }],
          zoom: [{ device: 'GAMEPAD', axis: 'RIGHT_Y', invert: true }],
        },
      })
    );

  it('reads sticks past a radial deadzone, up positive', () => {
    const map = createPadMap();
    setPad(0, { axes: [0.1, -0.1, 0, 0] });
    pollActionsFrame();
    sampleActions(0);
    expect(map.read('move')).toMatchObject({ x: 0, y: 0, isDown: false });
    setPad(0, { axes: [0, -1, 0, 0.6] });
    pollActionsFrame();
    sampleActions(1);
    expect(map.read('move')).toMatchObject({ x: 0, y: 1, value: 1, pressedCount: 1 });
    // RIGHT_Y down in the API is negative up, inverted to positive; past the 0.15 deadzone
    expect(map.read('zoom').value).toBeCloseTo((0.6 - 0.15) / 0.85);
  });

  it('reports a button press at the poll, and a trigger by its value', () => {
    const map = createPadMap();
    const pressed = vi.fn();
    map.onPressed('jump', pressed);
    setPad(0, { buttons: { 0: 1, 7: 0.3 } });
    pollActionsFrame();
    expect(pressed).toHaveBeenCalledWith(null);
    sampleActions(0);
    expect(map.read('jump')).toMatchObject({ isDown: true, value: 1 });
    expect(map.read('fire')).toMatchObject({ isDown: false, value: 0.3 });
  });

  it('reads the d-pad as a stick of length 1', () => {
    const map = createPadMap();
    setPad(0, { buttons: { 12: 1, 15: 1 } });
    pollActionsFrame();
    sampleActions(0);
    expect(map.read('dpad').x).toBeCloseTo(Math.SQRT1_2);
    expect(map.read('dpad').y).toBeCloseTo(Math.SQRT1_2);
  });

  it('reads any pad by default, only its own with gamepadIndex', () => {
    setPad(0, null);
    setPad(1, { buttons: { 0: 1 } });
    const anyPad = createPadMap();
    pollActionsFrame();
    sampleActions(0);
    expect(anyPad.read('jump').isDown).toBe(true);
    anyPad.delete();
    const firstPad = createPadMap(0);
    sampleActions(1);
    expect(firstPad.read('jump').isDown).toBe(false);
  });

  it('calls the connection callbacks from the DOM event', () => {
    const fn = vi.fn();
    const remove = onGamepadConnected(fn);
    const e = Object.assign(new Event('gamepadconnected'), {
      gamepad: { index: 2, id: 'pad', mapping: 'standard' },
    });
    dom.win.dispatchEvent(e);
    expect(fn).toHaveBeenCalledWith({ index: 2, id: 'pad', isStandardMapping: true });
    remove();
  });
});

describe('the mouse', () => {
  it('sums movement over the canvas into a delta, up positive', () => {
    const map = track(
      createActionMap({
        id: 'look',
        actions: { look: { type: 'DELTA_2D' }, fire: { type: 'BUTTON' } },
        bindings: {
          look: [{ device: 'MOUSE', delta: 'MOVE', scale: 2 }],
          fire: [{ device: 'MOUSE', button: 'LEFT' }],
        },
      })
    );
    mouseEvent('mousemove', { movementX: 3, movementY: 1 });
    mouseEvent('mousemove', { movementX: 1, movementY: 1 });
    mouseEvent('mousedown', { button: 0 });
    sampleActions(0);
    expect(map.read('look')).toMatchObject({ x: 8, y: -4, isDown: true });
    expect(map.read('fire')).toMatchObject({ isDown: true, pressedCount: 1 });
    mouseEvent('mouseup', { button: 0 });
    sampleActions(1);
    expect(map.read('look')).toMatchObject({ x: 0, y: 0, isDown: false });
    expect(map.read('fire')).toMatchObject({ isDown: false, releasedCount: 1 });
  });
});

describe('recording and replay', () => {
  it('records the non-idle actions per step, and replays them at their steps', () => {
    const map = createPlayerMap();
    const recorder = recordActions(map);
    sampleActions(10);
    down(' ');
    up(' ');
    down('w');
    sampleActions(11);
    up('w');
    sampleActions(12);
    sampleActions(13);
    const recording = recorder.stop();
    expect(recording).toEqual({
      mapId: 'player',
      firstStep: 10,
      lastStep: 13,
      frames: [
        {
          step: 11,
          actions: {
            jump: { pressedCount: 1, releasedCount: 1 },
            move: { isDown: true, pressedCount: 1, value: 1, y: 1 },
          },
        },
        { step: 12, actions: { move: { releasedCount: 1 } } },
      ],
    });
    // Plain data
    expect(JSON.parse(JSON.stringify(recording))).toEqual(recording);

    const replayed = createPlayerMap();
    const pressed = vi.fn();
    replayed.onPressed('jump', pressed);
    const playback = playActionRecording(replayed, recording);
    down('d'); // the devices don't drive it during the replay
    sampleActions(11);
    expect(replayed.read('move')).toMatchObject({ isDown: true, y: 1, x: 0 });
    expect(pressed).toHaveBeenCalledTimes(1);
    sampleActions(13);
    expect(playback.isPlaying()).toBe(true);
    expect(replayed.read('move').isDown).toBe(false);
    sampleActions(14);
    expect(playback.isPlaying()).toBe(false);
    expect(replayed.read('move')).toMatchObject({ x: 1, isDown: true });
  });

  it('replays from the next sample, and starts over when the step goes back', () => {
    const map = createPlayerMap();
    const recording = {
      mapId: 'player',
      frames: [{ step: 5, actions: { jump: { isDown: true, pressedCount: 1 } } }],
    };
    const playback = playActionRecording(map, recording, { from: 'NEXT_SAMPLE' });
    sampleActions(100);
    expect(map.read('jump').pressedCount).toBe(1);
    expect(playback.isPlaying()).toBe(true);
    sampleActions(101);
    expect(playback.isPlaying()).toBe(false);

    const again = playActionRecording(map, recording);
    sampleActions(5);
    expect(map.read('jump').pressedCount).toBe(1);
    sampleActions(0); // a new world
    sampleActions(5);
    expect(map.read('jump').pressedCount).toBe(1);
    again.stop();
    expect(again.isPlaying()).toBe(false);
  });

  it('numbers its samples itself without physics stepping', () => {
    const map = createPlayerMap();
    const recorder = recordActions(map);
    sampleActions(-1);
    sampleActions(-1);
    const { firstStep, lastStep } = recorder.stop();
    expect(lastStep! - firstStep!).toBe(1);
  });

  it('ends a recording and a replay with their map', () => {
    const map = createPlayerMap();
    const recorder = recordActions(map);
    const playback = playActionRecording(
      map,
      { mapId: 'player', frames: [] },
      { from: 'NEXT_SAMPLE' }
    );
    map.delete();
    expect(playback.isPlaying()).toBe(false);
    expect(recorder.stop().frames).toEqual([]);
    expect(() => recordActions(map)).toThrow(/deleted/);
  });
});
