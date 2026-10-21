import { IS_DEBUG_ENV } from '../kernel/config/Config';
import type { DebugModuleRef } from '../kernel/config/DebugModules';
import { loadDebugModuleAsync, useDebug } from '../kernel/config/DebugModules';

/**
 * One recorded debugger action. Entries are persisted to LocalStorage, so everything in
 * here (payload included) must be plain JSON-serializable data: ids, field names,
 * prev/next values. No object references, no functions. The undo / redo implementation's.
 * @internal
 */
export type UndoRedoEntry<TPayload = unknown> = {
  /** The entry's own id */
  id: string;
  /** Namespaced action type (e.g. 'camera.setTransform'), used to look up the handler. */
  actionType: string;
  /** Human-readable label for a history list UI. */
  label: string;
  /** Strictly increasing; orders the merged scene + global timeline. */
  timestamp: number;
  /** What the handler applies, as recorded */
  payload: TPayload;
  /** Set by {@link recordOrCoalesceUndoRedoAction}: ticks with the same key merge into this entry. */
  coalesceKey?: string;
};

/**
 * Where an action type's entries are kept. 'perScene' entries are only undoable while their
 * scene is current; 'global' entries (settings that aren't scene data, e.g. the renderer's) are
 * undoable in every scene. Undo/redo walk both as one timeline, ordered by timestamp.
 */
export type UndoRedoScope = 'perScene' | 'global';

/**
 * Applies an action type's payload in either direction, for
 * {@link registerUndoRedoActionHandler}.
 * @template TPayload the payload the action type records
 */
export type UndoRedoActionHandler<TPayload = unknown> = {
  /** Puts back the state before the action (eg. its `prev`) */
  undo: (payload: TPayload) => void;
  /** Applies the action again (eg. its `next`) */
  redo: (payload: TPayload) => void;
};

/**
 * One bucket's history (a scene's or the global one): the undo / redo implementation's.
 * @internal
 */
export type UndoRedoHistoryState = {
  entries: UndoRedoEntry[];
  /** Index of the last applied entry, -1 = nothing applied. */
  pointer: number;
};

/**
 * One entry of the merged history returned by {@link getUndoRedoHistory}. The Debug tools tab's
 * history list reads it.
 * @internal
 */
export type UndoRedoHistoryEntry = UndoRedoEntry & {
  scope: UndoRedoScope;
  /** False when the entry has been undone (redo would reapply it). */
  applied: boolean;
};

/**
 * Which history {@link clearUndoRedoHistory} clears: the current scene's, or every scene's and the
 * global one.
 * @internal
 */
export type UndoRedoClearScope = 'currentScene' | 'all';

/**
 * Debugger undo/redo settings, persisted to LocalStorage once changed in the debugger. The Debug
 * tools tab's.
 * @internal
 */
export type UndoRedoSettings = {
  /** Max number of history entries kept per bucket (each scene's and the global one). Min 1,
   * defaults to `AppConfig.undoRedo.historySize`. */
  historySize: number;
  /** Whether each undo/redo shows an info toast (in the debug toaster). Default true. */
  showToasts: boolean;
};

type UndoRedoModule = typeof import('./_dbg__UndoRedo');
let debugGUI: DebugModuleRef<UndoRedoModule> | null = null;

/**
 * Loads the undo / redo implementation (debug env): the boot's debug step.
 * @internal
 */
export const registerUndoRedoModule = async () => {
  if (!IS_DEBUG_ENV) return;
  debugGUI = await loadDebugModuleAsync(() => import('./_dbg__UndoRedo'));
};

/**
 * Loads the persisted history from LocalStorage. The boot calls it.
 * @internal
 */
export const initUndoRedo = () => {
  useDebug(debugGUI)?._initUndoRedo();
};

/**
 * An action type's handler and scope, as registered.
 * @internal
 */
export type RegisteredUndoRedoActionHandler = UndoRedoActionHandler & { scope: UndoRedoScope };

// Kept here, not in the implementation, so a handler registered before it loads (eg. in a
// feature's install, which runs before the boot's debug step) still works
const actionHandlers = new Map<string, RegisteredUndoRedoActionHandler>();

/**
 * Registers the undo / redo handler for an action type (registering the type again replaces it).
 * Works at any time, also before the debugger has loaded (eg. in a feature's `install`); a no-op
 * in a production build.
 * @param actionType a namespaced name, eg. `'myGame.speed'`
 * @param scope where its entries are kept (default `'perScene'`)
 * @remarks Register it before an undo can reach one of its entries: the history is saved in
 * LocalStorage, so after a reload an entry can be older than the module that registers its
 * handler. Undo stops at an entry without a handler (warned) and stays there until the handler
 * exists, since skipping it would apply the rest out of order.
 * @example
 * ```ts
 * import {
 *   createDebuggerTab,
 *   recordOrCoalesceUndoRedoAction,
 *   registerUndoRedoActionHandler,
 *   updateDebuggerTab,
 * } from 'aekasha/debug';
 *
 * const settings = { speed: 1 };
 *
 * registerUndoRedoActionHandler<{ prev: number; next: number }>('myGame.speed', {
 *   undo: ({ prev }) => {
 *     settings.speed = prev;
 *     updateDebuggerTab('myGame');
 *   },
 *   redo: ({ next }) => {
 *     settings.speed = next;
 *     updateDebuggerTab('myGame');
 *   },
 * });
 *
 * createDebuggerTab({
 *   id: 'myGame',
 *   title: 'My game',
 *   icon: 'geometry',
 *   state: settings,
 *   content: () => [
 *     {
 *       pane: true,
 *       content: [
 *         {
 *           key: 'speed',
 *           min: 0,
 *           max: 5,
 *           // One entry per drag: the ticks within 800 ms of each other merge
 *           onChange: (value, e) =>
 *             recordOrCoalesceUndoRedoAction(
 *               'myGame.speed',
 *               'Speed',
 *               { prev: e.prev as number, next: value as number },
 *               'speed'
 *             ),
 *         },
 *       ],
 *     },
 *   ],
 * });
 * ```
 */
export const registerUndoRedoActionHandler = <TPayload>(
  actionType: string,
  handler: UndoRedoActionHandler<TPayload>,
  scope?: UndoRedoScope
) => {
  // Folds the map out of a production build
  if (!__AEK_DEBUG__) return;
  actionHandlers.set(actionType, {
    ...(handler as UndoRedoActionHandler),
    scope: scope ?? 'perScene',
  });
};

/**
 * The handler registered for an action type (the undo / redo implementation).
 * @internal
 */
export const _getUndoRedoActionHandler = (actionType: string) => actionHandlers.get(actionType);

/**
 * Records an already-applied action to its scope's history (the current scene's or the global
 * one), dropping the redo tail of the current scene + global timeline. A no-op outside the debug
 * env and before the boot's debug step.
 * @param actionType a type {@link registerUndoRedoActionHandler} registers
 * @param label the history list's text
 * @param payload plain JSON data (it is saved in LocalStorage): ids, field names, values
 */
export const recordUndoRedoAction = <TPayload>(
  actionType: string,
  label: string,
  payload: TPayload
) => {
  useDebug(debugGUI)?._recordUndoRedoAction(actionType, label, payload);
};

/**
 * Records a tick of a continuous edit (a slider or colour drag, typing): what a binding's
 * `onChange` calls, so a drag is one entry. Ticks with the same `actionType` and `coalesceKey`
 * that arrive within `coalesceWindowMs` of each other merge into one entry that keeps the first
 * tick's `prev` and the latest tick's `next`. A no-op outside the debug env and before the boot's
 * debug step. See {@link registerUndoRedoActionHandler}'s example.
 * @param actionType a type {@link registerUndoRedoActionHandler} registers
 * @param label the history list's text (the first tick's is kept)
 * @param payload plain JSON data with `prev` and `next`
 * @param coalesceKey the edited field, eg. `${appId}.fov`
 * @param coalesceWindowMs the idle time that ends the gesture (default 800)
 */
export const recordOrCoalesceUndoRedoAction = <TPayload extends { prev: unknown; next: unknown }>(
  actionType: string,
  label: string,
  payload: TPayload,
  coalesceKey: string,
  coalesceWindowMs?: number
) => {
  useDebug(debugGUI)?._recordOrCoalesceUndoRedoAction(
    actionType,
    label,
    payload,
    coalesceKey,
    coalesceWindowMs
  );
};

/**
 * Undoes the newest applied action of the current scene + global timeline. The undo key and the
 * on-screen undo button.
 * @internal
 * @returns whether an action was undone
 */
export const undoLastAction = () => useDebug(debugGUI)?._undoLastAction() ?? false;

/**
 * Redoes the oldest undone action of the current scene + global timeline. The redo key and the
 * on-screen redo button.
 * @internal
 * @returns whether an action was redone
 */
export const redoLastAction = () => useDebug(debugGUI)?._redoLastAction() ?? false;

/**
 * Whether there is an applied action to undo in the current scene + global timeline: the on-screen
 * undo button's state.
 * @internal
 */
export const canUndo = () => useDebug(debugGUI)?._canUndo() ?? false;

/**
 * Whether there is an undone action to redo in the current scene + global timeline: the on-screen
 * redo button's state.
 * @internal
 */
export const canRedo = () => useDebug(debugGUI)?._canRedo() ?? false;

/**
 * Returns a copy of the current scene's and the global history, merged and ordered by timestamp. The
 * Debug tools tab's.
 * @internal
 * @returns the entries, or undefined outside the debug env
 */
export const getUndoRedoHistory = () => useDebug(debugGUI)?._getUndoRedoHistory();

/**
 * Returns a copy of the current undo/redo settings. The Debug tools tab's.
 * @internal
 * @returns the settings, or undefined outside the debug env
 */
export const getUndoRedoSettings = () => useDebug(debugGUI)?._getUndoRedoSettings();

/**
 * Sets and persists undo/redo settings (only the given fields). Takes effect immediately: a
 * smaller `historySize` trims every scene's and the global history from the oldest end. The Debug
 * tools tab's.
 * @internal
 * @param settings the settings to change; the others keep their values
 */
export const setUndoRedoSettings = (settings: Partial<UndoRedoSettings>) => {
  useDebug(debugGUI)?._setUndoRedoSettings(settings);
};

/**
 * Clears the history of the current scene or of all scenes. The Debug tools tab's.
 * @internal
 */
export const clearUndoRedoHistory = (scope: UndoRedoClearScope) => {
  useDebug(debugGUI)?._clearUndoRedoHistory(scope);
};
