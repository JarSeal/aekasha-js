import fs from 'fs/promises';
import path from 'path';
import { readGit } from '../git';
import { ROOT } from '../paths';
import { hasGatheredSaveData } from '../gather/gatheredJson';
import { DevFilesError } from './http';
import type { DevFilePath } from './paths';
import { sha256 } from '../files';
import type {
  DevFilesSaveDataWrite,
  DevFilesSchemaIssues,
} from '../../src/_engine/debug/DevFilesProtocol';

/**
 * A commit's save entry write (p342 §2.6): `{ path, saveData: { sceneId, entry, historySize } }`
 * reads the asset JSON, puts `entry` first in its `__saveData[sceneId]` (the older entries after
 * it; the gatherer applies only the first) and stamps the entry's `__meta` with the three part
 * versions from `package.json`, the author (git's `user.name`; without one the entry's own
 * `author` is removed: the server's stamp always wins) and, unless the entry has one, the date. The scene's list then
 * keeps its first `historySize` entries (-1: all; 0, saving off, is refused); the other scenes'
 * lists are left as they are. The commit validates and formats the result like any JSON write.
 * An entry equal to the scene's latest one (`__meta` aside) leaves the file `unchanged`, unless
 * the list is longer than `historySize`: then it's only trimmed. `saveData` may be a list of
 * entries, each for another scene (p355 Phase 4: one save of a file for several scenes), put in
 * one after the other; the file is `unchanged` only when every entry leaves it so. With `json`
 * too (p355 §2.6: an inline asset moved into a file of its own) the entries go into that value,
 * not the file's: the file may not exist yet, and whether it changes is the written bytes'.
 */

type JsonObject = Record<string, unknown>;

const isPlainObject = (value: unknown): value is JsonObject =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/** Throws BAD_REQUEST unless an entry is `{ sceneId, entry, historySize }` */
const checkSaveDataEntry = (writePath: string, saveData: unknown) => {
  if (!isPlainObject(saveData)) {
    throw new DevFilesError(
      'BAD_REQUEST',
      `${writePath}: saveData must be { sceneId, entry, historySize } or a list of them`
    );
  }
  if (typeof saveData.sceneId !== 'string' || !saveData.sceneId) {
    throw new DevFilesError('BAD_REQUEST', `${writePath}: saveData.sceneId must be a string`);
  }
  // Assigning `__proto__` sets the object's prototype: the entry would be lost (F6)
  if (saveData.sceneId === '__proto__') {
    throw new DevFilesError('BAD_REQUEST', `${writePath}: "__proto__" isn't a scene id`);
  }
  if (!isPlainObject(saveData.entry)) {
    throw new DevFilesError('BAD_REQUEST', `${writePath}: saveData.entry must be an object`);
  }
  if ('__meta' in saveData.entry && !isPlainObject(saveData.entry.__meta)) {
    throw new DevFilesError('BAD_REQUEST', `${writePath}: saveData.entry.__meta must be an object`);
  }
  const { historySize } = saveData;
  if (typeof historySize !== 'number' || !Number.isInteger(historySize) || historySize < -1) {
    throw new DevFilesError(
      'BAD_REQUEST',
      `${writePath}: saveData.historySize must be an integer, -1 (all) or more`
    );
  }
  if (historySize === 0) {
    throw new DevFilesError('SAVE_DATA_DISABLED', `${writePath}: saving is off (history size 0)`);
  }
  return saveData as DevFilesSaveDataWrite;
};

/**
 * Throws BAD_REQUEST unless the write's `saveData` is `{ sceneId, entry, historySize }`, or a
 * non-empty list of them with each scene once.
 * @returns the entries as a list
 */
export const checkSaveDataRequest = (writePath: string, saveData: unknown) => {
  if (!Array.isArray(saveData)) return [checkSaveDataEntry(writePath, saveData)];
  if (!saveData.length) {
    throw new DevFilesError('BAD_REQUEST', `${writePath}: saveData is an empty list`);
  }
  const entries = saveData.map((item) => checkSaveDataEntry(writePath, item));
  const sceneIds = new Set<string>();
  for (const { sceneId } of entries) {
    if (sceneIds.has(sceneId)) {
      throw new DevFilesError(
        'BAD_REQUEST',
        `${writePath}: saveData has two entries for scene "${sceneId}"`
      );
    }
    sceneIds.add(sceneId);
  }
  return entries;
};

/** Git's `user.name`, undefined without git, outside a repo or with no name set (p355 §2.4) */
export const readGitAuthor = () => readGit(['config', 'user.name']) || undefined;

/** What the server stamps every save entry's `__meta` with (the date aside) */
export type SaveDataStamp = {
  engineVersion: string;
  toolkitVersion: string;
  appVersion: string;
  author: string | undefined;
};

/** Read once per commit, so a version bump or a changed git name while `yarn dev` runs is stamped
 * at once */
export const readSaveDataStamp = async (): Promise<SaveDataStamp> => {
  const pkg = JSON.parse(await fs.readFile(path.join(ROOT, 'package.json'), 'utf-8')) as {
    engine_metadata: { version: string };
    toolkit_metadata: { version: string };
    app_metadata: { version: string };
  };
  return {
    engineVersion: pkg.engine_metadata.version,
    toolkitVersion: pkg.toolkit_metadata.version,
    appVersion: pkg.app_metadata.version,
    author: readGitAuthor(),
  };
};

/** JSON with every object's keys sorted: equal for equal values whatever their key order */
const canonicalJson = (value: unknown) =>
  JSON.stringify(value, (_key, nested: unknown) =>
    isPlainObject(nested)
      ? Object.fromEntries(Object.entries(nested).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : nested
  );

const withoutMeta = (entry: unknown) => {
  if (!isPlainObject(entry)) return entry;

  const { __meta, ...rest } = entry;
  return rest;
};

// A declaration, not an arrow: a call of a `never` function narrows only then (p619 K2)
function invalidFile(repoPath: string, issuePath: string, message: string): never {
  const details: DevFilesSchemaIssues = [
    { path: repoPath, issues: [{ path: issuePath, message }] },
  ];
  throw new DevFilesError('INVALID_SCHEMA', `Invalid ${repoPath}`, details);
}

export type SaveDataWriteResult =
  /** The file's new JSON value */
  | { json: JsonObject; currentHash: string }
  /** Every entry is its scene's latest already: the file stays as it is */
  | { unchanged: Buffer; currentHash: string };

/** Puts one entry into `__saveData` (in place); whether it changed anything */
const applyEntry = async (
  repoPath: string,
  allSaveData: JsonObject,
  saveData: DevFilesSaveDataWrite,
  getStamp: () => Promise<SaveDataStamp>
) => {
  const { sceneId, entry, historySize } = saveData;
  const keep = (list: unknown[]) => (historySize === -1 ? list : list.slice(0, historySize));
  // Own keys only: `toString` is a scene id like any other (F6)
  const entries = Object.prototype.hasOwnProperty.call(allSaveData, sceneId)
    ? allSaveData[sceneId]
    : [];
  if (!Array.isArray(entries)) invalidFile(repoPath, `__saveData.${sceneId}`, 'Must be a list');

  if (
    entries.length &&
    canonicalJson(withoutMeta(entries[0])) === canonicalJson(withoutMeta(entry))
  ) {
    if (keep(entries).length === entries.length) return false;
    // The same entry under a smaller history size: only the trim
    allSaveData[sceneId] = keep(entries);
    return true;
  }

  const { __meta, ...overrides } = entry;
  const meta = { ...(__meta as JsonObject | undefined) };
  delete meta.author;
  const { author, ...versions } = await getStamp();
  const stamped = {
    __meta: {
      ...meta,
      date: meta.date ?? Date.now(),
      ...versions,
      ...(author !== undefined ? { author } : {}),
    },
    ...overrides,
  };
  // In place: an existing scene keeps its place in the file
  allSaveData[sceneId] = keep([stamped, ...entries]);
  return true;
};

/** Puts the entries into a file's JSON value (in place); whether any changed it */
const applyEntries = async (
  repoPath: string,
  file: unknown,
  saveDataList: DevFilesSaveDataWrite[],
  getStamp: () => Promise<SaveDataStamp>
): Promise<{ file: JsonObject; isChanged: boolean }> => {
  if (!isPlainObject(file)) invalidFile(repoPath, '', 'The file must be an object');
  if (file.__saveData !== undefined && !isPlainObject(file.__saveData)) {
    invalidFile(repoPath, '__saveData', 'Must be an object');
  }
  const allSaveData = (file.__saveData ?? {}) as JsonObject;
  let isChanged = false;
  for (const saveData of saveDataList) {
    if (await applyEntry(repoPath, allSaveData, saveData, getStamp)) isChanged = true;
  }
  // In place: an existing `__saveData` keeps its place in the file
  if (isChanged) file.__saveData = allSaveData;
  return { file, isChanged };
};

/** Throws BAD_REQUEST unless the target is a gathered asset JSON with `__saveData` */
const checkSaveDataTarget = (target: DevFilePath) => {
  if (!target.isJson || !hasGatheredSaveData(target.repoPath)) {
    throw new DevFilesError(
      'BAD_REQUEST',
      `${target.repoPath}: only a gathered asset JSON with __saveData takes a save entry`
    );
  }
};

/**
 * Puts the save entries into the file's JSON (the file module's header).
 * @param saveDataList the write's entries, each scene once (`checkSaveDataRequest`'s)
 * @param getStamp the commit's stamp, read once for all its writes
 */
export const applySaveDataWrite = async (
  target: DevFilePath,
  saveDataList: DevFilesSaveDataWrite[],
  getStamp: () => Promise<SaveDataStamp>
): Promise<SaveDataWriteResult> => {
  const { repoPath } = target;
  checkSaveDataTarget(target);
  let current: Buffer;
  try {
    current = await fs.readFile(target.absPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new DevFilesError('NOT_FOUND', `${repoPath} doesn't exist`, { path: repoPath });
    }
    throw err;
  }
  const currentHash = sha256(current);
  let file: unknown;
  try {
    file = JSON.parse(current.toString('utf-8'));
  } catch (err) {
    throw new DevFilesError('INVALID_JSON', `${repoPath} isn't JSON: ${(err as Error).message}`);
  }
  const result = await applyEntries(repoPath, file, saveDataList, getStamp);
  if (!result.isChanged) return { unchanged: current, currentHash };
  return { json: result.file, currentHash };
};

/**
 * Puts the save entries into a write's own JSON value (`json` and `saveData` together, p355 §2.6),
 * as into a read file: the file needn't exist, and the commit compares the written bytes with it.
 * @param json the write's `json`, changed in place
 * @returns the JSON value to write
 */
export const applySaveDataToJson = async (
  target: DevFilePath,
  json: unknown,
  saveDataList: DevFilesSaveDataWrite[],
  getStamp: () => Promise<SaveDataStamp>
): Promise<JsonObject> => {
  checkSaveDataTarget(target);
  return (await applyEntries(target.repoPath, json, saveDataList, getStamp)).file;
};
