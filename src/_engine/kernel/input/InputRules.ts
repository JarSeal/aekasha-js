import { isDebugCameraActive } from '../camera/Camera';
import { IS_DEBUG_ENV } from '../config/Config';
import type { EnabledInDebugCam } from './InputSharedTypes';

/**
 * Whether a binding, an action map or a debug key with this debug camera rule fires now: always
 * outside the debug env, else by whether the debug (orbit) camera is active. The one rule the
 * devices, the action layer and the debug keys share.
 * @internal
 */
export const isDebugCamRuleMet = (rule?: EnabledInDebugCam): boolean =>
  !IS_DEBUG_ENV ||
  !(
    (rule === 'NOT_ENABLED_IN_DEBUG' && isDebugCameraActive()) ||
    (rule === 'ENABLED_ONLY_IN_DEBUG' && !isDebugCameraActive())
  );
