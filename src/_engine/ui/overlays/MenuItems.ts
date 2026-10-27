// A menu's items as elements (p803 D10, p805 D11): what `Menu.ts` builds each level's list with
// (the root and every submenu), its entries for the keys and the pointer, and the submenus'
// pointer path. Out of `Menu.ts` for its size.
import type { Kbd } from '../components/Kbd';
import { addShortcutHint } from '../components/ShortcutHint';
import type { MenuActionItem, MenuCheckboxItem, MenuItem, MenuSubmenuItem } from './Menu';

/**
 * A focusable item of an open menu level.
 * @internal
 */
export type MenuEntry = {
  elem: HTMLElement;
  /** Its label, lowercased, for the typeahead */
  text: string;
  isDisabled: boolean;
  /** Whether it stays open on Space (an on / off item, a choice) */
  isCheckable: boolean;
  /** A submenu item's items (it opens them; `run` does nothing) */
  submenu?: MenuItem[];
  /** Does what it does (flips, picks, runs) */
  run: () => void;
};

/**
 * A shortcut's hint's stop (`addShortcutHint`'s).
 * @internal
 */
export type StopHint = (removeHint: boolean) => void;

const ROLE_OF = { item: 'menuitem', checkbox: 'menuitemcheckbox', radio: 'menuitemradio' };

const createPart = (className: string, text = '') => {
  const span = document.createElement('span');
  span.className = className;
  span.textContent = text;
  return span;
};

/** An item's element: its check mark (on / off and choices), icon and label (the shortcut's hint
 * is `buildMenuItems`', a submenu's mark too) */
const createItemElem = (
  kind: keyof typeof ROLE_OF,
  props: { label: string; icon?: string; disabled?: boolean; checked?: boolean }
) => {
  const elem = document.createElement('div');
  elem.className = 'aekMenu__item';
  elem.setAttribute('role', ROLE_OF[kind]);
  elem.setAttribute('tabindex', '-1');
  if (props.disabled) elem.setAttribute('aria-disabled', 'true');
  // A check mark or an icon: the menu lines the other items' labels up with theirs
  if (kind !== 'item' || props.icon) elem.setAttribute('data-leading', '');
  if (kind !== 'item') {
    elem.setAttribute('aria-checked', String(Boolean(props.checked)));
    const check = createPart('aekMenu__check');
    check.setAttribute('aria-hidden', 'true');
    elem.append(check);
  }
  if (props.icon) {
    const icon = createPart('aekMenu__icon');
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = props.icon;
    elem.append(icon);
  }
  elem.append(createPart('aekMenu__label', props.label));
  return elem;
};

/** A group's element, named by its label (shown by the stylesheet from `data-label`) */
const createGroupElem = (label: string) => {
  const elem = document.createElement('div');
  elem.className = 'aekMenu__group';
  elem.setAttribute('role', 'group');
  elem.setAttribute('aria-label', label);
  elem.setAttribute('data-label', label);
  return elem;
};

/** A submenu item's entry: a `menuitem` that opens a menu (`aria-haspopup`, `aria-expanded`),
 * its mark a CSS chevron */
const createSubmenuEntry = (item: MenuSubmenuItem): MenuEntry => {
  const elem = createItemElem('item', item);
  elem.setAttribute('aria-haspopup', 'menu');
  elem.setAttribute('aria-expanded', 'false');
  const mark = createPart('aekMenu__submenuMark');
  mark.setAttribute('aria-hidden', 'true');
  elem.append(mark);
  return {
    elem,
    text: item.label.toLowerCase(),
    isDisabled: Boolean(item.disabled),
    isCheckable: false,
    submenu: item.items,
    run: () => {},
  };
};

/**
 * Builds a menu level's items into `parent` and returns its focusable entries in order; each
 * shortcut hint's stop goes into `hints`. A level with check marks or icons gets
 * `data-has-leading`, so every label starts in one line.
 * @internal
 */
export const buildMenuItems = (parent: HTMLElement, items: MenuItem[], hints: StopHint[]) => {
  const entries: MenuEntry[] = [];
  const addEntry = (to: HTMLElement, item: MenuActionItem | MenuCheckboxItem | MenuSubmenuItem) => {
    if (item.type === 'submenu') {
      const entry = createSubmenuEntry(item);
      to.append(entry.elem);
      entries.push(entry);
      return;
    }
    const isCheckbox = item.type === 'checkbox';
    let checked = isCheckbox && item.checked;
    const elem = createItemElem(isCheckbox ? 'checkbox' : 'item', { ...item, checked });
    to.append(elem);
    if (item.kbd) {
      hints.push(addShortcutHint({ owner: elem, kbd: item.kbd, className: 'aekMenu__kbd' }));
    }
    entries.push({
      elem,
      text: item.label.toLowerCase(),
      isDisabled: Boolean(item.disabled),
      isCheckable: isCheckbox,
      run: () => {
        if (item.type !== 'checkbox') return item.onSelect?.();
        checked = !checked;
        elem.setAttribute('aria-checked', String(checked));
        item.onCheckedChange?.(checked);
      },
    });
  };
  for (const item of items) {
    if (item.type === 'separator') {
      const line = document.createElement('div');
      line.className = 'aekMenu__separator';
      line.setAttribute('role', 'separator');
      parent.append(line);
    } else if (item.type === 'group') {
      const group = createGroupElem(item.label);
      parent.append(group);
      for (const groupItem of item.items) addEntry(group, groupItem);
    } else if (item.type === 'radio') {
      const group = createGroupElem(item.label);
      parent.append(group);
      let value = item.value;
      const optionElems: HTMLElement[] = [];
      for (const option of item.options) {
        const elem = createItemElem('radio', { ...option, checked: option.value === value });
        optionElems.push(elem);
        group.append(elem);
        entries.push({
          elem,
          text: option.label.toLowerCase(),
          isDisabled: Boolean(option.disabled),
          isCheckable: true,
          run: () => {
            for (const other of optionElems) {
              other.setAttribute('aria-checked', String(other === elem));
            }
            if (option.value === value) return;
            value = option.value;
            item.onValueChange?.(option.value);
          },
        });
      }
    } else {
      addEntry(parent, item);
    }
  }
  if (entries.some((entry) => entry.elem.hasAttribute('data-leading'))) {
    parent.setAttribute('data-has-leading', '');
  } else {
    parent.removeAttribute('data-has-leading');
  }
  return entries;
};

/**
 * The `Kbd` handles an item array holds, its submenus' included (not the strings: their hints are
 * the menu's own).
 * @internal
 */
export const findMenuHintHandles = (items: MenuItem[], handles: Kbd[] = []) => {
  for (const item of items) {
    if (item.type === 'submenu') {
      findMenuHintHandles(item.items, handles);
      continue;
    }
    for (const one of item.type === 'group' ? item.items : [item]) {
      if (one.type === 'submenu') findMenuHintHandles(one.items, handles);
      else if ((!one.type || one.type === 'item' || one.type === 'checkbox') && one.kbd) {
        if (typeof one.kbd !== 'string') handles.push(one.kbd);
      }
    }
  }
  return handles;
};

/**
 * A point in viewport px.
 * @internal
 */
export type MenuPoint = { x: number; y: number };

/** Which side of the line from `a` to `b` the point `p` is on (the cross product's sign) */
const sideOf = (p: MenuPoint, a: MenuPoint, b: MenuPoint) =>
  (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);

/**
 * Whether a pointer moving from `from` to `to` is heading for an open submenu's box: `to` is in
 * the triangle from `from` to the box's near edge (D11). A pointer crossing the parent's other
 * items on its way keeps the submenu open.
 * @internal
 */
export const isInPointerPath = (
  from: MenuPoint,
  to: MenuPoint,
  box: { left: number; top: number; right: number; bottom: number }
) => {
  if (from.x === to.x && from.y === to.y) return false;
  const nearX = box.left >= from.x ? box.left : box.right;
  const top = { x: nearX, y: box.top };
  const bottom = { x: nearX, y: box.bottom };
  const d1 = sideOf(to, from, top);
  const d2 = sideOf(to, top, bottom);
  const d3 = sideOf(to, bottom, from);
  const hasNegative = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPositive = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNegative && hasPositive);
};
