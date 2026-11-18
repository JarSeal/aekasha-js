import { z } from 'zod';
import type { FeatureSchemaPart } from '../../schemas/FeatureSchemas';
import { DebugDataSchema, type DebugData } from '../../schemas/_HelperSchemas';
import { JsonSchemaRefSchema, SourcePathSchema } from '../../schemas/_SaveDataSchema';
import { LodDefSchema } from '../lod/LodSchema';
import type { LodDef } from '../lod/LodTypes';

// The scatter asset (docs/plans/p308_terrain-scatter.md D2): static instances of a few items (a
// geometry and a material each) placed by a source, drawn in cells by `createStaticInstances`. The
// gatherer fills the defaults in and writes each scatter a scene lists (or a terrain block of it
// names) into its data (`ScatterDef`), where `spawnScatter` reads it.

/** One kind of instance: its geometry and material, and its share of the instances. */
const ScatterItemSchema = z
  .strictObject({
    /** A registered geometry's id: a `*.geometry.json`'s (the gather adds it to the scene), an
     * import's `<importId>/<node>` or one code registers. */
    geometry: z
      .string()
      .min(1)
      .describe(
        "A registered geometry's id: a *.geometry.json's (the gather adds it to the scene), an import's <importId>/<node> or one code registers."
      ),
    /** A registered material's id: a `*.material.json`'s (the gather adds it to the scene) or one
     * code registers. */
    material: z
      .string()
      .min(1)
      .describe(
        "A registered material's id: a *.material.json's (the gather adds it to the scene) or one code registers."
      ),
    /** The item's share where a source doesn't pick it: its weight over the items' sum. Default 1. */
    weight: z
      .number()
      .positive()
      .optional()
      .describe(
        "The item's share where a source doesn't pick it: its weight over the items' sum. Default 1."
      ),
    /** Casts shadows. Default: false (pebbles and cards don't; rocks and boulders do). */
    castShadow: z.boolean().optional().describe('Casts shadows. Default: false.'),
    /** Receives shadows. Default: true. */
    receiveShadow: z.boolean().optional().describe('Receives shadows. Default: true.'),
  })
  .describe('One kind of instance: its geometry and material, and its share of the instances.');

/** A source made by a generator registered with `registerScatterGenerator`. */
const ProceduralSourceSchema = z
  .strictObject({
    /** Places the instances by a generator. */
    type: z.literal('PROCEDURAL').describe('Places the instances by a generator.'),
    /** The generator's id (`registerScatterGenerator`). */
    generator: z.string().min(1).describe("The generator's id (registerScatterGenerator)."),
    /** The generator's own params, checked by the generator. Default: `{}`. */
    params: z
      .record(z.string(), z.unknown())
      .optional()
      .describe("The generator's own params, checked by the generator. Default: {}."),
    /** The seed (default 0), combined with the world seed, the target's grid place and the
     * scatter's id, so every block gets its own placements and every visit the same. */
    seed: z
      .number()
      .int()
      .optional()
      .describe(
        "The seed (default 0), combined with the world seed, the target's grid place and the scatter's id, so every block gets its own placements and every visit the same."
      ),
  })
  .describe('Instances placed by a registered generator when the scatter spawns.');

/** One hand-placed instance, relative to the target's position. */
const ScatterPlacementSchema = z
  .strictObject({
    /** `[x, y, z]` in metres, from the target's position (a terrain block's centre). */
    position: z
      .tuple([z.number(), z.number(), z.number()])
      .describe("[x, y, z] in metres, from the target's position (a terrain block's centre)."),
    /** The rotation about +y, in radians. Default 0. Not with `quaternion`. */
    yaw: z
      .number()
      .optional()
      .describe('The rotation about +y, in radians. Default 0. Not with quaternion.'),
    /** The rotation as a quaternion `[x, y, z, w]`. Not with `yaw`. */
    quaternion: z
      .tuple([z.number(), z.number(), z.number(), z.number()])
      .optional()
      .describe('The rotation as a quaternion [x, y, z, w]. Not with yaw.'),
    /** The scale, the same on every axis. Default 1. */
    scale: z
      .number()
      .positive()
      .optional()
      .describe('The scale, the same on every axis. Default 1.'),
    /** The item's index in `items`. Default: one picked by the weights, from the seed. */
    item: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe("The item's index in items. Default: one picked by the weights, from the seed."),
  })
  .refine((placement) => placement.yaw === undefined || placement.quaternion === undefined, {
    message: 'A placement takes yaw or quaternion, not both.',
  })
  .describe('One hand-placed instance, relative to the target position.');

/** Hand-placed instances (or a tool's). */
const PlacementsSourceSchema = z
  .strictObject({
    /** Hand-placed instances (or a tool's). */
    type: z.literal('PLACEMENTS').describe("Hand-placed instances (or a tool's)."),
    /** The instances. */
    placements: z.array(ScatterPlacementSchema).describe('The instances.'),
    /** The seed the items without `item` are picked from (default 0), combined as a generator's. */
    seed: z
      .number()
      .int()
      .optional()
      .describe(
        "The seed the items without item are picked from (default 0), combined as a generator's."
      ),
  })
  .describe("Hand-placed instances (or a tool's).");

/** An import's instances (p308 D3): its nodes of GPU instances and its point clouds. */
const ImportedSourceSchema = z
  .strictObject({
    /** The instances of an import's nodes. */
    type: z.literal('IMPORTED').describe("The instances of an import's nodes."),
    /** The `*.importedAsset.json`'s id (the gather adds it to the scene). Its nodes of GPU
     * instances (`EXT_mesh_gpu_instancing`) and its point clouds (`aekScatterPoints`) are the
     * instances, placed from the target's position as they are from the file's root. */
    importedAsset: z
      .string()
      .min(1)
      .describe(
        "The *.importedAsset.json's id (the gather adds it to the scene). Its nodes of GPU instances (EXT_mesh_gpu_instancing) and its point clouds (aekScatterPoints) are the instances, placed from the target's position as they are from the file's root."
      ),
    /** The nodes to take, by their name or a parent's (Blender writes a Geometry Nodes output as
     * children of its object's node), `*` matching any run of characters (`Rocks*`). Default:
     * every node of GPU instances and every point cloud. */
    nodes: z
      .array(z.string().min(1))
      .min(1)
      .optional()
      .describe(
        "The nodes to take, by their name or a parent's (Blender writes a Geometry Nodes output as children of its object's node), * matching any run of characters (Rocks*). Default: every node of GPU instances and every point cloud."
      ),
    /** The seed the points without an `_ITEM` are picked from (default 0), combined as a
     * generator's. */
    seed: z
      .number()
      .int()
      .optional()
      .describe(
        "The seed the points without an _ITEM are picked from (default 0), combined as a generator's."
      ),
  })
  .describe(
    "An import's instances: a GPU-instanced node's item is the one whose geometry is the node's, or a plain node's of the same glTF mesh; a point's is its _ITEM."
  );

/** The scatter sources: `PROCEDURAL` (a generator), `PLACEMENTS` (a list) and `IMPORTED` (an
 * import's instances). */
export const SCATTER_SOURCE_TYPES = ['PROCEDURAL', 'PLACEMENTS', 'IMPORTED'] as const;

/** The defaults the gather fills in. */
export const SCATTER_DEFAULTS = {
  cellSize: 16,
  weight: 1,
  castShadow: false,
  receiveShadow: true,
  seed: 0,
} as const;

/**
 * A scatter (`*.scatter.json`, p308 D2): static instances of its items placed by its source, drawn
 * in cells (`createStaticInstances`), each cell switching levels and hiding as a whole by `lod`. A
 * scene lists the scatters its code spawns in `scatters`; a terrain block names its own in
 * `scatter`.
 */
export const ScatterAssetSchema = z
  .strictObject({
    /** The JSON Schema an editor validates the file with. */
    $schema: JsonSchemaRefSchema.optional(),
    /** The scatter's id. Default: the file name without `.scatter.json`. */
    id: z
      .string()
      .min(1)
      .optional()
      .describe('The id. Default: the file name without .scatter.json.'),
    /** The kinds of instance (at most 256): each a geometry and a material. */
    items: z
      .array(ScatterItemSchema)
      .min(1)
      .max(256)
      .describe('The kinds of instance (at most 256): each a geometry and a material.'),
    /** Where the instances go: `PROCEDURAL` (a registered generator), `PLACEMENTS` (a list) or
     * `IMPORTED` (an import's GPU instances and point clouds). */
    source: z
      .discriminatedUnion('type', [
        ProceduralSourceSchema,
        PlacementsSourceSchema,
        ImportedSourceSchema,
      ])
      .describe(
        "Where the instances go: PROCEDURAL (a registered generator), PLACEMENTS (a list) or IMPORTED (an import's GPU instances and point clouds)."
      ),
    /** A cell's side in metres: each cell is one draw per item, culled and switched as a whole.
     * Default 16. */
    cellSize: z
      .number()
      .positive()
      .optional()
      .describe(
        "A cell's side in metres: each cell is one draw per item, culled and switched as a whole. Default 16."
      ),
    /** Every cell's levels of detail; `cullScreenSize` hides a cell too small on screen. Default:
     * none (a cell is drawn wherever it's in view). */
    lod: LodDefSchema.optional().describe(
      "Every cell's levels of detail; cullScreenSize hides a cell too small on screen. Default: none."
    ),
    /** The debug tools' name and description. */
    debugData: DebugDataSchema.optional(),
    /** Set by the gatherer. */
    __sourcePath: SourcePathSchema.optional(),
  })
  .superRefine((scatter, ctx) => {
    if (scatter.source.type !== 'PLACEMENTS') return;
    scatter.source.placements.forEach((placement, index) => {
      if (placement.item === undefined || placement.item < scatter.items.length) return;
      ctx.addIssue({
        code: 'custom',
        path: ['source', 'placements', index, 'item'],
        message: `The item ${placement.item} isn't one of the ${scatter.items.length} items.`,
      });
    });
  })
  .describe('A scatter: static instances of its items, placed by its source, drawn in cells.');

/** A scatter's JSON (`*.scatter.json`), as written. */
export type ScatterAsset = z.infer<typeof ScatterAssetSchema>;

/** A scatter item, as a scene's data has it (the defaults filled in). */
export type ScatterItemDef = {
  /** The geometry's id */
  geometry: string;
  /** The material's id */
  material: string;
  /** Its share where a source doesn't pick it */
  weight: number;
  /** Casts shadows */
  castShadow: boolean;
  /** Receives shadows */
  receiveShadow: boolean;
};

/** A hand-placed instance, as a scene's data has it. */
export type ScatterPlacementDef = {
  /** `[x, y, z]` from the target's position */
  position: [number, number, number];
  /** The rotation about +y in radians, when it gives one */
  yaw?: number;
  /** The rotation as a quaternion `[x, y, z, w]`, when it gives one */
  quaternion?: [number, number, number, number];
  /** The scale on every axis */
  scale?: number;
  /** The item's index, when it names one */
  item?: number;
};

/** A scatter's source, as a scene's data has it (its `params` and `seed` filled in). */
export type ScatterSourceDef =
  | { type: 'PROCEDURAL'; generator: string; params: Record<string, unknown>; seed: number }
  | { type: 'PLACEMENTS'; placements: ScatterPlacementDef[]; seed: number }
  | { type: 'IMPORTED'; importedAsset: string; nodes?: string[]; seed: number };

/**
 * A scatter as a scene's data has it (the gatherer's): its JSON with the defaults filled in.
 * `spawnScatter` spawns it.
 */
export type ScatterDef = {
  /** The scatter's id */
  id: string;
  /** The items */
  items: ScatterItemDef[];
  /** Where the instances go */
  source: ScatterSourceDef;
  /** A cell's side in metres */
  cellSize: number;
  /** Every cell's levels of detail, when it has them */
  lod?: LodDef;
  /** The debug tools' name and description (not in a production build) */
  debugData?: DebugData;
};

/** The instancing feature's scene field (p308 D2): `scatters`, the ids of the `*.scatter.json`
 * scatters the scene's code spawns (`spawnScatter`). */
export const instancingSchemaPart = {
  feature: 'instancing',
  scene: {
    /** Scatter ids (`*.scatter.json`) the scene's code spawns: each one's geometry and material
     * JSONs load with the scene. A terrain block's scatters are added for it. */
    scatters: z
      .array(z.string().min(1))
      .optional()
      .describe(
        "Scatter ids (*.scatter.json) the scene's code spawns (spawnScatter): each one's geometry and material JSONs load with the scene. A terrain block's scatters are added for it."
      ),
  },
} satisfies FeatureSchemaPart;
