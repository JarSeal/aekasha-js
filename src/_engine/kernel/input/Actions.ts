// The action layer (p610 D4, p603 C5): devices produce actions through bindings per map, and
// gameplay code reads actions, never keys. Two ways to read, for two needs:
// - At the step: sampleActions runs right before each fixed sub-step (once per frame without
//   stepping), and ActionMap.read returns that sample. Presses and releases between two samples
//   are counted, so a tap shorter than a step isn't lost, and an edge lands on one step.
// - At the event: onPressed / onReleased fire when a device reports it (a DOM event, the gamepad's
//   per-frame poll), so UI and debug keys work while the loop is paused.
// Each device's live state is followed all the time, also while a map is inactive; only the
// counts, deltas and callbacks need it active. So a key held through a menu reads down when the
// menu closes, without a press. The per-device switches (setKeyInputsEnabled, ...) are the
// bindings' own and don't apply here; the master switches (InputState.ts) do, through contexts.

import { isDebugCameraActive } from '../camera/Camera';
import { IS_DEBUG_ENV } from '../config/Config';
import { setActionSampler } from '../loop/MainLoop';
import { getCurrentSceneId } from '../scene/Scene';
import { lwarn } from '../../utils/Logger';
import {
  compileActionBindings,
  isKeyEventInBindings,
  readActionDevices,
  type CompiledBinding,
  type LiveActionValue,
} from './ActionBindings';
import type {
  ActionBinding,
  ActionContext,
  ActionDefs,
  ActionEventFn,
  ActionFrame,
  ActionMap,
  ActionMapOpts,
  ActionState,
  ActionType,
} from './ActionTypes';
import { pollGamepads } from './GamepadInput';
import type { EnabledInDebugCam } from './InputSharedTypes';
import { addInputListenerRemover, areAllInputsEnabled, areAppInputsEnabled } from './InputState';
import { setKeyActionListener, warnIfKeyChordReserved } from './KeyboardInput';
import { setMouseActionSource } from './MouseInput';
import { setTouchActionSource } from './TouchInput';

const WHEEL_LINE_PX = 16;

type ActionRuntime = {
  id: string;
  type: ActionType;
  bindings: readonly ActionBinding[];
  compiled: CompiledBinding[];
  /** The devices' state now (followed while the map is inactive too). */
  isLiveDown: boolean;
  live: LiveActionValue;
  /** Since the previous sample, while the map was active. */
  pressedCount: number;
  releasedCount: number;
  deltaX: number;
  deltaY: number;
  /** The last sample: what read() returns. */
  state: ActionState;
  /** Copied on write, so a callback can add or remove one while they're being called. */
  pressedFns: ActionEventFn[];
  releasedFns: ActionEventFn[];
};

/**
 * What records a map's samples (ActionRecording.ts).
 * @internal
 */
export type ActionMapRecorder = {
  /** After each sample, with its step. */
  onSample: (step: number) => void;
  /** The map was deleted. */
  onMapDeleted: () => void;
};

/**
 * What stands in for a map's devices (ActionRecording.ts).
 * @internal
 */
export type ActionMapReplay = {
  /** The step's frame (undefined: an idle step), or null once it has ended (it's then removed). */
  frameAt: (step: number) => ActionFrame['actions'] | undefined | null;
  /** The map was deleted. */
  onMapDeleted: () => void;
};

type MapRuntime = {
  id: string;
  context: ActionContext;
  sceneId: string | undefined;
  enabledInDebugCam: EnabledInDebugCam;
  ignoreModifiers: boolean;
  preventDefault: boolean;
  gamepadIndex: number | undefined;
  enabled: boolean;
  isDeleted: boolean;
  actions: ActionRuntime[];
  byId: Map<string, ActionRuntime>;
  handle: ActionMap;
  recorder: ActionMapRecorder | null;
  replay: ActionMapReplay | null;
};

/** Copied on write, so a callback can create or delete maps while they're being walked. */
let maps: MapRuntime[] = [];
const mapsById = new Map<string, MapRuntime>();
const runtimeOfHandle = new WeakMap<ActionMap, MapRuntime>();
const disabledContexts = new Set<ActionContext>();
let noStepSampleIndex = 0;
let isSamplerSet = false;

let hasKeySource = false;
let hasMouseSource = false;
let hasTouchSource = false;
let isSourceRemoverAdded = false;
let usesGamepad = false;
let usesRightMouseButton = false;
let usesTouchDrag = false;

// Activity
// **************************************

const isDebugCamRuleMet = (rule: EnabledInDebugCam) =>
  !IS_DEBUG_ENV ||
  !(
    (rule === 'NOT_ENABLED_IN_DEBUG' && isDebugCameraActive()) ||
    (rule === 'ENABLED_ONLY_IN_DEBUG' && !isDebugCameraActive())
  );

const isContextOn = (context: ActionContext) =>
  !disabledContexts.has(context) &&
  (context === 'DEBUG' ? areAllInputsEnabled() : areAppInputsEnabled());

/** Whether devices drive the map now (a replay stands in for them instead). */
const isMapActive = (map: MapRuntime) =>
  map.enabled &&
  !map.isDeleted &&
  isContextOn(map.context) &&
  (map.sceneId === undefined || map.sceneId === getCurrentSceneId()) &&
  isDebugCamRuleMet(map.enabledInDebugCam);

/**
 * Enables or disables a context: every map in it reads idle and fires no callbacks while it's off
 * (a menu turns `GAMEPLAY` off and its own context on). Every context starts enabled.
 */
export const setActionContextEnabled = (context: ActionContext, enabled: boolean): void => {
  if (enabled) disabledContexts.delete(context);
  else disabledContexts.add(context);
};

/** Whether a context is enabled ({@link setActionContextEnabled}). */
export const isActionContextEnabled = (context: ActionContext): boolean =>
  !disabledContexts.has(context);

// Events
// **************************************

const fire = (fns: ActionEventFn[], e: Event | null) => {
  for (let i = 0; i < fns.length; i++) fns[i](e);
};

const isNewKeyDown = (e: Event | null): e is KeyboardEvent =>
  e !== null && e.type === 'keydown' && !(e as KeyboardEvent).repeat;

/** Re-reads a map's button and axis actions. On a change of down, an active map counts the edge
 * and calls its callbacks. */
const updateMap = (map: MapRuntime, e: Event | null, active: boolean) => {
  for (let i = 0; i < map.actions.length; i++) {
    const a = map.actions[i];
    if (a.type === 'DELTA_2D') continue;
    const isDown = readActionDevices(a.compiled, a.type, map.gamepadIndex, a.live);
    if (isDown === a.isLiveDown) {
      // A key of a held button pressed again is a press too: another of its keys, or a key whose
      // keyup the browser never sent (macOS sends none while ⌘ is held: ⌘Z, Z again)
      if (
        isDown &&
        active &&
        a.type === 'BUTTON' &&
        isNewKeyDown(e) &&
        isKeyEventInBindings(a.compiled, e)
      ) {
        a.pressedCount++;
        fire(a.pressedFns, e);
      }
      continue;
    }
    a.isLiveDown = isDown;
    if (!active) continue;
    if (isDown) {
      a.pressedCount++;
      fire(a.pressedFns, e);
    } else {
      a.releasedCount++;
      fire(a.releasedFns, e);
    }
  }
};

const isCountingEvents = (map: MapRuntime) => !map.replay && isMapActive(map);

const updateAllMaps = (e: Event | null) => {
  const list = maps;
  for (let i = 0; i < list.length; i++) {
    const map = list[i];
    if (!map.isDeleted) updateMap(map, e, isCountingEvents(map));
  }
};

// Device sources
// **************************************

const isEditableTarget = (e: Event) => {
  const target = e.target as { tagName?: string; isContentEditable?: boolean } | null;
  if (!target) return false;
  const tag = target.tagName;
  return !!target.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
};

const onKeyEvent = (e: KeyboardEvent | null) => {
  updateAllMaps(e);
  if (!e || e.type !== 'keydown' || e.defaultPrevented || isEditableTarget(e)) return;
  const list = maps;
  for (let i = 0; i < list.length; i++) {
    const map = list[i];
    if (!map.preventDefault || !isCountingEvents(map)) continue;
    for (let j = 0; j < map.actions.length; j++) {
      if (isKeyEventInBindings(map.actions[j].compiled, e, true)) {
        e.preventDefault();
        return;
      }
    }
  }
};

/**
 * Whether an active map other than `exceptMapId` has a keyboard binding the event matches (what a
 * yielding debug key gives way to).
 * @internal
 */
export const isKeyEventInActiveMaps = (e: KeyboardEvent, exceptMapId: string): boolean => {
  const list = maps;
  for (let i = 0; i < list.length; i++) {
    const map = list[i];
    if (map.id === exceptMapId || !isCountingEvents(map)) continue;
    for (let j = 0; j < map.actions.length; j++) {
      if (isKeyEventInBindings(map.actions[j].compiled, e)) return true;
    }
  }
  return false;
};

/** Adds `x`, `y` (right and up positive) to the active maps' delta actions, times the scale
 * `match` gives for each binding (null: not this binding). */
const addDeltas = (match: (c: CompiledBinding) => number | null, x: number, y: number) => {
  const list = maps;
  for (let i = 0; i < list.length; i++) {
    const map = list[i];
    if (!isCountingEvents(map)) continue;
    for (let j = 0; j < map.actions.length; j++) {
      const a = map.actions[j];
      if (a.type !== 'DELTA_2D') continue;
      for (let k = 0; k < a.compiled.length; k++) {
        const scale = match(a.compiled[k]);
        if (scale === null) continue;
        a.deltaX += x * scale;
        a.deltaY += y * scale;
      }
    }
  }
};

const matchMouseMove = (c: CompiledBinding) =>
  c.kind === 'MOUSE_DELTA' && c.delta === 'MOVE' ? c.scale : null;
const matchWheel = (c: CompiledBinding) =>
  c.kind === 'MOUSE_DELTA' && c.delta === 'WHEEL' ? c.scale : null;
const matchTouchDrag = (c: CompiledBinding) => (c.kind === 'TOUCH_DRAG' ? c.scale : null);

/** A wheel page in pixels: the height of what listens, the canvas in the `CANVAS` input scope (an
 * embed's page is the host's), else the window. */
const getWheelPagePx = (e: WheelEvent) => {
  const target = e.currentTarget as { clientHeight?: number } | null;
  return target && target !== window && target.clientHeight
    ? target.clientHeight
    : window.innerHeight;
};

const onWheel = (e: WheelEvent) => {
  // DOM_DELTA_LINE (1) and DOM_DELTA_PAGE (2) in pixels
  const unit = e.deltaMode === 1 ? WHEEL_LINE_PX : e.deltaMode === 2 ? getWheelPagePx(e) : 1;
  addDeltas(matchWheel, e.deltaX * unit, -e.deltaY * unit);
};

const onTap = (e: TouchEvent) => {
  const list = maps;
  for (let i = 0; i < list.length; i++) {
    const map = list[i];
    if (!isCountingEvents(map)) continue;
    for (let j = 0; j < map.actions.length; j++) {
      const a = map.actions[j];
      if (!a.compiled.some((c) => c.kind === 'TOUCH_TAP')) continue;
      // A tap is a press and a release in one sample: the button never reads held
      a.pressedCount++;
      fire(a.pressedFns, e);
      a.releasedCount++;
      fire(a.releasedFns, e);
    }
  }
};

/** Forgets the device sources when every device's listeners are removed (a mount's unmount,
 * `removeAllInputListeners`), so the next map adds them again by the input scope then. */
const resetDeviceSources = () => {
  hasKeySource = false;
  hasMouseSource = false;
  hasTouchSource = false;
  isSourceRemoverAdded = false;
};

/** Adds the device sources the maps' bindings need (they stay until every device's listeners are
 * removed) and notes what the devices should prevent (the context menu, scrolling). */
const updateDeviceSources = () => {
  let needsKeys = false;
  let needsMouse = false;
  let needsTouch = false;
  usesGamepad = false;
  usesRightMouseButton = false;
  usesTouchDrag = false;
  for (const map of maps) {
    for (const a of map.actions) {
      for (const c of a.compiled) {
        if (c.kind === 'KEYS' || c.kind === 'KEY_AXIS' || c.kind === 'KEY_COMPOSITE') {
          needsKeys = true;
        } else if (c.kind === 'MOUSE_BUTTON' || c.kind === 'MOUSE_DELTA') {
          needsMouse = true;
          if (c.kind === 'MOUSE_BUTTON' && c.button === 'RIGHT') usesRightMouseButton = true;
        } else if (c.kind === 'TOUCH_TAP' || c.kind === 'TOUCH_DRAG') {
          needsTouch = true;
          if (c.kind === 'TOUCH_DRAG') usesTouchDrag = true;
        } else {
          usesGamepad = true;
        }
      }
    }
  }
  if ((needsKeys || needsMouse || needsTouch) && !isSourceRemoverAdded) {
    isSourceRemoverAdded = true;
    addInputListenerRemover(resetDeviceSources);
  }
  if (needsKeys && !hasKeySource) {
    hasKeySource = true;
    setKeyActionListener(onKeyEvent);
  }
  if (needsMouse && !hasMouseSource) {
    hasMouseSource = true;
    setMouseActionSource({
      onButton: (e) => updateAllMaps(e),
      onMove: (e) => addDeltas(matchMouseMove, e.movementX, -e.movementY),
      onWheel,
      usesRightButton: () => usesRightMouseButton,
    });
  }
  if (needsTouch && !hasTouchSource) {
    hasTouchSource = true;
    setTouchActionSource({
      onTap,
      onDrag: (_e, dx, dy) => addDeltas(matchTouchDrag, dx, -dy),
      usesDrag: () => usesTouchDrag,
    });
  }
};

/** Compiles an action's bindings (a binding that doesn't fit its type is left out). */
const setActionBindings = (
  map: MapRuntime,
  a: ActionRuntime,
  bindings: readonly ActionBinding[]
) => {
  a.bindings = bindings;
  a.compiled = compileActionBindings(map.id, a.id, a.type, bindings, map.ignoreModifiers);
  if (!IS_DEBUG_ENV) return;
  // A debug key's chord (DefaultDebugKeyBindings.ts) runs both in debug mode: warn
  const owner = `the action "${a.id}" of the action map "${map.id}"`;
  for (const c of a.compiled) {
    if (c.kind !== 'KEYS' && c.kind !== 'KEY_AXIS' && c.kind !== 'KEY_COMPOSITE') continue;
    const chords =
      c.kind === 'KEYS'
        ? c.chords
        : c.kind === 'KEY_AXIS'
          ? [...c.neg, ...c.pos]
          : [...c.up, ...c.down, ...c.left, ...c.right];
    warnIfKeyChordReserved(owner, a.id, chords, map.id, c.ignoreModifiers);
  }
};

// Sampling (the loop's hooks)
// **************************************

const IDLE: Readonly<ActionState> = {
  isDown: false,
  pressedCount: 0,
  releasedCount: 0,
  value: 0,
  x: 0,
  y: 0,
};

const clearSinceSample = (a: ActionRuntime) => {
  a.pressedCount = 0;
  a.releasedCount = 0;
  a.deltaX = 0;
  a.deltaY = 0;
};

const sampleLive = (a: ActionRuntime) => {
  const s = a.state;
  s.pressedCount = a.pressedCount;
  s.releasedCount = a.releasedCount;
  if (a.type === 'DELTA_2D') {
    s.x = a.deltaX;
    s.y = a.deltaY;
    s.value = Math.hypot(s.x, s.y);
    s.isDown = s.value !== 0;
    return;
  }
  s.isDown = a.isLiveDown;
  s.value = a.live.value;
  s.x = a.live.x;
  s.y = a.live.y;
};

/** Replays a frame's states, calling the callbacks for its counts. */
const sampleReplay = (map: MapRuntime, frame: ActionFrame['actions'] | undefined) => {
  for (let i = 0; i < map.actions.length; i++) {
    const a = map.actions[i];
    const data = frame?.[a.id];
    const s = a.state;
    s.isDown = data?.isDown ?? false;
    s.pressedCount = data?.pressedCount ?? 0;
    s.releasedCount = data?.releasedCount ?? 0;
    s.value = data?.value ?? 0;
    s.x = data?.x ?? 0;
    s.y = data?.y ?? 0;
    for (let n = 0; n < s.pressedCount; n++) fire(a.pressedFns, null);
    for (let n = 0; n < s.releasedCount; n++) fire(a.releasedFns, null);
  }
};

/**
 * Samples every map: right before each fixed sub-step with its step index, or once per frame
 * without stepping with -1 (the sample is then numbered by a count of its own). What
 * {@link ActionMap.read} returns until the next sample.
 * @internal
 */
export const sampleActions = (stepIndex: number): void => {
  const step = stepIndex >= 0 ? stepIndex : noStepSampleIndex++;
  const list = maps;
  for (let i = 0; i < list.length; i++) {
    const map = list[i];
    if (map.isDeleted) continue;
    const frame = map.replay ? map.replay.frameAt(step) : null;
    if (frame !== null) {
      sampleReplay(map, frame);
    } else {
      map.replay = null;
      const active = isMapActive(map);
      for (let j = 0; j < map.actions.length; j++) {
        if (active) sampleLive(map.actions[j]);
        else Object.assign(map.actions[j].state, IDLE);
      }
    }
    for (let j = 0; j < map.actions.length; j++) clearSinceSample(map.actions[j]);
    map.recorder?.onSample(step);
  }
};

/**
 * Drops what happened since the last sample (the counts and deltas), keeping what's held: the
 * loop calls it on a frame it doesn't step (paused, or an editor view), so a press made meanwhile
 * doesn't land on the first step after it.
 * @internal
 */
export const skipActionSample = (): void => {
  const list = maps;
  for (let i = 0; i < list.length; i++) {
    for (const a of list[i].actions) clearSinceSample(a);
  }
};

/**
 * Once per frame, also while paused: polls the gamepads (while a map has a gamepad binding) and
 * re-reads the maps when one changed, calling their callbacks.
 * @internal
 */
export const pollActionsFrame = (): void => {
  if (usesGamepad && pollGamepads()) updateAllMaps(null);
};

// Maps
// **************************************

const deleteMapRuntime = (map: MapRuntime) => {
  if (map.isDeleted) return;
  map.isDeleted = true;
  maps = maps.filter((m) => m !== map);
  if (mapsById.get(map.id) === map) mapsById.delete(map.id);
  for (const a of map.actions) {
    a.pressedFns = [];
    a.releasedFns = [];
  }
  const { recorder, replay } = map;
  map.recorder = null;
  map.replay = null;
  recorder?.onMapDeleted();
  replay?.onMapDeleted();
  updateDeviceSources();
};

const getAction = (map: MapRuntime, actionId: string) => {
  const a = map.byId.get(actionId);
  if (!a) throw new Error(`Action map "${map.id}" has no action "${actionId}".`);
  return a;
};

const addFn = (a: ActionRuntime, key: 'pressedFns' | 'releasedFns', fn: ActionEventFn) => {
  a[key] = [...a[key], fn];
  return () => {
    a[key] = a[key].filter((f) => f !== fn);
  };
};

/**
 * Creates an action map: actions read from devices through bindings, enabled by a context. A map
 * with an id already taken replaces that one.
 * @template TActions the action definitions (inferred), which type the ids and bindings
 * @example
 * const map = createActionMap({
 *   id: 'player',
 *   actions: {
 *     move: { type: 'AXIS_2D', name: 'Move' },
 *     jump: { type: 'BUTTON', name: 'Jump' },
 *   },
 *   bindings: {
 *     move: [
 *       { device: 'KEYBOARD', up: ['w'], down: ['s'], left: ['a'], right: ['d'] },
 *       { device: 'GAMEPAD', stick: 'LEFT' },
 *     ],
 *     jump: [{ device: 'KEYBOARD', keys: [' '] }, { device: 'GAMEPAD', button: 'SOUTH' }],
 *   },
 * });
 * // In an APP_PHYSICS_STEP system: the sample taken right before this step
 * const move = map.read('move');
 * if (map.read('jump').pressedCount > 0) intent.jump = true;
 */
export const createActionMap = <const TActions extends ActionDefs>(
  opts: ActionMapOpts<TActions>
): ActionMap<TActions> => {
  const existing = mapsById.get(opts.id);
  if (existing) deleteMapRuntime(existing);
  if (!isSamplerSet) {
    isSamplerSet = true;
    setActionSampler({
      pollFrame: pollActionsFrame,
      sample: sampleActions,
      skip: skipActionSample,
    });
  }

  const context = opts.context ?? 'GAMEPLAY';
  const isDebug = context === 'DEBUG';
  const map: MapRuntime = {
    id: opts.id,
    context,
    sceneId: opts.sceneId,
    enabledInDebugCam:
      opts.enabledInDebugCam ?? (isDebug ? 'ENABLED_IN_DEBUG' : 'NOT_ENABLED_IN_DEBUG'),
    ignoreModifiers: opts.ignoreModifiers ?? !isDebug,
    preventDefault: opts.preventDefault ?? !isDebug,
    gamepadIndex: opts.gamepadIndex,
    enabled: opts.enabled ?? true,
    isDeleted: false,
    actions: [],
    byId: new Map(),
    handle: undefined as unknown as ActionMap, // set below, once the handle exists
    recorder: null,
    replay: null,
  };

  for (const id of Object.keys(opts.actions)) {
    const a: ActionRuntime = {
      id,
      type: opts.actions[id].type,
      bindings: [],
      compiled: [],
      isLiveDown: false,
      live: { value: 0, x: 0, y: 0 },
      pressedCount: 0,
      releasedCount: 0,
      deltaX: 0,
      deltaY: 0,
      state: { ...IDLE },
      pressedFns: [],
      releasedFns: [],
    };
    map.actions.push(a);
    map.byId.set(id, a);
  }
  const bindings = (opts.bindings ?? {}) as { [actionId: string]: readonly ActionBinding[] };
  for (const id of Object.keys(bindings)) {
    const a = map.byId.get(id);
    if (!a) {
      lwarn(`Action map "${map.id}": bindings for "${id}", which isn't one of its actions.`);
      continue;
    }
    setActionBindings(map, a, bindings[id]);
  }

  const handle: ActionMap<TActions> = {
    id: map.id,
    context,
    sceneId: map.sceneId,
    enabledInDebugCam: map.enabledInDebugCam,
    actions: opts.actions,
    read: (actionId) => map.byId.get(actionId)?.state ?? IDLE,
    onPressed: (actionId, fn) => addFn(getAction(map, actionId), 'pressedFns', fn),
    onReleased: (actionId, fn) => addFn(getAction(map, actionId), 'releasedFns', fn),
    getBindings: (actionId) => getAction(map, actionId).bindings as never,
    setBindings: (actionId, newBindings) => {
      setActionBindings(map, getAction(map, actionId), newBindings as readonly ActionBinding[]);
      updateDeviceSources();
      updateMap(map, null, isCountingEvents(map));
    },
    setEnabled: (enabled) => {
      map.enabled = enabled;
    },
    isActive: () => isMapActive(map),
    delete: () => deleteMapRuntime(map),
  };
  map.handle = handle;
  runtimeOfHandle.set(handle, map);

  maps = [...maps, map];
  mapsById.set(map.id, map);
  updateDeviceSources();
  // What's held already reads down, without a press
  updateMap(map, null, false);
  return handle;
};

/** The action map with this id, if any. */
export const getActionMap = (id: string): ActionMap | undefined => mapsById.get(id)?.handle;

/** Every action map, in creation order (eg. for a shortcuts list). */
export const getActionMaps = (): ActionMap[] => maps.map((m) => m.handle);

// Recording and replay (ActionRecording.ts)
// **************************************

const getRuntime = (handle: ActionMap, caller: string) => {
  const map = runtimeOfHandle.get(handle);
  if (!map || map.isDeleted) throw new Error(`${caller}: the action map was deleted.`);
  return map;
};

/**
 * Sets the map's recorder. Throws when the map was deleted or is being recorded already.
 * @internal
 * @returns removes it (a no-op once the map is deleted)
 */
export const setActionMapRecorder = (handle: ActionMap, recorder: ActionMapRecorder) => {
  const map = getRuntime(handle, 'recordActions');
  if (map.recorder) throw new Error(`Action map "${map.id}" is being recorded already.`);
  map.recorder = recorder;
  return () => {
    if (map.recorder === recorder) map.recorder = null;
  };
};

/**
 * Sets the replay that stands in for the map's devices at its samples, until its `frameAt`
 * returns null. Throws when the map was deleted or is replaying already.
 * @internal
 * @returns removes it (a no-op once it has ended or the map is deleted)
 */
export const setActionMapReplay = (handle: ActionMap, replay: ActionMapReplay) => {
  const map = getRuntime(handle, 'playActionRecording');
  if (map.replay) throw new Error(`Action map "${map.id}" is replaying already.`);
  map.replay = replay;
  return () => {
    if (map.replay === replay) map.replay = null;
  };
};
