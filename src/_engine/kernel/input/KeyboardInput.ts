import { IS_DEBUG_ENV } from '../config/Config';
import { onVisibilityChange, onWindowBlur, setHeldKeyPoller } from '../loop/MainLoop';
import { onRendererCreated } from '../render/Renderer';
import { getCurrentSceneId } from '../scene/Scene';
import { lwarn } from '../../utils/Logger';
import {
  areAllInputsEnabled,
  areAppInputsEnabled,
  areAppInputsSuspended,
  addInputListenerRemover,
  getInputScope,
} from './InputState';
import { isDebugCamRuleMet } from './InputRules';
import type { BindingMeta, EnabledInDebugCam, Modifiers } from './InputSharedTypes';

/**
 * A key and the modifiers held with it. A chord matches only its own modifiers: `{ key: 'z', ctrl:
 * true }` doesn't fire for Ctrl+Shift+Z, and `{ key: 'z' }` doesn't fire with Ctrl held (see
 * {@link KeyBindingBase.ignoreModifiers}). A modifier key's own flag is ignored, so `{ key:
 * 'Shift' }` matches the Shift press itself.
 */
export type KeyChord = Modifiers & {
  /** `KeyboardEvent.key` value, eg. 'h', 'F1', 'z', 'Escape', ' ' (space). */
  key: string;
};

/** When a key binding fires: on the release, on the press (its key repeats included), or every
 * fixed step while held. */
export type KeyBindingType = 'KEY_UP' | 'KEY_DOWN' | 'KEY_HELD';

/**
 * The fields every key binding type shares (see {@link KeyUpDownBinding} and {@link
 * KeyHeldBinding}).
 */
export type KeyBindingBase = BindingMeta & {
  /** Unique among the key bindings: creating a binding with an id in use replaces that one. */
  id: string;
  /** The chord, or several: any of them fires the binding. */
  chord: KeyChord | KeyChord[];
  /** Matches the key in any case, so 'z' also fires for Caps Lock's 'Z' (default true). Shift is
   * a modifier: `{ key: 'z' }` doesn't fire with it held. */
  caseInsensitive?: boolean;
  /** Match on the key alone, whatever modifiers are (or aren't) held — the chord's own modifier
   * fields are ignored too. For continuous controls like movement that must keep working while
   * an unrelated modifier is pressed (e.g. a Shift run toggle). Default false (exact match). */
  ignoreModifiers?: boolean;
  /** False keeps the binding registered without firing (default true); see
   * {@link setKeyBindingEnabled}. */
  enabled?: boolean;
  /** Fires only while this scene is the current one. */
  sceneId?: string;
  /** Whether it fires while the debug (orbit) camera is active (debug env; default it does). */
  enabledInDebugCam?: EnabledInDebugCam;
  /** Runs in editor views too (Views.ts), which suspend the other bindings. (The engine's
   * debug keys and the CONFIG.ts `debugKeys` are action maps in the `DEBUG` context instead.) */
  isDebugKey?: boolean;
};

/** A key binding that fires on a key event: the release (`KEY_UP`) or the press (`KEY_DOWN`). */
export type KeyUpDownBinding = KeyBindingBase & {
  type: 'KEY_UP' | 'KEY_DOWN';
  /** Runs for the event, with `performance.now()` at the event. */
  fn: (e: KeyboardEvent, time: number) => void;
  /** Default false. When true, the binding doesn't fire for an event that another (not
   * yielding) binding also fires for, whenever that one was registered (eg. the engine's
   * production test mode keys give way to the app's own bindings of the same keys). */
  yieldToOtherBindings?: boolean;
};

/** A key binding polled while its chord is held: once per fixed physics step (once per frame
 * without stepping), right after the action maps' sample, not on key events. */
export type KeyHeldBinding = KeyBindingBase & {
  type: 'KEY_HELD';
  /** Runs once per poll while held, with the poll's delta (the fixed timestep, or the frame's). */
  fn: (delta: number) => void;
};

/** A key binding, by its `type`. Gameplay that reads input every step is an action map
 * (`createActionMap`); a binding suits a one-off shortcut. */
export type KeyBinding = KeyUpDownBinding | KeyHeldBinding;

type ReservedChord = {
  id: string;
  chord: KeyChord | KeyChord[];
  chordLabel: string;
  /** The action map that binds it (its own bindings don't collide with it). */
  mapId: string | undefined;
};

/**
 * A chord with its key lowercased once, so matching it makes no string (the held-key poll runs
 * every fixed step, the action layer's reads on every key event).
 * @internal
 */
export type CompiledKeyChord = {
  chord: KeyChord;
  /** `chord.key.toLowerCase()` */
  lowerKey: string;
};

/** A key binding as given, with its chords compiled at createKeyBinding. */
type KeyBindingEntry = { binding: KeyBinding; chords: CompiledKeyChord[] };

let entries: KeyBindingEntry[] = [];
/** The bindings as given, in registration order (getKeyBindings), rebuilt with `entries`. */
let bindings: KeyBinding[] = [];
let reservedChords: ReservedChord[] = [];

const heldRawKeys = new Set<string>();
/** The held keys lowercased, for the case-insensitive tests (a lookup, no string made) */
const heldLowerKeys = new Set<string>();
/** Written in place on each key event */
const heldModifiers: Modifiers = {};

let keydownListener: ((e: KeyboardEvent) => void) | null = null;
let keyupListener: ((e: KeyboardEvent) => void) | null = null;
/** Removes the key listeners (null: none added) */
let removeListeners: (() => void) | null = null;
/** The action layer's source (Actions.ts): every key event after the held keys are updated, and
 * null when they are cleared. */
let keyActionListener: ((e: KeyboardEvent | null) => void) | null = null;
let isHeldKeyPollerSet = false;

const getChordArray = (chord: KeyChord | KeyChord[]): KeyChord[] =>
  Array.isArray(chord) ? chord : [chord];

/**
 * A chord with its key lowercased, for {@link isKeyChordHeld} and {@link doesKeyEventMatchChord}.
 * @internal
 */
export const compileKeyChord = (chord: KeyChord): CompiledKeyChord => ({
  chord,
  lowerKey: chord.key.toLowerCase(),
});

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

const isBindingDisabled = (binding: KeyBinding) =>
  binding.enabled === false || !isDebugCamRuleMet(binding.enabledInDebugCam);

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
const modifiersMatch = (c: CompiledKeyChord, held: Modifiers): boolean => {
  const own = MODIFIER_OF_KEY[c.lowerKey];
  const { chord } = c;
  return (
    (own === 'ctrl' || !!chord.ctrl === !!held.ctrl) &&
    (own === 'shift' || !!chord.shift === !!held.shift) &&
    (own === 'alt' || !!chord.alt === !!held.alt) &&
    (own === 'meta' || !!chord.meta === !!held.meta)
  );
};

// The last key event read: its key lowercased and its modifiers, once per event however many
// chords test it (the bindings and every action map)
let readEvent: KeyboardEvent | null = null;
let readEventLowerKey = '';
const readEventModifiers: Modifiers = {};

const readKeyEvent = (e: KeyboardEvent) => {
  if (e === readEvent) return;
  readEvent = e;
  readEventLowerKey = e.key.toLowerCase();
  readEventModifiers.ctrl = e.ctrlKey;
  readEventModifiers.shift = e.shiftKey;
  readEventModifiers.alt = e.altKey;
  readEventModifiers.meta = e.metaKey;
};

/** Chord match against a live DOM event: key (case rule per binding) plus an exact modifier
 * match (a plain `{ key: 'h' }` requires no modifiers held) unless ignoreModifiers is set. */
const eventMatchesChord = (
  e: KeyboardEvent,
  c: CompiledKeyChord,
  caseInsensitive: boolean,
  ignoreModifiers?: boolean
): boolean => {
  readKeyEvent(e);
  const keyMatches = caseInsensitive ? readEventLowerKey === c.lowerKey : e.key === c.chord.key;
  return keyMatches && (!!ignoreModifiers || modifiersMatch(c, readEventModifiers));
};

/** Same exact-match rule as eventMatchesChord, but against the live held-key/modifier
 * snapshot instead of a single DOM event (used by isChordHeld / pollHeldKeyBindings). */
const chordIsHeld = (
  c: CompiledKeyChord,
  caseInsensitive: boolean,
  ignoreModifiers?: boolean
): boolean => {
  const keyHeld = caseInsensitive ? heldLowerKeys.has(c.lowerKey) : heldRawKeys.has(c.chord.key);
  return keyHeld && (!!ignoreModifiers || modifiersMatch(c, heldModifiers));
};

/**
 * Whether two chords (or chord lists) share a chord: same key (any case), same modifiers. Used by
 * the debug key shortcuts list and the reserved-chord warning.
 * @internal
 */
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
  heldModifiers.ctrl = e.ctrlKey;
  heldModifiers.shift = e.shiftKey;
  heldModifiers.alt = e.altKey;
  heldModifiers.meta = e.metaKey;
};

const clearHeldKeys = () => {
  heldRawKeys.clear();
  heldLowerKeys.clear();
  heldModifiers.ctrl = false;
  heldModifiers.shift = false;
  heldModifiers.alt = false;
  heldModifiers.meta = false;
  keyActionListener?.(null);
};

/** Whether one of the entry's chords matches the event. */
const entryMatchesEvent = (entry: KeyBindingEntry, e: KeyboardEvent) => {
  const { binding, chords } = entry;
  const caseInsensitive = binding.caseInsensitive ?? true;
  for (let i = 0; i < chords.length; i++) {
    if (eventMatchesChord(e, chords[i], caseInsensitive, binding.ignoreModifiers)) return true;
  }
  return false;
};

/** Whether a binding is active and its chord matches the event. */
const bindingMatchesEvent = (
  entry: KeyBindingEntry,
  type: 'KEY_UP' | 'KEY_DOWN',
  e: KeyboardEvent
): boolean => {
  const { binding } = entry;
  if (binding.type !== type) return false;
  if (isBindingDisabled(binding) || !isSceneMatch(binding.sceneId)) return false;
  if (areAppInputsSuspended() && !binding.isDebugKey) return false;
  return entryMatchesEvent(entry, e);
};

/** Whether a binding other than `self`, and not yielding itself, fires for the event. */
const isEventTakenByOther = (
  self: KeyBindingEntry | null,
  type: 'KEY_UP' | 'KEY_DOWN',
  e: KeyboardEvent
) => {
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (entry === self || (entry.binding as KeyUpDownBinding).yieldToOtherBindings) continue;
    if (bindingMatchesEvent(entry, type, e)) return true;
  }
  return false;
};

const dispatchKeyEvent = (e: KeyboardEvent, type: 'KEY_UP' | 'KEY_DOWN') => {
  if (!areAllInputsEnabled()) return;
  const timeNow = performance.now();
  // A binding's callback may create or delete bindings: walk this event's list
  const list = entries;
  for (let i = 0; i < list.length; i++) {
    const entry = list[i];
    if (!bindingMatchesEvent(entry, type, e)) continue;
    const binding = entry.binding as KeyUpDownBinding;
    if (binding.yieldToOtherBindings && isEventTakenByOther(entry, type, e)) continue;
    binding.fn(e, timeNow);
  }
};

const initKeyListeners = () => {
  if (keydownListener) return;

  keydownListener = (e: KeyboardEvent) => {
    if (!e.repeat) {
      heldRawKeys.add(e.key);
      heldLowerKeys.add(e.key.toLowerCase());
    }
    updateHeldModifiers(e);
    keyActionListener?.(e);
    dispatchKeyEvent(e, 'KEY_DOWN');
  };

  keyupListener = (e: KeyboardEvent) => {
    // A letter's e.key follows the Shift state at the time of each event, so one pressed with
    // Shift down ('W') and released after Shift ('w') must be cleared in either case.
    const lowerKey = e.key.toLowerCase();
    heldRawKeys.delete(e.key);
    heldRawKeys.delete(lowerKey);
    heldRawKeys.delete(e.key.toUpperCase());
    heldLowerKeys.delete(lowerKey);
    updateHeldModifiers(e);
    keyActionListener?.(e);
    dispatchKeyEvent(e, 'KEY_UP');
  };

  addInputListenerRemover(removeKeyListeners);
  // The same function each time, so adding the listeners again (after a removal) adds nothing
  onVisibilityChange(clearHeldKeys);
  onWindowBlur(clearHeldKeys);

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

/** Removes the key listeners and clears the held keys (the mount's unmount, through
 * InputState.ts). The next binding or action source adds them again, by the input scope then. */
const removeKeyListeners = (): void => {
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
  if (!IS_DEBUG_ENV) return;
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

const setEntries = (next: KeyBindingEntry[]) => {
  entries = next;
  bindings = next.map((entry) => entry.binding);
};

/**
 * Registers a key binding, replacing the one with its id. The first binding adds the key
 * listeners (on the window, or on the canvas in an embed's `CANVAS` input scope), and the first
 * `KEY_HELD` one the loop's held-key poll. A chord the engine's debug keys reserve gets a warning
 * (debug env).
 * @remarks The binding is kept as given (not copied): {@link setKeyBindingEnabled} writes its
 * `enabled`.
 * @example
 * ```ts
 * createKeyBinding({
 *   id: 'toggleMap',
 *   type: 'KEY_DOWN',
 *   chord: [{ key: 'm' }, { key: 'Tab' }],
 *   fn: () => toggleMap(),
 * });
 * ```
 */
export const createKeyBinding = (binding: KeyBinding): void => {
  warnIfKeyChordReserved(
    `the key binding "${binding.id}"`,
    binding.id,
    binding.chord,
    undefined,
    binding.ignoreModifiers
  );
  const entry = { binding, chords: getChordArray(binding.chord).map(compileKeyChord) };
  setEntries([...entries.filter((e) => e.binding.id !== binding.id), entry]);
  initKeyListeners();
  // The loop polls held keys only once a binding needs it (the loop imports no keyboard code)
  if (binding.type === 'KEY_HELD' && !isHeldKeyPollerSet) {
    isHeldKeyPollerSet = true;
    setHeldKeyPoller(pollHeldKeyBindings);
  }
};

/**
 * The registered key bindings, in registration order (read-only): the debug key shortcuts list.
 * @internal
 */
export const getKeyBindings = (): readonly Readonly<KeyBinding>[] => bindings;

/** Removes a key binding (a no-op for an unknown id). The key listeners stay. */
export const deleteKeyBinding = (id: string): void => {
  setEntries(entries.filter((e) => e.binding.id !== id));
};

/**
 * Turns a key binding on or off without removing it (warns for an unknown id).
 * @remarks It writes `enabled` on the binding object passed to {@link createKeyBinding}, which is
 * kept as given: a binding object shared by two calls changes for both.
 */
export const setKeyBindingEnabled = (id: string, enabled: boolean): void => {
  const binding = bindings.find((b) => b.id === id);
  if (!binding) {
    lwarn(`Could not find key binding with id "${id}" in setKeyBindingEnabled.`);
    return;
  }
  binding.enabled = enabled;
};

/**
 * Pure query: is this chord currently physically held? No registration needed. Not on the entry:
 * gameplay code reads an action map.
 * @internal
 */
export const isChordHeld = (chord: KeyChord, caseInsensitive: boolean = true): boolean => {
  initKeyListeners();
  return chordIsHeld(compileKeyChord(chord), caseInsensitive);
};

/**
 * Drives KEY_HELD bindings once per tick: the loop's held-key poll (`MainLoop.ts`'
 * `setHeldKeyPoller`, set by the first KEY_HELD binding), run right after the action sample in
 * runFixedSubStep (once per fixed physics sub-step) and in the no-stepping branch, so a held key's
 * binding runs once per sub-step, before that step's systems. Gameplay code should read an action
 * map instead (createActionMap: sampled at the same place, right before).
 * @internal
 */
export const pollHeldKeyBindings = (delta: number): void => {
  if (!areAppInputsEnabled()) return;
  const list = entries;
  for (let i = 0; i < list.length; i++) {
    const { binding, chords } = list[i];
    if (binding.type !== 'KEY_HELD') continue;
    if (isBindingDisabled(binding) || !isSceneMatch(binding.sceneId)) continue;
    const caseInsensitive = binding.caseInsensitive ?? true;
    for (let j = 0; j < chords.length; j++) {
      if (chordIsHeld(chords[j], caseInsensitive, binding.ignoreModifiers)) {
        binding.fn(delta);
        break;
      }
    }
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
  chord: CompiledKeyChord,
  caseInsensitive: boolean,
  ignoreModifiers: boolean
): boolean => chordIsHeld(chord, caseInsensitive, ignoreModifiers);

/**
 * Whether a key event matches a chord, by the bindings' rules.
 * @internal
 */
export const doesKeyEventMatchChord = (
  e: KeyboardEvent,
  chord: CompiledKeyChord,
  caseInsensitive: boolean,
  ignoreModifiers: boolean
): boolean => eventMatchesChord(e, chord, caseInsensitive, ignoreModifiers);

/**
 * Reserves a debug key's chord: a key binding or an action map binding it later gets a console
 * warning (debug env). Used by DefaultDebugKeyBindings.ts.
 * @internal
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
  areAllInputsEnabled() && isEventTakenByOther(null, type, e);
