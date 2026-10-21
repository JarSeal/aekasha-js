import { z } from 'zod';
import {
  createSaveDataSchema,
  JsonSchemaRefSchema,
  MetaSchema,
  SourcePathSchema,
} from './_SaveDataSchema';
import { CoreEntityOptsSchema, Vector3Schema, Vector4Schema } from './_HelperSchemas';
import { GeoPropsSchema } from './GeometrySchema';
import { MaterialAssetSchema, MaterialVariantOverridesSchema } from './MaterialSchema';
import {
  type FeatureSchemaPart,
  type FeatureSchemaShape,
  mergeFeatureSchemaShapes,
} from './FeatureSchemas';

// The mesh fields a save entry also takes, documented once (`pick` keeps the order)
const MESH_FIELDS = {
  /** Per-mesh material overrides: the mesh gets a cached variant of its material. */
  matOverrides: MaterialVariantOverridesSchema.optional(),
  /** Casts shadows. Default false. */
  castShadow: z.boolean().optional().describe('Casts shadows. Default false.'),
  /** Receives shadows. Default false. */
  receiveShadow: z.boolean().optional().describe('Receives shadows. Default false.'),
  /** Compiles its pipelines at creation (and its LOD levels' when it gets a LOD), so its first
   * frame doesn't stall on it. */
  preWarm: z
    .boolean()
    .optional()
    .describe("Compiles its pipelines at creation, so its first frame doesn't stall on it."),
  /** Where the mesh is. Default: the origin. */
  position: Vector3Schema.optional().describe('Where the mesh is. Default: the origin.'),
  /** Euler angles in radians; `quaternion` wins over it. */
  rotation: Vector3Schema.optional().describe('Euler angles in radians; quaternion wins over it.'),
  /** A rotation quaternion. */
  quaternion: Vector4Schema.optional().describe('A rotation quaternion.'),
  /** The id a scene lists the JSON by (default: the file's name), and the entity's app id, over
   * `entityOpts.appId` (default: a generated UUID). */
  appId: z
    .string()
    .optional()
    .describe(
      "The id scenes list it by (default: the file's name), and the entity's app id (default: a UUID)."
    ),
  /** three's own render-list culling (`Object3D.frustumCulled`). Default true. Not the ECS
   * frustum culling, which `entityOpts.ecsFrustumCullingEnabled` opts into. */
  frustumCullingEnabled: z
    .boolean()
    .optional()
    .describe("three's own render-list culling (Object3D.frustumCulled). Default true."),
};

/** `MESH_FIELDS`' `keys`, in that order */
const pick = <K extends keyof typeof MESH_FIELDS>(...keys: K[]) =>
  Object.fromEntries(keys.map((key) => [key, MESH_FIELDS[key]])) as Pick<typeof MESH_FIELDS, K>;

const TRANSFORM_FIELDS = ['position', 'rotation', 'quaternion'] as const;

// The kernel's mesh props; the features' follow them (createMeshAssetSchema)
const KERNEL_MESH_PROPS_SHAPE = {
  /** The geometry: its props, or the id of a geometry the scene registers. */
  geo: z
    .union([GeoPropsSchema, z.string()])
    .describe("The geometry: its props, or a geometry's id."),
  /** The material: its props, or the id of a material the scene creates. */
  mat: z
    .union([MaterialAssetSchema, z.string()])
    .describe("The material: its props, or a material's id."),
  ...pick('matOverrides', 'castShadow', 'receiveShadow', 'preWarm', ...TRANSFORM_FIELDS),
  ...pick('appId', 'frustumCullingEnabled'),
};

const PartialGeoProps = z.union(GeoPropsSchema.options.map((variant) => variant.partial()));
const PartialMatProps = z.union(MaterialAssetSchema.options.map((variant) => variant.partial()));

// The kernel's fields of a mesh's save entry (`__meta` last, after the features')
const KERNEL_MESH_OVERRIDES_SHAPE = {
  /** Replaces the mesh's geometry: props, or a geometry's id. */
  geo: z.union([PartialGeoProps, z.string()]).optional(),
  /** Replaces the mesh's material: props, or a material's id. */
  mat: z.union([PartialMatProps, z.string()]).optional(),
  ...pick('matOverrides', 'castShadow', 'receiveShadow', 'preWarm', ...TRANSFORM_FIELDS),
  ...pick('frustumCullingEnabled'),
};

/**
 * The mesh schema (`*.mesh.json`) with the features' fields: the kernel's `props`,
 * then each part's `mesh` fields in part order, each also allowed in the mesh's save entries
 * (where it replaces the whole field: a save entry merges shallowly). The gatherer composes it
 * with every engine feature's part. Throws on a field two parts give.
 */
export const createMeshAssetSchema = <const P extends readonly FeatureSchemaPart[]>(parts: P) => {
  type PartsShape = FeatureSchemaShape<P, 'mesh'>;
  const MeshPropsSchema = z
    .object(
      mergeFeatureSchemaShapes(
        KERNEL_MESH_PROPS_SHAPE,
        parts,
        'mesh'
      ) as typeof KERNEL_MESH_PROPS_SHAPE & PartsShape
    )
    .describe('The mesh: its geometry and material, shadows, transform and culling.');
  const MeshOverridesSchema = z.object({
    ...(mergeFeatureSchemaShapes(
      KERNEL_MESH_OVERRIDES_SHAPE,
      parts,
      'mesh'
    ) as typeof KERNEL_MESH_OVERRIDES_SHAPE & PartsShape),
    /** When the entry was saved, and the versions then. */
    __meta: MetaSchema.optional(),
  });
  return z.object({
    /** The JSON Schema an editor validates the file with. */
    $schema: JsonSchemaRefSchema.optional(),
    /** The mesh's props: its geometry and material, shadows, transform, culling, and the parts'
     * fields. */
    props: MeshPropsSchema,
    /** The mesh entity's options. */
    entityOpts: CoreEntityOptsSchema.optional(),
    /** Set by the gatherer: the file it came from. */
    __sourcePath: SourcePathSchema.optional(),
    /** Per scene id, its save entries over `props` (the first applies; each field replaced
     * whole). */
    __saveData: createSaveDataSchema(MeshOverridesSchema),
  });
};

/** A mesh JSON with the kernel's `props` (the features' are typed by `createMeshAssetSchema` with
 * their parts). */
export type MeshAsset = z.infer<ReturnType<typeof createMeshAssetSchema<[]>>>;
