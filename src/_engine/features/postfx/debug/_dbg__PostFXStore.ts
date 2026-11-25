// The PostFX tab's localStorage: the passes' overrides (`AEK_debugPostFx`) and the settings
// (`AEK_debugPostFxSettings`), the tab's and its save sources' (p355).
import { lsGetItem, lsRemoveItem, lsSetItem } from '../../../utils/LocalAndSessionStorage';

/** One PostFX pass's deviations from its authored state. */
export type PostFxPassOverride = { enabled?: boolean; params?: Record<string, unknown> };

/** The structure of 'AEK_debugPostFx' in LocalStorage. Only deviations from the authored
 * PostFX passes (the scene's latest save entry included) are stored, and empty pass / scene
 * entries are pruned. */
export type PostFxPassesLSData = {
  [sceneId: string]: { [postFxPassId: string]: PostFxPassOverride };
};

/** The PostFX passes' overrides' LocalStorage key */
export const LS_KEY = 'AEK_debugPostFx';

/** Every scene's PostFX pass overrides */
export const readPassesLS = () => lsGetItem(LS_KEY, {}) as PostFxPassesLSData;

/** Writes the overrides, dropping empty scenes (the key itself when nothing is left) */
export const writePassesLSOrRemove = (data: PostFxPassesLSData) => {
  for (const sceneId of Object.keys(data)) {
    if (!Object.keys(data[sceneId] || {}).length) delete data[sceneId];
  }
  if (Object.keys(data).length) lsSetItem(LS_KEY, data);
  else lsRemoveItem(LS_KEY);
};

/** The structure of 'AEK_debugPostFxSettings' in LocalStorage. Only deviations are stored:
 * a scene missing from postFxEnabled means "as authored" (the scene's postFxEnabled, its latest
 * save entry included), a missing measureEnabled means "as configured"
 * (AppConfig.postFx.measureEnabled). */
export type PostFxSettingsLSData = {
  measureEnabled?: boolean;
  postFxEnabled?: { [sceneId: string]: boolean };
};

/** The PostFX tab's settings' LocalStorage key */
export const SETTINGS_LS_KEY = 'AEK_debugPostFxSettings';

/** The PostFX tab's settings: the measuring and each scene's PostFX switch */
export const readSettingsLS = () => lsGetItem(SETTINGS_LS_KEY, {}) as PostFxSettingsLSData;

/** Writes the settings, dropping an empty `postFxEnabled` (the key itself when nothing is left) */
export const writeSettingsLSOrRemove = (data: PostFxSettingsLSData) => {
  if (data.postFxEnabled && !Object.keys(data.postFxEnabled).length) delete data.postFxEnabled;
  if (Object.keys(data).length) lsSetItem(SETTINGS_LS_KEY, data);
  else lsRemoveItem(SETTINGS_LS_KEY);
};
