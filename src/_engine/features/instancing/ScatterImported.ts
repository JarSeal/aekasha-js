import * as THREE from 'three/webgpu';
import { getImportedAsset } from '../../kernel/assets/import/ImportRegistry';
import type {
  ImportedAssetManifest,
  ImportedGeometryInfo,
  ImportedInstances,
} from '../../kernel/assets/import/ImportTypes';
import type { ScatterDef } from './ScatterSchema';

// A scatter's `IMPORTED` source (docs/plans/p308_terrain-scatter.md D3): an import's nodes of GPU
// instances and its point clouds as the scatter's instances. Its own module, which `spawnScatter`
// loads with the first such source: it reads the import registry, and so the glTF import path.

const MATRIX_SIZE = 16;
const COLOR_SIZE = 3;

type ImportedSource = Extract<ScatterDef['source'], { type: 'IMPORTED' }>;

/** One node's instances and their item (`-1`: picked by the weights) */
type Part = { name: string; instances: ImportedInstances; item: number; node: THREE.Matrix4 };

/** A test of a node's name against `nodes`' globs (`*` any run of characters), or every name */
const toNodeTest = (nodes: readonly string[] | undefined) => {
  if (!nodes) return () => true;
  const patterns = nodes.map(
    (glob) => new RegExp(`^${glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`)
  );
  return (name: string) => patterns.some((pattern) => pattern.test(name));
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
    if (!info.instances || !isTaken(info.nodeName)) continue;
    const item = scatter.items.findIndex(({ geometry }) => geometry === info.geometryId);
    if (item < 0) {
      throw new Error(
        `${where}: no item draws the geometry "${info.geometryId}" of its node "${info.nodeName}" of GPU instances (the items' geometries: ${scatter.items.map(({ geometry }) => `"${geometry}"`).join(', ')}).`
      );
    }
    parts.push({
      name: info.nodeName,
      instances: info.instances,
      item,
      node: toNodeMatrix(info.transform),
    });
  }
  for (const cloud of manifest.pointClouds ?? []) {
    if (!isTaken(cloud.nodeName)) continue;
    const past = cloud.instances.items?.find((item) => item < 0 || item >= scatter.items.length);
    if (past !== undefined) {
      throw new Error(
        `${where}: its point cloud "${cloud.nodeName}" has the _ITEM ${past}, not one of the ${scatter.items.length} items.`
      );
    }
    parts.push({
      name: cloud.nodeName,
      instances: cloud.instances,
      item: -1,
      node: toNodeMatrix(cloud.transform),
    });
  }
  if (!parts.length) {
    const instanced = manifest.geometries
      .filter((info) => info.instances)
      .map((info) => info.nodeName);
    const clouds = (manifest.pointClouds ?? []).map((cloud) => cloud.nodeName);
    const found = [...new Set([...instanced, ...clouds])];
    throw new Error(
      `${where} has no node of GPU instances or point cloud${source.nodes ? ` matching ${source.nodes.map((n) => `"${n}"`).join(', ')}` : ''} (it has ${found.length ? found.map((n) => `"${n}"`).join(', ') : 'none: export Geometry Nodes instances with GPU Instances on, unrealized, or a point cloud with the custom prop aekScatterPoints'}).`
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
 * geometry is no item's, or a point's `_ITEM` is past the items
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
