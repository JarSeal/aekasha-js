import type * as THREE from 'three/webgpu';
import { getECSWorld } from '../ecs/ECS';
import { onWindowBlur } from '../loop/MainLoop';
import { getCanvasElem } from '../render/Renderer';
import { getCurrentSceneId } from '../scene/Scene';
import { ECSSystemStage } from '../loop/SystemStages';
import { lwarn } from '../../utils/Logger';
import { pickTargetsAt, type PickOpts } from './InputPicking';
import { isDebugCamRuleMet } from './InputRules';
import { addInputListenerRemover, areAppInputsEnabled, getInputScope } from './InputState';
import type { BindingMeta, EnabledInDebugCam, TargetList } from './InputSharedTypes';

// NOTE! Every raycast here tests only a binding's own `targets`, never the whole scene graph.
// Cost model: each active MOUSE_HOVER binding raycasts its targets at most once per rendered
// frame (only on frames the pointer moved), and click/dblclick bindings once per event. Cheap
// for small curated target lists; hundreds of objects across many hover bindings will add up.

/** A mouse button, by `MouseEvent.button` (0, 1, 2). */
export type MouseButton = 'LEFT' | 'MIDDLE' | 'RIGHT';

/**
 * The fields every mouse binding type shares (see {@link MouseClickBinding} and the other
 * `Mouse*Binding`s).
 */
export type MouseBindingBase = BindingMeta & {
  /** Unique among the mouse bindings: creating a binding with an id in use replaces that one. */
  id: string;
  /** False keeps the binding registered without firing (default true); see
   * {@link setMouseBindingEnabled}. */
  enabled?: boolean;
  /** Fires only while this scene is the current one. */
  sceneId?: string;
  /** Whether it fires while the debug (orbit) camera is active (debug env; default it does). */
  enabledInDebugCam?: EnabledInDebugCam;
};

/** Fires when a press and release of `button` land on the canvas without dragging, and the
 * click hits one of `targets` (closest hit is passed). */
export type MouseClickBinding = MouseBindingBase &
  PickOpts & {
    type: 'MOUSE_CLICK';
    button: MouseButton;
    /** What the click raycasts against (only these, never the whole scene). */
    targets: TargetList;
    /** Runs on the release, with the closest hit. */
    fn: (e: MouseEvent, intersection: THREE.Intersection) => void;
  };

/** onEnter fires when the closest hit among `targets` changes to a new object, onLeave when
 * the previously hovered object is no longer the closest hit (or the pointer left the canvas). */
export type MouseHoverBinding = MouseBindingBase &
  PickOpts & {
    type: 'MOUSE_HOVER';
    /** What the hover raycasts against: at most once per frame the pointer moved. */
    targets: TargetList;
    /** A new closest hit, with it. */
    onEnter?: (e: MouseEvent, intersection: THREE.Intersection) => void;
    /** The hovered object is no longer the closest hit, or the pointer left the canvas. */
    onLeave?: (e: MouseEvent) => void;
  };

/** Wheel over the canvas, no raycast. */
export type MouseWheelBinding = MouseBindingBase & {
  type: 'MOUSE_WHEEL';
  /** Runs for each wheel event over the canvas. */
  fn: (e: WheelEvent) => void;
};

/** With `targets`, fires only when the double-click hits one of them; without, always fires
 * (intersection undefined). LEFT uses the native dblclick event, RIGHT is timed manually. */
export type MouseDblClickBinding = MouseBindingBase &
  PickOpts & {
    type: 'MOUSE_DBLCLICK';
    button: 'LEFT' | 'RIGHT';
    /** What the double-click raycasts against; without, it fires wherever it lands. */
    targets?: TargetList;
    /** Max time between the two clicks, RIGHT only (LEFT follows the OS setting). Default 300. */
    maxIntervalMs?: number;
    /** Runs on the second click, with the closest hit when there are `targets`. */
    fn: (e: MouseEvent, intersection?: THREE.Intersection) => void;
  };

/** A mouse binding, by its `type`. Each raycasts only its own `targets`. */
export type MouseBinding =
  | MouseClickBinding
  | MouseHoverBinding
  | MouseWheelBinding
  | MouseDblClickBinding;

/** The mouse binding types (`MouseBinding['type']`). */
export type MouseBindingType = MouseBinding['type'];

/**
 * A press that moves at most this far (CSS px) before its release is a click, not a drag. The axes
 * gizmo's click uses it too.
 * @internal
 */
export const CLICK_MAX_MOVE_PX = 5;
const DEFAULT_DBLCLICK_MAX_INTERVAL_MS = 300;
const HOVER_SYSTEM_ID = 'inputMouseHoverSystem';
const MOUSE_BUTTONS: MouseButton[] = ['LEFT', 'MIDDLE', 'RIGHT'];

let bindings: MouseBinding[] = [];

/** Where each button was pressed down on the canvas (cleared on release). */
const pressStarts: { [button in MouseButton]?: { x: number; y: number } } = {};
/** Per RIGHT dblclick binding id, the time of its previous (unpaired) click. */
const lastRightClickTimes = new Map<string, number>();
/** Per MOUSE_HOVER binding id, the currently hovered object's uuid. */
const hoveredUuids = new Map<string, string>();
let lastMoveEvent: MouseEvent | null = null;
let pointerOverCanvas = false;
let hoverDirty = false;
let hoverAllInputsEnabled = true;
let hoverSystemWorld: ReturnType<typeof getECSWorld> | null = null;
const hoverIntersects: THREE.Intersection[] = [];

let canvas: HTMLElement | null = null;
let listenersInitiated = false;
/** Removes the mouse listeners (null: none added) */
let removeListeners: (() => void) | null = null;

/**
 * The action layer's mouse source (Actions.ts).
 * @internal
 */
export type MouseActionSource = {
  /** A button went down on the canvas or came up after that; null when the presses are cleared
   * (blur). */
  onButton: (e: MouseEvent | null) => void;
  /** The pointer moved over the canvas, or anywhere while it's locked. */
  onMove: (e: MouseEvent) => void;
  /** The wheel turned over the canvas. */
  onWheel: (e: WheelEvent) => void;
  /** Whether a binding uses the right button (the canvas' context menu is then prevented). */
  usesRightButton: () => boolean;
};

let mouseActionSource: MouseActionSource | null = null;

const getButton = (e: MouseEvent): MouseButton | undefined => MOUSE_BUTTONS[e.button];

const isBindingActive = (binding: MouseBinding) =>
  areAppInputsEnabled() &&
  binding.enabled !== false &&
  isDebugCamRuleMet(binding.enabledInDebugCam) &&
  (!binding.sceneId || binding.sceneId === getCurrentSceneId());

/** Closest hit among the binding's targets at the event's canvas position, if any. */
const raycastTargets = (
  e: MouseEvent,
  targets: TargetList,
  opts: PickOpts,
  targetArr?: THREE.Intersection[]
): THREE.Intersection | undefined =>
  canvas ? pickTargetsAt(e.clientX, e.clientY, canvas, targets, opts, targetArr) : undefined;

const fireDblClick = (binding: MouseDblClickBinding, e: MouseEvent) => {
  if (!binding.targets) {
    binding.fn(e);
    return;
  }
  const hit = raycastTargets(e, binding.targets, binding);
  if (hit) binding.fn(e, hit);
};

const onMouseDown = (e: MouseEvent) => {
  const button = getButton(e);
  if (!button || e.target !== canvas) return;
  pressStarts[button] = { x: e.clientX, y: e.clientY };
  mouseActionSource?.onButton(e);
};

const onMouseUp = (e: MouseEvent) => {
  const button = getButton(e);
  if (!button) return;
  const start = pressStarts[button];
  delete pressStarts[button];
  if (start) mouseActionSource?.onButton(e);
  // A click must both start and end on the canvas without dragging (e.g. orbiting the camera)
  if (!start || e.target !== canvas) return;
  if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > CLICK_MAX_MOVE_PX) return;

  const timeNow = performance.now();
  for (let i = 0; i < bindings.length; i++) {
    const binding = bindings[i];
    if (binding.type === 'MOUSE_CLICK') {
      if (binding.button !== button || !isBindingActive(binding)) continue;
      const hit = raycastTargets(e, binding.targets, binding);
      if (hit) binding.fn(e, hit);
      continue;
    }
    if (binding.type === 'MOUSE_DBLCLICK' && binding.button === 'RIGHT' && button === 'RIGHT') {
      if (!isBindingActive(binding)) continue;
      // The native dblclick event only fires for the left button, so time right clicks here
      const lastTime = lastRightClickTimes.get(binding.id);
      const maxInterval = binding.maxIntervalMs ?? DEFAULT_DBLCLICK_MAX_INTERVAL_MS;
      if (lastTime !== undefined && timeNow - lastTime <= maxInterval) {
        lastRightClickTimes.delete(binding.id); // a third click starts a new pair
        fireDblClick(binding, e);
      } else {
        lastRightClickTimes.set(binding.id, timeNow);
      }
    }
  }
};

const onDblClick = (e: MouseEvent) => {
  if (e.target !== canvas) return;
  for (let i = 0; i < bindings.length; i++) {
    const binding = bindings[i];
    if (binding.type !== 'MOUSE_DBLCLICK' || binding.button !== 'LEFT') continue;
    if (isBindingActive(binding)) fireDblClick(binding, e);
  }
};

const onWheel = (e: WheelEvent) => {
  if (e.target !== canvas) return;
  mouseActionSource?.onWheel(e);
  for (let i = 0; i < bindings.length; i++) {
    const binding = bindings[i];
    if (binding.type === 'MOUSE_WHEEL' && isBindingActive(binding)) binding.fn(e);
  }
};

const onMouseMove = (e: MouseEvent) => {
  lastMoveEvent = e;
  pointerOverCanvas = e.target === canvas;
  hoverDirty = true;
  if (mouseActionSource && (pointerOverCanvas || document.pointerLockElement)) {
    mouseActionSource.onMove(e);
  }
};

const onPointerLeaveWindow = () => {
  pointerOverCanvas = false;
  hoverDirty = true;
};

const onContextMenu = (e: MouseEvent) => {
  // The browser's context menu would swallow right clicks meant for the scene
  if (e.target !== canvas) return;
  const hasRightBinding =
    bindings.some(
      (b) => (b.type === 'MOUSE_CLICK' || b.type === 'MOUSE_DBLCLICK') && b.button === 'RIGHT'
    ) || !!mouseActionSource?.usesRightButton();
  if (hasRightBinding) e.preventDefault();
};

const clearHover = (binding: MouseHoverBinding, callOnLeave: boolean) => {
  if (!hoveredUuids.has(binding.id)) return;
  hoveredUuids.delete(binding.id);
  if (callOnLeave && lastMoveEvent) binding.onLeave?.(lastMoveEvent);
};

/** Resolves hover state at most once per frame, and only on frames the pointer moved
 * (mousemove fires far more often than frames render). */
const hoverSystem = () => {
  // The master switch (InputState.ts) can't flag hover dirty itself, so notice its changes here
  const allEnabled = areAppInputsEnabled();
  if (allEnabled !== hoverAllInputsEnabled) {
    hoverAllInputsEnabled = allEnabled;
    hoverDirty = true;
  }
  if (!hoverDirty) return;
  hoverDirty = false;
  const e = lastMoveEvent;
  if (!e) return;

  for (let i = 0; i < bindings.length; i++) {
    const binding = bindings[i];
    if (binding.type !== 'MOUSE_HOVER') continue;
    if (binding.sceneId && binding.sceneId !== getCurrentSceneId()) {
      // Its scene is gone, so its objects likely are too: forget the hover without callbacks
      clearHover(binding, false);
      continue;
    }
    if (!isBindingActive(binding)) {
      clearHover(binding, true);
      continue;
    }

    const hit = pointerOverCanvas
      ? raycastTargets(e, binding.targets, binding, hoverIntersects)
      : undefined;
    const prevUuid = hoveredUuids.get(binding.id);
    if (hit?.object.uuid === prevUuid) continue;
    clearHover(binding, true);
    if (hit) {
      hoveredUuids.set(binding.id, hit.object.uuid);
      binding.onEnter?.(e, hit);
    }
  }
  hoverIntersects.length = 0;
};

const initHoverSystem = () => {
  const world = getECSWorld();
  if (hoverSystemWorld === world) return;
  hoverSystemWorld = world;
  world.addSystem(ECSSystemStage.MAIN, HOVER_SYSTEM_ID, hoverSystem);
};

const clearPresses = () => {
  for (const button of MOUSE_BUTTONS) delete pressStarts[button];
  lastRightClickTimes.clear();
  onPointerLeaveWindow();
  mouseActionSource?.onButton(null);
};

/** Adds the listeners by the input scope (InputState.ts): on the window, on the canvas, or none. */
const initMouseListeners = () => {
  if (listenersInitiated) return;
  listenersInitiated = true;
  // Also in the NONE scope, so a removal resets it
  addInputListenerRemover(removeMouseListeners);
  const scope = getInputScope();
  if (scope === 'NONE') return;
  const canvasElem = getCanvasElem();
  canvas = canvasElem;
  const target: Window | HTMLElement = scope === 'CANVAS' ? canvasElem : window;
  const leaveTarget = scope === 'CANVAS' ? canvasElem : document.documentElement;
  const listeners: [EventTarget, string, EventListener][] = [
    [target, 'mousedown', onMouseDown as EventListener],
    // On the window in either scope (it changes nothing on the page): a press made on the canvas
    // ends wherever it's released
    [window, 'mouseup', onMouseUp as EventListener],
    [target, 'dblclick', onDblClick as EventListener],
    [target, 'wheel', onWheel as EventListener],
    [target, 'mousemove', onMouseMove as EventListener],
    [target, 'contextmenu', onContextMenu as EventListener],
    [leaveTarget, 'mouseleave', onPointerLeaveWindow],
  ];
  for (const [elem, type, fn] of listeners) elem.addEventListener(type, fn);
  const removeBlurListener = onWindowBlur(clearPresses);
  removeListeners = () => {
    for (const [elem, type, fn] of listeners) elem.removeEventListener(type, fn);
    removeBlurListener();
  };
};

/** Removes the mouse listeners and clears the presses and the hover (the mount's unmount, through
 * InputState.ts). The next binding or action source adds them again, by the input scope then. */
const removeMouseListeners = (): void => {
  removeListeners?.();
  removeListeners = null;
  clearPresses();
  lastMoveEvent = null;
  canvas = null;
  listenersInitiated = false;
};

/**
 * Registers a mouse binding, replacing the one with its id. The first binding adds the pointer
 * listeners (on the window, or on the canvas in an embed's `CANVAS` input scope), and the first
 * `MOUSE_HOVER` one the hover system, which resolves it against the pointer right away.
 * @remarks The binding is kept as given (not copied): {@link setMouseBindingEnabled} writes its
 * `enabled`.
 * @example
 * ```ts
 * createMouseBinding({
 *   id: 'pickCrate',
 *   type: 'MOUSE_CLICK',
 *   button: 'LEFT',
 *   targets: () => crates,
 *   fn: (_e, hit) => selectCrate(hit.object),
 * });
 * ```
 */
export const createMouseBinding = (binding: MouseBinding): void => {
  deleteMouseBinding(binding.id);
  bindings.push(binding);
  initMouseListeners();
  if (binding.type === 'MOUSE_HOVER') {
    initHoverSystem();
    hoverDirty = true; // resolve against the current pointer position right away
  }
};

/** Removes a mouse binding (a no-op for an unknown id). The pointer listeners stay. */
export const deleteMouseBinding = (id: string): void => {
  bindings = bindings.filter((b) => b.id !== id);
  hoveredUuids.delete(id);
  lastRightClickTimes.delete(id);
};

/**
 * Sets (null removes) the action layer's mouse source, and adds the window listeners.
 * @internal
 */
export const setMouseActionSource = (source: MouseActionSource | null): void => {
  mouseActionSource = source;
  if (source) initMouseListeners();
};

/**
 * Whether a button is held after a press on the canvas.
 * @internal
 */
export const isMouseButtonHeld = (button: MouseButton): boolean =>
  pressStarts[button] !== undefined;

/**
 * Turns a mouse binding on or off without removing it (warns for an unknown id). A hover binding
 * resolves again on the next frame: an off one leaves its object, an on one enters it.
 * @remarks It writes `enabled` on the binding object passed to {@link createMouseBinding}, which
 * is kept as given: a binding object shared by two calls changes for both.
 */
export const setMouseBindingEnabled = (id: string, enabled: boolean): void => {
  const binding = bindings.find((b) => b.id === id);
  if (!binding) {
    lwarn(`Could not find mouse binding with id "${id}" in setMouseBindingEnabled.`);
    return;
  }
  binding.enabled = enabled;
  if (binding.type === 'MOUSE_HOVER') hoverDirty = true; // fire onLeave / re-enter next frame
};
