import { z } from 'zod';
import {
  createSaveDataSchema,
  JsonSchemaRefSchema,
  MetaSchema,
  SourcePathSchema,
} from './_SaveDataSchema';
import { DebugDataSchema, UserDataSchema } from './_HelperSchemas';

// `any`, not `unknown`: the runtime's `MatProps` types each material type's three parameters, and
// a record of `unknown` isn't assignable to them (RuntimeTypes.test.ts). The JSON can't type them.
const ThreeJsParamsSchema = z
  .record(z.string(), z.any())
  .describe(
    "That three material's parameters by name (color, roughness, …); a texture map key (map, normalMap, …) takes a texture's id."
  );

const TslNodeInputsSchema = z.record(z.string(), z.any());

const StaticDefinesSchema = z
  .record(z.string(), z.any())
  .describe('Build-time flags the TSL file branches on: another set is another shader.');

const NodesSchema = z
  .record(z.string(), TslNodeInputsSchema)
  .describe(
    "Per socket (colorNode, …), its inputs: a texture id, a '#rrggbb' colour, a number, a boolean, or a vector as an array or { x, y, z }. Each becomes a uniform the TSL file's socket function gets."
  );

const MaterialOverridesSchema = z.object({
  /** When the entry was saved, and the versions then. */
  __meta: MetaSchema.optional(),
  /** Over the material's `params` (shallowly). */
  params: ThreeJsParamsSchema.optional(),
  /** Over the material's `staticDefines`. */
  staticDefines: StaticDefinesSchema.optional(),
  /** Over the material's `nodes`, per socket. */
  nodes: NodesSchema.optional(),
  /** Over the material's `debugData`. */
  debugData: DebugDataSchema.optional(),
  /** Over the material's `userData`. */
  userData: UserDataSchema.optional(),
  /** Over the material's `isPersistent`. */
  isPersistent: z.boolean().optional(),
});

/**
 * A mesh's `matOverrides`: what its variant of the material changes (the runtime's
 * `MaterialVariantOverrides`, see `getMaterialVariant`). `createMeshAssetSchema`'s
 * `matOverrides`.
 * @internal
 */
export const MaterialVariantOverridesSchema = z
  .object({
    /** Merged over the material's `params` (shallowly). */
    params: ThreeJsParamsSchema.optional(),
    /** Merged over the material's `staticDefines` (shallowly): another set is another shader. */
    staticDefines: StaticDefinesSchema.optional(),
    /** Merged over the material's `nodes`, per socket. */
    nodes: NodesSchema.optional(),
  })
  .describe("The mesh's variant of its material: params, staticDefines and nodes over its own.");

const MaterialBaseProps = z.object({
  /** The registry id, which scenes and meshes name the material by. */
  id: z
    .string({ error: "Material 'id' key is required." })
    .describe('The registry id scenes and meshes name it by.'),
  /** Never released by its scene or its last ref: only `deleteMaterial` removes it. */
  isPersistent: z
    .boolean()
    .optional()
    .describe('Never released by its scene or its last ref (only deleteMaterial removes it).'),
  /** What the debug tools show for the material. */
  debugData: DebugDataSchema.optional(),
  /** The material's `userData` (the engine adds its own keys: `id`, `type`, `uniforms`, …). */
  userData: UserDataSchema.optional(),
  /** That three material's parameters; a texture map key takes a texture's id. */
  params: ThreeJsParamsSchema.optional(),
  /** The JSON Schema an editor validates the file with. */
  $schema: JsonSchemaRefSchema.optional(),
  /** Set by the gatherer: the file it came from. */
  __sourcePath: SourcePathSchema.optional(),
  /** Per scene id, its save entries over the material (the first applies). */
  __saveData: createSaveDataSchema(MaterialOverridesSchema),
});

// The TSL node materials: a `tslFile` and its inputs
const TslMaterialSchema = MaterialBaseProps.extend({
  /** The TSL file (exporting the socket functions), relative to the first folder under `src/`
   * (`"materials/asteroid/asteroid.tsl.ts"`). */
  tslFile: z
    .string()
    .describe(
      'The TSL file, relative to the first folder under src/ ("materials/asteroid/asteroid.tsl.ts").'
    ),
  /** Build-time flags the TSL file branches on. */
  staticDefines: StaticDefinesSchema.optional(),
  /** Per socket, its inputs: each becomes a uniform the file's socket function gets. */
  nodes: NodesSchema.optional(),
  /** A node material type: three's node material of that name, with the TSL file's sockets. */
  type: z
    .enum([
      'BASICNODEMATERIAL',
      'LAMBERTNODEMATERIAL',
      'PHONGNODEMATERIAL',
      'PHYSICALNODEMATERIAL',
      'STANDARDNODEMATERIAL',
      'MATCAPNODEMATERIAL',
      'NORMALNODEMATERIAL',
      'TOONNODEMATERIAL',
    ])
    .describe("A node material: three's node material of that name, with the TSL file's sockets."),
});

// three's other materials: `params` only
const PlainMaterialSchema = MaterialBaseProps.extend({
  /** A three material type (`STANDARD` is `MeshStandardMaterial`, `LINEBASIC` `LineBasicMaterial`). */
  type: z
    .enum([
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
    ])
    .describe('A three material: STANDARD is MeshStandardMaterial, LINEBASIC LineBasicMaterial, …'),
});

/**
 * A material JSON (`*.material.json`, a scene's or a mesh's inline material): the runtime's
 * `MatProps` for `createMaterial`. A node material type with its TSL file, `staticDefines` and
 * `nodes`, or another three material type with its `params`.
 */
export const MaterialAssetSchema = z
  .discriminatedUnion('type', [TslMaterialSchema, PlainMaterialSchema])
  .describe(
    "A material: its type and three parameters, and a node material's TSL file and inputs."
  );

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

/** A material JSON (`*.material.json`), one member per `type`, as {@link MaterialAssetSchema}
 * validates it. */
export type MaterialAsset = PerType<z.infer<typeof MaterialAssetSchema>>;
