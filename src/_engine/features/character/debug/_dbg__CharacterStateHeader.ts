// The Character state window's header (p806 D10, D11): the toolbar (freeze, copy, pin; the frozen
// and saved badges, the clear button, the update's cost), the window's settings as fields, and
// the Gizmos folder.
import { addDebugToast } from '../../../debug/DebuggerGUI';
import { createBadge } from '../../../ui/components/Badge';
import { createButton } from '../../../ui/components/Button';
import { createButtonGroup } from '../../../ui/components/ButtonGroup';
import { getSvgIcon } from '../../../ui/core/icons/SvgIcon';
import type {
  PropertyGridCustomItem,
  PropertyGridFolderItem,
  PropertyGridItem,
} from '../../../ui/forms/PropertyGridItems';
import { llog } from '../../../utils/Logger';
import { getCharacterById } from '../Character';
import {
  CHARACTER_GIZMOS,
  isCharacterGizmoAvailable,
  isCharacterGizmosPinned,
  onCharacterGizmoPinsChange,
  setCharacterGizmoDepthTest,
  setCharacterGizmoEnabled,
  setCharacterGizmosPinned,
  setCharacterGizmoVectorScale,
  type CharacterGizmoSet,
} from './_dbg__CharacterGizmos';
import {
  clearSavedCharacterConfig,
  getSavedCharacterConfig,
} from './_dbg__CharacterConfigOverrides';
import { LATE_VALUE_NOTE } from './_dbg__CharacterStateRows';
import {
  DEFAULT_SETTINGS,
  sanitizeInterval,
  saveSettings,
  type StateWindowInstance,
} from './_dbg__CharacterStateWindowState';
import styles from './CharacterStateWindow.module.scss';

/** Copies the character's live data, its controller's three objects (also while frozen). Logs it
 * when the clipboard fails. */
const copyDataAsJsonAsync = async (charId: string) => {
  const character = getCharacterById(charId);
  if (!character) return;
  const controller = character.controller;
  const json = JSON.stringify(
    {
      state: controller?.state,
      config: controller?.config?.values,
      internal: controller?.internal,
    },
    null,
    2
  );
  const name = character.name || `[${character.id}]`;
  try {
    await navigator.clipboard.writeText(json);
    addDebugToast({ title: 'Character data copied', message: name });
  } catch {
    llog(`CHARACTER DATA (${name}):`, json);
    addDebugToast({
      type: 'warning',
      title: 'Copy failed',
      message: 'The clipboard is not available: the data was logged to the console instead',
    });
  }
};

/** Shows the saved count and its clear button (hidden while nothing is saved). Runs on the
 * window's build and on every write to the saved values' LS key (never per frame). */
export const renderSavedState = (inst: StateWindowInstance) => {
  const actions = inst.savedActions;
  if (inst.isDisposed || !actions) return;
  const character = getCharacterById(inst.charId);
  const saved = character ? getSavedCharacterConfig(character) : null;
  const count = saved ? Object.keys(saved).length : 0;
  actions.badge.setLabel(`${count} saved`, `${count} saved ${count === 1 ? 'value' : 'values'}`);
  for (const cmp of [actions.badge.cmp, actions.clear.cmp]) {
    if (count) cmp.removeAttr('hidden');
    else cmp.updateAttr({ hidden: '' });
  }
};

const clearSavedValues = (charId: string) => {
  const character = getCharacterById(charId);
  if (!character) return;
  clearSavedCharacterConfig(character);
  addDebugToast({
    title: 'Saved character values cleared',
    message: `${character.name || `[${character.id}]`}: the code values return on its next creation`,
  });
};

/** What the window does on a header control. */
export type HeaderHandlers = {
  /** The freeze toggled */
  onFreezeChange: (isFrozen: boolean) => void;
  /** The notes setting changed: the groups are built again with or without their hints */
  onNotesChange: () => void;
};

/** The toolbar: the freeze, copy and pin buttons (one tab stop, the arrows inside), the frozen
 * badge, the saved count with its clear button, and the update's average cost. */
const getToolbarItem = (
  inst: StateWindowInstance,
  handlers: HeaderHandlers
): PropertyGridCustomItem => ({
  type: 'custom',
  build: (container) => {
    const row = container.add({ class: styles.toolbar });
    const frozenBadge = createBadge({ label: 'Frozen', tone: 'warning' });
    frozenBadge.cmp.updateAttr({ hidden: '' });
    const freeze = createButton({
      label: 'Freeze updates',
      icon: getSvgIcon('pause'),
      iconOnly: true,
      variant: 'ghost',
      size: 'sm',
      tooltip: 'Freeze the values on screen (the gizmos too); the live data stays copyable',
      pressed: inst.isFrozen,
      onPressedChange: (isFrozen) => {
        if (isFrozen) frozenBadge.cmp.removeAttr('hidden');
        else frozenBadge.cmp.updateAttr({ hidden: '' });
        handlers.onFreezeChange(isFrozen);
      },
    });
    const copy = createButton({
      label: 'Copy the data as JSON',
      icon: getSvgIcon('fileCode'),
      iconOnly: true,
      variant: 'ghost',
      size: 'sm',
      tooltip: "Copy the character's data as JSON (the live data, also while frozen)",
      onClick: () => void copyDataAsJsonAsync(inst.charId),
    });
    const buttons = [freeze, copy];
    if (inst.gizmos) {
      const pin = createButton({
        label: 'Pin the gizmos',
        icon: getSvgIcon('pin'),
        iconOnly: true,
        variant: 'ghost',
        size: 'sm',
        tooltip:
          'Pin the gizmos: they stay after this window closes, until unpinned here or in the Characters tab',
        pressed: isCharacterGizmosPinned(inst.charId),
        onPressedChange: (isPinned) => setCharacterGizmosPinned(inst.charId, isPinned),
      });
      inst.unsubscribePin = onCharacterGizmoPinsChange(() =>
        pin.setPressed(isCharacterGizmosPinned(inst.charId))
      );
      buttons.push(pin);
    }
    row.add(createButtonGroup({ label: 'Character state tools', toolbar: true, buttons }).cmp);
    row.add(frozenBadge.cmp);

    const badge = createBadge({ label: '0 saved', tone: 'info' });
    const clear = createButton({
      label: 'Clear the saved values',
      icon: getSvgIcon('databaseX'),
      iconOnly: true,
      variant: 'ghost',
      size: 'sm',
      tooltip:
        "Clear this character's saved values (this scene). The live values stay as they are: the code values return the next time the character is created.",
      onClick: () => clearSavedValues(inst.charId),
    });
    row.add(badge.cmp);
    row.add(clear.cmp);
    inst.savedActions = { badge, clear };
    renderSavedState(inst);

    inst.costText = row.add({ tag: 'span', class: styles.cost, text: 'Update – ms' });
  },
});

/** The header grid's items: the toolbar, then the update interval, the flash and the notes. */
export const getHeaderItems = (
  inst: StateWindowInstance,
  handlers: HeaderHandlers
): PropertyGridItem[] => {
  const { settings } = inst;
  return [
    getToolbarItem(inst, handlers),
    {
      label: 'Update interval',
      kind: 'number',
      get: () => settings.intervalMs,
      set: (value: unknown) => (settings.intervalMs = sanitizeInterval(value)),
      onChange: (_value, change) => change.last && saveSettings(settings),
      default: DEFAULT_SETTINGS.intervalMs,
      min: 0,
      step: 10,
      unit: 'ms',
      hint: '0: every rendered frame',
    },
    {
      label: 'Flash changes',
      get: () => settings.flash,
      set: (value: unknown) => (settings.flash = value === true),
      onChange: () => saveSettings(settings),
      default: DEFAULT_SETTINGS.flash,
      hint: 'A read-only row flashes when its value changes (not vectors or State numbers)',
    },
    {
      label: 'Show notes',
      get: () => settings.notes,
      set: (value: unknown) => (settings.notes = value === true),
      default: DEFAULT_SETTINGS.notes,
      onChange: () => {
        saveSettings(settings);
        handlers.onNotesChange();
      },
    },
  ];
};

/** The Gizmos folder: a checkbox per gizmo (disabled where the controller has no data for it),
 * the depth test and the arrows' scale, written to the character's gizmo set. */
export const getGizmoFolderItem = (
  inst: StateWindowInstance,
  gizmos: CharacterGizmoSet
): PropertyGridFolderItem => {
  const { notes } = inst.settings;
  return {
    type: 'folder',
    id: 'gizmos',
    title: 'Gizmos',
    items: [
      ...CHARACTER_GIZMOS.map(({ id, label, title, isLate }) => ({
        label,
        get: () => gizmos.settings.enabled[id],
        set: (value: unknown) => setCharacterGizmoEnabled(gizmos, id, value === true),
        disabled: !isCharacterGizmoAvailable(id),
        ...(notes ? { hint: isLate ? `${title}. ${LATE_VALUE_NOTE}` : title } : {}),
      })),
      {
        label: 'Depth test',
        get: () => gizmos.settings.depthTest,
        set: (value: unknown) => setCharacterGizmoDepthTest(gizmos, value === true),
        ...(notes
          ? { hint: 'Hide the gizmos behind geometry (off: drawn on top of everything)' }
          : {}),
      },
      {
        label: 'Arrow length per m/s',
        kind: 'number',
        get: () => gizmos.settings.vectorScale,
        set: (value: unknown) => setCharacterGizmoVectorScale(gizmos, value),
        // On the step's grid: the kit's grid starts at `min` (p804 D6)
        min: 0.05,
        step: 0.05,
        unit: 'm',
      },
    ],
  };
};
