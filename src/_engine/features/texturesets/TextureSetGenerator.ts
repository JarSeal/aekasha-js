// What a procedural texture set's generator gives the engine (p304 D3): the graphs of a packing's
// slots for a bake. Types only: the generators are the toolkit's (`aekasha/toolkit/terrain`'s
// `defineSurfaceGenerator`) or an app's, reached through the gathered code by id, so the engine
// imports none of them.
import type * as THREE from 'three/webgpu';
import type { BakeBuildContext } from '../../kernel/render/TextureBaker';
import type { TextureSetCategory, TextureSetPacking } from '../../schemas/TextureSetSchema';

/** A generator's param values by name: a number, a colour (sRGB `#rrggbb`) or a toggle. */
export type TextureSetGeneratorParams = Record<string, number | string | boolean>;

/** What {@link TextureSetGenerator}'s `buildPacking` builds: the set's packing and its facts. */
export type TextureSetGeneratorBuildOpts = {
  /** The packing whose slots the graphs write. */
  packing: TextureSetPacking;
  /** The params' values by name; a param left out takes the generator's default. */
  params?: TextureSetGeneratorParams;
  /** The seed every noise of the surface derives from (a whole number). Default 0. */
  seed?: number;
  /** The metres one tile covers, `[width, height]` (the set's `physicalSize`). */
  physicalSize: [number, number];
  /** The metres of relief a height of 1 stands for (the set's `heightScale`): the normal's depth. */
  heightScale: number;
};

/**
 * A procedural surface generator as the engine bakes it: the graphs of a packing's slots, by slot
 * name, built from a bake's context. A procedural texture set (`"procedural": { "generator": id }`
 * in its JSON) is baked through one into its packing's textures, and then samples like any set.
 * Make one with the toolkit's `defineSurfaceGenerator` (`aekasha/toolkit/terrain`).
 */
export type TextureSetGenerator = {
  /** The generator's id, which a procedural set's JSON names. */
  readonly id: string;
  /** The surface's category: a procedural set's default. */
  readonly category: TextureSetCategory;
  /**
   * Builds the packing's slot graphs (each a vec4, the albedo slots linear colour the bake writes
   * as sRGB), by slot name. Throws for a param the generator doesn't have, or a value it refuses.
   */
  readonly buildPacking: (
    ctx: BakeBuildContext,
    opts: TextureSetGeneratorBuildOpts
  ) => Record<string, THREE.Node>;
};
