// The material editor's selection and edits (p806 D11, out of `_dbg__MaterialEditor.ts`): the
// selected material and the copy on the stage, a binding's change to the copy or the stage
// settings with its save, and their undo and redo (p085 DD4). The load and the drawer are the
// editor's, reached through the hooks it sets (`setMaterialEditorHooks`).
import type * as THREE from 'three/webgpu';
import { deleteMaterial } from '../../../kernel/assets/Material';
import { lwarn } from '../../../utils/Logger';
import {
  _recordOrCoalesceUndoRedoAction,
  _registerUndoRedoActionHandler,
} from '../../_dbg__UndoRedo';
import {
  clearAllMaterialRecords,
  patchMaterialRecord,
  readMaterialRecord,
  setMaterialOverride,
  setMaterialSetting,
  type MaterialOverrideSection,
} from './_dbg__MaterialEditorStore';
import {
  getMaterialEditorSettingLabel,
  normalizeMaterialEditorSetting,
  type MaterialEditorSettingKey,
} from './_dbg__MaterialEditorSettings';
import {
  getAssetNodeInputs,
  getMaterialParamDef,
  getMaterialParamValue,
  getNodeInputBaseValue,
  getNodeInputValue,
  isSameNodeInputValue,
  normalizeAssetNodeInputValue,
  normalizeMaterialParamValue,
  setMaterialParamValue,
  setNodeInputValue,
  type MaterialParamDef,
} from './_dbg__MaterialEditorParams';
import { getMaterialAssets } from './_dbg__MaterialEditorAssets';
import {
  DEFAULT_CAMERA_POSE,
  getStageSettings,
  getStageSettingsMaterialId,
  getViewCam,
  setStageSettingValue,
  showPreview,
} from './_dbg__MaterialEditorStage';

/** What the edits need of the editor: its load (an undo of a material not on the stage selects
 * it), its drawer's refresh, and whether its view is entered. */
type MaterialEditorHooks = {
  loadMaterial: (materialId: string) => void;
  refreshDrawer: () => void;
  isEntered: () => boolean;
};

let hooks: MaterialEditorHooks = {
  loadMaterial: () => {},
  refreshDrawer: () => {},
  isEntered: () => false,
};

/** Sets what the edits call of the editor (its registration). */
export const setMaterialEditorHooks = (next: MaterialEditorHooks) => {
  hooks = next;
};

/** The editor copy on the preview object, and the project material it was made from. */
export type MaterialEditorCopy = {
  materialId: string;
  copyId: string;
  copy: THREE.Material;
  /** The copy's catalogue params as the asset alone gives them (before the overrides): an edit
   * back to one of these removes its override, so the param follows the JSON again. */
  baseParams: Record<string, unknown>;
};

/** The project material picked in the selector (also while it loads or after it failed). */
let selectedMaterialId: string | null = null;
let current: MaterialEditorCopy | null = null;

/** The project material picked in the selector (also while it loads or after it failed). */
export const getSelectedMaterialId = () => selectedMaterialId;

/** Sets the selected material; returns whether it changed (the editor saves it then). */
export const setSelectedMaterialIdValue = (materialId: string | null) => {
  if (selectedMaterialId === materialId) return false;
  selectedMaterialId = materialId;
  return true;
};

/** Puts a new copy on record (the load's), after the previous one was deleted. */
export const setCurrentCopy = (copy: MaterialEditorCopy) => {
  current = copy;
};

/** Deletes the copy on the stage, the ball showing its own material again. */
export const deleteCurrentCopy = () => {
  if (!current) return;
  showPreview('MESH', null);
  deleteMaterial(current.copyId);
  current = null;
};

/** The selected material's settings, once they are on the stage (null before, or without a
 * selected material). */
export const getSelectedSettings = () =>
  selectedMaterialId && getStageSettingsMaterialId() === selectedMaterialId
    ? getStageSettings()
    : null;

/**
 * Sets a setting of the selected material on the stage (a binding's change), and with `persist`
 * (the last change of a drag) saves it to the material's record (deviation-only).
 */
const setStageSetting = (key: MaterialEditorSettingKey, value: unknown, persist: boolean) => {
  if (!selectedMaterialId || !getSelectedSettings()) return;
  const next = normalizeMaterialEditorSetting(key, value);
  if (next === undefined) return;
  setStageSettingValue(key, next);
  if (persist) setMaterialSetting(selectedMaterialId, key, next);
};

/** Sets the record's param overrides on a new copy: a key the catalogue doesn't know, the copy
 * doesn't have, or with a value of the wrong kind is ignored (it stays in the record). An override
 * equal to the asset's own value (`baseParams`) is removed, so the param follows the JSON again:
 * only a copy tells, and an undo or redo writes a material that isn't on the stage without one. */
export const applyParamOverrides = (
  materialId: string,
  copy: THREE.Material,
  params: Record<string, unknown>,
  baseParams: Record<string, unknown>
) => {
  for (const [key, value] of Object.entries(params)) {
    const def = getMaterialParamDef(key);
    if (!def || !setMaterialParamValue(copy, def, value)) continue;
    if (normalizeMaterialParamValue(def, value) === baseParams[key]) {
      setMaterialOverride(materialId, 'params', key, undefined);
    }
  }
};

/** The copy of the selected material, when it is on the stage. */
export const getSelectedCopy = () =>
  current && current.materialId === selectedMaterialId ? current.copy : null;

/**
 * Sets a param on the selected material's copy (a binding's change), and with `persist` (the
 * last change of a drag) saves it to the material's record: as an override, or without one when
 * the value is the asset's own again.
 */
const setCopyParam = (def: MaterialParamDef, value: unknown, persist: boolean) => {
  const copy = getSelectedCopy();
  if (!copy || !current || !setMaterialParamValue(copy, def, value)) return;
  if (!persist) return;
  const next = normalizeMaterialParamValue(def, value);
  const isDeviation = next !== current.baseParams[def.key];
  setMaterialOverride(current.materialId, 'params', def.key, isDeviation ? next : undefined);
};

/**
 * Sets a TSL input on the selected material's copy (a binding's change), and with `persist` saves
 * it to the material's record, like {@link setCopyParam}.
 */
const setCopyNodeInput = (socket: string, input: string, value: unknown, persist: boolean) => {
  const copy = getSelectedCopy();
  const asset = current && getMaterialAssets()[current.materialId];
  if (!copy || !current || !asset) return;
  const assetNodes = getAssetNodeInputs(asset);
  const next = setNodeInputValue(copy, assetNodes, socket, input, value);
  if (next === undefined || !persist) return;
  const isDeviation = !isSameNodeInputValue(next, getNodeInputBaseValue(assetNodes, socket, input));
  setMaterialOverride(
    current.materialId,
    'nodes',
    `${socket}.${input}`,
    isDeviation ? next : undefined
  );
};

// Undo and redo (p085 DD4): one action type for every value a binding sets, kept in the editor
// view's bucket ('perScene' recorded in an editor view)

const UNDO_SET_VALUE = 'materialEditor.setValue';

/** Where a value goes: the record's overrides, its settings, or its camera pose (`fov`, the only
 * part of the pose a binding sets). */
type MaterialEditorValueSection = MaterialOverrideSection | 'settings' | 'camera';

type SetValuePayload = {
  materialId: string;
  section: MaterialEditorValueSection;
  /** A param key, `<socket>.<input>`, a setting key or `fov`. */
  path: string;
  /** The JSON values shown before and after the change (never "removed"). */
  prev: unknown;
  next: unknown;
};

/** Records a binding's change (the ticks of one drag coalesce into one entry), unless nothing
 * changed (eg. a value of the wrong kind, or the copy doesn't have the param). */
const recordValueChange = (
  materialId: string,
  section: MaterialEditorValueSection,
  path: string,
  label: string,
  prev: unknown,
  next: unknown
) => {
  if (prev === undefined || next === undefined || isSameNodeInputValue(prev, next)) return;
  const asset = getMaterialAssets()[materialId];
  _recordOrCoalesceUndoRedoAction<SetValuePayload>(
    UNDO_SET_VALUE,
    `Material ${asset?.debugData?.name || materialId}: ${label}`,
    { materialId, section, path, prev, next },
    `${materialId}.${section}.${path}`
  );
};

/** The Params tab's param bindings: {@link setCopyParam}, recorded for undo. */
export const editCopyParam = (def: MaterialParamDef, value: unknown, persist: boolean) => {
  const copy = getSelectedCopy();
  if (!copy || !current) return;
  const prev = getMaterialParamValue(copy, def);
  setCopyParam(def, value, persist);
  const next = getMaterialParamValue(copy, def);
  recordValueChange(current.materialId, 'params', def.key, def.label, prev, next);
};

/** The Params tab's TSL input bindings: {@link setCopyNodeInput}, recorded for undo. */
export const editCopyNodeInput = (
  socket: string,
  input: string,
  value: unknown,
  persist: boolean
) => {
  const copy = getSelectedCopy();
  const asset = current && getMaterialAssets()[current.materialId];
  if (!copy || !current || !asset) return;
  const assetNodes = getAssetNodeInputs(asset);
  const path = `${socket}.${input}`;
  const prev = getNodeInputValue(copy, assetNodes, socket, input);
  setCopyNodeInput(socket, input, value, persist);
  const next = getNodeInputValue(copy, assetNodes, socket, input);
  recordValueChange(current.materialId, 'nodes', path, path, prev, next);
};

/** The Settings tab's setting bindings: {@link setStageSetting}, recorded for undo. */
export const editStageSetting = (
  key: MaterialEditorSettingKey,
  value: unknown,
  persist: boolean
) => {
  if (!selectedMaterialId || !getSelectedSettings()) return;
  const prev = getStageSettings()[key];
  setStageSetting(key, value, persist);
  const label = getMaterialEditorSettingLabel(key);
  recordValueChange(selectedMaterialId, 'settings', key, label, prev, getStageSettings()[key]);
};

/** The Camera folder's FOV binding: sets the fov, saved with the pose of the material the camera
 * shows (its pose key, the previous material while the selected one loads), recorded for undo. */
export const editCameraFov = (fov: number, persist: boolean) => {
  const viewCam = getViewCam();
  if (!viewCam) return;
  const prev = viewCam.camera.fov;
  viewCam.setFov(fov, persist);
  const materialId = viewCam.getPoseKey();
  // The view's own pose (no material) has no record to undo into
  if (materialId) recordValueChange(materialId, 'camera', 'fov', 'FOV', prev, viewCam.camera.fov);
};

/** A `<socket>.<input>` path's parts. */
const splitNodePath = (path: string) => {
  const dotIndex = path.indexOf('.');
  return dotIndex > 0 ? { socket: path.slice(0, dotIndex), input: path.slice(dotIndex + 1) } : null;
};

/** Sets an undone or redone value on the stage and saves it, like a binding's last change.
 * Returns false when that part of the material isn't on the stage (another material is selected,
 * or its copy or settings aren't there yet). */
const applyLiveValue = ({ materialId, section, path }: SetValuePayload, value: unknown) => {
  // The camera shows the previous material's pose while the selected one loads: an fov of that
  // material goes to the camera, or its next orbit end would save the old fov back over the record
  if (section === 'camera') {
    const viewCam = getViewCam();
    if (viewCam?.getPoseKey() !== materialId || typeof value !== 'number') return false;
    viewCam.setFov(value, true);
    return true;
  }
  if (materialId !== selectedMaterialId) return false;
  switch (section) {
    case 'params': {
      const def = getMaterialParamDef(path);
      if (!def || !getSelectedCopy()) return false;
      setCopyParam(def, value, true);
      return true;
    }
    case 'nodes': {
      const node = splitNodePath(path);
      if (!node || !getSelectedCopy()) return false;
      setCopyNodeInput(node.socket, node.input, value, true);
      return true;
    }
    case 'settings':
      if (!getSelectedSettings()) return false;
      setStageSetting(path as MaterialEditorSettingKey, value, true);
      return true;
  }
};

/** Writes an undone or redone value into the material's record only (it isn't on the stage): its
 * load makes the copy, the settings and the pose from the record. A TSL input and a setting are
 * deviation-only here too; a param is checked against the copy on the load
 * ({@link applyParamOverrides}). */
const writeRecordValue = ({ materialId, section, path }: SetValuePayload, value: unknown) => {
  switch (section) {
    case 'params': {
      const def = getMaterialParamDef(path);
      const next = def ? normalizeMaterialParamValue(def, value) : undefined;
      if (next !== undefined) setMaterialOverride(materialId, 'params', path, next);
      return;
    }
    case 'nodes': {
      const node = splitNodePath(path);
      const asset = getMaterialAssets()[materialId];
      if (!node || !asset) return;
      const assetNodes = getAssetNodeInputs(asset);
      const next = normalizeAssetNodeInputValue(assetNodes, node.socket, node.input, value);
      if (next === undefined) return;
      const base = getNodeInputBaseValue(assetNodes, node.socket, node.input);
      const isDeviation = !isSameNodeInputValue(next, base);
      setMaterialOverride(materialId, 'nodes', path, isDeviation ? next : undefined);
      return;
    }
    case 'settings': {
      const next = normalizeMaterialEditorSetting(path, value);
      if (next !== undefined)
        setMaterialSetting(materialId, path as MaterialEditorSettingKey, next);
      return;
    }
    case 'camera': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return;
      const saved = readMaterialRecord(materialId).camera;
      patchMaterialRecord(materialId, {
        camera: { ...(saved ?? DEFAULT_CAMERA_POSE), fov: value },
      });
    }
  }
};

/**
 * The undo / redo handler: sets the value on the stage when its material is there, else writes it
 * into the material's record and, when another material is selected, selects this one (like
 * jumping to the edit; its load shows the value). Writing the record first, not after the load,
 * keeps the value when the load is overtaken or fails.
 */
const applyRecordedValue = (payload: SetValuePayload, value: unknown) => {
  const { materialId } = payload;
  if (!getMaterialAssets()[materialId]) {
    lwarn(
      `Could not apply "${payload.path}" of material "${materialId}" (undo / redo): the material no longer exists.`
    );
    return;
  }
  if (applyLiveValue(payload, value)) {
    hooks.refreshDrawer();
    return;
  }
  writeRecordValue(payload, value);
  if (materialId !== selectedMaterialId) hooks.loadMaterial(materialId);
  else hooks.refreshDrawer();
};

_registerUndoRedoActionHandler<SetValuePayload>(
  UNDO_SET_VALUE,
  {
    undo: (payload) => applyRecordedValue(payload, payload.prev),
    redo: (payload) => applyRecordedValue(payload, payload.next),
  },
  'perScene'
);

/** The Params tab's "Reset params": removes the material's overrides (its settings and camera
 * stay) and makes the copy again from the asset. */
export const resetMaterialParams = (materialId: string) => {
  patchMaterialRecord(materialId, { overrides: undefined });
  if (materialId === selectedMaterialId && hooks.isEntered()) hooks.loadMaterial(materialId);
};

/** After a tab's clear button removed the material's record: the copy is made again from the
 * asset alone, and the camera and the settings go to their defaults. */
export const onMaterialRecordCleared = (materialId: string) => {
  if (materialId !== selectedMaterialId || !hooks.isEntered()) return;
  // The same key again: it applies the (now missing) saved pose, so the default one
  getViewCam()?.setPoseKey(materialId);
  hooks.loadMaterial(materialId);
};

/** The Settings tab's "Clear editor data of all materials" (after its confirm): removes every
 * material's record, and resets the selected one like its own clear does. */
export const clearAllMaterialEditorData = () => {
  clearAllMaterialRecords();
  if (selectedMaterialId) onMaterialRecordCleared(selectedMaterialId);
  else hooks.refreshDrawer();
};
