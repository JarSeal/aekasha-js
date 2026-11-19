// A generator baked from code (p304 D3): its surface packed into a texture set packing's slots by
// one `bakeTexture` (several slots: one MRT render), the textures registered as `<id>.<slot>`, with
// the controls of its params and seed for a rebake. A procedural set's JSON is baked by the
// `textureSets()` feature through the generator's `buildPacking` instead (the same graphs).
import type * as THREE from 'three/webgpu';
// The real generic `Node<T>` typings (the `three/tsl` `Node` is a loose local shim)
import type { Node, UniformNode } from 'three/webgpu';
import {
  bakeTexture,
  type BakeBuildContext,
  type BakedTexture,
  type BakeTextureOpts,
} from 'aekasha';
import type { TextureSetPacking } from 'aekasha/texturesets';
import { getSurfacePackingOutputs } from './PackSurface';
import { buildSurfacePacking, type SurfaceGenerator } from './SurfaceGenerator';
import type { SurfaceParamsBuild, SurfaceParamSpecs, SurfaceParamValues } from './SurfaceParams';

/**
 * What {@link bakeSurfaceGenerator} bakes.
 * @template P the generator's param specs
 */
export type BakeSurfaceGeneratorOpts<P extends SurfaceParamSpecs> = {
  /** The bake's id: each slot's texture is registered as `<id>.<slot>`. */
  id: string;
  /** The generator (`defineSurfaceGenerator`). */
  generator: SurfaceGenerator<P>;
  /** The packing whose slots it writes. Default `LITE` (the terrain default). */
  packing?: TextureSetPacking;
  /** Width and height in texels, one number for a square. Default 1024. */
  size?: number | [number, number];
  /** The seed its noise derives from, a whole number. Default 0. */
  seed?: number;
  /** The params' values; a param left out takes its default. */
  params?: SurfaceParamValues<P>;
  /** The metres one tile covers. Default the generator's. */
  physicalSize?: [number, number];
  /** The metres of relief a height of 1 stands for (the normal's depth). Default the
   * generator's. */
  heightScale?: number;
  /** The textures' anisotropic filtering, or `MAX`. Default 1. */
  anisotropy?: number | 'MAX';
  /** Never released with its scene. */
  isPersistent?: boolean;
};

/**
 * A baked generator, from {@link bakeSurfaceGenerator}: the bake and the controls of its params.
 * @template P the generator's param specs
 */
export type BakedSurface<P extends SurfaceParamSpecs = SurfaceParamSpecs> = {
  /** The bake: `textures` by slot name, `rebake()`, `dispose()`. */
  readonly bake: BakedTexture;
  /** The packing it holds. */
  readonly packing: TextureSetPacking;
  /** The generator it bakes. */
  readonly generator: SurfaceGenerator<P>;
  /** The params' values in effect, every one given. */
  getParams: () => Required<SurfaceParamValues<P>>;
  /**
   * Sets params for the next render (call `bake.rebake()` after): numbers and colours only, a
   * static param or toggle that changes throws (bake again under a new id).
   */
  setParams: (values: SurfaceParamValues<P>) => void;
  /** The seed in effect. */
  getSeed: () => number;
  /** Sets the seed for the next render (call `bake.rebake()` after). */
  setSeed: (seed: number) => void;
};

/** The baked surfaces by id, from their call (a second call while one bakes shares it): a call
 * returns an id's surface while its bake is alive. */
const surfaces = new Map<string, Promise<BakedSurface>>();

/**
 * A bake's controls: the uniforms of its graph's params and seed.
 * @internal
 */
export type BakeControls<P extends SurfaceParamSpecs> = {
  params: SurfaceParamsBuild<P>;
  seed: UniformNode<'uint', number>;
};

/**
 * A bake with the controls of its params and seed: what a baked surface and a baked decal share.
 * @internal
 */
export type ControlledBake<P extends SurfaceParamSpecs> = Pick<
  BakedSurface<P>,
  'bake' | 'getParams' | 'setParams' | 'getSeed' | 'setSeed'
>;

/**
 * Starts a bake whose `build` makes the graphs with their params and seed as uniforms, and returns
 * it with their setters once rendered. `bakeTexture` builds the graph before it returns, so the
 * controls exist once it has (none: it returned a bake of the id that isn't the caller's kind).
 * @internal
 * @param opts the public function and what it bakes (the errors name both), the bake's options
 * but its graphs, and `build`: the graphs by output name, with the controls
 * @returns the bake and its controls
 * @throws (rejects) for an id whose live bake isn't one `build` made, a seed that isn't a whole
 * number (`setSeed`), or what `bakeTexture` refuses
 */
export const startControlledBakeAsync = async <P extends SurfaceParamSpecs>(opts: {
  caller: string;
  kind: string;
  bakeOpts: Omit<BakeTextureOpts, 'build'>;
  build: (ctx: BakeBuildContext) => BakeControls<P> & { nodes: Record<string, Node<'vec4'>> };
}): Promise<ControlledBake<P>> => {
  const { caller, kind, bakeOpts, build } = opts;
  let controls: BakeControls<P> | undefined;
  const ready = bakeTexture({
    ...bakeOpts,
    build: (ctx) => {
      const built = build(ctx);
      controls = { params: built.params, seed: built.seed };
      return built.nodes as unknown as Record<string, THREE.Node>;
    },
  });
  // Assigned in `build`, which TS can't see run
  const built = controls as BakeControls<P> | undefined;
  if (!built) {
    throw new Error(
      `${caller}: "${bakeOpts.id}" is the id of a bake that isn't a ${kind}'s (dispose it first, or bake under another id).`
    );
  }
  const bake = await ready;
  return {
    bake,
    getParams: () => built.params.values,
    setParams: (values) => built.params.set(values),
    getSeed: () => built.seed.value,
    setSeed: (seed) => {
      if (!Number.isInteger(seed)) {
        throw new Error(`${caller}: the seed ${seed} of "${bakeOpts.id}" isn't a whole number.`);
      }
      built.seed.value = seed >>> 0;
    },
  };
};

/**
 * An id's bake from the registry while it's alive (or baking: a second call shares the first),
 * else a new one from `start`, kept there until it fails or is disposed.
 * @internal
 * @param registry the caller's bakes by id, from their call
 * @param start starts a new bake of the id
 * @returns the id's bake, alive or new
 */
export const reuseOrStartBakeAsync = async <T extends { bake: BakedTexture }>(
  registry: Map<string, Promise<T>>,
  id: string,
  start: () => Promise<T>
): Promise<T> => {
  const pending = registry.get(id);
  if (pending) {
    const alive = await pending.catch(() => null);
    if (alive && !alive.bake.isDisposed()) return alive;
    if (registry.get(id) === pending) registry.delete(id);
  }
  // Another call may have started it again while this one waited
  const restarted = registry.get(id);
  if (restarted) return restarted;
  const started = start();
  registry.set(id, started);
  started.catch(() => {
    if (registry.get(id) === started) registry.delete(id);
  });
  return started;
};

/**
 * Bakes a procedural surface generator into a texture set packing: one `bakeTexture` of the
 * packing's slots (`<id>.<slot>` in the texture registry, owned by the scene loading or current
 * unless `isPersistent`), channel for channel what an imported set of that packing holds, so
 * `sampleTextureSet` decodes it. Its noise is periodic, so the textures tile.
 *
 * Its params' numbers and colours, and its seed, are uniforms: set them and rebake without a
 * rebuild (a slider can rebake on every change; the baker runs one render a frame at most).
 * @template P the generator's param specs
 * @param opts the id, the generator, the packing, the size and the surface's values
 * @returns the bake and its controls, once rendered
 * @throws (rejects) for a param the generator lacks or a value it refuses, physical facts out of
 * range, or what `bakeTexture` refuses
 * @remarks A call with the id of a baked surface that's alive (or baking) returns it, its options
 * ignored: dispose its `bake` first, or set its params and rebake. The baked textures are uncompressed: 1024² `LITE` is about 11 MB with
 * its mips (`bake.memoryBytes`).
 * @example
 * ```ts
 * import { createMaterial } from 'aekasha';
 * import { bakeSurfaceGenerator } from 'aekasha/toolkit/terrain';
 * import { generator as dunes } from './dunes.generator';
 *
 * const sand = await bakeSurfaceGenerator({
 *   id: 'beachSand',
 *   generator: dunes,
 *   packing: 'FULL',
 *   seed: 7,
 * });
 * const material = createMaterial({
 *   id: 'beachSandMat',
 *   type: 'STANDARD',
 *   params: { map: sand.bake.textures.albedoHeight },
 * });
 * ```
 */
export const bakeSurfaceGenerator = async <P extends SurfaceParamSpecs>(
  opts: BakeSurfaceGeneratorOpts<P>
): Promise<BakedSurface<P>> =>
  reuseOrStartBakeAsync(
    surfaces as unknown as Map<string, Promise<BakedSurface<P>>>,
    opts.id,
    async () => {
      const packing = opts.packing ?? 'LITE';
      const controlled = await startControlledBakeAsync<P>({
        caller: 'bakeSurfaceGenerator',
        kind: 'surface',
        bakeOpts: {
          id: opts.id,
          size: opts.size ?? 1024,
          outputs: getSurfacePackingOutputs(packing),
          anisotropy: opts.anisotropy,
          isPersistent: opts.isPersistent,
        },
        build: (ctx) =>
          buildSurfacePacking(opts.generator, ctx, {
            packing,
            params: opts.params,
            seed: opts.seed,
            physicalSize: opts.physicalSize,
            heightScale: opts.heightScale,
          }),
      });
      return { ...controlled, packing, generator: opts.generator };
    }
  );
