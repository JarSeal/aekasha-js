// The Assets tab (p806 D10, D11): the asset loading overrides and the worker's status, the list's
// scope (a segmented control) and the loaded assets' list, whose rows open the info windows
// (_dbg__AssetInfoWindow.ts). Its data and state are their own modules.
import {
  createDebuggerTab,
  debuggerListCMP,
  type DebuggerListItem,
  type DebuggerPaneItem,
} from '../../../debug/DebuggerGUI';
import { getNoteItem } from '../../../debug/_dbg__DebugWindowGrid';
import { lsGetItem, lsRemoveItem, lsSetItem } from '../../../utils/LocalAndSessionStorage';
import { createClearTabLSButton, lsKeyHasData } from '../../../debug/_dbg__ClearLSButtons';
import { isLoadingSourceFiles } from '../AssetUrl';
import { DEBUG_ASSETS_BOOT_LS_KEY } from '../../config/Config';
import { getAssetsWorkerInfo, getAssetsWorkerTarget } from '../AssetsAPI';
import type { AssetsWorkerTarget } from '../AssetsAPITypes';
import { getAssetsListState, THREAD_TEXT } from './_dbg__AssetsData';
import { getOpenAssetInfoKeys, openAssetInfoWindow } from './_dbg__AssetInfoWindow';
import {
  ASSETS_TAB_ID,
  ASSETS_UI_LS_KEY,
  assetsUIState,
  persistAssetsScope,
  plural,
  refreshAssetsTab,
  restoreAssetsScope,
  rowKey,
} from './_dbg__AssetsState';

type Item = DebuggerPaneItem<object>;

const getAssetsListData = (): DebuggerListItem[] =>
  getAssetsListState().rows.map((row) => ({
    itemId: rowKey(row.kind, row.id),
    title: row.name,
    subTitle: row.variant ? `${row.id} (${row.variant})` : row.id,
    tooltip: row.id,
    icon: row.kind === 'texture' ? 'texture' : 'geometry',
    ...(row.description ? { description: row.description } : {}),
  }));

/** What the scope leaves out: the loaded assets the scene neither declares nor owns. */
const getScopeNote = () => {
  if (assetsUIState.scope === 'ALL') return '';
  const { notInSceneCount } = getAssetsListState();
  return notInSceneCount
    ? `${plural(notInSceneCount, 'loaded asset')} not in this scene (registered at boot or left by a previous scene): "All loaded" lists them.`
    : '';
};

/** "List": the current scene's assets (declared in its JSON, or owned by it) or every loaded
 * one, saved in the tab's UI key. */
const getScopeItems = (): Item[] => [
  {
    target: assetsUIState,
    key: 'scope',
    label: 'List',
    kind: 'segmented',
    fill: true,
    options: [
      { value: 'SCENE', label: 'This scene' },
      { value: 'ALL', label: 'All loaded' },
    ],
    onChange: () => {
      persistAssetsScope();
      refreshAssetsTab();
    },
  },
  getNoteItem(getScopeNote),
];

// --- Asset loading (assets worker) ---

/** Debug-only boot-time overrides, applied on the next reload: the worker targets by
 * loadConfig(), `loadSourceFiles` by the asset URL resolution (isLoadingSourceFiles). */
type DebugAssetsBoot = {
  workerTarget?: AssetsWorkerTarget;
  gltfWorkerTarget?: AssetsWorkerTarget;
  textureWorkerTarget?: AssetsWorkerTarget;
  simplifyWorkerTarget?: AssetsWorkerTarget;
  /** Load the asset pipeline's source files instead of its outputs (p300 DD8 level 3) */
  loadSourceFiles?: boolean;
};
type WorkerTargetKey =
  | 'workerTarget'
  | 'gltfWorkerTarget'
  | 'textureWorkerTarget'
  | 'simplifyWorkerTarget';

const getBootOverrides = () => lsGetItem(DEBUG_ASSETS_BOOT_LS_KEY, {}) as DebugAssetsBoot;
/** The overrides this page load booted with (nothing else writes the key before this tab). */
let bootedOverrides: DebugAssetsBoot = {};

/** Whether the stored overrides differ from the booted ones, by value (an edit deletes and adds
 * keys, so the stored key order isn't the booted one; a false or empty value is no override). */
const haveBootOverridesChanged = () => {
  const stored = getBootOverrides() as Record<string, unknown>;
  const booted = bootedOverrides as Record<string, unknown>;
  const keys = new Set([...Object.keys(stored), ...Object.keys(booted)]);
  for (const key of keys) {
    if ((stored[key] || undefined) !== (booted[key] || undefined)) return true;
  }
  return false;
};

/** Live worker status, synced on every tab refresh, read by its monitors on the refresh. */
const workerStatus = {
  status: '',
  requests: '',
  fallbacks: '',
  lastFallback: '',
  capabilities: '',
};

const describeWorkerStatus = (): typeof workerStatus => {
  const info = getAssetsWorkerInfo();
  const caps = info.capabilities;
  const fallbacks = Object.entries(info.fallbackCounts)
    .filter(([, count]) => count > 0)
    .map(([cause, count]) => `${cause} ×${count}`);
  const last = info.lastFallback;
  return {
    status:
      info.status === 'FAILED'
        ? `FAILED: ${info.failReason}`
        : info.status === 'NOT_STARTED'
          ? 'NOT_STARTED (starts on the first worker-targeted load)'
          : info.status,
    requests: `${info.inFlight} in flight, ${info.queued} queued`,
    fallbacks: fallbacks.length ? fallbacks.join(', ') : 'none',
    lastFallback: last ? `${last.kind}, ${last.detail}` : '—',
    capabilities: caps
      ? Object.entries(caps)
          .map(([name, isSupported]) => `${name} ${isSupported ? 'yes' : 'NO'}`)
          .join(', ')
      : '—',
  };
};

const statusRow = (key: keyof typeof workerStatus, label: string): Item => ({
  label,
  get: () => workerStatus[key],
  readonly: true,
  interval: 'refresh',
});

/** What this page load resolved: each loader's thread and the files it loads. */
const getResolvedFolder = (): Item => {
  const filesText = isLoadingSourceFiles()
    ? 'Source files (override)'
    : bootedOverrides.loadSourceFiles && !import.meta.env.DEV
      ? 'Pipeline outputs (override ignored: a production build has no sources)'
      : 'Pipeline outputs';
  const row = (label: string, value: string): Item => ({
    label,
    value,
    readonly: true,
    interval: 'refresh',
  });
  return {
    type: 'folder',
    id: 'resolved',
    title: 'Resolved (this page load)',
    content: [
      row('GLTF', THREAD_TEXT[getAssetsWorkerTarget('GLTF')]),
      row('Textures', THREAD_TEXT[getAssetsWorkerTarget('TEXTURE')]),
      row('LOD chains', THREAD_TEXT[getAssetsWorkerTarget('SIMPLIFY')]),
      row('Files', filesText),
    ],
  };
};

const getLoadingFolder = (): Item => {
  // Boot-time targets: written to LS here, applied by loadConfig() on the next reload
  const overrides = getBootOverrides();
  const targetsProxy: Record<WorkerTargetKey, AssetsWorkerTarget | ''> = {
    workerTarget: overrides.workerTarget || '',
    gltfWorkerTarget: overrides.gltfWorkerTarget || '',
    textureWorkerTarget: overrides.textureWorkerTarget || '',
    simplifyWorkerTarget: overrides.simplifyWorkerTarget || '',
  };
  const targetDropDown = (key: WorkerTargetKey, label: string): Item => ({
    key,
    target: targetsProxy,
    label,
    options: [
      { value: '', text: 'No override' },
      { value: 'MAIN_THREAD', text: THREAD_TEXT.MAIN_THREAD },
      { value: 'WORKER_THREAD', text: THREAD_TEXT.WORKER_THREAD },
    ],
    onChange: (value) => {
      const next = { ...getBootOverrides() };
      if (value) next[key] = value as AssetsWorkerTarget;
      else delete next[key];
      lsSetItem(DEBUG_ASSETS_BOOT_LS_KEY, next);
      // Re-evaluates the reload button's disabled state
      refreshAssetsTab();
    },
  });
  const sourceFilesProxy = { loadSourceFiles: Boolean(overrides.loadSourceFiles) };

  return {
    type: 'folder',
    id: 'loading',
    title: 'Asset loading',
    expanded: false,
    content: [
      targetDropDown('workerTarget', 'Default target (boot)'),
      targetDropDown('gltfWorkerTarget', 'GLTF target (boot)'),
      targetDropDown('textureWorkerTarget', 'Texture target (boot)'),
      targetDropDown('simplifyWorkerTarget', 'LOD chain target (boot)'),
      {
        // p300 DD8 level 3: A/B the asset pipeline's outputs against their sources. Only the dev
        // server serves the sources (src/ is the Vite root); a production build ignores it.
        key: 'loadSourceFiles',
        target: sourceFilesProxy,
        label: 'Load source files (boot)',
        onChange: (value) => {
          const next = { ...getBootOverrides() };
          if (value) next.loadSourceFiles = true;
          else delete next.loadSourceFiles;
          lsSetItem(DEBUG_ASSETS_BOOT_LS_KEY, next);
          refreshAssetsTab();
        },
      },
      {
        type: 'button',
        title: 'Reload to apply',
        // Enabled while the saved overrides differ from the ones this page load booted with
        disabled: () => !haveBootOverridesChanged(),
        onClick: () => location.reload(),
      },
      getResolvedFolder(),
      {
        type: 'folder',
        id: 'worker',
        title: 'Assets worker',
        content: [
          statusRow('status', 'Status'),
          statusRow('requests', 'Requests'),
          statusRow('fallbacks', 'Fallbacks'),
          statusRow('lastFallback', 'Last fallback'),
          statusRow('capabilities', 'Capabilities'),
        ],
      },
    ],
  };
};

export const _createAssetsDebugGUI = () => {
  restoreAssetsScope();
  bootedOverrides = getBootOverrides();

  createDebuggerTab({
    id: ASSETS_TAB_ID,
    title: 'Assets',
    icon: 'assets',
    // A refresh re-reads what it shows: kept open on a scene change (p806 D5)
    keepOnSceneChange: true,
    uiLsKey: ASSETS_UI_LS_KEY,
    // The tab's own LS data is its UI key (the scope, the folder states, the info windows')
    clearLSButton: false,
    headerButtons: () => [
      createClearTabLSButton({
        hasData: () => lsKeyHasData(ASSETS_UI_LS_KEY),
        onClear: () => lsRemoveItem(ASSETS_UI_LS_KEY),
        watchKey: ASSETS_UI_LS_KEY,
      }),
    ],
    // No registry change hooks to subscribe to: poll (the list only re-renders when its rows
    // or the scope/scene changed, like the Physics API tab's entity list)
    refreshIntervalMs: 500,
    onRefresh: () => Object.assign(workerStatus, describeWorkerStatus()),
    content: () => {
      Object.assign(workerStatus, describeWorkerStatus());
      return [
        { pane: true, content: [getLoadingFolder(), ...getScopeItems()] },
        debuggerListCMP({
          id: 'assets',
          heading: 'Assets',
          emptyText: 'No loaded assets',
          data: getAssetsListData,
          selectedItemId: getOpenAssetInfoKeys,
          perItemConfig: { onClick: openAssetInfoWindow },
        }),
      ];
    },
  });
};
