import { z } from 'zod';
import type { FeatureSchemaPart } from '../../schemas/FeatureSchemas';
import {
  getStreamingSettingsProblem,
  isStreamingCellSize,
  STREAMING_MIN_CELL_SIZE,
} from './StreamingSettings';

const RingSchema = z.number().int().min(0);

/**
 * A scene's streaming rings (`streaming.rings`): each state's outermost ring, in cells
 * (Chebyshev distance from the focus cell), `resident <= nearby <= far`. A ring equal to the one
 * before it gives its state no cells. Each one left out is `DEFAULT_STREAMING_RINGS`'.
 */
export const StreamingRingsSchema = z
  .object({
    /** The outermost `RESIDENT` ring: everything loaded, all LOD levels. Default 1. */
    resident: RingSchema.optional().describe(
      'The outermost RESIDENT ring, in cells from the focus cell. Default 1.'
    ),
    /** The outermost `NEARBY` ring: loaded and primed, LOD selection decides what's drawn. Default 2. */
    nearby: RingSchema.optional().describe(
      'The outermost NEARBY ring, in cells from the focus cell. Default 2.'
    ),
    /** The outermost `FAR` ring: only far representations (until those exist, `FAR` is
     * `UNLOADED`). Default 5. */
    far: RingSchema.optional().describe(
      'The outermost FAR ring, in cells from the focus cell; beyond it a cell is unloaded. Default 5.'
    ),
  })
  .strict();

/**
 * A scene's streaming settings (the `streaming()` feature's scene field, p353 §2): the world is
 * cut into square `cellSize` cells on x/z, and each cell's content is loaded, reduced or unloaded
 * by its ring around the focus.
 */
export const SceneStreamingSchema = z
  .object({
    /** The cell side in metres: a power of two, at least {@link STREAMING_MIN_CELL_SIZE}. */
    cellSize: z
      .number()
      .refine(isStreamingCellSize, {
        error: `streaming.cellSize must be a power of two of at least ${STREAMING_MIN_CELL_SIZE}.`,
      })
      .describe('The cell side in metres: a power of two, at least 32.'),
    /** Each state's outermost ring; see {@link StreamingRingsSchema}. */
    rings: StreamingRingsSchema.optional().describe(
      "Each state's outermost ring, in cells from the focus cell."
    ),
    /** How far past a ring the focus must be before a cell is demoted, in metres from the focus
     * to the cell's edge, so standing on a boundary never thrashes. Default `cellSize / 4`. */
    margin: z
      .number()
      .min(0)
      .optional()
      .describe('Metres past a ring before a cell is demoted. Default cellSize / 4.'),
    /** Build time only (the gather's cell manifest): the mesh and light app ids and the asset ids
     * kept in the scene's base, loaded with the scene and never unloaded, instead of in the cell
     * their position is in (an asset: instead of with the cells that use it). Scene code gets only
     * base assets, so an asset it needs goes here. Cameras, sky boxes and the ambient, hemisphere
     * and directional lights are base anyway. */
    base: z
      .array(z.string())
      .optional()
      .describe(
        "Build time only: mesh and light app ids and asset ids kept in the scene's base (loaded with the scene) instead of in a cell."
      ),
    /** Build time only: bounding radii in metres by mesh app id, for meshes whose geometry the
     * gather can't measure (an import's): over `cellSize / 2`, a mesh goes into every cell it
     * overlaps and stays while any of them is loaded. A primitive geometry's radius comes from
     * its params. */
    radii: z
      .record(z.string(), z.number().min(0))
      .optional()
      .describe(
        "Build time only: bounding radii by mesh app id, for geometries the gather can't measure (an import's)."
      ),
  })
  .strict()
  .superRefine((settings, ctx) => {
    // The cell size has its own refine; the rest is the runtime's check
    if (!isStreamingCellSize(settings.cellSize)) return;
    const problem = getStreamingSettingsProblem(settings);
    if (problem) ctx.addIssue({ code: 'custom', path: ['rings'], message: problem });
  });

/** A scene's streaming settings (`*.scene.json`'s `streaming`, or set in code before its load). */
export type SceneStreamingSettings = z.infer<typeof SceneStreamingSchema>;

/** The streaming feature's scene field (p607 D10): a scene that streams names `streaming()`. */
export const streamingSchemaPart = {
  feature: 'streaming',
  scene: {
    /** Cuts the scene into square cells loaded by their distance to the focus (`streaming()`): `{ cellSize, rings?, margin? }`. */
    streaming: SceneStreamingSchema.optional(),
  },
} satisfies FeatureSchemaPart;
