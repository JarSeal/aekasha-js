// In-place writes to a merge group's built geometry (docs/plans/p372_mesh-merge-groups.md §3,
// Phase 2): a member's range rewritten for its new pose, or its triangles collapsed when it
// leaves, without a rebuild. Only the member's
// ranges are written and marked for upload (`addUpdateRange`), from scratch objects: nothing is
// allocated, and the vertex count never changes.
//
// The merged position, normal and tangent attributes are always plain Float32 (p371 D1's
// `FLOAT_ATTRIBUTES`), so they're written directly; a member's own attributes are read through
// `getX` / `getY` / …, which handle quantized and interleaved ones.
import * as THREE from 'three/webgpu';
import type { MergePartRange } from '../../kernel/assets/GeometryMergeCore';

const scratchVector = new THREE.Vector3();
const scratchNormalMatrix = new THREE.Matrix3();
const scratchLinearMatrix = new THREE.Matrix3();
const scratchDelta = new THREE.Matrix3();
const scratchBox = new THREE.Box3();
const scratchSphere = new THREE.Sphere();

/** Marks a merged attribute's range for upload. */
const markRange = (attr: THREE.BufferAttribute, start: number, count: number) => {
  attr.addUpdateRange(start * attr.itemSize, count * attr.itemSize);
  attr.needsUpdate = true;
};

/**
 * Rewrites a member's vertices in the merged geometry for its new transform (`matrix`, member →
 * group space; `previous`, the one its range was written with): positions by `matrix`, normals by
 * its normal matrix, tangents by its linear part (`w` negated for a mirrored member). A tangent the
 * merge computed (the member has none of its own) is turned from the merged value by the change
 * between the two. Other attributes (uvs, colours) don't depend on the pose and stay.
 * @internal
 * @returns whether the member's mirroring changed (its triangles' winding needs flipping:
 * {@link flipPartWinding})
 */
export const rewritePartVertices = (
  merged: THREE.BufferGeometry,
  range: MergePartRange,
  source: THREE.BufferGeometry,
  matrix: THREE.Matrix4,
  previous: THREE.Matrix4
): boolean => {
  const { vertexStart, vertexCount } = range;
  const isMirrored = matrix.determinant() < 0;
  const mirrorChanged = isMirrored !== previous.determinant() < 0;

  const position = merged.getAttribute('position') as THREE.BufferAttribute;
  const sourcePosition = source.getAttribute('position');
  const positions = position.array;
  for (let v = 0; v < vertexCount; v++) {
    scratchVector.fromBufferAttribute(sourcePosition, v).applyMatrix4(matrix);
    const o = (vertexStart + v) * 3;
    positions[o] = scratchVector.x;
    positions[o + 1] = scratchVector.y;
    positions[o + 2] = scratchVector.z;
  }
  markRange(position, vertexStart, vertexCount);

  const normal = merged.getAttribute('normal') as THREE.BufferAttribute | undefined;
  const sourceNormal = source.getAttribute('normal');
  // A member without normals has the merge's fill (zeros): nothing to turn
  if (normal && sourceNormal) {
    scratchNormalMatrix.getNormalMatrix(matrix);
    const normals = normal.array;
    for (let v = 0; v < vertexCount; v++) {
      scratchVector
        .fromBufferAttribute(sourceNormal, v)
        .applyMatrix3(scratchNormalMatrix)
        .normalize();
      const o = (vertexStart + v) * 3;
      normals[o] = scratchVector.x;
      normals[o + 1] = scratchVector.y;
      normals[o + 2] = scratchVector.z;
    }
    markRange(normal, vertexStart, vertexCount);
  }

  const tangent = merged.getAttribute('tangent') as THREE.BufferAttribute | undefined;
  if (tangent) {
    const sourceTangent = source.getAttribute('tangent');
    scratchLinearMatrix.setFromMatrix4(matrix);
    // The member's own tangents, or the merged ones turned by the change since they were written
    if (!sourceTangent) {
      scratchLinearMatrix.multiply(scratchDelta.setFromMatrix4(previous).invert());
    }
    const tangents = tangent.array;
    const itemSize = tangent.itemSize;
    for (let v = 0; v < vertexCount; v++) {
      const o = (vertexStart + v) * itemSize;
      if (sourceTangent) scratchVector.fromBufferAttribute(sourceTangent, v);
      else scratchVector.set(tangents[o], tangents[o + 1], tangents[o + 2]);
      scratchVector.applyMatrix3(scratchLinearMatrix).normalize();
      tangents[o] = scratchVector.x;
      tangents[o + 1] = scratchVector.y;
      tangents[o + 2] = scratchVector.z;
      // The bitangent's sign (cross(normal, tangent) * w) flips with a mirroring
      if (itemSize === 4) {
        if (sourceTangent) {
          tangents[o + 3] = sourceTangent.getW(v) * (isMirrored ? -1 : 1);
        } else if (mirrorChanged) {
          tangents[o + 3] = -tangents[o + 3];
        }
      }
    }
    markRange(tangent, vertexStart, vertexCount);
  }
  return mirrorChanged;
};

/**
 * Flips a member's triangles' winding in the merged index (a mirroring that came or went), so
 * its faces aren't culled.
 * @internal
 */
export const flipPartWinding = (merged: THREE.BufferGeometry, range: MergePartRange) => {
  const index = merged.index;
  if (!index) return;
  const indices = index.array;
  const end = range.indexStart + range.indexCount;
  for (let i = range.indexStart; i + 2 < end; i += 3) {
    const second = indices[i + 1];
    indices[i + 1] = indices[i + 2];
    indices[i + 2] = second;
  }
  markRange(index, range.indexStart, range.indexCount);
};

/**
 * Grows the merged geometry's bounds to take a member's new place (its geometry's box through
 * `matrix`, member → group space). Never shrinks them: a compacting build measures them again.
 * @internal
 * @returns whether they grew (the group's spatial radius needs measuring again)
 */
export const growMergedBounds = (
  merged: THREE.BufferGeometry,
  source: THREE.BufferGeometry,
  matrix: THREE.Matrix4
): boolean => {
  if (!source.boundingBox) source.computeBoundingBox();
  scratchBox.copy(source.boundingBox!).applyMatrix4(matrix);
  if (!merged.boundingBox) merged.computeBoundingBox();
  if (!merged.boundingSphere) merged.computeBoundingSphere();
  const box = merged.boundingBox!;
  const sphere = merged.boundingSphere!;
  // Each on its own: a box inside the merged box can still reach out of its sphere
  const boxGrows = !box.containsBox(scratchBox);
  if (boxGrows) box.union(scratchBox);
  scratchBox.getBoundingSphere(scratchSphere);
  const sphereGrows =
    sphere.center.distanceTo(scratchSphere.center) + scratchSphere.radius > sphere.radius;
  if (sphereGrows) sphere.union(scratchSphere);
  return boxGrows || sphereGrows;
};

/**
 * Collapses a member's triangles in the merged index to degenerate ones (every index its first
 * vertex): the member isn't drawn, and its vertices stay where they are, unused.
 * @internal
 */
export const collapsePartIndex = (merged: THREE.BufferGeometry, range: MergePartRange) => {
  const index = merged.index;
  if (!index) return;
  index.array.fill(range.vertexStart, range.indexStart, range.indexStart + range.indexCount);
  markRange(index, range.indexStart, range.indexCount);
};
