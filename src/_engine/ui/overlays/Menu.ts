import type { CMPAttr, CMPHandle } from '../core/CMPTypes';
import { CMP, classes } from '../core/CMP';
import { getHUDRootCMP, hasHudRoot, KIT_ROOT_CLASS } from '../core/HUD';
import type { Kbd } from '../components/Kbd';
import { createTypeahead, getMoveTarget, isTypeaheadKey } from '../components/RovingFocus';
import { showAnchored, type AnchorPoint } from './Anchor';
import {
  buildMenuItems,
  findMenuHintHandles,
  isInPointerPath,
  type MenuEntry,
  type MenuPoint,
  type StopHint,
} from './MenuItems';
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
  /** A shortcut's hint (`createKbd({ keys: 'Ctrl+S' })`), whose keys are its
   * `aria-keyshortcuts`. The menu removes it (see {@link MenuProps}' `items`). A string is
   * deprecated (removed in engine 6.0.0): the menu loads Kbd's code for it, so its hint appears a
   * frame later the first time. */
  kbd?: Kbd | string;
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
  /** A shortcut's hint (`createKbd({ keys: 'Ctrl+G' })`), as an action's `kbd`. */
  kbd?: Kbd | string;
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

/** A menu's item that opens a submenu (p805 D11): ArrowRight, Enter, Space, a click or a hover
 * of `--aek-submenu-delay` opens it beside the item. */
export type MenuSubmenuItem = {
  /** A submenu. */
  type: 'submenu';
  /** Its text, and its accessible name (the submenu's too). */
  label: string;
  /** Raw HTML of its icon (`getSvgIcon('gear')`), at `1em`. */
  icon?: string;
  /** Shown and focusable, but doesn't open (default false). */
  disabled?: boolean;
  /** The submenu's items: any of a menu's, another submenu too. */
  items: MenuItem[];
};

/** A named group of a menu's actions, on / off items and submenus. */
export type MenuGroup = {
  /** A group. */
  type: 'group';
  /** The group's name, shown above its items. */
  label: string;
  /** Its items. */
  items: (MenuActionItem | MenuCheckboxItem | MenuSubmenuItem)[];
};

/** A line between a menu's items. */
export type MenuSeparator = {
  /** A separator. */
  type: 'separator';
};

/** One of a menu's items: an action, an on / off item, a one-of choice, a submenu, a group or a
 * separator. */
export type MenuItem =
  | MenuActionItem
  | MenuCheckboxItem
  | MenuRadioGroup
  | MenuSubmenuItem
  | MenuGroup
  | MenuSeparator;

/** What {@link createMenu} makes a menu from. */
export type MenuProps = {
  /** Its trigger (a button): a click, Enter, Space or ArrowDown opens it on its first item,
   * ArrowUp on its last. */
  anchor: HTMLElement;
  /** Its items, or a getter re-read on every open (so a checked state or a value is the app's).
   * The menu removes their `kbd` hints, its submenus' too: a getter's at each close (it makes new
   * ones), an array's with the menu. */
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

/** How long a hover takes to open a submenu when `--aek-submenu-delay` can't be read */
const DEFAULT_SUBMENU_DELAY_MS = 150;

/** `--aek-submenu-delay` on the menu (`150ms`, `0.15s`), in ms: a delay, not motion, so reduced
 * motion keeps it (the tooltip's rule) */
const readSubmenuDelayMs = (elem: HTMLElement) => {
  if (typeof getComputedStyle !== 'function') return DEFAULT_SUBMENU_DELAY_MS;
  const value = getComputedStyle(elem).getPropertyValue('--aek-submenu-delay').trim();
  const match = value.match(/^([\d.]+)(ms|s)$/);
  if (!match) return DEFAULT_SUBMENU_DELAY_MS;
  return Number(match[1]) * (match[2] === 's' ? 1000 : 1);
};

/** Makes `anchor` the menu's trigger (its listeners and ARIA); returns what undoes it */
const wireTrigger = (
  anchor: HTMLElement,
  menuId: string,
  onClick: () => void,
  onKeyDown: (e: KeyboardEvent) => void
) => {
  anchor.addEventListener('click', onClick);
  anchor.addEventListener('keydown', onKeyDown);
  anchor.setAttribute('aria-haspopup', 'menu');
  anchor.setAttribute('aria-expanded', 'false');
  anchor.setAttribute('aria-controls', menuId);
  return () => {
    anchor.removeEventListener('click', onClick);
    anchor.removeEventListener('keydown', onKeyDown);
    anchor.removeAttribute('aria-haspopup');
    anchor.removeAttribute('aria-expanded');
    anchor.removeAttribute('aria-controls');
  };
};

/**
 * What `createMenuSurface` makes a menu from: a menu button's (`createMenu`) or a context menu's.
 * @internal
 */
export type MenuSurfaceProps = Pick<
  MenuProps,
  'items' | 'side' | 'align' | 'onOpen' | 'onClose' | 'class' | 'attr' | 'id'
> & {
  /** Its accessible name, read at each open */
  getLabel: () => string;
  /** At least as wide as an element it opens at (a menu button's) */
  matchAnchorWidth?: boolean;
  /** A node outside the menu a press or the focus may go to without closing it (the trigger,
   * whose own click toggles it) */
  isInside?: (node: Node) => boolean;
  /** Runs after its removal (`cmp.remove()`) */
  onRemove?: () => void;
};

/**
 * Where `MenuSurface.open` opens the menu.
 * @internal
 */
export type MenuOpenOptions = {
  /** Its trigger, or a point in viewport px (a context menu at the pointer) */
  anchor: HTMLElement | AnchorPoint;
  /** The item that takes the focus (default 'first') */
  focus?: 'first' | 'last';
  /** Where the focus goes when it closes (default: what had it) */
  returnFocus?: HTMLElement | null;
  /** The element whose forced theme and density the menu takes at a point */
  themeFrom?: HTMLElement;
};

/**
 * A menu without a trigger of its own: `createMenu` wires one onto it, a context menu its target.
 * @internal
 */
export type MenuSurface = {
  /** The root level's element; `cmp.remove()` disposes of the menu */
  cmp: CMPHandle;
  open: (options: MenuOpenOptions) => void;
  /** Closes every level, giving the focus back when it was in the menu (`returnFocus` true) */
  close: (returnFocus?: boolean) => void;
  /** Focuses the root level's first or last item */
  focusItem: (which: 'first' | 'last') => void;
  isOpen: () => boolean;
};

/** An open level of the menu: the root, or a submenu opened from an item of the level before */
type Level = {
  elem: HTMLElement;
  entries: MenuEntry[];
  typeahead: ReturnType<typeof createTypeahead>;
  hints: StopHint[];
  /** The item it opened from (none: the root) */
  parent: MenuEntry | null;
  hideAnchored: () => void;
  removeOverlay: (returnFocus?: boolean) => void;
};

/** An entry of an open level, with its level's index */
type Hit = { depth: number; entry: MenuEntry };

/**
 * Makes a menu that opens at an element or a point (p803 D10, p805 D11), with its submenus: one
 * level per open submenu, each anchored to its item (`showAnchored`, on its right, flipped at the
 * bounds) and an overlay stack entry of its own, so Escape closes one level.
 * @internal
 */
export const createMenuSurface = (props: MenuSurfaceProps): MenuSurface => {
  const { side = 'bottom', align = 'start' } = props;
  const isItemsGetter = typeof props.items === 'function';
  const levels: Level[] = [];
  /** The open menu's items: a getter's, whose hint handles go at the close */
  let openItems: MenuItem[] = [];
  let submenuDelay = DEFAULT_SUBMENU_DELAY_MS;
  /** A hovered submenu item's open, after the delay */
  let openTimer: ReturnType<typeof setTimeout> | null = null;
  /** The pointer heading for an open submenu: where it stops is acted on after the delay */
  let pathTimer: ReturnType<typeof setTimeout> | null = null;
  let lastPoint: MenuPoint | null = null;

  const clearTimers = () => {
    if (openTimer) clearTimeout(openTimer);
    if (pathTimer) clearTimeout(pathTimer);
    openTimer = null;
    pathTimer = null;
  };

  const isInMenu = (node: Node) => levels.some((level) => level.elem.contains(node));

  /** The deepest level holding `node` (-1: none) */
  const findDepth = (node: Node) => {
    for (let depth = levels.length - 1; depth >= 0; depth--) {
      if (levels[depth].elem.contains(node)) return depth;
    }
    return -1;
  };

  const findHit = (target: EventTarget | null): Hit | null => {
    const depth = target ? findDepth(target as Node) : -1;
    if (depth === -1) return null;
    const entry = levels[depth].entries.find((one) => one.elem.contains(target as Node));
    return entry ? { depth, entry } : null;
  };

  const focusEntry = (level: Level | undefined, index: number) => {
    level?.entries[index]?.elem.focus({ preventScroll: true });
  };

  /** Closes the levels from `depth` on, deepest first; `returnFocus` gives it back to what the
   * level at `depth` returns it to (its item, or the root's) when it was in there */
  const closeFrom = (depth: number, returnFocus: boolean) => {
    if (depth >= levels.length) return;
    clearTimers();
    for (let d = levels.length - 1; d >= depth; d--) {
      const level = levels[d];
      level.typeahead.clear();
      level.removeOverlay(returnFocus && d === depth);
      level.hideAnchored();
      // An array's handles stay for the next open; a string's hints always go
      for (const stopHint of level.hints) stopHint(false);
      level.parent?.elem.setAttribute('aria-expanded', 'false');
      level.parent?.elem.removeAttribute('aria-controls');
      if (d > 0) {
        unlisten(level.elem);
        level.elem.remove();
      }
    }
    levels.length = depth;
    if (depth > 0) return;
    document.removeEventListener('pointerdown', onOutsidePress, true);
    cmp.elem.replaceChildren();
    cmp.elem.remove();
    // A getter makes new hint handles on each open: this open's go, drawn or not
    if (isItemsGetter) for (const handle of findMenuHintHandles(openItems)) handle.cmp.remove();
    openItems = [];
    lastPoint = null;
    props.onClose?.();
  };

  /** In the capture phase on the document: a press anywhere but the menu (any level) and what
   * counts as inside it (the trigger, whose own click toggles it) */
  function onOutsidePress(e: Event) {
    const target = e.target as Node | null;
    if (target && (isInMenu(target) || props.isInside?.(target))) return;
    closeFrom(0, false);
  }

  const makeLevel = (elem: HTMLElement, items: MenuItem[], parent: MenuEntry | null) => {
    const level: Level = {
      elem,
      entries: [],
      typeahead: createTypeahead({
        getCount: () => level.entries.length,
        getText: (index) => level.entries[index].text,
      }),
      hints: [],
      parent,
      hideAnchored: () => {},
      removeOverlay: () => {},
    };
    level.entries = buildMenuItems(elem, items, level.hints);
    return level;
  };

  /** Opens `entry`'s submenu beside it (the level after `depth`), closing another one open there;
   * `focus` puts the focus on its first item (a key, a click), else it stays (a hover) */
  const openSubmenu = (depth: number, entry: MenuEntry, focus: boolean) => {
    const childDepth = depth + 1;
    const open = levels[childDepth];
    if (open?.parent === entry) {
      if (focus) focusEntry(open, 0);
      return;
    }
    closeFrom(childDepth, false);
    if (entry.isDisabled || !entry.submenu) return;
    const elem = document.createElement('div');
    elem.className = 'aekMenu';
    elem.id = `${cmp.id}-${childDepth}`;
    elem.setAttribute('role', 'menu');
    elem.setAttribute('data-submenu', '');
    elem.setAttribute('aria-label', entry.elem.querySelector('.aekMenu__label')?.textContent ?? '');
    (cmp.elem.parentElement ?? document.body).appendChild(elem);
    const level = makeLevel(elem, entry.submenu, entry);
    levels.push(level);
    listen(elem);
    entry.elem.setAttribute('aria-expanded', 'true');
    entry.elem.setAttribute('aria-controls', elem.id);
    level.hideAnchored = showAnchored({
      elem,
      anchor: entry.elem,
      side: 'right',
      align: 'start',
      gap: 0,
      onAnchorRemoved: () => closeFrom(childDepth, false),
    });
    level.removeOverlay = pushOverlay({
      elem,
      close: () => closeFrom(childDepth, true),
      returnFocus: entry.elem,
    });
    if (focus) focusEntry(level, 0);
  };

  /** Picks an entry: what closes the menu closes it first, so what it runs (a dialog) gets the
   * focus from the trigger */
  const pick = (entry: MenuEntry, keepOpen: boolean) => {
    if (entry.isDisabled) return;
    if (!keepOpen) closeFrom(0, true);
    entry.run();
  };

  const onKeyDown = (e: Event) => {
    const key = e as KeyboardEvent;
    const depth = findDepth(e.target as Node);
    const level = levels[depth];
    if (!level) return;
    const index = level.entries.findIndex((one) => one.elem === document.activeElement);
    const entry = level.entries[index];
    const moveTo = getMoveTarget(key.key, index, { count: level.entries.length, wrap: true });
    const opensSubmenu = key.key === 'ArrowRight' || key.key === 'Enter' || key.key === ' ';
    if (moveTo !== null) focusEntry(level, moveTo);
    else if (entry?.submenu && opensSubmenu) openSubmenu(depth, entry, true);
    else if (key.key === 'ArrowLeft' && depth > 0) closeFrom(depth, true);
    else if (key.key === 'Enter' && entry) pick(entry, false);
    else if (key.key === ' ' && entry) pick(entry, entry.isCheckable);
    else if (key.key === 'Tab') closeFrom(0, true);
    else if (isTypeaheadKey(key)) {
      const found = level.typeahead.type(key.key, Math.max(index, 0));
      if (found !== -1) focusEntry(level, found);
    } else return;
    e.preventDefault();
    e.stopPropagation();
    swallowNextKeyUp(key.key);
  };

  const onClick = (e: Event) => {
    const hit = findHit(e.target);
    if (!hit) return;
    if (hit.entry.submenu) openSubmenu(hit.depth, hit.entry, true);
    else pick(hit.entry, false);
  };

  /** The pointer rests on `hit`'s item: it takes the focus, a submenu open beside another item of
   * its level closes, and a submenu item opens its own after the delay */
  const settleHover = ({ depth, entry }: Hit) => {
    clearTimers();
    if (document.activeElement !== entry.elem) entry.elem.focus({ preventScroll: true });
    const child = levels[depth + 1];
    if (child && child.parent !== entry) closeFrom(depth + 1, false);
    if (!entry.submenu || entry.isDisabled || levels[depth + 1]) return;
    openTimer = setTimeout(() => {
      openTimer = null;
      if (document.activeElement === entry.elem) openSubmenu(depth, entry, false);
    }, submenuDelay);
  };

  const onPointerMove = (e: Event) => {
    const { clientX = 0, clientY = 0 } = e as PointerEvent;
    const point = { x: clientX, y: clientY };
    const from = lastPoint;
    lastPoint = point;
    const hit = findHit(e.target);
    if (!hit) return;
    const child = levels[hit.depth + 1];
    if (child && child.parent === hit.entry) {
      clearTimers();
      return;
    }
    // Heading for an open submenu across its level's other items: it stays open, and where the
    // pointer stops is acted on after the delay
    if (child && from && isInPointerPath(from, point, child.elem.getBoundingClientRect())) {
      if (pathTimer) clearTimeout(pathTimer);
      pathTimer = setTimeout(() => {
        pathTimer = null;
        if (levels[hit.depth]?.entries.includes(hit.entry)) settleHover(hit);
      }, submenuDelay);
      return;
    }
    settleHover(hit);
  };

  const onFocusOut = (e: Event) => {
    const next = (e as FocusEvent).relatedTarget as Node | null;
    if (next && !isInMenu(next) && !props.isInside?.(next)) closeFrom(0, false);
  };

  /** A submenu's listeners (the root's are its CMP's), capture as a CMP's are */
  const LEVEL_LISTENERS: [string, (e: Event) => void][] = [
    ['keydown', onKeyDown],
    ['click', onClick],
    ['pointermove', onPointerMove],
    ['focusout', onFocusOut],
  ];
  const listen = (elem: HTMLElement) => {
    for (const [type, fn] of LEVEL_LISTENERS) elem.addEventListener(type, fn, true);
  };
  const unlisten = (elem: HTMLElement) => {
    for (const [type, fn] of LEVEL_LISTENERS) elem.removeEventListener(type, fn, true);
  };

  const open = ({ anchor, focus = 'first', returnFocus, themeFrom }: MenuOpenOptions) => {
    const anchorElem = 'nodeType' in anchor ? anchor : null;
    if (levels.length || (anchorElem && !anchorElem.isConnected)) return;
    openItems = typeof props.items === 'function' ? props.items() : props.items;
    const root = makeLevel(cmp.elem, openItems, null);
    levels.push(root);
    cmp.elem.setAttribute('aria-label', props.getLabel());
    const owner = anchorElem ?? themeFrom;
    const parent = hasHudRoot()
      ? getHUDRootCMP().elem
      : owner?.closest(`.${KIT_ROOT_CLASS}`) ?? document.body;
    parent.appendChild(cmp.elem);
    root.hideAnchored = showAnchored({
      elem: cmp.elem,
      anchor,
      side,
      align,
      themeFrom,
      matchAnchorWidth: props.matchAnchorWidth,
      onAnchorRemoved: () => closeFrom(0, false),
    });
    root.removeOverlay = pushOverlay({
      elem: cmp.elem,
      close: () => closeFrom(0, true),
      ...(returnFocus === undefined ? {} : { returnFocus }),
    });
    submenuDelay = readSubmenuDelayMs(cmp.elem);
    document.addEventListener('pointerdown', onOutsidePress, true);
    focusEntry(root, focus === 'first' ? 0 : root.entries.length - 1);
    props.onOpen?.();
  };

  const cmp: CMPHandle = CMP({
    id: props.id,
    idAttr: true,
    class: classes('aekMenu', props.class),
    attr: { ...props.attr, role: 'menu' },
    listeners: LEVEL_LISTENERS.map(([type, fn]) => ({ type, fn })),
    onRemoveCmp: () => {
      closeFrom(0, false);
      if (!isItemsGetter) {
        for (const handle of findMenuHintHandles(props.items as MenuItem[])) handle.cmp.remove();
      }
      props.onRemove?.();
    },
  });

  return {
    cmp,
    open,
    close: (returnFocus = true) => closeFrom(0, returnFocus),
    focusItem: (which) => {
      const root = levels[0];
      focusEntry(root, which === 'first' ? 0 : (root?.entries.length ?? 0) - 1);
    },
    isOpen: () => levels.length > 0,
  };
};

/**
 * Creates a menu (p803 D10, the APG menu button): a list of actions, on / off items, one-of
 * choices, submenus (p805 D11), groups and separators, opened by its trigger and anchored to it.
 * - Parts: `.aekMenu` (`role="menu"`), in the HUD root while it's open, in the browser's top layer
 *   (else at `--aek-z-tooltip`); `.aekMenu__item` (`menuitem`, `menuitemcheckbox`,
 *   `menuitemradio`; `aria-disabled`, `aria-checked`; `aria-keyshortcuts` from its `kbd`) with
 *   `__check`, `__icon`, `__label`, `__kbd` and a submenu item's `__submenuMark`; `.aekMenu__group`
 *   (`role="group"`, its label from `data-label`); `.aekMenu__separator`. An open submenu is an
 *   `.aekMenu[data-submenu]` of its own beside its item, named by the item's label.
 * - ARIA: the trigger gets `aria-haspopup="menu"`, `aria-expanded` and `aria-controls`; a submenu
 *   item `aria-haspopup="menu"`, `aria-expanded` and, while open, `aria-controls`.
 * - Keys, on the trigger: Enter, Space and ArrowDown open it on the first item, ArrowUp on the last.
 *   In the menu: the arrows move (wrapping), Home and End go to the ends, a typed letter (or a few,
 *   quickly) goes to the next item that starts with them; Enter picks the item and closes the menu,
 *   Space too, except on an on / off item or a choice, which it flips and keeps the menu open;
 *   ArrowRight, Enter or Space on a submenu item opens it on its first item, and ArrowLeft in a
 *   submenu closes it back to its item; Escape (the kit's overlay stack) closes one level, the last
 *   with the focus back on the trigger; Tab closes every level, with the focus back on the
 *   trigger. A disabled item is focusable and picks or opens nothing. The keys reach no key binding.
 * - Pointer: hovering an item focuses it, a click picks it (or opens its submenu), a press outside
 *   closes the menu. Hovering a submenu item opens it after `--aek-submenu-delay` (150 ms; a delay,
 *   not motion), and the submenu stays open while the pointer heads for it across the other items.
 *
 * The menu isn't added anywhere: dispose of it with `cmp.remove()` when its trigger goes.
 * @example
 * ```ts
 * const fileButton = createButton({ label: 'File' });
 * toolbarPanel.add(fileButton.cmp);
 * createMenu({
 *   anchor: fileButton.cmp.elem,
 *   items: () => [
 *     { label: 'Save', kbd: createKbd({ keys: 'Ctrl+S' }), onSelect: () => saveScene() },
 *     { type: 'checkbox', label: 'Autosave', checked: settings.autosave,
 *       onCheckedChange: (on) => (settings.autosave = on) },
 *     { type: 'submenu', label: 'Export', items: [
 *       { label: 'As glTF', onSelect: () => exportScene('gltf') },
 *       { label: 'As JSON', onSelect: () => exportScene('json') },
 *     ] },
 *     { type: 'separator' },
 *     { label: 'Quit', onSelect: () => quitToMenu() },
 *   ],
 * });
 * ```
 */
export const createMenu = (props: MenuProps): Menu => {
  const { anchor } = props;
  const surface = createMenuSurface({
    ...props,
    getLabel: () =>
      props.label ?? anchor.getAttribute('aria-label') ?? (anchor.textContent ?? '').trim(),
    matchAnchorWidth: true,
    isInside: (node) => anchor.contains(node),
    onOpen: () => {
      anchor.setAttribute('aria-expanded', 'true');
      props.onOpen?.();
    },
    onClose: () => {
      anchor.setAttribute('aria-expanded', 'false');
      props.onClose?.();
    },
    onRemove: () => unwireTrigger(),
  });

  const open = (focus: 'first' | 'last' = 'first') =>
    surface.open({ anchor, focus, returnFocus: anchor });
  const toggle = () => (surface.isOpen() ? surface.close() : open());

  const onAnchorKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    e.stopPropagation();
    swallowNextKeyUp(e.key);
    const which = e.key === 'ArrowDown' ? 'first' : 'last';
    if (surface.isOpen()) surface.focusItem(which);
    else open(which);
  };

  const unwireTrigger = wireTrigger(anchor, surface.cmp.id, toggle, onAnchorKeyDown);

  return {
    cmp: surface.cmp,
    open,
    close: () => surface.close(),
    toggle,
    isOpen: surface.isOpen,
  };
};
