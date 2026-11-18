import * as THREE from 'three/webgpu';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { isOnlyObject3D } from '../../render/Object3DHelpers';
import type { ExtractedLodChain, GLTFLodChains } from '../../../features/lod/LodChainGLTF';
import { parseCustomProps } from './CustomProps';
import type {
  ImportedGeometryInfo,
  ImportedInstances,
  ImportedPointCloudInfo,
  ParsedCustomProps,
} from './ImportTypes';

type Association = { nodes?: number; meshes?: number; primitives?: number };

type GLTFJson = {
  nodes?: { mesh?: number }[];
  meshes?: { primitives: { extensions?: Record<string, unknown> }[] }[];
};

type ImportTransform = ImportedGeometryInfo['transform'];

// Runs on both threads (main-thread imports and the assets worker): keep it free of imports that
// touch `window`/`document` (eg. Config.ts, Logger.ts, kernel/config/DebugModules.ts).

/**
 * One extracted primitive: its (not yet registered) geometry, glTF material and metadata.
 * @internal
 */
export type ExtractedPrimitive = {
  geometry: THREE.BufferGeometry;
  /** Only read for texture registration, then disposed with the rest of the glTF. */
  material: THREE.Material | THREE.Material[];
  /** `geometryId` is the preferred id; the registry step may still add a collision suffix. */
  info: ImportedGeometryInfo;
  /** The LOD chain the asset pipeline built for this primitive (p347 Phase 3), if any. Primitives
   * sharing a geometry share it. */
  lodChain?: ExtractedLodChain;
};

/**
 * {@link extractPrimitives}' result: the primitives and point clouds, or why there are none (no
 * node at `meshIndex`).
 * @internal
 */
export type ExtractResult =
  | { primitives: ExtractedPrimitive[]; pointClouds: ImportedPointCloudInfo[]; error?: undefined }
  | { primitives?: undefined; pointClouds?: undefined; error: string };

/**
 * A mesh primitive's key in a glTF file (its mesh index and primitive index): what prebuilt
 * per-primitive data, like the LOD chains (`GLTFLodChains`), is keyed by.
 * @internal
 */
export const getGLTFPrimitiveKey = (mesh: number, primitive: number) => `${mesh}:${primitive}`;

/** A Blender export often has a single empty Object3D as its only root: its children are then
 * the real pieces, and transforms are relative to it. */
const getImportRoot = (gltf: GLTF): THREE.Object3D => {
  const children = gltf.scene.children;
  if (children.length === 1 && isOnlyObject3D(children[0])) return children[0];
  return gltf.scene;
};

const getIndexedNode = (root: THREE.Object3D, meshIndex: number | number[]) => {
  const path = Array.isArray(meshIndex) ? (meshIndex.length ? meshIndex : [0]) : [meshIndex];
  let node: THREE.Object3D | undefined = root;
  for (let i = 0; i < path.length && node; i++) node = node.children[path[i]];
  return node || null;
};

const MATRIX_SIZE = 16;
const COLOR_SIZE = 3;

/** An instanced node's matrices and colours (linear RGB floats, whatever the accessor's type) */
const readGPUInstances = (mesh: THREE.InstancedMesh): ImportedInstances => {
  const matrices = (mesh.instanceMatrix.array as Float32Array).slice(0, mesh.count * MATRIX_SIZE);
  const color = mesh.instanceColor;
  if (!color) return { matrices };
  const colors = new Float32Array(mesh.count * COLOR_SIZE);
  // getX/Y/Z denormalize a normalized integer accessor; an RGBA one loses its alpha
  for (let i = 0; i < mesh.count; i++) {
    colors[i * COLOR_SIZE] = color.getX(i);
    colors[i * COLOR_SIZE + 1] = color.getY(i);
    colors[i * COLOR_SIZE + 2] = color.getZ(i);
  }
  return { matrices, colors };
};

/** three copies an instanced node's geometry to add its custom instance attributes (all but TRS
 * and `_COLOR_0`) to it: they're per instance, not per vertex, so they leave the copy, which is
 * this node's alone */
const dropInstanceAttributes = (geometry: THREE.BufferGeometry) => {
  for (const [name, attr] of Object.entries(geometry.attributes)) {
    if ((attr as THREE.InstancedBufferAttribute).isInstancedBufferAttribute) {
      geometry.deleteAttribute(name);
    }
  }
};

const _position = new THREE.Vector3();
const _quaternion = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _matrix = new THREE.Matrix4();

/** A point cloud's points as instances in its node's space, or why it has none. Blender's exporter
 * turns the positions to glTF's Y-up axes but leaves the custom attributes in its Z-up ones: `_ROT`
 * is a Blender quaternion (w, x, y, z) and `_SCALE` a Blender scale (x, y, z), or one float. */
const readPointCloud = (
  geometry: THREE.BufferGeometry
): { instances: ImportedInstances; error?: undefined } | { error: string } => {
  const position = geometry.getAttribute('position');
  if (!position) return { error: 'The point cloud has no positions.' };
  if (!(position.array instanceof Float32Array) || position.normalized) {
    return {
      error:
        'The point cloud has quantized positions (the asset pipeline\'s default meshopt encode), whose scale is in the node and would scale every instance. Give its importedAsset JSON "optimize": { "profile": "terrainBlock" }.',
    };
  }
  // GLTFLoader lowercases the names it doesn't know
  const rotation = geometry.getAttribute('_rot');
  const scale = geometry.getAttribute('_scale');
  const item = geometry.getAttribute('_item');
  if (rotation && rotation.itemSize !== 4) {
    return { error: `_ROT has ${rotation.itemSize} components, not a quaternion's 4.` };
  }
  if (scale && scale.itemSize !== 3 && scale.itemSize !== 1) {
    return { error: `_SCALE has ${scale.itemSize} components, not 3 (or 1).` };
  }
  if (item && item.itemSize !== 1) {
    return { error: `_ITEM has ${item.itemSize} components, not 1.` };
  }

  const count = position.count;
  const matrices = new Float32Array(count * MATRIX_SIZE);
  const items = item ? new Int32Array(count) : undefined;
  for (let i = 0; i < count; i++) {
    _position.fromBufferAttribute(position, i);
    // Blender's (x, y, z) is glTF's (x, z, -y); a quaternion's vector part turns alike
    if (rotation) {
      _quaternion
        .set(rotation.getY(i), rotation.getW(i), -rotation.getZ(i), rotation.getX(i))
        .normalize();
    } else {
      _quaternion.identity();
    }
    if (scale?.itemSize === 3) _scale.set(scale.getX(i), scale.getZ(i), scale.getY(i));
    else _scale.setScalar(scale ? scale.getX(i) : 1);
    _matrix.compose(_position, _quaternion, _scale).toArray(matrices, i * MATRIX_SIZE);
    if (items && item) items[i] = Math.round(item.getX(i));
  }
  return { instances: { matrices, ...(items ? { items } : {}) } };
};

const toTransform = (matrix: THREE.Matrix4): ImportTransform => {
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  matrix.decompose(position, quaternion, scale);
  return {
    position: { x: position.x, y: position.y, z: position.z },
    quaternion: { x: quaternion.x, y: quaternion.y, z: quaternion.z, w: quaternion.w },
    scale: { x: scale.x, y: scale.y, z: scale.z },
  };
};

/**
 * Walks a parsed glTF and describes every mesh primitive in it (or only in the node picked with
 * `meshIndex`): its geometry, glTF-root-relative transform, parsed custom props, whether it
 * was DRACO-compressed, its prebuilt LOD chain (`opts.lodChains`, readGLTFLodChains()) and its GPU
 * instances (`EXT_mesh_gpu_instancing`). A node with the custom prop `aekScatterPoints` is a point
 * cloud: its points are instances (positions, `_ROT`, `_SCALE`, `_ITEM`) and its geometry is
 * left out. Pure: nothing is registered, disposed or logged.
 * @internal
 */
export const extractPrimitives = (
  gltf: GLTF,
  opts: { importId: string; meshIndex?: number | number[]; lodChains?: GLTFLodChains }
): ExtractResult => {
  const { importId, meshIndex, lodChains } = opts;
  const root = getImportRoot(gltf);
  let subtreeRoot = root;
  if (meshIndex !== undefined) {
    const node = getIndexedNode(root, meshIndex);
    if (!node)
      return { error: `Could not find a node with meshIndex ${JSON.stringify(meshIndex)}.` };
    subtreeRoot = node;
  }

  const associations = gltf.parser.associations as Map<THREE.Object3D, Association>;
  const json = gltf.parser.json as GLTFJson;
  root.updateWorldMatrix(true, true);
  const rootInverse = root.matrixWorld.clone().invert();

  const primitives: ExtractedPrimitive[] = [];
  const pointClouds: ImportedPointCloudInfo[] = [];
  const idsInUse = new Set<string>();
  subtreeRoot.traverse((obj) => {
    const isPoints = Boolean((obj as THREE.Points).isPoints);
    if (!(obj as THREE.Mesh).isMesh && !isPoints) return;
    const mesh = obj as THREE.Mesh | THREE.Points;
    const assoc = associations.get(mesh) || {};
    // A multi-primitive glTF mesh becomes a Group (the node, holding the node's extras) with
    // one child Mesh per primitive; a single-primitive mesh is the node itself.
    const isNode = assoc.nodes !== undefined;
    const node = isNode ? mesh : (mesh.parent as THREE.Object3D);

    const nodeName =
      node.name ||
      `node_${associations.get(node)?.nodes ?? primitives.length + pointClouds.length}`;
    const parentPath: string[] = [];
    for (let p = node.parent; p && p !== gltf.scene; p = p.parent) parentPath.unshift(p.name);
    const transform = toTransform(
      new THREE.Matrix4().multiplyMatrices(rootInverse, mesh.matrixWorld)
    );

    // Node extras win over mesh extras, as they do on a single-primitive mesh
    const userData = { ...(node === mesh ? {} : mesh.userData), ...node.userData };
    delete userData.gltfExtensions;
    const customProps: ParsedCustomProps = parseCustomProps(userData);

    if (customProps.raw.aekScatterPoints) {
      const read = readPointCloud(mesh.geometry);
      if (read.error !== undefined) customProps.warnings.push(read.error);
      pointClouds.push({
        importId,
        nodeName,
        parentPath,
        transform,
        customProps,
        instances: read.error === undefined ? read.instances : { matrices: new Float32Array(0) },
      });
      return;
    }
    // Points without the custom prop aren't imported (nor are lines)
    if (isPoints) return;

    // three's GPU instancing replaces the node's Mesh with an InstancedMesh it doesn't associate
    // with the glTF mesh: the node's JSON and the primitive's place among its siblings say it
    let meshDefIndex = assoc.meshes;
    let primitiveIndex = assoc.primitives;
    const instancedMesh = (mesh as THREE.InstancedMesh).isInstancedMesh
      ? (mesh as THREE.InstancedMesh)
      : undefined;
    if (instancedMesh && meshDefIndex === undefined) {
      meshDefIndex = json.nodes?.[associations.get(node)?.nodes ?? -1]?.mesh;
      primitiveIndex = isNode ? 0 : node.children.indexOf(mesh);
    }
    const meshDef = meshDefIndex !== undefined ? json.meshes?.[meshDefIndex] : undefined;
    const primitiveCount = meshDef?.primitives.length || 1;
    const primitiveDef =
      primitiveIndex !== undefined ? meshDef?.primitives[primitiveIndex] : undefined;

    let geometryId = `${importId}/${nodeName}`;
    if (primitiveCount > 1) geometryId += `#${primitiveIndex ?? 0}`;
    // GLTFLoader already makes node names unique; this only guards unexpected duplicates
    for (let n = 2; idsInUse.has(geometryId); n++) geometryId = `${importId}/${nodeName}_${n}`;
    idsInUse.add(geometryId);

    if (instancedMesh) dropInstanceAttributes(mesh.geometry);
    const lodChain =
      meshDefIndex !== undefined
        ? lodChains?.get(getGLTFPrimitiveKey(meshDefIndex, primitiveIndex ?? 0))
        : undefined;
    primitives.push({
      geometry: mesh.geometry,
      material: mesh.material,
      ...(lodChain ? { lodChain } : {}),
      info: {
        geometryId,
        importId,
        nodeName,
        parentPath,
        transform,
        customProps,
        isDracoCompressed: Boolean(primitiveDef?.extensions?.KHR_draco_mesh_compression),
        ...(instancedMesh ? { instances: readGPUInstances(instancedMesh) } : {}),
      },
    });
  });

  return { primitives, pointClouds };
};

/**
 * Disposes every material, texture and geometry of a parsed glTF except the kept (registered)
 * geometries and textures. GLTFLoader decodes images into ImageBitmaps: those are closed too,
 * unless a kept texture shares the image (a clone for another UV channel does).
 * @internal
 */
export const disposeGLTFLeftovers = (
  gltf: GLTF,
  keep: { geometries?: Set<THREE.BufferGeometry>; textures?: Set<THREE.Texture> }
) => {
  const keptSources = new Set<unknown>();
  keep.textures?.forEach((texture) => keptSources.add(texture.source));
  const disposed = new Set<unknown>();
  const disposeTexture = (texture: THREE.Texture) => {
    if (disposed.has(texture) || keep.textures?.has(texture)) return;
    disposed.add(texture);
    const image = texture.source?.data as { close?: () => void } | undefined;
    if (!keptSources.has(texture.source) && typeof image?.close === 'function') image.close();
    texture.dispose();
  };

  gltf.scene.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh && !(obj as THREE.Points).isPoints) return;
    if (!keep.geometries?.has(mesh.geometry) && !disposed.has(mesh.geometry)) {
      disposed.add(mesh.geometry);
      mesh.geometry.dispose();
    }
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      if (!material || disposed.has(material)) continue;
      disposed.add(material);
      for (const value of Object.values(material)) {
        if ((value as THREE.Texture | null)?.isTexture) disposeTexture(value as THREE.Texture);
      }
      material.dispose();
    }
  });
};
