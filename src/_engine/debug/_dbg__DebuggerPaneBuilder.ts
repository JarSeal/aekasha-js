// The debugger's declarative sections (p806 D4): a section's items become a property grid of the
// UI kit's fields (`addPropertyGridItems`), with the debugger's own parts on top: the state-key
// bindings and their persistence, the folders' and the label column's saved states (the tab's
// `uiLsKey`, its 5.x format kept), and the check of each binding's fields against the kit's.
import type { CMPHandle } from '../ui/core/CMPTypes';
import type { BindingScheduler } from '../ui/forms/binding/BindingScheduler';
import type { FieldChange } from '../ui/forms/Field';
import { createPropertyGrid } from '../ui/forms/PropertyGrid';
import {
  addPropertyGridItems,
  PROPERTY_GRID_FIELD_ITEM_KEYS,
  type PropertyGridFieldItem,
  type PropertyGridItem,
} from '../ui/forms/PropertyGridItems';
import { lsGetItem, lsSetItem } from '../utils/LocalAndSessionStorage';
import { lwarn } from '../utils/Logger';
import type {
  AnyDebuggerTabDef,
  DebuggerPaneBinding,
  DebuggerPaneItem,
  DebuggerPaneSection,
} from './DebuggerGUI';

type AnyState = Record<string, unknown>;

/** A built pane section of a mounted tab. */
export type BuiltDebuggerPane = {
  cmp: CMPHandle;
  /** Re-reads the bound values and the hidden / disabled functions, never firing onChange. */
  refresh: () => void;
};

/** A tab's UI state under its `uiLsKey`: 5.x's `folders`, and the label column's width (p806) */
type UIState = { folders?: { [folderId: string]: boolean }; labelWidth?: number };

/** What a pane needs of its owner: a debugger tab, or eg. a debug window with its own state. */
export type DebuggerPaneOwner = Pick<
  AnyDebuggerTabDef,
  'id' | 'state' | 'lsKey' | 'persistKeys' | 'uiLsKey'
>;

/** What `_buildDebuggerPane` builds with besides the section */
export type DebuggerPaneOptions = {
  /** The host's scheduler (the tab's), shared by its sections. Default: the grid's own. */
  scheduler?: BindingScheduler;
};

/** The label column's width when the tab saved none: a debugger's labels are long (Phase 0) */
const DEFAULT_LABEL_WIDTH = 50;

const FIELD_ITEM_KEYS = new Set<string>(PROPERTY_GRID_FIELD_ITEM_KEYS);

/** What a 5.x (Tweakpane) field is now, for the error that names it */
const MIGRATION_HINTS: Record<string, string> = {
  color: "a colour number is `kind: 'color'` now",
};

/** LS key of a tab's UI state (folder open/closed states), if it has one. */
const getDebuggerTabUIKey = (def: DebuggerPaneOwner) =>
  def.uiLsKey ?? (def.lsKey ? `${def.lsKey}UI` : undefined);

const readUIState = (uiKey: string | undefined): UIState => {
  if (!uiKey) return {};
  try {
    const saved = lsGetItem(uiKey, {});
    return saved && typeof saved === 'object' && !Array.isArray(saved) ? (saved as UIState) : {};
  } catch {
    return {};
  }
};

/** Merged: a module may keep other UI fields in the same key */
const saveUIState = (uiKey: string, update: (state: UIState) => UIState) => {
  lsSetItem(uiKey, update(readUIState(uiKey)));
};

/**
 * Writes one state key of a tab to its lsKey: the other persistKeys already saved are kept, any
 * other (legacy) field of the saved object is dropped.
 */
export const persistDebuggerTabStateValue = (def: DebuggerPaneOwner, key: string) => {
  const { lsKey, state, persistKeys } = def;
  if (!lsKey || !state || !persistKeys?.includes(key)) {
    lwarn(`Debugger tab "${def.id}" has no persisted state key "${key}" (see persistKeys).`);
    return;
  }
  const saved = lsGetItem(lsKey, {}) as Record<string, unknown>;
  const next: Record<string, unknown> = {};
  for (let i = 0; i < persistKeys.length; i++) {
    const persistKey = persistKeys[i];
    if (persistKey in saved) next[persistKey] = saved[persistKey];
  }
  next[key] = state[key];
  lsSetItem(lsKey, next);
};

/** A binding's fields the kit doesn't take: an error naming the item and the field (D4) */
const checkBindingFields = (def: DebuggerPaneOwner, item: DebuggerPaneBinding<AnyState>) => {
  const name = item.label ?? (typeof item.key === 'string' ? item.key : 'a binding');
  for (const field of Object.keys(item)) {
    if (FIELD_ITEM_KEYS.has(field)) continue;
    const hint = MIGRATION_HINTS[field];
    throw new Error(
      `Debugger tab "${def.id}": the binding "${name}" has the field "${field}", which no UI kit field takes${hint ? ` (${hint})` : ''}`
    );
  }
  const view = (item as { view?: unknown }).view;
  if (view !== undefined && view !== 'graph') {
    throw new Error(
      `Debugger tab "${def.id}": the binding "${name}" has \`view: ${JSON.stringify(view)}\` (a colour is \`kind: 'color'\` now; the kit's \`view\` is 'graph')`
    );
  }
};

/**
 * Builds a declarative pane section of a debugger tab, or of any other {@link DebuggerPaneOwner}
 * (eg. a debug window), as a property grid in its own CMP: a titled section is a folder of it.
 * - A binding without a `target` (or `get` / `value`) binds the tab's `state`: `'root.prop'` binds
 *   `state.root`'s `prop`, and the root key is persisted on `last` when it's in `persistKeys`.
 * - Folders' open states and the label column's width are saved under the tab's `uiLsKey`
 *   (`{ folders: { [id]: boolean }, labelWidth }`), a folder's id its `id` or its title path.
 * - `interval: 0` (Tweakpane's refresh-only monitor) is the kit's `interval: 'refresh'`.
 * The grid (its own scheduler, or the host's) is disposed when its CMP is removed.
 * @throws an Error naming the binding and the field when a binding has a field no kit field takes
 */
export const _buildDebuggerPane = (
  def: DebuggerPaneOwner,
  section: DebuggerPaneSection<AnyState>,
  opts: DebuggerPaneOptions = {}
): BuiltDebuggerPane => {
  const uiKey = getDebuggerTabUIKey(def);
  const uiState = readUIState(uiKey);
  const savedFolders = uiState.folders ?? {};
  /** The folders whose open state isn't saved (`persistExpanded: false`, or no UI key) */
  const unsavedFolders = new Set<string>();

  const toFieldItem = (item: DebuggerPaneBinding<AnyState>): PropertyGridFieldItem | null => {
    checkBindingFields(def, item);
    const {
      type: _type,
      key,
      target,
      get,
      set,
      value,
      label,
      onChange,
      interval,
      ...props
    } = item as DebuggerPaneBinding<AnyState> & { value?: unknown };
    let source: object;
    let persistKey: string | null = null;
    if (target !== undefined) {
      source = { target, key };
    } else if (get !== undefined) {
      source = set ? { get, set } : { get };
    } else if ('value' in item) {
      source = { value };
    } else {
      // A state key, or a path one level deep ('nested.prop'); the top-level key is persisted
      const stateKey = key as string;
      const dotIndex = stateKey.indexOf('.');
      const rootKey = dotIndex === -1 ? stateKey : stateKey.slice(0, dotIndex);
      const obj = dotIndex === -1 ? def.state : (def.state?.[rootKey] as AnyState | undefined);
      if (!obj) {
        lwarn(`Debugger tab "${def.id}" binding "${stateKey}" has no target object.`);
        return null;
      }
      source = { target: obj, key: dotIndex === -1 ? stateKey : stateKey.slice(dotIndex + 1) };
      if (def.persistKeys?.includes(rootKey)) persistKey = rootKey;
    }
    const persisted = persistKey;
    return {
      ...props,
      ...(source as Pick<PropertyGridFieldItem, 'target' | 'key'>),
      label: label ?? (typeof key === 'string' ? key : ''),
      ...(interval !== undefined ? { interval: interval === 0 ? 'refresh' : interval } : {}),
      ...(persisted || onChange
        ? {
            onChange: (next: unknown, change: FieldChange<unknown>) => {
              if (persisted && change.last) persistDebuggerTabStateValue(def, persisted);
              onChange?.(next, change);
            },
          }
        : {}),
    } as PropertyGridFieldItem;
  };

  const toGridItems = (items: DebuggerPaneItem<AnyState>[], path: string): PropertyGridItem[] => {
    const gridItems: PropertyGridItem[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type === 'folder') {
        const folderPath = path ? `${path}/${item.title}` : item.title;
        const id = item.id ?? folderPath;
        if (!uiKey || item.persistExpanded === false) unsavedFolders.add(id);
        gridItems.push({
          type: 'folder',
          id,
          title: item.title,
          expanded: item.expanded,
          hidden: item.hidden,
          items: toGridItems(item.content, folderPath),
        });
      } else if (item.type === 'button' || item.type === 'separator' || item.type === 'custom') {
        gridItems.push(item);
      } else {
        const fieldItem = toFieldItem(item);
        if (fieldItem) gridItems.push(fieldItem);
      }
    }
    return gridItems;
  };

  const title = section.title;
  const content = toGridItems(section.content, title ?? '');
  let items = content;
  if (title) {
    const id = section.id ?? title;
    if (!uiKey) unsavedFolders.add(id);
    items = [{ type: 'folder', id, title, expanded: section.expanded, items: content }];
  }

  const folderExpanded: Record<string, boolean> = {};
  for (const id of Object.keys(savedFolders)) {
    if (!unsavedFolders.has(id) && typeof savedFolders[id] === 'boolean') {
      folderExpanded[id] = savedFolders[id];
    }
  }

  const grid = createPropertyGrid({
    scheduler: opts.scheduler,
    labelWidth: typeof uiState.labelWidth === 'number' ? uiState.labelWidth : DEFAULT_LABEL_WIDTH,
    onLabelWidthChange: uiKey
      ? (labelWidth) => saveUIState(uiKey, (state) => ({ ...state, labelWidth }))
      : undefined,
    class: 'debuggerPaneSection',
  });
  addPropertyGridItems(grid, items, {
    folderExpanded,
    onFolderExpandedChange: (id, expanded) => {
      if (!uiKey || unsavedFolders.has(id)) return;
      saveUIState(uiKey, (state) => ({ ...state, folders: { ...state.folders, [id]: expanded } }));
    },
  });

  return { cmp: grid.cmp, refresh: () => grid.refresh() };
};
