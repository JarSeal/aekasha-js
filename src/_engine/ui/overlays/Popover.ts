import type { CMPAttr, CMPHandle } from '../core/CMPTypes';
import { CMP, classes } from '../core/CMP';
import { getHUDRootCMP, hasHudRoot, KIT_ROOT_CLASS } from '../core/HUD';
import { showAnchored } from './Anchor';
import { getFirstFocusable } from './FocusTrap';
import { pushOverlay } from './OverlayStack';
import './Popover.scss';
import '../styles/kit.scss';

/** What {@link createPopover} makes a popover from. */
export type PopoverProps = {
  /** Its trigger: a click (Enter, Space) on it opens and closes the popover. */
  anchor: HTMLElement;
  /** What it shows: a CMP added once, or a function that builds it on every open (removed with
   * its close). */
  content: CMPHandle | (() => CMPHandle);
  /** The popover's accessible name (its `aria-label`). */
  label?: string;
  /** The side of the anchor it opens on when it fits there, else the opposite one. Default
   * 'bottom'. */
  side?: 'top' | 'bottom' | 'left' | 'right';
  /** Where along the side it lines up with the anchor. Default 'start'. */
  align?: 'start' | 'center' | 'end';
  /** Runs when it opens */
  onOpen?: () => void;
  /** Runs when it closes, however it closes */
  onClose?: () => void;
  /** Extra classes for the popover's element. */
  class?: string | string[];
  /** Extra attributes for the popover's element. */
  attr?: CMPAttr;
  /** The popover's element id (default: a generated one). */
  id?: string;
};

/** A popover {@link createPopover} made: its CMP and its controls. */
export type Popover = {
  /** The popover's element, in the HUD root only while it's open. `cmp.remove()` disposes the
   * popover: its listeners on the trigger and the page and its ARIA on the trigger go. */
  cmp: CMPHandle;
  /** Opens it and moves the focus in. */
  open: () => void;
  /** Closes it, giving the focus back to the trigger when it was in the popover. */
  close: () => void;
  /** Opens it, or closes it when it's open. */
  toggle: () => void;
  /** Whether it's open */
  isOpen: () => boolean;
};

/**
 * Creates a popover (p803 D10): interactive content anchored to its trigger, opened and closed by
 * a click on it (Enter or Space on a button), on its `side` when it fits there, else the other.
 * - Parts: the `.aekPopover` element (`role="dialog"`, not modal), in the HUD root while it's
 *   open, in the browser's top layer (else at `--aek-z-tooltip`), kept inside the HUD with the
 *   space left as its max size.
 * - ARIA: the trigger gets `aria-haspopup="dialog"`, `aria-expanded` and `aria-controls`.
 * - Keys and focus: opening moves the focus to its first focusable element (else the popover
 *   itself); Escape (the kit's overlay stack: the press goes no further) closes it and gives the
 *   focus back to the trigger; a press outside it and its trigger, or the focus leaving both,
 *   closes it and leaves the focus where it went.
 *
 * The popover isn't added anywhere: dispose of it with `cmp.remove()` when its trigger goes.
 * @example
 * ```ts
 * const filtersButton = toolbarPanel.add({ tag: 'button', text: 'Filters' });
 * createPopover({
 *   anchor: filtersButton.elem,
 *   label: 'Filters',
 *   content: () => createFiltersPanel(),
 * });
 * ```
 */
export const createPopover = (props: PopoverProps): Popover => {
  const { anchor, side = 'bottom', align = 'start' } = props;
  let isOpen = false;
  let hideAnchored: (() => void) | null = null;
  let removeOverlay: ((returnFocus?: boolean) => void) | null = null;

  /** Closes it; `returnFocus` false when the focus went elsewhere (an outside press) */
  const close = (returnFocus = true) => {
    if (!isOpen) return;
    isOpen = false;
    document.removeEventListener('pointerdown', onOutsidePress, true);
    removeOverlay?.(returnFocus);
    removeOverlay = null;
    hideAnchored?.();
    hideAnchored = null;
    anchor.setAttribute('aria-expanded', 'false');
    if (typeof props.content === 'function') cmp.removeChildren();
    cmp.elem.remove();
    props.onClose?.();
  };

  /** In the capture phase on the document: a press anywhere but the popover and its trigger
   * (whose own click toggles it) */
  function onOutsidePress(e: Event) {
    const target = e.target as Node | null;
    if (target && (cmp.elem.contains(target) || anchor.contains(target))) return;
    close(false);
  }

  const open = () => {
    if (isOpen || !anchor.isConnected) return;
    isOpen = true;
    if (typeof props.content === 'function') cmp.add(props.content());
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
      onAnchorRemoved: () => close(false),
    });
    // The trigger, also where a click doesn't focus a button (Safari)
    removeOverlay = pushOverlay({ elem: cmp.elem, close: () => close(), returnFocus: anchor });
    document.addEventListener('pointerdown', onOutsidePress, true);
    (getFirstFocusable(cmp.elem) ?? cmp.elem).focus({ preventScroll: true });
    props.onOpen?.();
  };

  const toggle = () => (isOpen ? close() : open());

  const onAnchorClick = () => toggle();

  const cmp: CMPHandle = CMP({
    id: props.id,
    idAttr: true,
    class: classes('aekPopover', props.class),
    attr: {
      ...props.attr,
      role: 'dialog',
      tabindex: '-1',
      ...(props.label ? { 'aria-label': props.label } : {}),
    },
    listeners: [
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
      anchor.removeAttribute('aria-haspopup');
      anchor.removeAttribute('aria-expanded');
      anchor.removeAttribute('aria-controls');
    },
  });
  if (typeof props.content !== 'function') cmp.add(props.content);

  anchor.addEventListener('click', onAnchorClick);
  anchor.setAttribute('aria-haspopup', 'dialog');
  anchor.setAttribute('aria-expanded', 'false');
  anchor.setAttribute('aria-controls', cmp.id);

  return { cmp, open, close: () => close(), toggle, isOpen: () => isOpen };
};
