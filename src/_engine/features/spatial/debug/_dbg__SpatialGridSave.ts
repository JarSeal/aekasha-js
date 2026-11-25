// The spatial domains' cell sizes' save source (p355 §2.5): a cell size the Spatial index tab
// keeps for a scene's settings (`cellSizeByScene`) goes into the scene JSON's own entry, as its
// `spatialDomains` item, which the gather merges by id over the scene's list. A domain the scene
// JSON doesn't list (registered in code) has nowhere to go.
import { registerSaveSource, type SaveChange } from '../../../debug/SaveData';
import {
  findSceneFile,
  getDevScene,
  getLatestSaveEntry,
  toSaveEntryWrite,
} from '../../../debug/_dbg__SaveEntries';
import { DEFAULT_SPATIAL_DOMAIN } from '../SpatialDomains';
import {
  clearSavedCellSize,
  persistDomainSettings,
  spatialGridTabState,
} from './_dbg__SpatialGridSettings';

/** The save source's id */
export const SPATIAL_GRID_SAVE_SOURCE_ID = 'spatialDomains';

type DomainItem = { id: string } & Record<string, unknown>;

/** Each collected change's scene and domain, for `onSaved` */
const changeKeys = new WeakMap<SaveChange, { sceneId: string; domainId: string }>();

/** A scene's `spatialDomains` list (a scene JSON's, an entry's or the dev data's), [] without one */
const getDomains = (holder: unknown): DomainItem[] => {
  const list = (holder as { spatialDomains?: unknown } | undefined)?.spatialDomains;
  return Array.isArray(list) ? (list as DomainItem[]) : [];
};

/** The fields only `DEFAULT` can leave out (`SceneSpatialDomainsSchema`): an entry keeps them */
const REQUIRED_FIELDS = ['cellSize', 'maxMembers'];

/**
 * A domain's entry item without the fields the file's item has already (the id and, but for
 * `DEFAULT`, the required fields kept); null when every field is the file's.
 */
const pruneDomainItem = (item: DomainItem, fileItem: DomainItem | undefined) => {
  if (!fileItem) return item;
  const isFileValue = (key: string) => item[key] === fileItem[key];
  if (Object.keys(item).every(isFileValue)) return null;
  const isKept = (key: string) =>
    key === 'id' ||
    !isFileValue(key) ||
    (item.id !== DEFAULT_SPATIAL_DOMAIN && REQUIRED_FIELDS.includes(key));
  return Object.fromEntries(Object.entries(item).filter(([key]) => isKept(key))) as DomainItem;
};

/**
 * The scene's latest entry with the domain's cell size in its `spatialDomains`: the domain's item
 * (the file's, the latest entry's over it) with the cell size, pruned against the file's, in the
 * list's place; the list's other items as they are, an emptied list dropped.
 */
const buildEntry = (json: unknown, sceneId: string, domainId: string, cellSize: number) => {
  const entry = getLatestSaveEntry(json, sceneId) ?? {};
  const domains = getDomains(entry);
  const index = domains.findIndex((domain) => domain.id === domainId);
  const fileItem = getDomains(json).find((domain) => domain.id === domainId);
  const item = pruneDomainItem(
    { ...fileItem, ...domains[index], id: domainId, cellSize },
    fileItem
  );
  const list = domains.filter((_, i) => i !== index);
  if (item) list.splice(index === -1 ? list.length : index, 0, item);
  if (list.length) entry.spatialDomains = list;
  else delete entry.spatialDomains;
  return toSaveEntryWrite(json, sceneId, entry);
};

const collectSpatialGridChanges = (): SaveChange[] => {
  const changes: SaveChange[] = [];
  for (const [domainId, settings] of Object.entries(spatialGridTabState.domains)) {
    for (const [sceneId, cellSize] of Object.entries(settings.cellSizeByScene ?? {})) {
      const scene = getDevScene(sceneId);
      const listed = getDomains(scene).find((domain) => domain.id === domainId);
      // The scene has this cell size already: no change
      if (listed?.cellSize === cellSize) continue;
      const file = findSceneFile(sceneId);
      const unsaveable =
        'unsaveable' in file
          ? file.unsaveable
          : !listed
            ? "not in the scene JSON's spatialDomains (registered in code)"
            : undefined;
      const change: SaveChange = {
        id: `${sceneId}:${domainId}`,
        label: `Spatial domain "${domainId}" cell size`,
        scope: 'SCENE',
        sceneId,
        path: 'path' in file && !unsaveable ? file.path : null,
        ...(unsaveable ? { unsaveable } : {}),
        summary: [`spatialDomains.${domainId}.cellSize`],
        build: ({ json }) => buildEntry(json, sceneId, domainId, cellSize),
      };
      changeKeys.set(change, { sceneId, domainId });
      changes.push(change);
    }
  }
  return changes;
};

/** Registers the spatial domains' cell sizes' save source (the Spatial index tab's creation). */
export const registerSpatialGridSaveSource = () =>
  registerSaveSource({
    id: SPATIAL_GRID_SAVE_SOURCE_ID,
    label: 'Spatial domains',
    collect: collectSpatialGridChanges,
    onSaved: (changes) => {
      for (const change of changes) {
        const keys = changeKeys.get(change);
        if (keys) clearSavedCellSize(keys.domainId, keys.sceneId);
      }
      persistDomainSettings();
    },
  });
