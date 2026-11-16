// The terrain material's procedural rules (p305 D4; the type and its defaults are
// `aekasha/toolkit/geometry`'s `TerrainRule`, which p306's CPU evaluation shares): each rule's
// coverage from the geometry's slope and facing and the world height, moved by a macro noise
// channel and × its strength, composited over the incoming weights in order
// (`w = mix(w, onehot(layer), coverage)`). The weights stay raw: the height blend or the linear
// normalization (`HeightBlend.ts`) comes after.
import { acos, clamp, dot, float, max, mix, smoothstep, uniform, vec2 } from 'three/tsl';
// The real generic `Node<T>` typings (the `three/tsl` `Node` is a loose local shim)
import { Vector2, type Node, type TextureNode } from 'three/webgpu';
import { getSurfaceSpace, type SurfaceSpace } from './SurfaceSpace';
import type { TerrainRuleDefine } from '../material/TerrainDefine';

const RAD_TO_DEG = 180 / Math.PI;
/** A softness's floor: `smoothstep` with equal edges is undefined in WGSL and GLSL */
const MIN_SOFTNESS = 1e-4;
/**
 * The horizontal normal's lengths (sin of the slope: about 1.1° to 5.7°) over which the facing
 * test fades in: flat ground has no facing and passes
 */
const FLAT_FACING: [number, number] = [0.02, 0.1];
/** The noise channels' swizzles */
const CHANNELS = { R: 'r', G: 'g', B: 'b', A: 'a' } as const;

/** A range's uniforms: an end null where it's open (not built) */
type RangeNodes = { min: Node<'float'> | null; max: Node<'float'> | null; softness: Node<'float'> };

/** A rule's uniforms (`terrain_r<i>_<name>`), its tests' only, and its layer */
export type RuleNodes = {
  layer: number;
  slope: RangeNodes | null;
  height: RangeNodes | null;
  aspect: { direction: Node<'vec2'>; range: Node<'float'>; softness: Node<'float'> } | null;
  noise: {
    scale: Node<'float'>;
    amount: Node<'float'>;
    channel: keyof typeof CHANNELS;
  } | null;
  strength: Node<'float'>;
};

/** What the rules measure, built once for all of them */
export type RuleContext = {
  /** The surface's position in the material's space (the noise's point) */
  position: Node<'vec3'>;
  /** The geometry's slope in degrees, 0 flat */
  slope: Node<'float'>;
  /** The world height in metres */
  height: Node<'float'>;
  /** The geometry's world normal */
  normal: Node<'vec3'>;
  /** The macro texture the rules' noise reads, or null when no rule has noise */
  noiseTexture: TextureNode | null;
};

/**
 * A rule's uniforms, kept by `keep` under `<test><Name>` (`slopeMin`, `heightSoftness`,
 * `aspectDirection`, `noiseAmount`, `strength`, …): only its tests', a range's given ends only.
 * @internal
 * @param rule the rule as the define has it
 * @param keep keeps a uniform under the rule's name for it (`terrain_r<i>_<name>`)
 */
export const createRuleNodes = (
  rule: TerrainRuleDefine,
  keep: <T>(name: string, node: T) => T
): RuleNodes => {
  const number = (name: string, value: number) => keep(name, uniform(value)) as Node<'float'>;
  const range = (test: 'slope' | 'height') => {
    const given = rule[test];
    if (!given) return null;
    return {
      min: given.min === null ? null : number(`${test}Min`, given.min),
      max: given.max === null ? null : number(`${test}Max`, given.max),
      softness: number(`${test}Softness`, given.softness),
    };
  };
  const { aspect, noise } = rule;
  return {
    layer: rule.layer,
    slope: range('slope'),
    height: range('height'),
    aspect: aspect && {
      direction: keep('aspectDirection', uniform(new Vector2(...aspect.direction))) as Node<'vec2'>,
      range: number('aspectRange', aspect.range),
      softness: number('aspectSoftness', aspect.softness),
    },
    noise: noise && {
      scale: number('noiseScale', noise.scale),
      amount: number('noiseAmount', noise.amount),
      channel: noise.channel,
    },
    strength: number('strength', rule.strength),
  };
};

/**
 * What the rules measure: the slope in degrees from the geometry's normal (`acos` of its Y), the
 * height, the normal, in the material's space (the world's, or the mesh's own); built once before
 * the rules.
 * @internal
 * @param noiseTexture the macro texture the rules' noise reads, null without noise
 * @param space the material's space (default the world's)
 */
export const createRuleContext = (
  noiseTexture: TextureNode | null,
  space: SurfaceSpace = getSurfaceSpace()
): RuleContext => {
  const { normal, position } = space;
  return {
    slope: acos(clamp(normal.y, -1, 1)).mul(RAD_TO_DEG) as unknown as Node<'float'>,
    height: position.y as unknown as Node<'float'>,
    normal,
    position,
    noiseTexture,
  };
};

/** 1 within a range, fading to 0 over its softness past each given end */
const getRangeCoverage = (range: RangeNodes, value: Node<'float'>) => {
  const softness = max(range.softness, MIN_SOFTNESS) as unknown as Node<'float'>;
  const below = range.min && smoothstep(range.min.sub(softness), range.min, value);
  const above = range.max && float(1).sub(smoothstep(range.max, range.max.add(softness), value));
  if (below && above) return below.mul(above) as Node<'float'>;
  return (below ?? above) as Node<'float'>;
};

/**
 * 1 where the downhill direction (the normal's horizontal part) is within the range of the
 * facing, fading over its softness past it; 1 on flat ground, which has no facing
 */
const getAspectCoverage = (aspect: NonNullable<RuleNodes['aspect']>, normal: Node<'vec3'>) => {
  const horizontal = vec2(normal.x, normal.z) as unknown as Node<'vec2'>;
  const length = horizontal.length();
  const facing = horizontal.div(max(length, 1e-5)) as Node<'vec2'>;
  const cosine = clamp(dot(facing, aspect.direction.normalize()), -1, 1);
  const angle = acos(cosine).mul(RAD_TO_DEG) as unknown as Node<'float'>;
  const softness = max(aspect.softness, MIN_SOFTNESS) as unknown as Node<'float'>;
  const coverage = float(1).sub(smoothstep(aspect.range, aspect.range.add(softness), angle));
  return mix(float(1), coverage, smoothstep(...FLAT_FACING, length)) as unknown as Node<'float'>;
};

/**
 * A rule's coverage, 0..1: the product of its tests, moved by its noise (± `amount` about the
 * channel's middle, 0.5), clamped, × its strength.
 * @internal
 * @param rule the rule's uniforms
 * @param ctx what the rules measure ({@link createRuleContext})
 */
export const getRuleCoverage = (rule: RuleNodes, ctx: RuleContext): Node<'float'> => {
  const tests = [
    rule.slope && getRangeCoverage(rule.slope, ctx.slope),
    rule.height && getRangeCoverage(rule.height, ctx.height),
    rule.aspect && getAspectCoverage(rule.aspect, ctx.normal),
  ].filter((test): test is Node<'float'> => Boolean(test));
  let coverage = tests.length
    ? tests.reduce((product, test) => product.mul(test) as Node<'float'>)
    : (float(1) as unknown as Node<'float'>);
  if (rule.noise) {
    if (!ctx.noiseTexture) throw new Error('[terrain] A rule with noise needs the noise texture.');
    const point = vec2(ctx.position.x, ctx.position.z.negate()).div(rule.noise.scale);
    const sample = ctx.noiseTexture.sample(point) as unknown as Node<'vec4'>;
    const channel = sample[CHANNELS[rule.noise.channel]] as Node<'float'>;
    const shift = channel.sub(0.5).mul(2).mul(rule.noise.amount);
    coverage = clamp(coverage.add(shift), 0, 1) as unknown as Node<'float'>;
  }
  return coverage.mul(rule.strength) as Node<'float'>;
};

/**
 * The weights with the rules composited over them in order: each rule's layer takes its coverage
 * of every layer's weight (`w = mix(w, onehot(layer), coverage)`), so a later rule covers an
 * earlier one. Raw weights in, raw weights out (their sum kept).
 * @internal
 * @param weights the incoming weights, one per layer (the paint, or the base alone)
 * @param rules the rules' uniforms, in order
 * @param ctx what the rules measure ({@link createRuleContext})
 */
export const applyRules = (
  weights: Node<'float'>[],
  rules: RuleNodes[],
  ctx: RuleContext
): Node<'float'>[] =>
  rules.reduce((current, rule) => {
    const coverage = getRuleCoverage(rule, ctx);
    const keep = float(1).sub(coverage);
    return current.map((weight, i) =>
      i === rule.layer
        ? (weight.mul(keep).add(coverage) as Node<'float'>)
        : (weight.mul(keep) as Node<'float'>)
    );
  }, weights);
