import { z } from 'zod';
import { createSaveDataSchema, MetaSchema } from './_SaveDataSchema';
import { DebugDataSchema, UserDataSchema } from './_HelperSchemas';

const ThreeJsParamsSchema = z.record(z.string(), z.any());

const TslNodeInputsSchema = z.record(z.string(), z.any());

const MaterialOverridesSchema = z.object({
  __meta: MetaSchema.optional(),
  params: ThreeJsParamsSchema.optional(),
  staticDefines: z.record(z.string(), z.any()).optional(),
  nodes: z.record(z.string(), TslNodeInputsSchema).optional(),
  debugData: DebugDataSchema.optional(),
  userData: UserDataSchema.optional(),
  isPersistent: z.boolean().optional(),
});

/**
 * Per-mesh material overrides (mesh `matOverrides`), see getMaterialVariant.
 * `createMeshAssetSchema`'s `matOverrides`.
 * @internal
 */
export const MaterialVariantOverridesSchema = z.object({
  params: ThreeJsParamsSchema.optional(),
  staticDefines: z.record(z.string(), z.any()).optional(),
  nodes: z.record(z.string(), TslNodeInputsSchema).optional(),
});

const MaterialBaseProps = z.object({
  // Common props
  id: z.string({ error: "Material 'id' key is required." }),
  isPersistent: z.boolean().optional(),
  debugData: DebugDataSchema.optional(),
  userData: UserDataSchema.optional(),

  // Three.js material params
  params: ThreeJsParamsSchema.optional(),

  // Meta
  $schema: z.string().optional(),
  __sourcePath: z.string().optional(),
  __saveData: createSaveDataSchema(MaterialOverridesSchema),
});

// The TSL node materials: a `tslFile` and its inputs
const TslMaterialSchema = MaterialBaseProps.extend({
  tslFile: z.string(),
  staticDefines: z.record(z.string(), z.any()).optional(),
  nodes: z.record(z.string(), TslNodeInputsSchema).optional(),
  type: z.enum([
    'BASICNODEMATERIAL',
    'LAMBERTNODEMATERIAL',
    'PHONGNODEMATERIAL',
    'PHYSICALNODEMATERIAL',
    'STANDARDNODEMATERIAL',
    'MATCAPNODEMATERIAL',
    'NORMALNODEMATERIAL',
    'TOONNODEMATERIAL',
  ]),
});

// three's other materials: `params` only
const PlainMaterialSchema = MaterialBaseProps.extend({
  type: z.enum([
    'LINEBASIC',
    'LINEDASHED',
    'BASIC',
    'DEPTH',
    'DISTANCE',
    'LAMBERT',
    'MATCAP',
    'NORMAL',
    'PHONG',
    'PHYSICAL',
    'STANDARD',
    'TOON',
    'POINTS',
    'SHADERRAW',
    'SHADER',
    'SHADOW',
    'SPRITE',
  ]),
});

export const MaterialAssetSchema = z.discriminatedUnion('type', [
  TslMaterialSchema,
  PlainMaterialSchema,
]);

/**
 * A union with one member per `type` literal, as the runtime's `MatProps` has them: zod infers one
 * object per branch, with the `type` enum, which TypeScript doesn't split on its own.
 * `MaterialAsset` and `RuntimeTypes.test.ts` use it.
 * @internal
 */
export type PerType<T> = T extends { type: infer Type }
  ? Type extends unknown
    ? Omit<T, 'type'> & { type: Type }
    : never
  : never;

export type MaterialAsset = PerType<z.infer<typeof MaterialAssetSchema>>;
