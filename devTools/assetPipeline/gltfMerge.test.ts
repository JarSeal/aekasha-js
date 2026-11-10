import { Accessor, Document, Logger, NodeIO, type Material, type Node } from '@gltf-transform/core';
import { describe, expect, it } from 'vitest';
import { mergeGLTFNodes, resolveMergeOptions, type ResolvedMergeOptions } from './gltfMerge';

// One triangle per piece: (0,0,0), (1,0,0), (0,1,0), facing +z
const TRIANGLE = [0, 0, 0, 1, 0, 0, 0, 1, 0];

type PieceOpts = {
  material?: Material | null;
  uv?: boolean;
  tangent?: boolean;
  quantized?: boolean;
  extras?: Record<string, unknown>;
};

const createScene = () => {
  const doc = new Document().setLogger(new Logger(Logger.Verbosity.SILENT));
  doc.createBuffer();
  const scene = doc.createScene('Scene');
  doc.getRoot().setDefaultScene(scene);
  return { doc, scene };
};

const createPiece = (doc: Document, name: string, opts: PieceOpts = {}) => {
  const vec = (type: 'VEC2' | 'VEC3' | 'VEC4', array: Float32Array | Int16Array) =>
    doc.createAccessor().setType(type).setArray(array);
  const position = opts.quantized
    ? vec('VEC3', new Int16Array(TRIANGLE.map((v) => v * 32767))).setNormalized(true)
    : vec('VEC3', new Float32Array(TRIANGLE));
  const prim = doc
    .createPrimitive()
    .setAttribute('POSITION', position)
    .setAttribute('NORMAL', vec('VEC3', new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1])))
    .setIndices(
      doc
        .createAccessor()
        .setType('SCALAR')
        .setArray(new Uint16Array([0, 1, 2]))
    );
  if (opts.uv) prim.setAttribute('TEXCOORD_0', vec('VEC2', new Float32Array(6)));
  if (opts.tangent) {
    prim.setAttribute(
      'TANGENT',
      vec('VEC4', new Float32Array([1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1]))
    );
  }
  if (opts.material !== undefined) prim.setMaterial(opts.material);
  return doc
    .createNode(name)
    .setMesh(doc.createMesh(name).addPrimitive(prim))
    .setExtras(opts.extras ?? {});
};

const run = async (doc: Document, options: Partial<ResolvedMergeOptions> = {}) => {
  const warnings: string[] = [];
  const stats = await mergeGLTFNodes(doc, { mode: 'ALL', exclude: [], ...options }, (message) =>
    warnings.push(message)
  );
  return { stats, warnings };
};

const findNode = (doc: Document, name: string) =>
  doc
    .getRoot()
    .listNodes()
    .find((node) => node.getName() === name);

const getArray = (node: Node | undefined, semantic: string): number[] =>
  Array.from(node!.getMesh()!.listPrimitives()[0].getAttribute(semantic)!.getArray()!);

const getIndices = (node: Node | undefined): number[] =>
  Array.from(node!.getMesh()!.listPrimitives()[0].getIndices()!.getArray()!);

/** A triangle's vertices by its indices, rounded */
const getTriangle = (node: Node | undefined, triangle: number) => {
  const position = getArray(node, 'POSITION');
  return getIndices(node)
    .slice(triangle * 3, triangle * 3 + 3)
    .map((index) => position.slice(index * 3, index * 3 + 3).map((v) => +v.toFixed(5) || 0));
};

describe('resolveMergeOptions', () => {
  it('fills the defaults', () => {
    expect(resolveMergeOptions(true)).toEqual({ mode: 'BY_MATERIAL', exclude: [] });
    expect(resolveMergeOptions({ exclude: ['door_*'] })).toEqual({
      mode: 'BY_MATERIAL',
      exclude: ['door_*'],
    });
    expect(resolveMergeOptions({ mode: 'ALL' })).toEqual({ mode: 'ALL', exclude: [] });
  });
});

describe('mergeGLTFNodes', () => {
  it('joins every piece into one __merged node, transforms baked (ALL)', async () => {
    const { doc, scene } = createScene();
    scene.addChild(createPiece(doc, 'a'));
    scene.addChild(createPiece(doc, 'b').setTranslation([10, 0, 0]));
    const parent = doc.createNode('group').setScale([2, 2, 2]).setTranslation([0, 5, 0]);
    parent.addChild(createPiece(doc, 'c').setRotation([0, 0, Math.SQRT1_2, Math.SQRT1_2]));
    scene.addChild(parent);

    const { stats, warnings } = await run(doc);

    expect(warnings).toEqual([]);
    expect(stats.merged).toEqual([
      { name: '__merged', material: null, parts: 3, vertices: 9, triangles: 3 },
    ]);
    // The pieces' nodes and meshes are gone, the empty parent too
    expect(scene.listChildren().map((node) => node.getName())).toEqual(['__merged']);
    expect(
      doc
        .getRoot()
        .listMeshes()
        .map((mesh) => mesh.getName())
    ).toEqual(['__merged']);
    const merged = findNode(doc, '__merged');
    expect(merged!.getMatrix()).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    expect(getTriangle(merged, 0)).toEqual([
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
    ]);
    expect(getTriangle(merged, 1)).toEqual([
      [10, 0, 0],
      [11, 0, 0],
      [10, 1, 0],
    ]);
    // Turned 90° about z, scaled 2, moved up 5
    expect(getTriangle(merged, 2)).toEqual([
      [0, 5, 0],
      [0, 7, 0],
      [-2, 5, 0],
    ]);
  });

  it('bakes into the import root’s space and adds the node under it', async () => {
    const { doc, scene } = createScene();
    const importRoot = doc.createNode('Root').setTranslation([100, 0, 0]);
    importRoot.addChild(createPiece(doc, 'a').setTranslation([1, 0, 0]));
    importRoot.addChild(createPiece(doc, 'b'));
    scene.addChild(importRoot);

    await run(doc);

    expect(scene.listChildren()).toEqual([importRoot]);
    const merged = findNode(doc, '__merged');
    expect(merged!.getParentNode()).toBe(importRoot);
    expect(getTriangle(merged, 0)[0]).toEqual([1, 0, 0]);
  });

  it('makes one node per material (BY_MATERIAL), named after it', async () => {
    const { doc, scene } = createScene();
    const stone = doc.createMaterial('stone wall');
    const wood = doc.createMaterial('wood.001');
    const unnamed = doc.createMaterial();
    scene.addChild(createPiece(doc, 'a', { material: stone }));
    scene.addChild(createPiece(doc, 'b', { material: wood }));
    scene.addChild(createPiece(doc, 'c', { material: stone }));
    scene.addChild(createPiece(doc, 'd', { material: unnamed }));
    scene.addChild(createPiece(doc, 'e'));

    const { stats } = await run(doc, { mode: 'BY_MATERIAL' });

    // GLTFLoader's sanitizing: whitespace → _, no dots
    expect(stats.merged.map(({ name, material, parts }) => ({ name, material, parts }))).toEqual([
      { name: '__merged_stone_wall', material: 'stone wall', parts: 2 },
      { name: '__merged_wood001', material: 'wood.001', parts: 1 },
      { name: '__merged_material2', material: 'material2', parts: 1 },
      { name: '__merged_nomaterial', material: null, parts: 1 },
    ]);
    expect(findNode(doc, '__merged_stone_wall')!.getMesh()!.listPrimitives()[0].getMaterial()).toBe(
      stone
    );
  });

  it('joins every material into one in ALL mode', async () => {
    const { doc, scene } = createScene();
    const stone = doc.createMaterial('stone');
    scene.addChild(createPiece(doc, 'a', { material: stone }));
    scene.addChild(createPiece(doc, 'b', { material: doc.createMaterial('wood') }));

    const { stats } = await run(doc);

    expect(stats.merged).toEqual([
      { name: '__merged', material: 'stone', parts: 2, vertices: 6, triangles: 2 },
    ]);
  });

  it('keeps excluded and physics nodes with their subtrees, and counts them', async () => {
    const { doc, scene } = createScene();
    scene.addChild(createPiece(doc, 'wall'));
    const door = createPiece(doc, 'door_left').setTranslation([3, 0, 0]);
    door.addChild(createPiece(doc, 'handle'));
    scene.addChild(door);
    scene.addChild(createPiece(doc, 'ground', { extras: { isPhysObj: true, keepMesh: true } }));
    const collider = createPiece(doc, 'rampCollider');
    collider.getMesh()!.setExtras({ colliderType: 'CONVEXHULL' });
    scene.addChild(collider);
    scene.addChild(createPiece(doc, 'pillar'));

    const { stats } = await run(doc, { exclude: ['door_*'] });

    expect(stats.kept).toEqual({ excluded: 2, physics: 2, unsupported: 0 });
    expect(stats.merged[0].parts).toBe(2);
    expect(scene.listChildren().map((node) => node.getName())).toEqual([
      'door_left',
      'ground',
      'rampCollider',
      '__merged',
    ]);
    expect(door.getTranslation()).toEqual([3, 0, 0]);
    expect(door.listChildren().map((node) => node.getName())).toEqual(['handle']);
  });

  it('keeps an emptied node that a kept node hangs on', async () => {
    const { doc, scene } = createScene();
    const wall = createPiece(doc, 'wall').setTranslation([0, 2, 0]);
    wall.addChild(createPiece(doc, 'door'));
    scene.addChild(wall);
    scene.addChild(createPiece(doc, 'pillar'));

    await run(doc, { exclude: ['door'] });

    expect(wall.getMesh()).toBe(null);
    expect(wall.getTranslation()).toEqual([0, 2, 0]);
    expect(findNode(doc, 'door')!.getParentNode()).toBe(wall);
  });

  it('leaves the file’s own empty nodes', async () => {
    const { doc, scene } = createScene();
    scene.addChild(createPiece(doc, 'a'));
    scene.addChild(doc.createNode('spawnPoint').setTranslation([1, 2, 3]));

    await run(doc);

    expect(scene.listChildren().map((node) => node.getName())).toEqual(['spawnPoint', '__merged']);
  });

  it('flips a mirrored piece’s winding, normal and tangent w', async () => {
    const { doc, scene } = createScene();
    scene.addChild(createPiece(doc, 'a', { tangent: true }));
    scene.addChild(createPiece(doc, 'b', { tangent: true }).setScale([-1, 1, 1]));

    await run(doc);

    const merged = findNode(doc, '__merged');
    // (0,0,0), (-1,0,0), (0,1,0) mirrored: reversed, so it still faces its normal
    expect(getTriangle(merged, 1)).toEqual([
      [0, 1, 0],
      [-1, 0, 0],
      [0, 0, 0],
    ]);
    expect(
      getArray(merged, 'NORMAL')
        .slice(9, 12)
        .map((v) => v || 0)
    ).toEqual([0, 0, 1]);
    const tangent = getArray(merged, 'TANGENT');
    expect(tangent.slice(0, 4)).toEqual([1, 0, 0, 1]);
    expect(tangent.slice(12, 16)).toEqual([-1, 0, 0, -1]);
  });

  it('turns a tangent right (all three components from the unchanged vector)', async () => {
    const { doc, scene } = createScene();
    scene.addChild(
      createPiece(doc, 'a', { tangent: true }).setRotation([0, 0, Math.SQRT1_2, Math.SQRT1_2])
    );

    await run(doc);

    const tangent = getArray(findNode(doc, '__merged'), 'TANGENT').slice(0, 4);
    expect(tangent.map((v) => +v.toFixed(5) || 0)).toEqual([0, 1, 0, 1]);
  });

  it('copies a mesh two nodes use, and leaves a kept node’s copy as it was', async () => {
    const { doc, scene } = createScene();
    const a = createPiece(doc, 'a');
    const mesh = a.getMesh()!;
    scene.addChild(a);
    scene.addChild(doc.createNode('b').setMesh(mesh).setTranslation([5, 0, 0]));
    scene.addChild(doc.createNode('keep').setMesh(mesh).setTranslation([9, 0, 0]));

    const { stats } = await run(doc, { exclude: ['keep'] });

    expect(stats.merged[0]).toMatchObject({ parts: 2, vertices: 6 });
    expect(findNode(doc, 'keep')!.getMesh()).toBe(mesh);
    expect(getArray(findNode(doc, 'keep'), 'POSITION')).toEqual(TRIANGLE);
  });

  it('dequantizes, so quantized and float pieces join', async () => {
    const { doc, scene } = createScene();
    scene.addChild(createPiece(doc, 'a', { quantized: true }));
    scene.addChild(createPiece(doc, 'b'));

    const { stats } = await run(doc);

    expect(stats.merged).toHaveLength(1);
    const position = findNode(doc, '__merged')!
      .getMesh()!
      .listPrimitives()[0]
      .getAttribute('POSITION')!;
    expect(position.getComponentType()).toBe(Accessor.ComponentType.FLOAT);
    expect(position.getNormalized()).toBe(false);
  });

  it('splits pieces with other attribute sets, and says why', async () => {
    const { doc, scene } = createScene();
    scene.addChild(createPiece(doc, 'a', { uv: true }));
    scene.addChild(createPiece(doc, 'b'));
    scene.addChild(createPiece(doc, 'c', { uv: true }));

    const { stats, warnings } = await run(doc);

    expect(stats.merged.map(({ name, parts }) => [name, parts])).toEqual([
      ['__merged', 2],
      ['__merged_2', 1],
    ]);
    expect(warnings).toEqual([
      "merge: __merged's pieces make 2 nodes (other attribute sets, or materials of one name): __merged (NORMAL, POSITION, TEXCOORD_0); __merged_2 (NORMAL, POSITION)",
    ]);
  });

  it('keeps a merged node’s name unique against the file’s own', async () => {
    const { doc, scene } = createScene();
    scene.addChild(createPiece(doc, '__merged'));
    scene.addChild(createPiece(doc, 'a'));

    const { stats, warnings } = await run(doc, { exclude: ['__merged'] });

    expect(stats.merged[0].name).toBe('__merged_2');
    expect(warnings).toEqual([
      'merge: the file already has the name "__merged": the merged node is "__merged_2"',
    ]);
  });

  it('keeps morph-target and skinned pieces, and says so', async () => {
    const { doc, scene } = createScene();
    const morphed = createPiece(doc, 'flag');
    morphed
      .getMesh()!
      .listPrimitives()[0]
      .addTarget(
        doc
          .createPrimitiveTarget()
          .setAttribute(
            'POSITION',
            doc.createAccessor().setType('VEC3').setArray(new Float32Array(9))
          )
      );
    scene.addChild(morphed);
    const skinned = createPiece(doc, 'body');
    const joint = doc.createNode('bone');
    skinned.setSkin(doc.createSkin().addJoint(joint));
    scene.addChild(skinned);
    scene.addChild(joint);
    scene.addChild(createPiece(doc, 'a'));
    scene.addChild(createPiece(doc, 'b'));

    const { stats, warnings } = await run(doc);

    expect(stats.kept.unsupported).toBe(2);
    expect(stats.merged[0].parts).toBe(2);
    expect(warnings).toEqual([
      'merge: kept as they are, unsupported: "flag" (morph targets), "body" (skinned)',
    ]);
  });

  it('warns and changes nothing when nothing qualifies', async () => {
    const { doc, scene } = createScene();
    scene.addChild(createPiece(doc, 'door'));

    const { stats, warnings } = await run(doc, { exclude: ['door'] });

    expect(stats.merged).toEqual([]);
    expect(warnings).toEqual(['merge: no node to merge']);
    expect(findNode(doc, 'door')!.getMesh()).not.toBe(null);
  });

  it('writes a file that reads back', async () => {
    const { doc, scene } = createScene();
    for (let i = 0; i < 20; i++)
      scene.addChild(createPiece(doc, `piece${i}`).setTranslation([i, 0, 0]));

    await run(doc);

    const io = new NodeIO();
    const read = await io.readBinary(await io.writeBinary(doc));
    const nodes = read.getRoot().listNodes();
    expect(nodes.map((node) => node.getName())).toEqual(['__merged']);
    expect(read.getRoot().listAccessors()).toHaveLength(3); // position, normal, indices
    expect(getTriangle(nodes[0], 19)[0]).toEqual([19, 0, 0]);
  });
});
