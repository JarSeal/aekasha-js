import type { OpenDraggableWindowProps } from './DraggableWindowTypes';
import {
  closeDraggableWindow,
  getDraggableWindow,
  onDraggableWindowUnmount,
  openDraggableWindow,
  setDraggableWindowModal,
} from './DraggableWindow';
import { trapFocus } from '../FocusTrap';
import { pushOverlay } from '../OverlayStack';

/** A dialog's props: a draggable window's, without the ones a dialog fixes (its place, and no
 * drag, resize or collapse), plus `closeOnEscape`, `alert` and `initialFocus`. */
export type DialogProps = Omit<
  OpenDraggableWindowProps,
  | 'isCollapsed'
  | 'position'
  | 'resetPosition'
  | 'resetSize'
  | 'disableVertResize'
  | 'disableHoriResize'
  | 'disableDragging'
  | 'disableCollapseBtn'
> & {
  /** Closes the dialog with the Escape key pressed inside the HUD (default false). The dialog
   * takes the focus when it opens. Without it, Escape inside the HUD does nothing while the
   * dialog is on top. Either way no key binding (app or engine) or other Escape listener gets
   * that press. */
  closeOnEscape?: boolean;
  /** An alert dialog (`role="alertdialog"`): it interrupts with something that needs an answer,
   * a confirmation of a destructive action. Default false (`role="dialog"`). */
  alert?: boolean;
  /** A selector of the element in the dialog that takes the focus when it opens (an alert's
   * safe choice, "Cancel"). Default: its first focusable element, its content's first. */
  initialFocus?: string;
};

/** Each open dialog's overlay stack entry and focus trap (their removers), and what had the
 * focus before it opened */
const dialogOverlays = new Map<
  string,
  {
    removeOverlay: (returnFocus?: boolean) => void;
    removeTrap: () => void;
    opener: HTMLElement | null;
  }
>();

/**
 * Opens a modal dialog (p803 D7): a draggable window centred on the screen over a backdrop, that
 * doesn't move, resize or collapse, 600 × 600 px unless `size` says otherwise (at least 320 px,
 * at most 90 % of the screen). Every open resets its place and size. It closes like any window
 * (its close button, `closeDraggableWindow(id)`, or `backDropClickClosesWindow`), and with Escape
 * when `closeOnEscape` is set.
 * - ARIA: `role="dialog"` (`"alertdialog"` with `alert`), `aria-modal="true"`, named by its title
 *   (or `ariaLabel`).
 * - Focus: it takes the focus when it opens (`initialFocus`, else its first focusable element),
 *   Tab and Shift+Tab wrap inside it, and its close gives the focus back to what had it.
 * - While it's open the rest of the HUD is `inert` (never anything outside the HUD root): the
 *   app's windows, toasts and other dialogs; an app's dialog leaves the debugger's roots live, so
 *   a pause menu can still be debugged.
 * - Keys: Escape pressed inside the HUD goes to the top overlay alone (a drop-down's list open in
 *   the dialog closes first), and a key pressed outside the HUD (an embed's host page) is the
 *   page's.
 * - Layers: an app's dialogs stack from `--aek-z-dialog`, above its windows and below the
 *   debugger; a debug dialog (`isDebugWindow`) from `--aek-z-debug-dialog`.
 * @example
 * ```ts
 * openDialog({
 *   id: 'pauseMenu',
 *   title: 'Paused',
 *   content: () => createPauseMenu(),
 *   size: { w: 400, h: 300 },
 *   closeOnEscape: true,
 * });
 * ```
 */
export const openDialog = ({ closeOnEscape, alert, initialFocus, ...props }: DialogProps) => {
  const { id } = props;
  // A reopen keeps its first opener and goes on top of the stack
  const previous = dialogOverlays.get(id);
  dialogOverlays.delete(id);
  previous?.removeTrap();
  previous?.removeOverlay(false);
  const opener = previous ? previous.opener : (document.activeElement as HTMLElement | null);

  setDraggableWindowModal(id);
  openDraggableWindow({
    maxSize: { w: 90, h: 90 },
    minSize: { w: 320, h: 320 },
    size: { w: 600, h: 600 },
    ...props,
    units: {
      maxSize: { w: '%', h: '%' },
      minSize: { w: 'px', h: 'px' },
      size: { w: 'px', h: 'px' },
      ...props.units,
      position: { x: '%', y: '%' },
    },
    position: { x: 50, y: 50 },
    resetPosition: true,
    resetSize: true,
    disableVertResize: true,
    disableHoriResize: true,
    disableDragging: true,
    disableCollapseBtn: true,
    hasBackDrop: true,
  });

  // Not opened: a debug dialog outside the debug env
  const win = getDraggableWindow(id);
  const elem = win?.windowCMP?.elem;
  if (!win || !elem) return;
  elem.setAttribute('role', alert ? 'alertdialog' : 'dialog');
  elem.setAttribute('aria-modal', 'true');
  if (initialFocus && props.focusFirstElement !== false) {
    elem.querySelector<HTMLElement>(initialFocus)?.focus({ preventScroll: true });
  }
  const removeTrap = trapFocus(elem);
  const removeOverlay = pushOverlay({
    elem,
    close: closeOnEscape ? () => closeDraggableWindow(id) : undefined,
    returnFocus: opener,
    inert: true,
    keep: win.backDropCMP ? [win.backDropCMP.elem] : undefined,
    isDebug: win.isDebugWindow,
  });
  const overlay = { removeOverlay, removeTrap, opener };
  dialogOverlays.set(id, overlay);
  // However it closes (also a scene load's teardown): the rest of the HUD is live again and the
  // focus goes back to the opener
  onDraggableWindowUnmount(id, () => {
    if (dialogOverlays.get(id) !== overlay) return;
    dialogOverlays.delete(id);
    removeTrap();
    removeOverlay();
  });
};
