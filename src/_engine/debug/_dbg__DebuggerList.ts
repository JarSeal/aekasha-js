// The debugger list (p806 D6): `debuggerListCMP`'s definition on the kit's list (`createList`, p805
// §4's mapping). A row click opens the item's window; the selection shows the open windows; a
// row's icon toggles are the list's actions.
import { CMP } from '../ui/core/CMP';
import type { CMPHandle } from '../ui/core/CMPTypes';
import { getSvgIcon } from '../ui/core/icons/SvgIcon';
import { createList } from '../ui/data/List';
import type { List, ListAction } from '../ui/data/ListTypes';
import type { DebuggerListDef, DebuggerListItem } from './DebuggerGUI';

type MountedList = {
  cmp: CMPHandle;
  refresh: () => void;
  /** Runs a row's click by its index (the test bridge's) */
  clickRow: (index: number) => string | null;
};

/** Lists that exist (created and not yet removed), for the tab refresh. */
const mountedLists = new Set<MountedList>();
let autoIdCounter = 0;

const toIds = (selected: string | string[] | null | undefined) =>
  selected === null || selected === undefined ? [] : [selected].flat();

/** A row's toggles as the list's actions: a row without a value for one has it hidden (its cell
 * kept, so the other toggles stay aligned) */
const toActions = (
  def: DebuggerListDef,
  onToggled: (item: DebuggerListItem, index: number) => void
): ListAction<DebuggerListItem>[] =>
  (def.perItemConfig?.toggles || []).map((toggle, i) => ({
    key: `toggle${i}`,
    label: toggle.title,
    icon: getSvgIcon(toggle.icon, 'sm'),
    ...(toggle.iconOff ? { iconOff: getSvgIcon(toggle.iconOff, 'sm') } : {}),
    pressed: (item) => item.toggleValues?.[i] === true,
    hidden: (item) => typeof item.toggleValues?.[i] !== 'boolean',
    onPress: (item) => {
      toggle.fn(item.itemId, !item.toggleValues?.[i]);
      onToggled(item, i);
    },
  }));

/**
 * Creates the shared debugger list on the kit's list: rows with an optional sub title line, icon,
 * badge, title, description and suffix, and optional per-row icon toggles. A list with a row click
 * or toggles is one tab stop with the arrows inside (p805 D4); without either it's a static list.
 */
export const _debuggerListCMP = (def: DebuggerListDef): CMPHandle => {
  const id = def.id ?? `auto${++autoIdCounter}`;
  // A static array is copied, its toggle values are flipped locally
  const localData = Array.isArray(def.data)
    ? def.data.map((item) => ({ ...item, toggleValues: item.toggleValues?.slice() }))
    : null;
  const getData = () => localData || (def.data as () => DebuggerListItem[])();
  const onClick = def.perItemConfig?.onClick;
  const getSelected = () => toIds(def.selectedItemId?.());

  // The handlers below run only once the list exists
  const actions = toActions(def, (item, i) => {
    const local = localData?.find((d) => d.itemId === item.itemId);
    if (local?.toggleValues) local.toggleValues[i] = !local.toggleValues[i];
    list.refresh();
  });

  const list: List<DebuggerListItem> = createList<DebuggerListItem>({
    items: localData ?? getData,
    getKey: (item) => item.itemId,
    title: (item) => item.title,
    subTitle: (item) => item.subTitle,
    description: (item) => item.description,
    suffix: (item) => item.suffix,
    icon: (item) => (item.icon ? getSvgIcon(item.icon, 'sm') : null),
    badge: (item) => item.badge,
    tooltip: (item) => item.tooltip,
    isPlaceholder: (item) => Boolean(item.titlePlaceholder),
    disabled: (item) => Boolean(item.disabled),
    heading: def.heading,
    headingLevel: 4,
    label: def.label ?? def.heading ?? 'Items',
    ...(def.selectedItemId
      ? {
          selection: 'multiple' as const,
          selected: getSelected(),
          onSelectionChange: syncSelected,
        }
      : {}),
    ...(actions.length ? { actions } : {}),
    ...(onClick
      ? {
          onActivate: (item: DebuggerListItem) => {
            onClick(item.itemId);
            syncSelected();
          },
        }
      : {}),
    empty: def.emptyText,
    class: 'debuggerList',
  });

  /** The selection is the open windows': read again after anything that may change them */
  function syncSelected() {
    if (def.selectedItemId) list.setSelected(getSelected());
  }

  const wrapper = CMP({
    id: `debuggerList-${id}`,
    class: 'debuggerListWrapper',
    onRemoveCmp: () => mountedLists.delete(mounted),
  });
  wrapper.add(list.cmp);

  const mounted: MountedList = {
    cmp: wrapper,
    refresh: () => {
      list.refresh();
      syncSelected();
    },
    clickRow: (index) => {
      const item = getData()[index];
      if (!onClick || !item) return null;
      onClick(item.itemId);
      syncSelected();
      return item.itemId;
    },
  };
  mountedLists.add(mounted);
  return wrapper;
};

/** Refreshes the lists inside `root`: each re-reads its rows (writing only what changed) and the
 * selection. */
export const _refreshDebuggerLists = (root: HTMLElement) => {
  for (const list of mountedLists) {
    if (root.contains(list.cmp.elem)) list.refresh();
  }
};

/** Runs the click of row `index` (0-based) of the first list inside `root` that has row clicks,
 * as a click on it does: the test bridge's (p806 D14). The row's id, or null when there's none. */
export const _clickDebuggerListRow = (root: HTMLElement, index: number) => {
  for (const list of mountedLists) {
    if (!root.contains(list.cmp.elem)) continue;
    const itemId = list.clickRow(index);
    if (itemId !== null) return itemId;
  }
  return null;
};
