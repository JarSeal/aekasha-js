// The PostFX passes' overrides in localStorage (`AEK_debugPostFx`): the PostFX tab's and its save
// source's (p355).
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
