import { CMP, type TCMP } from './CMP';

let hudRoot: TCMP | null = null;
export const GUI_CONTAINER_ID = 'guiContainer';
export const HUD_ROOT_ID = 'hudRoot';
/** A direct child of the HUD root with this class stays visible in editor views (Views.ts);
 * every other one is hidden there (display: none, so it stays mounted). */
export const KEEP_IN_VIEWS_CLASS = 'aekKeepInViews';

/**
 * Returns the main/root GUI container element
 * @returns guiContainerElem (HTMLElement)
 */
export const getGUIContainerElem = () => {
  let guiContainerElem = document.getElementById(HUD_ROOT_ID);
  if (!guiContainerElem) {
    guiContainerElem = document.getElementById(GUI_CONTAINER_ID);
    if (!guiContainerElem) {
      throw new Error(`GUI container parent element with id "${GUI_CONTAINER_ID}" was not found.`);
    }
  }
  return guiContainerElem;
};

/**
 * Creates the HUD container and sets it to DOM, in place of `slot` (the UI kit's root component
 * replaces the element it attaches to).
 * @param slot the element the HUD root takes the place of. Default: the page's `#hudRoot` or
 * `#guiContainer` element. A mounted engine's is an element in its container (`mountAekasha`),
 * whose layout containment makes the HUD's fixed elements relative to the container.
 */
export const createHudContainer = (slot?: HTMLElement) => {
  hudRoot = CMP({
    id: HUD_ROOT_ID,
    idAttr: true,
    attach: slot ?? getGUIContainerElem(),
    class: 'hudRoot',
    style: { position: 'fixed', top: 0, left: 0, width: 0, height: 0 },
  });
};

/**
 * Returns the HUD root CMP
 * @returns hudRoot (TCMP)
 */
export const getHUDRootCMP = () => {
  if (!hudRoot) {
    throw new Error('HUD root CMP not found.');
  }
  return hudRoot;
};
