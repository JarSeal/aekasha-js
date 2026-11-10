import * as THREE from 'three/webgpu';
import { lwarn } from '../../utils/Logger';
import { IS_DEBUG_ENV } from '../config/Config';
import {
  getGeometry,
  saveBufferGeometry,
  type GeoBaseProps,
  type MergedGeoPart,
  type MergedGeoProps,
} from './Geometry';
import {
  mergeGeometryPartsCore,
  type MergedGeometry,
  type MergeGeometryOptions,
  type ResolvedMergePart,
} from './GeometryMergeCore';

/** One part of a merge ({@link mergeGeometryParts}): a geometry and where it goes. */
export type MergePart = {
  /** A registered geometry's id, or a geometry. Only read: the merge takes no ref on it. */
  geo: string | THREE.BufferGeometry;
  /** Its local → merged space transform; identity when left out. */
  matrix?: THREE.Matrix4;
  /** Its material slot: the geometry group (`materialIndex`) it lands in with `groups: 'BY_SLOT'`.
   * Default 0. */
  materialSlot?: number;
  /** The caller's id for the part, kept in its `userData.mergeParts` entry. */
  key?: string;
};

/** {@link registerMergedGeometry}'s options: the merge's and the registration's. */
export type RegisterMergedGeometryOptions = MergeGeometryOptions & GeoBaseProps;

const resolveParts = (parts: MergePart[]): ResolvedMergePart[] =>
  parts.map((part, i) => {
    const { geo, ...rest } = part;
    if (typeof geo !== 'string') return { ...rest, geometry: geo };
    const geometry = getGeometry(geo);
    if (!geometry) {
      throw new Error(`Merge part ${i}: no geometry is registered under "${geo}".`);
    }
    return { ...rest, geometry };
  });

/**
 * Merges several geometries, each with its transform, into one new geometry, for one draw where
 * there were many. The parts are only read. The result is unregistered: register it with
 * `saveBufferGeometry`, or use {@link registerMergedGeometry}.
 *
 * - Each part's `matrix` is baked in: positions, normals (normal matrix) and tangents (`w`
 *   negated for a mirrored part), and a mirrored part's winding is flipped, so it isn't culled.
 * - Attributes are unified (`attributes`, default `UNION`: a missing one filled with uv 0,
 *   colour 1, others 0, a missing tangent computed or else dropped with a warning) and read as
 *   values, so quantized (normalized) and interleaved ones merge with float ones.
 * - The index is `Uint16` up to 65 535 vertices, else `Uint32`.
 * - `userData.mergeParts` lists each part's vertex and index ranges, in the merged order
 *   (`groups: 'BY_SLOT'` sorts the parts by slot, one group per slot).
 * - No parts give an empty geometry.
 * @throws for an unregistered id, a morphed or skinned part, one without a 3-component position,
 * or one attribute with different item sizes across parts
 * @example
 * ```ts
 * import * as THREE from 'three/webgpu';
 * import { mergeGeometryParts, saveBufferGeometry } from 'aekasha';
 *
 * const wall = mergeGeometryParts([
 *   { geo: 'wallStraightGeo' },
 *   { geo: 'wallStraightGeo', matrix: new THREE.Matrix4().makeTranslation(4, 0, 0) },
 *   { geo: 'pillarGeo', matrix: new THREE.Matrix4().makeTranslation(2, 0, 0) },
 * ]);
 * saveBufferGeometry(wall, { id: 'wallSectionGeo' });
 * ```
 */
export const mergeGeometryParts = (
  parts: MergePart[],
  opts?: MergeGeometryOptions
): MergedGeometry => {
  const { geometry, warnings } = mergeGeometryPartsCore(resolveParts(parts), opts);
  if (IS_DEBUG_ENV) for (const warning of warnings) lwarn(`mergeGeometryParts: ${warning}`);
  return geometry;
};

/**
 * Merges the parts ({@link mergeGeometryParts}) and registers the result like
 * `saveBufferGeometry`: owned by the scene loading (or current). An `id` already registered
 * returns that geometry, re-tagged to the scene getting it, without merging.
 * @returns the registered geometry (its `userData.mergeParts` lists the parts' ranges)
 * @example
 * ```ts
 * import * as THREE from 'three/webgpu';
 * import { createMeshEntity, registerMergedGeometry } from 'aekasha';
 *
 * const steps = Array.from({ length: 10 }, (_, i) => ({
 *   geo: 'stepGeo',
 *   matrix: new THREE.Matrix4().makeTranslation(0, 0.2 * i, 0.4 * i),
 * }));
 * createMeshEntity({ geo: registerMergedGeometry(steps, { id: 'stairsGeo' }), mat: 'stoneMat' });
 * ```
 */
export const registerMergedGeometry = (
  parts: MergePart[],
  opts: RegisterMergedGeometryOptions = {}
): THREE.BufferGeometry => {
  const { groups, attributes, indexed, ...props } = opts;
  const existing = props.id ? getGeometry(props.id) : undefined;
  if (existing) return saveBufferGeometry(existing, props);
  return saveBufferGeometry(mergeGeometryParts(parts, { groups, attributes, indexed }), props);
};

const partPosition = new THREE.Vector3();
const partQuaternion = new THREE.Quaternion();
const partScale = new THREE.Vector3();
const partEuler = new THREE.Euler();

/** A `MERGED` JSON part's transform as a matrix: position, then rotation (`quaternion` over
 * `rotation`), then scale, as a mesh's. */
const getPartMatrix = (part: MergedGeoPart) => {
  const { position: p, rotation: r, quaternion: q, scale: s } = part;
  partPosition.set(p?.x ?? 0, p?.y ?? 0, p?.z ?? 0);
  if (q) partQuaternion.set(q.x, q.y, q.z, q.w);
  else partQuaternion.setFromEuler(partEuler.set(r?.x ?? 0, r?.y ?? 0, r?.z ?? 0));
  partScale.set(s?.x ?? 1, s?.y ?? 1, s?.z ?? 1);
  return new THREE.Matrix4().compose(partPosition, partQuaternion, partScale);
};

/**
 * Registers a `MERGED` geometry JSON's props ({@link registerMergedGeometry} with its parts'
 * transforms as matrices): the scene loader's, which `import()`s this module for a scene's first
 * `MERGED` geometry.
 * @internal
 * @throws as {@link mergeGeometryParts}
 */
export const registerMergedGeoProps = (props: MergedGeoProps): THREE.BufferGeometry => {
  const { type, params, ...registration } = props;
  const { parts, groups, attributes, indexed } = params;
  const mergeParts: MergePart[] = parts.map((part) => ({
    geo: part.geo,
    matrix: getPartMatrix(part),
    ...(part.materialSlot !== undefined ? { materialSlot: part.materialSlot } : {}),
    ...(part.key !== undefined ? { key: part.key } : {}),
  }));
  return registerMergedGeometry(mergeParts, { ...registration, groups, attributes, indexed });
};
