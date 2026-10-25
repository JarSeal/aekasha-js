import type { OpenDraggableWindowProps } from './DraggableWindowTypes';
import {
  closeDraggableWindow,
  getDraggableWindow,
  onDraggableWindowUnmount,
  openDraggableWindow,
} from './DraggableWindow';
import { pushOverlay } from '../OverlayStack';

/** A dialog's props: a draggable window's, without the ones a dialog fixes (its place, and no
 * drag, resize or collapse), plus `closeOnEscape`. */
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
};

/** Each open dialog's overlay stack entry (its remover) and what had the focus before it opened */
const dialogOverlays = new Map<
  string,
  { removeOverlay: (returnFocus?: boolean) => void; opener: HTMLElement | null }
>();

/**
 * Opens a modal dialog: a draggable window centred on the screen over a backdrop, that doesn't
 * move, resize or collapse, 600 × 600 px unless `size` says otherwise (at least 320 px, at most
 * 90 % of the screen). Every open resets its place and size. It closes like any window (its close
 * button, `closeDraggableWindow(id)`, or `backDropClickClosesWindow`), and with Escape when
 * `closeOnEscape` is set. It takes the focus when it opens and gives it back to what had it when it
 * closes. A dialog is on the kit's overlay stack: Escape pressed inside the HUD goes to the top
 * overlay alone (a drop-down's list open in the dialog closes first), and a key pressed outside
 * the HUD (an embed's host page) is the page's.
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
export const openDialog = ({ closeOnEscape, ...props }: DialogProps) => {
  const { id } = props;
  // A reopen keeps its first opener and goes on top of the stack
  const previous = dialogOverlays.get(id);
  dialogOverlays.delete(id);
  previous?.removeOverlay(false);
  const opener = previous ? previous.opener : (document.activeElement as HTMLElement | null);

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
  const elem = getDraggableWindow(id)?.windowCMP?.elem;
  if (!elem) return;
  const removeOverlay = pushOverlay({
    elem,
    close: closeOnEscape ? () => closeDraggableWindow(id) : undefined,
    returnFocus: opener,
  });
  const overlay = { removeOverlay, opener };
  dialogOverlays.set(id, overlay);
  // However it closes (also a scene load's teardown): the focus goes back to the opener
  onDraggableWindowUnmount(id, () => {
    if (dialogOverlays.get(id) !== overlay) return;
    dialogOverlays.delete(id);
    removeOverlay();
  });
};
