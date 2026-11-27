// The fogs' save source (p106 D8, after the sky boxes' p355 §2.1): the overrides `AEK_debugFog`
// keeps per scene and fog are a delta over the definition with the scene's latest save entry in
// it, so the saved entry is that latest entry with the delta deep-merged over it, without the
// values the file has already. An inline fog is moved into a `<id>.fog.json` of its own (§2.6).
import { registerSaveSource, type SaveChange } from '../../../debug/SaveData';
import {
  findSceneAssetFile,
  getChangedKeys,
  getLatestSaveEntry,
  pruneSaveEntry,
  toChangeFileFields,
  toSaveEntryWrite,
} from '../../../debug/_dbg__SaveEntries';
import { deepMerge } from '../../../utils/DeepMerge';
import { getAllFogOverrides, setFogOverrides } from './_dbg__FogEdits';

/** The save source's id */
export const FOG_SAVE_SOURCE_ID = 'fog';

/** Each collected change's scene and fog, for `onSaved` */
const changeKeys = new WeakMap<SaveChange, { sceneId: string; fogId: string }>();

/** A file's fog as the gather reads it without a save entry */
const getFileDef = (json: unknown) => {
  const { __saveData: _saveData, ...def } = json as { __saveData?: unknown };
  return def;
};

const collectFogChanges = (): SaveChange[] => {
  const changes: SaveChange[] = [];
  for (const [sceneId, fogs] of Object.entries(getAllFogOverrides())) {
    for (const [fogId, overrides] of Object.entries(fogs)) {
      const file = findSceneAssetFile({ list: 'fogs', registry: 'fogs' }, sceneId, fogId);
      const change: SaveChange = {
        id: `${sceneId}:${fogId}`,
        label: `Fog "${fogId}"`,
        scope: 'SCENE',
        sceneId,
        ...toChangeFileFields(file),
        summary: getChangedKeys(overrides),
        build: ({ json }) => {
          const latest = getLatestSaveEntry(json, sceneId) ?? {};
          const entry = pruneSaveEntry(deepMerge(latest, overrides), getFileDef(json));
          return toSaveEntryWrite(json, sceneId, entry);
        },
      };
      changeKeys.set(change, { sceneId, fogId });
      changes.push(change);
    }
  }
  return changes;
};

/** Registers the fogs' save source (the fog tab's creation). */
export const registerFogSaveSource = () =>
  registerSaveSource({
    id: FOG_SAVE_SOURCE_ID,
    label: 'Fogs',
    collect: collectFogChanges,
    onSaved: (changes) => {
      for (const change of changes) {
        const keys = changeKeys.get(change);
        if (keys) setFogOverrides(keys.sceneId, keys.fogId, undefined);
      }
    },
  });
