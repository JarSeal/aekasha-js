import { z } from 'zod';
import type { FeatureSchemaPart } from '../../schemas/FeatureSchemas';
import { DebugDataSchema, type DebugData } from '../../schemas/_HelperSchemas';
import { MaterialVariantOverridesSchema } from '../../schemas/MaterialSchema';
import { JsonSchemaRefSchema, SourcePathSchema } from '../../schemas/_SaveDataSchema';

// The terrain block asset (p306 D2): a block's geometry (an imported node, or a registered
// generator's), its terrain material with the block's own inputs, its collider and its shadows.
// The gatherer fills the defaults in and writes each block a scene lists into its data
// (`TerrainBlockDef`), where `spawnTerrainBlock` reads it. The block conventions (p306 D1: a
// square block centred on its origin, `resolution` vertices per side) aren't checked here: the
// Blender add-on's validator checks a block's mesh, the collider's extraction its grid.

/** A block's geometry from an import: a node of a `*.importedAsset.json`. */
const ImportedGeometrySchema = z
  .strictObject({
    /** The `*.importedAsset.json`'s id. The gather adds it to a scene listing the block. */
    importedAsset: z
      .string()
      .min(1)
      .describe("The *.importedAsset.json's id. The gather adds it to a scene listing the block."),
    /** The node whose geometry is the block's (its registered geometry `<importedAsset>/<node>`).
     * Default: the import's only mesh. */
    node: z
      .string()
      .min(1)
      .optional()
      .describe(
        "The node whose geometry is the block's (its registered geometry <importedAsset>/<node>). Default: the import's only mesh."
      ),
  })
  .describe("An imported node's geometry.");

/** A block's geometry from a generator registered with `registerTerrainGenerator`. */
const GeneratedGeometrySchema = z
  .strictObject({
    /** The generator's id (`registerTerrainGenerator`; the toolkit's `noiseTerrain`, …). */
    generator: z
      .string()
      .min(1)
      .describe("The generator's id (registerTerrainGenerator; the toolkit's noiseTerrain, …)."),
    /** The generator's own params, checked by the generator. Default: `{}`. */
    params: z
      .record(z.string(), z.unknown())
      .optional()
      .describe("The generator's own params, checked by the generator. Default: {}."),
    /**
     * The seed (default 0). A height noise uses it as it is, sampled at the block's world place,
     * so blocks of one seed continue each other; a block's own randomness combines it with its
     * grid coordinates.
     */
    seed: z
      .number()
      .int()
      .optional()
      .describe(
        "The seed (default 0). A height noise uses it as it is, sampled at the block's world place, so blocks of one seed continue each other; a block's own randomness combines it with its grid coordinates."
      ),
  })
  .describe("A registered generator's geometry, made when the block spawns.");

/** A block's collider types: `HEIGHTFIELD` (from the geometry's grid), `TRIMESH` (overhangs,
 * caves; costlier) or `NONE` (background blocks). */
export const TERRAIN_BLOCK_COLLIDER_TYPES = ['HEIGHTFIELD', 'TRIMESH', 'NONE'] as const;

/** A block's collider type: `HEIGHTFIELD`, `TRIMESH` or `NONE`. */
export type TerrainBlockColliderType = (typeof TERRAIN_BLOCK_COLLIDER_TYPES)[number];

/** The defaults the gather fills in. */
export const TERRAIN_BLOCK_DEFAULTS = {
  grid: { x: 0, z: 0 },
  collider: { type: 'HEIGHTFIELD' },
  shadows: { cast: true, receive: true },
  seed: 0,
} as const;

/**
 * A terrain block (`*.terrainBlock.json`, p306 D2): its geometry, its material and the block's own
 * inputs to it, its place in the grid, its collider and its shadows. A scene lists the blocks its
 * code spawns in `terrainBlocks`.
 */
export const TerrainBlockAssetSchema = z
  .strictObject({
    /** The JSON Schema an editor validates the file with. */
    $schema: JsonSchemaRefSchema.optional(),
    /** The block's id. Default: the file name without `.terrainBlock.json`. */
    id: z
      .string()
      .min(1)
      .optional()
      .describe('The id. Default: the file name without .terrainBlock.json.'),
    /** The geometry: an imported node (`{ importedAsset, node? }`) or a registered generator's
     * (`{ generator, params?, seed? }`). */
    geometry: z
      .union([ImportedGeometrySchema, GeneratedGeometrySchema])
      .describe(
        "The geometry: an imported node ({ importedAsset, node? }) or a registered generator's ({ generator, params?, seed? })."
      ),
    /** The material's id (a `*.material.json`). The gather adds it to a scene listing the block. */
    material: z
      .string()
      .min(1)
      .describe(
        "The material's id (a *.material.json). The gather adds it to a scene listing the block."
      ),
    /** The block's own inputs over the material's (a variant per input set, `getMaterialVariant`):
     * its splat map, colour map, … Their textures load with a scene listing the block. */
    materialInputs: MaterialVariantOverridesSchema.shape.inputs.describe(
      "The block's own inputs over the material's (a variant per input set): its splat map, colour map, … The same forms as a material's inputs; their textures load with a scene listing the block."
    ),
    /** The block's place and grid: centred at `(x · size, 0, z · size)`, `resolution` vertices per
     * side. */
    grid: z
      .strictObject({
        /** The grid column (along +x). Default: 0. */
        x: z.number().int().optional().describe('The grid column (along +x). Default: 0.'),
        /** The grid row (along +z). Default: 0. */
        z: z.number().int().optional().describe('The grid row (along +z). Default: 0.'),
        /** The block's edge in metres: 32, 64, 128 or 256 by the block conventions. */
        size: z
          .number()
          .positive()
          .describe("The block's edge in metres: 32, 64, 128 or 256 by the block conventions."),
        /** Vertices per side (`2^n + 1` by the conventions: 65, 129, 257). */
        resolution: z
          .number()
          .int()
          .min(2)
          .describe('Vertices per side (2^n + 1 by the conventions: 65, 129, 257).'),
      })
      .describe(
        "The block's place and grid: centred at (x · size, 0, z · size), resolution vertices per side."
      ),
    /** The collider. Default: `{ type: 'HEIGHTFIELD' }`. Any but `NONE` needs `physics()`. */
    collider: z
      .strictObject({
        /** `HEIGHTFIELD` (default; from the geometry's grid), `TRIMESH` (overhangs, caves;
         * costlier) or `NONE` (background blocks). */
        type: z
          .enum(TERRAIN_BLOCK_COLLIDER_TYPES)
          .optional()
          .describe(
            'HEIGHTFIELD (default; from the geometry grid), TRIMESH (overhangs, caves; costlier) or NONE (background blocks).'
          ),
        /** Friction (Rapier's default 0.5). */
        friction: z.number().min(0).optional().describe("Friction (Rapier's default 0.5)."),
        /** Restitution, the bounce (Rapier's default 0). */
        restitution: z
          .number()
          .min(0)
          .optional()
          .describe("Restitution, the bounce (Rapier's default 0)."),
      })
      .optional()
      .describe("The collider. Default: { type: 'HEIGHTFIELD' }. Any but NONE needs physics()."),
    /** The mesh's shadows. Default: both. */
    shadows: z
      .strictObject({
        /** Casts shadows. Default: true. */
        cast: z.boolean().optional().describe('Casts shadows. Default: true.'),
        /** Receives shadows. Default: true. */
        receive: z.boolean().optional().describe('Receives shadows. Default: true.'),
      })
      .optional()
      .describe("The mesh's shadows. Default: both."),
    /** The block's scatters (`*.scatter.json` ids), spawned with it on the block (their
     * `target`: its centre, grid place and size) and owned by it. Needs `instancing()`; the gather
     * adds them to a scene listing the block. */
    scatter: z
      .array(z.string().min(1))
      .optional()
      .describe(
        "The block's scatters (*.scatter.json ids), spawned with it on the block and owned by it. Needs instancing(); the gather adds them to a scene listing the block."
      ),
    /** The block's decal sets (`*.decalSet.json` ids, p309 D3), spawned with it at its grid place
     * and owned by it: their meshes are in the block's own space, as exported beside it. The
     * gather adds them to a scene listing the block. */
    decals: z
      .array(z.string().min(1))
      .optional()
      .describe(
        "The block's decal sets (*.decalSet.json ids), spawned with it at its grid place and owned by it: their meshes are in the block's own space, as exported beside it. The gather adds them to a scene listing the block."
      ),
    /** The debug tools' name and description. */
    debugData: DebugDataSchema.optional(),
    /** Set by the gatherer. */
    __sourcePath: SourcePathSchema.optional(),
  })
  .describe(
    'A terrain block: its geometry, material, grid place, collider, shadows, scatters and decal sets.'
  );

/** A terrain block's JSON (`*.terrainBlock.json`), as written. */
export type TerrainBlockAsset = z.infer<typeof TerrainBlockAssetSchema>;

/** A terrain block's geometry, as a scene's data has it (a generator's `params` and `seed` filled
 * in). */
export type TerrainBlockGeometry =
  | { importedAsset: string; node?: string }
  | { generator: string; params: Record<string, unknown>; seed: number };

/**
 * A terrain block as a scene's data has it (the gatherer's): its JSON with the defaults filled in.
 * `spawnTerrainBlock` spawns it.
 */
export type TerrainBlockDef = {
  /** The block's id */
  id: string;
  /** An imported node, or a registered generator's geometry */
  geometry: TerrainBlockGeometry;
  /** The material's id */
  material: string;
  /** The block's own inputs over the material's (a variant), when it has any */
  materialInputs?: Record<string, unknown>;
  /** The grid place and size: centred at `(x · size, 0, z · size)` */
  grid: { x: number; z: number; size: number; resolution: number };
  /** The collider (`NONE`: none) */
  collider: { type: TerrainBlockColliderType; friction?: number; restitution?: number };
  /** The mesh's shadows */
  shadows: { cast: boolean; receive: boolean };
  /** The block's scatters' ids, when it has any */
  scatter?: string[];
  /** The block's decal sets' ids, when it has any */
  decals?: string[];
  /** The debug tools' name and description (not in a production build) */
  debugData?: DebugData;
};

/** The terrain feature's scene fields: `terrainBlocks` (p306 D2), the ids of the
 * `*.terrainBlock.json` blocks the scene's code spawns (`spawnTerrainBlock`), and `decalSets` (p309
 * D3), the `*.decalSet.json` sets it spawns (`spawnDecalSet`). */
export const terrainSchemaPart = {
  feature: 'terrain',
  scene: {
    /** Terrain block ids (`*.terrainBlock.json`) the scene's code spawns: each one's import,
     * material and input textures load with the scene. */
    terrainBlocks: z
      .array(z.string().min(1))
      .optional()
      .describe(
        "Terrain block ids (*.terrainBlock.json) the scene's code spawns (spawnTerrainBlock): each one's import, material and input textures load with the scene."
      ),
    /** Decal set ids (`*.decalSet.json`) the scene's code spawns: each one's import and material
     * load with the scene. A terrain block's decal sets are added for it. */
    decalSets: z
      .array(z.string().min(1))
      .optional()
      .describe(
        "Decal set ids (*.decalSet.json) the scene's code spawns (spawnDecalSet): each one's import and material load with the scene. A terrain block's decal sets are added for it."
      ),
  },
} satisfies FeatureSchemaPart;
