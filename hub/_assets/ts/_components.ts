/**
 * The component library (p802 D9, the dev page `project/aekasha/components/`): a chunk `hub.ts`
 * imports on a page with `[data-hub-components]`, only in the dev Hub. It uses `aekasha/ui`
 * without the engine: the Hub's script build resolves the kit's main loop and storage to its own
 * stand-ins (`_kit/`, `devTools/hub/kitStandIns.ts`), and this makes the HUD root the boot would.
 *
 * The root sits over the viewport, as in an app: each `[data-hub-demo]` box gets buttons that
 * open its piece's states there, and the page's theme and density switches set its attributes.
 */
import { CMP, getHUDRootCMP, openDraggableWindow, registerBuiltInIcons } from 'aekasha/ui';
// eslint-disable-next-line import/no-restricted-paths -- the kit has no public way to make its root without the boot: p803 adds one (p800 D1), and this import goes
import { createHudContainer } from '../../../src/_engine/ui/HUD';

/** A demo: fills its box (`data-hub-demo="<key>"`) with the controls that open its states */
type Demo = (box: HTMLElement) => void;

/** The demo windows' ids start with it, so a demo never takes an id the kit uses */
const ID_PREFIX = 'hubDemo';

/** A Hub button in a demo box (the controls are the page's; what they open is the kit's) */
const addButton = (box: HTMLElement, label: string, onClick: () => void) => {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'hubButton';
  button.textContent = label;
  button.addEventListener('click', onClick);
  box.append(button);
  return button;
};

const DEMOS: Record<string, Demo> = {
  window: (box) => {
    addButton(box, 'Open a window', () =>
      openDraggableWindow({
        id: `${ID_PREFIX}Window`,
        title: 'A window',
        content: () => CMP({ tag: 'p', text: 'Its content.' }),
      })
    );
  },
};

/** The page's switches: each radio group sets (or, for '', removes) its attribute on the root */
const SETTING_ATTRIBUTES: Record<string, string> = {
  theme: 'data-aek-theme',
  density: 'data-aek-density',
};

const initSettings = (root: HTMLElement, hud: HTMLElement) => {
  root.querySelector('[data-hub-component-settings]')?.addEventListener('change', (e) => {
    const input = e.target as HTMLInputElement;
    const attribute = SETTING_ATTRIBUTES[input.name];
    if (!attribute) return;
    if (input.value) hud.setAttribute(attribute, input.value);
    else hud.removeAttribute(attribute);
  });
};

/**
 * Makes the HUD root and mounts each demo into its box
 * @param root the page's `[data-hub-components]` element
 */
export const initComponents = (root: HTMLElement) => {
  // The windows' close and collapse buttons are icons; the boot registers them in the debug env
  registerBuiltInIcons();
  // The root takes the place of its slot (as of the page's `#hudRoot` in an app)
  const slot = document.createElement('div');
  document.body.append(slot);
  createHudContainer(slot);
  initSettings(root, getHUDRootCMP().elem);
  for (const box of root.querySelectorAll<HTMLElement>('[data-hub-demo]')) {
    const demo = DEMOS[box.dataset.hubDemo ?? ''];
    if (demo) demo(box);
  }
};
