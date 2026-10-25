import { createMeshEntity, registerOnSceneExit } from 'aekasha';
import {
  addToast,
  CMP,
  createButton,
  createDropDown,
  createToaster,
  createTooltip,
  getHUDRootCMP,
  openDialog,
  openDraggableWindow,
  removeToaster,
} from 'aekasha/ui';
import type { Tooltip } from 'aekasha/ui';
// The kit's fonts (p801 D8), with the kit in this scene's lazy chunk: `yarn verify:embed` checks
// the window's and the toast's font is IBM Plex Sans
import 'aekasha/ui/fonts';

// The ids and classes `yarn verify:embed` finds the kit's elements by (devTools/verify/embed.ts'
// UI_KIT_ELEMENTS): change them there too
const SCENE_ID = 'uiKitEmbed';
const WINDOW_ID = 'uiKitEmbedWindow';
const DIALOG_ID = 'uiKitEmbedDialog';
const TOASTER_ID = 'uiKitEmbedToasts';
const BACKDROP_CLASS = 'uiKitEmbedBackdrop';
const LIST_CLASS = 'uiKitEmbedList';
const TOOLTIP_CLASS = 'uiKitEmbedTooltip';

const SHADES = [
  { value: 'dawn', label: 'Dawn' },
  { value: 'noon', label: 'Noon' },
  { value: 'dusk', label: 'Dusk' },
];

/** The kit's content padding, from the design tokens (`ui/styles/tokens.css`) */
const PANEL_STYLE = {
  padding: 'var(--aek-space-3) var(--aek-space-4)',
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--aek-space-3)',
};

/**
 * The uiKit embed's scene (p801 D9): a box made in code, and one of each of the UI kit's pieces
 * open over it: a window with a button and its tooltip shown, a toast, and a dialog with its
 * drop-down's list open. Mounted into a
 * page it doesn't own (`uiKit.embed.ts`), they size from the browser's font size, not the host's
 * root, and stay inside the mount's container; `yarn verify:embed` checks both.
 */
export const scene = async () => {
  createMeshEntity({
    geo: { id: 'uiKitEmbedBox', type: 'BOX', params: { width: 1.2, height: 1.2, depth: 1.2 } },
    mat: { id: 'uiKitEmbedBox', type: 'STANDARD', params: { color: '#3fa7a0' } },
    rotation: { x: 0.5, y: 0.7, z: 0 },
  });

  // A window at a px position: from the container's top left corner in an embed, with a button
  // whose tooltip shows (before the dialog opens, which stays above it on the overlay stack)
  const hint: { tooltip: Tooltip | null } = { tooltip: null };
  openDraggableWindow({
    id: WINDOW_ID,
    title: 'Window',
    content: () => {
      const panel = CMP({ style: PANEL_STYLE, onRemoveCmp: () => hint.tooltip?.cmp.remove() });
      panel.add({ text: 'Drag me by the header: I stay inside the container.' });
      // The kit's button (p803 D10): with the window, the dialog and the toast, what the SBP
      // report's "what does a HUD cost" is of (p800 D10)
      const button = createButton({ label: 'Hint', size: 'sm' });
      panel.add(button.cmp);
      hint.tooltip = createTooltip({
        anchor: button.cmp.elem,
        text: 'A tooltip',
        class: TOOLTIP_CLASS,
      });
      return panel;
    },
    position: { x: 16, y: 16 },
    size: { w: 220, h: 170 },
    // The focus would show the tooltip, and the dialog's taking it (a blur) hide it again
    focusFirstElement: false,
    closeOnSceneChange: true,
  });
  hint.tooltip?.show();

  getHUDRootCMP().add(
    createToaster({
      id: TOASTER_ID,
      settings: {
        verticalPosition: 'top',
        horizontalPosition: 'right',
        toastDirection: 'down',
        toastAppearFromDirection: 'right',
        offset: { x: '-16px', y: '16px' },
      },
    })
  );
  // Until it's closed: the check measures it
  addToast({ message: 'A toast', toasterId: TOASTER_ID, showingTime: 0 });

  // The drop-down is in the dialog: opening a window focuses its first element, which would
  // close a list open elsewhere (its focusout)
  const dropDown = createDropDown({
    options: SHADES,
    value: () => SHADES[0].value,
    onChange: () => {},
    title: 'Shade',
    listClass: LIST_CLASS,
  });
  openDialog({
    id: DIALOG_ID,
    title: 'Dialog',
    content: () => {
      const panel = CMP({ style: PANEL_STYLE });
      panel.add({ text: 'Centred in the container, over a backdrop that covers only it.' });
      panel.add(dropDown.cmp);
      return panel;
    },
    // Shorter than the open list reaches: the list is in the top layer, which no window clips
    // (p803 D7), and `yarn verify:embed` checks its last option shows
    size: { w: 300, h: 180 },
    minSize: { w: 240, h: 160 },
    backDropClass: BACKDROP_CLASS,
    // `yarn verify:embed` checks Escape: the host page's leaves it open, its own closes it
    closeOnEscape: true,
    removeOnSceneChange: true,
  });
  dropDown.open();

  registerOnSceneExit(SCENE_ID, () => removeToaster(TOASTER_ID));
};
