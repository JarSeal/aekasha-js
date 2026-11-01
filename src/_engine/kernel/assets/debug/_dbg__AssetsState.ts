// The Assets tab's ids and UI state (p806 D11: out of _dbg__Assets.ts), which the tab and the info
// window both import: the list's scope and the info windows' folder states, in the tab's UI key.
import { updateDebuggerTab } from '../../../debug/DebuggerGUI';
import { lsGetItem, lsSetItem } from '../../../utils/LocalAndSessionStorage';

export type AssetKind = 'texture' | 'geometry';
export type AssetsScope = 'SCENE' | 'ALL';

/** The tab's UI key: the list scope and the info windows' folder states (module-owned) next to
 * the tab's own folder states. */
export const ASSETS_UI_LS_KEY = 'AEK_debugAssetsUI';
export const ASSETS_TAB_ID = 'assetsControls';
/** The info windows' kind: one window per asset, keyed by its row key (`kind:id`) */
export const ASSET_INFO_WIN_ID = 'assetsInfoWindow';

type AssetsUIState = { scope?: AssetsScope; infoFolders?: Record<string, boolean> };

export const assetsUIState: { scope: AssetsScope } = { scope: 'SCENE' };

const readUIState = () => (lsGetItem(ASSETS_UI_LS_KEY, {}) as AssetsUIState | null) || {};

/** Merged, so the tab's folder states in the same key are kept. */
const writeUIState = (patch: AssetsUIState) =>
  lsSetItem(ASSETS_UI_LS_KEY, { ...readUIState(), ...patch });

/** Reads the saved scope (the tab's creation). */
export const restoreAssetsScope = () => {
  const { scope } = readUIState();
  if (scope === 'SCENE' || scope === 'ALL') assetsUIState.scope = scope;
};

export const persistAssetsScope = () => writeUIState({ scope: assetsUIState.scope });

/** The info windows' folder states by folder id (shared by every info window). */
export const getInfoFolderStates = (): Record<string, boolean> => {
  const { infoFolders } = readUIState();
  return infoFolders && typeof infoFolders === 'object' ? infoFolders : {};
};

export const persistInfoFolderState = (id: string, expanded: boolean) =>
  writeUIState({ infoFolders: { ...getInfoFolderStates(), [id]: expanded } });

export const refreshAssetsTab = () => updateDebuggerTab(ASSETS_TAB_ID);

export const rowKey = (kind: AssetKind, id: string) => `${kind}:${id}`;

export const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
