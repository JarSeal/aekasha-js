// The master input switches every device (keyboard, mouse, touch, gamepad) and the action
// layer's contexts read, the input scope and the listener removers. Lives in its own tiny file so
// engine code that only needs to pause input (e.g. SceneLoader.ts during a scene load) doesn't
// pull any device module into the bundle.

let allInputsEnabled = true;
let appInputsSuspended = false;

/**
 * Enables/disables every input at once: the key, mouse and touch bindings and every action map,
 * the `DEBUG` context's included (the gamepad is read only through maps). The scene loader's
 * switch over a load.
 * @internal
 */
export const setAllInputsEnabled = (enabled: boolean): void => {
  allInputsEnabled = enabled;
};

/**
 * Whether every input is enabled ({@link setAllInputsEnabled}): read by the devices and the action
 * layer.
 * @internal
 */
export const areAllInputsEnabled = (): boolean => allInputsEnabled;

/**
 * Suspends the app's input bindings (keyboard, mouse, touch) while an editor view is active
 * (Views.ts). Debug key bindings (`isDebugKey`) keep running. Apart from
 * {@link setAllInputsEnabled}, so a scene load's re-enable at its end doesn't lift it.
 * @internal
 */
export const setAppInputsSuspended = (suspended: boolean): void => {
  appInputsSuspended = suspended;
};

/**
 * Whether an editor view suspends the app's inputs ({@link setAppInputsSuspended}): read by the
 * keyboard's debug keys.
 * @internal
 */
export const areAppInputsSuspended = (): boolean => appInputsSuspended;

/**
 * Whether the app's input bindings run: every input is enabled and no editor view suspends them.
 * Read by the devices and the action layer.
 * @internal
 */
export const areAppInputsEnabled = (): boolean => allInputsEnabled && !appInputsSuspended;

/**
 * Where the input devices listen (p611 D6). `WINDOW`: the whole page (the full-page boot,
 * `InitEngine`). `CANVAS`: the canvas only, for an engine mounted into a page it doesn't own
 * (`mountAekasha`): the pointer and touch events on the canvas, the keys while it has focus (it
 * gets a `tabindex`), the gamepads too. `NONE`: no listeners at all, so the bindings and action
 * maps never fire. The mount's `input` option sets it.
 * @internal
 */
export type InputScope = 'WINDOW' | 'CANVAS' | 'NONE';

let inputScope: InputScope = 'WINDOW';

/**
 * Sets where the input devices listen. A device reads it when it adds its listeners (its first
 * binding or action source), so set it before: the mount does, before the boot.
 * @internal
 */
export const setInputScope = (scope: InputScope): void => {
  inputScope = scope;
};

/**
 * Where the input devices listen.
 * @internal
 */
export const getInputScope = (): InputScope => inputScope;

const listenerRemovers = new Set<() => void>();

/**
 * Registers a device's listener remover (a device adds its own when it adds its listeners), so
 * an unmount removes every device's listeners without importing any device module.
 * @internal
 */
export const addInputListenerRemover = (remove: () => void): void => {
  listenerRemovers.add(remove);
};

/**
 * Removes every device's listeners and clears their held state (the mount's unmount). A device
 * adds them again on its next binding or action source.
 * @internal
 */
export const removeAllInputListeners = (): void => {
  const removers = [...listenerRemovers];
  listenerRemovers.clear();
  for (const remove of removers) remove();
};
