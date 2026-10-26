import { CMP } from './CMP';
import type { CMPHandle } from './CMPTypes';
import '../styles/kit.scss';

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
/**
 * The kit root's class: the design tokens, the focus ring and the controls' reset apply under an
 * element with it. The HUD root has it; put it on a container of your own UI outside the HUD (a
 * title screen in the page's markup).
 * @example
 * ```ts
 * import { KIT_ROOT_CLASS } from 'aekasha/ui';
 *
 * document.querySelector('#titleScreen')?.classList.add(KIT_ROOT_CLASS);
 * ```
 */
export const KIT_ROOT_CLASS = 'aekUi';

/** What {@link createHudRoot} makes the HUD root from. */
export type HudRootProps = {
  /** The element the HUD root takes the place of. Default: the page's `#hudRoot` or
   * `#guiContainer` element. */
  slot?: HTMLElement;
};

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
 * Makes the HUD root, the kit root the windows, dialogs, toasts and an app's HUD go under: a fixed,
 * zero-size element in place of `slot`, so each child places itself. The engine's boot makes it
 * (`InitEngine`, `mountAekasha`, whose container's layout containment makes the HUD's fixed elements
 * relative to the container). A page that uses the kit without the engine calls this once itself: a
 * menu page shown before the engine starts, a docs page.
 * @param props where it goes (default: in place of the page's `#hudRoot` or `#guiContainer`)
 * @returns its handle, as {@link getHUDRootCMP} returns it
 * @remarks There's one HUD root per page: a second call throws, also after the boot made it.
 * @example
 * ```ts
 * import { createHudRoot, openDialog } from 'aekasha/ui';
 *
 * // A page without the engine: the root in place of an element of its own
 * createHudRoot({ slot: document.querySelector<HTMLElement>('#menuHud') ?? undefined });
 * openDialog({ id: 'startMenu', title: 'Start' });
 * ```
 */
export const createHudRoot = (props?: HudRootProps): CMPHandle => {
  if (hudRoot) {
    throw new Error(
      'createHudRoot: the HUD root exists already (the engine boot makes it: InitEngine, mountAekasha). A page makes one HUD root.'
    );
  }
  hudRoot = CMP({
    id: HUD_ROOT_ID,
    idAttr: true,
    attach: props?.slot ?? getGUIContainerElem(),
    class: `hudRoot ${KIT_ROOT_CLASS}`,
    style: { position: 'fixed', top: 0, left: 0, width: 0, height: 0 },
  });
  return hudRoot;
};

/** Whether the HUD root exists: the engine's boot or {@link createHudRoot} made it. */
export const hasHudRoot = () => hudRoot !== null;

/**
 * The HUD root: the CMP the engine's and the app's UI go under, made by the boot or
 * {@link createHudRoot} (a fixed, zero size element over the canvas, so each child places itself).
 * Throws before it's made ({@link hasHudRoot}).
 */
export const getHUDRootCMP = () => {
  if (!hudRoot) {
    throw new Error('HUD root CMP not found.');
  }
  return hudRoot;
};
