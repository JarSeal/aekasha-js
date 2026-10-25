import { createSceneLoader } from '../SceneLoader';
import { DEBUGGER_SCENE_LOADER_ID } from '../../../debug/DebuggerGUI';
import { CMP } from '../../../ui/CMP';
import { getMotionFactor } from '../../../ui/Motion';
import type { TCMP } from '../../../ui/CMPTypes';
import styles from './DebuggerSceneLoader.module.scss';

const START_ANIM_LENGTH_IN_MS = 150;
const END_ANIM_LENGTH_IN_MS = 250;

/** A fade's length at the loader's motion factor (0 under reduced motion), read when it starts */
const getFadeMs = (container: TCMP | undefined, ms: number) =>
  container ? ms * getMotionFactor(container.elem) : ms;

export const createDebuggerSceneLoader = () =>
  createSceneLoader(
    {
      id: DEBUGGER_SCENE_LOADER_ID,
      loaderContainerFn: () => {
        const baseCmp = CMP({
          id: `${DEBUGGER_SCENE_LOADER_ID}-cmp`,
          class: styles.debuggerSceneLoader,
        });
        baseCmp.add({ class: styles.debuggerSceneLoader__spinner });
        return baseCmp;
      },
      loadStartFn: (loader) =>
        new Promise((resolve) => {
          const fadeMs = getFadeMs(loader.loaderContainer, START_ANIM_LENGTH_IN_MS);
          loader.loaderContainer?.updateStyle({ transitionDuration: `${fadeMs}ms` });
          setTimeout(() => {
            loader.loaderContainer?.updateStyle({ opacity: 1 });
            setTimeout(() => resolve(true), fadeMs);
          }, 0);
        }),
      loadEndFn: (loader) =>
        new Promise((resolve) => {
          const fadeMs = getFadeMs(loader.loaderContainer, END_ANIM_LENGTH_IN_MS);
          setTimeout(() => {
            loader.loaderContainer?.updateStyle({ opacity: 0, transitionDuration: `${fadeMs}ms` });
            setTimeout(() => resolve(true), fadeMs + 20);
          }, 20);
        }),
    },
    false
  );
