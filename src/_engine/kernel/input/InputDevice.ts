import { getGamepadFamily, type GamepadFamily } from './GamepadFamily';
import { addInputListenerRemover, getInputScope, getInputScopeRoot } from './InputState';

// The device the player used last (p808 D5): what a prompt shows ("Press [E]" or "Press (A)").
// Its own listeners, apart from the bindings' and the action layer's, added on the first read or
// callback by the input scope, in the capture phase (a kit control that stops a key's propagation
// still switches the device) and passive (it never prevents anything). A key, a click, a touch or
// the wheel switch to their device; a mouse move only from touch (a bumped mouse doesn't take the
// prompts from a gamepad player). The pads are read by a requestAnimationFrame poll of its own
// that runs only while a pad is connected and the tracker listens: a button pressed or a stick
// pushed past half switches to the gamepad, with its family.

/** The kinds of device the player can be using. */
export type InputDeviceKind = 'KEYBOARD_MOUSE' | 'GAMEPAD' | 'TOUCH';

/** The device the player used last ({@link getLastInputDevice}). */
export type LastInputDevice = {
  /** The kind of device. */
  readonly device: InputDeviceKind;
  /** A gamepad's family (its face buttons' labels); only for `GAMEPAD`. */
  readonly family?: GamepadFamily;
};

/** How far a stick is pushed before it counts as the gamepad's use (a resting stick drifts) */
const STICK_USE = 0.5;
const STICK_AXES = 4;

let last: LastInputDevice | null = null;
const changeFns: ((device: LastInputDevice) => void)[] = [];
let removeListeners: (() => void) | null = null;
let pollId = 0;
/** Each pad's `timestamp` at the last poll, by `Gamepad.index` */
const padTimestamps: number[] = [];

/** Touch when the page has no fine pointer (a phone, a tablet), else the keyboard and mouse */
const getInitialDevice = (): LastInputDevice => {
  const media = typeof window.matchMedia === 'function' ? window.matchMedia : null;
  const isTouchOnly =
    !!media && !media('(any-pointer: fine)').matches && media('(any-pointer: coarse)').matches;
  return { device: isTouchOnly ? 'TOUCH' : 'KEYBOARD_MOUSE' };
};

const setLast = (device: InputDeviceKind, family?: GamepadFamily) => {
  if (last && last.device === device && last.family === family) return;
  last = device === 'GAMEPAD' ? { device, family } : { device };
  const changed = last;
  for (const fn of changeFns.slice()) fn(changed);
};

const onKeyDown = () => setLast('KEYBOARD_MOUSE');
const onWheel = () => setLast('KEYBOARD_MOUSE');
const onPointerDown = (e: PointerEvent) =>
  setLast(e.pointerType === 'touch' ? 'TOUCH' : 'KEYBOARD_MOUSE');
const onPointerMove = (e: PointerEvent) => {
  if (e.pointerType === 'mouse' && last?.device === 'TOUCH') setLast('KEYBOARD_MOUSE');
};

/** Whether the pads count: in the `CANVAS` scope only while the focus is in the engine's root */
const arePadsInScope = () => {
  if (getInputScope() !== 'CANVAS') return true;
  const root = getInputScopeRoot();
  const focused = document.activeElement;
  return !!root && !!focused && root.contains(focused);
};

const isPadInUse = (gp: Gamepad) => {
  const buttons = gp.buttons;
  for (let b = 0; b < buttons.length; b++) {
    if (buttons[b]?.pressed) return true;
  }
  const axes = gp.axes;
  const count = Math.min(STICK_AXES, axes.length);
  for (let a = 0; a < count; a++) {
    if (Math.abs(axes[a]) > STICK_USE) return true;
  }
  return false;
};

/** Reads the pads once; polls again next frame while one is connected */
const pollPads = () => {
  pollId = 0;
  if (!removeListeners) return;
  const list = navigator.getGamepads?.();
  if (!list) return;
  let isAnyConnected = false;
  const inScope = arePadsInScope();
  for (let i = 0; i < list.length; i++) {
    const gp = list[i];
    if (!gp || !gp.connected) continue;
    isAnyConnected = true;
    if (!inScope || padTimestamps[gp.index] === gp.timestamp) continue;
    padTimestamps[gp.index] = gp.timestamp;
    if (isPadInUse(gp)) setLast('GAMEPAD', getGamepadFamily(gp.id));
  }
  if (isAnyConnected) pollId = requestAnimationFrame(pollPads);
};

const startPadPoll = () => {
  if (!pollId && removeListeners) pollId = requestAnimationFrame(pollPads);
};

/** Adds the listeners by the input scope, once (again after a removal) */
const ensureListening = () => {
  if (removeListeners) return;
  const scope = getInputScope();
  const target: Window | HTMLElement | null =
    scope === 'WINDOW' ? window : scope === 'CANVAS' ? getInputScopeRoot() : null;
  if (!target) return;
  const options: AddEventListenerOptions = { capture: true, passive: true };
  target.addEventListener('keydown', onKeyDown, options);
  target.addEventListener('wheel', onWheel, options);
  target.addEventListener('pointerdown', onPointerDown as EventListener, options);
  target.addEventListener('pointermove', onPointerMove as EventListener, options);
  // The connection events are the window's in every scope (a pad belongs to no element)
  window.addEventListener('gamepadconnected', startPadPoll);
  removeListeners = () => {
    target.removeEventListener('keydown', onKeyDown, options);
    target.removeEventListener('wheel', onWheel, options);
    target.removeEventListener('pointerdown', onPointerDown as EventListener, options);
    target.removeEventListener('pointermove', onPointerMove as EventListener, options);
    window.removeEventListener('gamepadconnected', startPadPoll);
    if (pollId) cancelAnimationFrame(pollId);
    pollId = 0;
    padTimestamps.length = 0;
  };
  addInputListenerRemover(stopTracking);
  // A pad connected before the tracker started (Chrome reports one only after a press)
  startPadPoll();
};

/** Removes the tracker's listeners (the mount's unmount, through InputState.ts). The callbacks
 * stay; the next read or callback adds the listeners again, by the scope then. */
const stopTracking = () => {
  removeListeners?.();
  removeListeners = null;
};

/**
 * The device the player used last: the keyboard and mouse, a gamepad (with its family) or touch.
 * Before any input, touch on a page without a fine pointer, else the keyboard and mouse. The
 * first call starts the tracking (its listeners, by the input scope: the window, a mounted
 * engine's container, or none, where it stays at its first value).
 * @returns the device, one object per change (compare it with the last one you read)
 * @example
 * ```ts
 * import { getLastInputDevice } from 'aekasha';
 *
 * const hint = getLastInputDevice().device === 'GAMEPAD' ? 'Press A' : 'Press E';
 * ```
 */
export const getLastInputDevice = (): LastInputDevice => {
  ensureListening();
  last ??= getInitialDevice();
  return last;
};

/**
 * Calls `fn` when the player switches device (a key or a click after a gamepad, a gamepad's
 * button after the keyboard, another gamepad family). Starts the tracking, as
 * {@link getLastInputDevice} does.
 * @param fn gets the new device
 * @returns removes the callback
 * @example
 * ```ts
 * import { onLastInputDeviceChange } from 'aekasha';
 * import { setPromptDevice } from 'aekasha/ui';
 *
 * // Every input prompt follows the player's device
 * onLastInputDeviceChange(setPromptDevice);
 * ```
 */
export const onLastInputDeviceChange = (fn: (device: LastInputDevice) => void): (() => void) => {
  getLastInputDevice();
  changeFns.push(fn);
  return () => {
    const i = changeFns.indexOf(fn);
    if (i >= 0) changeFns.splice(i, 1);
  };
};
