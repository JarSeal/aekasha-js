// Procedural decal generators (p309 D5): a decal's albedo, opacity, height, roughness and puddle
// mask as a TSL graph of a point over the decal, baked into the `DECAL` packing's two slots (p309
// D1: `albedoAlpha`, `normalRough`) and exported as an atlas cell's PNGs. Built on p304's surface
// generators' parts: the params as uniforms (`SurfaceParams.ts`), the context's `cells` and `seed`,
// and the default normal from the height through one layout function (`buildSurfaceGraph`). Not a
// surface generator: a decal has an opacity and a puddle mask, fades out at its edges instead of
// tiling, and is never a texture set (so its module isn't a gathered `<id>.generator.ts`).
import { float, vec4 } from 'three/tsl';
// The real generic `Node<T>` typings (the `three/tsl` `Node` is a loose local shim)
import type { Node, UniformNode } from 'three/webgpu';
import type { BakeBuildContext, BakeOutput } from 'aekasha';
import { heightToNormal } from '../nodes/noise/HeightMaps';
import {
  buildSurfaceGraph,
  checkSurfaceFacts,
  type SurfaceBuildContext,
  type SurfaceGraphSource,
} from '../procedural/SurfaceGenerator';
import {
  checkSurfaceParamSpecs,
  type SurfaceParamNodes,
  type SurfaceParamsBuild,
  type SurfaceParamSpecs,
  type SurfaceParamValues,
} from '../procedural/SurfaceParams';

/** A decal's values at a point, as a decal generator's `build` returns them. */
export type DecalOutputs = {
  /**
   * The albedo, linear colour. **Give it over the whole decal**, where the opacity is 0 too: the
   * atlas stores straight alpha, and its padding, mips and filtering mix a transparent texel's
   * colour into the decal's edge (a black surround darkens it).
   */
  albedo: Node<'vec3'>;
  /** The opacity, 0..1: 0 at the decal's edges, so its quad never shows. */
  opacity: Node<'float'>;
  /** The height, 0..1 (the generator's `heightScale` metres at 1): the default normal's. */
  height: Node<'float'>;
  /** The roughness, 0..1. */
  roughness: Node<'float'>;
  /** Where water collects first, 0..1 (the decal material lowers its relief by it, so a rut or a
   * print fills before the ground around it). Default 0. */
  puddle?: Node<'float'>;
  /** The tangent-space normal (OpenGL, +Y along +v), unit length. Default: the height's
   * (`heightToNormal`, `heightScale` over the decal's width). */
  normal?: Node<'vec3'>;
};

/**
 * What a decal generator's `build` reads: the point over the decal (`uv`, 0..1 across it, v up
 * the decal), `tileSize` the decal's size in metres, and the helpers of a surface generator's
 * context (`cells`, `seed`, `texel`). Its noise is periodic over the decal, which does no harm:
 * a decal fades out before its edges.
 */
export type DecalBuildContext = Omit<SurfaceBuildContext, 'isLive'>;

/**
 * What {@link defineDecalGenerator} takes.
 * @template P the param specs
 */
export type DecalGeneratorDef<P extends SurfaceParamSpecs> = {
  /** The generator's id, which an atlas cell's `data.generator` names. */
  id: string;
  /** What the decal is, for the debug tools and the Hub. */
  description?: string;
  /** The params by name (see `SurfaceParamSpec`): numbers and colours are uniforms, so a change
   * rebakes without a rebuild. */
  params: P;
  /** The decal's size in metres when a bake gives none (an atlas cell's `physicalSize`):
   * `ctx.tileSize`, and the default normal's width. */
  physicalSize: [number, number];
  /** The metres of relief a height of 1 stands for: the default normal's depth. */
  heightScale: number;
  /** The decal at `ctx.uv`. Called again for the default normal's taps (with another uv), so it
   * must build the decal from the context and the params alone. */
  build: (ctx: DecalBuildContext, params: SurfaceParamNodes<P>) => DecalOutputs;
};

/**
 * A procedural decal generator, from {@link defineDecalGenerator}.
 * @template P the param specs
 */
export type DecalGenerator<P extends SurfaceParamSpecs = SurfaceParamSpecs> = Readonly<
  Required<Omit<DecalGeneratorDef<P>, 'description'>>
> & {
  readonly description: string;
};

// p309 D1
/**
 * The `DECAL` packing's slots as bake outputs: `albedoAlpha` sRGB, `normalRough` linear.
 * @internal
 */
export const DECAL_BAKE_OUTPUTS: readonly BakeOutput[] = [
  { name: 'albedoAlpha', colorSpace: 'SRGB' },
  { name: 'normalRough', colorSpace: 'LINEAR' },
];

const saturate = (node: Node<'float'>) => node.clamp(0, 1) as Node<'float'>;

/**
 * Packs a decal's values into the `DECAL` slots: `albedoAlpha` (RGB albedo, A opacity) and
 * `normalRough` (RG the normal's X and Y in 0..1, B roughness, A the puddle mask), each value
 * clamped to 0..1.
 * @internal
 */
export const packDecalOutputs = (
  decal: Omit<DecalOutputs, 'normal'> & { normal: Node<'vec3'> }
): Record<'albedoAlpha' | 'normalRough', Node<'vec4'>> => {
  const albedo = decal.albedo.clamp(0, 1) as Node<'vec3'>;
  const normalXY = decal.normal.xy.mul(0.5).add(0.5).clamp(0, 1) as Node<'vec2'>;
  const puddle = decal.puddle ? saturate(decal.puddle) : (float(0) as unknown as Node<'float'>);
  return {
    albedoAlpha: vec4(albedo, saturate(decal.opacity)) as unknown as Node<'vec4'>,
    normalRough: vec4(normalXY, saturate(decal.roughness), puddle) as unknown as Node<'vec4'>,
  };
};

/**
 * A decal generator built into the `DECAL` slots for one bake: the graphs and the controls of its
 * params and seed.
 * @internal
 */
export type DecalPackingBuild<P extends SurfaceParamSpecs> = {
  nodes: Record<'albedoAlpha' | 'normalRough', Node<'vec4'>>;
  params: SurfaceParamsBuild<P>;
  seed: UniformNode<'uint', number>;
};

/**
 * Builds a decal generator into the `DECAL` slots at a bake's uv: the params and the seed as
 * uniforms, the default normal from the height filled in.
 * @internal
 * @throws for a param the generator lacks or a value it refuses, a seed that isn't a whole
 * number, or physical facts out of range
 */
export const buildDecalPacking = <P extends SurfaceParamSpecs>(
  generator: DecalGenerator<P>,
  bakeCtx: BakeBuildContext,
  opts: {
    params?: SurfaceParamValues<P>;
    seed?: number;
    physicalSize?: [number, number];
    heightScale?: number;
  } = {}
): DecalPackingBuild<P> => {
  // A decal's build takes the context less `isLive`, so it's a graph source as it is
  const source: SurfaceGraphSource<P, DecalOutputs> = generator;
  const graph = buildSurfaceGraph(source, { uv: bakeCtx.uv, isLive: false, ...opts });
  const { surface, ctx, params, seed, physicalSize, heightScale, tapHeight } = graph;
  const normal =
    surface.normal ??
    heightToNormal(tapHeight, {
      uv: ctx.uv,
      texel: bakeCtx.texel,
      heightScale: heightScale / physicalSize[0],
    });
  return { nodes: packDecalOutputs({ ...surface, normal }), params, seed };
};

// p309 D5
/**
 * Defines a procedural decal generator: a decal's albedo, opacity, height, roughness
 * and puddle mask as a TSL graph of a point over the decal (`ctx.uv`, 0..1 across it). Bake it
 * into the `DECAL` packing's slots with `bakeDecalGenerator`, and export the bake as an atlas
 * cell's PNGs (`exportBakedTexture`).
 *
 * Fade the opacity out before the decal's edges, and give the albedo over the whole decal (see
 * {@link DecalOutputs}). Noise goes through `ctx.cells(n)` and `ctx.seed(i)`, as in a surface
 * generator.
 * @template P the param specs (inferred: `as const` isn't needed)
 * @param def the id, params, default physical facts and `build`
 * @returns the generator, for `bakeDecalGenerator`
 * @throws for a missing id, a param default its own spec refuses, or physical facts out of range
 * @example
 * ```ts
 * import { float, length, mix, smoothstep } from 'three/tsl';
 * import type { Node } from 'three/webgpu';
 * import { defineDecalGenerator, fbm } from 'aekasha/toolkit/terrain';
 *
 * export const oilStain = defineDecalGenerator({
 *   id: 'oilStain',
 *   physicalSize: [1, 1],
 *   heightScale: 0.002,
 *   params: {
 *     color: { type: 'color', default: '#1a1612' },
 *     density: { default: 0.8, min: 0, max: 1 },
 *   },
 *   build: (ctx, params) => {
 *     const { p, period } = ctx.cells(4);
 *     const wobble = fbm(p, { period, octaves: 4, seed: ctx.seed() }).mul(0.15);
 *     const radius = length(ctx.uv.sub(0.5)).add(wobble);
 *     // 1 inside, 0 from 0.45 of the decal's width out from its centre
 *     const blot = float(1).sub(smoothstep(0.25, 0.45, radius)) as Node<'float'>;
 *     return {
 *       albedo: params.color,
 *       opacity: blot.mul(params.density) as Node<'float'>,
 *       height: float(0.5) as Node<'float'>,
 *       roughness: mix(float(0.9), float(0.3), blot) as Node<'float'>,
 *     };
 *   },
 * });
 * ```
 */
export const defineDecalGenerator = <const P extends SurfaceParamSpecs>(
  def: DecalGeneratorDef<P>
): DecalGenerator<P> => {
  if (!def.id) throw new Error('[defineDecalGenerator] A generator needs an id.');
  checkSurfaceParamSpecs(def.id, def.params);
  checkSurfaceFacts(def.id, def.physicalSize, def.heightScale);
  return {
    id: def.id,
    description: def.description ?? '',
    params: def.params,
    physicalSize: def.physicalSize,
    heightScale: def.heightScale,
    build: def.build,
  };
};
