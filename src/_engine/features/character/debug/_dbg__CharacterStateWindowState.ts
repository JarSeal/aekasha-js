// The Character state window's state (p806 D11): the viewer's settings (`AEK_charStateWin`), the
// open windows' instances, the three groups and the objects their rows read (live, or the freeze's
// copy). The window and its item builders import it; it imports none of them.
import type { Badge } from '../../../ui/components/Badge';
import type { Button } from '../../../ui/components/Button';
import type { CMPHandle } from '../../../ui/core/CMPTypes';
import { lsGetItem, lsSetItem } from '../../../utils/LocalAndSessionStorage';
import type { CharacterObject } from '../CharacterTypes';
import type { CharacterGizmoSet } from './_dbg__CharacterGizmos';
import type { DebugWindowGrid } from '../../../debug/_dbg__DebugWindowGrid';

export type GroupId = 'state' | 'props' | 'internal';
export const GROUPS: { id: GroupId; title: string }[] = [
  { id: 'state', title: 'State' },
  { id: 'props', title: 'Properties' },
  { id: 'internal', title: 'Internal memory' },
];
/** The folders' ids: the groups' and the gizmos' (`groupsOpen`'s keys) */
export type FolderId = GroupId | 'gizmos';

const LS_KEY = 'AEK_charStateWin';

/** Per viewer, shared by all character windows: the last used values are the next window's. */
export type StateWindowSettings = {
  intervalMs: number;
  /** Flash a read-only row when its value changes (the edit fields flash as the kit's do) */
  flash: boolean;
  /** Show each key's note under its row (the configuration keys' and the gizmos') */
  notes: boolean;
  groupsOpen: Record<FolderId, boolean>;
};
export const DEFAULT_SETTINGS: StateWindowSettings = {
  intervalMs: 0,
  flash: true,
  notes: false,
  groupsOpen: { gizmos: true, state: true, props: true, internal: false },
};

export const sanitizeInterval = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/** The saved settings over the defaults (a 5.x object, without `notes` or `gizmos`, loads). */
export const loadSettings = (): StateWindowSettings => {
  let saved: Partial<StateWindowSettings> | null = null;
  try {
    saved = lsGetItem(LS_KEY, {}) as Partial<StateWindowSettings> | null;
  } catch {
    saved = null;
  }
  return {
    intervalMs: sanitizeInterval(saved?.intervalMs),
    flash: typeof saved?.flash === 'boolean' ? saved.flash : DEFAULT_SETTINGS.flash,
    notes: typeof saved?.notes === 'boolean' ? saved.notes : DEFAULT_SETTINGS.notes,
    groupsOpen: { ...DEFAULT_SETTINGS.groupsOpen, ...(saved?.groupsOpen || {}) },
  };
};

export const saveSettings = (settings: StateWindowSettings) => lsSetItem(LS_KEY, settings);

/** A read-only row: what the window's update checks before the grid's refresh reads it. */
export type StateRow = {
  key: string;
  groupId: GroupId;
  /** Whether the value still has the shape the row was built for (false: rebuild the groups) */
  matches: (value: unknown) => boolean;
};

/** A group as built: its rows, so the update can check their shapes. */
export type StateGroup = { id: GroupId; rows: StateRow[] };

/** The freeze's copy of the three objects: what the read-only rows show while frozen. */
export type FrozenData = Record<GroupId, Readonly<Record<string, unknown>>>;

export type StateWindowInstance = {
  charId: string;
  winId: string;
  /** The character, read once per update (and at a build): what the rows read */
  character: CharacterObject | null;
  sceneId: string | null;
  looperIndex: number;
  isDisposed: boolean;
  /** The window's content: the header grid, then the groups' grid */
  root: CMPHandle;
  /** The update interval, flash and notes settings and the toolbar: built once */
  header: DebugWindowGrid | null;
  /** The gizmos and the three groups: rebuilt when the character's keys change */
  groupsGrid: DebugWindowGrid | null;
  groups: StateGroup[];
  keyCount: number;
  settings: StateWindowSettings;
  /** Updates are skipped and the read-only rows show `frozen` (per window, not persisted) */
  isFrozen: boolean;
  frozen: FrozenData | null;
  /** True while the update refreshes the grid: a read-only row flashes a change then only (a
   * folder's reveal, a rebuild and the unfreeze read without a flash) */
  isRefreshing: boolean;
  /** The flashes' disposers, run when the groups' grid goes */
  flashDisposers: (() => void)[];
  /** The character's gizmo set, owned by this window while it lives (null: no character) */
  gizmos: CharacterGizmoSet | null;
  /** Stops the pin button following pin changes made elsewhere (the Characters tab) */
  unsubscribePin: (() => void) | null;
  lastUpdate: number;
  costSum: number;
  costCount: number;
  costShownAt: number;
  costText: CMPHandle | null;
  /** The Properties group's changed count and its two buttons (built with the groups) */
  configActions: { changedText: CMPHandle; copy: Button; resetAll: Button } | null;
  /** The toolbar's saved count and its clear button (hidden while nothing is saved) */
  savedActions: { badge: Badge; clear: Button } | null;
  /** Stops following the saved overrides' LS key */
  unsubscribeSaved: (() => void) | null;
};

/** The open windows' instances, by character id. */
export const instances = new Map<string, StateWindowInstance>();

const NO_DATA: Readonly<Record<string, unknown>> = Object.freeze({});

/** The object a group's rows read: the controller's `state`, `config.values` or `internal` (empty
 * without them). No allocation: it runs on every read. */
export const getGroupSource = (
  character: CharacterObject,
  groupId: GroupId
): Readonly<Record<string, unknown>> => {
  const controller = character.controller;
  if (!controller) return NO_DATA;
  if (groupId === 'state') return controller.state ?? NO_DATA;
  if (groupId === 'props') return controller.config?.values ?? NO_DATA;
  return controller.internal ?? NO_DATA;
};

/** What a read-only row of the window reads: the freeze's copy while frozen, else the live
 * object (empty without the character). */
export const getShownSource = (inst: StateWindowInstance, groupId: GroupId) => {
  if (inst.frozen) return inst.frozen[groupId];
  return inst.character ? getGroupSource(inst.character, groupId) : NO_DATA;
};

/** A copy of a group's object deep enough for its rows: each value, an array's or an object's
 * one level down (a vector's components, an array's numbers). */
const copyGroupSource = (source: Readonly<Record<string, unknown>>) => {
  const copy: Record<string, unknown> = {};
  for (const key of Object.keys(source)) {
    const value = source[key];
    if (Array.isArray(value)) copy[key] = value.slice();
    else if (value && typeof value === 'object') copy[key] = { ...value };
    else copy[key] = value;
  }
  return copy;
};

/** The three objects copied at the freeze (once, on the click). */
export const copyFrozenData = (character: CharacterObject): FrozenData => ({
  state: copyGroupSource(getGroupSource(character, 'state')),
  props: copyGroupSource(getGroupSource(character, 'props')),
  internal: copyGroupSource(getGroupSource(character, 'internal')),
});

/** The controller's configuration values, writable (empty without them). */
export const getConfigValues = (character: CharacterObject) =>
  (character.controller?.config?.values ?? NO_DATA) as Record<string, unknown>;

/** The controller's creation-time configuration (empty without it). */
export const getInitialConfig = (character: CharacterObject) =>
  (character.controller?.config?.initial ?? NO_DATA) as Readonly<Record<string, unknown>>;

export const RAD_TO_DEG = 180 / Math.PI;
