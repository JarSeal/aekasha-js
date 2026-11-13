import { z } from 'zod';
import {
  createSaveDataSchema,
  JsonSchemaRefSchema,
  MetaSchema,
  SourcePathSchema,
} from './_SaveDataSchema';
import { DebugDataSchema, UserDataSchema } from './_HelperSchemas';
import { TextureSetArrayInputSchema, TextureSetInputSchema } from './TextureSetSchema';

// `any`, not `unknown`: the runtime's `MatProps` types each material type's three parameters, and
// a record of `unknown` isn't assignable to them (RuntimeTypes.test.ts). The JSON can't type them.
const ThreeJsParamsSchema = z
  .record(z.string(), z.any())
  .describe(
    "That three material's parameters by name (color, roughness, …); a texture map key (map, normalMap, …) takes a texture's id."
  );

/**
 * A TSL input's object-form texture ref (p302 D4): `{ "texture": "id" }` is the texture node a bare
 * id makes, `"channel"` the sample's channels (`TextureInputRef` on `aekasha`).
 */
export const TextureInputRefSchema = z
  .object({
    /** The texture's id. */
    texture: z.string().describe("The texture's id."),
    /** One to four of `r`, `g`, `b`, `a`: the sample's channels (a swizzle), instead of the
     * texture node. */
    channel: z
      .string()
      .regex(/^[rgba]{1,4}$/, 'one to four of r, g, b and a')
      .optional()
      .describe("One to four of r, g, b, a: the sample's channels, instead of the texture node."),
  })
  .strict()
  .describe("A texture ref: the texture node, or with channel its sample's channels (eg. r, rgb).");

/**
 * A TSL input's texture array layer (p299 D5): `{ "textureArray": "id", "layer": "rock" }` is that
 * layer sampled at the mesh's UV (`TextureArrayInputRef` on `aekasha`).
 */
export const TextureArrayInputSchema = z
  .object({
    /** The texture array's id (a `*.textureArray.json`). */
    textureArray: z.string().describe("The texture array's id (a *.textureArray.json)."),
    /** The layer: its index, or its name (a texture layer's id, a file layer's name without its
     * extension). */
    layer: z
      .union([z.number().int().min(0), z.string()])
      .describe(
        "The layer: its index, or its name (a texture layer's id, a file layer's name without its extension)."
      ),
  })
  .strict()
  .describe("A texture array's layer, sampled at the mesh's UV.");

/**
 * A TSL input's atlas cell (p299 D5): `{ "atlas": "id", "slot": "albedo", "cell": "fern" }` is the
 * slot sampled at the mesh's UV mapped into the cell's rect (`AtlasCellInputRef` on `aekasha`).
 */
export const AtlasCellInputSchema = z
  .object({
    /** The atlas's id (a `*.textureAtlas.json`). */
    atlas: z.string().describe("The atlas's id (a *.textureAtlas.json)."),
    /** The slot sampled (a key of the atlas's `slots`). */
    slot: z.string().describe("The slot sampled (a key of the atlas's slots)."),
    /** The cell's id. */
    cell: z.string().describe("The cell's id."),
    /** Keeps the sample half a texel inside the cell's content rect, so a bilinear tap never
     * reaches past its edge texels. Default true. */
    clampToCell: z
      .boolean()
      .optional()
      .describe("Keeps the sample half a texel inside the cell's rect. Default true."),
  })
  .strict()
  .describe("An atlas slot's cell, sampled at the mesh's UV mapped into the cell's rect.");

/** The object forms, by the key that marks each (the runtime's resolvers match the same key) */
const INPUT_REF_FORMS = [
  ['texture', TextureInputRefSchema],
  ['textureArray', TextureArrayInputSchema],
  ['atlas', AtlasCellInputSchema],
  ['textureSet', TextureSetInputSchema],
  ['textureSetArray', TextureSetArrayInputSchema],
] as const;

/**
 * An input group's values (`inputs`, a socket of `nodes`): a value with a form's key (`texture`,
 * `textureArray`, `atlas`, `textureSet`, `textureSetArray`) is checked against that form, its
 * issues at its path; any other value passes (a colour, a number, a vector, an app resolver's form). `staticDefines` isn't an input.
 */
const checkInputRefs = (inputs: Record<string, unknown>, ctx: z.RefinementCtx) => {
  for (const [key, value] of Object.entries(inputs)) {
    if (key === 'staticDefines' || typeof value !== 'object' || value === null) continue;
    const form = INPUT_REF_FORMS.find(([formKey]) => formKey in value);
    if (!form) continue;
    const result = form[1].safeParse(value);
    if (result.success) continue;
    for (const issue of result.error.issues) {
      ctx.addIssue({ ...issue, path: [key, ...issue.path] } as z.core.$ZodRawIssue);
    }
  }
};

// An input value's JSON Schema offers the object forms, then any value: what validates is
// `checkInputRefs`. `any`, not `unknown`, for `nodes` (its socket functions' inputs, typed by the
// runtime's `MatProps`).
const TslNodeInputsSchema = z
  .record(
    z.string(),
    z.union([
      TextureInputRefSchema,
      TextureArrayInputSchema,
      AtlasCellInputSchema,
      TextureSetInputSchema,
      TextureSetArrayInputSchema,
      z.any(),
    ])
  )
  .superRefine(checkInputRefs);

const StaticDefinesSchema = z
  .record(z.string(), z.any())
  .describe('Build-time flags the TSL file branches on: another set is another shader.');

const InputsSchema = z
  .record(
    z.string(),
    z.union([
      TextureInputRefSchema,
      TextureArrayInputSchema,
      AtlasCellInputSchema,
      TextureSetInputSchema,
      TextureSetArrayInputSchema,
      z.unknown(),
    ])
  )
  .superRefine(checkInputRefs)
  .describe(
    "The inputs of the TSL file's setup function, which sets any sockets from one graph: a texture id or { texture: id, channel } (a texture node, or its sample's channels, eg. r or rgb), { textureArray: id, layer } (an array layer) or { atlas: id, slot, cell } (an atlas cell), each sampled at the mesh's UV, { textureSet: id, packing? } (a texture set's textures and surface uniforms, by name) or { textureSetArray: [ids] | id, packing } (a texture set array's array textures and layer params; both the textureSets() feature), a uniform's '#rrggbb' colour, number, boolean, or vector as an array or { x, y, z }, or a form a registered input resolver takes."
  );

const NodesSchema = z
  .record(z.string(), TslNodeInputsSchema)
  .describe(
    "Per socket (colorNode, …), its inputs: a texture id or { texture: id, channel }, { textureArray: id, layer }, { atlas: id, slot, cell }, { textureSet: id, packing? }, { textureSetArray: [ids] | id, packing }, a '#rrggbb' colour, a number, a boolean, a vector as an array or { x, y, z }, or a form a registered input resolver takes. Each becomes a node the TSL file's socket function gets."
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
  /** Over the material's `inputs` (shallowly). */
  inputs: InputsSchema.optional(),
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
    /** Merged over the material's `staticDefines` (shallowly: a nested define object replaces the
     * material's whole): another set is another shader. */
    staticDefines: StaticDefinesSchema.optional(),
    /** Merged over the material's `nodes`, per socket. */
    nodes: NodesSchema.optional(),
    /** Merged over the material's `inputs` (shallowly). */
    inputs: InputsSchema.optional(),
  })
  .describe(
    "The mesh's variant of its material: params, staticDefines, nodes and inputs over its own."
  );

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
  /** Per socket, its inputs: each becomes a node the file's socket function gets (as `inputs`). */
  nodes: NodesSchema.optional(),
  /** The inputs of the file's `setup` function, which sets any sockets from one graph: a texture
   * id (or `{ "texture": id, "channel": "r" }`, its sample's channels) becomes a texture node,
   * `{ "textureArray": id, "layer": … }` an array layer's sample and `{ "atlas": id, "slot": …,
   * "cell": … }` an atlas cell's (both at the mesh's UV), a form a registered input resolver
   * takes its node or bundle (`registerMaterialInputResolver`), any other value a uniform.
   * `setup` runs before the `nodes` sockets' functions. */
  inputs: InputsSchema.optional(),
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
 * `MatProps` for `createMaterial`. A node material type with its TSL file, `staticDefines`,
 * `inputs` and `nodes`, or another three material type with its `params`.
 */
export const MaterialAssetSchema = z
  .discriminatedUnion('type', [TslMaterialSchema, PlainMaterialSchema])
  .describe(
    "A material: its type and three parameters, and a node material's TSL file and inputs."
  );

/**
 * A union with one member per `type` literal, as the runtime's `MatProps` has them: zod infers one
 * object per branch, with the `type` enum, which TypeScript doesn't split on its own.
 * {@link MaterialAsset} is built with it.
 * @template T an object type whose `type` is a union of literals
 */
export type PerType<T> = T extends { type: infer Type }
  ? Type extends unknown
    ? Omit<T, 'type'> & { type: Type }
    : never
  : never;

/** A material JSON (`*.material.json`), one member per `type`, as {@link MaterialAssetSchema}
 * validates it. */
export type MaterialAsset = PerType<z.infer<typeof MaterialAssetSchema>>;
