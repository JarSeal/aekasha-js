import { z } from 'zod';

// `DEFAULT_SPATIAL_DOMAIN` (features/spatial/SpatialDomains.ts), repeated: a schema imports no
// feature code
const DEFAULT_DOMAIN_ID = 'DEFAULT';

// One spatial domain a scene registers for itself: its settings win while the scene is active and
// are dropped on its exit. `DEFAULT` takes a partial entry, merged over its world settings; other
// domains need `cellSize` and `maxMembers`.
const SpatialDomainEntrySchema = z
  .object({
    /** The domain's id; `DEFAULT` is the world's own domain. */
    id: z.string().min(1).describe("The domain's id; DEFAULT is the world's own."),
    /** The world-space edge length of one grid cell. */
    cellSize: z
      .number()
      .positive()
      .optional()
      .describe('The world-space edge length of one grid cell.'),
    /** How many members the domain can hold at once. */
    maxMembers: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe('How many members the domain can hold at once.'),
    /** How the grid is kept current: rebuilt every frame (`DYNAMIC`, default), when a member
     * joins or leaves (`STATIC`), or by `rebuildSpatialDomain` (`MANUAL`). */
    update: z
      .enum(['DYNAMIC', 'STATIC', 'MANUAL'])
      .optional()
      .describe(
        'Grid rebuilds: every frame (DYNAMIC, default), when a member joins or leaves (STATIC), or on request (MANUAL).'
      ),
    /** A member whose radius is over `cellSize` × this goes into the oversized tier instead of a
     * cell. Default 2. */
    oversizedRadiusMultiplier: z
      .number()
      .positive()
      .optional()
      .describe(
        'A member with a radius over cellSize × this goes into the oversized tier. Default 2.'
      ),
  })
  .superRefine((entry, ctx) => {
    if (entry.id === DEFAULT_DOMAIN_ID) return;
    for (const key of ['cellSize', 'maxMembers'] as const) {
      if (entry[key] !== undefined) continue;
      ctx.addIssue({
        code: 'custom',
        path: [key],
        message: `Spatial domain '${entry.id}' needs '${key}' (only '${DEFAULT_DOMAIN_ID}' can leave it out).`,
      });
    }
  })
  .describe(
    'A spatial domain the scene registers: DEFAULT partly, the others with cellSize and maxMembers.'
  );

/**
 * One spatial domain a scene registers for itself (a scene's `spatialDomains` entry). The kernel's
 * `SceneData` and the spatial feature's domains name it.
 * @internal
 */
export type SceneSpatialDomainEntry = z.infer<typeof SpatialDomainEntrySchema>;

/**
 * A scene's `spatialDomains`: the entries, each id once. The spatial feature's schema part
 * (`spatialSchemaPart`) gives it to the scene.
 * @internal
 */
export const SceneSpatialDomainsSchema = z
  .array(SpatialDomainEntrySchema)
  .superRefine((entries, ctx) => {
    const seen = new Set<string>();
    for (let i = 0; i < entries.length; i++) {
      const id = entries[i].id;
      if (seen.has(id)) {
        ctx.addIssue({
          code: 'custom',
          path: [i, 'id'],
          message: `Spatial domain '${id}' is listed more than once.`,
        });
      }
      seen.add(id);
    }
  })
  .describe("The spatial domains the scene registers, each id once; dropped on the scene's exit.");
