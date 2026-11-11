import * as THREE from 'three/webgpu';
import { lwarn } from '../../utils/Logger';
import { IS_DEBUG_ENV } from '../config/Config';
import { getAssetOwnerScope, runInAssetOwnerScope } from './AssetOwners';
import { mergeGeometryInWorker, recordAssetLoadReport, runAssetTask } from './AssetsAPI';
import type { TransferableMergePart } from './AssetsAPITypes';
import { deserializeGeometry, serializeGeometry } from './import/GeometryTransfer';
import type { TransferableGeometry } from './import/GeometryTransfer';
import {
  getGeometry,
  saveBufferGeometry,
  type GeoBaseProps,
  type MergedGeoPart,
  type MergedGeoProps,
} from './Geometry';
import {
  assertMergeableParts,
  assertPaletteIndices,
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
  /** Its entry in a merge material's palette (p374): when any part has one, every merged vertex
   * gets its part's index (0 for a part without) in the integer attribute `aekMatIndex` (`Uint8`,
   * `Uint16` past 255), which the merge material reads. An integer from 0 to 65 535. */
  paletteIndex?: number;
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

/** The merge's warnings, logged in the debug env. */
const logWarnings = (warnings: string[], caller: string) => {
  if (IS_DEBUG_ENV) for (const warning of warnings) lwarn(`${caller}: ${warning}`);
};

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
 * - A part's `paletteIndex` (p374) goes into every one of its vertices' `aekMatIndex`, an
 *   integer attribute (`gpuType` `IntType`), when any part has one. Other integer attributes stay
 *   integers.
 * - The index is `Uint16` up to 65 535 vertices, else `Uint32`.
 * - `userData.mergeParts` lists each part's vertex and index ranges, in the merged order
 *   (`groups: 'BY_SLOT'` sorts the parts by slot, one group per slot).
 * - No parts give an empty geometry.
 * @throws for an unregistered id, a morphed or skinned part, one without a 3-component position,
 * one attribute with different item sizes across parts, or a `paletteIndex` out of range
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
  logWarnings(warnings, 'mergeGeometryParts');
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

/** The parts as the worker's request: each geometry once (its attributes and index only, as
 * copies, so the registered ones stay usable), the parts naming it by index. */
const serializeParts = (parts: ResolvedMergePart[]) => {
  const transfer = new Set<ArrayBuffer>();
  const geometries: TransferableGeometry[] = [];
  const indexOf = new Map<THREE.BufferGeometry, number>();
  const transferableParts: TransferableMergePart[] = parts.map(
    ({ geometry, matrix, materialSlot, paletteIndex, key }) => {
      let geometryIndex = indexOf.get(geometry);
      if (geometryIndex === undefined) {
        // Not the geometry itself: its userData and groups needn't (or can't) be cloned
        const input = new THREE.BufferGeometry();
        for (const name in geometry.attributes) {
          input.setAttribute(name, geometry.attributes[name]);
        }
        input.setIndex(geometry.index);
        geometryIndex = geometries.push(serializeGeometry(input, transfer, { copy: true })) - 1;
        indexOf.set(geometry, geometryIndex);
      }
      return {
        geometryIndex,
        ...(matrix ? { matrix: [...matrix.elements] } : {}),
        ...(materialSlot !== undefined ? { materialSlot } : {}),
        ...(paletteIndex !== undefined ? { paletteIndex } : {}),
        ...(key !== undefined ? { key } : {}),
      };
    }
  );
  return { geometries, parts: transferableParts, transfer };
};

/** The merge where `MERGE` is targeted, with its load report. The parts are checked first, on
 * this thread: a refused merge throws here, not in the worker. */
const mergeWithReportAsync = async (parts: MergePart[], opts?: MergeGeometryOptions) => {
  const resolved = resolveParts(parts);
  assertMergeableParts(resolved.map((part) => part.geometry));
  assertPaletteIndices(resolved);
  const options: MergeGeometryOptions = { ...opts };
  const { result, report } = await runAssetTask(
    'MERGE',
    async () => {
      const request = serializeParts(resolved);
      const { geometry, warnings } = await mergeGeometryInWorker(
        request.geometries,
        request.parts,
        options,
        request.transfer
      );
      return { geometry: deserializeGeometry(geometry) as MergedGeometry, warnings };
    },
    async () => mergeGeometryPartsCore(resolved, options)
  );
  return { ...result, report };
};

/**
 * Merges like {@link mergeGeometryParts}, in the assets worker (`AppConfig.assets.mergeWorkerTarget`,
 * default `WORKER_THREAD`): the parts' arrays are copied and sent, and the merged ones come back
 * transferred, so a large merge doesn't hold up a frame. Where the worker can't run it, it runs
 * on the main thread (`AppConfig.assets.fallbackToMainThread`). The result is the same either way.
 * @returns the merged geometry, unregistered
 * @throws (rejects) as {@link mergeGeometryParts}, before anything is sent to the worker
 * @remarks The parts are read when it's called: a part changed or released after the call
 * doesn't change the merge. For a small merge (a few thousand vertices) the round trip costs more
 * than it saves: use {@link mergeGeometryParts}.
 * @example
 * ```ts
 * import * as THREE from 'three/webgpu';
 * import { createSeededRandom, mergeGeometryPartsAsync, saveBufferGeometry } from 'aekasha';
 *
 * // 500 rocks of one registered geometry, scattered and scaled, as one geometry
 * const random = createSeededRandom(7);
 * const parts = Array.from({ length: 500 }, () => {
 *   const scale = 0.5 + random();
 *   return {
 *     geo: 'rockGeo',
 *     matrix: new THREE.Matrix4()
 *       .makeScale(scale, scale, scale)
 *       .setPosition((random() - 0.5) * 100, 0, (random() - 0.5) * 100),
 *   };
 * });
 * saveBufferGeometry(await mergeGeometryPartsAsync(parts), { id: 'rockFieldGeo' });
 * ```
 */
export const mergeGeometryPartsAsync = async (
  parts: MergePart[],
  opts?: MergeGeometryOptions
): Promise<MergedGeometry> => {
  const { geometry, warnings } = await mergeWithReportAsync(parts, opts);
  logWarnings(warnings, 'mergeGeometryPartsAsync');
  return geometry;
};

/**
 * Merges the parts in the assets worker ({@link mergeGeometryPartsAsync}) and registers the
 * result like {@link registerMergedGeometry}: an `id` already registered returns that geometry,
 * re-tagged, without merging. The owner is the one in force at the call (a streaming cell's
 * scope, else the scene loading or current when it registers).
 * @returns the registered geometry (its `userData.mergeParts` lists the parts' ranges)
 * @throws (rejects) as {@link mergeGeometryParts}
 * @remarks Two overlapping calls with one `id` both merge, and the first to finish registers:
 * the other resolves with its geometry and disposes its own.
 * @example
 * ```ts
 * import * as THREE from 'three/webgpu';
 * import { createMeshEntity, registerMergedGeometryAsync } from 'aekasha';
 *
 * // A 20 × 20 grid of rocks, one draw
 * const parts = Array.from({ length: 400 }, (_, i) => ({
 *   geo: 'rockGeo',
 *   matrix: new THREE.Matrix4().makeTranslation((i % 20) * 4, 0, Math.floor(i / 20) * 4),
 * }));
 * const geo = await registerMergedGeometryAsync(parts, { id: 'rockFieldGeo' });
 * createMeshEntity({ geo, mat: 'rockMat' });
 * ```
 */
export const registerMergedGeometryAsync = async (
  parts: MergePart[],
  opts: RegisterMergedGeometryOptions = {}
): Promise<THREE.BufferGeometry> => {
  const { groups, attributes, indexed, ...props } = opts;
  const ownerScope = getAssetOwnerScope();
  const existing = props.id ? getGeometry(props.id) : undefined;
  if (existing) return saveBufferGeometry(existing, props);
  const { geometry, warnings, report } = await mergeWithReportAsync(parts, {
    groups,
    attributes,
    indexed,
  });
  logWarnings(warnings, 'registerMergedGeometryAsync');
  return runInAssetOwnerScope(ownerScope, () => {
    // Registered while this one merged: the first one wins
    const registered = props.id ? getGeometry(props.id) : undefined;
    if (registered) {
      geometry.dispose();
      return saveBufferGeometry(registered, props);
    }
    const saved = saveBufferGeometry(geometry, props);
    recordAssetLoadReport(`merge:${String(saved.userData.id)}`, report);
    return saved;
  });
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
 * Registers a `MERGED` geometry JSON's props ({@link registerMergedGeometryAsync} with its
 * parts' transforms as matrices, so in the assets worker): the scene loader's, which `import()`s
 * this module for a scene's first `MERGED` geometry.
 * @internal
 * @throws (rejects) as {@link mergeGeometryParts}
 */
export const registerMergedGeoPropsAsync = (
  props: MergedGeoProps
): Promise<THREE.BufferGeometry> => {
  const { type, params, ...registration } = props;
  const { parts, groups, attributes, indexed } = params;
  const mergeParts: MergePart[] = parts.map((part) => ({
    geo: part.geo,
    matrix: getPartMatrix(part),
    ...(part.materialSlot !== undefined ? { materialSlot: part.materialSlot } : {}),
    ...(part.key !== undefined ? { key: part.key } : {}),
  }));
  return registerMergedGeometryAsync(mergeParts, {
    ...registration,
    groups,
    attributes,
    indexed,
  });
};
