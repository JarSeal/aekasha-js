import { z } from 'zod';
import type { ManagedByData } from '../kernel/ecs/ECSRegistry';

/**
 * A point or direction: `{ x, y, z }`. The camera, light and mesh schemas use it.
 * @internal
 */
export const Vector3Schema = z.object({
  /** The x component. */
  x: z.number().describe('The x component.'),
  /** The y component (up). */
  y: z.number().describe('The y component (up).'),
  /** The z component. */
  z: z.number().describe('The z component.'),
});

/**
 * A quaternion: `{ x, y, z, w }`. A mesh's `quaternion`.
 * @internal
 */
export const Vector4Schema = z.object({
  /** The x component. */
  x: z.number().describe('The x component.'),
  /** The y component. */
  y: z.number().describe('The y component.'),
  /** The z component. */
  z: z.number().describe('The z component.'),
  /** The w (scalar) component. */
  w: z.number().describe('The w (scalar) component.'),
});

/**
 * A colour in a JSON ({@link ColorJSON}). The light, scene and sky box schemas use it.
 * @internal
 */
export const ColorJSONSchema = z
  .union([
    z.string(),
    z.object({
      /** Red, 0-255. */
      r: z.number().describe('Red, 0-255.'),
      /** Green, 0-255. */
      g: z.number().describe('Green, 0-255.'),
      /** Blue, 0-255. */
      b: z.number().describe('Blue, 0-255.'),
    }),
  ])
  .describe('A CSS colour string ("#ff8800", "orange") or { r, g, b } in 0-255, both sRGB.');

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
export const ColorSpaceSchema = z
  .union([z.literal(''), z.literal('srgb'), z.literal('srgb-linear')])
  .describe(
    '"srgb" for colour maps, "srgb-linear" or "" (none) for data: normal, roughness, masks.'
  );

/**
 * An asset's or an entity's `debugData`: what the debug tools show for it. Production data has none
 * (the gatherer strips it). Every asset schema with a `debugData` uses it, and
 * `CoreEntityOptsSchema`.
 * @internal
 */
export const DebugDataSchema = z
  .object({
    /** A display name (the on-screen tools' camera names, the debug listings). */
    name: z.string().optional().describe('The name the debug tools show.'),
    /** A longer description. */
    description: z.string().optional().describe('A longer description for the debug tools.'),
    /** Notes with their times. */
    comments: z
      .array(
        z.object({
          /** When it was written: milliseconds since the UNIX epoch. */
          timestamp: z.number().describe('Milliseconds since the UNIX epoch.'),
          /** The note. */
          comment: z.string().describe('The note.'),
        })
      )
      .optional()
      .describe('Notes with their times.'),
    /** Open items, by key. */
    todo: z.record(z.string(), z.unknown()).optional().describe('Open items, by key.'),
    /** Anything else a debug tool keeps for the entity or asset. */
    debugObj: z
      .record(z.string(), z.unknown())
      .optional()
      .describe('Anything else a debug tool keeps for it.'),
  })
  .describe('What the debug tools show for it. Production data has none.');

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
export const UserDataSchema = z
  .record(z.string(), z.unknown())
  .describe("Free-form data for the app: the entity's USER_DATA, or the asset's userData.");

/**
 * An entity's options in a JSON (the camera, light and mesh JSONs' `entityOpts`):
 * {@link CoreEntityOpts} without its code-only `managedBy`. The camera, light and mesh schemas use it.
 * @internal
 */
export const CoreEntityOptsSchema = z
  .object({
    /** The entity's app id (`getEntityIdByAppId`). Default: a generated UUID. */
    appId: z
      .string()
      .optional()
      .describe("The entity's app id, for getEntityIdByAppId. Default: a generated UUID."),
    /** Creates the entity disabled (a `DISABLED` component). */
    disabled: z.boolean().optional().describe('Creates the entity disabled.'),
    /**
     * Keeps the entity on a scene switch (a `PERSISTENT` component).
     * @remarks Only lines and a directional or spot light's target entity read it today:
     * `createEntity` itself doesn't, so a camera, light or mesh entity from a JSON isn't kept
     * (p619 S8).
     */
    persistent: z
      .boolean()
      .optional()
      .describe(
        "Keeps the entity on a scene switch. Read only by lines and a light's target entity so far."
      ),
    /** Leaves the entity's object out of the root scene (the caller attaches it). */
    doNotAddToScene: z
      .boolean()
      .optional()
      .describe("Leaves the entity's object out of the root scene."),
    /** Free-form data for the app (the entity's `USER_DATA`). */
    userData: UserDataSchema.optional(),
    /** What the debug tools show for the entity (its `DEBUG_DATA`, debug env and prod test only). */
    debugData: DebugDataSchema.optional(),
    /** `false` keeps a mesh or a point or spot light out of the spatial index, which they join by
     * default (`spatial()`). */
    spatialIndex: z
      .boolean()
      .optional()
      .describe('false keeps a mesh or a point or spot light out of the spatial index.'),
    /**
     * Opts a mesh into the ECS frustum culling: its `TAG_FRUSTUM_CULLED` follows the camera's
     * frustum, for gameplay systems (AI throttling, audio culling) to read. Not three's own
     * render-list culling, which a mesh's `frustumCullingEnabled` switches.
     */
    ecsFrustumCullingEnabled: z
      .boolean()
      .optional()
      .describe(
        "A mesh's TAG_FRUSTUM_CULLED follows the camera's frustum, for gameplay systems to read (not three's render culling)."
      ),
  })
  .describe('The entity options: its app id, state, user data and culling.');

/**
 * An entity's options: its app id, whether it starts disabled, is kept on a scene switch or added
 * to the root scene, its user and debug data, and its culling. A camera, light or mesh JSON's
 * `entityOpts`, and every `create*Entity`'s.
 */
export type CoreEntityOpts = z.infer<typeof CoreEntityOptsSchema> & {
  /** Code only (not in the JSON schema): the manager that owns the entity (a MANAGED_BY
   * component). */
  managedBy?: ManagedByData;
};

/**
 * A light's `shadowPreset` ({@link ShadowQuality}). The light and sky box schemas use it.
 * @internal
 */
export const ShadowQualitySchema = z
  .enum(['LOW', 'MEDIUM', 'HIGH', 'ULTRA'])
  .describe('The shadow quality preset (default MEDIUM), which the shadow* fields fine-tune.');

/**
 * A light's shadow quality preset (`MEDIUM` by default): the light's `shadowPreset`. The runtime's
 * `LightProps` and the sky box's lights name it.
 * @internal
 */
export type ShadowQuality = z.infer<typeof ShadowQualitySchema>;
