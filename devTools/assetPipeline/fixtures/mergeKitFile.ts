/* eslint-disable no-console -- a script's own output */
import path from 'path';
import { fileURLToPath } from 'url';
import { Document, NodeIO, type Material, type Mesh, type Node } from '@gltf-transform/core';
import { SRC_DIR } from '../../paths';

/**
 * The `testDebugScene`'s merge kit (p371 Phase 3, D3's exit check): a small ruin built from 20
 * box pieces in two glTF materials, which its `p371MergeKit.importedAsset.json` merges into one
 * `__merged` node (`merge: { mode: "ALL", exclude: ["door_*"] }`). Next to them, what stays:
 * two `door_*` nodes (one with a handle child) and two collider nodes. The pieces cover the
 * merge's cases: ten wall blocks with meshes of their own, six pillars sharing one mesh, and four
 * blocks under a turned, moved empty, one of them mirrored (scale x -1: inside out if the merge
 * didn't flip its winding).
 *
 * Built by hand (a deterministic file, committed with its JSON), not by the pipeline.
 *
 * Usage: `npx tsx devTools/assetPipeline/fixtures/mergeKitFile.ts`
 */

const OUT_FILE = path.join(SRC_DIR, 'app', 'scenes', 'testDebugScene', 'p371MergeKit.glb');

type Vec3 = [number, number, number];

/** The six faces: normal, then the two axes the face spans (u, v) */
const FACES: [Vec3, Vec3, Vec3][] = [
  [
    [1, 0, 0],
    [0, 0, -1],
    [0, 1, 0],
  ],
  [
    [-1, 0, 0],
    [0, 0, 1],
    [0, 1, 0],
  ],
  [
    [0, 1, 0],
    [1, 0, 0],
    [0, 0, -1],
  ],
  [
    [0, -1, 0],
    [1, 0, 0],
    [0, 0, 1],
  ],
  [
    [0, 0, 1],
    [1, 0, 0],
    [0, 1, 0],
  ],
  [
    [0, 0, -1],
    [-1, 0, 0],
    [0, 1, 0],
  ],
];

/** A box of `size`, centred, with normals and UVs (24 vertices, counter-clockwise outside) */
const createBoxMesh = (doc: Document, name: string, size: Vec3, material: Material): Mesh => {
  const half = size.map((s) => s / 2);
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (const [n, u, v] of FACES) {
    const base = positions.length / 3;
    for (const [su, sv] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ]) {
      for (let axis = 0; axis < 3; axis++) {
        positions.push((n[axis] + su * u[axis] + sv * v[axis]) * half[axis]);
      }
      normals.push(...n);
      uvs.push((su + 1) / 2, (1 - sv) / 2);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const accessor = (type: 'VEC2' | 'VEC3' | 'SCALAR', array: Float32Array | Uint16Array) =>
    doc.createAccessor().setType(type).setArray(array);
  const prim = doc
    .createPrimitive()
    .setAttribute('POSITION', accessor('VEC3', new Float32Array(positions)))
    .setAttribute('NORMAL', accessor('VEC3', new Float32Array(normals)))
    .setAttribute('TEXCOORD_0', accessor('VEC2', new Float32Array(uvs)))
    .setIndices(accessor('SCALAR', new Uint16Array(indices)))
    .setMaterial(material);
  return doc.createMesh(name).addPrimitive(prim);
};

const buildDocument = () => {
  const doc = new Document();
  doc.createBuffer();
  const scene = doc.createScene('Scene');
  doc.getRoot().setDefaultScene(scene);
  const stone = doc.createMaterial('stone').setBaseColorFactor([0.62, 0.6, 0.55, 1]);
  const moss = doc.createMaterial('moss').setBaseColorFactor([0.35, 0.5, 0.3, 1]);
  const wood = doc.createMaterial('wood').setBaseColorFactor([0.5, 0.33, 0.2, 1]);

  // The import root (GLTFExtract.ts' single empty root): the merged node goes under it
  const kit = doc.createNode('MergeKit');
  scene.addChild(kit);
  const add = (node: Node, parent: Node = kit) => {
    parent.addChild(node);
    return node;
  };
  let pieces = 0;
  const piece = (name: string, mesh: Mesh, at: Vec3, parent?: Node) => {
    pieces++;
    return add(doc.createNode(name).setMesh(mesh).setTranslation(at), parent);
  };

  // Ten wall blocks, each its own mesh, with a door gap in the middle
  for (let i = 0; i < 10; i++) {
    const x = -2.75 + i * 0.5 + (i >= 5 ? 1 : 0);
    const material = i % 3 === 2 ? moss : stone;
    piece(`wall_${i}`, createBoxMesh(doc, `wall_${i}`, [0.48, 0.5, 0.3], material), [x, 0.25, 0]);
  }
  // Six pillars sharing one mesh
  const pillar = createBoxMesh(doc, 'pillar', [0.3, 1.2, 0.3], stone);
  for (const [i, x] of [-3.2, -1.75, -0.6, 0.6, 1.75, 3.2].entries()) {
    piece(`pillar_${i}`, pillar, [x, 0.6, 0.35]);
  }
  // Four blocks on a turned, moved empty; the last one mirrored
  const upper = add(
    doc
      .createNode('upperWall')
      .setTranslation([0, 1.25, 0])
      .setRotation([0, Math.sin(0.15), 0, Math.cos(0.15)])
  );
  for (let i = 0; i < 4; i++) {
    const node = piece(
      `upper_${i}`,
      createBoxMesh(doc, `upper_${i}`, [0.7, 0.3, 0.25], i % 2 ? moss : stone),
      [-1.2 + i * 0.8, 0, 0],
      upper
    );
    if (i === 3) node.setScale([-1, 1, 1]).setRotation([0, 0, Math.sin(0.1), Math.cos(0.1)]);
  }

  // Kept: two doors in the gap (excluded by name), the left one with a handle child. Each has a
  // mesh of its own: nodes sharing one get one geometry id at import, the first node's
  const door = (name: string) => createBoxMesh(doc, name, [0.48, 0.9, 0.08], wood);
  const doorLeft = add(
    doc.createNode('door_left').setMesh(door('door_left')).setTranslation([-0.25, 0.45, 0])
  );
  add(
    doc
      .createNode('door_left_handle')
      .setMesh(createBoxMesh(doc, 'handle', [0.06, 0.06, 0.14], stone))
      .setTranslation([0.15, 0, 0]),
    doorLeft
  );
  add(doc.createNode('door_right').setMesh(door('door_right')).setTranslation([0.25, 0.45, 0]));

  // Kept: two collider-only nodes (physics custom props, CustomProps.ts)
  const colliderMesh = createBoxMesh(doc, 'groundCollider', [7, 0.1, 1.5], stone);
  add(
    doc
      .createNode('groundCollider')
      .setMesh(colliderMesh)
      .setTranslation([0, -0.05, 0])
      .setExtras({ isPhysObj: true, rigidType: 'FIXED', colliderType: 'CUBOID' })
  );
  const wallCollider = createBoxMesh(doc, 'wallCollider', [7, 1.6, 0.4], stone);
  wallCollider.setExtras({ colliderType: 'CUBOID' });
  add(
    doc
      .createNode('wallCollider')
      .setMesh(wallCollider)
      .setTranslation([0, 0.8, 0])
      .setExtras({ isPhysObj: true, rigidType: 'FIXED' })
  );
  return { doc, pieces };
};

const mainAsync = async () => {
  const { doc, pieces } = buildDocument();
  await new NodeIO().write(OUT_FILE, doc);
  console.log(
    `Wrote ${path.relative(process.cwd(), OUT_FILE)}: ${pieces} pieces, 2 doors and a handle, 2 colliders`
  );
};

// Only when this file is the script run
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  mainAsync().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
