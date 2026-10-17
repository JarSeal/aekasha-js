// An imported node's primitive collider dimensions, measured from its geometry's bounds (p614 D13).

import * as THREE from 'three/webgpu';
import type { PhysRotation } from '../types/PhysicsCommonTypes';
import type { ColliderParams } from '../types/PhysicsColliderTypes';
import type { Vector3Like } from '../../../kernel/assets/import/ImportTypes';

/**
 * The axis a capsule, cone or cylinder runs along in its node's space (the `spineAxis` custom
 * prop). Rapier's shapes stand on Y; X and Z turn the shape with {@link ColliderBounds.orientation}.
 * @internal
 */
export type SpineAxis = 'x' | 'y' | 'z';

/**
 * A primitive collider's dimensions, as {@link ColliderParams} names them, measured by
 * {@link getColliderBounds}.
 * @internal
 */
export type ColliderBounds = {
  /** BOX / CUBOID: half the width (x). */
  hx?: number;
  /** BOX / CUBOID: half the height (y). */
  hy?: number;
  /** BOX / CUBOID: half the depth (z). */
  hz?: number;
  /** BALL / SPHERE: the bounding sphere's; CAPSULE, CONE, CYLINDER: half the cross-section's
   * larger side. */
  radius?: number;
  /** CAPSULE: half the straight part (the length less both caps); CONE, CYLINDER: half the
   * length. */
  halfHeight?: number;
  /** CAPSULE, CONE, CYLINDER whose spine is X or Z: the turn from Rapier's Y onto it. */
  orientation?: PhysRotation;
};

const HALF_SQRT2 = Math.SQRT1_2;

// Turns +Y onto +X (−90° about Z) and onto +Z (+90° about X); a cone's tip goes with it
const SPINE_ORIENTATIONS: Record<'x' | 'z', PhysRotation> = {
  x: { x: 0, y: 0, z: -HALF_SQRT2, w: HALF_SQRT2 },
  z: { x: HALF_SQRT2, y: 0, z: 0, w: HALF_SQRT2 },
};

/**
 * Reads a `spineAxis` custom prop: `'x'`, `'y'` or `'z'`, in either case. Anything else, and no
 * value, is undefined (the caller warns about a value it can't read).
 * @internal
 */
export const toSpineAxis = (value: unknown): SpineAxis | undefined => {
  if (typeof value !== 'string') return undefined;
  const axis = value.toLowerCase();
  return axis === 'x' || axis === 'y' || axis === 'z' ? axis : undefined;
};

// The geometry's bounds: its cached ones, or three's measure of a geometry sharing only its
// positions, so nothing is written to the node's geometry
const readBounds = (geometry: THREE.BufferGeometry) => {
  if (geometry.boundingBox && geometry.boundingSphere) {
    return { box: geometry.boundingBox, sphere: geometry.boundingSphere };
  }
  const measured = new THREE.BufferGeometry();
  measured.setAttribute('position', geometry.getAttribute('position'));
  measured.computeBoundingBox();
  measured.computeBoundingSphere();
  return { box: measured.boundingBox!, sphere: measured.boundingSphere! };
};

/**
 * Measures a primitive collider's dimensions from its node's geometry bounds × the node's scale:
 * a box's half extents, a sphere's radius (the bounding sphere's × the largest scale), and a
 * capsule's, cone's or cylinder's radius, `halfHeight` and, for an X or Z spine, the orientation
 * that turns Rapier's Y-up shape onto it. Reads the geometry's cached bounds or measures them
 * without writing to the geometry. The shape is centred on the node's origin, as the collider is.
 * @internal
 * @param type the collider's shape
 * @param geometry the node's geometry, in the node's space
 * @param scale the node's scale
 * @param spineAxis the shape's long axis (Y by default); only capsules, cones and cylinders read it
 * @returns the dimensions, or undefined for a shape that isn't a primitive (TRIMESH, CONVEXHULL,
 * HEIGHTFIELD) or a geometry without positions
 */
export const getColliderBounds = (
  type: ColliderParams['type'],
  geometry: THREE.BufferGeometry,
  scale: Vector3Like,
  spineAxis: SpineAxis = 'y'
): ColliderBounds | undefined => {
  if (!geometry.getAttribute('position')) return undefined;
  switch (type) {
    case 'CUBOID':
    case 'BOX': {
      const size = readBounds(geometry).box.getSize(new THREE.Vector3());
      return { hx: (size.x * scale.x) / 2, hy: (size.y * scale.y) / 2, hz: (size.z * scale.z) / 2 };
    }
    case 'BALL':
    case 'SPHERE':
      return { radius: readBounds(geometry).sphere.radius * Math.max(scale.x, scale.y, scale.z) };
    case 'CAPSULE':
    case 'CONE':
    case 'CYLINDER': {
      const size = readBounds(geometry).box.getSize(new THREE.Vector3());
      const sx = size.x * scale.x;
      const sy = size.y * scale.y;
      const sz = size.z * scale.z;
      // The cross-section's larger side is the diameter
      const [length, diameter] =
        spineAxis === 'x'
          ? [sx, Math.max(sy, sz)]
          : spineAxis === 'z'
            ? [sz, Math.max(sx, sy)]
            : [sy, Math.max(sx, sz)];
      const radius = diameter / 2;
      // Rapier's capsule halfHeight is its straight part's: the caps add a radius at each end
      const halfHeight = type === 'CAPSULE' ? Math.max(0, length - diameter) / 2 : length / 2;
      return {
        radius,
        halfHeight,
        ...(spineAxis === 'y' ? {} : { orientation: { ...SPINE_ORIENTATIONS[spineAxis] } }),
      };
    }
    default:
      return undefined;
  }
};
