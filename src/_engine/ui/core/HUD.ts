import { CMP } from './CMP';
import type { CMPHandle } from './CMPTypes';

let hudRoot: CMPHandle | null = null;
/**
 * The page element the full-page boot's HUD root takes the place of, when there's no `#hudRoot`.
 * @internal
 */
export const GUI_CONTAINER_ID = 'guiContainer';
/**
 * The HUD root's element id (`#hudRoot`), which the page may hold for it.
 * @internal
 */
export const HUD_ROOT_ID = 'hudRoot';
/** A direct child of the HUD root with this class stays visible in editor views (the debug
 * env's material editor and the like); every other one is hidden there (`display: none`, so it
 * stays mounted). */
export const KEEP_IN_VIEWS_CLASS = 'aekKeepInViews';

/** The page element the HUD root takes the place of: `#hudRoot`, else `#guiContainer`. */
const getGUIContainerElem = () => {
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
 * replaces the element it attaches to): the boot's. It's a kit root (the class `aekUi`), so the
 * design tokens (`ui/styles/tokens.css`) apply to everything under it.
 * @internal
 * @param slot the element the HUD root takes the place of. Default: the page's `#hudRoot` or
 * `#guiContainer` element. A mounted engine's is an element in its container (`mountAekasha`),
 * whose layout containment makes the HUD's fixed elements relative to the container.
 */
export const createHudContainer = (slot?: HTMLElement) => {
  hudRoot = CMP({
    id: HUD_ROOT_ID,
    idAttr: true,
    attach: slot ?? getGUIContainerElem(),
    class: 'hudRoot aekUi',
    style: { position: 'fixed', top: 0, left: 0, width: 0, height: 0 },
  });
};

/**
 * The HUD root: the CMP the engine's and the app's UI go under, made by the boot (a fixed, zero
 * size element over the canvas, so each child places itself). Throws before the boot made it.
 */
export const getHUDRootCMP = () => {
  if (!hudRoot) {
    throw new Error('HUD root CMP not found.');
  }
  return hudRoot;
};
