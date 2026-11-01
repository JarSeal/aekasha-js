// The Assets tab's info window (p806 D10, D11: out of _dbg__Assets.ts): one window per texture or
// geometry, a property grid of monitors with a folder per section, kept open on a scene change
// while its asset is still loaded. Its kind is registered at this module's load.
import { llog } from '../../../utils/Logger';
import {
  getDraggableWindowsOfKind,
  getKindWindowId,
  registerDraggableWindowKind,
  toggleDraggableWindow,
} from '../../../ui/overlays/windows/DraggableWindow';
import type { PropertyGrid } from '../../../ui/forms/PropertyGrid';
import { createDebugWindowGrid, getNoteItem } from '../../../debug/_dbg__DebugWindowGrid';
import { getGeometryRegistry } from '../Geometry';
import { getTextureRegistry } from '../Texture';
import { getAllAssetRows, isAssetLoaded } from './_dbg__AssetsData';
import { forgetTexturePreviewState } from './_dbg__AssetsPreview';
import type { AssetInfoCtx } from './_dbg__AssetInfoParts';
import { getGeometryInfoItems } from './_dbg__GeometryInfoItems';
import { getTextureInfoItems } from './_dbg__TextureInfoItems';
import {
  ASSET_INFO_WIN_ID,
  getInfoFolderStates,
  persistInfoFolderState,
  refreshAssetsTab,
  rowKey,
  type AssetKind,
} from './_dbg__AssetsState';

type InfoWindowData = { key: string; kind: AssetKind; id: string };

/** List row click: opens the asset's window, brings it to the front, or closes it when on top. */
export const openAssetInfoWindow = (key: string) => {
  const row = getAllAssetRows().find((r) => rowKey(r.kind, r.id) === key);
  if (!row) return;
  toggleDraggableWindow({
    id: getKindWindowId(ASSET_INFO_WIN_ID, key),
    kind: ASSET_INFO_WIN_ID,
    position: { x: 110, y: 60 },
    size: { w: 420, h: 520 },
    saveToLS: true,
    title: `${row.kind === 'texture' ? 'Texture' : 'Geometry'}: ${row.name}`,
    isDebugWindow: true,
    data: { key, kind: row.kind, id: row.id },
    closeOnSceneChange: true,
  });
};

/** The rows the list selects: the open info windows' assets. */
export const getOpenAssetInfoKeys = () =>
  getDraggableWindowsOfKind(ASSET_INFO_WIN_ID).map((win) => String(win.data?.key));

const createInfoContent = (data?: { [key: string]: unknown }) => {
  const d = data as InfoWindowData;
  // The content is built before the window state is open: refresh the list selection after it
  queueMicrotask(refreshAssetsTab);
  if (!isAssetLoaded(d)) {
    return createDebugWindowGrid({
      items: [getNoteItem(`The ${d.kind} "${d.id}" is not loaded (any more).`)],
    }).cmp;
  }

  const windowId = getKindWindowId(ASSET_INFO_WIN_ID, rowKey(d.kind, d.id));
  let grid: PropertyGrid | null = null;
  let isMounted = true;
  const ctx: AssetInfoCtx = {
    refresh: () => grid?.refresh(),
    isMounted: () => isMounted,
  };
  const log = () => {
    if (d.kind === 'texture') {
      const entry = getTextureRegistry()[d.id];
      llog('TEXTURE:***************', { id: d.id, texture: entry?.resource, entry });
    } else {
      const entry = getGeometryRegistry()[d.id];
      llog('GEOMETRY:***************', { id: d.id, geometry: entry?.resource, entry });
    }
  };
  const items =
    d.kind === 'texture'
      ? getTextureInfoItems(d.id, windowId, ctx)
      : getGeometryInfoItems(d.id, windowId, ctx);
  const built = createDebugWindowGrid({
    items: [{ type: 'button', title: 'Log to the console', onClick: log }, ...items],
    folderExpanded: getInfoFolderStates(),
    onFolderExpandedChange: persistInfoFolderState,
    onRemove: () => {
      isMounted = false;
    },
  });
  grid = built.grid;
  return built.cmp;
};

/** Registers the info windows' kind (this module's load: before the saved windows are restored). */
registerDraggableWindowKind(ASSET_INFO_WIN_ID, {
  content: createInfoContent,
  onClose: (id) => {
    forgetTexturePreviewState(id);
    refreshAssetsTab();
  },
  // Kept open on a scene change when the asset is still loaded (eg. shared with the next scene)
  sceneTargetResolver: (data) => isAssetLoaded(data as InfoWindowData),
});
