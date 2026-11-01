/**
 * The material editor (docs/plans/_DONE_p084_material-editor-stage-and-selector.md,
 * docs/plans/_DONE_p085_material-editor-params-and-persistence.md), the first editor view: a
 * preview object on a stage of its own (lights, a studio environment, a grey background), seen
 * through the editor's orbit camera, showing an editor copy of a project material
 * (`*.material.json`), picked in the selector (the bottom drawer).
 *
 * The copy is a separate registered material (`__matEditor__<id>`), so the scene's own instance
 * of the material is never used or changed. It only lives while the view is active: it is
 * created on enter and deleted on exit.
 *
 * This module is the load, the UI and the view; the project data, the stage and the edits are
 * their own modules (p806 D11): `_dbg__MaterialEditorAssets.ts`, `_dbg__MaterialEditorStage.ts`
 * and `_dbg__MaterialEditorEdits.ts`.
 */
import type * as THREE from 'three/webgpu';
import { getActiveViewId, registerView } from '../../../kernel/render/Views';
import { createMaterial, loadTslMaterialFileAsync } from '../../../kernel/assets/Material';
import { getTexture } from '../../../kernel/assets/Texture';
import { getHUDRootCMP, KEEP_IN_VIEWS_CLASS } from '../../../ui/core/HUD';
import type { CMPHandle } from '../../../ui/core/CMPTypes';
import { getDebuggerRootProps } from '../../../ui/overlays/DebuggerRoot';
import { addDebugToast } from '../../DebuggerGUI';
import {
  createEditorDrawer,
  type EditorDrawer,
  type EditorDrawerState,
} from '../_dbg__EditorDrawer';
import {
  createMaterialSelector,
  type MaterialSelector,
  type MaterialSelectorState,
} from './_dbg__MaterialEditorSelector';
import { createMaterialEditorTabs } from './_dbg__MaterialEditorTabs';
import {
  readMaterialEditorUIState,
  readMaterialOverrides,
  writeMaterialEditorUIState,
} from './_dbg__MaterialEditorStore';
import { readMaterialParams } from './_dbg__MaterialEditorParams';
import {
  getCopyProps,
  getMaterialAssets,
  getMaterialTextureIds,
  getSelectorEntries,
  getUnavailableReason,
  loadMissingTextures,
  retagLoadedTextures,
} from './_dbg__MaterialEditorAssets';
import {
  applyMaterialStage,
  ensureEnvironment,
  ensureStage,
  getPreviewKind,
  getStage,
  getViewCam,
  getViewCamera,
  MATERIAL_EDITOR_VIEW_ID,
  showPreview,
  turnPreview,
} from './_dbg__MaterialEditorStage';
import {
  applyParamOverrides,
  clearAllMaterialEditorData,
  deleteCurrentCopy,
  editCameraFov,
  editCopyNodeInput,
  editCopyParam,
  editStageSetting,
  getSelectedCopy,
  getSelectedMaterialId,
  getSelectedSettings,
  onMaterialRecordCleared,
  resetMaterialParams,
  setCurrentCopy,
  setMaterialEditorHooks,
  setSelectedMaterialIdValue,
} from './_dbg__MaterialEditorEdits';
import { lerror, lwarn } from '../../../utils/Logger';
import styles from './MaterialEditor.module.scss';

export { MATERIAL_EDITOR_VIEW_ID } from './_dbg__MaterialEditorStage';
export { getMaterialTextureIds } from './_dbg__MaterialEditorAssets';

/** The material registry id prefix of the editor's copies (anything that lists the registry can
 * skip them). */
export const MATERIAL_EDITOR_COPY_PREFIX = '__matEditor__';

/** The editor's DOM (created on the first enter): the HUD with the selector, the right drawer and
 * the notice. */
type EditorUI = {
  hud: CMPHandle;
  notice: CMPHandle;
  selector: MaterialSelector;
  drawer: EditorDrawer;
};

let ui: EditorUI | null = null;
let isEntered = false;
/** The newest load: a load that finishes after a newer one started (or after the exit) is
 * discarded. */
let loadToken = 0;
let loadingMaterialId: string | null = null;
/** The material, its copy and whether it had stage settings when the right drawer's tabs were
 * built (they are rebuilt per material, per copy: their bindings are made from it, and when the
 * settings come or go: the Settings tab's Stage and Preview folders are made from them). */
let drawerMaterialId: string | null = null;
let drawerCopy: THREE.Material | null = null;
let drawerHasSettings = false;
/** Why a material failed to load, by material id (cleared by its next successful load). */
const failures = new Map<string, string>();
/** The selector's and the right drawer's UI state, as saved (read at registration, kept in sync
 * by their onStateChange; the UI is created with it on the first enter). */
let selectorState: Partial<MaterialSelectorState> = {};
let drawerState: Partial<EditorDrawerState> = {};

const persistUIState = () =>
  writeMaterialEditorUIState({
    selectedMaterialId: getSelectedMaterialId(),
    selector: selectorState,
    drawer: drawerState,
  });

const setSelectedMaterialId = (materialId: string | null) => {
  if (setSelectedMaterialIdValue(materialId)) persistUIState();
};

const setNotice = (text: string) => {
  ui?.notice.updateText(text);
};

/** Re-reads the selected, loading and failed material into the selector and the right drawer. */
const refreshUI = () => {
  if (!ui) return;
  ui.selector.refresh();
  const selectedMaterialId = getSelectedMaterialId();
  const copy = getSelectedCopy();
  const hasSettings = Boolean(getSelectedSettings());
  if (
    drawerMaterialId === selectedMaterialId &&
    drawerCopy === copy &&
    drawerHasSettings === hasSettings
  ) {
    ui.drawer.refresh();
    return;
  }
  drawerMaterialId = selectedMaterialId;
  drawerCopy = copy;
  drawerHasSettings = hasSettings;
  ui.drawer.rebuild();
};

/** What the editor is doing with the selected material, for the drawer's info (null when its
 * copy is shown). */
const getSelectedStatus = () => {
  const id = getSelectedMaterialId();
  if (!id) return null;
  if (id === loadingMaterialId) return 'Loading…';
  const failure = failures.get(id);
  if (failure) return `Failed to load: ${failure}`;
  const asset = getMaterialAssets()[id];
  if (asset && getPreviewKind(asset.type) === 'NONE')
    return `Preview not supported for ${asset.type}`;
  return null;
};

const showLoadError = (materialId: string, message: string, err?: unknown) => {
  lerror(`Could not load material "${materialId}" in the material editor: ${message}`, err);
  failures.set(materialId, message);
  deleteCurrentCopy();
  showPreview('MESH', getStage()?.errorMaterial ?? null);
  addDebugToast({
    type: 'alert',
    title: 'Material editor',
    message: `Could not load material "${materialId}": ${message}`,
  });
};

/**
 * Shows a project material on the preview object: loads its missing textures, creates its editor
 * copy and deletes the previous one, and applies the material's camera pose. A load that a newer
 * one overtakes is discarded. The selection is saved (restored after a refresh).
 * @param materialId (string | null) a `*.material.json` id, null for none
 * @returns (Promise<boolean>) whether this load put its material on the stage
 */
export const loadEditorMaterial = async (materialId: string | null) => {
  const token = ++loadToken;
  setSelectedMaterialId(materialId);
  loadingMaterialId = null;
  setNotice('');
  // Loaded on the next enter: the copy only lives while the view is active
  if (!getStage() || !isEntered) return false;

  if (!materialId) {
    deleteCurrentCopy();
    showPreview('MESH', null);
    applyMaterialStage(null);
    refreshUI();
    return false;
  }

  const asset = getMaterialAssets()[materialId];
  if (!asset) {
    lwarn(`Could not find material "${materialId}", in loadEditorMaterial.`);
    setSelectedMaterialId(null);
    deleteCurrentCopy();
    showPreview('MESH', null);
    applyMaterialStage(null);
    refreshUI();
    return false;
  }
  const unavailableReason = getUnavailableReason(asset);
  if (unavailableReason) {
    showLoadError(materialId, unavailableReason);
    applyMaterialStage(materialId);
    refreshUI();
    return false;
  }

  const kind = getPreviewKind(asset.type);
  if (kind === 'NONE') {
    deleteCurrentCopy();
    showPreview('NONE', null);
    applyMaterialStage(materialId);
    setNotice(`Preview not supported for ${asset.type}`);
    failures.delete(materialId);
    refreshUI();
    return true;
  }

  // The previous copy stays on the stage until this one is ready
  loadingMaterialId = materialId;
  refreshUI();
  // Its TSL file too (loaded on demand, p607 D11): a failure shows as the load's error below
  let tslFileError: unknown = null;
  await Promise.all([
    loadMissingTextures(asset),
    loadTslMaterialFileAsync(materialId).catch((err: unknown) => {
      tslFileError = err;
    }),
  ]);
  if (token !== loadToken) return false;
  loadingMaterialId = null;

  const copyId = MATERIAL_EDITOR_COPY_PREFIX + materialId;
  // Right before creating, in the same task: createMaterial returns a registered id as it is
  deleteCurrentCopy();
  // With the swap (the previous material kept its pose while this one's textures loaded)
  applyMaterialStage(materialId);
  try {
    if (tslFileError) throw tslFileError;
    const overrides = readMaterialOverrides(materialId);
    const copy = createMaterial({
      ...getCopyProps(asset, overrides.nodes),
      id: copyId,
      tslMaterialId: materialId,
      // A scene loaded while the view is active (app code, HMR) must not release it
      isPersistent: true,
    });
    const baseParams = readMaterialParams(copy);
    applyParamOverrides(materialId, copy, overrides.params, baseParams);
    setCurrentCopy({ materialId, copyId, copy, baseParams });
    showPreview(kind, copy);
    failures.delete(materialId);
  } catch (err) {
    showLoadError(materialId, err instanceof Error ? err.message : String(err), err);
  }
  refreshUI();
  return token === loadToken;
};

const onSelect = (materialId: string) => {
  // Clicking the shown material again only retries a failed load
  if (materialId === getSelectedMaterialId() && !failures.has(materialId)) return;
  void loadEditorMaterial(materialId);
};

/** The drawer's tabs (`createUI`'s, and the test bridge's tab ids before the first enter) */
const getDrawerTabs = () =>
  createMaterialEditorTabs({
    getAsset: () => {
      const id = getSelectedMaterialId();
      return (id && getMaterialAssets()[id]) || null;
    },
    getTextureIds: getMaterialTextureIds,
    isTextureLoaded: (id) => Boolean(getTexture(id)),
    getStatus: getSelectedStatus,
    getViewCamera: getViewCam,
    getCopy: getSelectedCopy,
    setParam: editCopyParam,
    setNodeInput: editCopyNodeInput,
    resetParams: resetMaterialParams,
    onRecordCleared: onMaterialRecordCleared,
    getSettings: getSelectedSettings,
    setSetting: editStageSetting,
    setFov: editCameraFov,
    clearAllRecords: clearAllMaterialEditorData,
    refresh: () => ui?.drawer.refresh(),
  });

/** The HUD: a debugger root (p806 D8: the debugger's theme and density, spared by an app modal's
 * `inert`) kept in views, shown only in this one; the notice, the selector and the drawer in it */
const createUI = (): EditorUI => {
  const rootProps = getDebuggerRootProps();
  const hud = getHUDRootCMP().add({
    ...rootProps,
    class: [styles.materialEditorHud, KEEP_IN_VIEWS_CLASS],
  });
  // "Preview not supported" over the canvas, read when it's set
  const notice = hud.add({ class: styles.notice, text: '', attr: { role: 'status' } });
  const selector = createMaterialSelector({
    parent: hud,
    entries: getSelectorEntries(),
    onSelect,
    getSelectedId: getSelectedMaterialId,
    getLoadingId: () => loadingMaterialId,
    getFailure: (id) => failures.get(id),
    initialState: selectorState,
    onStateChange: (state) => {
      selectorState = state;
      persistUIState();
    },
  });
  drawerMaterialId = getSelectedMaterialId();
  drawerCopy = getSelectedCopy();
  drawerHasSettings = Boolean(getSelectedSettings());
  const drawer = createEditorDrawer({
    id: MATERIAL_EDITOR_VIEW_ID,
    parent: hud.elem,
    togglerText: 'Material',
    headingLabel: 'Material',
    initialState: drawerState,
    onStateChange: (state) => {
      drawerState = state;
      persistUIState();
    },
    getTitle: () => {
      const id = getSelectedMaterialId();
      const asset = id ? getMaterialAssets()[id] : undefined;
      return asset ? asset.debugData?.name || asset.id : 'No material selected';
    },
    getTabs: getDrawerTabs,
  });
  return { hud, notice, selector, drawer };
};

const onEnter = () => {
  ensureEnvironment(ensureStage());
  getViewCamera().onEnter();
  // Right away, not after the textures: nothing else is on the stage yet (the load keeps it)
  applyMaterialStage(getSelectedMaterialId());
  ui ??= createUI();
  // Before the selector's scroll: an open drawer's debugDrawerOpen narrows the selector, and a
  // scroll restored at full width (fewer rows) would be clamped and saved that way
  ui.drawer.setActive(true);
  // The HUD was hidden outside the view (display: none loses the scroll position)
  ui.selector.restoreScroll();
  isEntered = true;
  // Not awaited: the view shows the stage while the textures load
  void loadEditorMaterial(getSelectedMaterialId());
};

const onExit = () => {
  isEntered = false;
  getViewCam()?.onExit();
  // Hands debugDrawerOpen back (the scene drawer sets it again on the switch back)
  ui?.drawer.setActive(false);
  // Discards a load in progress
  loadToken++;
  loadingMaterialId = null;
  // Nothing the editor holds outlives the view (a scene switch can release the copy's textures)
  deleteCurrentCopy();
  retagLoadedTextures();
};

/**
 * The material editor for the test bridge (p806 D14): whether its view is active, its drawer's
 * root (the shell's) and the selector's, the drawer's mounted tab and its tab ids in menu order
 * (read from the tab definitions, so known before the first enter).
 */
export const _getMaterialEditorTestInfo = () => ({
  isActive: getActiveViewId() === MATERIAL_EDITOR_VIEW_ID,
  drawerElement: ui?.drawer.cmp.elem ?? null,
  selectorElement: ui?.selector.elem ?? null,
  mountedId: ui?.drawer.getMountedId() ?? null,
  tabIds: getDrawerTabs().map((def) => def.id),
  selectedId: getSelectedMaterialId(),
  failure: failures.get(getSelectedMaterialId() ?? '') ?? null,
});

/** Opens the editor drawer on a tab (the view entered): the test bridge's. False without it. */
export const _openMaterialEditorTab = (id: string) => ui?.drawer.openTab(id) ?? false;

/** Registers the material editor view (once). */
export const _registerMaterialEditorView = () => {
  // The scene is created here (no GPU work); the environment, the camera and the UI need the
  // renderer, the canvas and the HUD, so they are created on the first enter
  const stage = ensureStage();
  setMaterialEditorHooks({
    loadMaterial: (materialId) => void loadEditorMaterial(materialId),
    refreshDrawer: () => ui?.drawer.refresh(),
    isEntered: () => isEntered,
  });
  // Here, not on the first enter: a loadEditorMaterial call before that wins over the saved one
  const saved = readMaterialEditorUIState();
  selectorState = saved.selector;
  drawerState = saved.drawer;
  const savedId = saved.selectedMaterialId;
  if (savedId && getMaterialAssets()[savedId]) setSelectedMaterialIdValue(savedId);
  // A material that no longer exists is dropped
  else if (savedId) persistUIState();
  registerView({
    id: MATERIAL_EDITOR_VIEW_ID,
    title: 'Material editor',
    icon: 'material',
    iconSize: 'small',
    orderNr: 0,
    scene: stage.scene,
    getCamera: () => getViewCam()?.camera ?? null,
    getCameraRig: () => getViewCam()?.rig ?? null,
    onEnter,
    onExit,
    mainUpdate: () => getViewCam()?.mainUpdate(),
    toggleDrawer: () => ui?.drawer.toggle(),
    update: turnPreview,
  });
};
