// The Character state window's Properties group (p806 D10, D11): the controller's configuration
// values as the kit's number fields and checkboxes (a baked key a monitor), their undo, and the
// group's changed count with "Copy changes" and "Reset all". Every write goes through
// `writeConfig`; a gesture's end saves (`AEK_debugCharConfig`) and records it.
import { addDebugToast } from '../../../debug/DebuggerGUI';
import {
  _recordOrCoalesceUndoRedoAction,
  _recordUndoRedoAction,
  _registerUndoRedoActionHandler,
} from '../../../debug/_dbg__UndoRedo';
import { getNoteItem } from '../../../debug/_dbg__DebugWindowGrid';
import { createButton } from '../../../ui/components/Button';
import { getSvgIcon } from '../../../ui/core/icons/SvgIcon';
import type { FieldChange } from '../../../ui/forms/Field';
import type {
  PropertyGridCustomItem,
  PropertyGridFieldItem,
  PropertyGridItem,
} from '../../../ui/forms/PropertyGridItems';
import { llog } from '../../../utils/Logger';
import { getCharacterById } from '../Character';
import type { CharacterObject } from '../CharacterTypes';
import { getConfigKeyHint } from './_dbg__CharacterConfigHints';
import { isSameConfigValue, saveCharacterConfig } from './_dbg__CharacterConfigOverrides';
import { NUMBER_FORMATS } from './_dbg__CharacterStateRows';
import {
  getConfigValues,
  getInitialConfig,
  RAD_TO_DEG,
  type StateWindowInstance,
} from './_dbg__CharacterStateWindowState';
import styles from './CharacterStateWindow.module.scss';

type ConfigValue = number | boolean;

/** Listeners of a configuration write that didn't come from the window's own field (an undo, a
 * reset all) or that ended a gesture: the open window refreshes its grid and its count. */
const appliedListeners = new Set<(charId: string) => void>();

/** Calls `listener` with the character's id after its configuration was written and saved.
 * Returns the remover. */
export const onConfigApplied = (listener: (charId: string) => void) => {
  appliedListeners.add(listener);
  return () => {
    appliedListeners.delete(listener);
  };
};

const notifyConfigApplied = (charId: string) => {
  for (const listener of appliedListeners) listener(charId);
};

/**
 * Writes a configuration value to the controller's live values, where it reads it from its next
 * sub-step, and lets it recompute what it derives from it. The one write path of the fields, the
 * resets and undo.
 */
const writeConfig = (character: CharacterObject, key: string, value: ConfigValue) => {
  const config = character.controller?.config;
  if (!config) return;
  (config.values as Record<string, unknown>)[key] = value;
  config.onChange(key);
};

/** Writes several configuration values, saves them (only the ones that differ from the
 * creation-time values, so they survive a reload), then shows them in the character's open window
 * (if any). The resets and undo write through here. */
const applyConfigValues = (character: CharacterObject, values: Record<string, ConfigValue>) => {
  const keys = Object.keys(values);
  for (let i = 0; i < keys.length; i++) writeConfig(character, keys[i], values[keys[i]]);
  saveCharacterConfig(character, keys);
  notifyConfigApplied(character.id);
};

// Undo / redo

const CONFIG_UNDO_ACTION = 'character.config';
/** One edit (one key), a row reset (one key) or a Reset all (every reset key). Character ids are
 * app-supplied, so they are stable across reloads. */
type ConfigUndoPayload = {
  charId: string;
  prev: Record<string, ConfigValue>;
  next: Record<string, ConfigValue>;
};

/** Writes the values the character still has with the same type (a deleted character, a scene
 * without it or a renamed key is a quiet no-op, so the history pointer still moves). */
const applyConfigUndo = (charId: string, values: Record<string, ConfigValue>) => {
  const character = getCharacterById(charId);
  if (!character) return;
  const writable: Record<string, ConfigValue> = {};
  for (const key of Object.keys(values)) {
    if (typeof getConfigValues(character)[key] === typeof values[key]) writable[key] = values[key];
  }
  applyConfigValues(character, writable);
};

_registerUndoRedoActionHandler<ConfigUndoPayload>(
  CONFIG_UNDO_ACTION,
  {
    undo: ({ charId, prev }) => applyConfigUndo(charId, prev),
    redo: ({ charId, next }) => applyConfigUndo(charId, next),
  },
  'perScene'
);

const getUndoLabel = (character: CharacterObject, action: string) =>
  `Character ${character.name || character.id}: ${action}`;

/** A value for an undo label: numbers to 3 decimals (degrees for a degree key). */
const formatLabelValue = (key: string, value: ConfigValue) => {
  if (typeof value !== 'number') return String(value);
  const isDeg = getConfigKeyHint(key).deg === true;
  return `${parseFloat((isDeg ? value * RAD_TO_DEG : value).toFixed(3))}${isDeg ? '°' : ''}`;
};

/** How a field's gesture ended: a key step or drag (`STEP`), a reset button's or a typed value's
 * single write (`CHANGE`) */
type GestureKind = 'STEP' | 'CHANGE';

/**
 * Saves and records the end of a field's gesture (its value is already written, step by step).
 * Number edits of one key coalesce (two key presses within the history's window are one undo
 * step), so their label names the value they started from, which coalescing keeps; a single
 * write back to the creation-time value is a reset.
 */
const commitConfigEdit = (
  inst: StateWindowInstance,
  key: string,
  prev: ConfigValue | undefined,
  gesture: GestureKind
) => {
  const character = getCharacterById(inst.charId);
  if (!character || prev === undefined) return;
  const next = getConfigValues(character)[key];
  if (typeof next !== typeof prev || isSameConfigValue(prev, next)) return;
  const value = next as ConfigValue;
  saveCharacterConfig(character, [key]);
  const payload: ConfigUndoPayload = {
    charId: character.id,
    prev: { [key]: prev },
    next: { [key]: value },
  };
  const initial = getInitialConfig(character)[key];
  if (typeof value === 'boolean') {
    _recordUndoRedoAction(
      CONFIG_UNDO_ACTION,
      getUndoLabel(character, `${key} → ${value}`),
      payload
    );
  } else if (gesture === 'CHANGE' && isSameConfigValue(value, initial)) {
    _recordUndoRedoAction(CONFIG_UNDO_ACTION, getUndoLabel(character, `reset ${key}`), payload);
  } else {
    _recordOrCoalesceUndoRedoAction(
      CONFIG_UNDO_ACTION,
      getUndoLabel(character, `${key} (from ${formatLabelValue(key, prev)})`),
      payload,
      `${character.id}:${key}`
    );
  }
  notifyConfigApplied(character.id);
};

// Copy changes and Reset all

/** The configuration keys whose live value differs from the creation-time one, in the creation
 * order (a controller's defaults first, eg. createDynamicCharacter's). Baked keys are left out:
 * they can't be edited (and would need the visual resized too). */
const getChangedConfig = (character: CharacterObject) => {
  const baked = character.controller?.config?.bakedKeys;
  const values = getConfigValues(character);
  const initials = getInitialConfig(character);
  const changed: [string, ConfigValue][] = [];
  for (const key of Object.keys(initials)) {
    if (baked?.has(key)) continue;
    const initial = initials[key];
    const current = values[key];
    if (typeof current !== 'number' && typeof current !== 'boolean') continue;
    if (typeof current === typeof initial && !isSameConfigValue(current, initial)) {
      changed.push([key, current]);
    }
  }
  return changed;
};

const IDENTIFIER_RE = /^[A-Za-z_$][\w$]*$/;

/** A `config` snippet (an object literal) of the changed keys. Numbers are rounded to 4
 * decimals, except radians: they are written in full (4 decimals would move them by up to 0.003°),
 * with their degrees in a comment. */
export const formatConfigSnippet = (changed: [string, ConfigValue][]) => {
  const lines = changed.map(([key, value]) => {
    const prop = IDENTIFIER_RE.test(key) ? key : JSON.stringify(key);
    if (typeof value !== 'number') return `  ${prop}: ${value},`;
    if (getConfigKeyHint(key).deg || NUMBER_FORMATS[key] === 'RAD_DEG') {
      return `  ${prop}: ${value}, // ${(value * RAD_TO_DEG).toFixed(1)}°`;
    }
    return `  ${prop}: ${parseFloat(value.toFixed(4))},`;
  });
  return `{\n${lines.join('\n')}\n}`;
};

/** Copies the changed configuration as a `config` snippet (createDynamicCharacter's option), to
 * make the tuning permanent in the scene's code. Logs it when the clipboard fails. */
const copyConfigChangesAsync = async (charId: string) => {
  const character = getCharacterById(charId);
  if (!character) return;
  const name = character.name || `[${character.id}]`;
  const changed = getChangedConfig(character);
  if (!changed.length) {
    addDebugToast({ title: 'No changes to copy', message: name });
    return;
  }
  const snippet = formatConfigSnippet(changed);
  const count = `${changed.length} ${changed.length === 1 ? 'key' : 'keys'}`;
  try {
    await navigator.clipboard.writeText(snippet);
    addDebugToast({
      title: 'Character changes copied',
      message: `${name}: ${count}, as config overrides`,
    });
  } catch {
    llog(`CHARACTER CONFIG CHANGES (${name}, config overrides):`, snippet);
    addDebugToast({
      type: 'warning',
      title: 'Copy failed',
      message: 'The clipboard is not available: the changes were logged to the console instead',
    });
  }
};

/** Resets every changed configuration value of the character to its creation-time one, as one
 * undo step. */
const resetAllConfig = (charId: string) => {
  const character = getCharacterById(charId);
  if (!character) return;
  const initials = getInitialConfig(character);
  const prev: Record<string, ConfigValue> = {};
  const next: Record<string, ConfigValue> = {};
  for (const [key, current] of getChangedConfig(character)) {
    prev[key] = current;
    next[key] = initials[key] as ConfigValue;
  }
  const count = Object.keys(next).length;
  if (!count) return;
  applyConfigValues(character, next);
  _recordUndoRedoAction<ConfigUndoPayload>(
    CONFIG_UNDO_ACTION,
    getUndoLabel(character, `reset all (${count})`),
    { charId: character.id, prev, next }
  );
};

const NO_CHANGES_REASON = 'No value differs from its creation-time one';

/** Writes the Properties group's changed count and its buttons' disabled states, read from the
 * data (on the build and after every write, never per frame). */
export const renderConfigActions = (inst: StateWindowInstance) => {
  const actions = inst.configActions;
  if (!actions) return;
  const character = getCharacterById(inst.charId);
  const count = character ? getChangedConfig(character).length : 0;
  actions.changedText.updateText(count ? `${count} changed` : 'No changes');
  actions.copy.setDisabled(count === 0, NO_CHANGES_REASON);
  actions.resetAll.setDisabled(count === 0, NO_CHANGES_REASON);
};

/** The group's first row: its changed count, "Copy changes" and "Reset all". */
const getConfigActionsItem = (inst: StateWindowInstance): PropertyGridCustomItem => ({
  type: 'custom',
  build: (container) => {
    const row = container.add({ class: styles.configActions });
    const changedText = row.add({ tag: 'span', class: styles.changedCount, text: '' });
    const copy = createButton({
      label: 'Copy changes',
      icon: getSvgIcon('fileAsterix'),
      size: 'sm',
      tooltip: 'The changed values as a config snippet, to paste into the scene code',
      focusableWhenDisabled: true,
      onClick: () => void copyConfigChangesAsync(inst.charId),
    });
    const resetAll = createButton({
      label: 'Reset all',
      icon: getSvgIcon('arrowCounterClockwise'),
      size: 'sm',
      tooltip: 'Every changed value back to its creation-time value (one undo step)',
      focusableWhenDisabled: true,
      onClick: () => resetAllConfig(inst.charId),
    });
    row.add(copy.cmp);
    row.add(resetAll.cmp);
    inst.configActions = { changedText, copy, resetAll };
    renderConfigActions(inst);
  },
});

// The rows

/** A number field's text: up to 4 decimals, no trailing zeros (a value from the code keeps its
 * own decimals, whatever the step's). */
const formatShown = (value: number) => String(parseFloat(value.toFixed(4)));

/**
 * An editable key's field: a number field (a `deg` hint's in degrees, the value in radians) or a
 * checkbox, bound to the live value. Each step writes (`writeConfig`), and the gesture's end saves
 * and records it with the value it started from. The reset button writes the creation-time value
 * (`default`; a value equal to it but for float noise is written as that value exactly).
 */
const getEditableRowItem = (
  inst: StateWindowInstance,
  character: CharacterObject,
  key: string,
  value: ConfigValue
): PropertyGridFieldItem => {
  const hint = getConfigKeyHint(key);
  const isDeg = typeof value === 'number' && hint.deg === true;
  const toShown = (data: number) => (isDeg ? data * RAD_TO_DEG : data);
  const initialValue = getInitialConfig(character)[key];
  const initial = typeof initialValue === typeof value ? (initialValue as ConfigValue) : undefined;
  /** The value before the gesture's first write, and whether it stepped */
  let gestureFrom: ConfigValue | undefined;
  let gesture: GestureKind = 'CHANGE';
  const read = () => getConfigValues(inst.character ?? character)[key];
  const write = (data: ConfigValue) => {
    const live = getCharacterById(inst.charId);
    if (!live) return;
    const current = getConfigValues(live)[key];
    if (gestureFrom === undefined && typeof current === typeof data) {
      gestureFrom = current as ConfigValue;
    }
    writeConfig(
      live,
      key,
      initial !== undefined && isSameConfigValue(data, initial) ? initial : data
    );
  };
  const onChange = (_next: unknown, change: FieldChange<unknown>) => {
    if (!change.last) {
      gesture = 'STEP';
      return;
    }
    const from = gestureFrom;
    const kind = gesture;
    gestureFrom = undefined;
    gesture = 'CHANGE';
    commitConfigEdit(inst, key, from, kind);
  };
  const common = {
    label: key,
    onChange,
    ...(inst.settings.notes && hint.note ? { hint: hint.note } : {}),
  };
  if (typeof value === 'boolean') {
    return {
      ...common,
      kind: 'checkbox',
      get: () => read() === true,
      set: (next: unknown) => write(next === true),
      ...(initial !== undefined ? { default: initial } : {}),
    };
  }
  return {
    ...common,
    kind: 'number',
    get: () => toShown(Number(read())),
    set: (next: unknown) => write(isDeg ? Number(next) / RAD_TO_DEG : Number(next)),
    step: hint.step,
    min: hint.min,
    max: hint.max,
    unit: isDeg ? '°' : hint.unit,
    format: (shown) => formatShown(shown as number),
    ...(initial !== undefined ? { default: toShown(initial as number) } : {}),
  };
};

/** A key baked into the body at creation (the controller's `bakedKeys`): its value as a monitor,
 * never written. */
const getBakedRowItem = (inst: StateWindowInstance, character: CharacterObject, key: string) => {
  const hint = getConfigKeyHint(key);
  return {
    label: key,
    kind: 'number',
    readonly: true,
    interval: 'refresh',
    get: () => Number(getConfigValues(inst.character ?? character)[key]),
    unit: hint.unit,
    format: (shown) => formatShown(shown as number),
  } satisfies PropertyGridFieldItem;
};

const BAKED_KEYS_NOTE =
  'are sized into the colliders at creation: shown, not editable (a body rebuild is not available yet).';

/**
 * The Properties group's leading items: a note naming the baked keys (when the character has
 * some) and the actions row.
 */
export const getConfigLeadItems = (
  inst: StateWindowInstance,
  character: CharacterObject
): PropertyGridItem[] => {
  const values = getConfigValues(character);
  const baked = character.controller?.config?.bakedKeys;
  const bakedKeys = baked ? Object.keys(values).filter((key) => baked.has(key)) : [];
  return [
    ...(bakedKeys.length ? [getNoteItem(`${bakedKeys.join(', ')} ${BAKED_KEYS_NOTE}`)] : []),
    getConfigActionsItem(inst),
  ];
};

/**
 * A Properties row's item when an editor takes it (a number that isn't a step stamp, or a
 * boolean): a field, or a baked key's monitor. Null for any other value (a read-only row).
 */
export const getConfigRowItem = (
  inst: StateWindowInstance,
  character: CharacterObject,
  key: string,
  value: unknown
): PropertyGridFieldItem | null => {
  if (
    typeof value !== 'boolean' &&
    (typeof value !== 'number' || NUMBER_FORMATS[key] === 'STEP_AGO')
  ) {
    return null;
  }
  if (character.controller?.config?.bakedKeys.has(key))
    return getBakedRowItem(inst, character, key);
  return getEditableRowItem(inst, character, key, value);
};
