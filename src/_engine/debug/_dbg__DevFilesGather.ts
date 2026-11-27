// The gather toasts (p355 §2.4 item 1): the paths this page wrote are kept for 60 s, so a gather
// event naming one is this page's. A gather the reload follows leaves a note in sessionStorage,
// which the debug boot shows after the reload (`showDevFilesGatherNote`); a failed one, or one
// without a reload, toasts at once. Gathers an editor save set off name none of the paths: no toast.
import { CMP } from '../ui/core/CMP';
import { addDebugToast } from './DebuggerGUI';
import { DEV_FILES_GATHER_NOTE_KEY, isDevFilesOptionOn } from './DevFiles';
import type { DevDataGatheredEvent } from './DevFilesProtocol';
import styles from './DevFiles.module.scss';

/** How long a written path finds its gather event */
export const WRITTEN_PATHS_TTL_MS = 60_000;
/** The toast lists this many files, then "and n more" */
const LISTED_FILES_MAX = 8;

/** What a gather after this page's writes leaves for the toast after the reload */
export type GatherNote = {
  /** The paths this page wrote that the gather reacted to */
  files: string[];
  /** The assets the pipeline failed to build */
  assetErrors: DevDataGatheredEvent['assetErrors'];
  // p355 Phase 6
  /** A save's own warnings, shown after the reload ("Save scene"'s materials it
   * couldn't save) */
  warnings?: GatherNoteWarning[];
};

/** A warning toast a gather note carries over the reload */
export type GatherNoteWarning = { title: string; message: string };

/** Each written path's expiry (`performance.now()`) */
const writtenPaths = new Map<string, number>();

/** Remembers the paths a commit wrote (not its unchanged ones: they set off no gather). */
export const _rememberWrittenPaths = (paths: string[], now = performance.now()) => {
  for (const path of paths) writtenPaths.set(path, now + WRITTEN_PATHS_TTL_MS);
};

/** The event's files this page wrote, taken off the list (a write toasts once); [] when none */
export const _takeOwnGatherFiles = (event: DevDataGatheredEvent, now = performance.now()) => {
  for (const [path, expiresAt] of writtenPaths) {
    if (expiresAt <= now) writtenPaths.delete(path);
  }
  const own = event.files.filter((file) => writtenPaths.has(file));
  for (const file of own) writtenPaths.delete(file);
  return own;
};

/** Forgets every written path (tests) */
export const _clearWrittenPaths = () => writtenPaths.clear();

const isGatherNote = (value: unknown): value is GatherNote =>
  !!value &&
  typeof value === 'object' &&
  Array.isArray((value as GatherNote).files) &&
  Array.isArray((value as GatherNote).assetErrors) &&
  ((value as GatherNote).warnings === undefined || Array.isArray((value as GatherNote).warnings));

/** The note in sessionStorage, taken out of it; null when there's none (or it's unreadable) */
export const _takeGatherNote = (): GatherNote | null => {
  try {
    const raw = sessionStorage.getItem(DEV_FILES_GATHER_NOTE_KEY);
    sessionStorage.removeItem(DEV_FILES_GATHER_NOTE_KEY);
    const note: unknown = raw ? JSON.parse(raw) : null;
    return isGatherNote(note) ? note : null;
  } catch {
    return null;
  }
};

/** Adds to the note in sessionStorage: two writes before one reload are one toast */
export const _addToGatherNote = (add: GatherNote) => {
  const note = _takeGatherNote() ?? { files: [], assetErrors: [] };
  const merged: GatherNote = {
    files: [...new Set([...note.files, ...add.files])],
    assetErrors: [
      ...note.assetErrors.filter((error) => !add.assetErrors.some((a) => a.id === error.id)),
      ...add.assetErrors,
    ],
  };
  const warnings = [...(note.warnings ?? []), ...(add.warnings ?? [])];
  if (warnings.length) merged.warnings = warnings;
  try {
    sessionStorage.setItem(DEV_FILES_GATHER_NOTE_KEY, JSON.stringify(merged));
  } catch {
    // No sessionStorage (a private window's quota): the reload drops the toast
  }
};

const createLines = (lines: string[]) => {
  const list = CMP({ tag: 'ul', class: styles.toastList });
  const shown = lines.length > LISTED_FILES_MAX ? lines.slice(0, LISTED_FILES_MAX - 1) : lines;
  for (const line of shown) list.add({ tag: 'li', text: line });
  if (shown.length < lines.length)
    list.add({ tag: 'li', text: `and ${lines.length - shown.length} more` });
  return list;
};

/** The toasts of a gather after this page's writes: the files saved, the asset errors, a save's
 * warnings */
export const _showGatherToasts = (note: GatherNote) => {
  if (note.files.length) {
    const count = note.files.length;
    addDebugToast({
      type: 'success',
      title: `Saved ${count} file${count === 1 ? '' : 's'}`,
      message: createLines(note.files),
    });
  }
  if (note.assetErrors.length) {
    addDebugToast({
      type: 'warning',
      title: 'The gather used the sources of assets that failed to build',
      message: createLines(note.assetErrors.map((error) => `${error.id}: ${error.reason}`)),
      showingTime: 0,
      isClosable: true,
    });
  }
  for (const warning of note.warnings ?? []) addDebugToast({ type: 'warning', ...warning });
};

/** The dev files' gather listener, before the tools' own: toasts, or a note for the reload */
export const _handleOwnGather = (event: DevDataGatheredEvent) => {
  const files = _takeOwnGatherFiles(event);
  if (!files.length || !isDevFilesOptionOn('gatherToasts')) return;
  if (event.status === 'failed') {
    addDebugToast({
      type: 'alert',
      title: 'The gather after the save failed',
      message: event.message ?? 'See the error overlay',
      showingTime: 0,
      isClosable: true,
    });
    return;
  }
  const note = { files, assetErrors: event.assetErrors };
  if (event.willReload) {
    _addToGatherNote(note);
  } else {
    _showGatherToasts(note);
  }
};

/** The note a gather left before the reload, as toasts (the debug boot's, once its toaster is up) */
export const _showGatherNoteAfterReload = () => {
  const note = _takeGatherNote();
  if (note) _showGatherToasts(note);
};
