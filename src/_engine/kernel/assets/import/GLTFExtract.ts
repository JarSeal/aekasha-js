import * as THREE from 'three/webgpu';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { isOnlyObject3D } from '../../render/Object3DHelpers';
import type { ExtractedLodChain, GLTFLodChains } from '../../../features/lod/LodChainGLTF';
import { parseCustomProps } from './CustomProps';
import { getGLTFPrimitiveKey } from './GLTFPrimitiveKey';
import {
  GLTF_QUANTIZATION_EXTRAS_KEY,
  GLTF_QUANTIZATION_FORMAT_VERSION,
  type GLTFQuantizationExtras,
} from './GLTFQuantization';
import type {
  ImportedGeometryInfo,
  ImportedInstances,
  ImportedPointCloudInfo,
  ParsedCustomProps,
} from './ImportTypes';

type Association = { nodes?: number; meshes?: number; primitives?: number };

type GLTFJson = {
  nodes?: { mesh?: number }[];
  meshes?: { name?: string; primitives: { extensions?: Record<string, unknown> }[] }[];
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

/** The asset pipeline's record of a quantized mesh's dequantization on a node (i020), when it's
 * of the format this build reads */
const readQuantization = (node: THREE.Object3D) => {
  const record = node.userData[GLTF_QUANTIZATION_EXTRAS_KEY] as GLTFQuantizationExtras | undefined;
  return record?.version === GLTF_QUANTIZATION_FORMAT_VERSION ? record : undefined;
};

/** A node whose mesh quantization moved into a child (a pivot) looks empty, but is a piece */
const hasPivot = (node: THREE.Object3D) =>
  node.children.some((child) => readQuantization(child)?.target === 'PIVOT');

/** A Blender export often has a single empty Object3D as its only root: its children are then
 * the real pieces, and transforms are relative to it. */
const getImportRoot = (gltf: GLTF): THREE.Object3D => {
  const children = gltf.scene.children;
  if (children.length === 1 && isOnlyObject3D(children[0]) && !hasPivot(children[0])) {
    return children[0];
  }
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

const _position = new THREE.Vector3();
const _quaternion = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _matrix = new THREE.Matrix4();

type PositionAttribute = THREE.BufferAttribute | THREE.InterleavedBufferAttribute;
type MorphName = keyof THREE.BufferGeometry['morphAttributes'];

/** What an extract has dequantized: an attribute once (a LOD level shares its base's attribute
 * objects, which the worker's serializer relies on), a geometry once (nodes share a mesh's) */
type Dequantized = {
  attributes: Map<PositionAttribute, THREE.BufferAttribute>;
  /** The float attributes made: a geometry holding one is dequantized already (a copy shares
   * its glTF mesh's attributes, `getMeshGeometry`) */
  floats: Set<THREE.BufferAttribute>;
  geometries: Map<THREE.BufferGeometry, boolean>;
};

const dequantizeAttribute = (
  attr: PositionAttribute,
  { offset, scale }: GLTFQuantizationExtras,
  isRelative: boolean,
  done: Dequantized
) => {
  let float = done.attributes.get(attr);
  if (float) return float;
  const array = new Float32Array(attr.count * 3);
  const [ox, oy, oz] = isRelative ? [0, 0, 0] : offset;
  // getX/Y/Z denormalize a normalized integer attribute, interleaved or not
  for (let i = 0; i < attr.count; i++) {
    array[i * 3] = attr.getX(i) * scale + ox;
    array[i * 3 + 1] = attr.getY(i) * scale + oy;
    array[i * 3 + 2] = attr.getZ(i) * scale + oz;
  }
  float = new THREE.BufferAttribute(array, 3);
  float.name = attr.name;
  done.attributes.set(attr, float);
  done.floats.add(float);
  return float;
};

/**
 * Puts a quantized mesh's recorded dequantization into its geometry's positions (and morph
 * targets'), as floats: the geometry is then in its node's space, as an unquantized file's is,
 * for every use of it by id. Normals and UVs stay quantized. False for positions that aren't
 * quantized (nothing to undo: the node keeps its transform as it is).
 */
const dequantizeGeometry = (
  geometry: THREE.BufferGeometry,
  record: GLTFQuantizationExtras,
  done: Dequantized
) => {
  const known = done.geometries.get(geometry);
  if (known !== undefined) return known;
  const position = geometry.getAttribute('position') as PositionAttribute | undefined;
  if (position && done.floats.has(position as THREE.BufferAttribute)) {
    done.geometries.set(geometry, true);
    return true;
  }
  const isQuantized =
    !!position && (!(position.array instanceof Float32Array) || position.normalized);
  done.geometries.set(geometry, isQuantized);
  if (!position || !isQuantized) return false;
  geometry.setAttribute('position', dequantizeAttribute(position, record, false, done));
  const targets = geometry.morphAttributes.position as PositionAttribute[] | undefined;
  if (targets) {
    geometry.morphAttributes.position = targets.map((target) =>
      dequantizeAttribute(target, record, geometry.morphTargetsRelative, done)
    );
  }
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return true;
};

/**
 * GLTFLoader caches a geometry per primitive by its accessors, so two glTF meshes with the same
 * accessors (identical meshes an encode's `dedup()` joined) get one BufferGeometry, which the
 * registry would register once, under the first node's id: each glTF mesh gets its own, sharing
 * the attribute objects (uploaded once). Nodes sharing one glTF mesh still share its geometry.
 */
const getMeshGeometry = (
  geometry: THREE.BufferGeometry,
  meshIndex: number | undefined,
  byGeometry: Map<THREE.BufferGeometry, Map<number, THREE.BufferGeometry>>
) => {
  if (meshIndex === undefined) return geometry;
  let byMesh = byGeometry.get(geometry);
  if (!byMesh) byGeometry.set(geometry, (byMesh = new Map([[meshIndex, geometry]])));
  let own = byMesh.get(meshIndex);
  if (!own) {
    own = new THREE.BufferGeometry();
    own.name = geometry.name;
    own.setIndex(geometry.index);
    for (const [name, attr] of Object.entries(geometry.attributes)) own.setAttribute(name, attr);
    for (const name of Object.keys(geometry.morphAttributes) as MorphName[]) {
      own.morphAttributes[name] = [...(geometry.morphAttributes[name] ?? [])];
    }
    own.morphTargetsRelative = geometry.morphTargetsRelative;
    for (const { start, count, materialIndex } of geometry.groups) {
      own.addGroup(start, count, materialIndex);
    }
    own.boundingBox = geometry.boundingBox?.clone() ?? null;
    own.boundingSphere = geometry.boundingSphere?.clone() ?? null;
    own.userData = { ...geometry.userData };
    byMesh.set(meshIndex, own);
  }
  return own;
};

/** The inverse of a record's dequantization (a uniform scale after an offset) */
const getDequantizationInverse = ({ offset, scale }: GLTFQuantizationExtras) =>
  new THREE.Matrix4()
    .makeScale(1 / scale, 1 / scale, 1 / scale)
    .multiply(new THREE.Matrix4().makeTranslation(-offset[0], -offset[1], -offset[2]));

/** An instanced node's matrices and colours (linear RGB floats, whatever the accessor's type).
 * `dequantizationInverse` takes a quantized mesh's dequantization out of each matrix (i020). */
const readGPUInstances = (
  mesh: THREE.InstancedMesh,
  dequantizationInverse?: THREE.Matrix4
): ImportedInstances => {
  const matrices = (mesh.instanceMatrix.array as Float32Array).slice(0, mesh.count * MATRIX_SIZE);
  if (dequantizationInverse) {
    for (let i = 0; i < mesh.count; i++) {
      _matrix
        .fromArray(matrices, i * MATRIX_SIZE)
        .multiply(dequantizationInverse)
        .toArray(matrices, i * MATRIX_SIZE);
    }
  }
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
        'The point cloud has quantized positions without the asset pipeline\'s record of their dequantization (a file another tool quantized), whose scale is in the node and would scale every instance. Give its importedAsset JSON "optimize": { "profile": "terrainBlock" }.',
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

/** Whether a node or one of its parents (below the glTF scene) has the custom prop */
const hasPropUp = (node: THREE.Object3D, scene: THREE.Object3D, prop: string) => {
  for (let p: THREE.Object3D | null = node; p && p !== scene; p = p.parent) {
    if (p.userData[prop]) return true;
  }
  return false;
};

/**
 * Walks a parsed glTF and describes every mesh primitive in it (or only in the node picked with
 * `meshIndex`): its geometry, glTF-root-relative transform, parsed custom props, its glTF mesh's
 * name, whether it was DRACO-compressed, its prebuilt LOD chain (`opts.lodChains`,
 * readGLTFLodChains()) and its GPU instances (`EXT_mesh_gpu_instancing`). A node with the custom
 * prop `aekScatterPoints`, or a points node under one (Blender writes a Geometry Nodes point cloud
 * as a child `GN Instance` of its object's node), is a point cloud: its points are instances
 * (positions, `_ROT`, `_SCALE`, `_ITEM`) and its geometry is left out. A quantized mesh whose
 * dequantization the asset pipeline recorded (`GLTFQuantization.ts`, i020) gets it back in its
 * positions (floats; its LOD levels' too), out of its transform or instance matrices, so its
 * geometry is in its node's space for every use by id; a pivot `quantize()` moved it into takes
 * its parent's name, props and place. Pure: nothing is registered, disposed or logged.
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
  const dequantized: Dequantized = {
    attributes: new Map(),
    floats: new Set(),
    geometries: new Map(),
  };
  const geometriesByMesh = new Map<THREE.BufferGeometry, Map<number, THREE.BufferGeometry>>();
  subtreeRoot.traverse((obj) => {
    const isPoints = Boolean((obj as THREE.Points).isPoints);
    if (!(obj as THREE.Mesh).isMesh && !isPoints) return;
    const mesh = obj as THREE.Mesh | THREE.Points;
    const assoc = associations.get(mesh) || {};
    // A multi-primitive glTF mesh becomes a Group (the node, holding the node's extras) with
    // one child Mesh per primitive; a single-primitive mesh is the node itself.
    const isNode = assoc.nodes !== undefined;
    const node = isNode ? mesh : (mesh.parent as THREE.Object3D);
    mesh.geometry = getMeshGeometry(mesh.geometry, assoc.meshes, geometriesByMesh);

    // A quantized mesh (i020): its positions get its dequantization back, and its transform or
    // instances lose it. A pivot's name, props and place are its parent's, the source's node.
    const quantization = readQuantization(node);
    const dequantizationInverse =
      quantization && dequantizeGeometry(mesh.geometry, quantization, dequantized)
        ? getDequantizationInverse(quantization)
        : undefined;
    const sourceNode = (quantization?.target === 'PIVOT' && node.parent) || node;

    const nodeName =
      sourceNode.name ||
      `node_${associations.get(sourceNode)?.nodes ?? primitives.length + pointClouds.length}`;
    const parentPath: string[] = [];
    for (let p = sourceNode.parent; p && p !== gltf.scene; p = p.parent) parentPath.unshift(p.name);
    const matrix = new THREE.Matrix4().multiplyMatrices(rootInverse, mesh.matrixWorld);
    if (dequantizationInverse && quantization?.target !== 'INSTANCES') {
      matrix.multiply(dequantizationInverse);
    }
    const transform = toTransform(matrix);

    // Node extras win over mesh extras, as they do on a single-primitive mesh
    const userData = {
      ...(node === mesh ? {} : mesh.userData),
      ...node.userData,
      ...(sourceNode === node ? {} : sourceNode.userData),
    };
    delete userData.gltfExtensions;
    delete userData[GLTF_QUANTIZATION_EXTRAS_KEY];
    const customProps: ParsedCustomProps = parseCustomProps(userData);

    if (
      customProps.raw.aekScatterPoints ||
      (isPoints && hasPropUp(node, gltf.scene, 'aekScatterPoints'))
    ) {
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
    let lodChain =
      meshDefIndex !== undefined
        ? lodChains?.get(getGLTFPrimitiveKey(meshDefIndex, primitiveIndex ?? 0))
        : undefined;
    if (lodChain && dequantizationInverse && quantization) {
      // Its levels index the base's quantized vertices (or copies of them), and its extent was
      // measured in them
      for (const level of lodChain.levels) {
        dequantizeGeometry(level.geometry, quantization, dequantized);
      }
      lodChain = { ...lodChain, extent: lodChain.extent * quantization.scale };
    }
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
        ...(meshDef?.name ? { meshName: meshDef.name } : {}),
        isDracoCompressed: Boolean(primitiveDef?.extensions?.KHR_draco_mesh_compression),
        ...(dequantizationInverse ? { isDequantized: true } : {}),
        ...(instancedMesh
          ? {
              instances: readGPUInstances(
                instancedMesh,
                quantization?.target === 'INSTANCES' ? dequantizationInverse : undefined
              ),
            }
          : {}),
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
