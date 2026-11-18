// The scatters' limits the schema, the gather and the spawn share: a leaf, so the spawn reads them
// without the schema's zod (`ScatterSchema.ts` is the gather's and the JSON Schemas').

/** The colliders a scatter makes on one target past which the gather and the spawn warn: one
 * `FIXED` body each, so keep them to the large pieces. */
export const SCATTER_COLLIDER_WARNING = 200;
