// NOTE! Type-only file: everything here is erased at build time (as InputSharedTypes.ts).
import type { GamepadAxisName, GamepadButtonName, GamepadStickName } from './GamepadInput';
import type { EnabledInDebugCam } from './InputSharedTypes';
import type { KeyChord } from './KeyboardInput';
import type { MouseButton } from './MouseInput';

/**
 * What an action reports (see {@link ActionState} for each one's fields):
 * - `BUTTON`: on or off (jump, interact, a toggle).
 * - `AXIS_1D`: -1 to 1 (throttle, zoom in and out).
 * - `AXIS_2D`: a direction of length 0 to 1, right and up positive (move, a stick's look rate).
 * - `DELTA_2D`: movement summed since the previous sample, right and up positive (mouse look, a
 *   touch drag, the wheel).
 */
export type ActionType = 'BUTTON' | 'AXIS_1D' | 'AXIS_2D' | 'DELTA_2D';

/** One action of a map: its type, and metadata for UI (a shortcuts list, a rebinding screen). */
export type ActionDef = {
  type: ActionType;
  /** A readable name ("Jump"). */
  name?: string;
  description?: string;
  /** Raw SVG strings, the same convention as `ui/icons/SvgIcon.ts`. */
  icons?: readonly string[];
};

/** A map's actions by id. */
export type ActionDefs = { readonly [actionId: string]: ActionDef };

/**
 * A set of maps enabled or suspended together
 * ({@link _engine/kernel/input/Actions!setActionContextEnabled}):
 * - `GAMEPLAY` (a map's default): suspended in editor views and during a scene load, and while the
 *   debug camera is on unless the map's `enabledInDebugCam` allows it.
 * - `DEBUG`: the engine's and the app's debug keys; runs in every view, off during a scene load.
 * - Any other name is the app's own (`'MENU'`, `'VEHICLE'`), and behaves like `GAMEPLAY`.
 */
export type ActionContext = 'GAMEPLAY' | 'DEBUG' | (string & {});

/** Keys: `KeyboardEvent.key` values (case-insensitive), or chords; any of them triggers it. */
export type ActionKeys = readonly (string | KeyChord)[];

/** The fields every keyboard binding has. */
export type KeyActionBindingBase = {
  device: 'KEYBOARD';
  /** Match the keys whatever modifiers are held (a chord's own modifiers are ignored too).
   * Default: the map's `ignoreModifiers`. */
  ignoreModifiers?: boolean;
};

/** A `BUTTON` on keys: down while any of them is held. */
export type KeyActionBinding = KeyActionBindingBase & { keys: ActionKeys };

/** An `AXIS_1D` on two sets of keys: -1, 0 or 1. */
export type KeyAxisActionBinding = KeyActionBindingBase & {
  negative: ActionKeys;
  positive: ActionKeys;
};

/** An `AXIS_2D` on four sets of keys (W/A/S/D, the arrows); a diagonal has length 1 too. */
export type KeyCompositeActionBinding = KeyActionBindingBase & {
  up: ActionKeys;
  down: ActionKeys;
  left: ActionKeys;
  right: ActionKeys;
};

/** A `BUTTON` on a mouse button pressed on the canvas (released anywhere). */
export type MouseButtonActionBinding = { device: 'MOUSE'; button: MouseButton };

/** A `DELTA_2D` on the mouse: `MOVE` over the canvas (or while the pointer is locked), in CSS
 * pixels, or the `WHEEL` over the canvas, in pixels (a line is 16). */
export type MouseDeltaActionBinding = {
  device: 'MOUSE';
  delta: 'MOVE' | 'WHEEL';
  /** Multiplies the delta (default 1). */
  scale?: number;
};

/** A `BUTTON` on a tap on the canvas: a press and a release in the same sample, never held. */
export type TouchTapActionBinding = { device: 'TOUCH'; gesture: 'TAP' };

/** A `DELTA_2D` on a one-finger drag that started on the canvas, in CSS pixels. */
export type TouchDragActionBinding = {
  device: 'TOUCH';
  gesture: 'DRAG';
  /** Multiplies the delta (default 1). */
  scale?: number;
};

/** A `BUTTON` on a gamepad button (an analog trigger reports its value, down past the browser's
 * threshold). */
export type GamepadButtonActionBinding = { device: 'GAMEPAD'; button: GamepadButtonName };

/** An `AXIS_1D` on one stick axis. */
export type GamepadAxisActionBinding = {
  device: 'GAMEPAD';
  axis: GamepadAxisName;
  /** Below this the axis reads 0, and above it the rest is rescaled to 0-1 (default 0.15). */
  deadzone?: number;
  /** Flips the axis (default false). */
  invert?: boolean;
};

/** An `AXIS_2D` on a stick or the d-pad. */
export type GamepadStickActionBinding = {
  device: 'GAMEPAD';
  stick: GamepadStickName;
  /** A radial deadzone: below this length the stick reads 0, and above it the rest is rescaled to
   * 0-1 (default 0.15; the d-pad has none). */
  deadzone?: number;
};

/** The bindings an action of type `T` takes. */
export type ActionBindingOf<T extends ActionType> = T extends 'BUTTON'
  ? KeyActionBinding | MouseButtonActionBinding | TouchTapActionBinding | GamepadButtonActionBinding
  : T extends 'AXIS_1D'
    ? KeyAxisActionBinding | GamepadAxisActionBinding
    : T extends 'AXIS_2D'
      ? KeyCompositeActionBinding | GamepadStickActionBinding
      : T extends 'DELTA_2D'
        ? MouseDeltaActionBinding | TouchDragActionBinding
        : never;

/** Any action binding. Plain data, so an app's config can override a map's bindings. */
export type ActionBinding = ActionBindingOf<ActionType>;

/** A map's bindings by action id, each checked against its action's type. */
export type ActionBindings<TActions extends ActionDefs> = {
  [K in keyof TActions]?: readonly ActionBindingOf<TActions[K]['type']>[];
};

/**
 * An action as the last sample saw it (see {@link ActionMap.read}). Every type has every field:
 * - `BUTTON`: `isDown` while held; `value` 1 while held (a trigger's analog value); the counts are
 *   the presses and releases since the previous sample. A new keydown of one of its keys while it's
 *   held counts as a press too (another of its keys, or macOS's lost keyups while ⌘ is held), so
 *   `pressedCount` can be higher than `releasedCount`.
 * - `AXIS_1D`: `value` -1 to 1; `isDown` when it isn't 0, and the counts are the times it left 0
 *   and came back.
 * - `AXIS_2D`: `x` and `y` (right and up positive), `value` their length (at most 1); `isDown` and
 *   the counts as `AXIS_1D`.
 * - `DELTA_2D`: `x` and `y` summed since the previous sample (right and up positive), `value` their
 *   length; `isDown` when it moved; no counts.
 *
 * With several bindings, a `BUTTON` is down while any is, an axis takes the one pushed furthest,
 * and a delta sums them.
 */
export type ActionState = {
  isDown: boolean;
  pressedCount: number;
  releasedCount: number;
  value: number;
  x: number;
  y: number;
};

/** Called at the device event (a DOM event, the gamepad poll, or a replay's sample): the DOM event,
 * or null without one. */
export type ActionEventFn = (e: Event | null) => void;

/** {@link _engine/kernel/input/Actions!createActionMap}'s options. */
export type ActionMapOpts<TActions extends ActionDefs> = {
  /** Unique: a second map with the same id replaces the first. */
  id: string;
  /** The context that enables or suspends it (default `GAMEPLAY`). */
  context?: ActionContext;
  actions: TActions;
  /** Each action's bindings (none: it reads idle until {@link ActionMap.setBindings}). */
  bindings?: ActionBindings<TActions>;
  /** Active only while this scene is the current one. */
  sceneId?: string;
  /** Whether it runs while the debug camera is on (debug env only). Default
   * `NOT_ENABLED_IN_DEBUG`, in the `DEBUG` context `ENABLED_IN_DEBUG`. */
  enabledInDebugCam?: EnabledInDebugCam;
  /** The keyboard bindings' default (default true, in the `DEBUG` context false): gameplay keys
   * keep working while Shift or Ctrl is held for another action. */
  ignoreModifiers?: boolean;
  /** Calls `preventDefault()` on a key press one of its keyboard bindings matches while it's
   * active (default true, in the `DEBUG` context false), so Space doesn't scroll the page or click
   * a focused button. Never in a text field, and a binding that ignores modifiers never for a key
   * pressed with Ctrl, Alt or Meta (copy, paste, back stay the browser's). */
  preventDefault?: boolean;
  /** Read only this gamepad (`Gamepad.index`). Default: any, the most pushed one for an axis. */
  gamepadIndex?: number;
  /** Default true (see {@link ActionMap.setEnabled}). */
  enabled?: boolean;
};

/**
 * Actions read from devices through bindings: what gameplay code reads instead of keys. Made by
 * {@link _engine/kernel/input/Actions!createActionMap}. Its members are methods, so a map of any
 * actions is an `ActionMap`.
 * @template TActions the map's action definitions, which type its action ids and bindings
 */
export type ActionMap<TActions extends ActionDefs = ActionDefs> = {
  /** Its id (`getActionMap`). */
  readonly id: string;
  /** The context that enables or suspends it. */
  readonly context: ActionContext;
  /** The scene it's active in (undefined: every scene). */
  readonly sceneId: string | undefined;
  /** Whether it runs while the debug camera is on (debug env only). */
  readonly enabledInDebugCam: EnabledInDebugCam;
  /** Its action definitions, as given (names and icons for UI). */
  readonly actions: TActions;
  /**
   * The action at the last sample, taken right before each fixed step (once per frame without
   * stepping): what the simulation reads. The same object every time, updated in place.
   */
  read(actionId: Extract<keyof TActions, string>): Readonly<ActionState>;
  /**
   * Calls `fn` when the action goes down (a `BUTTON` pressed, a key of a held one pressed again, an
   * axis leaving 0), at the device event, also while the loop is paused: what UI and debug keys
   * use.
   * @returns removes the callback
   */
  onPressed(actionId: Extract<keyof TActions, string>, fn: ActionEventFn): () => void;
  /**
   * Calls `fn` when the action goes up, at the device event (see {@link ActionMap.onPressed}).
   * @returns removes the callback
   */
  onReleased(actionId: Extract<keyof TActions, string>, fn: ActionEventFn): () => void;
  /** An action's bindings, as given (or as {@link ActionMap.setBindings} replaced them). */
  getBindings<K extends Extract<keyof TActions, string>>(
    actionId: K
  ): readonly ActionBindingOf<TActions[K]['type']>[];
  /** Replaces an action's bindings (rebinding); a held binding it drops releases the action. */
  setBindings<K extends Extract<keyof TActions, string>>(
    actionId: K,
    bindings: readonly ActionBindingOf<TActions[K]['type']>[]
  ): void;
  /** Off, it reads idle and fires no callbacks, as an inactive context. */
  setEnabled(enabled: boolean): void;
  /** Whether devices drive it now: enabled, its context enabled, the inputs on, its scene the
   * current one and the debug camera rule met. */
  isActive(): boolean;
  /** Removes it: its callbacks, a recording and a replay on it end. */
  delete(): void;
};

/** An action's state in a recorded frame: only the fields that aren't idle (false or 0). */
export type ActionFrameState = Partial<ActionState>;

/** One sample of a map: the actions that weren't idle, by id. */
export type ActionFrame = {
  /** The fixed step it was sampled for (a sample count without physics stepping). */
  step: number;
  actions: { [actionId: string]: ActionFrameState };
};

/** A map's samples, plain data (JSON): a replay, a test's input, a network peer's input. */
export type ActionRecording = {
  mapId: string;
  /** The first step sampled (default: the first frame's). */
  firstStep?: number;
  /** The last step sampled (default: the last frame's): idle steps at the end replay too. */
  lastStep?: number;
  /** In step order; a step without a frame was idle. */
  frames: ActionFrame[];
};
