// The cameras' saved debugger state (`AEK_debugCams`, per scene) and its read, without the
// debugger (p150): the property loader merges a camera's saved values over its creation props in
// the debug env and prod test mode. The writes are `_dbg__CameraDebugState.ts`'. Not a `_dbg__`
// module, so shipping code imports it statically; every call sits behind the debug flags, which
// fold in a production build, so it leaves the bundle (a debug folder ships nothing).
import { lsGetItem } from '../../../utils/LocalAndSessionStorage';

/** A camera's saved debugger state: the edit window's values and its own preferences */
export interface CamEntityDebugState {
  /** Whether its helper shows (a debugger preference, not a creation prop) */
  helperVisible?: boolean;
  /** Its edited position */
  position?: { x: number; y: number; z: number };
  /** Its edited fov (a perspective camera's) */
  fov?: number;
  /** Its edited near plane */
  near?: number;
  /** Its edited far plane */
  far?: number;
  /** Its edited frustum size (an orthographic camera's) */
  frustumSize?: number;
  /** Its edited responsive aspect (Hor+) switch */
  responsiveAspect?: boolean;
  /** Its edited reference aspect */
  referenceAspect?: number;
  /** Whether the edit window's lens folder is open (a debugger preference) */
  _lensSettingsOpen?: boolean;
}

/** The debug orbit camera's saved state, per scene */
export interface DebugCamLSProps {
  /** The debug camera's position */
  position: { x: number; y: number; z: number };
  /** Its orbit target */
  target: { x: number; y: number; z: number };
  /** Whether it's the active camera */
  enabled: boolean;
  /** The app camera that was active before it, to switch back to */
  latestAppCameraId: string | null;
  /** Its fov */
  fov: number;
  /** Its near plane */
  near: number;
  /** Its far plane */
  far: number;
  /** Its zoom */
  zoom: number;
}

/** A scene's saved camera state: its cameras' and the debug camera's */
export interface CamSceneDebugState {
  /** By the cameras' fixed app ids */
  cams: Record<string, CamEntityDebugState>;
  /** The debug camera's state in the scene */
  debugCam: DebugCamLSProps;
}

/** The structure of 'AEK_debugCams' in LocalStorage */
export interface CamDebugLSData {
  [sceneId: string]: CamSceneDebugState;
}

/** The cameras' saved debugger state's LS key */
export const LS_KEY = 'AEK_debugCams';

/**
 * Returns a camera's saved debugger state in a scene. Takes the scene: the property loader reads
 * the loading one's, and importing `Scene.ts` here would put this module in its import cycle.
 * @param sceneId the scene whose data to read
 */
export const readCameraDebugData = (
  appId: string | undefined,
  sceneId: string | null
): CamEntityDebugState | undefined => {
  if (!appId) return;
  const currentData = lsGetItem(LS_KEY, {}) as CamDebugLSData;
  if (
    !sceneId ||
    !currentData ||
    !currentData[sceneId] ||
    !currentData[sceneId].cams ||
    !currentData[sceneId].cams[appId]
  ) {
    return;
  }
  return currentData[sceneId].cams[appId];
};
