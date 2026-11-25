// The cameras' save source (p355 §2.1): `AEK_debugCams` keeps a camera's edited values whole per
// scene and app id (not a delta), next to the debugger's own preferences and the debug camera,
// which aren't saved. A change is what differs from the camera the scene has (its latest save
// entry in it); its entry is the latest one with the values over it, pruned flat: the gather
// merges a camera's entry flat over `camProps`, so a `position` is kept or dropped whole.
import { registerSaveSource, type SaveChange } from '../../../debug/SaveData';
import {
  findSceneAssetFile,
  getLatestSaveEntry,
  getSceneListItem,
  pruneFlatSaveEntry,
  toChangeFileFields,
  toSaveEntryWrite,
} from '../../../debug/_dbg__SaveEntries';
import { lsGetItem } from '../../../utils/LocalAndSessionStorage';
import {
  CAM_DEBUGGER_ONLY_KEYS,
  LS_KEY,
  pruneEmptyCamScene,
  writeCamLSOrRemove,
  type CamDebugLSData,
  type CamEntityDebugState,
} from './_dbg__CameraDebugState';

/** The save source's id */
export const CAMERA_SAVE_SOURCE_ID = 'camera';

/** Each collected change's scene, camera and saved keys, for `onSaved` */
const changeKeys = new WeakMap<SaveChange, { sceneId: string; appId: string; keys: string[] }>();

/** A record's values: its keys but the debugger's own preferences */
const getCameraValues = (record: CamEntityDebugState) =>
  Object.fromEntries(
    Object.entries(record).filter(([key]) => !CAM_DEBUGGER_ONLY_KEYS.has(key))
  ) as Record<string, unknown>;

/** A camera's props as the scene has them (the dev data's, the latest entry in them) */
const getSceneCamProps = (sceneId: string, appId: string) =>
  (getSceneListItem('cameras', sceneId, appId) as { camProps?: unknown } | undefined)?.camProps;

const collectCameraChanges = (): SaveChange[] => {
  const changes: SaveChange[] = [];
  const data = lsGetItem(LS_KEY, {}) as CamDebugLSData;
  for (const [sceneId, scene] of Object.entries(data)) {
    for (const [appId, record] of Object.entries(scene.cams ?? {})) {
      const values = getCameraValues(record);
      // Only a preference, or values the camera has already: no change
      const changed = pruneFlatSaveEntry(values, getSceneCamProps(sceneId, appId));
      if (!Object.keys(changed).length) continue;
      const file = findSceneAssetFile({ list: 'cameras', registry: 'cameras' }, sceneId, appId);
      const change: SaveChange = {
        id: `${sceneId}:${appId}`,
        label: `Camera "${appId}"`,
        scope: 'SCENE',
        sceneId,
        ...toChangeFileFields(file),
        summary: Object.keys(changed),
        build: ({ json }) => {
          const latest = getLatestSaveEntry(json, sceneId) ?? {};
          const camProps = (json as { camProps?: unknown }).camProps;
          const entry = pruneFlatSaveEntry({ ...latest, ...values }, camProps);
          return toSaveEntryWrite(json, sceneId, entry);
        },
      };
      changeKeys.set(change, { sceneId, appId, keys: Object.keys(values) });
      changes.push(change);
    }
  }
  return changes;
};

/** Drops the saved changes' values from `AEK_debugCams`: the preferences and the debug camera stay */
const onCamerasSaved = (changes: SaveChange[]) => {
  const data = lsGetItem(LS_KEY, {}) as CamDebugLSData;
  for (const change of changes) {
    const saved = changeKeys.get(change);
    const cams = saved && data[saved.sceneId]?.cams;
    const record = saved && cams?.[saved.appId];
    if (!saved || !cams || !record) continue;
    for (const key of saved.keys) delete record[key as keyof CamEntityDebugState];
    if (!Object.keys(record).length) delete cams[saved.appId];
    pruneEmptyCamScene(data, saved.sceneId);
  }
  writeCamLSOrRemove(data);
};

/** Registers the cameras' save source (the cameras' debug GUI's load). */
export const registerCameraSaveSource = () =>
  registerSaveSource({
    id: CAMERA_SAVE_SOURCE_ID,
    label: 'Cameras',
    collect: collectCameraChanges,
    onSaved: onCamerasSaved,
  });
