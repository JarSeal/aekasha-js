import { lwarn } from '../../utils/Logger';

// The Gamepad API has no button events: `navigator.getGamepads()` is polled once per frame (the
// action layer's frame hook, Actions.ts, while a map has a gamepad binding) and each pad's buttons
// and axes are kept here, so a reader diffs nothing itself. `gamepadconnected` /
// `gamepaddisconnected` are real events and drive the connection callbacks without any polling.
// Chrome reports a pad (to getGamepads() and the connect event) only after a button on it was
// pressed once (a privacy rule): a "press a button to start" prompt is the usual answer.

/** The standard mapping's buttons, in its index order (W3C Gamepad, "Standard Gamepad"). */
export const GAMEPAD_BUTTON_NAMES = [
  'SOUTH',
  'EAST',
  'WEST',
  'NORTH',
  'LEFT_SHOULDER',
  'RIGHT_SHOULDER',
  'LEFT_TRIGGER',
  'RIGHT_TRIGGER',
  'SELECT',
  'START',
  'LEFT_STICK',
  'RIGHT_STICK',
  'DPAD_UP',
  'DPAD_DOWN',
  'DPAD_LEFT',
  'DPAD_RIGHT',
  'HOME',
] as const;

/**
 * A standard mapping button by its position, not its label: `SOUTH` is A on an Xbox pad and Cross
 * on a PlayStation pad. `SELECT` is View / Share / Back, `HOME` the Xbox / PS button, and
 * `LEFT_STICK` / `RIGHT_STICK` press the sticks. The triggers are analog: a button reads 0-1.
 */
export type GamepadButtonName = (typeof GAMEPAD_BUTTON_NAMES)[number];

/** A stick's axis, up and right positive (the API's own Y axes point down). */
export type GamepadAxisName = 'LEFT_X' | 'LEFT_Y' | 'RIGHT_X' | 'RIGHT_Y';

/** A stick, or the d-pad read as one (its four buttons as -1, 0 or 1 on each axis). */
export type GamepadStickName = 'LEFT' | 'RIGHT' | 'DPAD';

/** A connected gamepad. */
export type GamepadInfo = {
  /** `Gamepad.index`: the pad's slot, kept while it stays connected. */
  index: number;
  /** `Gamepad.id`: the browser's name for the device. */
  id: string;
  /** Whether the browser maps it to the standard layout. Without it, the button and axis names
   * read the same indices, which may not be where the names say. */
  isStandardMapping: boolean;
};

const BUTTON_COUNT = GAMEPAD_BUTTON_NAMES.length;
const AXIS_COUNT = 4;
const BUTTON_INDEX = Object.fromEntries(GAMEPAD_BUTTON_NAMES.map((name, i) => [name, i])) as {
  [name in GamepadButtonName]: number;
};
const AXIS_INDEX: { [name in GamepadAxisName]: number } = {
  LEFT_X: 0,
  LEFT_Y: 1,
  RIGHT_X: 2,
  RIGHT_Y: 3,
};

type PadState = {
  info: GamepadInfo;
  /** Each button's value (0-1). */
  values: Float64Array;
  /** Each button's `pressed` flag (the browser's threshold on the analog ones). */
  pressed: Uint8Array;
  /** The four stick axes, Y flipped to up positive. */
  axes: Float64Array;
  /** `Gamepad.timestamp` at the last poll: unchanged means nothing on the pad changed. */
  timestamp: number;
};

/** Indexed by `Gamepad.index`; null for an empty slot. */
const pads: (PadState | null)[] = [];
const connectedFns: ((info: GamepadInfo) => void)[] = [];
const disconnectedFns: ((info: GamepadInfo) => void)[] = [];
let connectionListenersAdded = false;
let hasWarnedNonStandard = false;

const toInfo = (gp: Gamepad): GamepadInfo => ({
  index: gp.index,
  id: gp.id,
  isStandardMapping: gp.mapping === 'standard',
});

const onConnected = (e: GamepadEvent) => {
  const info = toInfo(e.gamepad);
  for (const fn of connectedFns.slice()) fn(info);
};

const onDisconnected = (e: GamepadEvent) => {
  const info = toInfo(e.gamepad);
  pads[info.index] = null;
  for (const fn of disconnectedFns.slice()) fn(info);
};

const addConnectionListeners = () => {
  if (connectionListenersAdded) return;
  connectionListenersAdded = true;
  window.addEventListener('gamepadconnected', onConnected);
  window.addEventListener('gamepaddisconnected', onDisconnected);
};

const addListener = <T>(list: T[], fn: T) => {
  addConnectionListeners();
  list.push(fn);
  return () => {
    const i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  };
};

/**
 * Calls `fn` when a gamepad connects (the first button press on it, in Chrome).
 * @returns removes the callback
 */
export const onGamepadConnected = (fn: (info: GamepadInfo) => void): (() => void) =>
  addListener(connectedFns, fn);

/**
 * Calls `fn` when a gamepad disconnects.
 * @returns removes the callback
 */
export const onGamepadDisconnected = (fn: (info: GamepadInfo) => void): (() => void) =>
  addListener(disconnectedFns, fn);

/** The gamepads the browser reports as connected now (none before a button press, in Chrome). */
export const getConnectedGamepads = (): GamepadInfo[] => {
  const list = typeof navigator !== 'undefined' ? navigator.getGamepads?.() : undefined;
  const infos: GamepadInfo[] = [];
  if (!list) return infos;
  for (let i = 0; i < list.length; i++) {
    const gp = list[i];
    if (gp?.connected) infos.push(toInfo(gp));
  }
  return infos;
};

const createPadState = (gp: Gamepad): PadState => {
  if (gp.mapping !== 'standard' && !hasWarnedNonStandard) {
    hasWarnedNonStandard = true;
    lwarn(
      `Gamepad "${gp.id}" has no standard mapping: its buttons and sticks are read by the ` +
        `standard layout's indices, which may not match their names.`
    );
  }
  return {
    info: toInfo(gp),
    values: new Float64Array(BUTTON_COUNT),
    pressed: new Uint8Array(BUTTON_COUNT),
    axes: new Float64Array(AXIS_COUNT),
    timestamp: -1,
  };
};

/** Copies a pad's buttons and axes into its state. Whether anything changed. */
const readPad = (state: PadState, gp: Gamepad) => {
  let changed = false;
  const buttons = gp.buttons;
  for (let b = 0; b < BUTTON_COUNT; b++) {
    const button = buttons[b];
    const value = button ? button.value : 0;
    const pressed = button?.pressed ? 1 : 0;
    if (state.values[b] !== value || state.pressed[b] !== pressed) {
      state.values[b] = value;
      state.pressed[b] = pressed;
      changed = true;
    }
  }
  const axes = gp.axes;
  for (let a = 0; a < AXIS_COUNT; a++) {
    // Y axes point down in the API: flip them, so up is positive like the action layer's
    const raw = axes[a] ?? 0;
    const value = a === 1 || a === 3 ? -raw : raw;
    if (state.axes[a] !== value) {
      state.axes[a] = value;
      changed = true;
    }
  }
  return changed;
};

/**
 * Reads every connected pad once (the action layer's frame hook calls it, once per frame). A pad
 * whose `timestamp` didn't move is skipped.
 * @internal
 * @returns whether any button or axis changed, a pad connected or one went away
 */
export const pollGamepads = (): boolean => {
  const list = typeof navigator !== 'undefined' ? navigator.getGamepads?.() : undefined;
  let changed = false;
  const count = list ? list.length : 0;
  for (let i = 0; i < count; i++) {
    const gp = list![i];
    let state = pads[i] ?? null;
    if (!gp || !gp.connected) {
      if (state) {
        pads[i] = null;
        changed = true;
      }
      continue;
    }
    if (!state || state.info.id !== gp.id) {
      state = createPadState(gp);
      pads[i] = state;
      changed = true;
    }
    if (state.timestamp === gp.timestamp) continue;
    state.timestamp = gp.timestamp;
    if (readPad(state, gp)) changed = true;
  }
  for (let i = count; i < pads.length; i++) {
    if (pads[i]) {
      pads[i] = null;
      changed = true;
    }
  }
  return changed;
};

/**
 * A button's value (0-1; 0 or 1 for a digital one) on the pad at `padIndex`, or the highest value
 * on any pad when it's undefined. The last poll's state.
 * @internal
 */
export const readGamepadButton = (padIndex: number | undefined, name: GamepadButtonName) => {
  const b = BUTTON_INDEX[name];
  if (padIndex !== undefined) return pads[padIndex]?.values[b] ?? 0;
  let max = 0;
  for (let i = 0; i < pads.length; i++) {
    const value = pads[i]?.values[b] ?? 0;
    if (value > max) max = value;
  }
  return max;
};

/**
 * Whether a button is pressed (the browser's threshold on an analog one) on the pad at
 * `padIndex`, or on any pad when it's undefined. The last poll's state.
 * @internal
 */
export const isGamepadButtonPressed = (padIndex: number | undefined, name: GamepadButtonName) => {
  const b = BUTTON_INDEX[name];
  if (padIndex !== undefined) return pads[padIndex]?.pressed[b] === 1;
  for (let i = 0; i < pads.length; i++) {
    if (pads[i]?.pressed[b] === 1) return true;
  }
  return false;
};

/**
 * An axis' raw value (-1 to 1, up and right positive, no deadzone) on the pad at `padIndex`, or
 * the one furthest from 0 on any pad when it's undefined. The last poll's state.
 * @internal
 */
export const readGamepadAxis = (padIndex: number | undefined, name: GamepadAxisName) => {
  const a = AXIS_INDEX[name];
  if (padIndex !== undefined) return pads[padIndex]?.axes[a] ?? 0;
  let best = 0;
  for (let i = 0; i < pads.length; i++) {
    const value = pads[i]?.axes[a] ?? 0;
    if (Math.abs(value) > Math.abs(best)) best = value;
  }
  return best;
};

const readPadStickInto = (
  pad: PadState,
  stick: GamepadStickName,
  out: { x: number; y: number }
) => {
  if (stick === 'DPAD') {
    const v = pad.pressed;
    out.x = v[BUTTON_INDEX.DPAD_RIGHT] - v[BUTTON_INDEX.DPAD_LEFT];
    out.y = v[BUTTON_INDEX.DPAD_UP] - v[BUTTON_INDEX.DPAD_DOWN];
    return;
  }
  const offset = stick === 'LEFT' ? 0 : 2;
  out.x = pad.axes[offset];
  out.y = pad.axes[offset + 1];
};

/**
 * A stick's raw position (up and right positive, no deadzone) into `out`, on the pad at
 * `padIndex`, or the one pushed furthest on any pad when it's undefined. The last poll's state.
 * @internal
 */
export const readGamepadStickInto = (
  padIndex: number | undefined,
  stick: GamepadStickName,
  out: { x: number; y: number }
) => {
  out.x = 0;
  out.y = 0;
  if (padIndex !== undefined) {
    const pad = pads[padIndex];
    if (pad) readPadStickInto(pad, stick, out);
    return;
  }
  let bestX = 0;
  let bestY = 0;
  let bestLengthSq = 0;
  for (let i = 0; i < pads.length; i++) {
    const pad = pads[i];
    if (!pad) continue;
    readPadStickInto(pad, stick, out);
    const lengthSq = out.x * out.x + out.y * out.y;
    if (lengthSq > bestLengthSq) {
      bestLengthSq = lengthSq;
      bestX = out.x;
      bestY = out.y;
    }
  }
  out.x = bestX;
  out.y = bestY;
};
