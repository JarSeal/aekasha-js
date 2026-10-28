import { createActionMap, isActionContextEnabled, setActionContextEnabled } from 'aekasha';
import { createCommandPalette } from 'aekasha/ui';
import type { PaletteCommand } from 'aekasha/ui';

/**
 * The UI kit example's command palette (p805 D15): the kit's palette, opened by Ctrl / ⌘ + K
 * through an action map in a context of its own, with the scene's commands made on each open.
 */

const SHORTCUTS_CONTEXT = 'SHORTCUTS';

/** The recent commands: kept across visits, in memory (storing them is the app's) */
let recentCommands: string[] = [];

// #region ui-kit-palette (shown in the Hub: hub/pages/examples/ui-kit/)
/**
 * Makes the scene's palette and binds its key. The gameplay's keys are off while it's open (an
 * action map takes the keys typed into its field) and back as they were when it closes: the
 * pause menu may have them off.
 * @param sceneId the scene: the key's map is its, inactive in any other
 * @param getCommands the commands, made on each open (a renamed shape's new name)
 * @returns the palette's opener and its remover, for the scene's exit
 */
export const createScenePalette = (sceneId: string, getCommands: () => PaletteCommand[]) => {
  let wasGameplayOn = true;
  const palette = createCommandPalette({
    label: 'Commands',
    placeholder: 'Type a command or an object’s name',
    recent: recentCommands,
    onRecentChange: (ids) => {
      recentCommands = ids;
    },
    onOpen: () => {
      wasGameplayOn = isActionContextEnabled('GAMEPLAY');
      setActionContextEnabled('GAMEPLAY', false);
    },
    onClose: () => setActionContextEnabled('GAMEPLAY', wasGameplayOn),
  });
  const open = () => {
    palette.setCommands(getCommands());
    palette.open();
  };

  // A context of its own: on while the gameplay's and the menu's are off
  const shortcuts = createActionMap({
    id: `${sceneId}:shortcuts`,
    sceneId,
    context: SHORTCUTS_CONTEXT,
    actions: { palette: { type: 'BUTTON', name: 'Command palette' } },
    bindings: {
      palette: [
        {
          device: 'KEYBOARD',
          keys: [
            { key: 'k', ctrl: true },
            { key: 'k', meta: true },
          ],
        },
      ],
    },
  });
  shortcuts.onPressed('palette', open);

  return { open, remove: () => palette.cmp.remove() };
};
// #endregion ui-kit-palette
