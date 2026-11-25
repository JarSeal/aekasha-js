// The Æ menu's saves (p355 §2.1-§2.2): "Save scene" collects the save sources' changes of the
// current scene and the global ones, reads each file fresh (its hash the write's `expectedHash`,
// so a file edited since fails with CONFLICT), builds one write per file and commits them as one
// batch of the dev files. From the save's start to the reload the Æ button is a spinner and its
// menu is off; it comes back when the commit fails, nothing was written, the gather fails or
// doesn't come within 30 s.
import { getCurrentSceneId } from '../kernel/scene/Scene';
import { deepMerge } from '../utils/DeepMerge';
import { lerror } from '../utils/Logger';
import { addDebugToast } from './DebuggerGUI';
import {
  DevFilesError,
  getDevFilesSaveHistorySize,
  getDevFilesStatus,
  onDevDataGathered,
  readDevFile,
  writeDevFiles,
  type DevFilesStatus,
  type DevFileWrite,
} from './DevFiles';
import type { DevFilesSaveData } from './DevFilesProtocol';
import { updateOnScreenTools } from './OnScreenTools';
import {
  _areSaveSourcesReady,
  _getSaveSources,
  type SaveChange,
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
type SourcedChange = { source: SaveSource; change: SaveChange };

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

/** What "Save scene" saves: the current scene's saveable changes and every global one */
const getSceneSaveChanges = () => {
  const sceneId = getCurrentSceneId();
  return collectChanges().filter(
    ({ change }) => isSaveable(change) && (change.scope === 'GLOBAL' || change.sceneId === sceneId)
  );
};

// The save's state

type SavingState = {
  /** The wait for the gather, once files were written */
  timer: ReturnType<typeof setTimeout> | null;
  removeListener: (() => void) | null;
};
let saving: SavingState | null = null;

/** Whether a save runs (from its start to the reload, or its end) */
export const _isSaving = () => saving !== null;

const startSaving = () => {
  saving = { timer: null, removeListener: null };
  updateOnScreenTools('UNDO');
};

const endSaving = () => {
  if (!saving) return;
  if (saving.timer) clearTimeout(saving.timer);
  saving.removeListener?.();
  saving = null;
  updateOnScreenTools('UNDO');
};

function onSavingTimeout() {
  endSaving();
  addDebugToast({
    type: 'warning',
    title: 'No gather after the save',
    message: 'The files were saved, but the dev server sent no gather in 30 s: reload the page',
    showingTime: 0,
    isClosable: true,
  });
}

/** Ends the save at the gather of these paths when it fails or no reload follows; listening
 * before the commit, so a quick gather isn't missed */
const listenForGather = (paths: string[]) => {
  if (!saving) return;
  const written = new Set(paths);
  saving.removeListener = onDevDataGathered((event) => {
    if (!event.files.some((file) => written.has(file))) return;
    if (event.status === 'failed' || !event.willReload) endSaving();
  });
};

/** Files were written: the save stays on until the reload, or the timeout */
const waitForGather = () => {
  if (saving) saving.timer = setTimeout(onSavingTimeout, SAVING_TIMEOUT_MS);
};

// The writes

/** A file's write as the changes build it: its scenes' entries, or its new JSON */
type FoldedWrite = { saveData: DevFilesSaveData[] } | { json: unknown };

/** Adds a change's write to its file's: an entry for another scene joins the list, one for the
 * same scene is deep-merged into its entry; anything else can't be one write */
const foldWrite = (
  path: string,
  folded: FoldedWrite | null,
  write: SaveChangeWrite | null
): FoldedWrite | null => {
  if (!write) return folded;
  if (!folded) return 'saveData' in write ? { saveData: [write.saveData] } : write;
  if ('saveData' in folded && 'saveData' in write) {
    const { sceneId, entry } = write.saveData;
    const saveData = [...folded.saveData];
    const index = saveData.findIndex((item) => item.sceneId === sceneId);
    if (index === -1) saveData.push(write.saveData);
    else saveData[index] = { sceneId, entry: deepMerge(saveData[index].entry, entry) };
    return { saveData };
  }
  throw new SaveError(`${path}: two changes need writes that can't be merged into one`);
};

/** One write per file, built from the file as it is now */
const buildWrites = async (changes: SourcedChange[]) => {
  const byPath = new Map<string, SaveChange[]>();
  for (const { change } of changes) {
    const path = change.path as string;
    byPath.set(path, [...(byPath.get(path) ?? []), change]);
  }
  const writes = await Promise.all(
    [...byPath].map(async ([path, pathChanges]): Promise<DevFileWrite | null> => {
      const file = await readDevFile(path);
      if (!file) throw new SaveError(`${path} doesn't exist`);
      if (file.json === undefined) throw new SaveError(`${path} isn't a JSON file`);
      let write: FoldedWrite | null = null;
      for (const change of pathChanges) {
        write = foldWrite(path, write, change.build({ json: structuredClone(file.json) }));
      }
      if (!write) return null;
      // One scene's entry goes as the entry (the list is for several)
      if ('saveData' in write && write.saveData.length === 1) {
        return { path, expectedHash: file.sha256, saveData: write.saveData[0] };
      }
      return { path, expectedHash: file.sha256, ...write };
    })
  );
  return writes.filter((write): write is DevFileWrite => write !== null);
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

const toastSaveError = (err: unknown) => {
  if (err instanceof DevFilesError && err.code === 'CANCELLED') {
    addDebugToast({ type: 'info', title: 'Not saved', message: 'The writes were cancelled' });
    return;
  }
  if (!(err instanceof SaveError) && !(err instanceof DevFilesError)) {
    lerror('The save failed', err);
  }
  const code = err instanceof DevFilesError ? `${err.code}: ` : '';
  addDebugToast({
    type: 'alert',
    title: 'Not saved',
    message: `${code}${(err as Error).message}`,
    showingTime: 0,
    isClosable: true,
  });
};

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
 * Saves the current scene's changes and the global ones (p355 §2.1, "Save scene") as one commit:
 * the Æ menu's item and its key. A call while a save runs only toasts.
 */
export const _saveSceneAsync = async (): Promise<void> => {
  if (saving) {
    addDebugToast({ title: SAVING_TEXT });
    return;
  }
  startSaving();
  try {
    const offReason = getSavingOffReason(await _refreshSaveStatus());
    if (offReason) {
      endSaving();
      addDebugToast({ type: 'warning', title: 'Not saved', message: offReason });
      return;
    }
    const changes = getSceneSaveChanges();
    if (!changes.length) {
      endSaving();
      addDebugToast({ title: 'Nothing to save' });
      return;
    }
    const writes = await buildWrites(changes);
    listenForGather(writes.map((write) => write.path));
    const result = writes.length ? await writeDevFiles(writes) : { results: [] };
    // The files have the changes now: the tools drop them before the reload
    notifySaved(changes);
    if (result.results.every((write) => write.status === 'unchanged')) {
      endSaving();
      addDebugToast({ title: 'Nothing to save', message: 'The files have these changes already' });
      return;
    }
    waitForGather();
  } catch (err) {
    endSaving();
    toastSaveError(err);
  }
};
