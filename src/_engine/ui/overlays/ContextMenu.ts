// The context menu (p805 D11): the kit's menu opened at the pointer by a right click, at a focused
// element by the ContextMenu key or Shift+F10, or by a touch long press, over everything inside a
// target. One serves a whole container (a collection's rows, a form's fields): its items are a
// function of the element it opened on.
import type { CMPAttr, CMPHandle } from '../core/CMPTypes';
import type { AnchorPoint } from './Anchor';
import { createMenuSurface, type MenuItem } from './Menu';
import { swallowNextKeyUp } from './OverlayStack';

/** How a context menu was asked for. */
export type ContextMenuSource = 'pointer' | 'keyboard' | 'touch';

/** What {@link createContextMenu} makes a context menu from. */
export type ContextMenuProps = {
  /** The element whose descendants open it: a right click, the ContextMenu key or Shift+F10 on a
   * focused one, a touch long press. */
  target: HTMLElement;
  /** Its items, or a function of the element it's opening on (the one right-clicked, focused or
   * pressed) and how, read at each open. No items: nothing opens, and the browser's own menu shows
   * on a right click. */
  items: MenuItem[] | ((elem: Element, source: ContextMenuSource) => MenuItem[]);
  /** Its accessible name, or a function of the element (default 'Context menu'). */
  label?: string | ((elem: Element) => string);
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

/** A context menu {@link createContextMenu} made: its CMP and its controls. */
export type ContextMenu = {
  /** The menu's element, in the HUD root only while it's open. `cmp.remove()` disposes of it: its
   * listeners on the target go. */
  cmp: CMPHandle;
  /** Closes it, giving the focus back to what had it when it was in the menu. */
  close: () => void;
  /** Whether it's open */
  isOpen: () => boolean;
};

/** How long a touch is held, without moving, to open the menu */
const LONG_PRESS_MS = 500;
/** How far a held touch may move (px) and still be a long press */
const LONG_PRESS_SLOP = 10;
/** How long after a key or a long press opened the menu the browser's own `contextmenu` (some
 * browsers fire one for the key, or the long press) is dropped */
const OWN_OPEN_GRACE_MS = 1000;

const DEFAULT_LABEL = 'Context menu';

const isMenuKey = (e: KeyboardEvent) =>
  e.key === 'ContextMenu' ||
  (e.key === 'F10' && e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey);

/**
 * Creates a context menu (p805 D11): the kit's menu (`createMenu`'s items, submenus included)
 * opened over `target`'s descendants, its items read at each open from the element it opens on.
 * - Opens: a right click at the pointer (Shift+right click keeps the browser's own menu, as does a
 *   right click where `items` gives none); the ContextMenu key or Shift+F10 on a focused element
 *   inside the target, at the element's corner (bottom start); a touch held still for 500 ms, at
 *   the touch. The browser's own `contextmenu` that some browsers fire after the key or the long
 *   press is dropped.
 * - Keys and parts: the menu's (`createMenu`), Escape and a pick closing it with the focus back on
 *   what had it (the focused element, for the keys). At a point it takes the forced theme and
 *   density of the element it opened on.
 * - ARIA: the menu's; nothing on the target (a context menu has no trigger).
 *
 * The menu isn't added anywhere: dispose of it with `cmp.remove()` when its target goes.
 * @example
 * ```ts
 * // One menu for every row of a list: the row is found from the element
 * createContextMenu({
 *   target: entityList.elem,
 *   items: (elem) => {
 *     const row = elem.closest<HTMLElement>('[data-entity-id]');
 *     if (!row) return [];
 *     const id = Number(row.dataset.entityId);
 *     return [
 *       { label: 'Focus', onSelect: () => focusEntity(id) },
 *       { label: 'Delete', onSelect: () => deleteEntity(id) },
 *     ];
 *   },
 * });
 * ```
 */
export const createContextMenu = (props: ContextMenuProps): ContextMenu => {
  const { target } = props;
  const getItems = props.items;
  /** The items the open menu shows (a function's) */
  let current: MenuItem[] = [];
  let label = DEFAULT_LABEL;
  /** The browser's own `contextmenu` before this time is dropped (performance.now's clock) */
  let ownOpenUntil = 0;
  let press: { id: number; x: number; y: number; elem: Element; timer: number } | null = null;

  const surface = createMenuSurface({
    items: typeof getItems === 'function' ? () => current : getItems,
    getLabel: () => label,
    // A point: the menu lines its start up with it and opens below it
    side: 'bottom',
    align: 'start',
    onOpen: props.onOpen,
    onClose: () => {
      // The browser's own event follows the key (or its keyup) at once: after a close, a right
      // click is the user's
      ownOpenUntil = 0;
      props.onClose?.();
    },
    class: props.class,
    attr: props.attr,
    id: props.id,
    onRemove: () => {
      cancelPress();
      target.removeEventListener('contextmenu', onContextMenu);
      target.removeEventListener('keydown', onKeyDown);
      target.removeEventListener('pointerdown', onPointerDown);
      target.removeEventListener('pointermove', onPointerMove);
      target.removeEventListener('pointerup', cancelPress);
      target.removeEventListener('pointercancel', cancelPress);
    },
  });

  /** Opens the menu on `elem` at `anchor` when it has items; whether it did */
  const openOn = (elem: Element, source: ContextMenuSource, anchor: HTMLElement | AnchorPoint) => {
    const items = typeof getItems === 'function' ? getItems(elem, source) : getItems;
    if (!items.length) return false;
    if (surface.isOpen()) surface.close(false);
    current = items;
    label = typeof props.label === 'function' ? props.label(elem) : props.label ?? DEFAULT_LABEL;
    surface.open({ anchor, themeFrom: elem as HTMLElement });
    return true;
  };

  function cancelPress() {
    if (press) clearTimeout(press.timer);
    press = null;
  }

  function onContextMenu(e: Event) {
    const mouse = e as MouseEvent;
    cancelPress();
    if (performance.now() < ownOpenUntil) {
      ownOpenUntil = 0;
      e.preventDefault();
      return;
    }
    if (mouse.shiftKey) return;
    const { clientX = 0, clientY = 0 } = mouse;
    if (openOn(e.target as Element, 'pointer', { x: clientX, y: clientY })) e.preventDefault();
  }

  function onKeyDown(e: Event) {
    const key = e as KeyboardEvent;
    if (!isMenuKey(key)) return;
    const elem = e.target as HTMLElement;
    if (!openOn(elem, 'keyboard', elem)) return;
    e.preventDefault();
    e.stopPropagation();
    swallowNextKeyUp(key.key);
    ownOpenUntil = performance.now() + OWN_OPEN_GRACE_MS;
  }

  function onPointerDown(e: Event) {
    const pointer = e as PointerEvent;
    if (pointer.pointerType !== 'touch' || pointer.isPrimary === false) return;
    cancelPress();
    const { clientX = 0, clientY = 0, pointerId } = pointer;
    const elem = e.target as Element;
    const timer = window.setTimeout(() => {
      press = null;
      if (surface.isOpen()) return;
      if (openOn(elem, 'touch', { x: clientX, y: clientY })) {
        ownOpenUntil = performance.now() + OWN_OPEN_GRACE_MS;
      }
    }, LONG_PRESS_MS);
    press = { id: pointerId, x: clientX, y: clientY, elem, timer };
  }

  function onPointerMove(e: Event) {
    const pointer = e as PointerEvent;
    if (!press || pointer.pointerId !== press.id) return;
    const { clientX = 0, clientY = 0 } = pointer;
    if (Math.hypot(clientX - press.x, clientY - press.y) > LONG_PRESS_SLOP) cancelPress();
  }

  target.addEventListener('contextmenu', onContextMenu);
  target.addEventListener('keydown', onKeyDown);
  target.addEventListener('pointerdown', onPointerDown);
  target.addEventListener('pointermove', onPointerMove);
  target.addEventListener('pointerup', cancelPress);
  target.addEventListener('pointercancel', cancelPress);

  return { cmp: surface.cmp, close: () => surface.close(), isOpen: surface.isOpen };
};
