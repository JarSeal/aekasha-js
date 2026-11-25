import type { DevFilesSaveData } from './DevFilesProtocol';

/**
 * Save sources (p355 §2.1): the debug tools that keep edits of asset JSONs (a sky box's layers, a
 * PostFX pass's params) register one, and the Æ menu's "Save scene" writes their changes into
 * the files in one commit of the dev files. The registry is kept here, not in the implementation
 * (`_dbg__SaveData.ts`), so a source registered before it loads still counts.
 */

/** What a {@link SaveChange} writes into its file: a save entry, or the file's new JSON. */
export type SaveChangeWrite =
  | {
      /** A save entry for the scene: it replaces the scene's latest, so it carries everything the
       * latest one had (`writeDevFiles`' `saveData` write) */
      saveData: DevFilesSaveData;
    }
  | {
      /** The file's whole new JSON (a global change: the asset's own values) */
      json: unknown;
    };

/** One unsaved change of a {@link SaveSource}: an asset's edits, in one scene or global. */
export type SaveChange = {
  /** Unique in its source, eg. `${sceneId}:${skyBoxId}` */
  id: string;
  /** What changed, for a list: `Sky box "dayNight"` */
  label: string;
  /** `SCENE`: saved as the scene's save entry; `GLOBAL`: into the asset's own values */
  scope: 'SCENE' | 'GLOBAL';
  /** The scene a `SCENE` change is saved for */
  sceneId?: string;
  /** The file it's saved into, repo-relative; null when there's none (`unsaveable` says why) */
  path: string | null;
  /** Why it can't be saved ('made in code', 'not in this scene'): the change stays where it is */
  unsaveable?: string;
  /** The changed keys, for a list: `['atmosphere.turbidity', 'suns.0.elevation']` */
  summary: string[];
  /**
   * Builds the write from the file as it is now (read right before the commit, its `json` a copy
   * the function may change). Returns null when the file has the change already: nothing is
   * written for it, and its `onSaved` still runs.
   */
  build: (file: { json: unknown }) => SaveChangeWrite | null;
};

/** A debug tool's unsaved changes, for {@link registerSaveSource}. */
export type SaveSource = {
  /** Unique among the sources: registering it again replaces the source */
  id: string;
  /** Its name in a list: 'Sky boxes' */
  label: string;
  /** Every unsaved change: each scene's in localStorage and every global one. Read on every save
   * and every open of the Æ menu, so it's cheap and has no side effects. */
  collect: () => SaveChange[];
  /** After a commit wrote them (or found the files had them): drop the saved changes from where
   * the tool keeps them, so the files' values are the ones shown after the reload */
  onSaved: (changes: SaveChange[]) => void;
};

const saveSources = new Map<string, SaveSource>();

/**
 * Registers a save source: the Æ menu's "Save scene" writes its changes for the current scene,
 * and the global ones, into their files (debug env, with the dev files). Works at any time, also
 * before the debugger loads; a no-op in a production build.
 * @returns a function that removes the source
 * @example
 * ```ts
 * import { registerSaveSource } from 'aekasha/debug';
 *
 * const edits: { [sceneId: string]: { speed: number } } = {};
 *
 * registerSaveSource({
 *   id: 'myGame.platforms',
 *   label: 'Platforms',
 *   collect: () =>
 *     Object.entries(edits).map(([sceneId, entry]) => ({
 *       id: sceneId,
 *       label: 'Platform speed',
 *       scope: 'SCENE' as const,
 *       sceneId,
 *       path: 'src/app/meshes/platform.mesh.json',
 *       summary: Object.keys(entry),
 *       build: () => ({ saveData: { sceneId, entry } }),
 *     })),
 *   onSaved: (changes) => {
 *     for (const change of changes) delete edits[change.id];
 *   },
 * });
 * ```
 */
export const registerSaveSource = (source: SaveSource): (() => void) => {
  // Folds the map out of a production build
  if (!__AEK_DEBUG__) return () => undefined;
  saveSources.set(source.id, source);
  return () => {
    if (saveSources.get(source.id) === source) saveSources.delete(source.id);
  };
};

/**
 * The registered save sources, in registration order. The save implementation's.
 * @internal
 */
export const _getSaveSources = (): SaveSource[] => [...saveSources.values()];
