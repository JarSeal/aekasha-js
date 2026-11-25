// The sky boxes' save source (p355 §2.1): the overrides `AEK_debugSkyBox` keeps per scene and sky
// box are a delta over the definition with the scene's latest save entry in it, so the saved entry
// is that latest entry with the delta deep-merged over it (a whole list replaces, as in the
// gather), without the values the file has already.
import { deepMerge } from '../../../utils/DeepMerge';
import { registerSaveSource, type SaveChange } from '../../../debug/SaveData';
import {
  findSceneAssetFile,
  getChangedKeys,
  getLatestSaveEntry,
  pruneSaveEntry,
  toSaveEntryWrite,
} from '../../../debug/_dbg__SaveEntries';
import { mergeSkyBoxPreset } from '../Presets';
import { getAllSkyBoxOverrides, setSkyBoxOverrides } from './_dbg__SkyBoxShared';

/** The save source's id */
export const SKYBOX_SAVE_SOURCE_ID = 'skyBox';

/** Each collected change's scene and sky box, for `onSaved` */
const changeKeys = new WeakMap<SaveChange, { sceneId: string; skyBoxId: string }>();

/** A file's sky box as the gather reads it without a save entry: its preset merged in */
const getFileDef = (json: unknown) => {
  const { __saveData: _saveData, ...def } = json as { __saveData?: unknown; preset?: string };
  return mergeSkyBoxPreset(def);
};

const collectSkyBoxChanges = (): SaveChange[] => {
  const changes: SaveChange[] = [];
  for (const [sceneId, skyBoxes] of Object.entries(getAllSkyBoxOverrides())) {
    for (const [skyBoxId, overrides] of Object.entries(skyBoxes)) {
      const file = findSceneAssetFile(
        { list: 'skyboxes', registry: 'skyboxes' },
        sceneId,
        skyBoxId
      );
      const change: SaveChange = {
        id: `${sceneId}:${skyBoxId}`,
        label: `Sky box "${skyBoxId}"`,
        scope: 'SCENE',
        sceneId,
        path: 'path' in file ? file.path : null,
        ...('unsaveable' in file ? { unsaveable: file.unsaveable } : {}),
        summary: getChangedKeys(overrides),
        build: ({ json }) => {
          const latest = getLatestSaveEntry(json, sceneId) ?? {};
          const entry = pruneSaveEntry(deepMerge(latest, overrides), getFileDef(json));
          return toSaveEntryWrite(json, sceneId, entry);
        },
      };
      changeKeys.set(change, { sceneId, skyBoxId });
      changes.push(change);
    }
  }
  return changes;
};

/** Registers the sky boxes' save source (the sky box tab's first build). */
export const registerSkyBoxSaveSource = () =>
  registerSaveSource({
    id: SKYBOX_SAVE_SOURCE_ID,
    label: 'Sky boxes',
    collect: collectSkyBoxChanges,
    onSaved: (changes) => {
      for (const change of changes) {
        const keys = changeKeys.get(change);
        if (keys) setSkyBoxOverrides(keys.sceneId, keys.skyBoxId, undefined);
      }
    },
  });
