// The lights' saved debugger state (`AEK_debugLights`, per scene) and its read, without the
// debugger (p150): the property loader merges a light's saved values over its creation props in
// the debug env and prod test mode. The writes are `_dbg__LightDebugState.ts`'. Not a `_dbg__`
// module, so shipping code imports it statically; every call sits behind the debug flags, which
// fold in a production build, so it leaves the bundle (a debug folder ships nothing).
import type { ShadowQuality } from '../../../schemas/_HelperSchemas';
import { lsGetItem } from '../../../utils/LocalAndSessionStorage';

/** A light's saved debugger state: the edit window's values and its own preferences */
export interface LightEntityDebugState {
  /** Its edited enabled state (written into a new entry as `true`: i165) */
  enabled: boolean;
  /** Whether its helper shows (a debugger preference, not a creation prop) */
  helperVisible: boolean;
  /** Whether its 3D symbol shows (a debugger preference) */
  symbolVisible: boolean;
  /** Its edited colour (the sky colour of a hemisphere light), as a hex number */
  color?: number;
  /** A hemisphere light's edited ground colour, as a hex number */
  groundColor?: number;
  /** Its edited intensity */
  intensity?: number;
  /** A point or spot light's edited range */
  distance?: number;
  /** A spot light's edited cone angle */
  angle?: number;
  /** A spot light's edited penumbra */
  penumbra?: number;
  /** A point or spot light's edited decay */
  decay?: number;
  /** Its edited position */
  position?: { x: number; y: number; z: number };
  /** Its target's edited position (a directional or spot light's) */
  targetPos?: { x: number; y: number; z: number };
  /** Whether it casts a shadow */
  castShadow?: boolean;
  /** Whether its ECS frustum culling is on */
  frustumCullingEnabled?: boolean;
  /** Whether its object culling is on */
  objectCullingEnabled?: boolean;
  /** Its shadow's quality preset */
  shadowPreset?: ShadowQuality;
  /** Its shadow's bias */
  shadowBias?: number;
  /** Its shadow's normal bias */
  shadowNormalBias?: number;
  /** Its shadow map's width and height */
  shadowMapSize?: [number, number];
  /** Its shadow camera's near and far planes */
  shadowCameraNearFar?: [number, number];
  /** Its shadow camera's frustum: left, right, top, bottom */
  shadowCameraFrustum?: [number, number, number, number];
  /** Its shadow's blur samples */
  shadowBlurSamples?: number;
  /** Its shadow's blur radius */
  shadowRadius?: number;
  /** Its shadow's intensity */
  shadowIntensity?: number;
  /** Whether the edit window's shadow folder is open (a debugger preference) */
  _shadowFolderOpen?: boolean;
  /** Whether the edit window's shadow camera folder is open (a debugger preference) */
  _shadowCameraFolderOpen?: boolean;
}

/** A scene's saved light state: its lights' and the global helpers toggle */
export interface LightSceneDebugState {
  /** Whether the Lights tab's global helpers toggle is on */
  globalHelpersVisible: boolean;
  /** Map of fixed appId to light-specific debug state */
  lights: Record<string, LightEntityDebugState>;
}

/** The structure of 'AEK_debugLights' in LocalStorage */
export interface LightDebugLSData {
  [sceneId: string]: LightSceneDebugState;
}

/** The lights' saved debugger state's LS key */
export const LS_LIGHTS_KEY = 'AEK_debugLights';

/**
 * Returns a light's saved debugger state in a scene. Takes the scene: the property loader reads
 * the loading one's, and importing `Scene.ts` here would put this module in its import cycle.
 * @param sceneId the scene whose data to read
 */
export const readLightDebugData = (
  appId: string | undefined,
  sceneId: string | null
): LightEntityDebugState | undefined => {
  if (!appId) return;
  const currentData = lsGetItem(LS_LIGHTS_KEY, {}) as LightDebugLSData;
  if (
    !sceneId ||
    !currentData ||
    !currentData[sceneId] ||
    !currentData[sceneId].lights ||
    !currentData[sceneId].lights[appId]
  ) {
    return;
  }
  return currentData[sceneId].lights[appId];
};
