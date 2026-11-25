// The lights' save source (p355 §2.1): `AEK_debugLights` keeps a light's edited values whole per
// scene and app id (not a delta), next to the debugger's own preferences, which aren't saved. A
// change is what differs from the light the scene has (its latest save entry in it); its entry is
// the latest one with the values over it, pruned flat (the gather merges a light's entry flat over
// `lightProps`). Colours are kept as hex numbers and saved as `#rrggbb`; they're compared as
// colours, so a file's "orange" equals 0xffa500. A managed light (a sky box's) never has a record.
import * as THREE from 'three/webgpu';
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
import { toThreeColor } from '../../render/ThreeMath';
import type { ColorJSON } from '../../../schemas/_HelperSchemas';
import {
  LIGHT_DEBUGGER_ONLY_KEYS,
  LS_LIGHTS_KEY,
  pruneEmptyLightScene,
  writeLightLSOrRemove,
  type LightDebugLSData,
  type LightEntityDebugState,
} from './_dbg__LightDebugState';

/** The save source's id */
export const LIGHT_SAVE_SOURCE_ID = 'light';

type Obj = Record<string, unknown>;

const COLOR_KEYS = ['color', 'groundColor'] as const;

/** Each collected change's scene, light and saved keys, for `onSaved` */
const changeKeys = new WeakMap<SaveChange, { sceneId: string; appId: string; keys: string[] }>();

/** A colour as `#rrggbb` (sRGB, as the edit window's hex numbers and the JSON's colours are) */
const toHexColor = (color: unknown) =>
  typeof color === 'number'
    ? `#${color.toString(16).padStart(6, '0')}`
    : `#${new THREE.Color(toThreeColor(color as ColorJSON)).getHexString()}`;

/** Props with their colours as `#rrggbb`, to compare as colours */
const withHexColors = (props: Obj) => {
  const result = { ...props };
  for (const key of COLOR_KEYS) {
    if (result[key] !== undefined) result[key] = toHexColor(result[key]);
  }
  return result;
};

/** Props as the comparisons read them: colours as `#rrggbb`, `enabled` defaulting to true */
const toComparable = (props: unknown): Obj | undefined => {
  if (typeof props !== 'object' || props === null) return undefined;
  const result = withHexColors(props as Obj);
  return { ...result, enabled: result.enabled ?? true };
};

/** A record's values (its keys but the debugger's own preferences), its colours as `#rrggbb` */
const getLightValues = (record: LightEntityDebugState) =>
  withHexColors(
    Object.fromEntries(Object.entries(record).filter(([key]) => !LIGHT_DEBUGGER_ONLY_KEYS.has(key)))
  );

/** A light's props as the scene has them (the dev data's, the latest entry in them) */
const getSceneLightProps = (sceneId: string, appId: string) =>
  (getSceneListItem('lights', sceneId, appId) as { lightProps?: unknown } | undefined)?.lightProps;

/** The keys of `entry` that differ from `base`, compared as colours and with `enabled`'s default
 * (the entry's own keys only: the default isn't one) */
const getChangedKeys = (entry: Obj, base: unknown) =>
  Object.keys(pruneFlatSaveEntry(toComparable(entry) ?? {}, toComparable(base))).filter(
    (key) => key in entry
  );

const collectLightChanges = (): SaveChange[] => {
  const changes: SaveChange[] = [];
  const data = lsGetItem(LS_LIGHTS_KEY, {}) as LightDebugLSData;
  for (const [sceneId, scene] of Object.entries(data)) {
    for (const [appId, record] of Object.entries(scene.lights ?? {})) {
      const values = getLightValues(record);
      // Only a preference, an old record's `enabled: true` (i165), or values the light has
      // already: no change
      const summary = getChangedKeys(values, getSceneLightProps(sceneId, appId));
      if (!summary.length) continue;
      const file = findSceneAssetFile({ list: 'lights', registry: 'lights' }, sceneId, appId);
      const change: SaveChange = {
        id: `${sceneId}:${appId}`,
        label: `Light "${appId}"`,
        scope: 'SCENE',
        sceneId,
        ...toChangeFileFields(file),
        summary,
        build: ({ json }) => {
          const merged = { ...getLatestSaveEntry(json, sceneId), ...values };
          // Compared as colours, written as they are (a latest entry's "orange" stays)
          const kept = getChangedKeys(merged, (json as { lightProps?: unknown }).lightProps);
          const entry = Object.fromEntries(kept.map((key) => [key, merged[key]]));
          return toSaveEntryWrite(json, sceneId, entry);
        },
      };
      changeKeys.set(change, { sceneId, appId, keys: Object.keys(values) });
      changes.push(change);
    }
  }
  return changes;
};

/** Drops the saved changes' values from `AEK_debugLights`: the preferences stay */
const onLightsSaved = (changes: SaveChange[]) => {
  const data = lsGetItem(LS_LIGHTS_KEY, {}) as LightDebugLSData;
  for (const change of changes) {
    const saved = changeKeys.get(change);
    const lights = saved && data[saved.sceneId]?.lights;
    const record = saved && lights?.[saved.appId];
    if (!saved || !lights || !record) continue;
    for (const key of saved.keys) delete record[key as keyof LightEntityDebugState];
    if (!Object.keys(record).length) delete lights[saved.appId];
    pruneEmptyLightScene(data, saved.sceneId);
  }
  writeLightLSOrRemove(data);
};

/** Registers the lights' save source (the lights' debug GUI's load). */
export const registerLightSaveSource = () =>
  registerSaveSource({
    id: LIGHT_SAVE_SOURCE_ID,
    label: 'Lights',
    collect: collectLightChanges,
    onSaved: onLightsSaved,
  });
