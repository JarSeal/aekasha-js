import { getHUDRootCMP } from 'aekasha/ui';
import type { CMPHandle } from 'aekasha/ui';
import { registerOnAllSceneExits } from 'aekasha';

// The example scenes' HUD panel: one box of text at the bottom of the screen, removed when its
// scene exits (the exit hooks run before the next scene's file, so a new panel is never removed)

let panel: CMPHandle | null = null;

const removePanel = () => {
  panel?.remove();
  panel = null;
};

/**
 * Shows the example's HUD panel (one per scene)
 * @param text its text, lines separated by `\n`
 * @returns the panel, to update with `panel.updateText(text)`
 */
export const createExampleHud = (text: string) => {
  // Registered by id, so once however many scenes show a panel
  registerOnAllSceneExits('exampleHud', removePanel);
  panel?.remove();
  panel = getHUDRootCMP().add({
    text,
    style: {
      // #hudRoot is a 0 × 0 box: the panel is placed against the viewport
      position: 'fixed',
      bottom: '72px',
      left: '50%',
      transform: 'translateX(-50%)',
      padding: '6px 12px',
      borderRadius: '6px',
      background: 'rgba(0, 0, 0, 0.5)',
      color: '#fff',
      font: '14px/1.5 sans-serif',
      textAlign: 'center',
      whiteSpace: 'pre',
      pointerEvents: 'none',
    },
  });
  return panel;
};
