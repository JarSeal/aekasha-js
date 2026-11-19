// A decal generator baked (p309 D5): its decal packed into the `DECAL` slots by one `bakeTexture`
// (one MRT render), the textures registered as `<id>.albedoAlpha` and `<id>.normalRough`, with the
// controls of its params and seed for a rebake: what the gallery shows and exports as an atlas
// cell's PNGs (`exportBakedTexture`).
import {
  reuseOrStartBakeAsync,
  startControlledBakeAsync,
  type BakedSurface,
} from '../procedural/BakeSurface';
import type { SurfaceParamSpecs, SurfaceParamValues } from '../procedural/SurfaceParams';
import { buildDecalPacking, DECAL_BAKE_OUTPUTS, type DecalGenerator } from './DecalGenerator';

/**
 * What {@link bakeDecalGenerator} bakes.
 * @template P the generator's param specs
 */
export type BakeDecalGeneratorOpts<P extends SurfaceParamSpecs> = {
  /** The bake's id: the textures are registered as `<id>.albedoAlpha` and `<id>.normalRough`. */
  id: string;
  /** The generator (`defineDecalGenerator`). */
  generator: DecalGenerator<P>;
  /** Width and height in texels, one number for a square. Default 512. For an atlas cell, its
   * content size (its rect less the atlas's padding on each side), so the asset pipeline doesn't
   * resample the export. */
  size?: number | [number, number];
  /** The seed its noise derives from, a whole number. Default 0. */
  seed?: number;
  /** The params' values; a param left out takes its default. */
  params?: SurfaceParamValues<P>;
  /** The decal's size in metres. Default the generator's. */
  physicalSize?: [number, number];
  /** The metres of relief a height of 1 stands for (the normal's depth). Default the
   * generator's. */
  heightScale?: number;
  /** Builds the mip chain. Default true; an export reads level 0 only. */
  mipmaps?: boolean;
  /** Never released with its scene. */
  isPersistent?: boolean;
};

/**
 * A baked decal, from {@link bakeDecalGenerator}: the bake and the controls of its params.
 * @template P the generator's param specs
 */
export type BakedDecal<P extends SurfaceParamSpecs = SurfaceParamSpecs> = Pick<
  BakedSurface<P>,
  'bake' | 'getParams' | 'setParams' | 'getSeed' | 'setSeed'
> & {
  /** The generator it bakes. */
  readonly generator: DecalGenerator<P>;
};

/** The baked decals by id, from their call (a second call while one bakes shares it): a call
 * returns an id's decal while its bake is alive. */
const decals = new Map<string, Promise<BakedDecal>>();

/**
 * Bakes a procedural decal generator into the `DECAL` packing (p309 D1): one `bakeTexture` of
 * `albedoAlpha` (sRGB albedo, A opacity) and `normalRough` (normal XY, roughness, puddle mask),
 * registered as `<id>.<slot>` and owned by the scene loading or current unless `isPersistent`.
 * Export each slot as an atlas cell's PNG with `exportBakedTexture` (debug env), and name the PNGs
 * in the cell's `sources`.
 *
 * Its params' numbers and colours, and its seed, are uniforms: set them and rebake without a
 * rebuild.
 * @template P the generator's param specs
 * @param opts the id, the generator, the size and the decal's values
 * @returns the bake and its controls, once rendered
 * @throws (rejects) for a param the generator lacks or a value it refuses, physical facts out of
 * range, or what `bakeTexture` refuses
 * @remarks A call with the id of a baked decal that's alive (or baking) returns it, its options
 * ignored: dispose its `bake` first, or set its params and rebake.
 * @example
 * ```ts
 * import { exportBakedTexture } from 'aekasha';
 * import { bakeDecalGenerator, decalStain } from 'aekasha/toolkit/terrain';
 *
 * // An atlas cell of 512 with 16 px of padding holds 480² of content
 * await bakeDecalGenerator({ id: 'stain03', generator: decalStain, size: 480, seed: 3 });
 * const dir = 'src/app/textures/myDecals/source';
 * for (const output of ['albedoAlpha', 'normalRough']) {
 *   await exportBakedTexture({ id: 'stain03', output, dir });
 * }
 * ```
 */
export const bakeDecalGenerator = async <P extends SurfaceParamSpecs>(
  opts: BakeDecalGeneratorOpts<P>
): Promise<BakedDecal<P>> =>
  reuseOrStartBakeAsync(
    decals as unknown as Map<string, Promise<BakedDecal<P>>>,
    opts.id,
    async () => {
      const controlled = await startControlledBakeAsync<P>({
        caller: 'bakeDecalGenerator',
        kind: 'decal',
        bakeOpts: {
          id: opts.id,
          size: opts.size ?? 512,
          outputs: [...DECAL_BAKE_OUTPUTS],
          mipmaps: opts.mipmaps,
          isPersistent: opts.isPersistent,
        },
        build: (ctx) =>
          buildDecalPacking(opts.generator, ctx, {
            params: opts.params,
            seed: opts.seed,
            physicalSize: opts.physicalSize,
            heightScale: opts.heightScale,
          }),
      });
      return { ...controlled, generator: opts.generator };
    }
  );
