// A generator run live (p304 D3's live mode, for p305's `PROCEDURAL_LIVE` layers): the same `build`
// a bake runs, in a material at a world-space point, its noise not periodic (`ctx.cells` gives no
// period), so the surface never repeats. Every covered pixel pays the whole graph every frame, and
// nothing filters it (no mips: fine detail shimmers at a distance), which is why the taps a bake
// takes for its normal and AO are opt-in here: by default the normal is the caller's bump from the
// height's screen-space derivatives (`bumpNormalView`), and there's no AO.
import { positionWorld, vec2 } from 'three/tsl';
// The real generic `Node<T>` typings (the `three/tsl` `Node` is a loose local shim)
import type { Node } from 'three/webgpu';
import { heightToCavity, heightToNormal } from '../nodes/noise/HeightMaps';
import { buildSurfaceGraph, type SurfaceGenerator } from './SurfaceGenerator';
import type { SurfaceParamSpecs, SurfaceParamValues } from './SurfaceParams';

/**
 * What {@link createLiveSurface} builds.
 * @template P the generator's param specs
 */
export type LiveSurfaceOpts<P extends SurfaceParamSpecs> = {
  /**
   * The point in tiles. Default: the world's `(x, −z)` over `physicalSize`, the tiling
   * `textureSetSurface` gives a baked set from above, so a live surface has a baked one's scale
   * and orientation. Give another for a mesh's UV in metres, a turned or scaled layer, or a
   * triplanar plane.
   */
  uv?: Node<'vec2'>;
  /** The seed its noise derives from, a whole number. Default 0. */
  seed?: number;
  /** The params' values; a param left out takes its default. */
  params?: SurfaceParamValues<P>;
  /** The metres one tile covers (a procedural set's `physicalSize`). Default the generator's. */
  physicalSize?: [number, number];
  /** The metres of relief a height of 1 stands for (a procedural set's `heightScale`). Default
   * the generator's. */
  heightScale?: number;
  /**
   * The normal when the generator's `build` gives none: `"NONE"` (default) leaves `normalTS` null,
   * for a bump from the height (`bumpNormalView`, no extra evaluation); `"TAPS"` takes a bake's
   * central differences (`heightToNormal`, 4 more evaluations of the height per pixel), a
   * 1024² texel apart.
   */
  normal?: 'NONE' | 'TAPS';
  /**
   * The AO when the generator's `build` gives none: `"NONE"` (default) leaves `ao` null;
   * `"CAVITY"` takes a bake's cavity (`heightToCavity`, 8 more evaluations of the height per
   * pixel).
   */
  ao?: 'NONE' | 'CAVITY';
};

/**
 * A generator's surface running live, from {@link createLiveSurface}: its values at the point,
 * named as `sampleTextureSet`'s (a `FULL` sample's: the AO apart from the albedo), and the
 * controls of its params and seed.
 * @template P the generator's param specs
 */
export type LiveSurface<P extends SurfaceParamSpecs = SurfaceParamSpecs> = {
  /** The generator it runs. */
  readonly generator: SurfaceGenerator<P>;
  /** The point in tiles the surface is built at: the UV for `transformTangentNormalToView`. */
  readonly uv: Node<'vec2'>;
  /** The albedo, linear colour, without the AO. */
  readonly albedo: Node<'vec3'>;
  /** The height, 0..1: × `heightScale` for metres. */
  readonly height: Node<'float'>;
  /** The roughness, 0..1. */
  readonly roughness: Node<'float'>;
  /** The tangent-space normal (OpenGL, +Y along +v), unit length: the generator's own, or the
   * taps' with `normal: "TAPS"`; else null (bump the height: `bumpNormalView`). */
  readonly normalTS: Node<'vec3'> | null;
  /** The ambient occlusion, 0..1 (1 open): the generator's own, or the cavity with
   * `ao: "CAVITY"`; else null. */
  readonly ao: Node<'float'> | null;
  /** Never: a live surface's albedo has no AO in it (`sampleTextureSet`'s field). */
  readonly isAoBaked: false;
  /** The metres one tile covers. */
  readonly physicalSize: [number, number];
  /** The metres of relief a height of 1 stands for. */
  readonly heightScale: number;
  /** The params' values in effect, every one given. */
  getParams: () => Required<SurfaceParamValues<P>>;
  /**
   * Sets params, seen by the next frame: numbers and colours only, a static param or toggle that
   * changes throws (create the surface again and set the material's nodes from it).
   */
  setParams: (values: SurfaceParamValues<P>) => void;
  /** The seed in effect. */
  getSeed: () => number;
  /** Sets the seed, seen by the next frame. */
  setSeed: (seed: number) => void;
};

/**
 * Runs a procedural surface generator live: its `build` as a graph for a material, at a
 * world-space point, with noise that isn't periodic. The surface never repeats and takes no
 * texture memory; every pixel it covers pays the whole graph every frame (ALU instead of fetches),
 * and nothing filters it at a distance. For comparison with the baked surface, large stylized
 * surfaces and p305's `PROCEDURAL_LIVE` layers; bake it (`bakeSurfaceGenerator`, a procedural set)
 * for anything seen close on low-end hardware.
 *
 * Its params' numbers and colours, and its seed, are uniforms: set them without a rebuild.
 * @template P the generator's param specs
 * @param generator the generator (`defineSurfaceGenerator`)
 * @param opts the point, the surface's values, and whether the normal and AO take a bake's taps
 * @returns the surface's nodes and its controls: assign the nodes to a material
 * @throws for a param the generator lacks or a value it refuses, a seed that isn't a whole
 * number, or physical facts out of range
 * @remarks Each call builds the graph again with uniforms of its own: keep the result, and call
 * once per material. A baked surface's whole-number rounding is off live (a count from a param in
 * metres is used as it is), so a live surface matches its bake in look, not texel for texel.
 * @example
 * ```ts
 * import type { MeshStandardNodeMaterial } from 'three/webgpu';
 * import {
 *   bumpNormalView,
 *   createLiveSurface,
 *   sandRipples,
 *   transformTangentNormalToView,
 * } from 'aekasha/toolkit/terrain';
 *
 * export const shadeLiveSand = (material: MeshStandardNodeMaterial) => {
 *   const sand = createLiveSurface(sandRipples, { seed: 7, params: { wavelength: 0.12 } });
 *   material.colorNode = sand.albedo;
 *   material.roughnessNode = sand.roughness;
 *   material.normalNode = sand.normalTS
 *     ? transformTangentNormalToView(sand.normalTS, sand.uv)
 *     : bumpNormalView(sand.height.mul(sand.heightScale));
 *   return sand;
 * };
 * ```
 */
export const createLiveSurface = <P extends SurfaceParamSpecs>(
  generator: SurfaceGenerator<P>,
  opts: LiveSurfaceOpts<P> = {}
): LiveSurface<P> => {
  const size = opts.physicalSize ?? generator.physicalSize;
  const uv =
    opts.uv ??
    (vec2(positionWorld.x, positionWorld.z.negate()).div(
      vec2(size[0], size[1])
    ) as unknown as Node<'vec2'>);
  const graph = buildSurfaceGraph(generator, {
    uv,
    isLive: true,
    params: opts.params,
    seed: opts.seed,
    physicalSize: opts.physicalSize,
    heightScale: opts.heightScale,
  });
  const { surface, ctx, params, seed, physicalSize, heightScale, tapHeight } = graph;
  const normalTS =
    surface.normal ??
    (opts.normal === 'TAPS'
      ? heightToNormal(tapHeight, {
          uv,
          texel: ctx.texel,
          heightScale: heightScale / physicalSize[0],
        })
      : null);
  const ao =
    surface.ao ??
    (opts.ao === 'CAVITY'
      ? heightToCavity(tapHeight, {
          uv,
          radius: generator.cavity.radius / physicalSize[0],
          strength: generator.cavity.strength,
        })
      : null);
  return {
    generator,
    uv,
    albedo: surface.albedo,
    height: surface.height,
    roughness: surface.roughness,
    normalTS,
    ao,
    isAoBaked: false,
    physicalSize,
    heightScale,
    getParams: () => params.values,
    setParams: (values) => params.set(values),
    getSeed: () => seed.value,
    setSeed: (value) => {
      if (!Number.isInteger(value)) {
        throw new Error(`[${generator.id}] The live surface's seed ${value} isn't a whole number.`);
      }
      seed.value = value >>> 0;
    },
  };
};
