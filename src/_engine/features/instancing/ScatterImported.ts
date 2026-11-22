import * as THREE from 'three/webgpu';
import { getGeometry } from '../../kernel/assets/Geometry';
import { getImportedAsset } from '../../kernel/assets/import/ImportRegistry';
import type {
  ImportedAssetManifest,
  ImportedGeometryInfo,
  ImportedInstances,
} from '../../kernel/assets/import/ImportTypes';
import { hasQuantizedPositions, LOSSLESS_IMPORT_FIX } from './Scatter';
import type { ScatterDef } from './ScatterSchema';

// A scatter's `IMPORTED` source (p308 D3): an import's nodes of GPU
// instances and its point clouds as the scatter's instances. Its own module, which `spawnScatter`
// loads with the first such source: it reads the import registry, and so the glTF import path.

const MATRIX_SIZE = 16;
const COLOR_SIZE = 3;

type ImportedSource = Extract<ScatterDef['source'], { type: 'IMPORTED' }>;

/** One node's instances and their item (`-1`: picked by the weights) */
type Part = { instances: ImportedInstances; item: number; node: THREE.Matrix4 };

type ImportedNode = Pick<ImportedGeometryInfo, 'nodeName' | 'parentPath'>;

/** A test of a node against `nodes`' globs (`*` any run of characters): its name or a parent's
 * (Blender writes a Geometry Nodes output as children of its object's node), or every node */
const toNodeTest = (nodes: readonly string[] | undefined) => {
  if (!nodes) return () => true;
  const patterns = nodes.map(
    (glob) => new RegExp(`^${glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`)
  );
  return ({ nodeName, parentPath }: ImportedNode) =>
    [nodeName, ...parentPath].some((name) => patterns.some((pattern) => pattern.test(name)));
};

const formatNode = ({ nodeName, parentPath }: ImportedNode) =>
  `"${[...parentPath, nodeName].join('/')}"`;

/** The item drawing a node of GPU instances: the one whose geometry is the node's, else a plain
 * node's of the same glTF mesh and primitive (Blender's GPU Instances export copies the mesh for
 * each instancing node, under its name), or -1 */
const findItem = (
  scatter: ScatterDef,
  manifest: ImportedAssetManifest,
  info: ImportedGeometryInfo
) => {
  const item = scatter.items.findIndex(({ geometry }) => geometry === info.geometryId);
  if (item >= 0 || !info.meshName) return item;
  const primitive = info.geometryId.split('#')[1];
  const twins = new Set(
    manifest.geometries
      .filter(
        (other) =>
          !other.instances &&
          other.meshName === info.meshName &&
          other.geometryId.split('#')[1] === primitive
      )
      .map((other) => other.geometryId)
  );
  return scatter.items.findIndex(({ geometry }) => twins.has(geometry));
};

const toNodeMatrix = ({
  position: p,
  quaternion: q,
  scale: s,
}: ImportedGeometryInfo['transform']) =>
  new THREE.Matrix4().compose(
    new THREE.Vector3(p.x, p.y, p.z),
    new THREE.Quaternion(q.x, q.y, q.z, q.w),
    new THREE.Vector3(s.x, s.y, s.z)
  );

/** The source's nodes, each with its item; throws naming the scatter when one can't be placed */
const collectParts = (
  scatter: ScatterDef,
  source: ImportedSource,
  manifest: ImportedAssetManifest
) => {
  const where = `spawnScatter: the scatter "${scatter.id}"'s import "${source.importedAsset}"`;
  const isTaken = toNodeTest(source.nodes);
  const parts: Part[] = [];
  for (const info of manifest.geometries) {
    if (!info.instances || !isTaken(info)) continue;
    // Quantized by another tool, its instances carry its dequantization (gltf-transform's
    // `quantize()` folds it in); the asset pipeline's records it, and the import takes it out
    const own = getGeometry(info.geometryId);
    if (own && hasQuantizedPositions(own)) {
      throw new Error(
        `${where}: its node ${formatNode(info)} of GPU instances has quantized positions (a file another tool quantized), whose scale is in each instance's matrix. ${LOSSLESS_IMPORT_FIX}`
      );
    }
    const item = findItem(scatter, manifest, info);
    if (item < 0) {
      throw new Error(
        `${where}: no item draws its node ${formatNode(info)} of GPU instances: an item's geometry is the node's "${info.geometryId}"${info.meshName ? ` or a plain node's of its mesh "${info.meshName}"` : ''} (the items' geometries: ${scatter.items.map(({ geometry }) => `"${geometry}"`).join(', ')}).`
      );
    }
    parts.push({
      instances: info.instances,
      item,
      node: toNodeMatrix(info.transform),
    });
  }
  for (const cloud of manifest.pointClouds ?? []) {
    if (!isTaken(cloud)) continue;
    const past = cloud.instances.items?.find((item) => item < 0 || item >= scatter.items.length);
    if (past !== undefined) {
      throw new Error(
        `${where}: its point cloud ${formatNode(cloud)} has the _ITEM ${past}, not one of the ${scatter.items.length} items.`
      );
    }
    parts.push({
      instances: cloud.instances,
      item: -1,
      node: toNodeMatrix(cloud.transform),
    });
  }
  if (!parts.length) {
    const found = [
      ...new Set(
        [
          ...manifest.geometries.filter((info) => info.instances),
          ...(manifest.pointClouds ?? []),
        ].map(formatNode)
      ),
    ];
    throw new Error(
      `${where} has no node of GPU instances or point cloud${source.nodes ? ` matching ${source.nodes.map((n) => `"${n}"`).join(', ')}` : ''} (it has ${found.length ? found.join(', ') : 'none: export Geometry Nodes instances with GPU Instances on, unrealized, or a point cloud with the custom prop aekScatterPoints'}).`
    );
  }
  return parts;
};

/**
 * An `IMPORTED` source's instances in world space (each node's transform, then `origin`), their
 * colours (white for a node without any, when another has them) and their items (`-1` where the
 * weights pick).
 * @internal
 * @throws when the import isn't loaded, has no node the source takes, a GPU-instanced node's
 * geometry is quantized or no item's, or a point's `_ITEM` is past the items
 */
export const getImportedScatterInstances = (
  scatter: ScatterDef,
  source: ImportedSource,
  origin: THREE.Vector3
) => {
  const manifest = getImportedAsset(source.importedAsset);
  if (!manifest) {
    throw new Error(
      `spawnScatter: the scatter "${scatter.id}" names the import "${source.importedAsset}", which isn't loaded (a scene listing the scatter loads it).`
    );
  }
  const parts = collectParts(scatter, source, manifest);
  let count = 0;
  for (const { instances } of parts) count += instances.matrices.length / MATRIX_SIZE;
  const matrices = new Float32Array(count * MATRIX_SIZE);
  const colors = parts.some(({ instances }) => instances.colors)
    ? new Float32Array(count * COLOR_SIZE).fill(1)
    : undefined;
  const picked = new Int16Array(count);
  const toWorld = new THREE.Matrix4();
  const instance = new THREE.Matrix4();
  let offset = 0;
  for (const { instances, item, node } of parts) {
    toWorld.makeTranslation(origin).multiply(node);
    const partCount = instances.matrices.length / MATRIX_SIZE;
    for (let i = 0; i < partCount; i++) {
      instance
        .fromArray(instances.matrices, i * MATRIX_SIZE)
        .premultiply(toWorld)
        .toArray(matrices, (offset + i) * MATRIX_SIZE);
      picked[offset + i] = instances.items ? instances.items[i] : item;
    }
    if (colors && instances.colors) colors.set(instances.colors, offset * COLOR_SIZE);
    offset += partCount;
  }
  return { matrices, colors, picked };
};
