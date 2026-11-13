// Procedural surface generators (p304 D3): a surface (albedo, height, roughness, optionally AO and
// a normal) as a TSL graph of a point in tiles, built once and run two ways. Baked, its noise is
// periodic over the tile and the surface is packed into a texture set packing (`buildPacking`, the
// engine's `TextureSetGenerator`, so a procedural set's JSON names it); live (`LiveSurface.ts`),
// the same `build` runs in a material in world space, the noise not periodic.
//
// A generator writes its noise in cells through `ctx.cells(n)`, which gives the point and the
// period for either way, so it never branches on the mode. The defaults: a normal from the height
// by central differences (`heightToNormal`), an AO from its cavity (`heightToCavity`), both of the
// height at other points. That height is one layout function (`aekSurfaceHeight…`) the taps call,
// with the uniforms as its inputs: three caches a layout function's code per backend, so a body
// that read a uniform itself would lose the uniform's declaration in the next shader built with it.
import { Fn, max, round, uint, uniform, vec2 } from 'three/tsl';
// The real generic `Node<T>` typings (the `three/tsl` `Node` is a loose local shim)
import type { Node, UniformNode } from 'three/webgpu';
import type { BakeBuildContext } from 'aekasha';
import type {
  TextureSetCategory,
  TextureSetGenerator,
  TextureSetGeneratorBuildOpts,
} from 'aekasha/texturesets';
import { heightToCavity, heightToNormal, type HeightFunction } from '../nodes/noise/HeightMaps';
import type { NoisePeriod } from '../nodes/noise/Period';
import { doesPackingStoreNormal, packSurfaceOutputs } from './PackSurface';
import {
  buildSurfaceParams,
  checkSurfaceParamSpecs,
  type SurfaceParamNodes,
  type SurfaceParamsBuild,
  type SurfaceParamSpecs,
  type SurfaceParamValues,
} from './SurfaceParams';

/** A surface's values at a point, as a generator's `build` returns them. */
export type SurfaceOutputs = {
  /** The albedo, linear colour. */
  albedo: Node<'vec3'>;
  /** The height, 0..1 (the set's `heightScale` metres at 1). */
  height: Node<'float'>;
  /** The roughness, 0..1. */
  roughness: Node<'float'>;
  /** The ambient occlusion, 0..1 (1 open). Default: the height's cavity (`heightToCavity`). */
  ao?: Node<'float'>;
  /** The tangent-space normal (OpenGL, +Y along +v), unit length. Default: the height's
   * (`heightToNormal`, the set's `heightScale` over its tile's width). */
  normal?: Node<'vec3'>;
};

/** A point in cells and the period that makes noise there tile, from {@link SurfaceBuildContext}'s
 * `cells`: pass both to a noise (`fbm(p, { period, … })`). */
export type SurfaceCells = {
  /** The point in cells: the context's uv × the count. */
  p: Node<'vec2'>;
  /** The count when baked (the noise tiles over the tile), 0 when live (it never repeats). */
  period: NoisePeriod;
};

/** A cell count per tile: one for both axes or a pair, a number or a node (see
 * {@link SurfaceBuildContext}'s `cells`). */
export type SurfaceCellCount = number | [number, number] | Node<'float'> | Node<'vec2'>;

/** What a generator's `build` reads: the point, and the helpers that keep its noise tiling. */
export type SurfaceBuildContext = {
  /** The point in tiles: a baked texture's uv (0..1 over the tile), or live the world's position
   * over the tile's size. */
  uv: Node<'vec2'>;
  /** Whether the surface runs live in a material (no periods: nothing repeats). */
  isLive: boolean;
  /** The metres one tile covers (for params in metres: `tileSize.x / wavelength` cells). */
  tileSize: Node<'vec2'>;
  /** One texel's size in uv when baked (its own central differences); live, a 1024² texel. */
  texel: Node<'vec2'>;
  /**
   * The point in `count` cells per tile and the period that tiles them: a whole number, or a pair
   * for cells longer on one axis (baked, a fraction throws), or a float or vec2 node (a param:
   * rounded to a whole number at least 1 in the shader when baked).
   */
  cells: (count: SurfaceCellCount) => SurfaceCells;
  /** The surface's seed, or with an index another one derived from it (one per noise, so two
   * noises of the surface don't match). */
  seed: (index?: number) => Node<'uint'>;
};

/**
 * What {@link defineSurfaceGenerator} takes.
 * @template P the param specs
 */
export type SurfaceGeneratorDef<P extends SurfaceParamSpecs> = {
  /** The generator's id, which a procedural set's JSON names: its module is `<id>.generator.ts`. */
  id: string;
  /** The surface's category. */
  category: TextureSetCategory;
  /** What the surface is, for the debug tools and the Hub. */
  description?: string;
  /** The params by name (see `SurfaceParamSpec`). */
  params: P;
  /** The metres one tile covers when a bake gives none, `[width, height]`. */
  physicalSize: [number, number];
  /** The metres of relief a height of 1 stands for when a bake gives none. */
  heightScale: number;
  /** The default AO's ring (`heightToCavity`): its radius in metres (default 0.03) and strength
   * (default 4). */
  cavity?: { radius?: number; strength?: number };
  /**
   * The surface at `ctx.uv`. Called again for the default normal's and AO's taps (with another
   * uv), so it must build the surface from the context and the params alone.
   */
  build: (ctx: SurfaceBuildContext, params: SurfaceParamNodes<P>) => SurfaceOutputs;
};

/**
 * A procedural surface generator, from {@link defineSurfaceGenerator}: the engine's
 * `TextureSetGenerator` (a procedural set's bake) with its definition.
 * @template P the param specs
 */
export type SurfaceGenerator<P extends SurfaceParamSpecs = SurfaceParamSpecs> =
  TextureSetGenerator &
    Readonly<Required<Omit<SurfaceGeneratorDef<P>, 'description' | 'cavity'>>> & {
      readonly description: string;
      /** The default AO's ring, every field given. */
      readonly cavity: { radius: number; strength: number };
    };

/**
 * A generator's surface built into a packing's slots for one bake: the graphs and the controls of
 * its params and seed.
 * @internal
 */
export type SurfacePackingBuild<P extends SurfaceParamSpecs> = {
  nodes: Record<string, Node<'vec4'>>;
  params: SurfaceParamsBuild<P>;
  seed: UniformNode<'uint', number>;
};

/** Each derived seed steps by this (odd, so 2³² steps before one repeats). */
const SEED_STRIDE = 0x6c8e9cf5;
/** Live, the context's texel: a 1024² texture's. */
const LIVE_TEXEL = 1 / 1024;
const DEFAULT_CAVITY = { radius: 0.03, strength: 4 };

/** The height functions built so far: each gets a name of its own (two in one shader would clash). */
let heightFunctionCount = 0;

const checkWhole = (value: number, what: string, generatorId: string) => {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`[${generatorId}] ${what} ${value} isn't a whole number (0 or more).`);
  }
};

const checkFacts = (generatorId: string, physicalSize: [number, number], heightScale: number) => {
  if (!(physicalSize[0] > 0) || !(physicalSize[1] > 0)) {
    throw new Error(
      `[${generatorId}] physicalSize ${JSON.stringify(physicalSize)} takes two sizes above 0 (metres).`
    );
  }
  if (!(heightScale >= 0)) {
    throw new Error(`[${generatorId}] heightScale ${heightScale} takes 0 or more (metres).`);
  }
};

/**
 * A surface's build context at a point.
 * @internal
 */
export const createSurfaceContext = (opts: {
  generatorId: string;
  uv: Node<'vec2'>;
  isLive: boolean;
  tileSize: Node<'vec2'>;
  texel?: Node<'vec2'>;
  seed: Node<'uint'>;
}): SurfaceBuildContext => {
  const { generatorId, uv, isLive, seed } = opts;
  return {
    uv,
    isLive,
    tileSize: opts.tileSize,
    texel: opts.texel ?? (vec2(LIVE_TEXEL, LIVE_TEXEL) as unknown as Node<'vec2'>),
    cells: (count) => {
      if (typeof count === 'number' || Array.isArray(count)) {
        const [x, y] = typeof count === 'number' ? [count, count] : count;
        const shown = JSON.stringify(count);
        if (!(x > 0) || !(y > 0)) {
          throw new Error(`[${generatorId}] cells(${shown}): the count takes numbers above 0.`);
        }
        const scale = vec2(x, y) as unknown as Node<'vec2'>;
        if (isLive) return { p: uv.mul(scale) as Node<'vec2'>, period: 0 };
        if (!Number.isInteger(x) || !Number.isInteger(y)) {
          throw new Error(
            `[${generatorId}] cells(${shown}): a baked surface tiles over a whole number of cells only.`
          );
        }
        return { p: uv.mul(scale) as Node<'vec2'>, period: [x, y] };
      }
      // A float node splats to both axes
      const scale = vec2(count as Node<'vec2'>) as unknown as Node<'vec2'>;
      if (isLive) return { p: uv.mul(scale) as Node<'vec2'>, period: 0 };
      const whole = max(round(scale), vec2(1, 1)) as unknown as Node<'vec2'>;
      return { p: uv.mul(whole) as Node<'vec2'>, period: whole };
    },
    seed: (index = 0) => {
      checkWhole(index, 'The seed index', generatorId);
      if (index === 0) return seed;
      return seed.add(uint(Math.imul(index, SEED_STRIDE) >>> 0)) as Node<'uint'>;
    },
  };
};

type HeightInput = { name: string; type: string; node: Node };

/**
 * The surface's height at any uv, as one layout function the taps call: the uniforms (the float
 * and colour params and the seed) are its inputs, so its body reads no uniform of its own.
 */
const createHeightFunction = <P extends SurfaceParamSpecs>(
  def: SurfaceGeneratorDef<P>,
  params: SurfaceParamsBuild<P>,
  base: Omit<Parameters<typeof createSurfaceContext>[0], 'uv' | 'seed'>,
  seed: Node<'uint'>
): HeightFunction => {
  const inputs: HeightInput[] = [{ name: 'seed', type: 'uint', node: seed }];
  for (const [name, node] of Object.entries(params.nodes as Record<string, unknown>)) {
    if (typeof node !== 'object') continue;
    const spec = def.params[name];
    inputs.push({
      name: `p_${name}`,
      type: spec.type === 'color' ? 'vec3' : 'float',
      node: node as Node,
    });
  }
  const heightFn = Fn(
    ([uv, ...args]: Node[]) => {
      const nodes: Record<string, unknown> = { ...(params.nodes as Record<string, unknown>) };
      inputs.slice(1).forEach((input, i) => {
        nodes[input.name.slice(2)] = args[i + 1];
      });
      const ctx = createSurfaceContext({
        ...base,
        uv: uv as Node<'vec2'>,
        seed: args[0] as Node<'uint'>,
      });
      return def.build(ctx, nodes as SurfaceParamNodes<P>).height;
    },
    {
      name: `aekSurfaceHeight_${def.id.replace(/\W/g, '_')}_${heightFunctionCount++}`,
      type: 'float',
      inputs: [{ name: 'uv', type: 'vec2' }, ...inputs.map(({ name, type }) => ({ name, type }))],
    }
  );
  const nodes = inputs.map((input) => input.node);
  return (at) => heightFn(at, ...nodes) as unknown as Node<'float'>;
};

/**
 * What {@link buildSurfaceGraph} builds: where the surface runs and its values.
 * @internal
 */
export type SurfaceGraphOpts<P extends SurfaceParamSpecs> = {
  /** The point in tiles. */
  uv: Node<'vec2'>;
  /** Live in a material (no periods), or baked. */
  isLive: boolean;
  /** One texel in uv (a bake's); left out live. */
  texel?: Node<'vec2'>;
  params?: SurfaceParamValues<P>;
  seed?: number;
  physicalSize?: [number, number];
  heightScale?: number;
};

/**
 * A generator's surface built at a point, baked or live: its values as `build` returned them, the
 * controls, and the height at any other uv for the default normal's and AO's taps.
 * @internal
 */
export type SurfaceGraph<P extends SurfaceParamSpecs> = {
  surface: SurfaceOutputs;
  /** The build context of the point. */
  ctx: SurfaceBuildContext;
  params: SurfaceParamsBuild<P>;
  seed: UniformNode<'uint', number>;
  /** The facts in effect (the given ones, else the generator's). */
  physicalSize: [number, number];
  heightScale: number;
  /** The height at a uv: the surface's own at the point's, else the layout function (made on
   * its first call, so a surface without taps has none). */
  tapHeight: HeightFunction;
};

/**
 * Builds a generator's surface at a point, the params and the seed as uniforms: the shared first
 * step of a bake (`buildSurfacePacking`) and of the live mode (`createLiveSurface`).
 * @internal
 * @throws for a param the generator lacks or a value it refuses, a seed that isn't a whole
 * number, or physical facts out of range
 */
export const buildSurfaceGraph = <P extends SurfaceParamSpecs>(
  generator: SurfaceGenerator<P>,
  opts: SurfaceGraphOpts<P>
): SurfaceGraph<P> => {
  const { id } = generator;
  const physicalSize = opts.physicalSize ?? generator.physicalSize;
  const heightScale = opts.heightScale ?? generator.heightScale;
  checkFacts(id, physicalSize, heightScale);
  const seedValue = opts.seed ?? 0;
  checkWhole(seedValue, 'The seed', id);
  const params = buildSurfaceParams(id, generator.params, opts.params);
  const seed = uniform(seedValue >>> 0, 'uint') as unknown as UniformNode<'uint', number>;
  const seedNode = seed as unknown as Node<'uint'>;
  const base = {
    generatorId: id,
    isLive: opts.isLive,
    tileSize: vec2(physicalSize[0], physicalSize[1]) as unknown as Node<'vec2'>,
    texel: opts.texel,
  };
  const ctx = createSurfaceContext({ ...base, uv: opts.uv, seed: seedNode });
  const surface = generator.build(ctx, params.nodes);

  let heightAt: HeightFunction | null = null;
  // The taps' height; the point's own is the surface's (the cavity reads it once more)
  const tapHeight: HeightFunction = (at) => {
    if (at === ctx.uv) return surface.height;
    heightAt ??= createHeightFunction(generator, params, base, seedNode);
    return heightAt(at);
  };
  return { surface, ctx, params, seed, physicalSize, heightScale, tapHeight };
};

/**
 * Builds a generator's surface into a packing's slots for one bake: the params and the seed as
 * uniforms, the surface at the bake's uv with the default normal (`FULL`, `LITE`) and AO filled
 * in, packed by {@link packSurfaceOutputs}.
 * @internal
 */
export const buildSurfacePacking = <P extends SurfaceParamSpecs>(
  generator: SurfaceGenerator<P>,
  bakeCtx: BakeBuildContext,
  opts: Omit<TextureSetGeneratorBuildOpts, 'params' | 'physicalSize' | 'heightScale'> & {
    params?: SurfaceParamValues<P>;
    physicalSize?: [number, number];
    heightScale?: number;
  }
): SurfacePackingBuild<P> => {
  const graph = buildSurfaceGraph(generator, {
    uv: bakeCtx.uv,
    isLive: false,
    texel: bakeCtx.texel,
    params: opts.params,
    seed: opts.seed,
    physicalSize: opts.physicalSize,
    heightScale: opts.heightScale,
  });
  const { surface, ctx, params, seed, physicalSize, heightScale, tapHeight } = graph;
  const normal =
    surface.normal ??
    (doesPackingStoreNormal(opts.packing)
      ? heightToNormal(tapHeight, {
          uv: ctx.uv,
          texel: bakeCtx.texel,
          heightScale: heightScale / physicalSize[0],
        })
      : undefined);
  const ao =
    surface.ao ??
    heightToCavity(tapHeight, {
      uv: ctx.uv,
      radius: generator.cavity.radius / physicalSize[0],
      strength: generator.cavity.strength,
    });
  const nodes = packSurfaceOutputs({ ...surface, normal, ao }, opts.packing);
  return { nodes, params, seed };
};

/**
 * Defines a procedural surface generator (p304 D3): a surface's albedo, height and roughness
 * (optionally its AO and normal) as a TSL graph of a point in tiles. Bake it into a texture set
 * packing (`bakeSurfaceGenerator`, or a procedural set's JSON naming its id), or run it live in a
 * material (`createLiveSurface`).
 *
 * Write the noise in cells through `ctx.cells(n)` (`n` cells per tile) and pass its `period` on:
 * baked, the noise tiles over the tile; live, the same graph never repeats. Each noise takes its
 * own `ctx.seed(i)`. The params' uniforms change without a rebuild (`setParams`, then `rebake`).
 * @template P the param specs (inferred: `as const` isn't needed)
 * @param def the id, category, params, default physical facts and `build`
 * @returns the generator: what a `<id>.generator.ts` module exports as `generator`
 * @throws for a param default its own spec refuses, or physical facts out of range
 * @example
 * ```ts
 * import { mix, smoothstep } from 'three/tsl';
 * import { defineSurfaceGenerator, fbm } from 'aekasha/toolkit/terrain';
 *
 * export const generator = defineSurfaceGenerator({
 *   id: 'dunes',
 *   category: 'SAND',
 *   physicalSize: [4, 4],
 *   heightScale: 0.05,
 *   params: {
 *     scale: { default: 6, min: 1, max: 32, isStatic: true, isInteger: true },
 *     light: { type: 'color', default: '#d9c49a' },
 *     dark: { type: 'color', default: '#a88a5c' },
 *   },
 *   build: (ctx, params) => {
 *     const { p, period } = ctx.cells(params.scale);
 *     const height = fbm(p, { period, octaves: 5, seed: ctx.seed() }).mul(0.5).add(0.5);
 *     return {
 *       albedo: mix(params.dark, params.light, smoothstep(0.3, 0.7, height)),
 *       height,
 *       roughness: height.mul(-0.1).add(0.95),
 *     };
 *   },
 * });
 * ```
 */
export const defineSurfaceGenerator = <const P extends SurfaceParamSpecs>(
  def: SurfaceGeneratorDef<P>
): SurfaceGenerator<P> => {
  if (!def.id) throw new Error('[defineSurfaceGenerator] A generator needs an id.');
  checkSurfaceParamSpecs(def.id, def.params);
  checkFacts(def.id, def.physicalSize, def.heightScale);
  const generator: SurfaceGenerator<P> = {
    id: def.id,
    category: def.category,
    description: def.description ?? '',
    params: def.params,
    physicalSize: def.physicalSize,
    heightScale: def.heightScale,
    cavity: { ...DEFAULT_CAVITY, ...def.cavity },
    build: def.build,
    buildPacking: (ctx, opts) =>
      buildSurfacePacking(generator, ctx, {
        ...opts,
        params: opts.params as SurfaceParamValues<P> | undefined,
      }).nodes,
  };
  return generator;
};
