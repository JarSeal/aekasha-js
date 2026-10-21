import { z } from 'zod';
import type { ManagedByData } from '../kernel/ecs/ECSRegistry';

/**
 * A point or direction: `{ x, y, z }`. The camera, light and mesh schemas use it.
 * @internal
 */
export const Vector3Schema = z.object({
  x: z.number(),
  y: z.number(),
  z: z.number(),
});

/**
 * A quaternion: `{ x, y, z, w }`. A mesh's `quaternion`.
 * @internal
 */
export const Vector4Schema = z.object({
  x: z.number(),
  y: z.number(),
  z: z.number(),
  w: z.number(),
});

/**
 * A colour in a JSON ({@link ColorJSON}). The light, scene and sky box schemas use it.
 * @internal
 */
export const ColorJSONSchema = z.union([
  z.string(),
  z.object({
    r: z.number(),
    g: z.number(),
    b: z.number(),
  }),
]);

/**
 * A colour in an asset JSON: a CSS colour string (`"#ff8800"`, `"orange"`) or `{ r, g, b }` in
 * 0-255, both sRGB. A light's colours, a scene's `backgroundColor` and the sky box's colours take
 * it; the runtime types also take three's colour forms.
 */
export type ColorJSON = z.infer<typeof ColorJSONSchema>;

/**
 * A texture's colour space: three's `''` (none), `'srgb'` or `'srgb-linear'`. `TexOptsSchema` and
 * the sky box schema use it.
 * @internal
 */
export const ColorSpaceSchema = z.union([
  z.literal(''),
  z.literal('srgb'),
  z.literal('srgb-linear'),
]);

/**
 * An asset's or an entity's `debugData`: what the debug tools show for it. Production data has none
 * (the gatherer strips it). Every asset schema with a `debugData` uses it, and
 * `CoreEntityOptsSchema`.
 * @internal
 */
export const DebugDataSchema = z.object({
  /** A display name (the on-screen tools' camera names, the debug listings). */
  name: z.string().optional(),
  /** A longer description. */
  description: z.string().optional(),
  /** Notes with their times. */
  comments: z
    .array(
      z.object({
        timestamp: z.number(),
        comment: z.string(),
      })
    )
    .optional(),
  /** Open items, by key. */
  todo: z.record(z.string(), z.unknown()).optional(),
  /** Anything else a debug tool keeps for the entity or asset. */
  debugObj: z.record(z.string(), z.unknown()).optional(),
});

/**
 * An asset's or an entity's `debugData` ({@link DebugDataSchema}). The ECS's `EntityDebugData` has
 * the same fields (`RuntimeTypes.test.ts`).
 * @internal
 */
export type DebugData = z.infer<typeof DebugDataSchema>;

/**
 * Free-form data an asset or entity carries for the app (its `userData`). The asset schemas and
 * `CoreEntityOptsSchema` use it.
 * @internal
 */
export const UserDataSchema = z.record(z.string(), z.unknown());

/**
 * An entity's options in a JSON (the camera, light and mesh JSONs' `entityOpts`): {@link
 * CoreEntityOpts} without its code-only `managedBy`. The camera, light and mesh schemas use it.
 * @internal
 */
export const CoreEntityOptsSchema = z.object({
  appId: z.string().optional(),
  disabled: z.boolean().optional(),
  persistent: z.boolean().optional(),
  doNotAddToScene: z.boolean().optional(),
  userData: UserDataSchema.optional(),
  debugData: DebugDataSchema.optional(),
  /** Opt out of the spatial index (docs/plans/_DONE_p050_spatial-index.md §3.1) for an entity kind whose manager opts in by default. */
  spatialIndex: z.boolean().optional(),
  /**
   * Opt in to the ECS-queryable frustum-culling mechanism (docs/plans/_DONE_p080_object3d-frustum-culling.md §2.1/§2.4)
   * — toggles ComponentType.TAG_FRUSTUM_CULLED as the camera frustum moves, for gameplay systems (AI
   * throttling, audio culling, LOD) to react to. Distinct from a mesh's `frustumCullingEnabled` prop
   * (meshSchema.ts), which controls Three's own native Object3D.frustumCulled render-time culling.
   */
  ecsFrustumCullingEnabled: z.boolean().optional(),
});

export type CoreEntityOpts = z.infer<typeof CoreEntityOptsSchema> & {
  /** Code only (not in the JSON schema): the manager that owns the entity (a MANAGED_BY
   * component). */
  managedBy?: ManagedByData;
};

/**
 * A light's `shadowPreset` ({@link ShadowQuality}). The light and sky box schemas use it.
 * @internal
 */
export const ShadowQualitySchema = z.enum(['LOW', 'MEDIUM', 'HIGH', 'ULTRA']);

/**
 * A light's shadow quality preset (`MEDIUM` by default): the light's `shadowPreset`. The runtime's
 * `LightProps` and the sky box's lights name it.
 * @internal
 */
export type ShadowQuality = z.infer<typeof ShadowQualitySchema>;
