// The action layer's bindings (p610 D4): an action's bindings compiled once (keys as chords, the
// deadzones clamped, each checked against its action's type), and the devices read through them.
// Actions.ts owns the maps, the sampling and the events.

import { lwarn } from '../../utils/Logger';
import type { ActionBinding, ActionType } from './ActionTypes';
import {
  isGamepadButtonPressed,
  readGamepadAxis,
  readGamepadButton,
  readGamepadStickInto,
  type GamepadAxisName,
  type GamepadButtonName,
  type GamepadStickName,
} from './GamepadInput';
import {
  compileKeyChord,
  doesKeyEventMatchChord,
  isKeyChordHeld,
  type CompiledKeyChord,
  type KeyChord,
} from './KeyboardInput';
import { isMouseButtonHeld, type MouseButton } from './MouseInput';

const DEFAULT_DEADZONE = 0.15;

/**
 * A binding with its keys as chords, checked against its action's type.
 * @internal
 */
export type CompiledBinding =
  | { kind: 'KEYS'; chords: CompiledKeyChord[]; ignoreModifiers: boolean }
  | { kind: 'KEY_AXIS'; neg: CompiledKeyChord[]; pos: CompiledKeyChord[]; ignoreModifiers: boolean }
  | {
      kind: 'KEY_COMPOSITE';
      up: CompiledKeyChord[];
      down: CompiledKeyChord[];
      left: CompiledKeyChord[];
      right: CompiledKeyChord[];
      ignoreModifiers: boolean;
    }
  | { kind: 'MOUSE_BUTTON'; button: MouseButton }
  | { kind: 'MOUSE_DELTA'; delta: 'MOVE' | 'WHEEL'; scale: number }
  | { kind: 'TOUCH_TAP' }
  | { kind: 'TOUCH_DRAG'; scale: number }
  | { kind: 'PAD_BUTTON'; button: GamepadButtonName }
  | { kind: 'PAD_AXIS'; axis: GamepadAxisName; deadzone: number; invert: boolean }
  | { kind: 'PAD_STICK'; stick: GamepadStickName; deadzone: number };

const KINDS_OF_TYPE: { [type in ActionType]: CompiledBinding['kind'][] } = {
  BUTTON: ['KEYS', 'MOUSE_BUTTON', 'TOUCH_TAP', 'PAD_BUTTON'],
  AXIS_1D: ['KEY_AXIS', 'PAD_AXIS'],
  AXIS_2D: ['KEY_COMPOSITE', 'PAD_STICK'],
  DELTA_2D: ['MOUSE_DELTA', 'TOUCH_DRAG'],
};

/**
 * A button or axis action's value as its devices give it now (see `ActionState`).
 * @internal
 */
export type LiveActionValue = { value: number; x: number; y: number };

const _stick = { x: 0, y: 0 };

/** Keys as chords, each lowercased once (the reads run on every key event) */
const toChords = (keys: readonly (string | KeyChord)[]): CompiledKeyChord[] =>
  keys.map((k) => compileKeyChord(typeof k === 'string' ? { key: k } : k));

// Whether the read in progress is the app's (a map outside the `DEBUG` context): a key held on a
// debugger control isn't held for it (KeyboardInput.ts' isKeyEventOnDebugger, p806 D12)
let isAppRead = false;

const isAnyHeld = (chords: CompiledKeyChord[], ignoreModifiers: boolean) => {
  for (let i = 0; i < chords.length; i++) {
    if (isKeyChordHeld(chords[i], true, ignoreModifiers, isAppRead)) return true;
  }
  return false;
};

const heldAxis = (neg: CompiledKeyChord[], pos: CompiledKeyChord[], ignoreModifiers: boolean) =>
  (isAnyHeld(pos, ignoreModifiers) ? 1 : 0) - (isAnyHeld(neg, ignoreModifiers) ? 1 : 0);

const applyDeadzone1D = (value: number, deadzone: number) => {
  const abs = Math.abs(value);
  if (abs <= deadzone) return 0;
  return Math.sign(value) * Math.min(1, (abs - deadzone) / (1 - deadzone));
};

/** Rescales _stick past a radial deadzone, at most length 1. Its length. */
const applyRadialDeadzone = (deadzone: number) => {
  const length = Math.hypot(_stick.x, _stick.y);
  if (length <= deadzone || length === 0) {
    _stick.x = 0;
    _stick.y = 0;
    return 0;
  }
  const scaled = Math.min(1, (length - deadzone) / (1 - deadzone));
  _stick.x *= scaled / length;
  _stick.y *= scaled / length;
  return scaled;
};

const clampDeadzone = (deadzone: number | undefined) =>
  Math.min(0.99, Math.max(0, deadzone ?? DEFAULT_DEADZONE));

/**
 * Reads a button or axis action's devices through its bindings into `out`: a button is down
 * while any binding is, an axis takes the binding pushed furthest.
 * @internal
 * @param isApp the app's map (outside the `DEBUG` context): a key held on a debugger control isn't
 * down for it
 * @returns whether the action is down (an axis: not 0)
 */
export const readActionDevices = (
  compiled: CompiledBinding[],
  type: ActionType,
  gamepadIndex: number | undefined,
  out: LiveActionValue,
  isApp: boolean
): boolean => {
  isAppRead = isApp;
  let isDown = false;
  let value = 0;
  let x = 0;
  let y = 0;
  for (let i = 0; i < compiled.length; i++) {
    const c = compiled[i];
    switch (c.kind) {
      case 'KEYS':
        if (isAnyHeld(c.chords, c.ignoreModifiers)) {
          isDown = true;
          value = 1;
        }
        break;
      case 'MOUSE_BUTTON':
        if (isMouseButtonHeld(c.button)) {
          isDown = true;
          value = 1;
        }
        break;
      case 'PAD_BUTTON':
        if (isGamepadButtonPressed(gamepadIndex, c.button)) isDown = true;
        value = Math.max(value, readGamepadButton(gamepadIndex, c.button));
        break;
      case 'KEY_AXIS':
      case 'PAD_AXIS': {
        const v =
          c.kind === 'KEY_AXIS'
            ? heldAxis(c.neg, c.pos, c.ignoreModifiers)
            : applyDeadzone1D(
                readGamepadAxis(gamepadIndex, c.axis) * (c.invert ? -1 : 1),
                c.deadzone
              );
        if (Math.abs(v) > Math.abs(value)) value = v;
        break;
      }
      case 'KEY_COMPOSITE':
      case 'PAD_STICK': {
        let length: number;
        if (c.kind === 'KEY_COMPOSITE') {
          _stick.x = heldAxis(c.left, c.right, c.ignoreModifiers);
          _stick.y = heldAxis(c.down, c.up, c.ignoreModifiers);
          length = applyRadialDeadzone(0);
        } else {
          readGamepadStickInto(gamepadIndex, c.stick, _stick);
          length = applyRadialDeadzone(c.stick === 'DPAD' ? 0 : c.deadzone);
        }
        if (length > value) {
          value = length;
          x = _stick.x;
          y = _stick.y;
        }
        break;
      }
      default:
        break;
    }
  }
  out.value = value;
  out.x = x;
  out.y = y;
  return type === 'BUTTON' ? isDown : value !== 0;
};

const matchesAny = (e: KeyboardEvent, chords: CompiledKeyChord[], ignoreModifiers: boolean) => {
  for (let i = 0; i < chords.length; i++) {
    if (doesKeyEventMatchChord(e, chords[i], true, ignoreModifiers)) return true;
  }
  return false;
};

/**
 * Whether one of the keyboard bindings has the event's key (and modifiers, unless it ignores
 * them).
 * @internal
 * @param isForPreventDefault a binding that ignores modifiers then doesn't match a key pressed
 * with Ctrl, Alt or Meta: a browser shortcut (copy, paste, back) keeps working
 */
export const isKeyEventInBindings = (
  compiled: CompiledBinding[],
  e: KeyboardEvent,
  isForPreventDefault = false
): boolean => {
  const isShortcut = isForPreventDefault && (e.ctrlKey || e.altKey || e.metaKey);
  for (let i = 0; i < compiled.length; i++) {
    const c = compiled[i];
    if ((c.kind === 'KEYS' || c.kind === 'KEY_AXIS' || c.kind === 'KEY_COMPOSITE') && isShortcut) {
      if (c.ignoreModifiers) continue;
    }
    if (c.kind === 'KEYS') {
      if (matchesAny(e, c.chords, c.ignoreModifiers)) return true;
    } else if (c.kind === 'KEY_AXIS') {
      const ignore = c.ignoreModifiers;
      if (matchesAny(e, c.neg, ignore) || matchesAny(e, c.pos, ignore)) return true;
    } else if (c.kind === 'KEY_COMPOSITE') {
      const ignore = c.ignoreModifiers;
      if (
        matchesAny(e, c.up, ignore) ||
        matchesAny(e, c.down, ignore) ||
        matchesAny(e, c.left, ignore) ||
        matchesAny(e, c.right, ignore)
      ) {
        return true;
      }
    }
  }
  return false;
};

const compileBinding = (
  binding: ActionBinding,
  mapIgnoreModifiers: boolean
): CompiledBinding | null => {
  switch (binding.device) {
    case 'KEYBOARD': {
      const ignoreModifiers = binding.ignoreModifiers ?? mapIgnoreModifiers;
      if ('keys' in binding) {
        return { kind: 'KEYS', chords: toChords(binding.keys), ignoreModifiers };
      }
      if ('positive' in binding) {
        return {
          kind: 'KEY_AXIS',
          neg: toChords(binding.negative),
          pos: toChords(binding.positive),
          ignoreModifiers,
        };
      }
      if ('up' in binding) {
        return {
          kind: 'KEY_COMPOSITE',
          up: toChords(binding.up),
          down: toChords(binding.down),
          left: toChords(binding.left),
          right: toChords(binding.right),
          ignoreModifiers,
        };
      }
      return null;
    }
    case 'MOUSE':
      if ('button' in binding) return { kind: 'MOUSE_BUTTON', button: binding.button };
      if ('delta' in binding) {
        return { kind: 'MOUSE_DELTA', delta: binding.delta, scale: binding.scale ?? 1 };
      }
      return null;
    case 'TOUCH':
      if (binding.gesture === 'TAP') return { kind: 'TOUCH_TAP' };
      if (binding.gesture === 'DRAG') return { kind: 'TOUCH_DRAG', scale: binding.scale ?? 1 };
      return null;
    case 'GAMEPAD':
      if ('button' in binding) return { kind: 'PAD_BUTTON', button: binding.button };
      if ('axis' in binding) {
        return {
          kind: 'PAD_AXIS',
          axis: binding.axis,
          deadzone: clampDeadzone(binding.deadzone),
          invert: !!binding.invert,
        };
      }
      if ('stick' in binding) {
        return {
          kind: 'PAD_STICK',
          stick: binding.stick,
          deadzone: clampDeadzone(binding.deadzone),
        };
      }
      return null;
    default:
      return null;
  }
};

/**
 * An action's bindings compiled. A binding that doesn't fit the action's type (plain data from a
 * config can be anything) is left out with a warning.
 * @internal
 */
export const compileActionBindings = (
  mapId: string,
  actionId: string,
  type: ActionType,
  bindings: readonly ActionBinding[],
  mapIgnoreModifiers: boolean
): CompiledBinding[] => {
  const allowed = KINDS_OF_TYPE[type];
  const compiled: CompiledBinding[] = [];
  for (const binding of bindings) {
    const c = compileBinding(binding, mapIgnoreModifiers);
    if (c && allowed.includes(c.kind)) {
      compiled.push(c);
      continue;
    }
    lwarn(
      `Action map "${mapId}": a ${binding.device} binding of the ${type} action ` +
        `"${actionId}" doesn't fit its type and is left out (${JSON.stringify(binding)}).`
    );
  }
  return compiled;
};
