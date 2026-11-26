// The fog tab's edits (p106 D8): the overrides `AEK_debugFog` keeps per scene and fog (a delta
// over the scene's definition, which Fog.ts merges in when that fog shows), applied to the fog
// showing through `updateFog`, and their undo. Only the current scene's fogs are edited: a fog
// made in code shows its edits but has nothing to keep them for.
import { updateDebuggerTab } from '../../../debug/DebuggerGUI';
import { pruneSaveEntry } from '../../../debug/_dbg__SaveEntries';
import {
  _recordOrCoalesceUndoRedoAction,
  _recordUndoRedoAction,
  _registerUndoRedoActionHandler,
} from '../../../debug/_dbg__UndoRedo';
import { deepMerge } from '../../../utils/DeepMerge';
import { lsGetItem, lsRemoveItem, lsSetItem } from '../../../utils/LocalAndSessionStorage';
import {
  _getSceneFogs,
  FOG_DEBUG_OVERRIDES_LS_KEY,
  type FogUpdate,
  getFog,
  setFog,
  updateFog,
} from '../Fog';
import type { FogOverrides } from '../FogSchema';

/** The fog tab's id in the debug drawer. */
export const FOG_TAB_ID = 'fogControls';

type Obj = Record<string, unknown>;

/** Every scene's fog overrides, as `AEK_debugFog` keeps them */
type AllFogOverrides = { [sceneId: string]: { [fogId: string]: FogOverrides } };

/** Every scene's fog overrides (a copy). */
export const getAllFogOverrides = (): AllFogOverrides =>
  (lsGetItem(FOG_DEBUG_OVERRIDES_LS_KEY, {}) as AllFogOverrides | null) ?? {};

/** The scenes that have fog overrides. */
export const getSceneIdsWithFogOverrides = () => Object.keys(getAllFogOverrides());

/** Sets a fog's overrides in a scene, or drops them (undefined or empty). */
export const setFogOverrides = (
  sceneId: string,
  fogId: string,
  overrides: FogOverrides | undefined
) => {
  const all = getAllFogOverrides();
  const sceneOverrides = { ...all[sceneId] };
  if (overrides && Object.keys(overrides).length) sceneOverrides[fogId] = overrides;
  else delete sceneOverrides[fogId];
  if (Object.keys(sceneOverrides).length) all[sceneId] = sceneOverrides;
  else delete all[sceneId];
  if (Object.keys(all).length) lsSetItem(FOG_DEBUG_OVERRIDES_LS_KEY, all);
  else lsRemoveItem(FOG_DEBUG_OVERRIDES_LS_KEY);
};

/** The current scene's fog of that id as its data has it, or undefined (another scene's, or one
 * made in code). */
const getSceneFogDef = (sceneId: string, fogId: string) => {
  const sceneFogs = _getSceneFogs();
  if (sceneFogs?.sceneId !== sceneId) return undefined;
  return sceneFogs.fogs.find((fog) => fog.id === fogId);
};

/** Whether the fog showing is one of the current scene's (its edits are kept and saved). */
export const isSceneFogShown = () => {
  const fog = getFog();
  const sceneId = _getSceneFogs()?.sceneId;
  return Boolean(fog && sceneId && getSceneFogDef(sceneId, fog.id));
};

/** `{ a: { b: value } }` from `'a.b'`. */
const withPath = (path: string, value: unknown): FogUpdate => {
  const keys = path.split('.');
  let result: unknown = value;
  for (let i = keys.length - 1; i >= 0; i--) result = { [keys[i]]: result };
  return result as FogUpdate;
};

/** The value at `'a.b'` in an object, or undefined. */
export const getPathValue = (obj: unknown, path: string): unknown => {
  let value = obj;
  for (const key of path.split('.')) {
    if (typeof value !== 'object' || value === null) return undefined;
    value = (value as Obj)[key];
  }
  return value;
};

const isEqual = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** A field's step leaves float noise (0.49999999999999994): keep 6 decimals, so the stored and
 * copied values stay clean. */
const roundNumber = (value: unknown) =>
  typeof value === 'number' ? Math.round(value * 1e6) / 1e6 : value;

/**
 * Writes values of a scene's fog: into its overrides (only what differs from its definition; not
 * for a fog made in code) and, when it shows, into the fog through `updateFog` (at once). A
 * scene other than the current one changes nothing (its undo entries wait for it).
 */
const applyFogValues = (sceneId: string, fogId: string, values: FogUpdate) => {
  if (_getSceneFogs()?.sceneId !== sceneId) return;
  const def = getSceneFogDef(sceneId, fogId);
  if (def) {
    const merged = deepMerge(getAllFogOverrides()[sceneId]?.[fogId] ?? {}, values);
    setFogOverrides(sceneId, fogId, pruneSaveEntry(merged, def) as FogOverrides);
  }
  if (getFog()?.id === fogId) updateFog(values);
  updateDebuggerTab(FOG_TAB_ID);
};

type FogValuesPayload = {
  sceneId: string;
  fogId: string;
  /** The values before the edit */
  prev: FogUpdate;
  /** The values after it */
  next: FogUpdate;
};

/** The fog showing and its scene, or null when none shows. */
const getEditTarget = () => {
  const fog = getFog();
  const sceneId = _getSceneFogs()?.sceneId;
  return fog && sceneId ? { sceneId, fogId: fog.id } : null;
};

/**
 * Sets one value of the fog showing from a field (`path` in the definition, eg.
 * `'height.density'`): renders it, keeps it as an override and records it for undo (a drag's
 * ticks coalesce). `label` names it in the undo history.
 */
export const setFogValue = (path: string, label: string, rawValue: unknown) => {
  const target = getEditTarget();
  if (!target) return;
  const value = roundNumber(rawValue);
  const prev = roundNumber(getPathValue(getFog(), path));
  applyFogValues(target.sceneId, target.fogId, withPath(path, value));
  if (isEqual(prev, value)) return;
  _recordOrCoalesceUndoRedoAction<FogValuesPayload>(
    'fog.values',
    `Fog ${target.fogId}: ${label}`,
    { ...target, prev: withPath(path, prev), next: withPath(path, value) },
    `${target.sceneId}.${target.fogId}.${path}`
  );
};

/**
 * Sets several values of the fog showing at once, as one undo step (not coalesced): `prev` are
 * the same keys' values before it.
 */
export const setFogValues = (label: string, prev: FogUpdate, next: FogUpdate) => {
  const target = getEditTarget();
  if (!target || isEqual(prev, next)) return;
  applyFogValues(target.sceneId, target.fogId, next);
  _recordUndoRedoAction<FogValuesPayload>('fog.values', `Fog ${target.fogId}: ${label}`, {
    ...target,
    prev,
    next,
  });
};

_registerUndoRedoActionHandler<FogValuesPayload>('fog.values', {
  undo: ({ sceneId, fogId, prev }) => applyFogValues(sceneId, fogId, prev),
  redo: ({ sceneId, fogId, next }) => applyFogValues(sceneId, fogId, next),
});

// Selection (session only: on a scene's load, its default fog shows)

type FogSelectPayload = { sceneId: string; prev: string | null; next: string | null };

const selectFog = (sceneId: string, fogId: string | null) => {
  if (_getSceneFogs()?.sceneId === sceneId) setFog(fogId);
};

_registerUndoRedoActionHandler<FogSelectPayload>('fog.select', {
  undo: ({ sceneId, prev }) => selectFog(sceneId, prev),
  redo: ({ sceneId, next }) => selectFog(sceneId, next),
});

/** Shows another of the current scene's fogs, or none (null), as an undo step. */
export const selectSceneFog = (fogId: string | null) => {
  const sceneId = _getSceneFogs()?.sceneId;
  if (!sceneId) return;
  const prev = getFog()?.id ?? null;
  selectFog(sceneId, fogId);
  if (prev === fogId) return;
  _recordUndoRedoAction<FogSelectPayload>('fog.select', 'Fog: select', {
    sceneId,
    prev,
    next: fogId,
  });
};

/**
 * Drops the scenes' fog overrides, and shows the fog showing again from its definition when its
 * scene's were dropped.
 */
export const clearFogOverrides = (sceneIds: readonly string[]) => {
  for (const sceneId of sceneIds) {
    for (const fogId of Object.keys(getAllFogOverrides()[sceneId] ?? {})) {
      setFogOverrides(sceneId, fogId, undefined);
    }
  }
  const target = getEditTarget();
  if (target && sceneIds.includes(target.sceneId) && isSceneFogShown()) setFog(target.fogId);
};
