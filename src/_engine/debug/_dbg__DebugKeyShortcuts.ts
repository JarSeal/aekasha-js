// The Debug key shortcuts dialog (p806 D10): the app's and the engine's keys for the current
// scene, a tab each (`createTabs`), each section a kit list of rows with their keys as key hints
// (`createKbd`) and their states as badges.
import { CMP } from '../ui/core/CMP';
import type { CMPHandle } from '../ui/core/CMPTypes';
import { createBadge, type BadgeTone } from '../ui/components/Badge';
import { createButton } from '../ui/components/Button';
import { createKbd } from '../ui/components/Kbd';
import { createTabs } from '../ui/components/Tabs';
import { createList } from '../ui/data/List';
import { getConfig } from '../kernel/config/Config';
import { getCurrentSceneId } from '../kernel/scene/Scene';
import { openDialog } from '../ui/overlays/windows/DialogWindow';
import { closeDraggableWindow } from '../ui/overlays/windows/DraggableWindow';
import { getActionMap, getActionMaps } from '../kernel/input/Actions';
import type { ActionBinding, ActionKeys, ActionMap, ActionType } from '../kernel/input/ActionTypes';
import type { EnabledInDebugCam } from '../kernel/input/InputSharedTypes';
import {
  doKeyChordsCollide,
  getKeyBindings,
  getKeyChordLabel,
  type KeyBinding,
  type KeyChord,
} from '../kernel/input/KeyboardInput';
import {
  APP_DEBUG_KEYS_ACTION_MAP_ID,
  DEBUG_KEYS_ACTION_MAP_ID,
  PROD_TEST_KEYS_ACTION_MAP_ID,
  getDefaultDebugKeyBindings,
  type DebugKeyCategory,
  type DefaultDebugKeyBinding,
} from './DefaultDebugKeyBindings';
import type { DebugKeyShortcutsTab } from './DebugTools';
import styles from './DebugKeyShortcuts.module.scss';

const DIALOG_ID = 'debugKeyShortcutsDialog';

const TABS: { id: DebugKeyShortcutsTab; title: string }[] = [
  { id: 'APP', title: 'App (current scene)' },
  { id: 'AEKASHA', title: 'Ækasha' },
];

type Tone = 'muted' | 'info' | 'warning';
type Badge = { text: string; tone: Tone };
/** A row's input: keys (drawn with `createKbd`, a chord or several joined with `' / '`) or another
 * device's input as text ('Left drag', 'Pad A'). */
type ShortcutInput = { keys: string } | { text: string };
type ShortcutRow = {
  /** Unique in its section (the list's key) */
  key: string;
  inputs: ShortcutInput[];
  name: string;
  id?: string;
  description?: string;
  badges: Badge[];
  notes: { text: string; tone: Tone }[];
  isInactive?: boolean;
};
type ShortcutSection = { title: string; description?: string; rows: ShortcutRow[] };

const CATEGORIES: { id: DebugKeyCategory; title: string; description: string }[] = [
  { id: 'DEBUGGER', title: 'Debugger', description: 'Debug mode.' },
  { id: 'CAMERA', title: 'Camera', description: 'Debug mode.' },
  { id: 'LOOPS_AND_MODES', title: 'Loops and modes', description: 'Debug mode.' },
  { id: 'VIEWPORT', title: 'Viewport helpers and tools', description: 'Debug mode.' },
  {
    id: 'PROD_TEST',
    title: 'Production test mode',
    description:
      'Production test mode only (?isProdTest=true). Each key gives way to an app binding of the same key.',
  },
];

/** Engine pointer and context shortcuts that are not key bindings (not rebindable). */
const CONTEXT_SHORTCUTS: { input: ShortcutInput; name: string; context: string }[] = [
  { input: { text: 'Left drag' }, name: 'Orbit the debug camera', context: 'Debug camera' },
  { input: { text: 'Right drag' }, name: 'Pan the debug camera', context: 'Debug camera' },
  { input: { text: 'Wheel' }, name: 'Zoom the debug camera', context: 'Debug camera' },
  {
    input: { text: 'Click' },
    name: 'Align the debug camera to an axis (again: the opposite axis)',
    context: 'Axes gizmo, debug camera',
  },
  { input: { text: 'Drag' }, name: 'Orbit the debug camera', context: 'Axes gizmo, debug camera' },
  { input: { text: 'Click' }, name: 'Pick a point', context: 'Ray tester, pick armed' },
  { input: { keys: 'Escape' }, name: 'Cancel the pick', context: 'Ray tester, pick armed' },
];

const KEY_TYPE_LABELS: { [type in KeyBinding['type']]: string } = {
  KEY_DOWN: 'Key down',
  KEY_UP: 'Key up',
  KEY_HELD: 'Held',
};

const ACTION_TYPE_LABELS: { [type in ActionType]: string } = {
  BUTTON: 'Button',
  AXIS_1D: 'Axis',
  AXIS_2D: '2D axis',
  DELTA_2D: 'Movement',
};

const getChordArray = (chord: KeyChord | KeyChord[]) => (Array.isArray(chord) ? chord : [chord]);

const isInScene = (bindingSceneId: string | undefined, sceneId: string | null) =>
  !bindingSceneId || bindingSceneId === sceneId;

const quote = (name: string) => `“${name}”`;

/** The engine's own maps: listed in the Ækasha tab, not as the app's. */
const isEngineMap = (map: ActionMap) =>
  map.id === DEBUG_KEYS_ACTION_MAP_ID || map.id === PROD_TEST_KEYS_ACTION_MAP_ID;

const toChords = (keys: ActionKeys): KeyChord[] =>
  keys.map((k) => (typeof k === 'string' ? { key: k } : k));

/** An action binding's keyboard chords (none for another device). */
const getBindingChords = (binding: ActionBinding): KeyChord[] => {
  if (binding.device !== 'KEYBOARD') return [];
  if ('keys' in binding) return toChords(binding.keys);
  if ('positive' in binding) return [...toChords(binding.negative), ...toChords(binding.positive)];
  return [
    ...toChords(binding.up),
    ...toChords(binding.down),
    ...toChords(binding.left),
    ...toChords(binding.right),
  ];
};

/** An action binding as keys, or another device's input as text. */
const getBindingInput = (binding: ActionBinding): ShortcutInput => {
  if (binding.device !== 'KEYBOARD') return { text: getBindingText(binding) };
  const keys = getKeyChordLabel(getBindingChords(binding));
  return keys ? { keys } : { text: '–' };
};

/** A mouse, touch or gamepad binding as readable text. */
const getBindingText = (binding: ActionBinding): string => {
  switch (binding.device) {
    case 'MOUSE':
      if ('button' in binding) return `Mouse ${binding.button.toLowerCase()}`;
      return binding.delta === 'MOVE' ? 'Mouse move' : 'Wheel';
    case 'TOUCH':
      return binding.gesture === 'TAP' ? 'Tap' : 'Drag';
    case 'GAMEPAD':
      if ('button' in binding) return `Pad ${binding.button}`;
      return `Pad ${'axis' in binding ? binding.axis : binding.stick}`;
    default:
      return '?';
  }
};

/** A key the app binds (a key binding, or a keyboard binding of an action map), to find the engine
 * keys it shares. */
type AppKeyUser = {
  label: string;
  chords: KeyChord[];
  ignoreModifiers: boolean;
  /** A CONFIG.ts debug key: not there in production test mode. */
  isDebugOnly: boolean;
};

/** Whether the app's key fires for a chord (ignoring modifiers: the key alone). */
const doesUserTakeChord = (user: AppKeyUser, chord: KeyChord | KeyChord[]) =>
  user.ignoreModifiers
    ? getChordArray(chord).some((c) =>
        user.chords.some((u) => u.key.toLowerCase() === c.key.toLowerCase())
      )
    : doKeyChordsCollide(user.chords, chord);

/** Every key the app binds in the current scene: its key bindings and its action maps'. */
const getAppKeyUsers = (sceneId: string | null): AppKeyUser[] => {
  const users: AppKeyUser[] = [];
  for (const binding of getKeyBindings()) {
    if (!isInScene(binding.sceneId, sceneId) || binding.enabled === false) continue;
    users.push({
      label: quote(binding.name || binding.id),
      chords: getChordArray(binding.chord),
      ignoreModifiers: !!binding.ignoreModifiers,
      isDebugOnly: false,
    });
  }
  for (const map of getActionMaps()) {
    if (isEngineMap(map) || !isInScene(map.sceneId, sceneId)) continue;
    for (const [actionId, def] of Object.entries(map.actions)) {
      for (const binding of map.getBindings(actionId)) {
        const chords = getBindingChords(binding);
        if (!chords.length) continue;
        users.push({
          label: quote(def.name || actionId),
          chords,
          // The map's own default isn't on its handle: a map outside DEBUG ignores them by default
          ignoreModifiers:
            binding.device === 'KEYBOARD' && (binding.ignoreModifiers ?? map.context !== 'DEBUG'),
          isDebugOnly: map.id === APP_DEBUG_KEYS_ACTION_MAP_ID,
        });
      }
    }
  }
  return users;
};

/** An engine debug key's chords as its action map binds them now (none: unbound or removed). */
const getLiveEngineChords = (map: ActionMap | undefined, id: string): KeyChord[] =>
  map?.actions[id] ? map.getBindings(id).flatMap(getBindingChords) : [];

// AEKASHA TAB

const getEngineRow = (
  def: Readonly<DefaultDebugKeyBinding>,
  appUsers: AppKeyUser[]
): ShortcutRow => {
  const isProdTestKey = def.category === 'PROD_TEST';
  const override = isProdTestKey ? undefined : getConfig().debugKeys?.find((k) => k.id === def.id);
  const configuredChord = override?.chord ?? def.chord;
  let chord: KeyChord | KeyChord[] = configuredChord;
  const notes: ShortcutRow['notes'] = [];
  let status: Badge = { text: 'Default', tone: 'muted' };
  const setStatus = (text: string, tone: Tone) => {
    if (status.tone !== 'warning') status = { text, tone };
  };

  if (override?.enabled === false) {
    notes.push({ text: 'Turned off in CONFIG.ts (debugKeys).', tone: 'warning' });
    setStatus('Off', 'warning');
  } else if (!isProdTestKey) {
    const map = getActionMap(DEBUG_KEYS_ACTION_MAP_ID);
    const live = getLiveEngineChords(map, def.id);
    if (!map?.actions[def.id]) {
      notes.push({
        text: `Removed by app code (the action map “${DEBUG_KEYS_ACTION_MAP_ID}” was replaced or deleted).`,
        tone: 'warning',
      });
      setStatus('Removed by app', 'warning');
    } else if (!live.length) {
      notes.push({
        text: `Unbound by app code (setBindings on the action map “${DEBUG_KEYS_ACTION_MAP_ID}”).`,
        tone: 'warning',
      });
      setStatus('Unbound by app', 'warning');
    } else {
      if (getKeyChordLabel(live) !== getKeyChordLabel(configuredChord)) {
        chord = live;
        notes.push({
          text: `Rebound by app code (setBindings; configured: ${getKeyChordLabel(configuredChord)}).`,
          tone: 'info',
        });
        setStatus('Rebound by app', 'info');
      }
      if (!map.isActive()) {
        notes.push({
          text: 'Disabled by app code (setEnabled, or setActionContextEnabled for DEBUG).',
          tone: 'warning',
        });
        setStatus('Disabled by app', 'warning');
      }
    }
  }

  if (override && override.enabled !== false) {
    const defaultLabel = getKeyChordLabel(def.chord);
    const countBefore = notes.length;
    if (override.chord && getKeyChordLabel(override.chord) !== defaultLabel) {
      notes.push({ text: `Rebound in CONFIG.ts (default: ${defaultLabel}).`, tone: 'info' });
      setStatus('Rebound', 'info');
    }
    if (override.fn) {
      notes.push({ text: 'Action replaced in CONFIG.ts.', tone: 'info' });
      setStatus('Custom action', 'info');
    }
    if (notes.length === countBefore)
      notes.push({ text: 'Set in CONFIG.ts, same as the default.', tone: 'muted' });
  }

  if (override?.enabled !== false) {
    for (const user of appUsers) {
      if (!doesUserTakeChord(user, chord)) continue;
      if (isProdTestKey) {
        notes.push({ text: `The app's ${user.label} takes this key.`, tone: 'warning' });
        setStatus('App takes over', 'warning');
      } else {
        notes.push({
          text: `Also bound by the app: ${user.label} (both run).`,
          tone: 'warning',
        });
        setStatus('Shared with app', 'warning');
      }
    }
  }

  return {
    key: def.id,
    inputs: [{ keys: getKeyChordLabel(chord) }],
    name: def.name || def.id,
    id: def.id,
    badges: [status],
    notes,
    isInactive: status.tone === 'warning' && status.text !== 'Shared with app',
  };
};

const getAekashaSections = (): ShortcutSection[] => {
  const appUsers = getAppKeyUsers(getCurrentSceneId());
  // In production test mode the app's CONFIG.ts debugKeys are not there
  const prodTestAppUsers = appUsers.filter((u) => !u.isDebugOnly);
  const { debug, prodTest } = getDefaultDebugKeyBindings();
  const all = [...debug, ...prodTest];

  const sections: ShortcutSection[] = CATEGORIES.map((category) => ({
    title: category.title,
    description: category.description,
    rows: all
      .filter((def) => def.category === category.id)
      .map((def) => getEngineRow(def, def.category === 'PROD_TEST' ? prodTestAppUsers : appUsers)),
  }));

  sections.push({
    title: 'Pointer and context',
    description: 'Debug mode. Mouse and context keys, not rebindable.',
    rows: CONTEXT_SHORTCUTS.map(({ input, name, context }, i) => ({
      key: String(i),
      inputs: [input],
      name,
      badges: [{ text: context, tone: 'muted' }],
      notes: [],
    })),
  });

  return sections;
};

// APP TAB

const DEBUG_CAM_BADGES: { [key: string]: Badge } = {
  NOT_ENABLED_IN_DEBUG: { text: 'Not with debug camera', tone: 'warning' },
  ENABLED_ONLY_IN_DEBUG: { text: 'Debug camera only', tone: 'info' },
};

const getDebugCamBadge = (rule: EnabledInDebugCam | undefined): Badge =>
  (rule && DEBUG_CAM_BADGES[rule]) || { text: 'Works with debug camera', tone: 'muted' };

/** An engine key as bound now, to note an app key that shares it. */
type EngineKey = { def: Readonly<DefaultDebugKeyBinding>; chord: KeyChord | KeyChord[] };

/** The engine keys as they are bound now (CONFIG.ts and app rebinding included), with the prod
 * test keys as defined (they are not there in debug mode). */
const getEngineKeys = (): EngineKey[] => {
  const map = getActionMap(DEBUG_KEYS_ACTION_MAP_ID);
  const { debug, prodTest } = getDefaultDebugKeyBindings();
  const isMapActive = !!map?.isActive();
  return [
    ...debug.flatMap((def) => {
      const chord = getLiveEngineChords(map, def.id);
      return isMapActive && chord.length ? [{ def, chord }] : [];
    }),
    ...prodTest.map((def) => ({ def, chord: def.chord })),
  ];
};

/** The notes on an app key that shares an engine key. */
const getEngineKeyNotes = (user: AppKeyUser, engineKeys: EngineKey[]): ShortcutRow['notes'] => {
  const notes: ShortcutRow['notes'] = [];
  for (const { def, chord } of engineKeys) {
    // CONFIG.ts debugKeys are not there in production test mode
    if (user.isDebugOnly && def.category === 'PROD_TEST') continue;
    if (!doesUserTakeChord(user, chord)) continue;
    notes.push(
      def.category === 'PROD_TEST'
        ? {
            text: `Takes Aekasha's ${quote(def.name || def.id)} key in production test mode.`,
            tone: 'info',
          }
        : {
            text: `Also runs Aekasha's ${quote(def.name || def.id)} in debug mode.`,
            tone: 'warning',
          }
    );
  }
  return notes;
};

const getKeyBindingRow = (binding: Readonly<KeyBinding>, engineKeys: EngineKey[]): ShortcutRow => {
  const isDisabled = binding.enabled === false;
  const badges: Badge[] = [
    { text: KEY_TYPE_LABELS[binding.type], tone: 'muted' },
    getDebugCamBadge(binding.enabledInDebugCam),
  ];
  if (isDisabled) badges.push({ text: 'Disabled', tone: 'warning' });
  const user: AppKeyUser = {
    label: '',
    chords: getChordArray(binding.chord),
    ignoreModifiers: !!binding.ignoreModifiers,
    isDebugOnly: false,
  };
  return {
    key: `binding:${binding.id}`,
    inputs: [{ keys: getKeyChordLabel(binding.chord) }],
    name: binding.name || binding.id,
    id: binding.name ? binding.id : undefined,
    description: binding.description,
    badges,
    notes: isDisabled ? [] : getEngineKeyNotes(user, engineKeys),
    isInactive: isDisabled,
  };
};

/** An action map's action. A CONFIG.ts debug key (the app's debug keys' map) shows its key type
 * and debug camera rule from its config entry. */
const getActionRow = (map: ActionMap, actionId: string, engineKeys: EngineKey[]): ShortcutRow => {
  const def = map.actions[actionId];
  const bindings = map.getBindings(actionId);
  const isDebugKey = map.id === APP_DEBUG_KEYS_ACTION_MAP_ID;
  const debugKey = isDebugKey ? getConfig().debugKeys?.find((k) => k.id === actionId) : undefined;
  const isActive = map.isActive();
  const badges: Badge[] = [
    {
      text: isDebugKey ? KEY_TYPE_LABELS[debugKey?.type ?? 'KEY_UP'] : ACTION_TYPE_LABELS[def.type],
      tone: 'muted',
    },
  ];
  if (isDebugKey) {
    badges.push({ text: 'Debug mode only', tone: 'info' });
    badges.push(getDebugCamBadge(debugKey?.enabledInDebugCam));
  } else {
    badges.push({ text: `Action map ${map.id}`, tone: 'muted' });
    badges.push(getDebugCamBadge(map.enabledInDebugCam));
  }
  if (!isActive) badges.push({ text: 'Inactive now', tone: 'warning' });

  const notes: ShortcutRow['notes'] = [];
  for (const binding of bindings) {
    const chords = getBindingChords(binding);
    if (!chords.length) continue;
    const user: AppKeyUser = {
      label: '',
      chords,
      ignoreModifiers:
        binding.device === 'KEYBOARD' && (binding.ignoreModifiers ?? map.context !== 'DEBUG'),
      isDebugOnly: isDebugKey,
    };
    notes.push(...getEngineKeyNotes(user, engineKeys));
  }

  return {
    key: `action:${map.id}:${actionId}`,
    inputs: bindings.map(getBindingInput),
    name: def.name || actionId,
    id: actionId,
    description: def.description,
    badges,
    notes,
    isInactive: !isActive,
  };
};

const getAppSections = (): ShortcutSection[] => {
  const sceneId = getCurrentSceneId();
  const engineKeys = getEngineKeys();
  const debugKeySceneIds = new Map(
    (getConfig().debugKeys || []).map((k) => [k.id, k.sceneId] as const)
  );

  const sceneRows: ShortcutRow[] = [];
  const globalRows: ShortcutRow[] = [];
  const debugOnlyRows: ShortcutRow[] = [];
  let otherSceneCount = 0;
  for (const binding of getKeyBindings()) {
    if (!isInScene(binding.sceneId, sceneId)) {
      otherSceneCount++;
      continue;
    }
    const row = getKeyBindingRow(binding, engineKeys);
    if (binding.sceneId) sceneRows.push(row);
    else globalRows.push(row);
  }
  for (const map of getActionMaps()) {
    if (isEngineMap(map)) continue;
    const isDebugKeys = map.id === APP_DEBUG_KEYS_ACTION_MAP_ID;
    for (const actionId of Object.keys(map.actions)) {
      const actionSceneId = isDebugKeys ? debugKeySceneIds.get(actionId) : map.sceneId;
      if (!isInScene(actionSceneId, sceneId)) {
        otherSceneCount++;
        continue;
      }
      const row = getActionRow(map, actionId, engineKeys);
      if (isDebugKeys) debugOnlyRows.push(row);
      else if (map.sceneId) sceneRows.push(row);
      else globalRows.push(row);
    }
  }

  const otherScenesText = otherSceneCount
    ? ` ${otherSceneCount} key${otherSceneCount === 1 ? '' : 's'} of other scenes not listed.`
    : '';
  return [
    {
      title: `This scene${sceneId ? ` (${sceneId})` : ''}`,
      description: `Key bindings and action maps with this scene's sceneId: every mode, this scene only.${otherScenesText}`,
      rows: sceneRows,
    },
    {
      title: 'All scenes',
      description:
        "Key bindings and action maps without a sceneId: every mode, every scene while they exist (a character's map lives as long as its character). Notice that if the scene that defines these keys has not been loaded yet, they are not listed here.",
      rows: globalRows,
    },
    {
      title: 'Debug keys (CONFIG.ts)',
      description: 'Added with CONFIG.ts debugKeys: debug mode only, every scene.',
      rows: debugOnlyRows,
    },
  ];
};

// RENDERING

const BADGE_TONES: { [tone in Tone]: BadgeTone } = {
  muted: 'neutral',
  info: 'info',
  warning: 'warning',
};

/** A row's inputs: each chord a key hint of its own (so the column wraps between them), another
 * device's input as text, "or" between. */
const createInputs = (row: ShortcutRow) => {
  const cmp = CMP({ class: styles.inputs });
  if (!row.inputs.length) {
    cmp.add({ tag: 'span', class: styles.unbound, text: 'Unbound' });
    return cmp;
  }
  let isFirst = true;
  const addOr = () => {
    if (!isFirst) cmp.add({ tag: 'span', class: styles.or, text: 'or' });
    isFirst = false;
  };
  for (const input of row.inputs) {
    if (!('keys' in input)) {
      addOr();
      cmp.add({ tag: 'span', class: styles.inputText, text: input.text });
      continue;
    }
    for (const chord of input.keys.split(' / ')) {
      addOr();
      cmp.add(createKbd({ keys: chord }).cmp);
    }
  }
  return cmp;
};

/** A shortcut's row: its inputs, then its name and id, description, notes and badges, set as text
 * (the names and descriptions are the app's). An inactive one says why in its badges. */
const renderRow = (row: ShortcutRow) => {
  const cmp = CMP({ class: styles.row, attr: row.isInactive ? { 'data-inactive': '' } : {} });
  cmp.add(createInputs(row));
  const info = cmp.add({ class: styles.info });
  const name = info.add({ tag: 'p', class: styles.name, text: row.name });
  if (row.id) name.add({ tag: 'span', class: styles.id, text: row.id });
  if (row.description) info.add({ tag: 'p', class: styles.description, text: row.description });
  for (const note of row.notes) {
    info.add({ tag: 'p', class: styles.note, attr: { 'data-tone': note.tone }, text: note.text });
  }
  const badges = info.add({ class: styles.badges });
  for (const badge of row.badges) {
    badges.add(createBadge({ label: badge.text, tone: BADGE_TONES[badge.tone] }).cmp);
  }
  return cmp;
};

const createSection = (section: ShortcutSection) => {
  const cmp = CMP({ tag: 'section', class: styles.section });
  cmp.add({ tag: 'h4', text: section.title });
  if (section.description) {
    cmp.add({ tag: 'p', class: styles.sectionDescription, text: section.description });
  }
  cmp.add(
    createList<ShortcutRow>({
      items: section.rows,
      getKey: (row) => row.key,
      title: (row) => row.name,
      render: renderRow,
      label: section.title,
      empty: 'No key bindings.',
      class: styles.list,
    }).cmp
  );
  return cmp;
};

/** A tab's sections, read when the tab is selected (the bindings change with the scene). */
const createTabContent = (tab: DebugKeyShortcutsTab) => {
  const cmp = CMP({ class: styles.tabContent });
  const sections = tab === 'APP' ? getAppSections() : getAekashaSections();
  for (const section of sections) cmp.add(createSection(section));
  return cmp;
};

const createDialogContent = (initialTab: DebugKeyShortcutsTab): CMPHandle => {
  const root = CMP({ class: styles.dialogContent });
  root.add(
    createTabs({
      label: 'Key shortcuts',
      selected: initialTab,
      // Built again on every selection: the scene's bindings can change between them
      keepMounted: false,
      tabs: TABS.map((tab) => ({
        key: tab.id,
        label: tab.title,
        content: () => createTabContent(tab.id),
      })),
      class: styles.tabs,
    }).cmp
  );
  const footer = root.add({ class: styles.footer });
  footer.add(createButton({ label: 'Close', onClick: () => closeDraggableWindow(DIALOG_ID) }).cmp);
  return root;
};

/**
 * Opens the Debug key shortcuts dialog on a tab (switching to it if the dialog is open): the
 * app's key bindings and action maps for the current scene, or the engine's debug and production
 * test mode keys (their action maps) with what the app changed about them.
 * @param tab ('APP' | 'AEKASHA') the tab to show, default 'AEKASHA'
 */
export const openDebugKeyShortcutsDialog = (tab: DebugKeyShortcutsTab = 'AEKASHA') => {
  openDialog({
    id: DIALOG_ID,
    title: 'Debug key shortcuts',
    size: { w: 640, h: 640 },
    isDebugWindow: true,
    backDropClickClosesWindow: true,
    closeOnEscape: true,
    // Built fresh on every open (the bindings change with the scene), and switched to the passed
    // tab when already open (a data change re-runs the content)
    removeOnClose: true,
    removeOnSceneChange: true,
    data: { tab },
    content: (data) => createDialogContent((data?.tab as DebugKeyShortcutsTab) || tab),
  });
};
