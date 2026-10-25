/**
 * The Hub's stand-in for the engine's `utils/LocalAndSessionStorage.ts` (p802 Phase 4,
 * `devTools/hub/kitStandIns.ts`): the UI kit's storage in memory. The dev Hub is served by the
 * app's dev server, so it shares the app's `localStorage`, and the draggable windows write their
 * whole saved state on every finished change (`AEK_popupWindows`): a demo window moved in the Hub
 * would replace the app's saved windows.
 *
 * It exports only the names the bundled modules import (the kit's window store, `Config.ts`), and
 * converts the values as the engine's does: a new name fails the Hub's script build (a missing
 * export). The values are `unknown`: tsc checks the callers against the engine's module, not this.
 */

const items = new Map<string, string>();

/**
 * A stored value converted to `defaultValue`'s type, or `defaultValue || null`, as the engine's
 * @param key its key
 * @param defaultValue what a missing key gives; its type is what the stored text converts to
 * @param doNotConvert the stored text as it is
 */
export const lsGetItem = (key: string, defaultValue: unknown, doNotConvert?: boolean) => {
  const rawValue = items.get(key);
  if (rawValue === undefined) return defaultValue || null;
  if (doNotConvert) return rawValue;
  if (typeof defaultValue === 'boolean') return rawValue === 'true';
  if (typeof defaultValue === 'number') return Number(rawValue);
  if (typeof defaultValue === 'object' && defaultValue !== null) return JSON.parse(rawValue);
  return rawValue;
};

/**
 * Stores a value (an object or array as JSON), as the engine's
 * @param key its key
 * @param value what's stored
 */
export const lsSetItem = (key: string, value: unknown) => {
  items.set(
    key,
    typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value)
  );
};
