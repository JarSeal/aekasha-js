import { z } from 'zod';
import type { FeatureSchemaPart } from '../../schemas/FeatureSchemas';
import type {
  MeshMergeDef,
  MeshMergeOptions,
  SceneAutoMergeEntry,
  SceneMergeGroupEntry,
} from './MergeTypes';

// The merging feature's JSON fields (docs/plans/_DONE_p372_mesh-merge-groups.md §4): a mesh's `merge` and
// a scene's `mergeGroups`, so the gather's feature manifest names `merging` for a scene that uses
// either. The runtime checks the same rules without zod (MergeAuto.ts' `queueMerge`).

/** An explicit group's id: not empty, not `AUTO` (its own branch, so an `AUTO` entry with an
 * explicit group's fields fails) and not an `AUTO` group's derived id. */
const GroupIdSchema = z
  .string()
  .min(1)
  .refine((id) => id !== 'AUTO' && !id.startsWith('auto:'), {
    message: "AUTO and ids starting with 'auto:' are the automatic groups' (merge: 'AUTO').",
  });

const CellSizeSchema = z
  .number()
  .gt(0)
  .describe(
    'AUTO only: the side of the square x/z cells that bound an automatic group, in metres (default 32). In a streaming scene it divides the streaming cell size, or a group can span two streaming cells.'
  );

const MaxVerticesSchema = z
  .number()
  .int()
  .gt(0)
  .describe(
    "AUTO only: an automatic group's vertex cap (default 262144); a full one opens another in its cell."
  );

/**
 * `merge`'s object form (MeshMergeOptions).
 * A part of {@link mergingSchemaPart}.
 * @internal
 */
export const MeshMergeOptionsSchema = z
  .strictObject({
    /** The group's id, or `AUTO` (the default). */
    group: z
      .union([z.literal('AUTO'), GroupIdSchema])
      .optional()
      .describe("The group's id, or AUTO (the default)."),
    /** `AUTO` only: the cells' side, in metres. */
    cellSize: CellSizeSchema.optional(),
    /** `AUTO` only: a group's vertex cap. */
    maxVertices: MaxVerticesSchema.optional(),
  })
  .describe(
    "A merge group, and the automatic groups' bounds."
  ) satisfies z.ZodType<MeshMergeOptions>;

/**
 * A mesh's `merge` (MeshMergeDef): a group's id, `AUTO`, or the options.
 * A part of {@link mergingSchemaPart}.
 * @internal
 */
export const MeshMergeDefSchema = z.union([
  z
    .literal('AUTO')
    .describe(
      "Merged into an automatic group: the engine's pick by material, attributes, shadow flags, layers and cell."
    ),
  GroupIdSchema.describe(
    "The merge group's id: made on first use (the scene's mergeGroups entry's settings)."
  ),
  MeshMergeOptionsSchema,
]) satisfies z.ZodType<MeshMergeDef>;

/**
 * A scene's `mergeGroups` entry: its automatic groups' defaults (`id: 'AUTO'`) or a group's
 * settings.
 * A part of {@link mergingSchemaPart}.
 * @internal
 */
export const SceneMergeGroupEntrySchema = z.union([
  z
    .strictObject({
      /** `AUTO`: the scene's automatic groups. */
      id: z.literal('AUTO'),
      /** The cells' side for the scene's meshes that don't give one. */
      cellSize: CellSizeSchema.optional(),
      /** The vertex cap for the scene's meshes that don't give one. */
      maxVertices: MaxVerticesSchema.optional(),
    })
    .describe(
      "The scene's defaults for its automatic groups."
    ) satisfies z.ZodType<SceneAutoMergeEntry>,
  z
    .strictObject({
      /** The group's id. */
      id: GroupIdSchema,
      /** Whether the group's mesh casts shadows (default: its first member's). */
      castShadow: z.boolean().optional(),
      /** Whether the group's mesh receives shadows (default: its first member's). */
      receiveShadow: z.boolean().optional(),
    })
    .describe(
      "A group's settings, when a mesh's merge or addToMergeGroup makes it in this scene."
    ) satisfies z.ZodType<SceneMergeGroupEntry>,
]);

/** The merging feature's fields (p372 §4): a mesh's `merge` and a scene's `mergeGroups`. */
export const mergingSchemaPart = {
  feature: 'merging',
  scene: {
    /** Merge group settings, and `AUTO`'s defaults, for the groups made in this scene. */
    mergeGroups: z
      .array(SceneMergeGroupEntrySchema)
      .superRefine((entries, ctx) => {
        const seen = new Set<string>();
        entries.forEach((entry, index) => {
          if (seen.has(entry.id)) {
            ctx.addIssue({
              code: 'custom',
              path: [index, 'id'],
              message: `The merge group "${entry.id}" is listed twice.`,
            });
          }
          seen.add(entry.id);
        });
      })
      .optional()
      .describe(
        "Merge group settings for the groups made in this scene, and AUTO's defaults ({ id: 'AUTO', cellSize?, maxVertices? })."
      ),
  },
  mesh: {
    /** Draws the mesh merged into a merge group: its id, `AUTO`, or the options. In a save entry
     * it replaces the mesh's `merge` in that scene. */
    merge: MeshMergeDefSchema.optional(),
  },
} satisfies FeatureSchemaPart;
