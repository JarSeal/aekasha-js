// What the save sources share (p355 §2.1): the scene's latest save entry of a file, an entry's
// values that the file itself has dropped (so an entry holds only real overrides), the changed
// keys for a list, and where an asset a scene lists comes from (and its props as the scene has
// them): its file, or for one written inline in the scene JSON the file its save moves it into
// (§2.6).
import { getGeneratedAppData } from '../kernel/scene/Scene';
import type { SaveChange, SaveChangeExtract } from './SaveData';

type Obj = Record<string, unknown>;

const isObj = (value: unknown): value is Obj =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isEqual = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** A file JSON's latest save entry for a scene, without its `__meta`; undefined when it has none */
export const getLatestSaveEntry = (json: unknown, sceneId: string): Obj | undefined => {
  const saveData = isObj(json) ? json.__saveData : undefined;
  const entries = isObj(saveData) ? saveData[sceneId] : undefined;
  const latest: unknown = Array.isArray(entries) ? entries[0] : undefined;
  if (!isObj(latest)) return undefined;
  const entry = { ...latest };
  delete entry.__meta;
  return entry;
};

const DROP = Symbol('drop');

const prune = (value: unknown, base: unknown): unknown => {
  // A value (a whole list too) the file has already
  if (!isObj(value)) return base !== undefined && isEqual(value, base) ? DROP : value;
  const result: Obj = {};
  for (const [key, child] of Object.entries(value)) {
    // An index object addresses a list's entries (`{ suns: { "0": { … } } }`)
    const baseChild = Array.isArray(base) ? base[Number(key)] : isObj(base) ? base[key] : undefined;
    const pruned = prune(child, baseChild);
    if (pruned !== DROP) result[key] = pruned;
  }
  // An empty object the file doesn't have stays: its key turns a layer on
  return Object.keys(result).length || base === undefined ? result : DROP;
};

/**
 * An entry without the values the asset has already (deep: `base` is the file's values, without
 * the entry): applied over the asset, it gives the same result. A value equal to a default the
 * file doesn't set stays, and so does an object the file doesn't have, empty or not (a sky box's
 * layer is on when its key is there).
 */
export const pruneSaveEntry = (entry: Obj, base: unknown): Obj => {
  const pruned = prune(entry, base);
  return pruned === DROP ? {} : (pruned as Obj);
};

/** The changed keys of an entry, a list as one ('atmosphere.turbidity', 'suns.0.elevation') */
export const getChangedKeys = (value: unknown, prefix = ''): string[] => {
  if (!isObj(value)) return prefix ? [prefix] : [];
  return Object.entries(value).flatMap(([key, child]) =>
    getChangedKeys(child, prefix ? `${prefix}.${key}` : key)
  );
};

/**
 * An entry without the top-level values the asset has already (`base`: the file's values, without
 * the entry), each compared whole: for an asset whose entry the gather merges flat over its props
 * (a camera's, a light's), so a `position` stays whole or goes. A value equal to a default the
 * file doesn't set stays. Also measures what differs from the props a scene has (`base` then the
 * resolved props, the latest entry in them).
 */
export const pruneFlatSaveEntry = (entry: Obj, base: unknown): Obj =>
  Object.fromEntries(
    Object.entries(entry).filter(
      ([key, value]) => !isObj(base) || !(key in base) || !isEqual(value, base[key])
    )
  );

/**
 * The write of a scene's new entry: null when there's nothing to write (the entry is empty and
 * the file has none for the scene), else the entry, an empty one too (it replaces the latest).
 */
export const toSaveEntryWrite = (json: unknown, sceneId: string, entry: Obj) =>
  !Object.keys(entry).length && !getLatestSaveEntry(json, sceneId)
    ? null
    : { saveData: { sceneId, entry } };

/** The dev data's lists a scene names an asset in, and its registries */
type SceneAssetKind =
  | { list: 'skyboxes' | 'postFx'; registry: 'skyboxes' | 'postFx' }
  | { list: 'materials'; registry: 'materials' }
  | { list: 'cameras'; registry: 'cameras' }
  | { list: 'lights'; registry: 'lights' };

type DevData = { scenes: { [id: string]: Obj | undefined } } & {
  [registry: string]: { [id: string]: { __sourcePath?: string } | undefined } | undefined;
};

/** A resolved camera's or light's props key: its id is the props' `appId`, else the entity's */
const PROPS_KEYS: { [list: string]: string | undefined } = {
  cameras: 'camProps',
  lights: 'lightProps',
};

/** The id of an entry of a scene's resolved list: an id, an inline object's `id`, a camera's or
 * light's app id */
const getListItemId = (list: string, item: unknown) => {
  if (!isObj(item)) return item;
  const propsKey = PROPS_KEYS[list];
  if (!propsKey) return item.id;
  const props = item[propsKey];
  const entityOpts = item.entityOpts;
  return (
    (isObj(props) ? props.appId : undefined) ?? (isObj(entityOpts) ? entityOpts.appId : undefined)
  );
};

/**
 * A scene's entry for an asset in its resolved list, as the dev data has it (the scene's latest
 * save entry in it: a camera's `{ camProps, entityOpts }`); undefined when the scene or the entry
 * isn't there.
 */
export const getSceneListItem = (
  list: SceneAssetKind['list'],
  sceneId: string,
  assetId: string
): unknown => {
  const scene = (getGeneratedAppData() as unknown as DevData).scenes[sceneId];
  const items = scene?.[list];
  return Array.isArray(items)
    ? items.find((item: unknown) => getListItemId(list, item) === assetId)
    : undefined;
};

/** A scene as the dev data has it (its latest save entry applied); undefined when it's gone */
export const getDevScene = (sceneId: string): Obj | undefined =>
  (getGeneratedAppData() as unknown as DevData).scenes[sceneId];

/**
 * A scene's JSON file, which its own save entries go into (the dev data's `__sourcePath`, p355
 * §2.5), or why there's none: the scene isn't in the generated data, or has no file there (data
 * gathered before the scenes had one).
 */
export const findSceneFile = (sceneId: string): { path: string } | { unsaveable: string } => {
  const scene = getDevScene(sceneId);
  if (!scene) return { unsaveable: 'scene not found' };
  const path = scene.__sourcePath;
  return typeof path === 'string' ? { path } : { unsaveable: 'the scene JSON has no file path' };
};

/** The file suffix of an inline asset's list, which its save moves it into a file of (§2.6) */
const INLINE_FILE_TYPES: { [list: string]: string | undefined } = {
  cameras: 'camera',
  lights: 'light',
  skyboxes: 'skybox',
};

/** Where a change is saved: its file, or for an inline asset its new file and the move */
export type SceneAssetFile = { path: string; extract?: SaveChangeExtract } | { unsaveable: string };

/**
 * Where an inline asset's save moves it (§2.6): `<id>.<type>.json` in the scene JSON's folder,
 * since only that scene uses it, or why it can't: the scene JSON has no file path, another file
 * has the id, or a file of that type is at the new path.
 */
const findInlineAssetFile = (
  kind: SceneAssetKind,
  sceneId: string,
  assetId: string
): SceneAssetFile => {
  const scene = findSceneFile(sceneId);
  if ('unsaveable' in scene) return scene;
  const registry = (getGeneratedAppData() as unknown as DevData)[kind.registry] ?? {};
  const taken = registry[assetId]?.__sourcePath;
  if (taken) return { unsaveable: `id taken by ${taken}` };
  const folder = scene.path.slice(0, scene.path.lastIndexOf('/') + 1);
  const path = `${folder}${assetId}.${INLINE_FILE_TYPES[kind.list]}.json`;
  const other = Object.entries(registry).find(([, asset]) => asset?.__sourcePath === path);
  if (other) {
    return { unsaveable: `new file taken: ${path} is "${other[0]}"'s` };
  }
  return { path, extract: { scenePath: scene.path, list: kind.list, id: assetId } };
};

/** Whether the scene JSON writes the asset inline (the development data's `__inlineAssets`) */
const isInlineAsset = (scene: Obj, list: string, assetId: string) => {
  const inline = scene.__inlineAssets;
  const ids = isObj(inline) ? inline[list] : undefined;
  return Array.isArray(ids) && ids.includes(assetId);
};

/**
 * The file a scene's asset is saved into, or why there's none: the scene isn't in the generated
 * data, or its JSON doesn't list the asset (made in code, or no longer listed). A camera, light or
 * sky box written inline in the scene JSON is saved by moving it into a file of its own (§2.6:
 * `extract`, unless its id or new file is taken); any other inline asset has no file.
 */
export const findSceneAssetFile = (
  kind: SceneAssetKind,
  sceneId: string,
  assetId: string
): SceneAssetFile => {
  const data = getGeneratedAppData() as unknown as DevData;
  const scene = data.scenes[sceneId];
  if (!scene) return { unsaveable: 'scene not found' };
  if (getSceneListItem(kind.list, sceneId, assetId) === undefined) {
    return { unsaveable: 'not in the scene JSON' };
  }
  if (INLINE_FILE_TYPES[kind.list] && isInlineAsset(scene, kind.list, assetId)) {
    return findInlineAssetFile(kind, sceneId, assetId);
  }
  const path = data[kind.registry]?.[assetId]?.__sourcePath;
  return path ? { path } : { unsaveable: 'inline in the scene JSON: it has no file of its own' };
};

/** A change's `path`, `unsaveable` and `extract` from where it's saved */
export const toChangeFileFields = (
  file: SceneAssetFile
): Pick<SaveChange, 'path' | 'unsaveable' | 'extract'> =>
  'unsaveable' in file
    ? { path: null, unsaveable: file.unsaveable }
    : { path: file.path, ...(file.extract ? { extract: file.extract } : {}) };
