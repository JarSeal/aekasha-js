import type { ColorJSON, DebugData } from '../../schemas/_HelperSchemas';

// The fog's runtime types (p106 D2): a definition as the feature uses it, every key filled in
// (`resolveFogDef`, FogSchema.ts: the gatherer resolves the scenes' fogs, `setFog` a code one).

/** How the fog thickens with distance: `LINEAR` (three's `Fog`, a smoothstep between `near` and
 * `far`), `EXP2` (three's `FogExp2`) or `HEIGHT` (an exponential height fog, thick low down). */
export type FogMode = 'LINEAR' | 'EXP2' | 'HEIGHT';

/** Where the fog's colour comes from: `SKY` (the wired sky colour, `color` without one) or
 * `MANUAL` (`color`). */
export type FogColorSource = 'SKY' | 'MANUAL';

/** What the fog does to the background: `NONE`, or `FOG_COLOR` (the root scene's clear colour is
 * the fog's colour while no sky box shows a background). */
export type FogBackground = 'NONE' | 'FOG_COLOR';

/** {@link FogDef}'s `LINEAR` parameters. */
export type FogLinearParams = {
  /** Metres from the camera where the fog starts */
  near: number;
  /** Metres from the camera where the fog is full */
  far: number;
};

/** {@link FogDef}'s `EXP2` parameters. */
export type FogExp2Params = {
  /** The fog factor is `1 − exp(−(density · distance)²)` */
  density: number;
};

/** {@link FogDef}'s `HEIGHT` parameters. */
export type FogHeightParams = {
  /** The fog's density per metre at `baseHeight` */
  density: number;
  /** The world Y where the density is `density` */
  baseHeight: number;
  /** How fast the density falls with height, per metre (`exp(−falloff · (y − baseHeight))`) */
  falloff: number;
  /** Metres from the camera before which there's no fog */
  startDistance: number;
  /** The fog factor's maximum, 0 to 1 */
  maxOpacity: number;
};

/** {@link FogDef}'s sun glow: the fog's colour moves toward the sun's around it. */
export type FogSunScattering = {
  /** Whether the fog glows toward the sun */
  enabled: boolean;
  /** How far the colour moves toward the sun's when looking straight at it, 0 to 1 */
  strength: number;
  /** How tight the glow is around the sun: higher is tighter */
  exponent: number;
};

/**
 * A fog as the `fog()` feature uses it: every key filled in. Every mode's parameters are kept,
 * so switching `mode` loses none; only `mode` says which one renders.
 */
export type FogDef = {
  /** What `setFog` and the save data name it by */
  id: string;
  /** Whether this is the fog its scene starts with (else the scene's first) */
  isDefault: boolean;
  /** Whether it renders (with `setFogEnabled`'s switch) */
  enabled: boolean;
  /** Which of the parameters render */
  mode: FogMode;
  /** Where the colour comes from */
  colorSource: FogColorSource;
  /** The colour (sRGB, a CSS colour or `{ r, g, b }` in 0-255): `MANUAL`'s, and `SKY`'s without a
   * sky colour */
  color: ColorJSON;
  /** `LINEAR`'s parameters */
  linear: FogLinearParams;
  /** `EXP2`'s parameters */
  exp2: FogExp2Params;
  /** `HEIGHT`'s parameters */
  height: FogHeightParams;
  /** The sun glow, in every mode */
  sunScattering: FogSunScattering;
  /** What the fog does to the background */
  background: FogBackground;
  /** The debugger's data (development builds only) */
  debugData?: DebugData;
};
