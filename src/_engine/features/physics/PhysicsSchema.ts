import { z } from 'zod';
import type { FeatureSchemaPart } from '../../schemas/FeatureSchemas';

// Physics' scene field (p102 Phase 4): a scene's world bounds in its JSON, kept for the scene when
// the scenes are registered (physics' `sceneRegistered` hook), as setSceneWorldBounds keeps a
// code's. A scene that sets them names the `physics()` feature in its manifest.

const AXES = ['x', 'y', 'z'] as const;

/** One corner of the box: each axis optional, a missing one open. */
const WorldBoundsCornerSchema = z.strictObject({
  /** The world x, in metres. */
  x: z.number().optional().describe('The world x, in metres. Missing: open on this axis.'),
  /** The world y, in metres. */
  y: z.number().optional().describe('The world y, in metres. Missing: open on this axis.'),
  /** The world z, in metres. */
  z: z.number().optional().describe('The world z, in metres. Missing: open on this axis.'),
});

/**
 * A scene's world bounds in its JSON: the box (every side optional, a missing one open) and the
 * action, `WorldBoundsDef` without its callback. So no `'CALLBACK'`: a scene-wide `onExit` is
 * code, `setSceneWorldBounds` in the scene's code. Each axis given on both corners has its `min`
 * below its `max`.
 */
export const SceneWorldBoundsSchema = z
  .strictObject({
    /** The lower corner: a body whose translation is below it on an axis is outside. */
    min: WorldBoundsCornerSchema.optional().describe(
      'The lower corner: a dynamic body whose translation is below it on an axis is outside.'
    ),
    /** The upper corner: a body whose translation is above it on an axis is outside. */
    max: WorldBoundsCornerSchema.optional().describe(
      'The upper corner: a dynamic body whose translation is above it on an axis is outside.'
    ),
    /** What happens to an exited body's entity, unless it has its own action. Default `DELETE`. */
    action: z
      .enum(['DELETE', 'DISABLE'])
      .optional()
      .describe(
        "What happens to an exited body's entity, unless the entity has its own action: DELETE (the default) or DISABLE. A CALLBACK needs code: setSceneWorldBounds in the scene's code."
      ),
  })
  .superRefine((bounds, ctx) => {
    for (const axis of AXES) {
      const min = bounds.min?.[axis];
      const max = bounds.max?.[axis];
      if (min === undefined || max === undefined || min < max) continue;
      ctx.addIssue({
        code: 'custom',
        path: ['max', axis],
        message: `max.${axis} (${max}) must be above min.${axis} (${min}): every body would be outside.`,
      });
    }
  })
  .describe(
    "The scene's world bounds (the physics() feature): a dynamic body that leaves the box is taken out of the simulation and its entity deleted (or disabled). Every side is optional, a missing one open: { min: { y: -50 } } is a kill height. null turns off AppConfig.physics.worldBounds for this scene."
  );

/** A scene's world bounds in its JSON (`worldBounds`): the box and the action, no callback. */
export type SceneWorldBounds = z.infer<typeof SceneWorldBoundsSchema>;

/** Physics' scene field (p102 Phase 4): a scene that sets `worldBounds` names `physics()` (a `null`
 * one doesn't: without physics there are no bounds to turn off). */
export const physicsSchemaPart = {
  feature: 'physics',
  scene: {
    /** The scene's world bounds (`physics()`): `{ min?: { x?, y?, z? }, max?: { x?, y?, z? }, action? }`, or null for none (over `AppConfig.physics.worldBounds`). Its code's `setSceneWorldBounds` replaces them. */
    worldBounds: SceneWorldBoundsSchema.nullable().optional(),
  },
} satisfies FeatureSchemaPart;
