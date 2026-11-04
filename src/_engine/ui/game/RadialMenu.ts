import type { CMPAttr, CMPHandle } from '../core/CMPTypes';
import type { SvgIconKey } from '../core/icons/SvgIcon';
import { CMP, classes } from '../core/CMP';
import { getSvgIcon } from '../core/icons/SvgIcon';
import { getMoveTarget } from '../components/RovingFocus';
import { pushOverlay, swallowNextKeyUp } from '../overlays/OverlayStack';
import './RadialMenu.scss';
import '../styles/kit.scss';

/** An item of a {@link RadialMenu}. */
export type RadialMenuItem = {
  /** Its id, which `onSelect` reports. */
  id: string;
  /** Its name, short (under its icon on the ring, and in the centre while highlighted). */
  label: string;
  /** More about it, shown in the centre while it's highlighted and read as its description. */
  description?: string;
  /** A registered icon's name (`registerIcon`), drawn over its label. */
  icon?: SvgIconKey;
  /** Shown but not pickable (an item out of stock: say why in its description). */
  disabled?: boolean;
};

/** Where {@link RadialMenu}'s `open` puts the ring. */
export type RadialMenuOpenOptions = {
  /** The ring's centre in viewport px (a press's `clientX` / `clientY`), kept inside the menu's
   * bounds. Default: the centre of the bounds. */
  point?: { x: number; y: number };
  /** The item highlighted, with the focus, at the open (a keyboard's open). Default none: the
   * ring has the focus, so a stick's release right after picks nothing. */
  highlight?: number;
};

/** What {@link createRadialMenu} draws. */
export type RadialMenuProps = {
  /** Its items, clockwise from the top. */
  items: readonly RadialMenuItem[];
  /** Its name for assistive tech, and the centre's text while nothing is highlighted
   * ('Quick items'). */
  label: string;
  /** An item was picked (its id and index); the menu has closed. */
  onSelect?: (id: string, index: number) => void;
  /** It opened. */
  onOpen?: () => void;
  /** It closed, by a pick or not (the game resumes). */
  onClose?: () => void;
  /** How far a stick goes (0-1) before `setDirection` highlights (default 0.5). */
  deadZone?: number;
  /** Extra classes for its element. */
  class?: string | string[];
  /** Extra attributes for its element. */
  attr?: CMPAttr;
  /** Its element id (default: a generated one, not written to the element). */
  id?: string;
};

/** A radial menu {@link createRadialMenu} made: its CMP and its controls. */
export type RadialMenu = {
  /** Its element (`.aekRadialMenu`), `hidden` while closed: add it to the HUD root.
   * `cmp.remove()` closes it without giving the focus back. */
  cmp: CMPHandle;
  /** Shows the ring and takes the focus (the highlighted item, else the ring). Opening it again
   * moves it. */
  open: (options?: RadialMenuOpenOptions) => void;
  /** Hides it, nothing picked; the focus goes back to what had it. */
  close: () => void;
  /** Whether it's open */
  isOpen: () => boolean;
  /** A stick's position (the Gamepad API's axes: x right, y down, each -1 to 1), every frame
   * while it's open: past the dead zone it highlights the item in that direction; back inside it
   * the highlight stays, so the release picks it with `select()`. Writes only on a change. */
  setDirection: (x: number, y: number) => void;
  /** Picks the highlighted item (a stick's release, a button's): closes, then `onSelect`.
   * Returns whether an item was picked (none highlighted or a disabled one: false, still open). */
  select: () => boolean;
  /** The highlighted item's index, -1 for none */
  getHighlighted: () => number;
  /** Replaces the items (the highlight kept when its index still is one). */
  setItems: (items: readonly RadialMenuItem[]) => void;
};

const DEAD_ZONE = 0.5;
const TURN = Math.PI * 2;

const createPart = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string) => {
  const elem = document.createElement(tag);
  elem.className = className;
  return elem;
};

/** The item at a direction (screen axes: y down), clockwise from the top */
const getSectorIndex = (x: number, y: number, count: number) => {
  const angle = (Math.atan2(x, -y) + TURN) % TURN;
  return Math.round((angle / TURN) * count) % count;
};

/**
 * Creates a radial menu (p808 D8): a ring of items round a point (a quick item or emote wheel),
 * picked by the pointer's direction from the centre, a stick's (`setDirection`, then `select`
 * on its release), or the arrow keys round the ring. The centre shows the highlighted item's label
 * and description; a click there, or Escape, closes it. Picking closes it, then `onSelect`.
 * - Parts: `.aekRadialMenu` (fixed over the HUD's bounds while open, `data-open`), `__ring`
 *   (centred on the point: `--aek-radial-menu-x` / `-y`), an `__item` button per item
 *   (`data-index`, `data-highlighted`, its angle in `--aek-radial-menu-angle`) with its `__icon`
 *   and `__label`, and `__centre` with `__centreLabel` and `__centreDescription`.
 * - Custom properties (read on any ancestor): `--aek-radial-menu-radius` (the items' distance from
 *   the centre, default `--aek-space-7` × 4), `--aek-radial-menu-item-size`,
 *   `--aek-radial-menu-centre-size`, `--aek-radial-menu-highlight-color` (default
 *   `--aek-accent`), `--aek-radial-menu-backdrop` (default the backdrop token at half),
 *   `--aek-radial-menu-z` (default `--aek-z-loading`: above the app's windows, below its dialogs).
 * - Keys (open): the arrows go round the ring (Right / Down clockwise, Left / Up back, from the top
 *   when nothing is highlighted), Home / End to the ends; Enter / Space pick (a disabled item is
 *   reached, its description read, and picks nothing);
 *   Tab and Escape close (the overlay stack's). A key it uses goes no further.
 * - Pointer: the direction from the centre highlights (none inside the centre); a click picks the
 *   item there, or closes in the centre. A touch picks where it lifts.
 * - Assistive tech: the ring is a `role="menu"` named by `label`, each item a `menuitem` (the real
 *   focus follows the highlight; `aria-disabled`; its description by `aria-describedby`); the
 *   centre repeats the focused item, `aria-hidden`.
 * - Motion: the ring scales in over `--aek-motion-fast` (none under reduced motion).
 * @example
 * ```ts
 * import { createRadialMenu, getHUDRootCMP } from 'aekasha/ui';
 *
 * const wheel = createRadialMenu({
 *   label: 'Quick items',
 *   items: [
 *     { id: 'potion', label: 'Potion', description: 'Restores 50 health' },
 *     { id: 'torch', label: 'Torch' },
 *     { id: 'map', label: 'Map' },
 *     { id: 'bomb', label: 'Bomb', disabled: true, description: 'None left' },
 *   ],
 *   onSelect: (id) => console.log('use', id),
 * });
 * getHUDRootCMP().add(wheel.cmp);
 * // The app's map: RIGHT_SHOULDER held opens it, its stick calls wheel.setDirection(x, y) each
 * // frame and the release calls wheel.select(), else wheel.close()
 * wheel.open();
 * ```
 */
export const createRadialMenu = (props: RadialMenuProps): RadialMenu => {
  const deadZone = props.deadZone ?? DEAD_ZONE;
  let items: readonly RadialMenuItem[] = props.items;
  let itemElems: HTMLButtonElement[] = [];
  let highlighted = -1;
  let removeOverlay: ((returnFocus?: boolean) => void) | null = null;
  // The ring's centre and the centre part's radius in viewport px, read at the open
  let centreX = 0;
  let centreY = 0;
  let centreRadius = 0;

  const cmp = CMP({
    id: props.id,
    idAttr: props.id !== undefined,
    class: classes('aekRadialMenu', props.class),
    attr: { ...props.attr, hidden: '' },
    onRemoveCmp: () => {
      removeOverlay?.(false);
      removeOverlay = null;
      elem.removeEventListener('pointermove', onPointerMove);
      elem.removeEventListener('pointerdown', onPointerMove);
      elem.removeEventListener('click', onClick);
      elem.removeEventListener('keydown', onKeyDown);
    },
  });
  const elem = cmp.elem;

  const ring = createPart('div', 'aekRadialMenu__ring');
  ring.setAttribute('role', 'menu');
  ring.setAttribute('aria-label', props.label);
  ring.setAttribute('tabindex', '-1');
  ring.id = `${cmp.id}-ring`;
  const centre = createPart('div', 'aekRadialMenu__centre');
  centre.setAttribute('aria-hidden', 'true');
  const centreLabel = createPart('p', 'aekRadialMenu__centreLabel');
  const centreDescription = createPart('p', 'aekRadialMenu__centreDescription');
  centre.append(centreLabel, centreDescription);
  elem.append(ring, centre);

  const isOpen = () => removeOverlay !== null;

  const isDisabled = (index: number) => items[index]?.disabled === true;

  const writeCentre = () => {
    const item = items[highlighted];
    centreLabel.textContent = item ? item.label : props.label;
    centreDescription.textContent = item?.description ?? '';
    centre.toggleAttribute('data-empty', !item);
  };

  /** Highlights an item (-1: none) and gives it the focus while the menu has it */
  const highlight = (index: number) => {
    if (index === highlighted) return;
    itemElems[highlighted]?.removeAttribute('data-highlighted');
    highlighted = index;
    const next = itemElems[index];
    next?.setAttribute('data-highlighted', '');
    writeCentre();
    if (isOpen()) (next ?? ring).focus({ preventScroll: true });
  };

  const buildItems = () => {
    itemElems = items.map((item, index) => {
      const button = createPart('button', 'aekRadialMenu__item');
      button.type = 'button';
      button.setAttribute('role', 'menuitem');
      button.setAttribute('tabindex', '-1');
      button.setAttribute('data-index', String(index));
      button.style.setProperty('--aek-radial-menu-angle', `${(index / items.length) * 360}deg`);
      if (item.disabled) button.setAttribute('aria-disabled', 'true');
      if (item.icon) {
        const icon = createPart('span', 'aekRadialMenu__icon');
        icon.setAttribute('aria-hidden', 'true');
        icon.innerHTML = getSvgIcon(item.icon);
        button.append(icon);
      }
      const label = createPart('span', 'aekRadialMenu__label');
      label.textContent = item.label;
      button.append(label);
      if (item.description) {
        const description = createPart('span', 'aekRadialMenu__description');
        description.id = `${ring.id}-description-${index}`;
        description.hidden = true;
        description.textContent = item.description;
        button.setAttribute('aria-describedby', description.id);
        button.append(description);
      }
      return button;
    });
    ring.replaceChildren(...itemElems);
  };

  const close = (returnFocus = true) => {
    if (!removeOverlay) return;
    const remove = removeOverlay;
    removeOverlay = null;
    itemElems[highlighted]?.removeAttribute('data-highlighted');
    highlighted = -1;
    elem.setAttribute('hidden', '');
    elem.removeAttribute('data-open');
    remove(returnFocus);
    props.onClose?.();
  };

  /** Puts the ring on the point, kept inside the bounds (the layer's box) */
  const place = (point: { x: number; y: number } | undefined) => {
    const bounds = elem.getBoundingClientRect();
    const width = bounds.right - bounds.left;
    const height = bounds.bottom - bounds.top;
    // Layout sizes: the ring's scale-in transform would shrink its box
    const halfW = ring.offsetWidth / 2;
    const halfH = ring.offsetHeight / 2;
    const clamp = (value: number, half: number, size: number) =>
      size <= half * 2 ? size / 2 : Math.min(size - half, Math.max(half, value));
    const x = point ? clamp(point.x - bounds.left, halfW, width) : width / 2;
    const y = point ? clamp(point.y - bounds.top, halfH, height) : height / 2;
    elem.style.setProperty('--aek-radial-menu-x', `${x}px`);
    elem.style.setProperty('--aek-radial-menu-y', `${y}px`);
    centreX = bounds.left + x;
    centreY = bounds.top + y;
    centreRadius = centre.offsetWidth / 2;
  };

  const open = (options: RadialMenuOpenOptions = {}) => {
    const wasOpen = isOpen();
    elem.removeAttribute('hidden');
    elem.setAttribute('data-open', '');
    place(options.point);
    if (!wasOpen) {
      removeOverlay = pushOverlay({ elem, close: () => close() });
    }
    const index = options.highlight ?? -1;
    highlight(index >= 0 && index < items.length ? index : -1);
    (itemElems[highlighted] ?? ring).focus({ preventScroll: true });
    if (!wasOpen) props.onOpen?.();
  };

  const pick = (index: number) => {
    if (!isOpen() || index < 0 || index >= items.length || isDisabled(index)) return false;
    const { id } = items[index];
    close();
    props.onSelect?.(id, index);
    return true;
  };

  const setDirection = (x: number, y: number) => {
    if (!isOpen() || !items.length || x * x + y * y < deadZone * deadZone) return;
    highlight(getSectorIndex(x, y, items.length));
  };

  /** The item at the pointer's direction from the centre, -1 inside the centre */
  const getPointerIndex = (e: PointerEvent | MouseEvent) => {
    const x = e.clientX - centreX;
    const y = e.clientY - centreY;
    if (!items.length || x * x + y * y < centreRadius * centreRadius) return -1;
    return getSectorIndex(x, y, items.length);
  };

  const onPointerMove = (e: PointerEvent) => {
    if (isOpen()) highlight(getPointerIndex(e));
  };

  /** An item's click (Enter and Space on it too) picks it; elsewhere (the ring, the backdrop) the
   * item in that direction, or a close in the centre */
  const onClick = (e: MouseEvent) => {
    const item = (e.target as Element).closest('.aekRadialMenu__item');
    if (item && ring.contains(item)) {
      pick(Number(item.getAttribute('data-index')));
      return;
    }
    const index = getPointerIndex(e);
    if (index === -1) close();
    else pick(index);
  };

  const useKey = (e: KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();
    swallowNextKeyUp(e.key);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const { key } = e;
    if (key === 'Tab') {
      useKey(e);
      close();
      return;
    }
    if (key === 'Enter' || key === ' ') {
      // On an item its own click picks: kept from the action maps only
      if (e.target !== ring) {
        e.stopPropagation();
        swallowNextKeyUp(key);
        return;
      }
      useKey(e);
      pick(highlighted);
      return;
    }
    // Round the ring: Right and Down clockwise
    const moveKey = key === 'ArrowRight' ? 'ArrowDown' : key === 'ArrowLeft' ? 'ArrowUp' : key;
    const to = getMoveTarget(moveKey, highlighted, { count: items.length, wrap: true });
    if (to === null) return;
    useKey(e);
    if (to >= 0) highlight(to);
  };

  elem.addEventListener('pointermove', onPointerMove);
  elem.addEventListener('pointerdown', onPointerMove);
  elem.addEventListener('click', onClick);
  elem.addEventListener('keydown', onKeyDown);
  buildItems();
  writeCentre();

  return {
    cmp,
    open,
    close: () => close(),
    isOpen,
    setDirection,
    select: () => pick(highlighted),
    getHighlighted: () => highlighted,
    setItems: (next) => {
      const kept = highlighted < next.length ? highlighted : -1;
      itemElems[highlighted]?.removeAttribute('data-highlighted');
      highlighted = -1;
      items = next;
      buildItems();
      highlight(kept);
      writeCentre();
      // The focused item may have gone with the old ones
      if (isOpen()) (itemElems[highlighted] ?? ring).focus({ preventScroll: true });
    },
  };
};
