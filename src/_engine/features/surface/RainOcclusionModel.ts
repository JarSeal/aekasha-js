// The rain occlusion map's model (p307 T12, Phase 6): its options and their defaults, where the
// map is centred and when it renders again, as plain functions of numbers. No three, no ECS:
// RainOcclusion.ts holds the map, renders it and builds a material's node.

/** Options of the `rainOcclusion()` feature: the map's size, reach and update. */
export type RainOcclusionOpts = {
  /** The map's texels a side, 16 to 4096 (default 512). */
  size?: number;
  /** The metres a side the map covers around the camera, over 0 (default 64). */
  extent?: number;
  /**
   * The metres above and below the camera the map sees, over 0 (default 100): an occluder higher
   * than that is missed, and a surface lower is open sky.
   */
  height?: number;
  /**
   * Renders the map again every this many frames, for occluders that move (default 30); 0 only
   * when the camera has moved far enough or on `requestRainOcclusionUpdate()`.
   */
  updateFrames?: number;
  /**
   * The metres a surface may be below the occluder it's under and still count as open (default
   * 0.05): keeps an occluder from sheltering its own top.
   */
  bias?: number;
};

/**
 * The options with every default filled in.
 * @internal
 */
export type ResolvedRainOcclusionOpts = Required<RainOcclusionOpts>;

/**
 * The options' defaults.
 * @internal
 */
export const RAIN_OCCLUSION_DEFAULTS: Readonly<ResolvedRainOcclusionOpts> = {
  size: 512,
  extent: 64,
  height: 100,
  updateFrames: 30,
  bias: 0.05,
};

/**
 * The share of the extent (and of the height) the camera moves from the map's centre before the
 * map is centred on it again: the map keeps 3/8 of its extent ahead of the camera at least.
 * @internal
 */
export const RAIN_MAP_RECENTRE_SHARE = 1 / 8;

/**
 * How far a surface's lookup moves out along its geometry normal, in texels: a wall's face and a
 * slope look past the texel their own top fills (a shadow map's normal offset).
 * @internal
 */
export const RAIN_MAP_NORMAL_OFFSET_TEXELS = 1.5;

/**
 * The share of the map, from each edge, over which the occlusion fades to open sky: no hard line
 * where the map ends.
 * @internal
 */
export const RAIN_MAP_EDGE_FADE = 0.1;

const MIN_SIZE = 16;
const MAX_SIZE = 4096;

/** Whether the value is a finite number over 0 (or 0 or more with `orZero`) */
const isPositive = (value: unknown, orZero = false): value is number =>
  typeof value === 'number' && Number.isFinite(value) && (orZero ? value >= 0 : value > 0);

/**
 * The options with their defaults, checked.
 * @internal
 * @throws on an option out of its range, naming it
 */
export const resolveRainOcclusionOpts = (opts?: RainOcclusionOpts): ResolvedRainOcclusionOpts => {
  const resolved = { ...RAIN_OCCLUSION_DEFAULTS, ...opts };
  const { size, extent, height, updateFrames, bias } = resolved;
  const fail = (what: string) => {
    throw new Error(`rainOcclusion(): ${what}.`);
  };
  if (!Number.isInteger(size) || size < MIN_SIZE || size > MAX_SIZE) {
    fail(`size must be an integer from ${MIN_SIZE} to ${MAX_SIZE}, not ${size}`);
  }
  if (!isPositive(extent)) fail(`extent must be over 0, not ${extent}`);
  if (!isPositive(height)) fail(`height must be over 0, not ${height}`);
  if (!Number.isInteger(updateFrames) || updateFrames < 0) {
    fail(`updateFrames must be an integer 0 or more, not ${updateFrames}`);
  }
  if (!isPositive(bias, true)) fail(`bias must be 0 or more, not ${bias}`);
  return resolved;
};

/**
 * A map coordinate snapped to the texel grid, so the map's texels stay put in the world as it
 * follows the camera (no shimmer).
 * @internal
 */
export const snapRainMapCoordinate = (value: number, texel: number) =>
  Math.round(value / texel) * texel;

/**
 * Where the map was last rendered and what asks for the next render.
 * @internal
 */
export type RainMapRenderState = {
  centreX: number;
  centreY: number;
  centreZ: number;
  /** Frames since the last render */
  framesSince: number;
  hasRendered: boolean;
  /** `requestRainOcclusionUpdate()` or a scene's exit asked for a render */
  isRequested: boolean;
};

/**
 * A render state that renders on its first chance.
 * @internal
 */
export const createRainMapRenderState = (): RainMapRenderState => ({
  centreX: 0,
  centreY: 0,
  centreZ: 0,
  framesSince: 0,
  hasRendered: false,
  isRequested: true,
});

/**
 * Whether the map renders this frame with the camera at (x, y, z): never rendered yet, asked
 * for, the camera moved past {@link RAIN_MAP_RECENTRE_SHARE} of the extent (across) or of the
 * height (up or down) from the centre, or `updateFrames` frames have passed since the last one.
 * @internal
 */
export const shouldRenderRainMap = (
  state: Readonly<RainMapRenderState>,
  x: number,
  y: number,
  z: number,
  opts: Readonly<ResolvedRainOcclusionOpts>
) => {
  if (!state.hasRendered || state.isRequested) return true;
  const across = opts.extent * RAIN_MAP_RECENTRE_SHARE;
  if (Math.abs(x - state.centreX) > across || Math.abs(z - state.centreZ) > across) return true;
  if (Math.abs(y - state.centreY) > opts.height * RAIN_MAP_RECENTRE_SHARE) return true;
  return opts.updateFrames > 0 && state.framesSince >= opts.updateFrames;
};
