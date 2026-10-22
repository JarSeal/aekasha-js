import { z } from 'zod';

// generateLodChain's options (`LodChainOptions`, features/lod/LodChainOptions.ts) in a JSON
const LodChainOptionsSchema = z
  .strictObject({
    /** Each level's target triangle count, as a ratio of the base's. Default `[0.5, 0.25, 0.1]`. */
    ratios: z
      .array(z.number().gt(0).lt(1))
      .optional()
      .describe(
        "Target triangle counts, as ratios of the base's, one per level. Default [0.5, 0.25, 0.1]."
      ),
    /** meshoptimizer's error cap, relative to the mesh's largest bounding box side. Default 0.05. */
    maxError: z
      .number()
      .gt(0)
      .max(1)
      .optional()
      .describe(
        "meshoptimizer's target error cap, relative to the mesh's extent (its largest bounding box side). Default 0.05."
      ),
    /** How much normal and uv deviation count against a collapse (0 ignores it). Default 0.5 each. */
    attributeWeights: z
      .strictObject({
        /** The normals' weight. */
        normal: z.number().min(0).optional().describe("The normals' weight. Default 0.5."),
        /** The uvs' weight. */
        uv: z.number().min(0).optional().describe("The uvs' weight. Default 0.5."),
      })
      .optional()
      .describe(
        'How much normal and uv deviation count against a collapse. Default 0.5 each (0 ignores it).'
      ),
    /** Each level gets its own trimmed vertex arrays instead of sharing the base's. Default false. */
    compactVertices: z
      .boolean()
      .optional()
      .describe(
        "Each level gets its own trimmed vertex arrays instead of sharing the base's. Better for large meshes whose far levels use few vertices. Default false."
      ),
    /** Keeps the mesh's open borders in place, so tiling geometry meets its neighbours. Default false. */
    lockBorder: z
      .boolean()
      .optional()
      .describe(
        "Keeps the mesh's open borders in place, so tiling geometry still meets its neighbours. Default false."
      ),
    /** Lets collapses cross attribute seams (flat-shaded geometry needs it). Default false. */
    permissive: z
      .boolean()
      .optional()
      .describe(
        "Lets collapses cross attribute seams. Flat-shaded geometry (a normal per face) doesn't simplify without it. Default false."
      ),
  })
  .describe('generateLodChain options.');

/**
 * An import's `lodChain`: `true` for the default options, or the options. `ImportedAssetSchema`'s.
 * @internal
 */
export const LodChainSchema = z
  .union([z.boolean(), LodChainOptionsSchema])
  .describe(
    "Generates a LOD chain for every rendered geometry of the import after it loads: true for the default options, or the options. A mesh's lod (AUTO) selects its levels. Skinned and morph-target geometry is skipped."
  );
