import type { CMPHandle } from '../core/CMPTypes';
import { getFocusableElements } from '../overlays/FocusTrap';
import { swallowNextKeyUp } from '../overlays/OverlayStack';

/** A direction {@link SpatialNavigation}'s `move` goes in: a d-pad's, an arrow key's. */
export type NavigationDirection = 'up' | 'down' | 'left' | 'right';

/** What {@link createSpatialNavigation} moves the focus in. */
export type SpatialNavigationProps = {
  /** The element (or CMP) whose tab stops it moves between: a menu's panel, a HUD's screen. */
  root: HTMLElement | CMPHandle;
  /** What `back()` does (a gamepad's `EAST`), and Escape on the root while it reaches it. None:
   * `back()` sends Escape to the overlay stack (a dialog's close), and Escape is left alone. */
  onBack?: () => void;
  /** Whether a move with nothing ahead goes round to the far side (default false): of the focused
   * element's focus group, else of the whole root. */
  wrap?: boolean;
  /** Whether it reads the arrow keys itself, a keydown on the root no element used (default
   * true). False: only `move` moves, the app's input calls it for both. */
  handleKeys?: boolean;
};

/** A spatial navigation {@link createSpatialNavigation} made: its moves and its disposal. */
export type SpatialNavigation = {
  /** Moves the focus to the nearest tab stop in `direction` (a d-pad's press). A composite with an
   * item ahead (a tab list, a list, a radio group) and a slider along its axis get the move as
   * their arrow key; at its edge a composite is left. With the focus outside the root it goes in
   * (the element last focused there, else the first). Returns whether the focus moved or the
   * element used the move (a sound's cue). */
  move: (direction: NavigationDirection) => boolean;
  /** Moves the focus to the next focus group, round (a shoulder button): the element last focused
   * in it, else its first. Returns whether it moved. */
  nextGroup: () => boolean;
  /** Moves the focus to the previous focus group, round. Returns whether it moved. */
  previousGroup: () => boolean;
  /** Goes back (a gamepad's `EAST`): `onBack`, else Escape for the overlay stack's top entry. */
  back: () => void;
  /** Moves the focus into the root: the element last focused there, else its first tab stop (a
   * menu's open). Returns whether it moved. */
  focus: () => boolean;
  /** Removes its listeners from the root. The root stays: it's the app's. */
  dispose: () => void;
};

type Axis = 'x' | 'y';
type Box = { left: number; top: number; right: number; bottom: number };
type Entry = { elem: HTMLElement; box: Box; group: Element | null };

const DIRECTIONS: Record<NavigationDirection, { key: string; axis: Axis; sign: 1 | -1 }> = {
  up: { key: 'ArrowUp', axis: 'y', sign: -1 },
  down: { key: 'ArrowDown', axis: 'y', sign: 1 },
  left: { key: 'ArrowLeft', axis: 'x', sign: -1 },
  right: { key: 'ArrowRight', axis: 'x', sign: 1 },
};

const KEY_DIRECTIONS: Record<string, NavigationDirection | undefined> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
};

const FOCUS_GROUP_ATTR = 'data-aek-focus-group';
const NAV_ATTR_PREFIX = 'data-aek-nav-';
/** The composites that move their own focus with the arrows (the APG's) */
const COMPOSITE_SELECTOR = [
  'tablist',
  'radiogroup',
  'toolbar',
  'listbox',
  'menu',
  'menubar',
  'tree',
  'treegrid',
  'grid',
]
  .map((role) => `[role="${role}"]`)
  .join(', ');
/** A composite's items: its roving `tabindex`es, or its native controls */
const ITEM_SELECTOR = '[tabindex], button:not([disabled]), input:not([disabled])';
/** The overlays a move outside the root goes to as their arrow key (a drop-down's list) */
const OVERLAY_SELECTOR = '[role="menu"], [role="listbox"]';
/** An input that isn't typed in (the rest use the arrows themselves) */
const UNTYPED_INPUTS = new Set(['button', 'checkbox', 'submit', 'reset', 'image', 'color', 'file']);
/** A box this close behind the focused one's edge still counts as ahead (rounding, borders) */
const EDGE_TOLERANCE = 1;
/** A script's focus that still shows the ring (no keydown came before a gamepad's move) */
const FOCUS_OPTIONS: FocusOptions & { focusVisible?: boolean } = { focusVisible: true };

const readBox = (elem: Element): Box => elem.getBoundingClientRect();

/** How far `to` lies ahead of `from` in the direction: its near edge past `from`'s far edge */
const getAlong = (from: Box, to: Box, direction: NavigationDirection) => {
  if (direction === 'right') return to.left - from.right;
  if (direction === 'left') return from.left - to.right;
  if (direction === 'down') return to.top - from.bottom;
  return from.top - to.bottom;
};

/** Whether `to`'s centre and far edge are past `from`'s: ahead, overlapping it */
const isCentreAhead = (from: Box, to: Box, direction: NavigationDirection) => {
  const { axis, sign } = DIRECTIONS[direction];
  const [fromStart, fromEnd, toStart, toEnd] =
    axis === 'x'
      ? [from.left, from.right, to.left, to.right]
      : [from.top, from.bottom, to.top, to.bottom];
  const centreAhead = (toStart + toEnd - fromStart - fromEnd) * sign > 0;
  const edgeAhead = sign > 0 ? toEnd > fromEnd : toStart < fromStart;
  return centreAhead && edgeAhead;
};

/** The gap between the boxes across the direction (0 when they overlap there), and their centres'
 * offset there (the tie-break) */
const getAcross = (from: Box, to: Box, axis: Axis) => {
  const [fromStart, fromEnd, toStart, toEnd] =
    axis === 'x'
      ? [from.top, from.bottom, to.top, to.bottom]
      : [from.left, from.right, to.left, to.right];
  const gap = Math.max(0, toStart - fromEnd, fromStart - toEnd);
  return { gap, offset: Math.abs(toStart + toEnd - fromStart - fromEnd) / 2 };
};

/** The entry nearest ahead of `from` in the direction (p808 D8): its distance along the direction
 * plus twice its gap across it, the smaller wins, then the smaller centre offset, then the first.
 * The boxes wholly ahead first; with none, the ones whose centre is (an overlapping layout). */
const findNearestAhead = <T extends { box: Box }>(
  from: Box,
  entries: readonly T[],
  direction: NavigationDirection
): T | null => {
  const { axis } = DIRECTIONS[direction];
  for (const isStrict of [true, false]) {
    let best: T | null = null;
    let bestScore = Infinity;
    let bestOffset = Infinity;
    for (const entry of entries) {
      const along = getAlong(from, entry.box, direction);
      const isAhead = isStrict
        ? along >= -EDGE_TOLERANCE
        : along < -EDGE_TOLERANCE && isCentreAhead(from, entry.box, direction);
      if (!isAhead) continue;
      const { gap, offset } = getAcross(from, entry.box, axis);
      const score = Math.max(0, along) + 2 * gap;
      if (score < bestScore || (score === bestScore && offset < bestOffset)) {
        best = entry;
        bestScore = score;
        bestOffset = offset;
      }
    }
    if (best) return best;
  }
  return null;
};

/** `from` moved behind the entries' far side, so the nearest ahead of it is the wrap's target */
const getWrapOrigin = (from: Box, entries: readonly Entry[], direction: NavigationDirection) => {
  const { axis, sign } = DIRECTIONS[direction];
  const size = axis === 'x' ? from.right - from.left : from.bottom - from.top;
  let edge = sign > 0 ? Infinity : -Infinity;
  for (const { box } of entries) {
    const near = axis === 'x' ? (sign > 0 ? box.left : box.right) : sign > 0 ? box.top : box.bottom;
    edge = sign > 0 ? Math.min(edge, near) : Math.max(edge, near);
  }
  const [start, end] = sign > 0 ? [edge - size, edge] : [edge, edge + size];
  return axis === 'x'
    ? { left: start, right: end, top: from.top, bottom: from.bottom }
    : { left: from.left, right: from.right, top: start, bottom: end };
};

const isRadio = (elem: Element): elem is HTMLInputElement =>
  elem.tagName === 'INPUT' && (elem as HTMLInputElement).type === 'radio';

/** A text entry, or a native control that moves with the arrows itself (a radio, a range) */
const isNativeArrowUser = (elem: Element) => {
  const tag = elem.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') return !UNTYPED_INPUTS.has((elem as HTMLInputElement).type);
  return elem.closest('[contenteditable]:not([contenteditable="false"])') !== null;
};

/** The axis a value control keeps for its own arrows (a slider's value, a separator's place) */
const getValueAxis = (elem: Element): Axis | null => {
  const role = elem.getAttribute('role');
  const orientation = elem.getAttribute('aria-orientation');
  if (role === 'slider') return orientation === 'vertical' ? 'y' : 'x';
  // A separator's line runs across its value: a vertical one moves sideways
  if (role === 'separator' && elem.hasAttribute('tabindex')) {
    return orientation === 'vertical' ? 'x' : 'y';
  }
  return null;
};

/** Whether an arrow keydown along `axis` on `elem` that reached the root is its own still (one a
 * native or another library's control uses without stopping it) */
const keepsArrowKey = (elem: Element, axis: Axis) => {
  if (isNativeArrowUser(elem)) return true;
  const role = elem.getAttribute('role');
  return role === 'slider' || role === 'spinbutton' || getValueAxis(elem) === axis;
};

/** Whether `elem` is rendered and nothing inert holds it */
const isLive = (elem: Element) => elem.getClientRects().length > 0 && !elem.closest('[inert]');

/**
 * Creates a spatial navigation (p808 D8): it moves the focus by position among the tab stops under
 * `root`, the way a game's menu moves with a d-pad, and reads the arrow keys itself. The app's
 * gamepad calls `move`, `nextGroup`, `previousGroup` and `back` (through its menu's action map);
 * the keyboard's Tab still works as on any page.
 * - Candidates: the tab stops under `root` (a focusable element without `tabindex="-1"`,
 *   rendered, not `inert`; one per roving composite, its stop; a radio group's checked radio).
 * - The choice: of the candidates ahead in the direction, the one whose distance along it plus
 *   twice its gap across it is the smallest (the boxes read once per move).
 * - Focus groups: an element with `data-aek-focus-group` (a sidebar, a panel's buttons) is tried
 *   first, the focused element's own; past its edge the nearest group or element ahead takes the
 *   move, a group on the element last focused in it. `nextGroup` / `previousGroup` go round them.
 * - Overrides: `data-aek-nav-up` (`-down`, `-left`, `-right`) on an element names the id the move
 *   goes to from it, where the layout misleads.
 * - Keys (on the root, with `handleKeys`): the arrows no element used (a composite, a text field,
 *   a slider keeps its own), and Escape with `onBack`; a key it uses goes no further. A move from
 *   the gamepad gives a composite its arrow while it has an item ahead, so a d-pad walks a tab list
 *   and leaves it from its edge; a slider keeps the moves along its axis; a text field is left.
 * - Focus: moved with `focusVisible`, so the ring shows after a gamepad's move too.
 * @example
 * ```ts
 * import { CMP, createSpatialNavigation, getHUDRootCMP } from 'aekasha/ui';
 *
 * const panel = CMP({
 *   html: '<div class="pauseMenu"><button>Resume</button><button>Quit</button></div>',
 * });
 * getHUDRootCMP().add(panel);
 * const navigation = createSpatialNavigation({
 *   root: panel,
 *   onBack: () => {
 *     navigation.dispose();
 *     panel.remove();
 *   },
 * });
 * navigation.focus();
 * // The app's menu map: its d-pad's actions call navigation.move('down'), its EAST navigation.back()
 * ```
 */
export const createSpatialNavigation = (props: SpatialNavigationProps): SpatialNavigation => {
  const rootElem = 'elem' in props.root ? props.root.elem : props.root;
  const isWrapping = props.wrap === true;
  const isHandlingKeys = props.handleKeys !== false;
  /** The element last focused in each group, and in the root */
  const lastFocused = new WeakMap<Element, HTMLElement>();
  // A key `move` sends a composite: it's not the root's to handle, nor the window's
  let isForwarding = false;

  const getGroup = (elem: Element) => {
    const group = elem.closest(`[${FOCUS_GROUP_ATTR}]`);
    return group && group !== rootElem && rootElem.contains(group) ? group : null;
  };

  /** A radio is a candidate when it's its group's stop: checked, else the group's first */
  const isRadioStop = (radio: HTMLInputElement) => {
    if (radio.checked || !radio.name) return true;
    let first: HTMLInputElement | null = null;
    const radios = rootElem.querySelectorAll<HTMLInputElement>('input[type="radio"]');
    for (let i = 0; i < radios.length; i++) {
      const other = radios[i];
      if (other.name !== radio.name || other.disabled) continue;
      if (other.checked) return false;
      first ??= other;
    }
    return first === radio;
  };

  const getCandidates = () =>
    getFocusableElements(rootElem).filter(
      (elem) => isLive(elem) && (!isRadio(elem) || isRadioStop(elem))
    );

  const getActive = () => {
    const active = document.activeElement as HTMLElement | null;
    return active && active !== document.body ? active : null;
  };

  const focusElem = (elem: HTMLElement) => {
    elem.focus(FOCUS_OPTIONS);
    return document.activeElement === elem;
  };

  /** Sends `key` to `target` as its keydown; whether it used it (or moved the focus) */
  const forwardKey = (target: HTMLElement, key: string) => {
    const event = new KeyboardEvent('keydown', {
      key,
      bubbles: true,
      cancelable: true,
      composed: true,
    });
    isForwarding = true;
    target.dispatchEvent(event);
    isForwarding = false;
    return event.defaultPrevented || document.activeElement !== target;
  };

  /** The element last focused in `scope` while it's still a candidate, else the first there */
  const getRemembered = (scope: Element, candidates: readonly HTMLElement[]) => {
    const last = lastFocused.get(scope);
    if (last && candidates.includes(last)) return last;
    return candidates.find((elem) => scope.contains(elem)) ?? null;
  };

  const focus = () => {
    const target = getRemembered(rootElem, getCandidates());
    return target ? focusElem(target) : false;
  };

  /** A native radio's arrow, which a sent key doesn't do: the next radio ahead, checked */
  const moveRadio = (radio: HTMLInputElement, direction: NavigationDirection) => {
    const radios = rootElem.querySelectorAll<HTMLInputElement>('input[type="radio"]');
    const entries: { elem: HTMLInputElement; box: Box }[] = [];
    for (let i = 0; i < radios.length; i++) {
      const other = radios[i];
      if (other === radio || other.name !== radio.name || other.disabled) continue;
      if (isLive(other)) entries.push({ elem: other, box: readBox(other) });
    }
    const next = findNearestAhead(readBox(radio), entries, direction);
    if (!next) return false;
    focusElem(next.elem);
    next.elem.click();
    return true;
  };

  /** Whether the composite holding `active` has an item ahead of it in the direction */
  const hasItemAhead = (composite: Element, active: Element, direction: NavigationDirection) => {
    const from = readBox(active);
    const items = composite.querySelectorAll(ITEM_SELECTOR);
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item === active || item.contains(active) || !isLive(item)) continue;
      if (getAlong(from, readBox(item), direction) >= -EDGE_TOLERANCE) return true;
    }
    return false;
  };

  /** The move by position: the focused element's group, then the rest (a group as one), then
   * round with `wrap` */
  const moveSpatially = (active: HTMLElement, direction: NavigationDirection) => {
    const from = readBox(active);
    const composite = active.closest(COMPOSITE_SELECTOR);
    const ownComposite = composite && rootElem.contains(composite) ? composite : null;
    const activeGroup = getGroup(active);
    const entries: Entry[] = [];
    for (const elem of getCandidates()) {
      if (elem === active || elem.contains(active) || ownComposite?.contains(elem)) continue;
      entries.push({ elem, box: readBox(elem), group: getGroup(elem) });
    }
    const inGroup = activeGroup ? entries.filter((entry) => entry.group === activeGroup) : [];
    const sameGroup = findNearestAhead(from, inGroup, direction);
    if (sameGroup) return focusElem(sameGroup.elem);

    const targets: Entry[] = [];
    const groups = new Set<Element>();
    for (const entry of entries) {
      if (activeGroup && entry.group === activeGroup) continue;
      if (!entry.group) targets.push(entry);
      else if (!groups.has(entry.group)) {
        groups.add(entry.group);
        targets.push({ elem: entry.group as HTMLElement, box: readBox(entry.group), group: null });
      }
    }
    const target = findNearestAhead(from, targets, direction);
    if (target && groups.has(target.elem)) {
      const members = entries.filter((entry) => entry.group === target.elem);
      const remembered = lastFocused.get(target.elem);
      const member = members.find((entry) => entry.elem === remembered);
      // Into a group: its element last focused, else its nearest to where the move came from
      const into = member ?? findNearestAhead(from, members, direction) ?? members[0];
      return focusElem(into.elem);
    }
    if (target) return focusElem(target.elem);

    if (!isWrapping) return false;
    const scope = activeGroup ? inGroup : entries;
    const wrapped = findNearestAhead(getWrapOrigin(from, scope, direction), scope, direction);
    return wrapped ? focusElem(wrapped.elem) : false;
  };

  /** The override's element, when `active` names one for the direction under the root */
  const getOverride = (active: HTMLElement, direction: NavigationDirection) => {
    const id = active.getAttribute(NAV_ATTR_PREFIX + direction);
    const target = id ? document.getElementById(id) : null;
    return target && rootElem.contains(target) && isLive(target) ? target : null;
  };

  const move = (direction: NavigationDirection) => {
    const { key, axis } = DIRECTIONS[direction];
    const active = getActive();
    if (!active || active === rootElem || !rootElem.contains(active)) {
      // A list the root's drop-down opened takes the move as its own arrow
      if (active?.closest(OVERLAY_SELECTOR)) return forwardKey(active, key);
      return focus();
    }
    const override = getOverride(active, direction);
    if (override) return focusElem(override);
    if (getValueAxis(active) === axis) return forwardKey(active, key);
    if (isRadio(active)) return moveRadio(active, direction) || moveSpatially(active, direction);
    const composite = active.closest(COMPOSITE_SELECTOR);
    if (
      composite &&
      rootElem.contains(composite) &&
      hasItemAhead(composite, active, direction) &&
      forwardKey(active, key)
    ) {
      return true;
    }
    return moveSpatially(active, direction);
  };

  const moveGroup = (step: 1 | -1) => {
    const candidates = getCandidates();
    const groups: Element[] = [];
    for (const elem of candidates) {
      const group = getGroup(elem);
      if (group && !groups.includes(group)) groups.push(group);
    }
    if (!groups.length) return false;
    const active = getActive();
    const from = active ? groups.indexOf(getGroup(active) as Element) : -1;
    const start = from === -1 && step === -1 ? groups.length : from;
    const next = groups[(((start + step) % groups.length) + groups.length) % groups.length];
    const target = getRemembered(next, candidates);
    return target ? focusElem(target) : false;
  };

  const back = () => {
    if (props.onBack) {
      props.onBack();
      return;
    }
    const active = getActive();
    forwardKey(active && rootElem.contains(active) ? active : rootElem, 'Escape');
  };

  const useKey = (e: KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();
    swallowNextKeyUp(e.key);
  };

  /** In the bubble phase on the root: after every element under it had the key */
  const onKeyDown = (e: KeyboardEvent) => {
    if (isForwarding) {
      e.stopPropagation();
      return;
    }
    if (!isHandlingKeys || e.defaultPrevented) return;
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    if (e.key === 'Escape') {
      if (!props.onBack) return;
      useKey(e);
      if (!e.repeat) props.onBack();
      return;
    }
    const direction = KEY_DIRECTIONS[e.key];
    const target = e.target as HTMLElement;
    if (!direction || keepsArrowKey(target, DIRECTIONS[direction].axis)) return;
    useKey(e);
    const override = getOverride(target, direction);
    if (override) focusElem(override);
    else if (target === rootElem) focus();
    else moveSpatially(target, direction);
  };

  const onFocusIn = (e: FocusEvent) => {
    const target = e.target as HTMLElement;
    if (target === rootElem) return;
    lastFocused.set(rootElem, target);
    const group = getGroup(target);
    if (group) lastFocused.set(group, target);
  };

  // Added without `handleKeys` too: it keeps the keys `move` sends from the window
  rootElem.addEventListener('keydown', onKeyDown);
  rootElem.addEventListener('focusin', onFocusIn);

  return {
    move,
    nextGroup: () => moveGroup(1),
    previousGroup: () => moveGroup(-1),
    back,
    focus,
    dispose: () => {
      rootElem.removeEventListener('keydown', onKeyDown);
      rootElem.removeEventListener('focusin', onFocusIn);
    },
  };
};
