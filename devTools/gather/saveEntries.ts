/**
 * Per-scene save entries (`__saveData: { [sceneId]: [latest, ...older] }`): only the latest
 * applies, and its `__meta` stamp is never data.
 */
import type z from 'zod';
import type { MetaSchema } from '../../src/_engine/schemas';
import pkg from '../../package.json';
import type { GatherLog } from './log';

type Meta = z.infer<typeof MetaSchema>;

/**
 * A scene's save entry of an asset, the latest, without its `__meta`.
 * @returns the entry, or undefined when the asset has none for the scene
 */
export const getSaveEntry = <E extends { __meta?: Meta }>(
  asset: { __saveData?: Record<string, E[] | undefined> },
  sceneId: string
): Omit<E, '__meta'> | undefined => {
  const entry = asset.__saveData?.[sceneId]?.[0];
  if (!entry) return undefined;
  const overrides: Partial<E> = { ...entry };
  delete overrides.__meta;
  return overrides as Omit<E, '__meta'>;
};

/** A scene JSON as far as its own save entry goes */
type SceneWithSaveData = {
  spatialDomains?: { id: string }[];
  __saveData?: Record<string, { spatialDomains?: { id: string }[]; __meta?: Meta }[] | undefined>;
};

/**
 * A scene with its own latest save entry applied (p619 G5): the entry's fields replace the
 * scene's, but `spatialDomains` merges by id (p355 §2.5): an entry's domain is laid over the
 * scene's with its id, field by field, and one the scene doesn't list is appended, so an entry
 * holds only the domains it changes.
 */
export const applySceneSaveEntry = <S extends SceneWithSaveData>(scene: S, sceneId: string): S => {
  const entry = getSaveEntry(scene, sceneId);
  const result = { ...scene, ...entry } as S;
  if (entry?.spatialDomains && scene.spatialDomains) {
    const domains = scene.spatialDomains.map((domain) => ({ ...domain }));
    for (const saved of entry.spatialDomains) {
      const index = domains.findIndex((domain) => domain.id === saved.id);
      if (index === -1) domains.push(saved);
      else domains[index] = { ...domains[index], ...saved };
    }
    result.spatialDomains = domains;
  }
  return result;
};

// Versions of the current build, compared against the ones stamped in save entries' __meta
const CURRENT_VERSIONS = {
  engineVersion: pkg.engine_metadata.version,
  toolkitVersion: pkg.toolkit_metadata.version,
  appVersion: pkg.app_metadata.version,
};
const majorOf = (version: string) => Number(version.split('.')[0]);

/** An asset JSON with save entries, as far as their stamps go */
export type SaveDataHolder = { __saveData?: Record<string, { __meta?: Meta }[] | undefined> };

/** Warns (doesn't fail) when a scene's applied save entry (the latest, index 0) was stamped
 * under another major version of a part than the current build: a breaking change may have
 * changed what its overrides mean. Entries without stamps are never warned about. */
export const warnOnStaleSaveData = (log: GatherLog, file: string, data: SaveDataHolder) => {
  for (const [sceneId, entries] of Object.entries(data.__saveData ?? {})) {
    const meta = entries?.[0]?.__meta;
    if (!meta) continue;
    for (const key of Object.keys(CURRENT_VERSIONS) as (keyof typeof CURRENT_VERSIONS)[]) {
      const saved = meta[key];
      const current = CURRENT_VERSIONS[key];
      if (!saved || majorOf(saved) === majorOf(current)) continue;
      log.warn(
        `Save data for scene "${sceneId}" in ${file} was saved with ${key} ${saved}, the current one is ${current} (another major version). Check that its overrides still apply.`
      );
    }
  }
};
