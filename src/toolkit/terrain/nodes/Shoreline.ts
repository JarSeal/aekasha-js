// The shoreline (p307 T8): where a surface meets the water level, the surface conditions'
// `waterLevel` (a world height). Three bands over the height above it, the waterline wandering
// along the shore by two octaves of value noise at the world's XZ: the wash (standing water, the
// waves' sheet, rising and falling with the run-up), the saturated sand just above it (a film: its
// glossy edge is what shows a wave, rising with the water and receding a moment behind it), and
// the damp band above (the pores). Below the water level all three are full. Arithmetic
// only: no fetch, no branch (without a water level its uniform is far below any world, so every
// band is 0).
import { float, max, positionWorld, sin, smoothstep, vec2 } from 'three/tsl';
// The real generic `Node<T>` typings (the `three/tsl` `Node` is a loose local shim)
import type { Node } from 'three/webgpu';
import { valueNoise } from './noise/Noise';

/** The waterline's wander: its two octaves' cells (metres) and the second's share */
const NOISE_CELL = 4;
const NOISE_DETAIL_CELL = 1.1;
const NOISE_DETAIL_SHARE = 0.35;
const NOISE_SEEDS = [307, 308] as const;
/** The radians of the run-up's phase per unit of the wander: neighbouring waves arrive apart */
const RUN_UP_PHASE = 4;
/** The height over which the wash's edge fades, metres */
const WASH_EDGE = 0.04;
/** How far above the waves' reach the sand stays saturated, and the fade over it, metres */
const SATURATED_BAND = 0.15;
const SATURATED_FADE = 0.1;
/** The seconds the saturated sand stays glossy after a wave recedes */
const SATURATED_LAG = 1.5;

/** What {@link getShoreline} reads. */
export type ShorelineInputs = {
  /** The water level, world Y (the surface conditions' `waterLevel`). */
  waterLevel: Node<'float'>;
  /** The metres above the water level that stay damp. */
  band: Node<'float'>;
  /** The metres the waterline wanders up and down along the shore. */
  noise: Node<'float'>;
  /** The waves' run-up: the metres they wash up and the seconds between them; null for none. */
  runUp: { height: Node<'float'>; period: Node<'float'> } | null;
  /** The surface clock in seconds (the surface conditions' `time`). */
  time: Node<'float'>;
  /** The surface's world position (default `positionWorld`). */
  position?: Node<'vec3'>;
};

/**
 * The shoreline's bands at the pixel, each 0..1 and 1 under the water: `wash` the standing water
 * (up to the run-up's current height, faded over 4 cm), `saturated` the sand just above it (up to
 * 15 cm over the higher of the reach now and 1.5 s ago, faded over 10 cm), `damp` the band above
 * the water (faded out over `band`). Arithmetic only.
 * @internal
 * @param inputs the water level, the bands' numbers, the run-up, the clock and the position
 * @returns the three bands
 */
export const getShoreline = (inputs: ShorelineInputs) => {
  const position = inputs.position ?? (positionWorld as unknown as Node<'vec3'>);
  const ground = vec2(position.x, position.z) as unknown as Node<'vec2'>;
  const wander = valueNoise(ground.div(NOISE_CELL) as Node<'vec2'>, { seed: NOISE_SEEDS[0] })
    .add(
      valueNoise(ground.div(NOISE_DETAIL_CELL) as Node<'vec2'>, { seed: NOISE_SEEDS[1] }).mul(
        NOISE_DETAIL_SHARE
      )
    )
    .div(1 + NOISE_DETAIL_SHARE) as Node<'float'>;
  // The height above the water, the waterline wandering ±noise
  const height = position.y.sub(inputs.waterLevel).sub(wander.mul(inputs.noise)) as Node<'float'>;
  const { runUp } = inputs;
  // The waves' reach at a time: up and back each period, out of step along the shore
  const reachAt = (time: Node<'float'>) =>
    runUp
      ? (runUp.height.mul(
          sin(
            time
              .div(runUp.period)
              .mul(Math.PI * 2)
              .add(wander.mul(RUN_UP_PHASE))
          )
            .mul(0.5)
            .add(0.5)
        ) as Node<'float'>)
      : (float(0) as unknown as Node<'float'>);
  const reach = reachAt(inputs.time);
  // The saturated sand's top: over the reach now, or the reach a moment ago while a wave recedes
  const wetted = runUp
    ? (max(
        reach,
        reachAt(inputs.time.sub(SATURATED_LAG) as Node<'float'>)
      ) as unknown as Node<'float'>)
    : reach;
  const saturatedTop = wetted.add(SATURATED_BAND) as Node<'float'>;
  const below = (from: Node<'float'>, fade: Node<'float'> | number) =>
    float(1).sub(smoothstep(from, from.add(fade), height)) as unknown as Node<'float'>;
  return {
    wash: below(reach, WASH_EDGE),
    saturated: below(saturatedTop, SATURATED_FADE),
    damp: below(float(0) as unknown as Node<'float'>, inputs.band),
  };
};
