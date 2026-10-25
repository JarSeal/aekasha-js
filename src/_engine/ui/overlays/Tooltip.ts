import type { CMPAttr, CMPHandle } from '../core/CMPTypes';
import { CMP, classes } from '../core/CMP';
import { getHUDRootCMP, hasHudRoot, KIT_ROOT_CLASS } from '../core/HUD';
import { showAnchored } from './Anchor';
import { pushOverlay } from './OverlayStack';
import './Tooltip.scss';
import '../styles/kit.scss';

/** What {@link createTooltip} makes a tooltip from. */
export type TooltipProps = {
  /** The element it describes: its `aria-describedby` gets the tooltip's id. */
  anchor: HTMLElement;
  /** The tooltip's text (text, not HTML). */
  text: string;
  /** The side of the anchor it shows on when it fits there, else the opposite one. Default 'top'. */
  side?: 'top' | 'bottom' | 'left' | 'right';
  /** Extra classes for the tooltip's element. */
  class?: string | string[];
  /** Extra attributes for the tooltip's element. */
  attr?: CMPAttr;
  /** The tooltip's element id (default: a generated one). */
  id?: string;
};

/** A tooltip {@link createTooltip} made: its CMP and its controls. */
export type Tooltip = {
  /** The tooltip's element, in the HUD root only while it shows. `cmp.remove()` disposes the
   * tooltip: its listeners on the anchor, its timers and its `aria-describedby` go. */
  cmp: CMPHandle;
  /** Shows it now (no delay). */
  show: () => void;
  /** Hides it. */
  hide: () => void;
  /** Whether it shows */
  isShown: () => boolean;
  /** Changes its text in place. */
  setText: (text: string) => void;
};

/** The delay's fallback when the token can't be read */
const DEFAULT_DELAY_MS = 500;
/** How long a pointer leaving the anchor may take to reach the tooltip (WCAG 1.4.13: the
 * tooltip can be hovered) */
const LEAVE_GRACE_MS = 100;

/** `--aek-tooltip-delay` on the anchor (`500ms`, `0.5s`), in ms */
const readDelayMs = (anchor: HTMLElement) => {
  if (typeof getComputedStyle !== 'function') return DEFAULT_DELAY_MS;
  const value = getComputedStyle(anchor).getPropertyValue('--aek-tooltip-delay').trim();
  const match = value.match(/^([\d.]+)(ms|s)$/);
  if (!match) return DEFAULT_DELAY_MS;
  return Number(match[1]) * (match[2] === 's' ? 1000 : 1);
};

/** Whether the anchor's focus came from the keyboard (a click's focus shows no tooltip) */
const isFocusVisible = (elem: HTMLElement) => {
  try {
    return elem.matches(':focus-visible');
  } catch {
    return true; // A DOM without the selector (linkedom)
  }
};

/**
 * Creates a tooltip (p803 D10): a short text describing `anchor`, shown on its `side` after
 * `--aek-tooltip-delay` (500 ms) of hover and at once on keyboard focus, and hidden when the
 * pointer leaves (it can move onto the tooltip), on blur, on a press of the anchor and on Escape.
 * Never interactive: content with a control in it is a popover.
 * - Parts: the `.aekTooltip` element (`role="tooltip"`), in the HUD root while it shows, in the
 *   browser's top layer (else at `--aek-z-tooltip`), placed by the anchor and kept inside the HUD.
 * - ARIA: the anchor's `aria-describedby` names it (added to any ids there).
 * - Keys: Escape hides it (the kit's overlay stack: the press goes no further), wherever the focus
 *   is in the HUD.
 * - Custom properties: `--aek-tooltip-delay` (on the anchor or any ancestor).
 *
 * The tooltip isn't added anywhere: dispose of it with `cmp.remove()` when its anchor goes.
 * @example
 * ```ts
 * const saveButton = panel.add({ tag: 'button', text: 'Save' });
 * createTooltip({ anchor: saveButton.elem, text: 'Saves the scene (Ctrl+S)' });
 * ```
 */
export const createTooltip = (props: TooltipProps): Tooltip => {
  const { anchor, side = 'top' } = props;
  let isShown = false;
  let showTimer: ReturnType<typeof setTimeout> | null = null;
  let hideTimer: ReturnType<typeof setTimeout> | null = null;
  let hideAnchored: (() => void) | null = null;
  let removeOverlay: ((returnFocus?: boolean) => void) | null = null;

  const clearTimers = () => {
    if (showTimer) clearTimeout(showTimer);
    if (hideTimer) clearTimeout(hideTimer);
    showTimer = null;
    hideTimer = null;
  };

  const show = () => {
    clearTimers();
    if (isShown || !anchor.isConnected) return;
    isShown = true;
    // In the HUD root, never in the anchor (its text would join the anchor's name)
    const parent = hasHudRoot()
      ? getHUDRootCMP().elem
      : anchor.closest(`.${KIT_ROOT_CLASS}`) ?? document.body;
    parent.appendChild(cmp.elem);
    hideAnchored = showAnchored({ elem: cmp.elem, anchor, side, onAnchorRemoved: hide });
    removeOverlay = pushOverlay({ elem: cmp.elem, close: hide, returnFocus: null });
  };

  function hide() {
    clearTimers();
    if (!isShown) return;
    isShown = false;
    removeOverlay?.(false);
    removeOverlay = null;
    hideAnchored?.();
    hideAnchored = null;
    cmp.elem.remove();
  }

  const scheduleShow = () => {
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = null;
    if (isShown || showTimer) return;
    showTimer = setTimeout(show, readDelayMs(anchor));
  };

  const scheduleHide = (e: PointerEvent) => {
    // Onto the tooltip or back onto the anchor: it stays
    const to = e.relatedTarget as Node | null;
    if (to && (cmp.elem.contains(to) || anchor.contains(to))) return;
    if (showTimer) clearTimeout(showTimer);
    showTimer = null;
    if (isShown && !hideTimer) hideTimer = setTimeout(hide, LEAVE_GRACE_MS);
  };

  const onFocus = () => {
    if (isFocusVisible(anchor)) show();
  };

  // Outside the HUD root the stack doesn't see the key: the anchor's own Escape
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || !isShown) return;
    e.preventDefault();
    e.stopPropagation();
    hide();
  };

  const anchorListeners: [string, EventListener][] = [
    ['pointerenter', scheduleShow],
    ['pointerleave', scheduleHide as EventListener],
    ['pointerdown', hide],
    ['focus', onFocus],
    ['blur', hide],
    ['keydown', onKeyDown as EventListener],
  ];

  const cmp: CMPHandle = CMP({
    id: props.id,
    idAttr: true,
    class: classes('aekTooltip', props.class),
    text: props.text,
    attr: { ...props.attr, role: 'tooltip' },
    listeners: [
      { type: 'pointerenter', fn: scheduleShow },
      { type: 'pointerleave', fn: (e) => scheduleHide(e as PointerEvent) },
    ],
    onRemoveCmp: () => {
      hide();
      for (const [type, fn] of anchorListeners) anchor.removeEventListener(type, fn);
      const ids = (anchor.getAttribute('aria-describedby') ?? '')
        .split(/\s+/)
        .filter((id) => id && id !== cmp.id);
      if (ids.length) anchor.setAttribute('aria-describedby', ids.join(' '));
      else anchor.removeAttribute('aria-describedby');
    },
  });

  for (const [type, fn] of anchorListeners) anchor.addEventListener(type, fn);
  const describedBy = anchor.getAttribute('aria-describedby');
  anchor.setAttribute('aria-describedby', describedBy ? `${describedBy} ${cmp.id}` : cmp.id);

  return {
    cmp,
    show,
    hide,
    isShown: () => isShown,
    setText: (text) => cmp.updateText(text),
  };
};
