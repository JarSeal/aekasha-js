import { readCameraDebugData } from '../camera/debug/CameraDebugStorage';
import { readLightDebugData } from '../light/debug/LightDebugStorage';
import { IS_DEBUG_ENV, IS_PROD_TEST_MODE } from '../config/Config';
import { getCurrentSceneId, getLoadingSceneId } from './Scene';

/**
 * Which kind of saved props {@link loadPersistentProps} reads.
 * @internal
 */
export type PropType = 'LIGHT' | 'CAMERA';

/**
 * The props {@link loadPersistentProps} takes: any object, whose `appId` keys its saved props.
 * @internal
 */
export interface LoadableProps {
  /** The object's app id: without one, nothing saved applies. */
  appId?: string;
  [key: string]: unknown;
}

/**
 * A copy of a camera's or light's creation props, with what the debugger saved for it in this
 * scene merged over them in the debug env and prod test mode (`initProps` itself without an
 * `appId`). The saved file props are in `initProps` already: the gatherer applies an asset's
 * `__saveData` to the scene data the loader creates it from.
 * @internal
 */
export const loadPersistentProps = <T extends LoadableProps>(
  initProps: T,
  propType: PropType
): T => {
  const appId = initProps.appId;
  if (!appId) return initProps;

  // Only the debugger writes them (debug env), but prod test mode reads them too (p150). Both
  // flags fold in a production build, and the storage modules with them
  if (IS_DEBUG_ENV || IS_PROD_TEST_MODE) {
    const savedDebugProps = getSavedDebugProps(appId, propType);
    if (savedDebugProps) return { ...initProps, ...savedDebugProps };
  }

  return { ...initProps };
};

const getSavedDebugProps = (appId: string, propType: PropType): object => {
  // Cameras (and lights created by a scene's init code) are created while their scene is
  // still loading, before it becomes the current scene, so read the loading scene's data.
  const sceneId = getLoadingSceneId() ?? getCurrentSceneId();
  switch (propType) {
    case 'LIGHT':
      return readLightDebugData(appId, sceneId) || {};
    case 'CAMERA':
      return readCameraDebugData(appId, sceneId) || {};
  }
};
