import * as THREE from 'three/webgpu';
import { getRenderer } from '../render/Renderer';
import { getRootScene } from '../scene/Scene';
import { lwarn } from '../../utils/Logger';
import { IS_DEBUG_ENV } from '../config/Config';
import { recordAssetOwner, retagAssetOwner } from './AssetOwners';

/**
 * A geometry's name and description for the debug tooling.
 * @internal
 */
export type GeoDebugData = { name?: string; description?: string };

const geometries: {
  [id: string]: {
    resource: THREE.BufferGeometry;
    count: number;
    persistent?: boolean;
    preWarm?: boolean;
    debugData?: GeoDebugData;
  };
} = {};

/** The props every geometry type shares ({@link GeoProps} adds the type and its params). */
export type GeoBaseProps = {
  /** The registry id. A registered id returns the registered geometry (see {@link createGeometry}).
   * Default: the geometry's uuid. */
  id?: string;
  /** Never released by its scene or its last ref: only {@link deleteGeometry} removes it. */
  isPersistent?: boolean;
  /** Uploads its buffers to the GPU at registration, so its first frame doesn't wait for them. */
  preWarm?: boolean;
  /** Name/description for debug tooling, also stored on `geometry.userData.debugData`. */
  debugData?: { name?: string; description?: string };
};

/**
 * A geometry {@link createGeometry} builds: its `type` and that three geometry's constructor
 * arguments by name in `params` (three's defaults for those left out). A `*.geometry.json`'s
 * `geoProps`.
 */
export type GeoProps = GeoBaseProps &
  (
    | {
        type: 'BOX';
        params?: {
          width?: number;
          height?: number;
          depth?: number;
          widthSegments?: number;
          heightSegments?: number;
          depthSegments?: number;
        };
      }
    | {
        type: 'SPHERE';
        params?: {
          radius?: number;
          widthSegments?: number;
          heightSegments?: number;
          phiStart?: number;
          phiLength?: number;
          thetaStart?: number;
          thetaLength?: number;
        };
      }
    | {
        type: 'CYLINDER';
        params?: {
          radiusTop?: number;
          radiusBottom?: number;
          height?: number;
          radialSegments?: number;
          heightSegments?: number;
          openEnded?: boolean;
          thetaStart?: number;
          thetaLength?: number;
        };
      }
    | {
        type: 'CAPSULE';
        params?: {
          radius?: number;
          height?: number;
          capSegments?: number;
          radialSegments?: number;
          heightSegments?: number;
        };
      }
    | {
        type: 'CONE';
        params?: {
          radius?: number;
          height?: number;
          radialSegments?: number;
          heightSegments?: number;
          openEnded?: boolean;
          thetaStart?: number;
          thetaLength?: number;
        };
      }
  );

/** The three geometries {@link createGeometry} builds, one per {@link GeoProps} `type`. */
export type GeoTypes =
  | THREE.BoxGeometry
  | THREE.SphereGeometry
  | THREE.CylinderGeometry
  | THREE.CapsuleGeometry
  | THREE.ConeGeometry;

/**
 * A listener for {@link onGeometryDeleted}: the deleted geometry's id and the disposed geometry.
 * @internal
 */
export type GeometryDeleteListener = (id: string, geometry: THREE.BufferGeometry) => void;
const deleteListeners = new Set<GeometryDeleteListener>();

/**
 * Calls `listener` after a geometry was disposed and left the registry (eg. so the LOD chain of a
 * base geometry goes with it).
 * @internal
 * @returns the listener's remover
 */
export const onGeometryDeleted = (listener: GeometryDeleteListener) => {
  deleteListeners.add(listener);
  return () => deleteListeners.delete(listener);
};

/**
 * A sphere around the geometry's local origin (where its entity's position is) that holds its
 * whole bounding sphere: `|center| + radius`. Conservative for geometry that isn't centred on its
 * origin, where the bounding sphere's radius alone would miss part of it. Computes the geometry's
 * bounding sphere when it has none.
 * @example
 * ```ts
 * import { getGeometry } from 'aekasha';
 * import { getConservativeGeometryRadius } from 'aekasha/spatial';
 *
 * const rock = getGeometry('rockGeo');
 * const radius = rock ? getConservativeGeometryRadius(rock) : 0;
 * ```
 */
export function getConservativeGeometryRadius(geometry: THREE.BufferGeometry): number {
  if (!geometry.boundingSphere) geometry.computeBoundingSphere();
  const sphere = geometry.boundingSphere;
  return sphere ? sphere.center.length() + sphere.radius : 0;
}

/** Frees the geometry's VRAM and removes it from the registry. */
const removeGeometry = (id: string) => {
  const entry = geometries[id];
  if (!entry) return;
  entry.resource.dispose();
  delete geometries[id];
  for (const listener of deleteListeners) listener(id, entry.resource);
};

/**
 * Takes a ref on a registered geometry: it isn't released (by {@link decGeometryRef} or its
 * scene's release) while it has refs. A mesh entity takes one on its geometry and releases it when
 * it's deleted; take one for a geometry something else holds, eg. an `InstancedMesh` entity you
 * built. An unregistered id does nothing.
 * @example
 * ```ts
 * import { decGeometryRef, incGeometryRef } from 'aekasha';
 *
 * incGeometryRef('rockGeo'); // held while something outside the mesh entities draws it
 * // …
 * decGeometryRef('rockGeo'); // disposed now if it was the last ref (and not persistent)
 * ```
 */
export const incGeometryRef = (id: string) => {
  if (geometries[id]) geometries[id].count++;
};

/**
 * Releases a ref {@link incGeometryRef} took: a non-persistent geometry whose last ref this was is
 * disposed and leaves the registry. An unregistered id does nothing.
 */
export const decGeometryRef = (id: string) => {
  const entry = geometries[id];
  if (!entry) return;
  entry.count--;
  if (entry.count <= 0 && !entry.persistent) removeGeometry(id);
};

// What a geometry's pre-warm compiles with, made on the first one and shared by every later one:
// the compile is there for the geometry's buffers, so any material and camera do
let preWarmMaterial: THREE.MeshBasicNodeMaterial | null = null;
let preWarmCamera: THREE.PerspectiveCamera | null = null;

/**
 * Uploads a registered geometry's buffers to the GPU ahead of its first draw, by compiling a
 * stand-in mesh with it (`renderer.compileAsync`, which creates the buffers without drawing). Run
 * by `createGeometry` and `saveBufferGeometry` for `preWarm`. Does nothing without a renderer or
 * the root scene, and a failed compile only warns: the first draw uploads them, as without a
 * pre-warm.
 * @internal
 */
export const prewarmGeometry = async (id: string) => {
  const entry = geometries[id];
  const renderer = getRenderer();
  const rootScene = getRootScene();
  if (!entry || !renderer || !rootScene) return;
  preWarmMaterial ??= new THREE.MeshBasicNodeMaterial();
  preWarmCamera ??= new THREE.PerspectiveCamera();
  const stagingMesh = new THREE.Mesh(entry.resource, preWarmMaterial);
  try {
    await renderer.compileAsync(stagingMesh, preWarmCamera, rootScene);
  } catch (err) {
    lwarn(`Pre-warming geometry "${id}" failed: its buffers upload on its first draw.`, err);
  } finally {
    // The renderer keeps an object's render objects until it's disposed: the stand-in's go (its
    // geometry's buffers stay, they're the geometry's)
    stagingMesh.dispose();
  }
};

/**
 * Creates and registers a three geometry from its props: owned by the scene loading (or current),
 * released with it when nothing holds a ref (see {@link incGeometryRef}). An `id` already
 * registered returns that geometry, re-tagged to the scene getting it, and builds nothing (the
 * props are ignored).
 * @template T the geometry class `props.type` builds, for the caller's type
 * @throws for an unknown `type`
 * @example
 * ```ts
 * import * as THREE from 'three/webgpu';
 * import { createGeometry } from 'aekasha';
 *
 * const box = createGeometry<THREE.BoxGeometry>({
 *   id: 'crateGeo',
 *   type: 'BOX',
 *   params: { width: 1, height: 1, depth: 1 },
 * });
 * ```
 */
export const createGeometry = <T extends GeoTypes>(props: GeoProps): T => {
  let geo;
  if (props?.id && geometries[props.id]) {
    retagAssetOwner(geometries[props.id].resource);
    return geometries[props.id].resource as T;
  }

  switch (props.type) {
    case 'BOX':
      geo = new THREE.BoxGeometry(
        props.params?.width,
        props.params?.height,
        props.params?.depth,
        props.params?.widthSegments,
        props.params?.heightSegments,
        props.params?.depthSegments
      );
      break;
    case 'SPHERE':
      geo = new THREE.SphereGeometry(
        props.params?.radius,
        props.params?.widthSegments,
        props.params?.heightSegments,
        props.params?.phiStart,
        props.params?.phiLength,
        props.params?.thetaStart,
        props.params?.thetaLength
      );
      break;
    case 'CYLINDER':
      geo = new THREE.CylinderGeometry(
        props.params?.radiusTop,
        props.params?.radiusBottom,
        props.params?.height,
        props.params?.radialSegments,
        props.params?.heightSegments,
        props.params?.openEnded,
        props.params?.thetaStart,
        props.params?.thetaLength
      );
      break;
    case 'CAPSULE':
      geo = new THREE.CapsuleGeometry(
        props.params?.radius,
        props.params?.height,
        props.params?.capSegments,
        props.params?.radialSegments,
        props.params?.heightSegments
      );
      break;
    case 'CONE':
      geo = new THREE.ConeGeometry(
        props.params?.radius,
        props.params?.height,
        props.params?.radialSegments,
        props.params?.heightSegments,
        props.params?.openEnded,
        props.params?.thetaStart,
        props.params?.thetaLength
      );
      break;
  }

  if (!geo) {
    throw new Error(
      `Could not create geometry (unknown type: ${props.type}). Geometry id "${props?.id}".`
    );
  }

  const id = props?.id || geo.uuid;
  geo.userData.id = id;
  geo.userData.props = props;
  if (props?.debugData) geo.userData.debugData = props.debugData;
  geometries[id] = {
    resource: geo,
    count: 0,
    ...(props?.isPersistent ? { persistent: true } : {}),
    ...(props?.preWarm ? { preWarm: true } : {}),
    ...(props?.debugData ? { debugData: props.debugData } : {}),
  };
  recordAssetOwner(geo);

  if (props?.preWarm) void prewarmGeometry(id);

  return geo as T;
};

/**
 * Returns a registered geometry by its id, or undefined when none is registered under it. With
 * an array of ids, the registered ones among them, in the array's order (an unregistered id is
 * left out).
 * @param id geometry id or array of ids
 * @example
 * ```ts
 * import { getGeometry } from 'aekasha';
 *
 * const crate = getGeometry('crateGeo');
 * if (crate) crate.computeBoundingBox();
 * ```
 */
export function getGeometry(id: string): THREE.BufferGeometry | undefined;
export function getGeometry(id: string[]): THREE.BufferGeometry[];
export function getGeometry(
  id: string | string[]
): THREE.BufferGeometry | THREE.BufferGeometry[] | undefined {
  if (typeof id === 'string') return geometries[id]?.resource;
  const found: THREE.BufferGeometry[] = [];
  for (let i = 0; i < id.length; i++) {
    const entry = geometries[id[i]];
    if (entry) found.push(entry.resource);
  }
  return found;
}

/**
 * Disposes one or many registered geometries and removes them from the registry, whatever their
 * refs and persistence: a mesh still drawing one re-uploads it. An unregistered id is skipped.
 * @param id geometry id or array of ids
 * @example
 * ```ts
 * import { deleteGeometry } from 'aekasha';
 *
 * deleteGeometry(['crateGeo', 'rockGeo']);
 * ```
 */
export const deleteGeometry = (id: string | string[]) => {
  if (typeof id === 'string') return removeGeometry(id);
  for (let i = 0; i < id.length; i++) removeGeometry(id[i]);
};

/**
 * The geometry registry by id: each entry's geometry (`resource`), ref count, persistence and
 * debug data. Read it, never write it (the registry functions keep it consistent).
 * @example
 * ```ts
 * import { getGeometryRegistry } from 'aekasha';
 *
 * const unused = Object.keys(getGeometryRegistry()).filter(
 *   (id) => getGeometryRegistry()[id].count === 0
 * );
 * ```
 */
export const getGeometryRegistry = () => geometries;

/**
 * Registers a geometry you built (generated, merged, loaded): owned by the scene loading (or
 * current) like {@link createGeometry}'s, uploaded at once with `preWarm`. An `id` already
 * registered returns that geometry and leaves the one passed in unregistered (the debug env warns
 * when they differ): dispose it, or check {@link getGeometry} before building one.
 * @param geometry the geometry to register
 * @param props its id (default: its uuid), persistence, pre-warm and debug data; `isImported`
 * marks a glTF import's geometry
 * @returns the registered geometry
 * @example
 * ```ts
 * import * as THREE from 'three/webgpu';
 * import { getGeometry, saveBufferGeometry } from 'aekasha';
 *
 * const knot =
 *   getGeometry('knotGeo') ??
 *   saveBufferGeometry(new THREE.TorusKnotGeometry(1, 0.3, 128, 16), { id: 'knotGeo' });
 * ```
 */
export const saveBufferGeometry = (
  geometry: THREE.BufferGeometry,
  props?: GeoBaseProps & { isImported?: boolean }
) => {
  const id = props?.id || geometry.uuid;
  if (geometries[id]) {
    if (IS_DEBUG_ENV && geometries[id].resource !== geometry) {
      lwarn(
        `saveBufferGeometry: "${id}" is registered already, so the registered geometry is returned and the one passed in isn't registered (dispose it, or check getGeometry("${id}") before building one).`
      );
    }
    retagAssetOwner(geometries[id].resource);
    return geometries[id].resource;
  }
  geometry.userData.id = id;
  if (props?.isImported) geometry.userData.isImported = true;
  if (props?.debugData) geometry.userData.debugData = props.debugData;
  geometries[id] = {
    resource: geometry,
    count: 0,
    ...(props?.isPersistent ? { persistent: true } : {}),
    ...(props?.preWarm ? { preWarm: true } : {}),
    ...(props?.debugData ? { debugData: props.debugData } : {}),
  };
  recordAssetOwner(geometry);

  if (props?.preWarm) void prewarmGeometry(id);

  return geometry;
};

/**
 * Whether a geometry is registered under the id.
 * @internal
 */
export const doesGeoExist = (id: string) => Boolean(geometries[id]);
