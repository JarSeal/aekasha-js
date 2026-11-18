// The frost (p307 T11): a cold, dry surface's hoarfrost. Below a temperature it whitens the albedo a
// little and roughens the surface (ice loses its mirror), as far as the surface takes frost (the
// dense ones most) and faces the sky (radiative cooling: an underside frosts half). The sparkle
// is ice crystals catching the light: small cells of the surface, each a random facet, glinting
// where the facet turns to the camera, added to the albedo (so the scene's light shows them, dimmer
// in shade); faded out with the distance (a cell under a pixel would shimmer). The sparkle sits in
// a dynamic branch on its weight and the fade (the slope gate's rules: a `Fn` returning a var,
// everything it reads assigned before it); the frost is arithmetic.
import {
  cameraPosition,
  dot,
  float,
  floor,
  fract,
  Fn,
  If,
  mix,
  positionWorld,
  smoothstep,
  vec2,
  vec3,
} from 'three/tsl';
// The real generic `Node<T>` typings (the `three/tsl` `Node` is a loose local shim)
import type { Node } from 'three/webgpu';
import { declareBranchInput as declare, toVar } from './BranchInputs';
import { hash12, hash22 } from './noise/Hash';

/** The share of the frost's whitening at full frost, and the white it mixes toward */
const FROST_WHITEN = 0.12;
const FROST_WHITE = [0.82, 0.86, 0.9] as const;
/** The roughness a full frost raises the surface to (never lowers it) */
const FROST_ROUGHNESS = 0.6;
/** How much an underside frosts against a face to the sky */
const FROST_SHELTERED = 0.5;
/**
 * The cosine over which a facet's glint fades in toward the camera: about 2.5 % of the cells glint
 * from a view
 */
const GLINT_FROM = 0.95;
/** A glint's radius in its cell, and its soft edge (cells) */
const GLINT_RADIUS = 0.35;
const GLINT_EDGE = 0.1;
/** Folds a 3D cell's y into the 2D hash's x: whole numbers, so cells stay apart */
const CELL_FOLD = 131;
const SEEDS = [312, 313] as const;

/** What {@link getFrost} reads. */
export type FrostInputs = {
  /** The air temperature, °C (the surface conditions' `temperature`). */
  temperature: Node<'float'>;
  /** The temperatures where frost starts and where it's full, °C (x warmer than y). */
  range: Node<'vec2'>;
  /** The frost's strength, 0..1. */
  strength: Node<'float'>;
  /** How far the surface takes frost, 0..1 (eg. 1 − its porosity). */
  response: Node<'float'>;
  /** The rain's reach by the facing (the wet response's exposure): an underside frosts half. */
  exposure: Node<'float'>;
};

/**
 * The frost at the pixel, 0..1: none above the range's x, full at its y and below, × the
 * strength, the response and the facing (half on an underside). Arithmetic.
 * @internal
 */
export const getFrost = (inputs: FrostInputs): Node<'float'> => {
  const { range } = inputs;
  const cold = smoothstep(range.y, range.x, inputs.temperature).oneMinus();
  const facing = inputs.exposure.mul(1 - FROST_SHELTERED).add(FROST_SHELTERED);
  return cold.mul(inputs.strength).mul(inputs.response).mul(facing) as unknown as Node<'float'>;
};

/**
 * A surface under frost: the albedo toward a cold white by a share of the frost, the roughness
 * raised toward a frosted one (never lowered).
 * @internal
 */
export const applyFrost = (
  albedo: Node<'vec3'>,
  roughness: Node<'float'>,
  frost: Node<'float'>
) => ({
  albedo: mix(albedo, vec3(...FROST_WHITE), frost.mul(FROST_WHITEN)) as unknown as Node<'vec3'>,
  roughness: mix(roughness, roughness.max(FROST_ROUGHNESS), frost) as unknown as Node<'float'>,
});

/** What {@link getSparkle} reads. */
export type SparkleInputs = {
  /** The surface's position, metres: its cells are the crystals. */
  position: Node<'vec3'>;
  /** The cells a metre. */
  density: Node<'float'>;
  /** Where the sparkle shows, 0..1 (the frost, frozen snow × a distance fade): 0 computes none. */
  weight: Node<'float'>;
};

/**
 * The sparkle at the pixel, 0..1 × the weight: the position's cell (`density` a metre) a random
 * facet and a spot in it, glinting where the facet turns to the camera. In a dynamic branch on the
 * weight.
 * @internal
 * @param inputs the position, the density and the weight
 * @returns the glint, a var
 */
export const getSparkle = (inputs: SparkleInputs): Node<'float'> => {
  const call = Fn(() => {
    const weight = declare(inputs.weight, 'float');
    const at = declare(inputs.position.mul(inputs.density) as Node<'vec3'>, 'vec3');
    const toCamera = declare(
      (cameraPosition as unknown as Node<'vec3'>)
        .sub(positionWorld as unknown as Node<'vec3'>)
        .normalize() as Node<'vec3'>,
      'vec3'
    );
    const out = toVar(float(0)) as unknown as Node<'float'> & {
      assign: (value: unknown) => void;
    };
    If(weight.greaterThan(0), () => {
      const cell = floor(at) as Node<'vec3'>;
      const key = vec2(cell.x.add(cell.y.mul(CELL_FOLD)), cell.z) as unknown as Node<'vec2'>;
      const facet = vec3(hash22(key, { seed: SEEDS[0] }), hash12(key, { seed: SEEDS[1] }))
        .sub(0.5)
        .normalize() as Node<'vec3'>;
      const glint = smoothstep(GLINT_FROM, 1, dot(facet, toCamera));
      const spot = smoothstep(
        GLINT_RADIUS,
        GLINT_RADIUS - GLINT_EDGE,
        (fract(at) as Node<'vec3'>).sub(0.5).length()
      );
      out.assign(glint.mul(spot).mul(weight));
    });
    return out;
  }).once()();
  return toVar(call) as unknown as Node<'float'>;
};
