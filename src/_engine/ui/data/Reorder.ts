// A list's reorder (p805 D8): Alt + ArrowUp / ArrowDown on the focused row, a pointer drag with a
// drop line (on a touch screen from the row's handle), each move announced. Opt-in: the app passes
// `createListReorder()`'s handle, and the list reaches its code through `useListReorder`, so a list
// without it carries none.
import { announce } from '../components/Announcer';
import { getMotionFactor } from '../core/Motion';
import { pushOverlay } from '../overlays/OverlayStack';

/** How far (px) a press moves before it's a drag, not a click */
const DRAG_THRESHOLD = 4;
/** How near (px) the box's top or bottom edge a drag scrolls it */
const EDGE_SIZE = 32;
/** The edge scroll's top speed (px per frame) */
const EDGE_SPEED = 12;

/** A move of one row: its key, and its index in the items before and after it. */
export type ListReorderChange = {
  /** The moved row's key */
  key: string;
  /** Its index in the items before the move */
  from: number;
  /** Its index in the items after the move (the others closing the gap) */
  to: number;
};

/** What {@link createListReorder} makes a list's reorder from. */
export type ListReorderProps = {
  /** A move the user made (a drop, Alt + ArrowUp / ArrowDown). The app puts the item there
   * (`setItems`), unless `optimistic` has the list do it. */
  onReorder: (change: ListReorderChange) => void;
  /** Moves the row in the list at once, before `onReorder` (default false: the app's next
   * `setItems` does). */
  optimistic?: boolean;
};

/** A reorder {@link createListReorder} made: give it to one list as its `reorder`. */
export type ListReorder = {
  /** Always 'listReorder': what it is, for the list that takes it */
  readonly kind: 'listReorder';
};

/**
 * What the reorder reads and does through its list.
 * @internal
 */
export type ListReorderHost = {
  /** The list's element (the click after a drop is stopped there, before the rows get it) */
  root: HTMLElement;
  /** The rows' scroll box */
  box: HTMLElement;
  /** Every row's key, in the items' order */
  getKeys: () => readonly string[];
  /** Whether a row can move now (no filter query; not a disabled row) */
  canMove: (key: string) => boolean;
  /** The key of the row holding an element */
  keyAt: (elem: Element) => string | null;
  /** The rendered rows, in order */
  getRendered: () => readonly { key: string; elem: HTMLElement }[];
  /** Keeps a row rendered while it's dragged (null: none) */
  holdRow: (key: string | null) => void;
  /** Moves a row to `to` in the list itself (`optimistic`) */
  move: (key: string, to: number) => void;
  /** A row's title, for the announcement */
  getTitle: (key: string) => string;
};

/**
 * A reorder attached to its list.
 * @internal
 */
export type ListReorderView = {
  /** Alt + ArrowUp / ArrowDown on a row: whether it was one (the list stops it) */
  onKeyDown: (e: KeyboardEvent, key: string) => boolean;
  /** Ends a drag and removes the listeners */
  dispose: () => void;
};

/**
 * What a list does with a reorder: `attach` it to its rows.
 * @internal
 */
export type ListReorderImpl = { attach: (host: ListReorderHost) => ListReorderView };

const impls = new WeakMap<ListReorder, ListReorderImpl>();

/**
 * The code of the reorder an app passed (null for none): what the list calls instead of importing
 * this module.
 * @internal
 */
export const useListReorder = (reorder: ListReorder | undefined) =>
  (reorder && impls.get(reorder)) ?? null;

type Drag = {
  pointerId: number;
  key: string;
  elem: HTMLElement;
  startY: number;
  startScroll: number;
  isStarted: boolean;
  /** Whether the row follows the pointer (not under reduced motion: an outline only) */
  isLifted: boolean;
  /** The box's rect at the drag's start (it doesn't move during one) */
  boxRect: DOMRect | null;
  /** Where it would drop: before this key, or after the last rendered row (null) */
  before: string | null;
  after: string | null;
};

/**
 * Creates a reorder (p805 D8) for one list: the user moves a row with Alt + ArrowUp / ArrowDown,
 * or drags it (on a touch screen by its handle, `.aekList__handle`, since a drag on the row
 * scrolls). The dragged row lifts (`data-dragging`; with reduced motion an outline, no
 * movement), a line shows where it drops (`.aekList__dropLine`), the box scrolls near its edges,
 * and Escape cancels. Each move is announced ("Lamp moved to 3 of 8") and reported to
 * `onReorder`. Not while the list is filtered.
 * @param props the move's report, and whether the list moves the row itself
 * @example
 * ```ts
 * type Layer = { id: string; name: string };
 *
 * let layers: Layer[] = getLayers();
 * const layerList = createList<Layer>({
 *   label: 'Layers',
 *   items: () => layers,
 *   title: (layer) => layer.name,
 *   reorder: createListReorder({
 *     onReorder: ({ from, to }) => {
 *       const next = layers.slice();
 *       next.splice(to, 0, ...next.splice(from, 1));
 *       layers = next;
 *       layerList.refresh();
 *     },
 *   }),
 * });
 * ```
 */
export const createListReorder = (props: ListReorderProps): ListReorder => {
  const handle: ListReorder = { kind: 'listReorder' };

  const attach = (host: ListReorderHost): ListReorderView => {
    const { box, root } = host;
    let drag: Drag | null = null;
    let dropLine: HTMLElement | null = null;
    let removeEscapeEntry: ((returnFocus?: boolean) => void) | null = null;
    let lastY = 0;
    let frame = 0;
    let isClickStopped = false;
    let clickTimer: ReturnType<typeof setTimeout> | null = null;

    const commit = (key: string, from: number, to: number) => {
      if (from === to || from === -1) return;
      if (props.optimistic) host.move(key, to);
      props.onReorder({ key, from, to });
      announce(box, `${host.getTitle(key)} moved to ${to + 1} of ${host.getKeys().length}`);
    };

    const onKeyDown = (e: KeyboardEvent, key: string) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return false;
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return false;
      if (!host.canMove(key)) return true;
      const keys = host.getKeys();
      const from = keys.indexOf(key);
      const to = Math.max(0, Math.min(keys.length - 1, from + (e.key === 'ArrowUp' ? -1 : 1)));
      commit(key, from, to);
      return true;
    };

    /** Where the pointer at `clientY` drops the row: before the first rendered row whose middle
     * is below it, else after the last */
    const findDrop = (clientY: number) => {
      if (!drag) return;
      const rows = host.getRendered();
      let before: { key: string; elem: HTMLElement } | null = null;
      let after: { key: string; elem: HTMLElement } | null = null;
      for (const row of rows) {
        if (row.key === drag.key || row.elem.hasAttribute('data-pinned')) continue;
        const rect = row.elem.getBoundingClientRect();
        if (clientY < rect.top + rect.height / 2) {
          before = row;
          break;
        }
        after = row;
      }
      drag.before = before?.key ?? null;
      drag.after = before ? null : after?.key ?? null;
      if (!dropLine) return;
      const at = before
        ? before.elem.offsetTop
        : after
          ? after.elem.offsetTop + after.elem.offsetHeight
          : 0;
      dropLine.style.top = `${at}px`;
    };

    /** The index the row drops at: among the keys without it, where its neighbour is */
    const getDropIndex = (current: Drag) => {
      const keys = host.getKeys().filter((key) => key !== current.key);
      if (current.before !== null) return keys.indexOf(current.before);
      if (current.after !== null) return keys.indexOf(current.after) + 1;
      return host.getKeys().indexOf(current.key);
    };

    const follow = () => {
      if (!drag?.isStarted) return;
      const moved = lastY - drag.startY + ((box.scrollTop || 0) - drag.startScroll);
      if (drag.isLifted) drag.elem.style.transform = `translateY(${moved}px)`;
      findDrop(lastY);
    };

    /** Scrolls the box while the pointer is near its edge, each frame */
    const edgeScroll = () => {
      frame = 0;
      if (!drag?.isStarted) return;
      const rect = drag.boxRect ?? box.getBoundingClientRect();
      // No box laid out (hidden): nothing to scroll toward
      if (!rect.height) return;
      const fromTop = lastY - rect.top;
      const fromBottom = rect.bottom - lastY;
      let speed = 0;
      if (fromTop < EDGE_SIZE) speed = -EDGE_SPEED * (1 - Math.max(0, fromTop) / EDGE_SIZE);
      else if (fromBottom < EDGE_SIZE) {
        speed = EDGE_SPEED * (1 - Math.max(0, fromBottom) / EDGE_SIZE);
      }
      if (!speed) return;
      box.scrollTop += speed;
      follow();
      frame = requestAnimationFrame(edgeScroll);
    };

    const clear = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      removeEscapeEntry?.(false);
      removeEscapeEntry = null;
      dropLine?.remove();
      dropLine = null;
      if (drag) {
        drag.elem.removeAttribute('data-dragging');
        drag.elem.style.removeProperty('transform');
        if (drag.isStarted && box.hasPointerCapture?.(drag.pointerId)) {
          box.releasePointerCapture(drag.pointerId);
        }
      }
      drag = null;
      host.holdRow(null);
    };

    const start = (current: Drag) => {
      current.isStarted = true;
      current.isLifted = getMotionFactor(box) > 0;
      current.boxRect = box.getBoundingClientRect();
      host.holdRow(current.key);
      box.setPointerCapture?.(current.pointerId);
      current.elem.setAttribute('data-dragging', '');
      dropLine = document.createElement('div');
      dropLine.className = 'aekList__dropLine';
      dropLine.setAttribute('aria-hidden', 'true');
      box.append(dropLine);
      removeEscapeEntry = pushOverlay({ elem: box, close: clear, returnFocus: null });
    };

    const onPointerDown = (e: Event) => {
      const pe = e as PointerEvent;
      if (drag || pe.button !== 0 || pe.isPrimary === false) return;
      const target = e.target as Element;
      if (target.closest('.aekList__action, .aekList__search')) return;
      const isHandle = Boolean(target.closest('.aekList__handle'));
      // On a touch screen a drag on the row scrolls: only the handle moves it
      if (pe.pointerType === 'touch' && !isHandle) return;
      const key = host.keyAt(target);
      const row = key ? host.getRendered().find((r) => r.key === key) : null;
      if (!key || !row || !host.canMove(key)) return;
      lastY = pe.clientY;
      drag = {
        pointerId: pe.pointerId,
        key,
        elem: row.elem,
        startY: pe.clientY,
        startScroll: box.scrollTop || 0,
        isStarted: false,
        isLifted: false,
        boxRect: null,
        before: null,
        after: null,
      };
    };

    const onPointerMove = (e: Event) => {
      const pe = e as PointerEvent;
      if (!drag || pe.pointerId !== drag.pointerId) return;
      lastY = pe.clientY;
      if (!drag.isStarted) {
        if (Math.abs(pe.clientY - drag.startY) < DRAG_THRESHOLD) return;
        start(drag);
      }
      pe.preventDefault();
      follow();
      if (!frame) frame = requestAnimationFrame(edgeScroll);
    };

    const onPointerUp = (e: Event) => {
      const pe = e as PointerEvent;
      if (!drag || pe.pointerId !== drag.pointerId) return;
      const current = drag;
      if (!current.isStarted) {
        clear();
        return;
      }
      lastY = pe.clientY;
      findDrop(lastY);
      const from = host.getKeys().indexOf(current.key);
      const to = getDropIndex(current);
      clear();
      // The click the release makes isn't the row's
      isClickStopped = true;
      if (clickTimer) clearTimeout(clickTimer);
      clickTimer = setTimeout(() => {
        clickTimer = null;
        isClickStopped = false;
      }, 0);
      commit(current.key, from, to);
    };

    const onCancel = (e: Event) => {
      if (drag && (e as PointerEvent).pointerId === drag.pointerId) clear();
    };

    const onClickCapture = (e: Event) => {
      if (!isClickStopped) return;
      isClickStopped = false;
      e.stopPropagation();
      e.preventDefault();
    };

    const listeners: [EventTarget, string, (e: Event) => void, boolean][] = [
      [box, 'pointerdown', onPointerDown, false],
      [box, 'pointermove', onPointerMove, false],
      [box, 'pointerup', onPointerUp, false],
      [box, 'pointercancel', onCancel, false],
      [box, 'lostpointercapture', onCancel, false],
      [root, 'click', onClickCapture, true],
    ];
    for (const [target, type, fn, capture] of listeners) {
      target.addEventListener(type, fn, capture);
    }

    return {
      onKeyDown,
      dispose: () => {
        clear();
        if (clickTimer) clearTimeout(clickTimer);
        clickTimer = null;
        isClickStopped = false;
        for (const [target, type, fn, capture] of listeners) {
          target.removeEventListener(type, fn, capture);
        }
      },
    };
  };

  impls.set(handle, { attach });
  return handle;
};
