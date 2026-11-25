// The "Save specific data…" dialog (p355 §2.3): every save source's changes as checkboxes in
// groups (this scene's and the global ones checked, each other scene's unchecked, the ones that
// can't be saved listed with why), saved as one commit of the checked ones. It's its own
// confirmation (no "Confirm writes" dialog after it), stays open on a failed save (the form's own
// error) and closes on a saved one (the reload follows).
import { CMP } from '../ui/core/CMP';
import type { CMPHandle } from '../ui/core/CMPTypes';
import { createButton, type Button } from '../ui/components/Button';
import { createCheckbox, type Checkbox } from '../ui/forms/Checkbox';
import { createFieldset, type Fieldset } from '../ui/forms/Fieldset';
import { createForm, type Form } from '../ui/forms/Form';
import { openDialog } from '../ui/overlays/windows/DialogWindow';
import { closeDraggableWindow, getDraggableWindow } from '../ui/overlays/windows/DraggableWindow';
import { getCurrentSceneId, getGeneratedAppData } from '../kernel/scene/Scene';
import { addDebugToast } from './DebuggerGUI';
import type { SaveChange, SaveSource } from './SaveData';
import {
  _collectSaveChanges,
  _getSaveErrorText,
  _isSaveableChange,
  _saveChangesAsync,
  type SourcedChange,
} from './_dbg__SaveData';
import styles from './SaveData.module.scss';

/** The dialog's id */
export const SAVE_SPECIFIC_DIALOG_ID = 'aekSaveSpecific';

/** A row's summary shows this many changed keys, then "and n more" */
const SUMMARY_KEYS_SHOWN = 5;

/** A change's key among every source's: its source's id and its own */
const getChangeKey = (source: SaveSource, change: SaveChange) => `${source.id}\u0000${change.id}`;

/** A scene's name in the generated data, else its id */
const getSceneName = (sceneId: string) => {
  const scene = getGeneratedAppData().scenes[sceneId] as { name?: string } | undefined;
  return scene?.name || sceneId;
};

/** A row's description: its file (an inline asset's scene JSON and the file it moves to, p355
 * §2.6) and its changed keys, folded after five */
const getRowHint = (change: SaveChange) => {
  const keys = change.summary.slice(0, SUMMARY_KEYS_SHOWN).join(', ');
  const more = change.summary.length - SUMMARY_KEYS_SHOWN;
  const summary = more > 0 ? `${keys} and ${more} more` : keys;
  const file = change.extract
    ? `${change.extract.scenePath} (moves to ${change.path})`
    : change.path;
  return [file, summary].filter(Boolean).join(': ');
};

/** A group of rows (a scene's, the global ones) or of groups (the other scenes') */
type Group = { title: string; keys: string[]; rows: SourcedChange[]; groups: Group[] };

const createGroup = (title: string): Group => ({ title, keys: [], rows: [], groups: [] });

const addRow = (group: Group, row: SourcedChange) => {
  group.rows.push(row);
  group.keys.push(getChangeKey(row.source, row.change));
};

/** The changes in the dialog's groups, the ones that can't be saved apart */
const groupChanges = (changes: SourcedChange[], sceneId: string | null) => {
  const thisScene = createGroup(`This scene: ${sceneId ? getSceneName(sceneId) : 'none'}`);
  const global = createGroup('Global');
  const otherScenes = createGroup('Other scenes');
  const byScene = new Map<string, Group>();
  const unsaveable: SourcedChange[] = [];
  for (const row of changes) {
    const { change } = row;
    if (!_isSaveableChange(change)) {
      unsaveable.push(row);
    } else if (change.scope === 'GLOBAL') {
      addRow(global, row);
    } else if (change.sceneId === sceneId) {
      addRow(thisScene, row);
    } else {
      const otherId = change.sceneId ?? '';
      let group = byScene.get(otherId);
      if (!group) {
        group = createGroup(getSceneName(otherId));
        byScene.set(otherId, group);
        otherScenes.groups.push(group);
      }
      addRow(group, row);
      otherScenes.keys.push(getChangeKey(row.source, change));
    }
  }
  return { thisScene, global, otherScenes, unsaveable };
};

/** The dialog's checked keys, its fields and buttons, read and written by its parts */
type DialogState = {
  checked: Set<string>;
  /** Every saveable change's key */
  allKeys: string[];
  /** Each group's heading box with its keys, to sync after a change */
  headings: { box: Checkbox; keys: string[] }[];
  form: Form | null;
  saveButton: Button | null;
  buttons: Button[];
  isOpen: boolean;
};

const countChecked = (state: DialogState, keys: string[]) =>
  keys.reduce((count, key) => count + Number(state.checked.has(key)), 0);

/** The heading boxes' mixed states and the Save button's count, after the checked keys changed */
const syncState = (state: DialogState) => {
  for (const { box, keys } of state.headings) {
    const count = countChecked(state, keys);
    box.setIndeterminate(count > 0 && count < keys.length);
  }
  const count = countChecked(state, state.allKeys);
  state.saveButton?.setLabel(`Save (${count})`);
  state.saveButton?.setDisabled(count === 0, 'Nothing is checked');
};

/** Checks or unchecks keys, then reads every box again */
const setChecked = (state: DialogState, keys: string[], on: boolean) => {
  for (const key of keys) {
    if (on) state.checked.add(key);
    else state.checked.delete(key);
  }
  state.form?.refresh();
  syncState(state);
};

/** A group's fieldset: its heading box (for every row in it, its subgroups' too), its rows and
 * its subgroups */
const buildGroup = (state: DialogState, group: Group): Fieldset => {
  const heading = createCheckbox({
    label: `${group.title} (${group.keys.length})`,
    class: styles.groupHeading,
    get: () => group.keys.every((key) => state.checked.has(key)),
    set: (on) => setChecked(state, group.keys, on),
  });
  state.headings.push({ box: heading, keys: group.keys });
  const rows = group.rows.map(({ source, change }) => {
    const key = getChangeKey(source, change);
    return createCheckbox({
      label: change.label,
      hint: getRowHint(change),
      get: () => state.checked.has(key),
      set: (on) => setChecked(state, [key], on),
    });
  });
  return createFieldset({
    legend: group.title,
    legendHidden: true,
    class: styles.group,
    children: [heading, ...rows, ...group.groups.map((child) => buildGroup(state, child))],
  });
};

/** The changes that can't be saved: greyed, no checkbox, with why */
const buildUnsaveable = (rows: SourcedChange[]) => {
  const section = CMP({ class: styles.unsaveable });
  section.add({ tag: 'h3', class: styles.unsaveableTitle, text: `Not saveable (${rows.length})` });
  const list = section.add({ tag: 'ul', class: styles.unsaveableList });
  for (const { change } of rows) {
    const item = list.add({ tag: 'li' });
    item.add({ tag: 'span', class: styles.unsaveableLabel, text: change.label });
    const scene = change.sceneId ? `${getSceneName(change.sceneId)}: ` : '';
    item.add({
      tag: 'span',
      class: styles.unsaveableReason,
      text: `${scene}${change.unsaveable ?? 'it has no file'}`,
    });
  }
  return section;
};

/** While its save runs: every box and button off (the Æ button is the spinner) */
const setBusy = (state: DialogState, on: boolean) => {
  state.form?.setDisabled(on);
  for (const button of state.buttons) button.setDisabled(on);
  state.saveButton?.setLoading(on);
  if (!on) syncState(state);
};

/** Saves the checked changes; the result decides whether the dialog closes */
const saveCheckedAsync = async (state: DialogState) => {
  const form = state.form as Form;
  setBusy(state, true);
  const result = await _saveChangesAsync(
    (change, source) => state.checked.has(getChangeKey(source, change)),
    { skipConfirm: true }
  );
  // Closed meanwhile (Escape): the toasts and the Æ button tell the rest
  if (!state.isOpen) return;
  if (result.status === 'SAVED') {
    // The reload follows; until then the Æ button is the spinner
    closeDraggableWindow(SAVE_SPECIFIC_DIALOG_ID);
    return;
  }
  if (result.status === 'NOTHING') {
    closeDraggableWindow(SAVE_SPECIFIC_DIALOG_ID);
    addDebugToast({ title: 'Nothing to save', message: result.message });
    return;
  }
  setBusy(state, false);
  form.setError(
    `Not saved: ${result.status === 'OFF' ? result.reason : _getSaveErrorText(result.error)}`,
    { focus: true }
  );
};

/** The dialog's content: the form of groups over its buttons */
const buildContent = () => {
  const state: DialogState = {
    checked: new Set(),
    allKeys: [],
    headings: [],
    form: null,
    saveButton: null,
    buttons: [],
    isOpen: true,
  };
  const root = CMP({
    class: styles.dialogContent,
    onRemoveCmp: () => {
      state.isOpen = false;
    },
  });

  let collectError: string | null = null;
  let changes: SourcedChange[] = [];
  try {
    changes = _collectSaveChanges();
  } catch (err) {
    collectError = (err as Error).message;
  }
  const { thisScene, global, otherScenes, unsaveable } = groupChanges(changes, getCurrentSceneId());
  state.allKeys = [...thisScene.keys, ...global.keys, ...otherScenes.keys];
  // This scene's and the global ones are checked at the start, the other scenes' not
  for (const key of [...thisScene.keys, ...global.keys]) state.checked.add(key);

  const formId = `${SAVE_SPECIFIC_DIALOG_ID}Form`;
  const children: (Fieldset | CMPHandle)[] = [];
  for (const group of [thisScene, global, otherScenes]) {
    if (group.keys.length) children.push(buildGroup(state, group));
  }
  if (unsaveable.length) children.push(buildUnsaveable(unsaveable));
  const form = createForm({
    id: formId,
    class: styles.form,
    attr: { 'aria-label': 'Changes to save' },
    onSubmit: () => saveCheckedAsync(state),
    children,
  });
  state.form = form;
  root.add({ class: styles.panel }).add(form.cmp);
  if (collectError) form.setError(collectError);

  const footer = root.add({ class: styles.footer });
  const checkAll = createButton({
    label: 'Check all',
    onClick: () => setChecked(state, state.allKeys, true),
  });
  const uncheckAll = createButton({
    label: 'Uncheck all',
    onClick: () => setChecked(state, state.allKeys, false),
  });
  const cancel = createButton({
    label: 'Cancel',
    onClick: () => closeDraggableWindow(SAVE_SPECIFIC_DIALOG_ID),
  });
  // Outside the form, its submit through the `form` attribute: the form's submit and busy state
  const saveButton = createButton({
    label: 'Save',
    variant: 'primary',
    type: 'submit',
    attr: { form: formId },
  });
  state.saveButton = saveButton;
  state.buttons = [checkAll, uncheckAll, cancel];
  footer.add(checkAll.cmp);
  footer.add(uncheckAll.cmp);
  footer.add({ class: styles.footerGap });
  footer.add(cancel.cmp);
  footer.add(saveButton.cmp);
  syncState(state);
  return root;
};

/**
 * Opens the "Save specific data…" dialog (p355 §2.3) with the save sources' changes as they are
 * now; a second call builds it again. The Æ menu's item and the `sc-save-specific` key, through
 * `_openSaveSpecificAsync`, which checks first that something can be saved.
 */
export const openSaveSpecificDialog = () => {
  openDialog({
    id: SAVE_SPECIFIC_DIALOG_ID,
    title: 'Save specific data',
    size: { w: 640, h: 560 },
    isDebugWindow: true,
    closeOnEscape: true,
    removeOnClose: true,
    content: buildContent,
  });
  return Boolean(getDraggableWindow(SAVE_SPECIFIC_DIALOG_ID));
};
