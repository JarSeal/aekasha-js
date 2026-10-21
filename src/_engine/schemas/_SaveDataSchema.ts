import { z } from 'zod';

const SemverSchema = z
  .string()
  .regex(/^\d+\.\d+\.\d+$/, { error: 'Version must be a MAJOR.MINOR.PATCH semver string.' });

export const MetaSchema = z.object({
  date: z
    .number({
      error: 'The save time must be a number: milliseconds since the UNIX epoch (Date.now()).',
    })
    .optional(),

  // Versions of each part when this entry was saved. Whatever writes a save entry should stamp
  // all three: gatherAppData warns when one is from another major version than the current
  // build. Optional, older entries have none.
  engineVersion: SemverSchema.optional(),
  toolkitVersion: SemverSchema.optional(),
  appVersion: SemverSchema.optional(),

  // Possible additions for future implementations:
  // author: z.string().optional(),
});

/**
 * An asset's `__saveData`: per scene id, its save entries, newest first (the gatherer applies only
 * the first), each validated by `propertyOverrideObject`. A ZodType, not only a ZodObject: an
 * overrides schema can be wrapped (the sky box's legacy adapter is a `z.preprocess`). Every asset
 * schema with save entries, the sky box's included.
 * @internal
 */
export function createSaveDataSchema<T extends z.ZodType>(propertyOverrideObject: T) {
  return z
    .record(
      z.string(), // Scene ID
      z.array(propertyOverrideObject)
    )
    .optional();
}
