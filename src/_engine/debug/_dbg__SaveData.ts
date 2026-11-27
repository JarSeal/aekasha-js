// The Æ menu's saves (p355 §2.1-§2.3): a save collects the save sources' changes, keeps the
// saveable ones a filter picks ("Save scene": the current scene's and the global ones; the "Save
// specific data…" dialog: the checked ones), reads each file fresh (its hash the write's
// `expectedHash`, so a file edited since fails with CONFLICT), builds one write per file (two
// scenes' entries of one file a list; a camera, light or sky box written inline in a scene JSON
// moved into a new file with its entry, its id in its place, §2.6) and commits them as one batch
// of the dev files. From the save's start to the reload the Æ button is a spinner and its menu is
// off; it comes back when the commit fails, nothing was written, the gather fails or doesn't come
// within 30 s. "Save scene" names the scene's edited materials it couldn't save (p355 Phase 6) in
// a warning toast, after the reload when one follows (the gather note).
import { getCurrentSceneId } from '../kernel/scene/Scene';
import { lerror } from '../utils/Logger';
import { addDebugToast } from './DebuggerGUI';
import {
  DevFilesError,
  getDevFilesSaveHistorySize,
  getDevFilesStatus,
  onDevDataGathered,
  readDevFile,
  writeConfirmedDevFiles,
  writeDevFiles,
  type DevFilesStatus,
  type DevFileWrite,
} from './DevFiles';
import type { DevFilesSaveData } from './DevFilesProtocol';
import { _addToGatherNote, type GatherNoteWarning } from './_dbg__DevFilesGather';
import { getInlineFileSchemaRef, getLatestSaveEntry, getListItemId } from './_dbg__SaveEntries';
import { getUnsavedMaterialsWarning } from './editors/material/_dbg__MaterialSave';
import { updateOnScreenTools } from './OnScreenTools';
import {
  _areSaveSourcesReady,
  _getSaveSources,
  type SaveChange,
  type SaveChangeExtract,
  type SaveChangeWrite,
  type SaveSource,
} from './SaveData';

/** The Æ button's tooltip while a save runs, and the toast of a save key meanwhile */
export const SAVING_TEXT = 'Saving…';
/** How long a save waits for its gather before the menu comes back */
export const SAVING_TIMEOUT_MS = 30_000;

/** A save that can't go on: its message is the toast's */
class SaveError extends Error {}

/** A collected change with its source */
export type SourcedChange = { source: SaveSource; change: SaveChange };

// The dev files' status, read when the menu opens (the items' states are read synchronously)
let devFilesStatus: DevFilesStatus | null = null;
let statusRequest: Promise<DevFilesStatus> | null = null;

/** Reads the dev files' status again (one request at a time); the menu's items read the last one */
export const _refreshSaveStatus = () => {
  statusRequest ??= getDevFilesStatus().then((status) => {
    devFilesStatus = status;
    statusRequest = null;
    return status;
  });
  return statusRequest;
};

/** Why nothing can be saved now (the debugger's boot, the dev files, the save history size), or
 * null */
const getSavingOffReason = (status: DevFilesStatus | null) => {
  if (!_areSaveSourcesReady()) return 'The debugger is still starting';
  if (!status) return 'Checking the dev file server…';
  if (!status.available) return status.message;
  if (getDevFilesSaveHistorySize() === 0) {
    return 'Saving is off: the save history size is 0 (Debug tools → File server)';
  }
  return null;
};

/** Every source's changes; a source whose collect throws fails it */
const collectChanges = (): SourcedChange[] => {
  const changes: SourcedChange[] = [];
  for (const source of _getSaveSources()) {
    let collected: SaveChange[];
    try {
      collected = source.collect();
    } catch (err) {
      lerror(`Save source "${source.id}" failed to collect its changes`, err);
      throw new SaveError(`${source.label} failed to list its changes: ${(err as Error).message}`);
    }
    for (const change of collected) changes.push({ source, change });
  }
  return changes;
};

const isSaveable = (change: SaveChange) => change.path !== null && !change.unsaveable;

/** Whether the current scene's changes (or a global one) are what "Save scene" saves */
const isSceneChange = (change: SaveChange, sceneId: string | null) =>
  change.scope === 'GLOBAL' || change.sceneId === sceneId;

/** What "Save scene" saves: the current scene's saveable changes and every global one */
const getSceneSaveChanges = () => {
  const sceneId = getCurrentSceneId();
  return collectChanges().filter(
    ({ change }) => isSaveable(change) && isSceneChange(change, sceneId)
  );
};

// The save's state

type SavingState = {
  /** The wait for the gather, once files were written */
  timer: ReturnType<typeof setTimeout> | null;
  removeListener: (() => void) | null;
  /** Shown once the files are written: after the reload, or at once without one */
  warning: GatherNoteWarning | null;
};
let saving: SavingState | null = null;

/** Whether a save runs (from its start to the reload, or its end) */
export const _isSaving = () => saving !== null;

const startSaving = (warning: GatherNoteWarning | null) => {
  saving = { timer: null, removeListener: null, warning };
  updateOnScreenTools('UNDO');
};

const endSaving = () => {
  if (!saving) return;
  if (saving.timer) clearTimeout(saving.timer);
  saving.removeListener?.();
  saving = null;
  updateOnScreenTools('UNDO');
};

const showWarning = (warning: GatherNoteWarning | null | undefined) => {
  if (warning) addDebugToast({ type: 'warning', ...warning });
};

/** Ends the save at its gather, its warning shown at once (no reload follows) */
const endSavingWithWarning = () => {
  const warning = saving?.warning;
  endSaving();
  showWarning(warning);
};

function onSavingTimeout() {
  const warning = saving?.warning;
  endSaving();
  addDebugToast({
    type: 'warning',
    title: 'No gather after the save',
    message: 'The files were saved, but the dev server sent no gather in 30 s: reload the page',
    showingTime: 0,
    isClosable: true,
  });
  showWarning(warning);
}

/** Ends the save at the gather of these paths when it fails or no reload follows, else leaves its
 * warning for after the reload; listening before the commit, so a quick gather isn't missed */
const listenForGather = (paths: string[]) => {
  if (!saving) return;
  const written = new Set(paths);
  saving.removeListener = onDevDataGathered((event) => {
    if (!saving || !event.files.some((file) => written.has(file))) return;
    if (event.status === 'failed' || !event.willReload) {
      endSavingWithWarning();
    } else if (saving.warning) {
      _addToGatherNote({ files: [], assetErrors: [], warnings: [saving.warning] });
      saving.warning = null;
    }
  });
};

/** Files were written: the save stays on until the reload, or the timeout */
const waitForGather = () => {
  if (saving) saving.timer = setTimeout(onSavingTimeout, SAVING_TIMEOUT_MS);
};

// The writes

const isObj = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A file's write as the changes build it: its scenes' entries, or its new JSON */
type FoldedWrite = { saveData: DevFilesSaveData[] } | { json: unknown };

/** Adds a change's write to its file's: an entry for another scene joins the list, one for the
 * same scene replaces its entry (built over it: `withBuiltEntries`); anything else can't be one
 * write */
const foldWrite = (
  path: string,
  folded: FoldedWrite | null,
  write: SaveChangeWrite | null
): FoldedWrite | null => {
  if (!write) return folded;
  if (!folded) return 'saveData' in write ? { saveData: [write.saveData] } : write;
  if ('saveData' in folded && 'saveData' in write) {
    const saveData = [...folded.saveData];
    const index = saveData.findIndex((item) => item.sceneId === write.saveData.sceneId);
    if (index === -1) saveData.push(write.saveData);
    else saveData[index] = write.saveData;
    return { saveData };
  }
  throw new SaveError(`${path}: two changes need writes that can't be merged into one`);
};

/**
 * A copy of the file as the next change's build sees it: each scene's entry the changes before it
 * built is that scene's latest, so the build lays its change over theirs. (A deep merge of two
 * builds can't drop a key: one change pruning a value back to the file's would lose to the
 * other's copy of the latest entry.)
 */
const withBuiltEntries = (json: unknown, folded: FoldedWrite | null) => {
  if (!folded || !('saveData' in folded) || !isObj(json)) return structuredClone(json);
  const saveData = isObj(json.__saveData) ? { ...json.__saveData } : {};
  for (const { sceneId, entry } of folded.saveData) {
    const entries: unknown = saveData[sceneId];
    saveData[sceneId] = [entry, ...(Array.isArray(entries) ? entries : [])];
  }
  return structuredClone({ ...json, __saveData: saveData });
};

/** The folded entries without an empty one for a scene the file has none for (a later build left
 * it empty: nothing to replace) */
const dropEmptyNewEntries = (json: unknown, folded: FoldedWrite | null) => {
  if (!folded || !('saveData' in folded)) return folded;
  const saveData = folded.saveData.filter(
    ({ sceneId, entry }) => Object.keys(entry).length || getLatestSaveEntry(json, sceneId)
  );
  return saveData.length ? { saveData } : null;
};

/** An inline asset's move (§2.6) */
type MoveChange = SaveChange & { path: string; extract: SaveChangeExtract };

const isMove = (change: SaveChange): change is MoveChange => !!change.extract;

/** Refuses two moves of one asset (two scenes writing the same id inline): both files would
 * claim it, and the gather fails on an id two files have */
const checkMoves = (moves: MoveChange[]) => {
  const seen = new Map<string, MoveChange>();
  for (const move of moves) {
    const key = `${move.extract.list}:${move.extract.id}`;
    const other = seen.get(key);
    if (other) {
      throw new SaveError(
        `${move.label} would move into ${other.path} and ${move.path}: save one scene's at a time`
      );
    }
    seen.set(key, move);
  }
};

/**
 * Takes an inline asset out of the scene JSON (in place): its item, replaced in its list by its
 * id; throws when the list hasn't it inline (the file changed since the page loaded)
 */
const takeInlineItem = (scenePath: string, sceneJson: unknown, extract: SaveChangeExtract) => {
  const items = isObj(sceneJson) ? sceneJson[extract.list] : undefined;
  const index = Array.isArray(items)
    ? items.findIndex((item) => isObj(item) && getListItemId(extract.list, item) === extract.id)
    : -1;
  if (index === -1) {
    throw new SaveError(
      `${scenePath} has no inline "${extract.id}" in its ${extract.list} any more: reload the page`
    );
  }
  const list = items as unknown[];
  const item = list[index] as Record<string, unknown>;
  list[index] = extract.id;
  return item;
};

/** A moved asset's new file: the item as it was, its `$schema` first, and the change's entry for
 * its scene; null when the item has the change already (it stays inline) */
const buildMoveWrite = (move: MoveChange, item: Record<string, unknown>) => {
  const write = move.build({ json: structuredClone(item) });
  if (!write) return null;
  if (!('saveData' in write)) {
    throw new SaveError(`${move.label}: an inline asset's move takes a save entry, not a JSON`);
  }
  const $schema = getInlineFileSchemaRef(move.extract.list, move.path);
  const json = { ...($schema ? { $schema } : {}), ...item };
  // Must not exist yet: a file put there since the page loaded is a CONFLICT (a gathered one makes
  // the change Not saveable already; a read first would log its 404 as a console error)
  return { path: move.path, expectedHash: null, json, saveData: write.saveData };
};

/**
 * A file's writes: the moved assets' new files (§2.6) and the file's own write (its changes'
 * entries, the moved items replaced by their ids), built from the file as it is now
 */
const buildFileWrites = async (
  path: string,
  pathChanges: SaveChange[],
  moves: MoveChange[]
): Promise<DevFileWrite[]> => {
  const file = await readDevFile(path);
  if (!file) throw new SaveError(`${path} doesn't exist`);
  if (file.json === undefined) throw new SaveError(`${path} isn't a JSON file`);
  const json = structuredClone(file.json);
  const writes: DevFileWrite[] = [];
  for (const move of moves) {
    // From a copy: an item that has the change already stays inline
    const item = takeInlineItem(path, structuredClone(json), move.extract);
    const write = buildMoveWrite(move, item);
    if (!write) continue;
    takeInlineItem(path, json, move.extract);
    writes.push(write);
  }
  const isMoved = writes.length > 0;
  let folded: FoldedWrite | null = null;
  for (const change of pathChanges) {
    folded = foldWrite(path, folded, change.build({ json: withBuiltEntries(json, folded) }));
  }
  const write = dropEmptyNewEntries(json, folded);
  if (write && 'json' in write && isMoved) {
    throw new SaveError(`${path}: two changes need writes that can't be merged into one`);
  }
  const saveData = write && 'saveData' in write ? write.saveData : [];
  // One scene's entry goes as the entry (the list is for several)
  const entries = saveData.length === 1 ? { saveData: saveData[0] } : { saveData };
  if (isMoved) {
    // The moved items' ids in their place, the file's entries applied over it by the server
    writes.push({ path, expectedHash: file.sha256, json, ...(saveData.length ? entries : {}) });
  } else if (write && 'json' in write) {
    writes.push({ path, expectedHash: file.sha256, json: write.json });
  } else if (saveData.length) {
    writes.push({ path, expectedHash: file.sha256, ...entries });
  }
  return writes;
};

/** One write per file, built from the file as it is now; an inline asset's move adds its new
 * file, before the scene JSON's write (§2.6) */
const buildWrites = async (changes: SourcedChange[]) => {
  const byPath = new Map<string, { changes: SaveChange[]; moves: MoveChange[] }>();
  const getPath = (path: string) => {
    const entry = byPath.get(path) ?? { changes: [], moves: [] };
    byPath.set(path, entry);
    return entry;
  };
  const moves: MoveChange[] = [];
  for (const { change } of changes) {
    if (isMove(change)) {
      moves.push(change);
      getPath(change.extract.scenePath).moves.push(change);
    } else {
      getPath(change.path as string).changes.push(change);
    }
  }
  checkMoves(moves);
  const writes = await Promise.all(
    [...byPath].map(([path, entry]) => buildFileWrites(path, entry.changes, entry.moves))
  );
  return writes.flat();
};

/** Each source's `onSaved` with its changes */
const notifySaved = (changes: SourcedChange[]) => {
  const bySource = new Map<SaveSource, SaveChange[]>();
  for (const { source, change } of changes) {
    bySource.set(source, [...(bySource.get(source) ?? []), change]);
  }
  for (const [source, sourceChanges] of bySource) {
    try {
      source.onSaved(sourceChanges);
    } catch (err) {
      lerror(`Save source "${source.id}" failed after the save`, err);
    }
  }
};

/** A failed save's text: the dev files' code, then the message */
export const _getSaveErrorText = (err: unknown) => {
  if (!(err instanceof SaveError) && !(err instanceof DevFilesError)) {
    lerror('The save failed', err);
  }
  const code = err instanceof DevFilesError ? `${err.code}: ` : '';
  return `${code}${(err as Error).message}`;
};

/** What a save of the changes ended with */
export type SaveResult =
  /** Files were written: the save stays on until the reload (or the gather's failure) */
  | { status: 'SAVED' }
  /** Nothing to write (`message` when the files had the changes already): the save ended */
  | { status: 'NOTHING'; message?: string }
  /** Saving is off now (`reason`: the boot, the dev files, a history size of 0, a save running):
   * nothing was tried */
  | { status: 'OFF'; reason: string }
  /** It failed before or at the commit: nothing was written, and the changes stay */
  | { status: 'FAILED'; error: unknown };

/** Picks the collected changes a save writes (only saveable ones reach it) */
export type SaveChangeFilter = (change: SaveChange, source: SaveSource) => boolean;

// p355 §2.1
/**
 * Saves the saveable changes `filter` picks, collected again when the save starts, as one commit:
 * a fresh read of each file, one write per file, every source's `onSaved` after the
 * commit. "Save scene"'s and the "Save specific data…" dialog's; neither toasts here.
 * @param opts.skipConfirm no "Confirm writes" dialog (the "Save specific data…" dialog is its own)
 * @param opts.warning a warning toast for a save that writes files (`SAVED`), after the reload
 * (or at once when none follows); any other result leaves it to the caller
 */
export const _saveChangesAsync = async (
  filter: SaveChangeFilter,
  opts: { skipConfirm?: boolean; warning?: GatherNoteWarning | null } = {}
): Promise<SaveResult> => {
  if (saving) return { status: 'OFF', reason: SAVING_TEXT };
  startSaving(opts.warning ?? null);
  try {
    const offReason = getSavingOffReason(await _refreshSaveStatus());
    if (offReason) {
      endSaving();
      return { status: 'OFF', reason: offReason };
    }
    const changes = collectChanges().filter(
      ({ source, change }) => isSaveable(change) && filter(change, source)
    );
    if (!changes.length) {
      endSaving();
      return { status: 'NOTHING' };
    }
    const writes = await buildWrites(changes);
    listenForGather(writes.map((write) => write.path));
    const write = opts.skipConfirm ? writeConfirmedDevFiles : writeDevFiles;
    const result = writes.length ? await write(writes) : { results: [] };
    // The files have the changes now: the tools drop them before the reload
    notifySaved(changes);
    if (result.results.every((item) => item.status === 'unchanged')) {
      endSaving();
      return { status: 'NOTHING', message: 'The files have these changes already' };
    }
    waitForGather();
    return { status: 'SAVED' };
  } catch (err) {
    endSaving();
    return { status: 'FAILED', error: err };
  }
};

/** Every source's changes with their sources, for a list (the "Save specific data…" dialog's
 * rows); throws a source's failure to list them */
export const _collectSaveChanges = (): SourcedChange[] => collectChanges();

/** Whether a change can be saved: it has a file, and no reason it can't */
export const _isSaveableChange = isSaveable;

/**
 * Why "Save scene" is off now, or null when it can save: a save running, the dev files
 * unavailable, saving off (a save history size of 0), nothing to save. Read when the Æ menu opens,
 * against the last status `_refreshSaveStatus` read.
 */
export const _getSaveSceneDisabledReason = (): string | null => {
  if (saving) return SAVING_TEXT;
  const offReason = getSavingOffReason(devFilesStatus);
  if (offReason) return offReason;
  try {
    return getSceneSaveChanges().length ? null : 'Nothing to save in this scene';
  } catch (err) {
    return (err as Error).message;
  }
};

/**
 * Why "Save specific data…" is off now, or null when it can open: as "Save scene", but nothing
 * saveable in any scene (or global) turns it off. Read when the Æ menu opens and by its key.
 */
export const _getSaveSpecificDisabledReason = (): string | null => {
  if (saving) return SAVING_TEXT;
  const offReason = getSavingOffReason(devFilesStatus);
  if (offReason) return offReason;
  try {
    return collectChanges().some(({ change }) => isSaveable(change)) ? null : 'Nothing to save';
  } catch (err) {
    return (err as Error).message;
  }
};

// p355 §2.3
/**
 * Opens the "Save specific data…" dialog: the Æ menu's item and its key. With
 * nothing to save, saving off or a save running, a toast says why instead.
 */
export const _openSaveSpecificAsync = async (): Promise<void> => {
  if (saving) {
    addDebugToast({ title: SAVING_TEXT });
    return;
  }
  await _refreshSaveStatus();
  const reason = _getSaveSpecificDisabledReason();
  if (reason) {
    addDebugToast({ type: 'warning', title: 'Not saved', message: reason });
    return;
  }
  // Loaded on first use: its form and checkboxes aren't the Æ menu's
  const { openSaveSpecificDialog } = await import('./_dbg__SaveSpecificDialog');
  openSaveSpecificDialog();
};

/** The warning about the scene's edited materials "Save scene" can't save; null when there are
 * none, or the collect fails (the save then fails with it) */
const getUnsavedMaterials = (sceneId: string | null) => {
  try {
    return getUnsavedMaterialsWarning(
      collectChanges().map(({ change }) => change),
      sceneId
    );
  } catch {
    return null;
  }
};

// p355 §2.1
/**
 * Saves the current scene's changes and the global ones ("Save scene") as one commit:
 * the Æ menu's item and its key, toasting how it went. A call while a save runs only toasts.
 */
export const _saveSceneAsync = async (): Promise<void> => {
  if (saving) {
    addDebugToast({ title: SAVING_TEXT });
    return;
  }
  const sceneId = getCurrentSceneId();
  const warning = getUnsavedMaterials(sceneId);
  const result = await _saveChangesAsync((change) => isSceneChange(change, sceneId), { warning });
  if (result.status === 'OFF') {
    addDebugToast({ type: 'warning', title: 'Not saved', message: result.reason });
  } else if (result.status === 'NOTHING') {
    // Only unsaveable materials: their warning says it
    if (result.message || !warning) {
      addDebugToast({ title: 'Nothing to save', message: result.message });
    }
    showWarning(warning);
  } else if (result.status === 'FAILED') {
    const { error } = result;
    if (error instanceof DevFilesError && error.code === 'CANCELLED') {
      addDebugToast({ type: 'info', title: 'Not saved', message: 'The writes were cancelled' });
      return;
    }
    addDebugToast({
      type: 'alert',
      title: 'Not saved',
      message: _getSaveErrorText(error),
      showingTime: 0,
      isClosable: true,
    });
  }
};
