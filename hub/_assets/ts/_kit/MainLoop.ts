/**
 * The Hub's stand-in for the engine's `kernel/loop/MainLoop.ts` (p802 Phase 4,
 * `devTools/hub/kitStandIns.ts`): the real module imports three, the renderer and, through them,
 * both workers, all for the one name the UI kit takes from it.
 *
 * It exports only the names the kit imports: a new one fails the Hub's script build (a missing
 * export) until it's added here, or p803 cuts the kit's kernel imports (p800 D1) and this goes.
 */

const resizers = new Map<string, () => void>();
let isListening = false;

/**
 * Adds a resizer, as the engine's does. The main loop runs those on a canvas resize; the Hub has
 * no canvas, so these run on the browser window's `resize`.
 * @param id its id: a taken one throws, as in the engine
 * @param resizer what runs on each resize
 */
export const addResizer = (id: string, resizer: () => void) => {
  if (resizers.has(id)) throw new Error(`A resizer with the id "${id}" already exists.`);
  resizers.set(id, resizer);
  if (isListening) return;
  isListening = true;
  window.addEventListener('resize', () => {
    for (const run of resizers.values()) run();
  });
};
