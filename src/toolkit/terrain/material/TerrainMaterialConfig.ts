// The terrain material's config (p305 D1), as Zod schemas and the types inferred from them: the
// code route's `TerrainMaterialConfig` (`createTerrainMaterial`) and the JSON route's static define
// (`staticDefines.terrain`, `TerrainMaterialDefine`), which is the config without the material's
// id and the layers' sets: the sets are the material's inputs (`layer<i>`), which the gather's
// texture closure reads and a variant swaps per block without another shader. The graph
// (`TerrainMaterial.ts`) imports only types from here, so a build that uses the generator carries
// no zod: it checks the define's values by hand as it reads them (the tests keep both in step).
// Each phase of p305 adds its fields: a key the schema doesn't know is refused.
import { z } from 'zod';

/** The layer's sampled source: `TEXTURE`, a texture set's maps. */
export const TERRAIN_LAYER_SOURCES = ['TEXTURE'] as const;
/** The tiling coordinates: `WORLD` (the world's `(x, −z)`, seen from above) or `MESH_UV`. */
export const TERRAIN_UV_MODES = ['WORLD', 'MESH_UV'] as const;
/** Where the layers' weights come from: `SINGLE`, one layer everywhere. */
export const TERRAIN_BLEND_SOURCES = ['SINGLE'] as const;
/** The texture set packings a terrain material samples (p303 D2). */
export const TERRAIN_PACKINGS = ['FULL', 'LITE', 'MINIMAL'] as const;
/** The most layers a terrain material blends. */
export const TERRAIN_MAX_LAYERS = 16;

const srgbColor = (description: string) =>
  z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'an sRGB colour, "#rrggbb"')
    .describe(description);

/**
 * A layer's settings, without its set: the static define's layer. Each tunable becomes a uniform
 * (`terrain_l<i>_<name>` in the material's `userData.uniforms`), so the material editor and code
 * edit it live; a multiplier applies over the set's own `surface` field of that name.
 */
export const TerrainLayerSettingsSchema = z
  .object({
    /** What the layer samples: `TEXTURE` (default), its texture set's maps. */
    source: z
      .enum(TERRAIN_LAYER_SOURCES)
      .optional()
      .describe("What the layer samples: TEXTURE (default), its texture set's maps."),
    /** × the set's `physicalSize` (default 1): 2 tiles twice as large. */
    tiling: z
      .number()
      .positive()
      .optional()
      .describe("× the set's physicalSize (default 1): 2 tiles twice as large."),
    /**
     * Degrees the tiling turns (counter-clockwise from above), breaking the alignment of layers
     * that share a tile size; compiled only when given.
     */
    rotation: z
      .number()
      .optional()
      .describe(
        'Degrees the tiling turns (counter-clockwise from above), breaking the alignment of layers; compiled only when given.'
      ),
    /** × the set's `tint` (default white), an sRGB `#rrggbb`. */
    tint: srgbColor('× the set\'s tint (default white), an sRGB "#rrggbb".').optional(),
    /** × the set's `normalStrength` (default 1): the normal's slope, or `MINIMAL`'s bump. */
    normalStrength: z
      .number()
      .min(0)
      .optional()
      .describe("× the set's normalStrength (default 1): the normal's slope, or MINIMAL's bump."),
    /** × the set's `roughnessScale` (default 1); the roughness is capped at 1. */
    roughnessScale: z
      .number()
      .min(0)
      .optional()
      .describe("× the set's roughnessScale (default 1); the roughness is capped at 1."),
  })
  .strict()
  .describe("A terrain layer's settings, without its set (the static define's layer).");

/** A terrain layer's settings without its set: the JSON route's `staticDefines.terrain.layers[i]`. */
export type TerrainLayerSettings = z.infer<typeof TerrainLayerSettingsSchema>;

/** A terrain layer of the code route: its texture set and its settings. */
export const TerrainLayerSchema = TerrainLayerSettingsSchema.extend({
  /** The texture set's id (a `*.textureSet.json`). */
  set: z.string().min(1).describe("The texture set's id (a *.textureSet.json)."),
})
  .strict()
  .describe('A terrain layer: its texture set and its settings.');

/** A terrain layer of {@link createTerrainMaterial}'s config: its texture set and its settings. */
export type TerrainLayer = z.infer<typeof TerrainLayerSchema>;

/** How the layers' weights are made. */
const TerrainBlendSchema = z
  .object({
    /** Where the weights come from: `SINGLE` (default), one layer everywhere. */
    source: z
      .enum(TERRAIN_BLEND_SOURCES)
      .describe('Where the weights come from: SINGLE (default), one layer everywhere.'),
  })
  .strict()
  .describe("How the layers' weights are made.");

/** The material-wide fields the code route's config and the static define share. */
const sharedFields = {
  /**
   * The tiling coordinates: `WORLD` (default) the world's `(x, −z)` over the tile size, seen from
   * above in the source's orientation (a slope stretches by 1 / cos of its angle); `MESH_UV` the
   * mesh's UV in metres (walls, authored blocks).
   */
  uv: z
    .enum(TERRAIN_UV_MODES)
    .optional()
    .describe(
      "The tiling coordinates: WORLD (default), the world's (x, -z) over the tile size, seen from above; MESH_UV, the mesh's UV in metres."
    ),
  /** How the layers' weights are made (default `{ source: 'SINGLE' }`). */
  blend: TerrainBlendSchema.optional(),
};

/** `SINGLE` blends one layer: the refinement both schemas share */
const checkSingleLayer = (
  value: { layers: unknown[]; blend?: { source: string } },
  ctx: z.RefinementCtx
) => {
  const source = value.blend?.source ?? 'SINGLE';
  if (source === 'SINGLE' && value.layers.length !== 1) {
    ctx.addIssue({
      code: 'custom',
      path: ['layers'],
      message: `blend.source SINGLE takes one layer, not ${value.layers.length}.`,
    });
  }
};

/**
 * The JSON route's static define, `staticDefines.terrain` of a material whose TSL functions are
 * the terrain material's (`terrain.material.json`, or `tslMaterialId: 'aek.terrain'`): the config
 * without the material's id, the layers without their sets (the inputs `layer0`, `layer1`, … give
 * them, `{ "textureSet": id, "packing"? }`, all in one packing).
 */
export const TerrainMaterialDefineSchema = z
  .object({
    /** The layers' settings, in the inputs' order (`layer0`, …): 1 to 16. */
    layers: z
      .array(TerrainLayerSettingsSchema)
      .min(1)
      .max(TERRAIN_MAX_LAYERS)
      .describe("The layers' settings, in the inputs' order (layer0, …): 1 to 16."),
    ...sharedFields,
  })
  .strict()
  .superRefine(checkSingleLayer)
  .describe("The terrain material's static define (staticDefines.terrain).");

/**
 * The terrain material's static define (`staticDefines.terrain`): {@link TerrainMaterialConfig}
 * without the id, its layers without their sets, which the material's inputs give.
 */
export type TerrainMaterialDefine = z.infer<typeof TerrainMaterialDefineSchema>;

/** The code route's config: {@link createTerrainMaterial}'s argument. */
export const TerrainMaterialConfigSchema = z
  .object({
    /** The material's registry id. */
    id: z.string().min(1).describe("The material's registry id."),
    /** The layers, each a texture set and its settings: 1 to 16. */
    layers: z
      .array(TerrainLayerSchema)
      .min(1)
      .max(TERRAIN_MAX_LAYERS)
      .describe('The layers, each a texture set and its settings: 1 to 16.'),
    /**
     * The packing every layer samples (each set must have it); default: each set's
     * `defaultPacking`, which must then agree.
     */
    packing: z
      .enum(TERRAIN_PACKINGS)
      .optional()
      .describe(
        "The packing every layer samples (each set must have it); default: each set's defaultPacking, which must then agree."
      ),
    ...sharedFields,
  })
  .strict()
  .superRefine(checkSingleLayer)
  .describe("The terrain material's config (createTerrainMaterial).");

/**
 * The terrain material's config (p305 D1), {@link createTerrainMaterial}'s argument: the layers'
 * texture sets and settings, and the techniques it compiles. Only what the config enables is in
 * the shader: every field is a build-time branch, its tunables uniforms.
 */
export type TerrainMaterialConfig = z.infer<typeof TerrainMaterialConfigSchema>;
