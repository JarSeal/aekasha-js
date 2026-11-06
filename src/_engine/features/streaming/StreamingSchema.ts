import { z } from 'zod';
import type { FeatureSchemaPart } from '../../schemas/FeatureSchemas';

/**
 * The smallest streaming cell size, in metres: a cell is a power of two of at least this, so
 * p306's terrain blocks (32-256 m) tile it exactly.
 */
export const STREAMING_MIN_CELL_SIZE = 32;

/**
 * The rings a scene's `streaming` leaves out: the outermost ring (Chebyshev distance in cells from
 * the focus cell) of each loaded state. A cell beyond `far` is unloaded.
 */
export const DEFAULT_STREAMING_RINGS = { resident: 1, nearby: 2, far: 5 } as const;

const isStreamingCellSize = (size: number) =>
  size >= STREAMING_MIN_CELL_SIZE && Number.isInteger(Math.log2(size));

const RingSchema = z.number().int().min(0);

/**
 * A scene's streaming rings (`streaming.rings`): each state's outermost ring, in cells
 * (Chebyshev distance from the focus cell), `resident <= nearby <= far`. A ring equal to the one
 * before it gives its state no cells. Each one left out is {@link DEFAULT_STREAMING_RINGS}'.
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
  })
  .strict()
  .superRefine((settings, ctx) => {
    const resident = settings.rings?.resident ?? DEFAULT_STREAMING_RINGS.resident;
    const nearby = settings.rings?.nearby ?? DEFAULT_STREAMING_RINGS.nearby;
    const far = settings.rings?.far ?? DEFAULT_STREAMING_RINGS.far;
    if (resident > nearby || nearby > far) {
      ctx.addIssue({
        code: 'custom',
        path: ['rings'],
        message: `streaming.rings must be resident <= nearby <= far (with the defaults: ${resident}, ${nearby}, ${far}).`,
      });
    }
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
