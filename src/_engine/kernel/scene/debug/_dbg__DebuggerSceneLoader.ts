import { createSceneLoader } from '../SceneLoader';
import { DEBUGGER_SCENE_LOADER_ID } from '../../../debug/DebuggerGUI';
import { createLoadingOverlay, type LoadingOverlay } from '../../../ui/components/LoadingOverlay';

/** The debugger's scene loader (the Debug tools' start scene): the UI kit's loading overlay over
 * the HUD's bounds, a new one per load (the load removes its container at its end), faded in at the
 * load's start and out at its end (p803 Phase 7) */
export const createDebuggerSceneLoader = () => {
  let overlay: LoadingOverlay | null = null;
  return createSceneLoader(
    {
      id: DEBUGGER_SCENE_LOADER_ID,
      loaderContainerFn: () => {
        overlay = createLoadingOverlay({
          id: `${DEBUGGER_SCENE_LOADER_ID}-cmp`,
          text: 'Loading the scene',
        });
        return overlay.cmp;
      },
      loadStartFn: () => overlay?.showAsync() ?? Promise.resolve(true),
      loadEndFn: () => overlay?.hideAsync() ?? Promise.resolve(true),
    },
    false
  );
};
