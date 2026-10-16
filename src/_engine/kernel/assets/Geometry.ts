import * as THREE from 'three/webgpu';
import { getRenderer } from '../render/Renderer';
import { getRootScene } from '../scene/Scene';
import { lwarn } from '../../utils/Logger';
import { IS_DEBUG_ENV } from '../config/Config';
import { recordAssetOwner, retagAssetOwner } from './AssetOwners';

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
  id?: string;
  isPersistent?: boolean;
  preWarm?: boolean;
  /** Name/description for debug tooling, also stored on `geometry.userData.debugData`. */
  debugData?: GeoDebugData;
};

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

export type GeoTypes =
  | THREE.BoxGeometry
  | THREE.SphereGeometry
  | THREE.CylinderGeometry
  | THREE.CapsuleGeometry
  | THREE.ConeGeometry;

/**
 * A listener for {@link onGeometryDeleted}: the deleted geometry's id and the disposed geometry.
 */
export type GeometryDeleteListener = (id: string, geometry: THREE.BufferGeometry) => void;
const deleteListeners = new Set<GeometryDeleteListener>();

/**
 * Calls `listener` after a geometry was disposed and left the registry (eg. so the LOD chain of a
 * base geometry goes with it).
 * @returns the listener's remover
 */
export const onGeometryDeleted = (listener: GeometryDeleteListener) => {
  deleteListeners.add(listener);
  return () => deleteListeners.delete(listener);
};

/**
 * A sphere around the geometry's local origin (where its entity's position is) that holds its
 * whole bounding sphere: `|center| + radius`. Conservative for geometry that isn't centred on its
 * origin, where the bounding sphere's radius alone would miss part of it.
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

export const incGeometryRef = (id: string) => {
  if (geometries[id]) geometries[id].count++;
};

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
 * Creates a Three.js geometry.
 * @param props geometry props: {@link GeoProps}
 * @returns geometry ({@link GeoTypes})
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
    // @TODO: add all geometry types
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
 * Forcefully deletes one or many geometries from CPU and GPU memory.
 * @param id geometry id or array of ids
 */
export const deleteGeometry = (id: string | string[]) => {
  if (typeof id === 'string') return removeGeometry(id);
  for (let i = 0; i < id.length; i++) removeGeometry(id[i]);
};

export const getGeometryRegistry = () => geometries;

/**
 * Saves a buffer geometry to CPU memory and if preWarm prop is set saves it to GPU as well.
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
 * Checks, with a geometry id, whether a geometry exists or not
 * @param id (string) geometry id
 * @returns boolean
 */
export const doesGeoExist = (id: string) => Boolean(geometries[id]);
