// The material editor's preparers (p303): what a feature makes before the editor creates a copy
// of a material whose input needs more than textures (a texture set array, which a scene's load
// builds). The editor can't import feature code, so a feature's own debug module registers one
// from its `onDebug` hook; this module stays small so that registering doesn't load the editor.
import { lerror } from '../../../utils/Logger';
import type { MaterialAsset } from '../../../schemas/MaterialSchema';

/**
 * Prepares what a material asset's inputs need before the material editor creates its copy.
 * @internal
 */
export type MaterialEditorPreparer = {
  /** Unique: registering the same id again replaces the preparer. */
  id: string;
  /** Makes what the asset needs (each call in the owner scope of the scene current then). A
   * rejection is logged and the load goes on: the copy then shows the input's own error. */
  prepareAsync: (asset: MaterialAsset) => Promise<void>;
  /** The editor's exit: hands what this visit made to the current scene, as its textures. */
  onExit?: () => void;
};

const preparers = new Map<string, MaterialEditorPreparer>();

/**
 * Registers a preparer (a feature's debug module, from its `onDebug` hook).
 * @internal
 * @returns its remover
 */
export const registerMaterialEditorPreparer = (preparer: MaterialEditorPreparer) => {
  preparers.set(preparer.id, preparer);
  return () => {
    if (preparers.get(preparer.id) === preparer) preparers.delete(preparer.id);
  };
};

/**
 * Runs every preparer on the asset, all at once (the editor's load, beside its textures).
 * @internal
 */
export const runMaterialEditorPreparersAsync = async (asset: MaterialAsset) => {
  const list = [...preparers.values()];
  const results = await Promise.allSettled(list.map((preparer) => preparer.prepareAsync(asset)));
  results.forEach((result, i) => {
    if (result.status === 'rejected') {
      lerror(
        `Material editor: the preparer "${list[i].id}" failed for the material "${asset.id}".`,
        result.reason
      );
    }
  });
};

/**
 * Runs every preparer's exit (the editor view's exit).
 * @internal
 */
export const runMaterialEditorPreparerExits = () => {
  for (const preparer of preparers.values()) preparer.onExit?.();
};
