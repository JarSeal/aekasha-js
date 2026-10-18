// The Rapier backend's shapes: a Rapier shape from the API's shape params.

import type Rapier from '@dimforge/rapier3d-compat';
import type { ShapeParams } from '../../types/PhysicsColliderTypes';
import { existsOrThrow } from '../../../../utils/Assert';
import { backend } from './RapierState';

/** Builds a bare `Rapier.Shape` from an engine-agnostic {@link ShapeParams} descriptor —
 * shared by `createCollider` (which wraps the shape in a `ColliderDesc`) and `castShape`/
 * `castShapeSync` (which cast the bare shape directly, with no collider of its own).
 * @internal
 */
export const paramsToShape = (params: ShapeParams): Rapier.Shape => {
  let shape: Rapier.Shape | null = null;
  let size: { [key: string]: number };

  switch (params.type) {
    case 'CUBOID':
    case 'BOX':
      size = { hx: 0.5, hy: 0.5, hz: 0.5 }; // Default size
      shape = params.borderRadius
        ? new backend.RAPIER.RoundCuboid(
            params.hx || size.hx,
            params.hy || size.hy,
            params.hz || size.hz,
            params.borderRadius
          )
        : new backend.RAPIER.Cuboid(
            params.hx || size.hx,
            params.hy || size.hy,
            params.hz || size.hz
          );
      break;
    case 'BALL':
    case 'SPHERE':
      const radius = 0.5; // Default radius
      shape = new backend.RAPIER.Ball(params.radius || radius);
      break;
    case 'CAPSULE':
      {
        size = { halfHeight: 0.25, radius: 0.25 }; // Default size
        shape = new backend.RAPIER.Capsule(
          params.halfHeight || size.halfHeight,
          params.radius || size.radius
        );
      }
      break;
    case 'CONE':
      {
        size = { halfHeight: 0.25, radius: 0.25 }; // Default size
        shape = params.borderRadius
          ? new backend.RAPIER.RoundCone(
              params.halfHeight || size.halfHeight,
              params.radius || size.radius,
              params.borderRadius
            )
          : new backend.RAPIER.Cone(
              params.halfHeight || size.halfHeight,
              params.radius || size.radius
            );
      }
      break;
    case 'CYLINDER':
      size = { halfHeight: 0.5, radius: 1 }; // Default size
      shape = params.borderRadius
        ? new backend.RAPIER.RoundCylinder(
            params.halfHeight || size.halfHeight,
            params.radius || size.radius,
            params.borderRadius
          )
        : new backend.RAPIER.Cylinder(
            params.halfHeight || size.halfHeight,
            params.radius || size.radius
          );
      break;
    case 'TRIANGLE':
      shape = params.borderRadius
        ? new backend.RAPIER.RoundTriangle(params.a, params.b, params.c, params.borderRadius)
        : new backend.RAPIER.Triangle(params.a, params.b, params.c);
      break;
    case 'TRIMESH':
      const vertices = existsOrThrow(
        params.vertices,
        'Could not find vertices when creating a TRIMESH shape.'
      );
      const indices = existsOrThrow(
        params.indices,
        'Could not find indices when creating a TRIMESH shape.'
      );
      shape = new backend.RAPIER.TriMesh(vertices, indices);
      break;
    case 'HEIGHTFIELD':
      const nRows = existsOrThrow(
        params.nrows,
        'Could not find nRows when creating a HEIGHTFIELD shape.'
      );
      const nCols = existsOrThrow(
        params.ncols,
        'Could not find nCols when creating a HEIGHTFIELD shape.'
      );
      const heights = existsOrThrow(
        params.heights,
        'Could not find heights when creating a HEIGHTFIELD shape.'
      );
      const scale = existsOrThrow(
        params.scale,
        'Could not find scale when creating a HEIGHTFIELD shape.'
      );
      shape = new backend.RAPIER.Heightfield(
        Math.round(nRows),
        Math.round(nCols),
        new Float32Array(heights),
        scale
      );
      break;
    case 'CONVEXHULL':
      const vertParams = existsOrThrow(
        params.vertices,
        'Could not find vertices when creating a CONVEXHULL shape.'
      );
      shape = new backend.RAPIER.ConvexPolyhedron(new Float32Array(vertParams));
      break;
  }

  return existsOrThrow(shape, 'Could not create shape in paramsToShape, shape is undefined.');
};
