import { Accessor, type Document, type Mesh, Node, type Transform } from '@gltf-transform/core';
import type { InstancedMesh } from '@gltf-transform/extensions';
import {
  GLTF_LOD_EXTRAS_KEY,
  type GLTFLodChainsExtras,
} from '../../src/_engine/features/lod/LodChainOptions';
import {
  GLTF_QUANTIZATION_EXTRAS_KEY,
  GLTF_QUANTIZATION_FORMAT_VERSION,
  type GLTFQuantizationExtras,
} from '../../src/_engine/kernel/assets/import/GLTFQuantization';

/**
 * Records where gltf-transform's `quantize()` (also run by `meshopt()`) put each quantized mesh's
 * dequantization (i020), in the extras of the node that got it (`GLTFQuantizationExtras`): the
 * import puts it back into the positions, so a geometry used by its id is in its node's space,
 * and reads a pivot's name, props and transform from the node it was moved out of.
 */

type Dequantization = Pick<GLTFQuantizationExtras, 'offset' | 'scale'>;

/**
 * A mesh's quantization volume as `quantize()` (`quantizationVolume: 'mesh'`) computes it:
 * gltf-transform 4.5.1's `getPositionQuantizationVolume()` and `getNodeTransform()`, which it
 * doesn't export (`gltfQuantization.test.ts` checks the recorded one against the encode).
 */
const getDequantization = (mesh: Mesh): Dequantization | null => {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const relMin = [Infinity, Infinity, Infinity];
  const relMax = [-Infinity, -Infinity, -Infinity];
  const expand = (accessor: Accessor, lo: number[], hi: number[]) => {
    const accessorMin = accessor.getMinNormalized([]);
    const accessorMax = accessor.getMaxNormalized([]);
    for (let i = 0; i < 3; i++) {
      lo[i] = Math.min(lo[i], accessorMin[i]);
      hi[i] = Math.max(hi[i], accessorMax[i]);
    }
  };
  let hasTargets = false;
  for (const prim of mesh.listPrimitives()) {
    const position = prim.getAttribute('POSITION');
    // An already quantized source keeps its positions, though quantize() still moves its node
    if (!position || position.getComponentType() !== Accessor.ComponentType.FLOAT) return null;
    expand(position, min, max);
    for (const target of prim.listTargets()) {
      const relative = target.getAttribute('POSITION');
      if (!relative) continue;
      expand(relative, relMin, relMax);
      hasTargets = true;
    }
  }
  if (min[0] === Infinity) return null;
  if (hasTargets) {
    // A morph target's relative positions, doubled, and the origin are in the volume too
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i], 2 * relMin[i], 0);
      max[i] = Math.max(max[i], 2 * relMax[i], 0);
    }
  }
  const scale = Math.max(...[0, 1, 2].map((i) => (max[i] - min[i]) / 2));
  if (!(scale > 0)) return null;
  const offset = [0, 1, 2].map((i) => min[i] + (max[i] - min[i]) / 2);
  return { offset: offset as Dequantization['offset'], scale };
};

const isQuantized = (mesh: Mesh) =>
  mesh
    .listPrimitives()
    .some((prim) => (prim.getAttribute('POSITION')?.getComponentSize() ?? 4) < 4);

/** The nodes that use a mesh */
const listMeshNodes = (mesh: Mesh) =>
  mesh.listParents().filter((parent): parent is Node => parent instanceof Node);

/**
 * Runs a transform that quantizes positions (`quantize()`, `meshopt()`) and records each
 * quantized mesh's dequantization in the extras of every node using it (`NODE`, `PIVOT` or
 * `INSTANCES`, see `GLTFDequantizationTarget`). Not recorded, and imported as before: a skinned
 * node (its dequantization is in its inverse bind matrices), a source that was already quantized.
 * @param warn Called for a GPU-instanced node without TRS instances, whose dequantization
 * `quantize()` drops
 */
export const quantizeRecordedAsync = async (
  doc: Document,
  transform: Transform,
  warn: (message: string) => void
) => {
  const before = new Map<Mesh, { dequantization: Dequantization; nodes: Set<Node> }>();
  for (const mesh of doc.getRoot().listMeshes()) {
    const dequantization = getDequantization(mesh);
    if (dequantization) before.set(mesh, { dequantization, nodes: new Set(listMeshNodes(mesh)) });
  }

  await doc.transform(transform);

  for (const [mesh, { dequantization, nodes }] of before) {
    if (!isQuantized(mesh)) continue;
    for (const node of listMeshNodes(mesh)) {
      if (node.getSkin()) continue;
      const batch = node.getExtension<InstancedMesh>('EXT_mesh_gpu_instancing');
      if (batch && !batch.listSemantics().some((s) => /^(TRANSLATION|ROTATION|SCALE)$/.test(s))) {
        warn(
          `node "${node.getName()}": its GPU instances have no TRS, so quantization drops its mesh's dequantization: give its importedAsset JSON "optimize": { "mesh": { "quantize": false } }`
        );
        continue;
      }
      const extras: GLTFQuantizationExtras = {
        version: GLTF_QUANTIZATION_FORMAT_VERSION,
        ...dequantization,
        target: !nodes.has(node) ? 'PIVOT' : batch ? 'INSTANCES' : 'NODE',
      };
      node.setExtras({ ...node.getExtras(), [GLTF_QUANTIZATION_EXTRAS_KEY]: extras });
    }
  }
};

const getRecord = (node: Node) =>
  node.getExtras()[GLTF_QUANTIZATION_EXTRAS_KEY] as GLTFQuantizationExtras | undefined;

/**
 * The source's node of a node holding a mesh: a pivot's parent (its name and extras), else the
 * node itself.
 */
export const getSourceNode = (node: Node) =>
  (getRecord(node)?.target === 'PIVOT' && node.getParentNode()) || node;

/**
 * The POSITION accessors the import turns into floats (a recorded mesh's, its prebuilt LOD
 * levels' too), for the VRAM figure: they're uploaded as 32-bit floats, not as stored.
 */
export const listDequantizedPositions = (doc: Document) => {
  const root = doc.getRoot();
  const meshes = root.listMeshes();
  const recorded = new Set(
    meshes.filter((mesh) => listMeshNodes(mesh).some((node) => getRecord(node)))
  );
  const lodChains = root.getExtras()[GLTF_LOD_EXTRAS_KEY] as GLTFLodChainsExtras | undefined;
  for (const chain of lodChains?.chains ?? []) {
    if (!recorded.has(meshes[chain.mesh])) continue;
    for (const level of chain.levels) if (meshes[level.mesh]) recorded.add(meshes[level.mesh]);
  }
  const positions = new Set<Accessor>();
  for (const mesh of recorded) {
    for (const prim of mesh.listPrimitives()) {
      const position = prim.getAttribute('POSITION');
      if (position) positions.add(position);
    }
  }
  return positions;
};
