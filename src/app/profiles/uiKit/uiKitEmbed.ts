import { createMeshEntity, getCurrentSceneId, registerOnSceneExit } from 'aekasha';
import {
  addToast,
  CMP,
  createButton,
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
const TOOLTIP_CLASS = 'uiKitEmbedTooltip';
const OPEN_DIALOG_CLASS = 'uiKitEmbedOpenDialog';

const BOX_MATERIAL_ID = 'uiKitEmbedBox';
const RAD_TO_DEG = 180 / Math.PI;

// The scene's state, set again on every visit: the box's entity and its turn and tilt in degrees,
// which the dialog's form shows and writes
let boxId = -1;
const boxPose = { turn: 0, tilt: 0 };
/** The window's button's tooltip, shown at load until the dialog opens */
const hint: { tooltip: Tooltip | null } = { tooltip: null };

/** The kit's content padding, from the design tokens (`ui/styles/tokens.css`) */
const PANEL_STYLE = {
  padding: 'var(--aek-space-3) var(--aek-space-4)',
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--aek-space-3)',
};

/**
 * The uiKit embed's scene (p801 D9): a box made in code, and the UI kit's pieces over it: a
 * window with a button and its tooltip shown, a toast, and a dialog with a small form bound to the
 * box (p804 D12), which the window's second button opens (p803 Phase 8: opened at load, the dialog
 * took the focus of a page the embed mounts into as it scrolled in, the Hub's UI kit page).
 * Mounted into a page it doesn't own (`uiKit.embed.ts`), they size from the browser's font size,
 * not the host's root, and stay inside the mount's container; `yarn verify:embed` checks both,
 * after clicking the button and the form's select.
 */
export const scene = async () => {
  const rotation = { x: 0.5, y: 0.7, z: 0 };
  boxId = createMeshEntity({
    geo: { id: 'uiKitEmbedBox', type: 'BOX', params: { width: 1.2, height: 1.2, depth: 1.2 } },
    mat: { id: BOX_MATERIAL_ID, type: 'STANDARD', params: { color: '#3fa7a0' } },
    rotation,
  });
  boxPose.turn = rotation.y * RAD_TO_DEG;
  boxPose.tilt = rotation.x * RAD_TO_DEG;

  // A window at a px position: from the container's top left corner in an embed, with a button
  // whose tooltip shows until the dialog opens (the dialog makes the window inert, and covers
  // the tooltip's place)
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
        // Beside the button: above it, it would cover the window's text
        side: 'right',
        class: TOOLTIP_CLASS,
      });
      panel.add(
        createButton({
          label: 'Open the dialog',
          size: 'sm',
          variant: 'primary',
          class: OPEN_DIALOG_CLASS,
          onClick: () => void openBoxDialog(),
        }).cmp
      );
      return panel;
    },
    position: { x: 16, y: 16 },
    size: { w: 220, h: 190 },
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

  registerOnSceneExit(SCENE_ID, () => removeToaster(TOASTER_ID));
};

/**
 * The dialog with its form, from the window's button: it takes the focus as it opens. The form is
 * a module of its own, imported on the first open (a lazy chunk in a build: `sbp.config.ts`
 * budgets it apart from the HUD's), so the dialog opens once it's loaded, if the scene is still
 * this one.
 */
const openBoxDialog = async () => {
  const { createBoxForm } = await import('./uiKitEmbedForm');
  if (getCurrentSceneId() !== SCENE_ID) return;
  hint.tooltip?.hide();
  openDialog({
    id: DIALOG_ID,
    title: 'The box',
    content: () => {
      const panel = CMP({ style: PANEL_STYLE });
      panel.add({ text: 'Centred in the container, over a backdrop that covers only it.' });
      panel.add(createBoxForm(boxId, BOX_MATERIAL_ID, boxPose).cmp);
      return panel;
    },
    // The shades' list opens in the top layer, which no window clips (p803 D7): `yarn
    // verify:embed` checks its last option shows
    size: { w: 340, h: 320 },
    minSize: { w: 280, h: 240 },
    backDropClass: BACKDROP_CLASS,
    // `yarn verify:embed` checks Escape: the host page's leaves it open, its own closes it
    closeOnEscape: true,
    removeOnSceneChange: true,
  });
};
