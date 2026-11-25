// The PostFX save sources (p355 §2.1): the overrides `AEK_debugPostFx` keeps per scene and pass
// are a delta over the pass as authored (the scene's latest save entry in it), so the saved entry
// is that latest entry with the delta over it, `params` one level deeper (the gather's merge),
// without the values the file has already. A scene's PostFX switch (`AEK_debugPostFxSettings`'
// `postFxEnabled`, p355 §2.5) goes into its scene JSON's own entry the same way.
import { registerSaveSource, type SaveChange } from '../../../debug/SaveData';
import {
  findSceneAssetFile,
  findSceneFile,
  getChangedKeys,
  getLatestSaveEntry,
  pruneSaveEntry,
  toSaveEntryWrite,
} from '../../../debug/_dbg__SaveEntries';
import {
  readPassesLS,
  readSettingsLS,
  writePassesLSOrRemove,
  writeSettingsLSOrRemove,
  type PostFxPassOverride,
} from './_dbg__PostFXStore';

/** The PostFX passes' save source's id */
export const POSTFX_SAVE_SOURCE_ID = 'postFx';
/** The scenes' PostFX switch's save source's id */
export const POSTFX_ENABLED_SAVE_SOURCE_ID = 'postFxEnabled';

/** Each collected change's scene and pass, for `onSaved` */
const changeKeys = new WeakMap<SaveChange, { sceneId: string; postFxPassId: string }>();

/** The latest entry with the override over it: `enabled` replaced, `params` merged by key */
const mergeEntry = (latest: Record<string, unknown>, override: PostFxPassOverride) => {
  const entry: Record<string, unknown> = { ...latest };
  if (override.enabled !== undefined) entry.enabled = override.enabled;
  if (override.params) {
    entry.params = {
      ...(latest.params as Record<string, unknown> | undefined),
      ...override.params,
    };
  }
  return entry;
};

/** A file's pass as the gather reads it without a save entry (`enabled` defaults to true) */
const getFilePass = (json: unknown) => {
  const { __saveData: _saveData, ...pass } = json as { __saveData?: unknown; enabled?: boolean };
  return { ...pass, enabled: pass.enabled ?? true };
};

const collectPostFxChanges = (): SaveChange[] => {
  const changes: SaveChange[] = [];
  for (const [sceneId, passes] of Object.entries(readPassesLS())) {
    for (const [postFxPassId, override] of Object.entries(passes)) {
      const file = findSceneAssetFile(
        { list: 'postFx', registry: 'postFx' },
        sceneId,
        postFxPassId
      );
      const change: SaveChange = {
        id: `${sceneId}:${postFxPassId}`,
        label: `PostFX pass "${postFxPassId}"`,
        scope: 'SCENE',
        sceneId,
        path: 'path' in file ? file.path : null,
        ...('unsaveable' in file ? { unsaveable: file.unsaveable } : {}),
        summary: getChangedKeys(override),
        build: ({ json }) => {
          const latest = getLatestSaveEntry(json, sceneId) ?? {};
          const entry = pruneSaveEntry(mergeEntry(latest, override), getFilePass(json));
          return toSaveEntryWrite(json, sceneId, entry);
        },
      };
      changeKeys.set(change, { sceneId, postFxPassId });
      changes.push(change);
    }
  }
  return changes;
};

/** Registers the PostFX passes' save source (the PostFX tab's creation). */
export const registerPostFxSaveSource = () =>
  registerSaveSource({
    id: POSTFX_SAVE_SOURCE_ID,
    label: 'PostFX passes',
    collect: collectPostFxChanges,
    onSaved: (changes) => {
      const data = readPassesLS();
      for (const change of changes) {
        const keys = changeKeys.get(change);
        if (keys && data[keys.sceneId]) delete data[keys.sceneId][keys.postFxPassId];
      }
      writePassesLSOrRemove(data);
    },
  });

/** Each collected PostFX switch change's scene, for `onSaved` */
const enabledChangeScenes = new WeakMap<SaveChange, string>();

/**
 * The scene's latest entry with the switch in it: none when it's the file's own value (the
 * scene's `postFxEnabled`, true by default), so an entry holds it only as an override.
 */
const buildEnabledEntry = (json: unknown, sceneId: string, enabled: boolean) => {
  const { postFxEnabled: _latest, ...entry } = getLatestSaveEntry(json, sceneId) ?? {};
  if (enabled !== ((json as { postFxEnabled?: boolean }).postFxEnabled ?? true)) {
    entry.postFxEnabled = enabled;
  }
  return toSaveEntryWrite(json, sceneId, entry);
};

const collectPostFxEnabledChanges = (): SaveChange[] =>
  Object.entries(readSettingsLS().postFxEnabled ?? {}).map(([sceneId, enabled]) => {
    const file = findSceneFile(sceneId);
    const change: SaveChange = {
      id: sceneId,
      label: `PostFX switched ${enabled ? 'on' : 'off'}`,
      scope: 'SCENE',
      sceneId,
      path: 'path' in file ? file.path : null,
      ...('unsaveable' in file ? { unsaveable: file.unsaveable } : {}),
      summary: ['postFxEnabled'],
      build: ({ json }) => buildEnabledEntry(json, sceneId, enabled),
    };
    enabledChangeScenes.set(change, sceneId);
    return change;
  });

/** Registers the scenes' PostFX switch's save source (the PostFX tab's creation). */
export const registerPostFxEnabledSaveSource = () =>
  registerSaveSource({
    id: POSTFX_ENABLED_SAVE_SOURCE_ID,
    label: 'PostFX switches',
    collect: collectPostFxEnabledChanges,
    onSaved: (changes) => {
      const data = readSettingsLS();
      for (const change of changes) {
        const sceneId = enabledChangeScenes.get(change);
        if (sceneId !== undefined) delete data.postFxEnabled?.[sceneId];
      }
      writeSettingsLSOrRemove(data);
    },
  });
