import { DEBUG_TOASTER_ID, updateDebuggerTab } from '../../../debug/DebuggerGUI';
import { addToast } from '../../../ui/Toaster';
import { getActiveSkyBox, setActiveSkyBox, updateSkyBox } from '../SkyBox';
import type { SkyBoxDef, SkyBoxOverrides } from '../SkyBoxTypes';
import { resolveSkyBoxPreset, type SkyBoxPresetName } from '../Presets';
import {
  _recordOrCoalesceUndoRedoAction,
  _recordUndoRedoAction,
  _registerUndoRedoActionHandler,
} from '../../../debug/_dbg__UndoRedo';
import {
  asObj,
  getDefValue,
  getPath,
  getSkyBoxDef,
  getSkyBoxOverrides,
  isEqual,
  isObj,
  LAYER_PATHS,
  setSkyBoxOverrides,
  SKYBOX_TAB_ID,
  toSkyBoxUpdate,
  withPath,
  writeSkyBoxOverride,
  type Obj,
  type SkyBoxLayerKey,
  type SkyBoxListKey,
} from './_dbg__SkyBoxShared';

// Undo/redo. The handlers resolve the sky box by scene and id every time.

type SkyBoxParamPayload = {
  sceneId: string;
  skyBoxId: string;
  /** A layer value's path in the definition, eg. 'env.backgroundRoughness'. */
  path: string;
  prev: unknown;
  next: unknown;
};
type SkyBoxResetLayerPayload = {
  sceneId: string;
  skyBoxId: string;
  /** The layer's path in the definition (LAYER_PATHS). */
  layer: string;
  /** The layer's override subtree before the reset. */
  prev: Obj | undefined;
};

const isActive = (sceneId: string, skyBoxId: string) => {
  const active = getActiveSkyBox();
  return active?.id === skyBoxId && active.sceneId === sceneId;
};

/** Refreshes the tab when a change can't reach it through SkyBox.ts (an inactive sky box). */
const refreshTab = () => updateDebuggerTab(SKYBOX_TAB_ID);

/** Writes a param to the override store and, when that sky box is showing, to the render. A
 * whole array (a list edit: suns, moons, nebulae) changes the list's options, so the tab is
 * rebuilt. */
const applyParam = async (sceneId: string, skyBoxId: string, path: string, value: unknown) => {
  writeSkyBoxOverride(sceneId, skyBoxId, path, value);
  if (isActive(sceneId, skyBoxId)) await updateSkyBox(skyBoxId, toSkyBoxUpdate(path, value));
  if (Array.isArray(value) && !path.includes('.'))
    updateDebuggerTab(SKYBOX_TAB_ID, { rebuild: true });
  else if (!isActive(sceneId, skyBoxId)) refreshTab();
};

/** Tweakpane's step snapping leaves float noise (0.49999999999999994): keep 6 decimals, so the
 * stored and copied values stay clean. */
const roundNumber = (value: unknown) =>
  typeof value === 'number' ? Math.round(value * 1e6) / 1e6 : value;

/**
 * Sets a layer value of the active sky box from a binding: renders it, stores it as an override
 * and records it for undo (ticks of one drag coalesce). `label` names it in the undo history.
 */
export const setSkyBoxParam = (
  path: string,
  label: string,
  rawValue: unknown,
  e: { prev: unknown }
) => {
  const active = getActiveSkyBox();
  if (!active) return;
  const { sceneId, id: skyBoxId } = active;
  const value = roundNumber(rawValue);
  const prev = roundNumber(e.prev);
  void applyParam(sceneId, skyBoxId, path, value);
  if (isEqual(prev, value)) return;
  _recordOrCoalesceUndoRedoAction<SkyBoxParamPayload>(
    'skybox.param',
    `Sky box ${skyBoxId}: ${label}`,
    { sceneId, skyBoxId, path, prev, next: value },
    `${sceneId}.${skyBoxId}.${path}`
  );
};

/**
 * Replaces a whole array of the active sky box (a list edit: add, duplicate or remove a sun,
 * moon or nebula), as one undo step (not coalesced). `prev` is the array before the edit.
 */
export const setSkyBoxArray = (path: string, label: string, prev: unknown[], next: unknown[]) => {
  const active = getActiveSkyBox();
  if (!active || isEqual(prev, next)) return;
  const { sceneId, id: skyBoxId } = active;
  void applyParam(sceneId, skyBoxId, path, next);
  _recordUndoRedoAction<SkyBoxParamPayload>('skybox.param', `Sky box ${skyBoxId}: ${label}`, {
    sceneId,
    skyBoxId,
    path,
    prev,
    next,
  });
};

/** Sets a layer's override subtree, and renders the result when that sky box is showing:
 * every key the change touches gets its overridden value, or else the definition's. */
const applyLayerOverride = async (
  sceneId: string,
  skyBoxId: string,
  layerPath: string,
  layerOverride: Obj | undefined
) => {
  const current = (getSkyBoxOverrides(sceneId, skyBoxId) || {}) as Obj;
  const touchedKeys = new Set([
    ...Object.keys(asObj(getPath(current, layerPath))),
    ...Object.keys(layerOverride || {}),
  ]);
  setSkyBoxOverrides(
    sceneId,
    skyBoxId,
    withPath(
      current,
      layerPath.split('.'),
      layerOverride,
      !layerOverride || !Object.keys(layerOverride).length
    ) as SkyBoxOverrides
  );
  if (!isActive(sceneId, skyBoxId)) {
    refreshTab();
    return;
  }
  // A nested layer (eg. a sun's light) can't be "set back" key by key when the definition
  // doesn't have it: activate again from the definition and the remaining overrides instead
  const prevLayer = asObj(getPath(current, layerPath));
  if ([...touchedKeys].some((key) => isObj(prevLayer[key]) || isObj(layerOverride?.[key]))) {
    await setActiveSkyBox(skyBoxId, sceneId);
    return;
  }
  const def = getSkyBoxDef(sceneId, skyBoxId);
  const layerUpdate: Obj = {};
  for (const key of touchedKeys) {
    layerUpdate[key] = layerOverride?.[key] ?? getDefValue(def, `${layerPath}.${key}`);
  }
  await updateSkyBox(skyBoxId, toSkyBoxUpdate(layerPath, layerUpdate));
};

/** "Reset layer": drops the active sky box's overrides of one layer (undoable). */
export const resetSkyBoxLayer = (layer: SkyBoxLayerKey) => {
  const active = getActiveSkyBox();
  if (!active) return;
  const { sceneId, id: skyBoxId } = active;
  const layerPath = LAYER_PATHS[layer];
  const prev = getPath(getSkyBoxOverrides(sceneId, skyBoxId), layerPath) as Obj | undefined;
  void applyLayerOverride(sceneId, skyBoxId, layerPath, undefined);
  if (!prev || !Object.keys(prev).length) return;
  _recordUndoRedoAction<SkyBoxResetLayerPayload>(
    'skybox.resetLayer',
    `Sky box ${skyBoxId}: reset ${layer}`,
    { sceneId, skyBoxId, layer: layerPath, prev }
  );
};

_registerUndoRedoActionHandler<SkyBoxParamPayload>('skybox.param', {
  undo: ({ sceneId, skyBoxId, path, prev }) => applyParam(sceneId, skyBoxId, path, prev),
  redo: ({ sceneId, skyBoxId, path, next }) => applyParam(sceneId, skyBoxId, path, next),
});
_registerUndoRedoActionHandler<SkyBoxResetLayerPayload>('skybox.resetLayer', {
  undo: ({ sceneId, skyBoxId, layer, prev }) => applyLayerOverride(sceneId, skyBoxId, layer, prev),
  redo: ({ sceneId, skyBoxId, layer }) => applyLayerOverride(sceneId, skyBoxId, layer, undefined),
});

// Apply preset: one override that makes a definition look like a preset

/** Objects without an `enabled` key: absent means all defaults. */
const WITHOUT_ENABLED = new Set(['env', 'stars.twinkle']);
const PRESET_LAYER_KEYS = [
  'env',
  'atmosphere',
  'stars',
  'ambientLight',
  'clouds',
  'ground',
  'dayNight',
] as const;
const PRESET_LIST_KEYS: SkyBoxListKey[] = ['suns', 'moons', 'nebulae'];

/** The override of the object at `path` that makes `from` what `to` has there: a layer `to`
 * doesn't have is turned off, and every key either one sets gets `to`'s value (or default). */
const diffLayer = (from: SkyBoxDef, to: SkyBoxDef, path: string): Obj | undefined => {
  const hasEnabled = !WITHOUT_ENABLED.has(path);
  if (hasEnabled && getDefValue(to, `${path}.enabled`) === false) {
    return getDefValue(from, `${path}.enabled`) === false ? undefined : { enabled: false };
  }
  const keys = new Set([
    ...Object.keys(asObj(getPath(from, path))),
    ...Object.keys(asObj(getPath(to, path))),
  ]);
  if (hasEnabled) keys.add('enabled');
  const result: Obj = {};
  for (const key of keys) {
    const keyPath = `${path}.${key}`;
    if (isObj(getPath(from, keyPath)) || isObj(getPath(to, keyPath))) {
      const nested = diffLayer(from, to, keyPath);
      if (nested) result[key] = nested;
      continue;
    }
    const next = getDefValue(to, keyPath);
    if (next !== undefined && !isEqual(next, getDefValue(from, keyPath))) result[key] = next;
  }
  return Object.keys(result).length ? result : undefined;
};

/**
 * The overrides that make a definition look like a preset (its id and debug data stay). The
 * lists are whole arrays. Overrides can't change the base's type, so a texture base is kept
 * (`keptBase`).
 */
export const getPresetOverrides = (def: SkyBoxDef, presetName: SkyBoxPresetName) => {
  const to = resolveSkyBoxPreset({ id: def.id, preset: presetName });
  const overrides: Obj = {};
  const keptBase = def.base.type !== to.base.type;
  if (!keptBase && def.base.type === 'COLOR' && to.base.type === 'COLOR') {
    if (!isEqual(def.base.color, to.base.color)) overrides.base = { color: to.base.color };
  }
  for (const layer of PRESET_LAYER_KEYS) {
    const layerOverride = diffLayer(def, to, layer);
    if (layerOverride) overrides[layer] = layerOverride;
  }
  for (const list of PRESET_LIST_KEYS) {
    const next = getDefValue(to, list);
    if (!isEqual(next, getDefValue(def, list))) overrides[list] = structuredClone(next);
  }
  return { overrides: overrides as SkyBoxOverrides, keptBase };
};

type SkyBoxApplyPresetPayload = {
  sceneId: string;
  skyBoxId: string;
  preset: SkyBoxPresetName;
  prevOverride: SkyBoxOverrides | undefined;
  nextOverride: SkyBoxOverrides | undefined;
};

/** Replaces a sky box's overrides, and shows the result when that sky box is showing. */
const applyWholeOverride = async (
  sceneId: string,
  skyBoxId: string,
  overrides: SkyBoxOverrides | undefined
) => {
  setSkyBoxOverrides(sceneId, skyBoxId, overrides);
  // Layers turn on and off, and the lists change: activate again from the definition
  if (isActive(sceneId, skyBoxId)) await setActiveSkyBox(skyBoxId, sceneId);
  else refreshTab();
};

/**
 * "Apply preset": replaces the active sky box's overrides with the ones that make it look like
 * the preset (undoable as one step, `skybox.applyPreset`). A texture base is kept (a toast says
 * so): overrides can't change the base's type.
 */
export const applySkyBoxPreset = (presetName: SkyBoxPresetName) => {
  const active = getActiveSkyBox();
  if (!active) return;
  const { sceneId, id: skyBoxId } = active;
  const def = getSkyBoxDef(sceneId, skyBoxId);
  if (!def) return;
  const { overrides, keptBase } = getPresetOverrides(def, presetName);
  const prevOverride = getSkyBoxOverrides(sceneId, skyBoxId);
  const nextOverride = Object.keys(overrides).length ? overrides : undefined;
  if (keptBase) {
    addToast({
      toasterId: DEBUG_TOASTER_ID,
      title: `Applied ${presetName}, kept the base`,
      message: `The preset's base is a colour; a ${def.base.type} base stays (a base type change is a different definition).`,
    });
  }
  void applyWholeOverride(sceneId, skyBoxId, nextOverride);
  if (isEqual(prevOverride, nextOverride)) return;
  _recordUndoRedoAction<SkyBoxApplyPresetPayload>(
    'skybox.applyPreset',
    `Sky box ${skyBoxId}: apply preset ${presetName}`,
    { sceneId, skyBoxId, preset: presetName, prevOverride, nextOverride }
  );
};

_registerUndoRedoActionHandler<SkyBoxApplyPresetPayload>('skybox.applyPreset', {
  undo: ({ sceneId, skyBoxId, prevOverride }) =>
    applyWholeOverride(sceneId, skyBoxId, prevOverride),
  redo: ({ sceneId, skyBoxId, nextOverride }) =>
    applyWholeOverride(sceneId, skyBoxId, nextOverride),
});
