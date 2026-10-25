import type { CMPAttr, CMPHandle } from '../core/CMPTypes';
import { CMP, classes } from '../core/CMP';
import { getHUDRootCMP, hasHudRoot, KIT_ROOT_CLASS } from '../core/HUD';
import { createKbd } from '../components/Kbd';
import { getAriaKeyShortcuts } from '../components/KeyNames';
import { showAnchored } from './Anchor';
import { pushOverlay, swallowNextKeyUp } from './OverlayStack';
import './Menu.scss';
import '../styles/kit.scss';

/** A menu's action (`menuitem`). */
export type MenuActionItem = {
  /** An action (the default type). */
  type?: 'item';
  /** Its text, and its accessible name. */
  label: string;
  /** Runs when it's picked, after the menu closed (so a dialog it opens returns the focus to the
   * menu's trigger). */
  onSelect?: () => void;
  /** Raw HTML of its icon (`getSvgIcon('gear')`), at `1em`. */
  icon?: string;
  /** A shortcut's hint (`'Ctrl+S'`), drawn with `createKbd`, and its `aria-keyshortcuts`. */
  kbd?: string;
  /** Shown and focusable, but not picked (default false). */
  disabled?: boolean;
};

/** A menu's on / off item (`menuitemcheckbox`). */
export type MenuCheckboxItem = {
  /** An on / off item. */
  type: 'checkbox';
  /** Its text, and its accessible name. */
  label: string;
  /** Whether it's on, read when the menu opens. */
  checked: boolean;
  /** Its new state, after a pick flipped it. */
  onCheckedChange?: (checked: boolean) => void;
  /** A shortcut's hint (`'Ctrl+G'`), and its `aria-keyshortcuts`. */
  kbd?: string;
  /** Shown and focusable, but not picked (default false). */
  disabled?: boolean;
};

/** A menu's one-of choice (a `group` of `menuitemradio`s). */
export type MenuRadioGroup = {
  /** A one-of choice. */
  type: 'radio';
  /** The group's name, shown above its options. */
  label: string;
  /** The picked option's value, read when the menu opens (null: none). */
  value: string | null;
  /** Its options. */
  options: { value: string; label: string; disabled?: boolean }[];
  /** A newly picked option's value. */
  onValueChange?: (value: string) => void;
};

/** A named group of a menu's actions and on / off items. */
export type MenuGroup = {
  /** A group. */
  type: 'group';
  /** The group's name, shown above its items. */
  label: string;
  /** Its items. */
  items: (MenuActionItem | MenuCheckboxItem)[];
};

/** A line between a menu's items. */
export type MenuSeparator = {
  /** A separator. */
  type: 'separator';
};

/** One of a menu's items: an action, an on / off item, a one-of choice, a group or a separator. */
export type MenuItem =
  | MenuActionItem
  | MenuCheckboxItem
  | MenuRadioGroup
  | MenuGroup
  | MenuSeparator;

/** What {@link createMenu} makes a menu from. */
export type MenuProps = {
  /** Its trigger (a button): a click, Enter, Space or ArrowDown opens it on its first item,
   * ArrowUp on its last. */
  anchor: HTMLElement;
  /** Its items, or a getter re-read on every open (so a checked state or a value is the app's). */
  items: MenuItem[] | (() => MenuItem[]);
  /** The menu's accessible name (default: the trigger's `aria-label`, else its text). */
  label?: string;
  /** The side of the trigger it opens on when it fits there, else the opposite one. Default
   * 'bottom'. */
  side?: 'top' | 'bottom' | 'left' | 'right';
  /** Where along the side it lines up with the trigger. Default 'start'. */
  align?: 'start' | 'center' | 'end';
  /** Runs when it opens */
  onOpen?: () => void;
  /** Runs when it closes, however it closes */
  onClose?: () => void;
  /** Extra classes for the menu's element. */
  class?: string | string[];
  /** Extra attributes for the menu's element. */
  attr?: CMPAttr;
  /** The menu's element id (default: a generated one). */
  id?: string;
};

/** A menu {@link createMenu} made: its CMP and its controls. */
export type Menu = {
  /** The menu's element, in the HUD root only while it's open. `cmp.remove()` disposes of the
   * menu: its listeners on the trigger and the page and its ARIA on the trigger go. */
  cmp: CMPHandle;
  /** Opens it with the focus on its first item, or its last. */
  open: (focus?: 'first' | 'last') => void;
  /** Closes it, giving the focus back to the trigger when it was in the menu. */
  close: () => void;
  /** Opens it, or closes it when it's open. */
  toggle: () => void;
  /** Whether it's open */
  isOpen: () => boolean;
};

/** A focusable item of the open menu */
type Entry = {
  elem: HTMLElement;
  /** Its label, lowercased, for the typeahead */
  text: string;
  isDisabled: boolean;
  /** Whether it stays open on Space (an on / off item, a choice) */
  isCheckable: boolean;
  /** Does what it does (flips, picks, runs) */
  run: () => void;
};

/** How long typed letters make one search (the APG's typeahead) */
const TYPEAHEAD_MS = 500;
const ROLE_OF = { item: 'menuitem', checkbox: 'menuitemcheckbox', radio: 'menuitemradio' };

const createPart = (className: string, text = '') => {
  const span = document.createElement('span');
  span.className = className;
  span.textContent = text;
  return span;
};

/** An item's element: its check mark (on / off and choices), icon, label and shortcut's hint */
const createItemElem = (
  kind: keyof typeof ROLE_OF,
  props: { label: string; icon?: string; kbd?: string; disabled?: boolean; checked?: boolean }
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
  if (props.kbd) {
    elem.setAttribute('aria-keyshortcuts', getAriaKeyShortcuts(props.kbd));
    const kbd = createKbd({ keys: props.kbd, class: 'aekMenu__kbd' }).cmp.elem;
    kbd.setAttribute('aria-hidden', 'true');
    elem.append(kbd);
  }
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

/** Builds the items into `parent`, and returns its focusable entries in order */
const buildItems = (parent: HTMLElement, items: MenuItem[]) => {
  const entries: Entry[] = [];
  const addEntry = (to: HTMLElement, item: MenuActionItem | MenuCheckboxItem) => {
    const isCheckbox = item.type === 'checkbox';
    let checked = isCheckbox && item.checked;
    const elem = createItemElem(isCheckbox ? 'checkbox' : 'item', { ...item, checked });
    to.append(elem);
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
  return entries;
};

/**
 * Creates a menu (p803 D10, the APG menu button): a list of actions, on / off items, one-of
 * choices, groups and separators, opened by its trigger and anchored to it.
 * - Parts: `.aekMenu` (`role="menu"`), in the HUD root while it's open, in the browser's top layer
 *   (else at `--aek-z-tooltip`); `.aekMenu__item` (`menuitem`, `menuitemcheckbox`,
 *   `menuitemradio`; `aria-disabled`, `aria-checked`) with `__check`, `__icon`, `__label` and
 *   `__kbd`; `.aekMenu__group` (`role="group"`, its label from `data-label`);
 *   `.aekMenu__separator`.
 * - ARIA: the trigger gets `aria-haspopup="menu"`, `aria-expanded` and `aria-controls`.
 * - Keys, on the trigger: Enter, Space and ArrowDown open it on the first item, ArrowUp on the last.
 *   In the menu: the arrows move (wrapping), Home and End go to the ends, a typed letter (or a few,
 *   quickly) goes to the next item that starts with them; Enter picks the item and closes the menu,
 *   Space too, except on an on / off item or a choice, which it flips and keeps the menu open;
 *   Escape (the kit's overlay stack) and Tab close it with the focus back on the trigger. A disabled
 *   item is focusable and picks nothing. The keys reach no key binding.
 * - Pointer: hovering an item focuses it, a click picks it, a press outside closes the menu.
 *
 * The menu isn't added anywhere: dispose of it with `cmp.remove()` when its trigger goes.
 * @example
 * ```ts
 * const fileButton = createButton({ label: 'File' });
 * toolbarPanel.add(fileButton.cmp);
 * createMenu({
 *   anchor: fileButton.cmp.elem,
 *   items: () => [
 *     { label: 'Save', kbd: 'Ctrl+S', onSelect: () => saveScene() },
 *     { type: 'checkbox', label: 'Autosave', checked: settings.autosave,
 *       onCheckedChange: (on) => (settings.autosave = on) },
 *     { type: 'separator' },
 *     { label: 'Quit', onSelect: () => quitToMenu() },
 *   ],
 * });
 * ```
 */
export const createMenu = (props: MenuProps): Menu => {
  const { anchor, side = 'bottom', align = 'start' } = props;
  let isOpen = false;
  let entries: Entry[] = [];
  let hideAnchored: (() => void) | null = null;
  let removeOverlay: ((returnFocus?: boolean) => void) | null = null;
  let typed = '';
  let typedTimer: ReturnType<typeof setTimeout> | null = null;

  const clearTyped = () => {
    if (typedTimer) clearTimeout(typedTimer);
    typedTimer = null;
    typed = '';
  };

  /** Closes it; `returnFocus` false when the focus went elsewhere (an outside press) */
  const close = (returnFocus = true) => {
    if (!isOpen) return;
    isOpen = false;
    clearTyped();
    document.removeEventListener('pointerdown', onOutsidePress, true);
    removeOverlay?.(returnFocus);
    removeOverlay = null;
    hideAnchored?.();
    hideAnchored = null;
    anchor.setAttribute('aria-expanded', 'false');
    cmp.elem.replaceChildren();
    entries = [];
    cmp.elem.remove();
    props.onClose?.();
  };

  /** In the capture phase on the document: a press anywhere but the menu and its trigger (whose
   * own click toggles it) */
  function onOutsidePress(e: Event) {
    const target = e.target as Node | null;
    if (target && (cmp.elem.contains(target) || anchor.contains(target))) return;
    close(false);
  }

  const focusEntry = (index: number) => {
    entries[index]?.elem.focus({ preventScroll: true });
  };

  const open = (focus: 'first' | 'last' = 'first') => {
    if (isOpen || !anchor.isConnected) return;
    isOpen = true;
    const items = typeof props.items === 'function' ? props.items() : props.items;
    entries = buildItems(cmp.elem, items);
    if (entries.some((entry) => entry.elem.hasAttribute('data-leading'))) {
      cmp.elem.setAttribute('data-has-leading', '');
    } else {
      cmp.elem.removeAttribute('data-has-leading');
    }
    cmp.elem.setAttribute(
      'aria-label',
      props.label ?? anchor.getAttribute('aria-label') ?? (anchor.textContent ?? '').trim()
    );
    const parent = hasHudRoot()
      ? getHUDRootCMP().elem
      : anchor.closest(`.${KIT_ROOT_CLASS}`) ?? document.body;
    parent.appendChild(cmp.elem);
    anchor.setAttribute('aria-expanded', 'true');
    hideAnchored = showAnchored({
      elem: cmp.elem,
      anchor,
      side,
      align,
      matchAnchorWidth: true,
      onAnchorRemoved: () => close(false),
    });
    removeOverlay = pushOverlay({ elem: cmp.elem, close: () => close(), returnFocus: anchor });
    document.addEventListener('pointerdown', onOutsidePress, true);
    focusEntry(focus === 'first' ? 0 : entries.length - 1);
    props.onOpen?.();
  };

  const toggle = () => (isOpen ? close() : open());

  /** Picks an entry: what closes the menu closes it first, so what it runs (a dialog) gets the
   * focus from the trigger */
  const pick = (entry: Entry, keepOpen: boolean) => {
    if (entry.isDisabled) return;
    if (!keepOpen) close();
    entry.run();
  };

  /** The next entry whose label starts with the typed letters, from the focused one */
  const findTyped = (from: number) => {
    const count = entries.length;
    // One letter, or one typed again ('ss'), looks past the focused item, so pressing it again goes
    // on to the next; more letters include it
    const needle = /^(.)\1*$/.test(typed) ? typed[0] : typed;
    const start = needle.length === 1 ? 1 : 0;
    for (let k = start; k < count + start; k++) {
      const index = (from + k) % count;
      if (entries[index].text.startsWith(needle)) return index;
    }
    return -1;
  };

  const onMenuKeyDown = (e: Event) => {
    const key = e as KeyboardEvent;
    const index = entries.findIndex((entry) => entry.elem === document.activeElement);
    const count = entries.length;
    if (key.key === 'ArrowDown') focusEntry((index + 1) % count);
    else if (key.key === 'ArrowUp') focusEntry(index <= 0 ? count - 1 : index - 1);
    else if (key.key === 'Home') focusEntry(0);
    else if (key.key === 'End') focusEntry(count - 1);
    else if (key.key === 'Enter' && index !== -1) pick(entries[index], false);
    else if (key.key === ' ' && index !== -1) pick(entries[index], entries[index].isCheckable);
    else if (key.key === 'Tab') close();
    else if (key.key.length === 1 && !key.ctrlKey && !key.metaKey && !key.altKey) {
      if (typedTimer) clearTimeout(typedTimer);
      typed += key.key.toLowerCase();
      typedTimer = setTimeout(clearTyped, TYPEAHEAD_MS);
      const found = findTyped(Math.max(index, 0));
      if (found !== -1) focusEntry(found);
    } else return;
    e.preventDefault();
    e.stopPropagation();
    swallowNextKeyUp(key.key);
  };

  const getEntryOf = (target: EventTarget | null) =>
    target ? entries.find((entry) => entry.elem.contains(target as Node)) : undefined;

  const onAnchorClick = () => toggle();

  const onAnchorKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    e.stopPropagation();
    swallowNextKeyUp(e.key);
    if (isOpen) focusEntry(e.key === 'ArrowDown' ? 0 : entries.length - 1);
    else open(e.key === 'ArrowDown' ? 'first' : 'last');
  };

  const cmp: CMPHandle = CMP({
    id: props.id,
    idAttr: true,
    class: classes('aekMenu', props.class),
    attr: { ...props.attr, role: 'menu' },
    listeners: [
      { type: 'keydown', fn: onMenuKeyDown },
      {
        type: 'click',
        fn: (e) => {
          const entry = getEntryOf(e.target);
          if (entry) pick(entry, false);
        },
      },
      {
        type: 'pointermove',
        fn: (e) => {
          const entry = getEntryOf(e.target);
          if (entry && document.activeElement !== entry.elem) {
            entry.elem.focus({ preventScroll: true });
          }
        },
      },
      {
        type: 'focusout',
        fn: (e) => {
          const next = (e as FocusEvent).relatedTarget as Node | null;
          if (next && !cmp.elem.contains(next) && !anchor.contains(next)) close(false);
        },
      },
    ],
    onRemoveCmp: () => {
      close(false);
      anchor.removeEventListener('click', onAnchorClick);
      anchor.removeEventListener('keydown', onAnchorKeyDown);
      anchor.removeAttribute('aria-haspopup');
      anchor.removeAttribute('aria-expanded');
      anchor.removeAttribute('aria-controls');
    },
  });

  anchor.addEventListener('click', onAnchorClick);
  anchor.addEventListener('keydown', onAnchorKeyDown);
  anchor.setAttribute('aria-haspopup', 'menu');
  anchor.setAttribute('aria-expanded', 'false');
  anchor.setAttribute('aria-controls', cmp.id);

  return { cmp, open, close: () => close(), toggle, isOpen: () => isOpen };
};
