// The fog's transitions (p106 D6, `updateFog`): each number the fog's uniforms take is a channel
// that moves linearly from where it is to its target over a call's time, the latest call winning
// per channel. Plain arrays and a time step, no three and no ECS (the SurfaceConditionsModel.ts
// pattern): Fog.ts computes the targets from the definition and writes the values into the
// uniforms.

/**
 * The channels' indices: the colour (linear, so a colour moves in linear space), then the modes'
 * parameters and the sun glow's, as `FogNodes` names them.
 * @internal
 */
export const FOG_CHANNEL = {
  COLOR_R: 0,
  COLOR_G: 1,
  COLOR_B: 2,
  NEAR: 3,
  FAR: 4,
  EXP2_DENSITY: 5,
  HEIGHT_DENSITY: 6,
  BASE_HEIGHT: 7,
  FALLOFF: 8,
  START_DISTANCE: 9,
  MAX_OPACITY: 10,
  SUN_STRENGTH: 11,
  SUN_EXPONENT: 12,
} as const;

/**
 * How many channels there are.
 * @internal
 */
export const FOG_CHANNEL_COUNT = 13;

/**
 * The channels' state, one slot each, reused: allocated once, stepped without allocating.
 * @internal
 */
export type FogTransitions = {
  /** Where each channel is now: what the uniforms get */
  readonly values: Float64Array;
  /** Where each is going (its value when it isn't moving) */
  readonly targets: Float64Array;
  /** Where each running transition started */
  readonly from: Float64Array;
  readonly elapsedSec: Float64Array;
  readonly durationSec: Float64Array;
  /** 1 while a channel moves */
  readonly isActive: Uint8Array;
};

/**
 * Channels at 0 with nothing moving.
 * @internal
 */
export const createFogTransitions = (): FogTransitions => ({
  values: new Float64Array(FOG_CHANNEL_COUNT),
  targets: new Float64Array(FOG_CHANNEL_COUNT),
  from: new Float64Array(FOG_CHANNEL_COUNT),
  elapsedSec: new Float64Array(FOG_CHANNEL_COUNT),
  durationSec: new Float64Array(FOG_CHANNEL_COUNT),
  isActive: new Uint8Array(FOG_CHANNEL_COUNT),
});

/**
 * Every channel at its target now, nothing moving (another fog, or none).
 * @internal
 */
export const snapFogTransitions = (tr: FogTransitions, targets: ArrayLike<number>) => {
  for (let i = 0; i < FOG_CHANNEL_COUNT; i++) {
    tr.targets[i] = targets[i];
    tr.values[i] = targets[i];
    tr.isActive[i] = 0;
  }
};

/**
 * Moves each channel whose target changed toward it, from where it is, over `transitionSec` (0, a
 * negative or a non-finite time: at once). A channel whose target is the same keeps its running
 * transition, so the latest call wins per channel.
 * @internal
 */
export const startFogTransitions = (
  tr: FogTransitions,
  targets: ArrayLike<number>,
  transitionSec: number
) => {
  const sec = Number.isFinite(transitionSec) ? Math.max(transitionSec, 0) : 0;
  for (let i = 0; i < FOG_CHANNEL_COUNT; i++) {
    const target = targets[i];
    if (target === tr.targets[i]) continue;
    tr.targets[i] = target;
    if (sec > 0) {
      tr.from[i] = tr.values[i];
      tr.elapsedSec[i] = 0;
      tr.durationSec[i] = sec;
      tr.isActive[i] = 1;
    } else {
      tr.values[i] = target;
      tr.isActive[i] = 0;
    }
  }
};

/**
 * Advances the running transitions by `dtSec`; each ends on its target. Allocates nothing.
 * @internal
 * @returns whether a channel moved
 */
export const stepFogTransitions = (tr: FogTransitions, dtSec: number) => {
  if (dtSec <= 0) return false;
  let hasMoved = false;
  for (let i = 0; i < FOG_CHANNEL_COUNT; i++) {
    if (!tr.isActive[i]) continue;
    hasMoved = true;
    const elapsed = tr.elapsedSec[i] + dtSec;
    tr.elapsedSec[i] = elapsed;
    if (elapsed >= tr.durationSec[i]) {
      tr.values[i] = tr.targets[i];
      tr.isActive[i] = 0;
      continue;
    }
    tr.values[i] = tr.from[i] + (tr.targets[i] - tr.from[i]) * (elapsed / tr.durationSec[i]);
  }
  return hasMoved;
};
