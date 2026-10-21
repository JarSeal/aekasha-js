import type { z } from 'zod';

// The schema composition: the kernel's scene and mesh schemas hold the kernel's fields,
// and each feature brings its own as a part, so a schema here never imports a feature. The
// gatherer composes them with every engine feature's part (it validates any app's data).

/**
 * A feature's fields in the gathered JSON: what it adds to a scene and to a mesh, each
 * also allowed in their save entries. `createSceneAssetSchema` and `createMeshAssetSchema` compose
 * the kernel's fields with the parts, and the gatherer's scene manifest lists a part's `feature`
 * for every scene that uses one of its fields.
 */
export type FeatureSchemaPart = {
  /** The feature's id (`EngineFeature.id`): `'skybox'`, `'lod'`, … */
  feature: string;
  /** Fields of a scene (`*.scene.json`), after the kernel's */
  scene?: z.ZodRawShape;
  /** Fields of a mesh's `props` (`*.mesh.json`, a scene's inline meshes), after the kernel's */
  mesh?: z.ZodRawShape;
};

/**
 * The intersection of a union's members (`A | B` → `A & B`), for {@link FeatureSchemaShape}'s
 * fields of every part at once.
 * @template U the members to intersect, as a union
 */
export type UnionToIntersection<U> = (U extends unknown ? (arg: U) => void : never) extends (
  arg: infer I
) => void
  ? I
  : never;

/**
 * The fields the parts add to one schema (`scene` or `mesh`), as one shape type: what
 * `createSceneAssetSchema` and `createMeshAssetSchema` add to the kernel's.
 * @template P the feature schema parts
 * @template K the schema they add to
 */
export type FeatureSchemaShape<
  P extends readonly FeatureSchemaPart[],
  K extends 'scene' | 'mesh',
> = UnionToIntersection<
  P[number] extends infer T ? (T extends Record<K, infer S> ? S : never) : never
>;

/**
 * The parts' fields for one schema, in part order, after `kernelShape`'s. Throws on a field two
 * parts give, or a part gives that the kernel has.
 * @internal
 */
export const mergeFeatureSchemaShapes = (
  kernelShape: z.ZodRawShape,
  parts: readonly FeatureSchemaPart[],
  key: 'scene' | 'mesh'
): z.ZodRawShape => {
  const owners = new Map<string, string>(
    Object.keys(kernelShape).map((field) => [field, 'kernel'])
  );
  const shape: Record<string, z.ZodRawShape[string]> = { ...kernelShape };
  for (const part of parts) {
    for (const [field, schema] of Object.entries(part[key] ?? {})) {
      const owner = owners.get(field);
      if (owner) {
        throw new Error(
          `The feature schema part '${part.feature}' gives the ${key} field '${field}', which '${owner}' already has.`
        );
      }
      owners.set(field, part.feature);
      shape[field] = schema;
    }
  }
  return shape;
};
