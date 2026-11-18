// The snow cover (p307 T10): snow over any surface by the surface conditions' `snowCoverage`. Each
// pixel resists the snow by its slope (half), its relief (a quarter: the stones stick out last) and
// a drift noise (a quarter: two octaves of value noise at the material's XZ), and at least by its
// slope alone (1 at `maxSlope`); the coverage rises past the resistance, so flat ground fills
// first, then the slopes and the high points, and 1 covers everything up to `maxSlope`. The snow is a texture set sampled top-down (planar at the
// position's `(x, −z)`, its normal through the planar frame); past a far share it's the set's
// average colour, sampled nowhere. A snowless frame computes nothing: the mask is in a branch on
// the coverage, the set's taps in a branch on the mask (and the far share), both inside a `Fn`
// returning a struct var, everything they read a var assigned before them, the taps' gradients
// explicit (the slope gate's rules).
import { dFdx, dFdy, float, Fn, If, max, mix, smoothstep, struct, vec2, vec3 } from 'three/tsl';
// The real generic `Node<T>` typings (the `three/tsl` `Node` is a loose local shim)
import type { Node } from 'three/webgpu';
import type { TextureSetInput } from 'aekasha/texturesets';
import { declareBranchInput as declare, toVar } from './BranchInputs';
import { valueNoise } from './noise/Noise';
import { sampleTextureSet } from './SampleTextureSet';
import { getSurfaceSpace } from './SurfaceSpace';
import { getPlanarTangentFrame, transformTangentNormalToWorld } from './TerrainNormals';

/** The resistance's shares: the slope (0 flat, 1 at `maxSlope`), the relief and the drift noise */
const SLOPE_SHARE = 0.5;
const RELIEF_SHARE = 0.25;
const NOISE_SHARE = 0.25;
/** The drift noise's second octave: its cell against the first's, and its share */
const NOISE_DETAIL_CELL = 1 / 3.7;
const NOISE_DETAIL_SHARE = 0.35;
const NOISE_SEEDS = [310, 311] as const;
/**
 * How far below the snow's edge its fringe reaches, in resistance: the ground just around the
 * snow, which its meltwater wets
 */
const FRINGE_REACH = 0.15;
/** The snow's roughness without a sample (past the far share, or a packing without roughness) */
const SNOW_ROUGHNESS = 0.8;

/** What {@link sampleSnowCover} reads. */
export type SnowCoverInputs = {
  /** The snow's texture set: a `{ textureSet }` input's bundle. */
  set: TextureSetInput;
  /** The surface's position, metres: its `(x, −z)` tiles the set. */
  position: Node<'vec3'>;
  /** The geometry normal in the position's space: the snow normal's frame. */
  normal: Node<'vec3'>;
  /** The geometry normal's world Y: the slope the snow rests on. */
  up: Node<'float'>;
  /** The ground's relief, 0..1 (0.5 for none): its high points take the snow last. */
  height: Node<'float'>;
  /** The snow cover, 0..1 (the surface conditions' `snowCoverage`): 0 computes nothing. */
  coverage: Node<'float'>;
  /** The steepest slope the snow rests on, radians from flat. */
  maxSlope: Node<'float'>;
  /** The drift noise's cell, metres. */
  noiseScale: Node<'float'>;
  /** The resistance over which the snow's edge fades in. */
  edge: Node<'float'>;
  /** The set's tiling: its tile is its `physicalSize` × this. */
  tiling: Node<'float'>;
  /**
   * Where the snow is its set's average colour instead of a sample, 0..1 (a far surface's share:
   * 1 samples nothing), or null: sampled wherever it shows. Needs the set's `averageColor`.
   */
  far: Node<'float'> | null;
};

/** The snow at the pixel: its surface and how far it covers the ground. */
export type SnowCover = {
  /** The snow's albedo, linear (× the set's tint). */
  albedo: Node<'vec3'>;
  /** The snow's roughness. */
  roughness: Node<'float'>;
  /** The snow's normal in the position's space (the geometry's where its set has no normal map). */
  normal: Node<'vec3'>;
  /** The snow's own relief, 0..1. */
  height: Node<'float'>;
  /** How far the snow covers the surface, 0..1. */
  cover: Node<'float'>;
  /** The snow and the ground just around it, 0..1: where its meltwater runs. */
  fringe: Node<'float'>;
};

/** A member's node in the struct var */
type StructVar = { get: (name: string) => Node<'float'> & { assign: (value: unknown) => void } };

const MEMBERS = {
  albedo: 'vec3',
  roughness: 'float',
  normal: 'vec3',
  height: 'float',
  cover: 'float',
  fringe: 'float',
} as const;

/**
 * The snow cover at the pixel: the surface's resistance (its slope against `maxSlope`, its relief,
 * a drift noise) under the coverage, faded in over `edge` (none at coverage 0, everything up to
 * `maxSlope` at 1), and the snow set's surface there, sampled top-down (its taps in a dynamic
 * branch on the cover, with explicit gradients) or past the `far` share its average colour. All
 * of it in a dynamic branch on the coverage: 0 computes nothing.
 * @internal
 * @param inputs the set, the surface, the coverage and the snow's numbers
 * @returns the snow's surface, its cover and its fringe (members of one struct var)
 */
export const sampleSnowCover = (inputs: SnowCoverInputs): SnowCover => {
  const { set, position } = inputs;
  const tileSize = set.physicalSize.mul(inputs.tiling) as unknown as Node<'vec2'>;
  // Built outside the branches: the tile UV and its gradients in uniform control flow
  const ground = vec2(position.x, position.z.negate()) as unknown as Node<'vec2'>;
  const uv = ground.div(tileSize) as Node<'vec2'>;
  const dx = dFdx(uv) as unknown as Node<'vec2'>;
  const dy = dFdy(uv) as unknown as Node<'vec2'>;
  const tint = set.tint as unknown as Node<'vec3'>;
  const average = (set.averageColor ?? vec3(1)) as unknown as Node<'vec3'>;
  const roughnessScale = set.roughnessScale as unknown as Node<'float'>;
  const Snow = struct(MEMBERS);

  const call = Fn(() => {
    const coverage = declare(inputs.coverage, 'float');
    const up = declare(inputs.up, 'float');
    const height = declare(inputs.height, 'float');
    const normal = declare(inputs.normal, 'vec3');
    const at = declare(uv, 'vec2');
    const atDx = declare(dx, 'vec2');
    const atDy = declare(dy, 'vec2');
    const drift = declare(ground.div(inputs.noiseScale) as Node<'vec2'>, 'vec2');
    const far = inputs.far ? declare(inputs.far, 'float') : null;
    const cosMax = declare(inputs.maxSlope.cos() as Node<'float'>, 'float');
    const edge = declare(inputs.edge, 'float');
    // The initializer is the far snow: the average colour, flat, rough
    const out = toVar(
      Snow({
        albedo: average.mul(tint),
        roughness: float(SNOW_ROUGHNESS).mul(roughnessScale).min(1),
        normal,
        height: float(0.5),
        cover: float(0),
        fringe: float(0),
      } as never)
    ) as unknown as StructVar;
    If(coverage.greaterThan(0), () => {
      // The slope from flat over maxSlope's (1 − cos): past 1 the coverage never reaches it
      const slope = float(1)
        .sub(up)
        .div(max(float(1).sub(cosMax), 1e-4));
      const noise = valueNoise(drift, { seed: NOISE_SEEDS[0] })
        .add(
          valueNoise(drift.div(NOISE_DETAIL_CELL) as Node<'vec2'>, { seed: NOISE_SEEDS[1] }).mul(
            NOISE_DETAIL_SHARE
          )
        )
        .div(1 + NOISE_DETAIL_SHARE)
        .mul(0.5)
        .add(0.5);
      // At least the slope itself: nothing steeper than maxSlope, whatever its relief and noise
      const resistance = slope
        .mul(SLOPE_SHARE)
        .add(height.mul(RELIEF_SHARE))
        .add(noise.mul(NOISE_SHARE))
        .max(slope)
        .max(0) as Node<'float'>;
      // The reach: 0 covers nothing, 1 everything resisting up to 1 (maxSlope)
      const reach = coverage.mul(edge.add(1));
      const cover = toVar(smoothstep(resistance, resistance.add(edge), reach));
      out.get('cover').assign(cover);
      out
        .get('fringe')
        .assign(smoothstep(resistance.sub(FRINGE_REACH), resistance.add(edge), reach));
      const isNear = far ? cover.greaterThan(0).and(far.lessThan(1)) : cover.greaterThan(0);
      If(isNear, () => {
        const sample = sampleTextureSet(set, at, { grad: { dx: atDx, dy: atDy } });
        const space = { ...getSurfaceSpace(), normal };
        const snowNormal = sample.normalTS
          ? transformTangentNormalToWorld(
              vec3(
                sample.normalTS.xy.mul(set.normalStrength),
                sample.normalTS.z
              ) as unknown as Node<'vec3'>,
              getPlanarTangentFrame(null, space)
            )
          : normal;
        const albedo = sample.albedo.mul(tint) as Node<'vec3'>;
        const roughness = (sample.roughness ?? float(SNOW_ROUGHNESS))
          .mul(roughnessScale)
          .min(1) as Node<'float'>;
        // Into the far snow by its share
        const blend = <T>(near: T, member: string) =>
          far ? mix(near as never, out.get(member), far) : near;
        out.get('albedo').assign(blend(albedo, 'albedo'));
        out.get('roughness').assign(blend(roughness, 'roughness'));
        out.get('normal').assign(far ? mix(snowNormal, normal, far).normalize() : snowNormal);
        out.get('height').assign(blend(sample.height, 'height'));
      });
    });
    return out;
  }).once()();
  const snow = toVar(call) as unknown as StructVar;
  return {
    albedo: snow.get('albedo') as unknown as Node<'vec3'>,
    roughness: snow.get('roughness'),
    normal: snow.get('normal') as unknown as Node<'vec3'>,
    height: snow.get('height'),
    cover: snow.get('cover'),
    fringe: snow.get('fringe'),
  };
};
