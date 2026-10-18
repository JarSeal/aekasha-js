// A code-made collider's missing dimensions, read from its mesh's createGeometry() params. An
// imported node's are measured from its geometry instead (import/ColliderBounds.ts).

import type * as THREE from 'three/webgpu';
import type { ColliderParams } from './types/PhysicsColliderTypes';

/** Primitive-geometry params createGeometry() stashes on BufferGeometry.userData.props.params
 * (Geometry.ts) — the subset relevant to deriving a collider's dimensions. */
type PrimitiveGeoParams = {
  width?: number;
  height?: number;
  depth?: number;
  radius?: number;
  radiusTop?: number;
  radiusBottom?: number;
};

/**
 * Fills in a primitive collider's missing dimensions (hx/hy/hz, radius, halfHeight) from its
 * target mesh's createGeometry()-authored params (per-shape-type mesh-geometry fallback) —
 * never overrides a dimension the caller already set explicitly. A no-op for any params/shape
 * it doesn't recognize, and for a mesh without createGeometry() params (an imported node's
 * colliders are completed from its geometry first, import/MeshColliderGeometry.ts).
 * @internal
 */
export const deriveColliderDimensionsFromMesh = (
  params: ColliderParams,
  mesh: THREE.Object3D | undefined
): ColliderParams => {
  const geoParams = (mesh as THREE.Mesh | undefined)?.geometry?.userData?.props?.params as
    | PrimitiveGeoParams
    | undefined;
  if (!geoParams) return params;

  switch (params.type) {
    case 'CUBOID':
    case 'BOX':
      return {
        ...params,
        hx: params.hx ?? (geoParams.width !== undefined ? geoParams.width / 2 : undefined),
        hy: params.hy ?? (geoParams.height !== undefined ? geoParams.height / 2 : undefined),
        hz: params.hz ?? (geoParams.depth !== undefined ? geoParams.depth / 2 : undefined),
      };
    case 'BALL':
    case 'SPHERE':
      return { ...params, radius: params.radius ?? geoParams.radius };
    case 'CAPSULE':
      return {
        ...params,
        halfHeight:
          params.halfHeight ?? (geoParams.height !== undefined ? geoParams.height / 2 : undefined),
        radius: params.radius ?? geoParams.radius,
      };
    case 'CONE':
    case 'CYLINDER':
      return {
        ...params,
        halfHeight:
          params.halfHeight ?? (geoParams.height !== undefined ? geoParams.height / 2 : undefined),
        radius: params.radius ?? geoParams.radiusBottom ?? geoParams.radiusTop,
      };
    default:
      return params;
  }
};
