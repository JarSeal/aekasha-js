import { z } from 'zod';

const SemverSchema = z
  .string()
  .regex(/^\d+\.\d+\.\d+$/, { error: 'Version must be a MAJOR.MINOR.PATCH semver string.' });

/**
 * A save entry's `__meta`: when it was saved, and the versions of each part then. Whatever writes
 * a save entry stamps all three versions; the gatherer warns when an applied entry comes from
 * another major version than the current build's.
 */
export const MetaSchema = z
  .object({
    /** When the entry was saved: milliseconds since the UNIX epoch (`Date.now()`). */
    date: z
      .number({
        error: 'The save time must be a number: milliseconds since the UNIX epoch (Date.now()).',
      })
      .optional()
      .describe('When the entry was saved: milliseconds since the UNIX epoch.'),
    /** The engine's version when the entry was saved. Older entries have none. */
    engineVersion: SemverSchema.optional().describe("The engine's version when it was saved."),
    /** The toolkit's version when the entry was saved. */
    toolkitVersion: SemverSchema.optional().describe("The toolkit's version when it was saved."),
    /** The app's version when the entry was saved. */
    appVersion: SemverSchema.optional().describe("The app's version when it was saved."),
  })
  .describe('When the entry was saved, and the versions of each part then.');

/**
 * An asset's `__saveData`: per scene id, its save entries, newest first (the gatherer applies only
 * the first), each validated by `propertyOverrideObject`. A ZodType, not only a ZodObject: an
 * overrides schema can be wrapped (the sky box's legacy adapter is a `z.preprocess`). Every asset
 * schema with save entries, the sky box's included.
 * @internal
 */
export function createSaveDataSchema<T extends z.ZodType>(propertyOverrideObject: T) {
  return z
    .record(z.string(), z.array(propertyOverrideObject))
    .optional()
    .describe(
      'Per scene id, its save entries, newest first: the gatherer applies only the first, over the asset. Written by the debugger and the dev files.'
    );
}

/**
 * An asset JSON's `$schema`: the JSON Schema in `.schemas/` an editor validates the file with.
 * Every asset schema's.
 * @internal
 */
export const JsonSchemaRefSchema = z
  .string()
  .describe(
    'The JSON Schema in .schemas/ an editor validates this file with. The gatherer ignores it.'
  );

/**
 * An asset's `__sourcePath`: the JSON file it came from, which the gatherer sets. Every asset
 * schema's.
 * @internal
 */
export const SourcePathSchema = z
  .string()
  .describe('Set by the gatherer: the JSON file the asset came from. Not written by hand.');
