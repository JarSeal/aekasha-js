import { isDebugCameraActive } from '../camera/Camera';
import { isDebugEnvironment } from '../config/Config';
import { addOnWindowBlurFn, addVisibilityChangeFn } from '../loop/MainLoop';
import { onRendererCreated } from '../render/Renderer';
import { getCurrentSceneId } from '../scene/Scene';
import { lwarn } from '../../utils/Logger';
import {
  areAllInputsEnabled,
  areAppInputsEnabled,
  areAppInputsSuspended,
  getInputScope,
} from './InputState';
import type { BindingMeta, EnabledInDebugCam, Modifiers } from './InputSharedTypes';

export type KeyChord = Modifiers & {
  /** KeyboardEvent.key value, e.g. 'h', 'F1', 'z', 'Escape'. */
  key: string;
};

export type KeyBindingType = 'KEY_UP' | 'KEY_DOWN' | 'KEY_HELD';

/**
 * The fields every key binding type shares (see {@link KeyUpDownBinding} and {@link
 * KeyHeldBinding}).
 */
export type KeyBindingBase = BindingMeta & {
  id: string;
  /** Array = "any of these chords triggers this binding". */
  chord: KeyChord | KeyChord[];
  caseInsensitive?: boolean; // default true
  /** Match on the key alone, whatever modifiers are (or aren't) held — the chord's own modifier
   * fields are ignored too. For continuous controls like movement that must keep working while
   * an unrelated modifier is pressed (e.g. a Shift run toggle). Default false (exact match). */
  ignoreModifiers?: boolean;
  enabled?: boolean; // default true
  sceneId?: string;
  enabledInDebugCam?: EnabledInDebugCam;
  /** Runs in editor views too (ViewManager.ts), which suspend the other bindings. (The engine's
   * debug keys and the CONFIG.ts `debugKeys` are action maps in the `DEBUG` context instead.) */
  isDebugKey?: boolean;
};

export type KeyUpDownBinding = KeyBindingBase & {
  type: 'KEY_UP' | 'KEY_DOWN';
  fn: (e: KeyboardEvent, time: number) => void;
  /** Default false. When true, the binding doesn't fire for an event that another (not
   * yielding) binding also fires for, whenever that one was registered (eg. the engine's
   * production test mode keys give way to the app's own bindings of the same keys). */
  yieldToOtherBindings?: boolean;
};

/** KEY_HELD bindings are polled once per tick (see pollHeldKeyBindings), not event-driven,
 * so their fn receives the poll's delta instead of a KeyboardEvent. */
export type KeyHeldBinding = KeyBindingBase & {
  type: 'KEY_HELD';
  fn: (delta: number) => void;
};

export type KeyBinding = KeyUpDownBinding | KeyHeldBinding;

type ReservedChord = {
  id: string;
  chord: KeyChord | KeyChord[];
  chordLabel: string;
  /** The action map that binds it (its own bindings don't collide with it). */
  mapId: string | undefined;
};

let bindings: KeyBinding[] = [];
let reservedChords: ReservedChord[] = [];

const heldRawKeys = new Set<string>();
let heldModifiers: Modifiers = {};

let keyInputsEnabled = true;
export const setKeyInputsEnabled = (enabled: boolean): void => {
  keyInputsEnabled = enabled;
};

let keydownListener: ((e: KeyboardEvent) => void) | null = null;
let keyupListener: ((e: KeyboardEvent) => void) | null = null;
/** Removes the key listeners (null: none added) */
let removeListeners: (() => void) | null = null;
/** The action layer's source (Actions.ts): every key event after the held keys are updated, and
 * null when they are cleared. */
let keyActionListener: ((e: KeyboardEvent | null) => void) | null = null;

const getChordArray = (chord: KeyChord | KeyChord[]): KeyChord[] =>
  Array.isArray(chord) ? chord : [chord];

/** A chord as readable text, eg. 'Ctrl+Shift+Z' (alternative chords joined with ' / '). */
export const getKeyChordLabel = (chord: KeyChord | KeyChord[]): string =>
  getChordArray(chord)
    .map((c) => {
      const key = c.key === ' ' ? 'Space' : c.key.length === 1 ? c.key.toUpperCase() : c.key;
      return [c.ctrl && 'Ctrl', c.shift && 'Shift', c.alt && 'Alt', c.meta && 'Meta', key]
        .filter(Boolean)
        .join('+');
    })
    .join(' / ');

const isInputInDebugCamInvalid = (enabledInDebugCam?: EnabledInDebugCam) =>
  isDebugEnvironment() &&
  ((enabledInDebugCam === 'NOT_ENABLED_IN_DEBUG' && isDebugCameraActive()) ||
    (enabledInDebugCam === 'ENABLED_ONLY_IN_DEBUG' && !isDebugCameraActive()));

const isBindingDisabled = (binding: KeyBinding) =>
  binding.enabled === false || isInputInDebugCamInvalid(binding.enabledInDebugCam);

const isSceneMatch = (sceneId?: string) => !sceneId || sceneId === getCurrentSceneId();

/** The modifier flag a modifier key sets on its own events ('Shift' -> shift, ...), if any. */
const MODIFIER_OF_KEY: { [key: string]: keyof Modifiers } = {
  shift: 'shift',
  control: 'ctrl',
  alt: 'alt',
  meta: 'meta',
};

/** Exact modifier match, except that a chord whose key is itself a modifier (e.g.
 * `{ key: 'Shift' }`) doesn't require its own flag to be off: pressing Shift always reports
 * shiftKey, so such a chord could never match otherwise. */
const modifiersMatch = (chord: KeyChord, held: Modifiers): boolean => {
  const own = MODIFIER_OF_KEY[chord.key.toLowerCase()];
  return (
    (own === 'ctrl' || !!chord.ctrl === !!held.ctrl) &&
    (own === 'shift' || !!chord.shift === !!held.shift) &&
    (own === 'alt' || !!chord.alt === !!held.alt) &&
    (own === 'meta' || !!chord.meta === !!held.meta)
  );
};

/** Chord match against a live DOM event: key (case rule per binding) plus an exact modifier
 * match (a plain `{ key: 'h' }` requires no modifiers held) unless ignoreModifiers is set. */
const eventMatchesChord = (
  e: KeyboardEvent,
  chord: KeyChord,
  caseInsensitive: boolean,
  ignoreModifiers?: boolean
): boolean => {
  const keyMatches = caseInsensitive
    ? e.key.toLowerCase() === chord.key.toLowerCase()
    : e.key === chord.key;
  return (
    keyMatches &&
    (ignoreModifiers ||
      modifiersMatch(chord, {
        ctrl: e.ctrlKey,
        shift: e.shiftKey,
        alt: e.altKey,
        meta: e.metaKey,
      }))
  );
};

/** Same exact-match rule as eventMatchesChord, but against the live held-key/modifier
 * snapshot instead of a single DOM event (used by isChordHeld / pollHeldKeyBindings). */
const chordIsHeld = (
  chord: KeyChord,
  caseInsensitive: boolean,
  ignoreModifiers?: boolean
): boolean => {
  const chordKeyLower = chord.key.toLowerCase();
  let keyHeld = false;
  for (const k of heldRawKeys) {
    if (caseInsensitive ? k.toLowerCase() === chordKeyLower : k === chord.key) {
      keyHeld = true;
      break;
    }
  }
  return keyHeld && (!!ignoreModifiers || modifiersMatch(chord, heldModifiers));
};

/** Whether two chords (or chord lists) share a chord: same key (any case), same modifiers. */
export const doKeyChordsCollide = (a: KeyChord | KeyChord[], b: KeyChord | KeyChord[]): boolean => {
  const arrA = getChordArray(a);
  const arrB = getChordArray(b);
  for (let i = 0; i < arrA.length; i++) {
    for (let j = 0; j < arrB.length; j++) {
      const ca = arrA[i];
      const cb = arrB[j];
      if (
        ca.key.toLowerCase() === cb.key.toLowerCase() &&
        !!ca.ctrl === !!cb.ctrl &&
        !!ca.shift === !!cb.shift &&
        !!ca.alt === !!cb.alt &&
        !!ca.meta === !!cb.meta
      ) {
        return true;
      }
    }
  }
  return false;
};

const updateHeldModifiers = (e: KeyboardEvent) => {
  heldModifiers = { ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey, meta: e.metaKey };
};

const clearHeldKeys = () => {
  heldRawKeys.clear();
  heldModifiers = {};
  keyActionListener?.(null);
};

/** Whether a binding is active and its chord matches the event. */
const bindingMatchesEvent = (
  binding: KeyBinding,
  type: 'KEY_UP' | 'KEY_DOWN',
  e: KeyboardEvent
): binding is KeyUpDownBinding => {
  if (binding.type !== type) return false;
  if (isBindingDisabled(binding) || !isSceneMatch(binding.sceneId)) return false;
  if (areAppInputsSuspended() && !binding.isDebugKey) return false;
  const caseInsensitive = binding.caseInsensitive ?? true;
  return getChordArray(binding.chord).some((c) =>
    eventMatchesChord(e, c, caseInsensitive, binding.ignoreModifiers)
  );
};

/** Whether a binding other than `self`, and not yielding itself, fires for the event. */
const isEventTakenByOther = (
  self: KeyUpDownBinding | null,
  type: 'KEY_UP' | 'KEY_DOWN',
  e: KeyboardEvent
) => {
  for (let i = 0; i < bindings.length; i++) {
    const binding = bindings[i];
    if (binding === self || (binding as KeyUpDownBinding).yieldToOtherBindings) continue;
    if (bindingMatchesEvent(binding, type, e)) return true;
  }
  return false;
};

const dispatchKeyEvent = (e: KeyboardEvent, type: 'KEY_UP' | 'KEY_DOWN') => {
  if (!keyInputsEnabled || !areAllInputsEnabled()) return;
  const timeNow = performance.now();
  for (let i = 0; i < bindings.length; i++) {
    const binding = bindings[i];
    if (!bindingMatchesEvent(binding, type, e)) continue;
    if (binding.yieldToOtherBindings && isEventTakenByOther(binding, type, e)) continue;
    binding.fn(e, timeNow);
  }
};

const initKeyListeners = () => {
  if (keydownListener) return;

  keydownListener = (e: KeyboardEvent) => {
    if (!e.repeat) heldRawKeys.add(e.key);
    updateHeldModifiers(e);
    keyActionListener?.(e);
    dispatchKeyEvent(e, 'KEY_DOWN');
  };

  keyupListener = (e: KeyboardEvent) => {
    // A letter's e.key follows the Shift state at the time of each event, so one pressed with
    // Shift down ('W') and released after Shift ('w') must be cleared in either case.
    heldRawKeys.delete(e.key);
    heldRawKeys.delete(e.key.toLowerCase());
    heldRawKeys.delete(e.key.toUpperCase());
    updateHeldModifiers(e);
    keyActionListener?.(e);
    dispatchKeyEvent(e, 'KEY_UP');
  };

  addVisibilityChangeFn('inputKeyboardHeldKeysClear', () => clearHeldKeys());
  addOnWindowBlurFn('inputKeyboardHeldKeysClear', () => clearHeldKeys());

  // The input scope (InputState.ts): the window, the canvas while it has focus, or nothing
  const scope = getInputScope();
  if (scope === 'WINDOW') addKeyListeners(window);
  // The canvas once it exists (createRenderer runs these right away when it does)
  else if (scope === 'CANVAS')
    onRendererCreated((renderer) => addKeyListeners(renderer.domElement));
};

/** Adds the key listeners to the window, or to the canvas, which takes focus (a tabindex) and
 * clears the held keys when it loses it. */
const addKeyListeners = (target: Window | HTMLElement) => {
  const keydown = keydownListener;
  const keyup = keyupListener;
  if (!keydown || !keyup || removeListeners) return;
  target.addEventListener('keydown', keydown as EventListener);
  target.addEventListener('keyup', keyup as EventListener);
  const canvas = target === window ? null : (target as HTMLElement);
  if (canvas && !canvas.hasAttribute('tabindex')) canvas.tabIndex = 0;
  canvas?.addEventListener('blur', clearHeldKeys);
  removeListeners = () => {
    target.removeEventListener('keydown', keydown as EventListener);
    target.removeEventListener('keyup', keyup as EventListener);
    canvas?.removeEventListener('blur', clearHeldKeys);
  };
};

/**
 * Removes the key listeners and clears the held keys (the mount's unmount). The next binding or
 * action source adds them again, by the input scope then.
 * @internal
 */
export const removeKeyListeners = (): void => {
  removeListeners?.();
  removeListeners = null;
  keydownListener = null;
  keyupListener = null;
  clearHeldKeys();
};

/**
 * Warns (debug env) when a chord is one a debug key reserved ({@link markChordReserved}): both
 * run in debug mode. A reserved chord of the map `mapId`, or one with the id `id` that no map
 * owns, is skipped.
 * @internal
 */
export const warnIfKeyChordReserved = (
  owner: string,
  id: string,
  chord: KeyChord | KeyChord[],
  mapId?: string,
  ignoreModifiers?: boolean
): void => {
  if (!isDebugEnvironment()) return;
  for (let i = 0; i < reservedChords.length; i++) {
    const reserved = reservedChords[i];
    if (reserved.mapId ? reserved.mapId === mapId : reserved.id === id) continue;
    // A chord that ignores modifiers matches the key with any of them
    const collides = ignoreModifiers
      ? getChordArray(reserved.chord).some((r) =>
          getChordArray(chord).some((c) => c.key.toLowerCase() === r.key.toLowerCase())
        )
      : doKeyChordsCollide(reserved.chord, chord);
    if (!collides) continue;
    lwarn(
      `Debug key "${reserved.chordLabel}" ("${reserved.id}") is also bound by ${owner}: both ` +
        `run in debug mode. To rebind or turn off the debug key, add a debugKeys entry with the ` +
        `id "${reserved.id}" to CONFIG.ts.`
    );
  }
};

export const createKeyBinding = (binding: KeyBinding): void => {
  warnIfKeyChordReserved(
    `the key binding "${binding.id}"`,
    binding.id,
    binding.chord,
    undefined,
    binding.ignoreModifiers
  );
  bindings = bindings.filter((b) => b.id !== binding.id);
  bindings.push(binding);
  initKeyListeners();
};

/** The registered key bindings, in registration order (read-only, eg. for listing shortcuts). */
export const getKeyBindings = (): readonly Readonly<KeyBinding>[] => bindings;

export const deleteKeyBinding = (id: string): void => {
  bindings = bindings.filter((b) => b.id !== id);
};

export const setKeyBindingEnabled = (id: string, enabled: boolean): void => {
  const binding = bindings.find((b) => b.id === id);
  if (!binding) {
    lwarn(`Could not find key binding with id "${id}" in setKeyBindingEnabled.`);
    return;
  }
  binding.enabled = enabled;
};

/** Pure query: is this chord currently physically held? No registration needed. */
export const isChordHeld = (chord: KeyChord, caseInsensitive: boolean = true): boolean => {
  initKeyListeners();
  return chordIsHeld(chord, caseInsensitive);
};

/**
 * Drives KEY_HELD bindings once per tick. Called from exactly two places in MainLoop.ts
 * (runFixedSubStep, once per fixed physics sub-step, and the no-stepping branch), so a
 * held key's binding runs once per sub-step, before that step's systems. Gameplay code should
 * read an action map instead (createActionMap: sampled at the same place, right before).
 */
export const pollHeldKeyBindings = (delta: number): void => {
  initKeyListeners();
  if (!keyInputsEnabled || !areAppInputsEnabled()) return;
  for (let i = 0; i < bindings.length; i++) {
    const binding = bindings[i];
    if (binding.type !== 'KEY_HELD') continue;
    if (isBindingDisabled(binding) || !isSceneMatch(binding.sceneId)) continue;
    const caseInsensitive = binding.caseInsensitive ?? true;
    const matched = getChordArray(binding.chord).some((c) =>
      chordIsHeld(c, caseInsensitive, binding.ignoreModifiers)
    );
    if (matched) binding.fn(delta);
  }
};

/**
 * Sets (null removes) the action layer's keyboard source, called on every key event after the
 * held keys are updated, before the bindings, and with null when the held keys are cleared (blur,
 * a hidden page). Adds the window listeners.
 * @internal
 */
export const setKeyActionListener = (fn: ((e: KeyboardEvent | null) => void) | null): void => {
  keyActionListener = fn;
  if (fn) initKeyListeners();
};

/**
 * Whether a chord is held now, by the bindings' rules (the action layer's keyboard reads).
 * @internal
 */
export const isKeyChordHeld = (
  chord: KeyChord,
  caseInsensitive: boolean,
  ignoreModifiers: boolean
): boolean => chordIsHeld(chord, caseInsensitive, ignoreModifiers);

/**
 * Whether a key event matches a chord, by the bindings' rules.
 * @internal
 */
export const doesKeyEventMatchChord = (
  e: KeyboardEvent,
  chord: KeyChord,
  caseInsensitive: boolean,
  ignoreModifiers: boolean
): boolean => eventMatchesChord(e, chord, caseInsensitive, ignoreModifiers);

/**
 * Reserves a debug key's chord: a key binding or an action map binding it later gets a console
 * warning (debug env). Used by DefaultDebugKeyBindings.ts.
 * @param mapId the action map that binds it, whose own bindings don't collide with it
 */
export const markChordReserved = (
  id: string,
  chord: KeyChord | KeyChord[],
  mapId?: string
): void => {
  reservedChords = reservedChords.filter((r) => r.id !== id);
  reservedChords.push({ id, chord, chordLabel: getKeyChordLabel(chord), mapId });
};

/**
 * Whether a key binding that doesn't yield itself fires for the event (what a yielding debug key
 * gives way to).
 * @internal
 */
export const isKeyEventTakenByBindings = (e: KeyboardEvent, type: 'KEY_UP' | 'KEY_DOWN'): boolean =>
  keyInputsEnabled && areAllInputsEnabled() && isEventTakenByOther(null, type, e);
