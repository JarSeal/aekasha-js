import type * as THREE from 'three/webgpu';
import { lwarn } from '../../../utils/Logger';
import type { ColliderParams } from '../types/PhysicsColliderTypes';
import type { ImportedGeometryInfo, Vector3Like } from '../../../kernel/assets/import/ImportTypes';
import { getColliderBounds, toSpineAxis } from './ColliderBounds';
import { deriveHeightfield } from './HeightfieldFromGeometry';

/** What a collider's shape is derived from: a registered geometry and its node's metadata. */
export type ColliderSource = { geometry: THREE.BufferGeometry; info: ImportedGeometryInfo };

/**
 * The geometry's positions × node scale as floats. Reads through the attribute getters, so
 * interleaved and quantized (normalized integer) positions come out right too.
 */
const readScaledPositions = (geometry: THREE.BufferGeometry, scale: Vector3Like) => {
  const position = geometry.getAttribute('position');
  const vertices = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i++) {
    vertices[i * 3] = position.getX(i) * scale.x;
    vertices[i * 3 + 1] = position.getY(i) * scale.y;
    vertices[i * 3 + 2] = position.getZ(i) * scale.z;
  }
  return vertices;
};

/**
 * Shape data for TRIMESH/HEIGHTFIELD/CONVEXHULL, which the Physics API can't infer, read from the
 * node's geometry + scale (HEIGHTFIELD's grid: `HeightfieldFromGeometry.ts`). Node scale is applied
 * to every shape, TRIMESH vertices and HEIGHTFIELD heights included. Returns null when the
 * collider has to be skipped.
 */
const deriveMeshDependentColliderFields = (
  colliderParams: ColliderParams,
  source: ColliderSource
): ColliderParams | null => {
  const { geometry, info } = source;
  const { scale } = info.transform;

  if (colliderParams.type === 'TRIMESH') {
    if (colliderParams.vertices && colliderParams.indices) return colliderParams;
    const vertices = readScaledPositions(geometry, scale);
    const indices = geometry.index
      ? new Uint32Array(geometry.index.array)
      : new Uint32Array([...Array(vertices.length / 3).keys()]);
    return { ...colliderParams, vertices, indices };
  }

  if (colliderParams.type === 'CONVEXHULL') {
    if (colliderParams.vertices) return colliderParams;
    // In the node's space, like TRIMESH: the body sits at the node's origin
    return { ...colliderParams, vertices: readScaledPositions(geometry, scale) };
  }

  if (colliderParams.type === 'HEIGHTFIELD') {
    if (colliderParams.heights) return colliderParams;
    // Read by position, so a reorder (Draco, meshopt) doesn't matter, and through the getters,
    // so quantized positions don't either (p306 D3)
    return deriveHeightfield(
      colliderParams,
      readScaledPositions(geometry, scale),
      geometry.index?.array ?? null,
      info
    );
  }

  return colliderParams;
};

/**
 * Fills in a primitive collider's dimensions (and, for an X or Z `spineAxis`, its orientation)
 * from the node's geometry bounds × scale, never overriding one the params already set.
 */
const derivePrimitiveDimensions = (
  colliderParams: ColliderParams,
  { geometry, info }: ColliderSource
): ColliderParams => {
  const { type } = colliderParams;
  const rawSpineAxis = info.customProps.raw.spineAxis;
  const spineAxis = toSpineAxis(rawSpineAxis);
  if (
    rawSpineAxis !== undefined &&
    !spineAxis &&
    (type === 'CAPSULE' || type === 'CONE' || type === 'CYLINDER')
  ) {
    lwarn(
      `Import "${info.importId}", node "${info.nodeName}": unknown "spineAxis" ${JSON.stringify(rawSpineAxis)} (known: x, y, z), the ${type} collider stands on Y.`
    );
  }
  const bounds = getColliderBounds(type, geometry, info.transform.scale, spineAxis);
  if (!bounds) return colliderParams;
  const params: Record<string, unknown> = { ...colliderParams };
  for (const [key, value] of Object.entries(bounds)) {
    if (params[key] === undefined) params[key] = value;
  }
  return params as ColliderParams;
};

/**
 * Completes a collider's shape from an imported node's registered geometry, as
 * `spawnImportedAsset` does for its physics nodes: TRIMESH / CONVEXHULL / HEIGHTFIELD shape data,
 * and a primitive's dimensions (hx / hy / hz, radius, halfHeight) from the geometry's bounds ×
 * the node's scale, with the orientation of a capsule, cone or cylinder whose `spineAxis` custom
 * prop is X or Z. Never overrides a field the params already set, and never mutates the
 * registered geometry. For a collider of your own on an imported node, or to inspect what an
 * import's nodes would get.
 * @param colliderParams the collider so far: its `type`, and any field to keep
 * @param source the node's registered geometry and its manifest entry
 * @returns the completed collider params, or null when the collider has to be skipped (logged: a
 * HEIGHTFIELD whose vertices make no regular grid)
 * @example
 * ```ts
 * import { getGeometry, importAssetAsync } from 'aekasha';
 * import { deriveColliderFromGeometry } from 'aekasha/physics';
 *
 * const manifest = await importAssetAsync({ id: 'rocks', fileName: '/models/rocks.glb' });
 * const info = manifest?.geometries[0];
 * const geometry = info && getGeometry(info.geometryId);
 * const hull =
 *   info && geometry ? deriveColliderFromGeometry({ type: 'CONVEXHULL' }, { geometry, info }) : null;
 * ```
 */
export const deriveColliderFromGeometry = (
  colliderParams: ColliderParams,
  source: ColliderSource
): ColliderParams | null => {
  const withShapeData = deriveMeshDependentColliderFields(colliderParams, source);
  return withShapeData ? derivePrimitiveDimensions(withShapeData, source) : null;
};
