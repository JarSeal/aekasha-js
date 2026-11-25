// What the save sources share (p355 §2.1): the scene's latest save entry of a file, an entry's
// values that the file itself has dropped (so an entry holds only real overrides), the changed
// keys for a list, and where an asset a scene lists comes from.
import { getGeneratedAppData } from '../kernel/scene/Scene';

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
 * The write of a scene's new entry: null when there's nothing to write (the entry is empty and
 * the file has none for the scene), else the entry, an empty one too (it replaces the latest).
 */
export const toSaveEntryWrite = (json: unknown, sceneId: string, entry: Obj) =>
  !Object.keys(entry).length && !getLatestSaveEntry(json, sceneId)
    ? null
    : { saveData: { sceneId, entry } };

/** The dev data's lists a scene names an asset in, and its registries */
type SceneAssetKind = { list: 'skyboxes' | 'postFx'; registry: 'skyboxes' | 'postFx' };

/**
 * The file a scene's asset is saved into, or why there's none: the scene isn't in the generated
 * data, its JSON doesn't list the asset (made in code, or no longer listed), or lists it inline.
 */
export const findSceneAssetFile = (
  kind: SceneAssetKind,
  sceneId: string,
  assetId: string
): { path: string } | { unsaveable: string } => {
  const data = getGeneratedAppData() as unknown as {
    scenes: { [id: string]: Obj | undefined };
  } & { [registry: string]: { [id: string]: { __sourcePath?: string } | undefined } | undefined };
  const scene = data.scenes[sceneId];
  if (!scene) return { unsaveable: 'scene not found' };
  const list = scene[kind.list];
  const isListed =
    Array.isArray(list) && list.some((item: unknown) => (isObj(item) ? item.id : item) === assetId);
  if (!isListed) return { unsaveable: 'not in the scene JSON' };
  const path = data[kind.registry]?.[assetId]?.__sourcePath;
  return path ? { path } : { unsaveable: 'inline in the scene JSON: it has no file of its own' };
};
