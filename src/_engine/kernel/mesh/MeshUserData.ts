import * as THREE from 'three/webgpu';
import { ThreeVector3 } from '../render/ThreeMath';

/**
 * Writes a collider shape's dimensions, measured from the mesh's geometry bounds and scale, into
 * `mesh.geometry.userData.props.params`: `width` / `height` / `depth` for `BOX` (`CUBOID`),
 * `radius` for `SPHERE` (`BALL`), `radius`, `halfHeight` and `orientation` (the
 * `userData.spineAxis`, `y` by default) for `CAPSULE`, `CONE` and `CYLINDER`. Physics' import
 * derivation (`MeshColliderGeometry.ts`) calls it on a scratch mesh.
 * @internal
 * @remarks Known bug, p614's with this file's move into physics (p613 D13): `CAPSULE` and `CONE`
 * fall through into the next case, and `PhysicsEntity.ts`' `deriveColliderDimensionsFromMesh`
 * reads other names (`height`, `radiusTop` / `radiusBottom`), so an imported node's capsule, cone
 * or cylinder collider gets the Physics API's default `halfHeight` (and a cone or cylinder no
 * derived radius). Boxes and spheres work. Writes through the shared `ThreeVector3` scratch.
 */
export const setMeshCreatePropsToUserData = (shape: string, mesh: THREE.Mesh) => {
  if (!mesh) return;
  let scale;
  let size;
  let radius;
  let halfHeight;
  let spine;
  let sX;
  let sY;
  let sZ;
  let totalHeight;
  switch (shape) {
    case 'CUBOID':
    case 'BOX':
      mesh.geometry.computeBoundingBox();
      mesh.geometry.boundingBox?.getSize(ThreeVector3);
      ThreeVector3.multiply(mesh.scale);
      if (!mesh.geometry.userData.props) {
        mesh.geometry.userData.props = { params: {} };
      } else if (!mesh.geometry.userData.props.params) {
        mesh.geometry.userData.props.params = {};
      }
      mesh.geometry.userData.props.params.width = ThreeVector3.x;
      mesh.geometry.userData.props.params.height = ThreeVector3.y;
      mesh.geometry.userData.props.params.depth = ThreeVector3.z;
      break;
    case 'SPHERE':
    case 'BALL':
      mesh.geometry.computeBoundingSphere();
      const baseRadius = mesh.geometry.boundingSphere?.radius;
      if (!baseRadius) return;
      scale = mesh.scale;
      const maxScale = Math.max(scale.x, scale.y, scale.z);
      const finalRadius = baseRadius * maxScale;
      if (!mesh.geometry.userData.props) {
        mesh.geometry.userData.props = { params: {} };
      } else if (!mesh.geometry.userData.props.params) {
        mesh.geometry.userData.props.params = {};
      }
      mesh.geometry.userData.props.params.radius = finalRadius;
      break;
    case 'CAPSULE':
      mesh.geometry.computeBoundingBox();
      size = new THREE.Vector3();
      mesh.geometry.boundingBox!.getSize(size);
      scale = mesh.scale;
      sX = size.x * scale.x;
      sY = size.y * scale.y;
      sZ = size.z * scale.z;
      spine = (mesh.userData.spineAxis || 'y').toLowerCase();
      if (spine === 'x') {
        // Radius is the larger of the cross-section axes
        radius = Math.max(sY, sZ) / 2;
        totalHeight = sX;
      } else if (spine === 'z') {
        radius = Math.max(sX, sY) / 2;
        totalHeight = sZ;
      } else {
        // Default: Y is height
        radius = Math.max(sX, sZ) / 2;
        totalHeight = sY;
      }
      // Calculate Rapier's 'halfHeight'
      // Rapier defines halfHeight as the distance from the center to the start of the cap.
      // Formula: (Total Height - Diameter) / 2
      const cylinderSectionHeight = totalHeight - radius * 2;
      halfHeight = Math.max(0, cylinderSectionHeight / 2);
      if (!mesh.geometry.userData.props) {
        mesh.geometry.userData.props = { params: {} };
      }
      if (!mesh.geometry.userData.props.params) {
        mesh.geometry.userData.props.params = {};
      }
      mesh.geometry.userData.props.params.radius = radius;
      mesh.geometry.userData.props.params.halfHeight = halfHeight;
      mesh.geometry.userData.props.params.orientation = spine;
    case 'CONE':
      mesh.geometry.computeBoundingBox();
      size = ThreeVector3;
      mesh.geometry.boundingBox!.getSize(size);
      scale = mesh.scale;
      sX = size.x * scale.x;
      sY = size.y * scale.y;
      sZ = size.z * scale.z;
      spine = (mesh.userData.spineAxis || 'y').toLowerCase();
      if (spine === 'x') {
        radius = Math.max(sY, sZ) / 2;
        totalHeight = sX;
      } else if (spine === 'z') {
        radius = Math.max(sX, sY) / 2;
        totalHeight = sZ;
      } else {
        // Default: Y is height (upright)
        radius = Math.max(sX, sZ) / 2;
        totalHeight = sY;
      }
      if (!mesh.geometry.userData.props) {
        mesh.geometry.userData.props = { params: {} };
      } else if (!mesh.geometry.userData.props.params) {
        mesh.geometry.userData.props.params = {};
      }
      mesh.geometry.userData.props.params.radius = radius;
      mesh.geometry.userData.props.params.halfHeight = totalHeight / 2;
      mesh.geometry.userData.props.params.orientation = spine;
    case 'CYLINDER':
      mesh.geometry.computeBoundingBox();
      size = ThreeVector3; // Or use your 'ThreeVector3' scratch vector
      mesh.geometry.boundingBox!.getSize(size);
      scale = mesh.scale;
      spine = (mesh.userData.spineAxis || 'y').toLowerCase();
      if (spine === 'x') {
        radius = Math.max(size.y * scale.y, size.z * scale.z) / 2;
        halfHeight = (size.x * scale.x) / 2;
      } else if (spine === 'z') {
        radius = Math.max(size.x * scale.x, size.y * scale.y) / 2;
        halfHeight = (size.z * scale.z) / 2;
      } else {
        // Default: Y is the spine (upright)
        radius = Math.max(size.x * scale.x, size.z * scale.z) / 2;
        halfHeight = (size.y * scale.y) / 2;
      }
      if (!mesh.geometry.userData.props) {
        mesh.geometry.userData.props = { params: {} };
      }
      if (!mesh.geometry.userData.props.params) {
        mesh.geometry.userData.props.params = {};
      }
      mesh.geometry.userData.props.params.radius = radius;
      mesh.geometry.userData.props.params.halfHeight = halfHeight;
      mesh.geometry.userData.props.params.orientation = spine;
      break;
  }
};
