import { z } from 'zod';
import { createSaveDataSchema, MetaSchema } from './_SaveDataSchema';
import { CoreEntityOptsSchema, Vector3Schema, Vector4Schema } from './_HelperSchemas';
import { GeoPropsSchema } from './GeometrySchema';
import { MaterialAssetSchema, MaterialVariantOverridesSchema } from './MaterialSchema';
import {
  type FeatureSchemaPart,
  type FeatureSchemaShape,
  mergeFeatureSchemaShapes,
} from './FeatureSchemas';

// The kernel's mesh props; the features' follow them (createMeshAssetSchema)
const KERNEL_MESH_PROPS_SHAPE = {
  geo: z.union([GeoPropsSchema, z.string()]),
  mat: z.union([MaterialAssetSchema, z.string()]),
  matOverrides: MaterialVariantOverridesSchema.optional(),
  castShadow: z.boolean().optional(),
  receiveShadow: z.boolean().optional(),
  preWarm: z.boolean().optional(),
  position: Vector3Schema.optional(),
  rotation: Vector3Schema.optional(),
  quaternion: Vector4Schema.optional(),
  appId: z.string().optional(),
  /** Native Object3D.frustumCulled (Three.js's own per-mesh render-list culling). Defaults to Three's own default (true). */
  frustumCullingEnabled: z.boolean().optional(),
  // physicsParams: z.union([]),
};

const PartialGeoProps = z.union(GeoPropsSchema.options.map((variant) => variant.partial()));
const PartialMatProps = z.union(MaterialAssetSchema.options.map((variant) => variant.partial()));

// The kernel's fields of a mesh's save entry (`__meta` last, after the features')
const KERNEL_MESH_OVERRIDES_SHAPE = {
  geo: z.union([PartialGeoProps, z.string()]).optional(),
  mat: z.union([PartialMatProps, z.string()]).optional(),
  matOverrides: MaterialVariantOverridesSchema.optional(),
  castShadow: z.boolean().optional(),
  receiveShadow: z.boolean().optional(),
  preWarm: z.boolean().optional(),
  position: Vector3Schema.optional(),
  rotation: Vector3Schema.optional(),
  quaternion: Vector4Schema.optional(),
  frustumCullingEnabled: z.boolean().optional(),
};

/**
 * The mesh schema (`*.mesh.json`) with the features' fields (p607 D10): the kernel's `props`,
 * then each part's `mesh` fields in part order, each also allowed in the mesh's save entries
 * (where it replaces the whole field: a save entry merges shallowly). The gatherer composes it
 * with every engine feature's part. Throws on a field two parts give.
 */
export const createMeshAssetSchema = <const P extends readonly FeatureSchemaPart[]>(parts: P) => {
  type PartsShape = FeatureSchemaShape<P, 'mesh'>;
  const MeshPropsSchema = z.object(
    mergeFeatureSchemaShapes(
      KERNEL_MESH_PROPS_SHAPE,
      parts,
      'mesh'
    ) as typeof KERNEL_MESH_PROPS_SHAPE & PartsShape
  );
  const MeshOverridesSchema = z.object({
    ...(mergeFeatureSchemaShapes(
      KERNEL_MESH_OVERRIDES_SHAPE,
      parts,
      'mesh'
    ) as typeof KERNEL_MESH_OVERRIDES_SHAPE & PartsShape),
    __meta: MetaSchema.optional(),
  });
  return z.object({
    $schema: z.string().optional(),
    props: MeshPropsSchema,
    entityOpts: CoreEntityOptsSchema.optional(),
    __sourcePath: z.string().optional(),
    __saveData: createSaveDataSchema(MeshOverridesSchema),
  });
};

/** A mesh JSON with the kernel's `props` (the features' are typed by `createMeshAssetSchema` with
 * their parts). */
export type MeshAsset = z.infer<ReturnType<typeof createMeshAssetSchema<[]>>>;
