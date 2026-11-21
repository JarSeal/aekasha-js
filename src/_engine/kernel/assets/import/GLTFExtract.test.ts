import { Document, Logger, NodeIO, Primitive, PropertyType, type Node } from '@gltf-transform/core';
import { EXTMeshGPUInstancing, KHRMeshQuantization } from '@gltf-transform/extensions';
import { dedup, quantize } from '@gltf-transform/functions';
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { describe, expect, test, vi } from 'vitest';
import { AssetsProtocolType, type AssetsDownProtocol } from '../AssetsAPITypes';
import { assetsSwitchGLTF } from '../worker/AssetsSwitchGLTF';
import { extractPrimitives } from './GLTFExtract';
import { getGLTFPrimitiveKey } from './GLTFPrimitiveKey';
import {
  GLTF_QUANTIZATION_EXTRAS_KEY,
  GLTF_QUANTIZATION_FORMAT_VERSION,
  type GLTFDequantizationTarget,
} from './GLTFQuantization';
import { addInstancesToTransfer } from './GeometryTransfer';
import type { ImportedInstances } from './ImportTypes';

// The worker's job fetches the file: here it gets the test's GLB
const files = vi.hoisted(() => new Map<string, Uint8Array>());
vi.mock(import('../worker/AssetsFetch'), () => ({
  fetchAsset: async (url: string) => new Response(files.get(url)!.slice()),
}));

/** Three instances' glTF TRS (the node at x 10 places them) */
const INSTANCES = [
  { t: [1, 0, 0], r: new THREE.Euler(0, 0, 0), s: [1, 1, 1], color: [1, 0, 0], item: 0 },
  {
    t: [0, 0.5, 2],
    r: new THREE.Euler(0.3, 1.1, -0.4),
    s: [0.5, 2, 1.5],
    color: [0, 1, 0],
    item: 2,
  },
  { t: [-3, 1, 0], r: new THREE.Euler(0, Math.PI / 2, 0), s: [2, 2, 2], color: [0, 0, 1], item: 1 },
].map((instance) => ({ ...instance, q: new THREE.Quaternion().setFromEuler(instance.r) }));
const NODE_TRANSLATION: [number, number, number] = [10, 0, 0];

const TRIANGLE = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);

const createDoc = () => new Document().setLogger(new Logger(Logger.Verbosity.SILENT));

const accessor = (doc: Document, type: 'SCALAR' | 'VEC3' | 'VEC4', values: number[]) =>
  doc
    .createAccessor()
    .setType(type)
    .setArray(new Float32Array(values))
    .setBuffer(doc.getRoot().listBuffers()[0] ?? doc.createBuffer());

const createTriangleMesh = (doc: Document, primitives = 1) => {
  const mesh = doc.createMesh('rock');
  for (let i = 0; i < primitives; i++) {
    mesh.addPrimitive(
      doc.createPrimitive().setAttribute('POSITION', accessor(doc, 'VEC3', [...TRIANGLE]))
    );
  }
  return mesh;
};

/** A node of GPU instances (`EXT_mesh_gpu_instancing`), with colours and a custom attribute */
const addInstancedNode = (doc: Document, name: string, primitives = 1) => {
  const batch = doc
    .createExtension(EXTMeshGPUInstancing)
    .createInstancedMesh()
    .setAttribute(
      'TRANSLATION',
      accessor(
        doc,
        'VEC3',
        INSTANCES.flatMap((i) => i.t)
      )
    )
    .setAttribute(
      'ROTATION',
      accessor(
        doc,
        'VEC4',
        INSTANCES.flatMap((i) => i.q.toArray())
      )
    )
    .setAttribute(
      'SCALE',
      accessor(
        doc,
        'VEC3',
        INSTANCES.flatMap((i) => i.s)
      )
    )
    .setAttribute(
      '_COLOR_0',
      accessor(
        doc,
        'VEC3',
        INSTANCES.flatMap((i) => i.color)
      )
    )
    .setAttribute('_ID', accessor(doc, 'SCALAR', [7, 8, 9]));
  const node = doc
    .createNode(name)
    .setMesh(createTriangleMesh(doc, primitives))
    .setTranslation(NODE_TRANSLATION)
    .setExtension('EXT_mesh_gpu_instancing', batch);
  doc.getRoot().getDefaultScene()!.addChild(node);
  return node;
};

/** The same instances as a point cloud, its custom attributes in Blender's Z-up axes as its
 * exporter writes them: `_ROT` (w, x, y, z), `_SCALE` (x, y, z) */
const addPointCloudNode = (doc: Document, name: string, extras = { aekScatterPoints: 1 }) => {
  // glTF (x, y, z) is Blender's (x, -z, y)
  const rotations = INSTANCES.flatMap(({ q }) => [q.w, q.x, -q.z, q.y]);
  const scales = INSTANCES.flatMap(({ s }) => [s[0], s[2], s[1]]);
  const primitive = doc
    .createPrimitive()
    .setMode(Primitive.Mode.POINTS)
    .setAttribute(
      'POSITION',
      accessor(
        doc,
        'VEC3',
        INSTANCES.flatMap((i) => i.t)
      )
    )
    .setAttribute('_ROT', accessor(doc, 'VEC4', rotations))
    .setAttribute('_SCALE', accessor(doc, 'VEC3', scales))
    .setAttribute(
      '_ITEM',
      accessor(
        doc,
        'SCALAR',
        INSTANCES.map((i) => i.item)
      )
    );
  const node = doc
    .createNode(name)
    .setMesh(doc.createMesh('points').addPrimitive(primitive))
    .setTranslation(NODE_TRANSLATION)
    .setExtras(extras);
  doc.getRoot().getDefaultScene()!.addChild(node);
  return node;
};

const createScene = (doc: Document) => doc.getRoot().setDefaultScene(doc.createScene());

const writeGlbAsync = (doc: Document) =>
  new NodeIO().registerExtensions([EXTMeshGPUInstancing, KHRMeshQuantization]).writeBinary(doc);

const parseAsync = async (glb: Uint8Array) => new GLTFLoader().parseAsync(glb.slice().buffer, '');

const extractAsync = async (doc: Document) =>
  extractPrimitives(await parseAsync(await writeGlbAsync(doc)), { importId: 'scatter' });

const expectedMatrices = () => {
  const matrices = new Float32Array(INSTANCES.length * 16);
  INSTANCES.forEach(({ t, q, s }, i) =>
    new THREE.Matrix4()
      .compose(new THREE.Vector3(...t), q, new THREE.Vector3(...s))
      .toArray(matrices, i * 16)
  );
  return matrices;
};

const expectClose = (actual: ArrayLike<number>, expected: ArrayLike<number>, digits = 5) => {
  expect(actual.length).toBe(expected.length);
  for (let i = 0; i < expected.length; i++) expect(actual[i]).toBeCloseTo(expected[i], digits);
};

/** Each instance's triangle in the glTF root's space: what the file draws */
const getDrawnVertices = (
  transform: {
    position: THREE.Vector3Like;
    quaternion: THREE.QuaternionLike;
    scale: THREE.Vector3Like;
  },
  instances: ImportedInstances,
  geometry: THREE.BufferGeometry
) => {
  const node = new THREE.Matrix4().compose(
    new THREE.Vector3().copy(transform.position),
    new THREE.Quaternion().copy(transform.quaternion),
    new THREE.Vector3().copy(transform.scale)
  );
  const position = geometry.getAttribute('position');
  const vertices: number[] = [];
  const instance = new THREE.Matrix4();
  for (let i = 0; i < instances.matrices.length / 16; i++) {
    instance.fromArray(instances.matrices, i * 16).premultiply(node);
    for (let v = 0; v < position.count; v++) {
      vertices.push(
        ...new THREE.Vector3().fromBufferAttribute(position, v).applyMatrix4(instance).toArray()
      );
    }
  }
  return vertices;
};

describe('extractPrimitives: GPU instances', () => {
  test("a node's instances in its space, their colours, and no instance attribute in the geometry", async () => {
    const doc = createDoc();
    createScene(doc);
    addInstancedNode(doc, 'Rocks');
    const { primitives, pointClouds } = await extractAsync(doc);
    expect(pointClouds).toEqual([]);
    expect(primitives).toHaveLength(1);
    const [{ geometry, info }] = primitives!;
    expect(info.geometryId).toBe('scatter/Rocks');
    expect(info.meshName).toBe('rock');
    expect(info.transform.position).toEqual({ x: 10, y: 0, z: 0 });
    expectClose(info.instances!.matrices, expectedMatrices());
    expectClose(
      info.instances!.colors!,
      INSTANCES.flatMap((i) => i.color)
    );
    // three put `_ID` into its copy of the geometry as a per-instance attribute
    expect(Object.keys(geometry.attributes)).toEqual(['position']);
  });

  test("a multi-primitive node's primitives keep their glTF mesh's ids, each with the instances", async () => {
    const doc = createDoc();
    createScene(doc);
    addInstancedNode(doc, 'Rocks', 2);
    const { primitives } = await extractAsync(doc);
    expect(primitives!.map(({ info }) => info.geometryId)).toEqual([
      'scatter/Rocks#0',
      'scatter/Rocks#1',
    ]);
    for (const { info } of primitives!) expectClose(info.instances!.matrices, expectedMatrices());
  });

  test("another tool's quantize folds into the instances: they draw the same", async () => {
    const doc = createDoc();
    createScene(doc);
    addInstancedNode(doc, 'Rocks');
    const plain = (await extractAsync(doc)).primitives![0];
    await doc.transform(quantize());
    const quantized = (await extractAsync(doc)).primitives![0];
    expect(quantized.geometry.getAttribute('position').array).not.toBeInstanceOf(Float32Array);
    expectClose(
      getDrawnVertices(quantized.info.transform, quantized.info.instances!, quantized.geometry),
      getDrawnVertices(plain.info.transform, plain.info.instances!, plain.geometry),
      3
    );
  });
});

describe('extractPrimitives: point clouds', () => {
  test("an aekScatterPoints node's points are the GPU instances' matrices, its items rounded", async () => {
    const doc = createDoc();
    createScene(doc);
    addPointCloudNode(doc, 'RockPoints');
    const { primitives, pointClouds } = await extractAsync(doc);
    expect(primitives).toEqual([]);
    expect(pointClouds).toHaveLength(1);
    const [cloud] = pointClouds!;
    expect(cloud).toMatchObject({ importId: 'scatter', nodeName: 'RockPoints', parentPath: [] });
    expect(cloud.transform.position).toEqual({ x: 10, y: 0, z: 0 });
    expect(cloud.customProps.warnings).toEqual([]);
    expectClose(cloud.instances.matrices, expectedMatrices());
    expect([...cloud.instances.items!]).toEqual(INSTANCES.map((i) => i.item));
  });

  test("Blender's layout: the points node under its object's node, which has the custom prop", async () => {
    const doc = createDoc();
    createScene(doc);
    // Blender 5.3 writes a Geometry Nodes point cloud as a child `GN Instance` of its object
    const points = addPointCloudNode(doc, 'GN Instance', {} as { aekScatterPoints: number });
    const object = doc.createNode('ScatterPoints').setExtras({ aekScatterPoints: 1 });
    const scene = doc.getRoot().getDefaultScene()!;
    scene.removeChild(points);
    object.addChild(points.setTranslation([0, 0, 0]));
    // A mesh under it is no point cloud
    object.addChild(doc.createNode('Rock').setMesh(createTriangleMesh(doc)));
    scene.addChild(object.setTranslation(NODE_TRANSLATION));
    // The rocks' own nodes are roots too (else the object is the unwrapped root)
    scene.addChild(doc.createNode('RockA').setMesh(createTriangleMesh(doc)));
    const { primitives, pointClouds } = await extractAsync(doc);
    expect(primitives!.map(({ info }) => info.nodeName)).toEqual(['Rock', 'RockA']);
    expect(pointClouds).toHaveLength(1);
    expect(pointClouds![0]).toMatchObject({
      nodeName: 'GN_Instance',
      parentPath: ['ScatterPoints'],
    });
    expect(pointClouds![0].transform.position).toEqual({ x: 10, y: 0, z: 0 });
    expectClose(pointClouds![0].instances.matrices, expectedMatrices());
  });

  test('without _ROT, _SCALE and _ITEM: unrotated, unscaled, no items', async () => {
    const doc = createDoc();
    createScene(doc);
    const node = addPointCloudNode(doc, 'RockPoints');
    const primitive = node.getMesh()!.listPrimitives()[0];
    for (const name of ['_ROT', '_SCALE', '_ITEM']) primitive.setAttribute(name, null);
    const [cloud] = (await extractAsync(doc)).pointClouds!;
    const expected = new Float32Array(INSTANCES.length * 16);
    INSTANCES.forEach(({ t }, i) =>
      new THREE.Matrix4()
        .makeTranslation(...(t as [number, number, number]))
        .toArray(expected, i * 16)
    );
    expectClose(cloud.instances.matrices, expected);
    expect(cloud.instances.items).toBeUndefined();
  });

  test("quantized positions without the pipeline's record are refused with the reason, and a points node without the prop is left out", async () => {
    const doc = createDoc();
    createScene(doc);
    addPointCloudNode(doc, 'RockPoints');
    addPointCloudNode(doc, 'OtherPoints', {} as { aekScatterPoints: number });
    await doc.transform(quantize());
    const { primitives, pointClouds } = await extractAsync(doc);
    expect(primitives).toEqual([]);
    expect(pointClouds!.map((cloud) => cloud.nodeName)).toEqual(['RockPoints']);
    expect(pointClouds![0].instances.matrices).toHaveLength(0);
    expect(pointClouds![0].customProps.warnings).toEqual([
      expect.stringMatching(/quantized positions.*"profile": "terrainBlock"/),
    ]);
  });
});

describe("the assets worker's GLTF job", () => {
  test("answers with the main thread's extraction, the instances' buffers transferred", async () => {
    const doc = createDoc();
    createScene(doc);
    addInstancedNode(doc, 'Rocks');
    addPointCloudNode(doc, 'RockPoints');
    const glb = await writeGlbAsync(doc);
    const mainThread = extractPrimitives(await parseAsync(glb), { importId: 'scatter' });
    files.set('https://test/scatter.glb', glb);

    let message: AssetsDownProtocol | undefined;
    let transfer: Transferable[] = [];
    await assetsSwitchGLTF(
      {
        type: AssetsProtocolType.LOAD_GLTF,
        requestId: 1,
        url: 'https://test/scatter.glb',
        importId: 'scatter',
        importTextures: false,
        draco: { decoderPath: '/draco/', decoderType: 'wasm' },
        ktx2: null,
        readLodChains: false,
      },
      (sent, sentTransfer) => {
        message = sent;
        transfer = sentTransfer ?? [];
      }
    );
    const sent = message as Extract<AssetsDownProtocol, { type: AssetsProtocolType.LOAD_GLTF }>;
    const instances = [sent.primitives[0].info.instances!, sent.pointClouds[0].instances];
    const expectedTransfer = new Set<ArrayBuffer>();
    for (const instance of instances) addInstancesToTransfer(instance, expectedTransfer);
    expect(expectedTransfer.size).toBe(4);
    for (const buffer of expectedTransfer) expect(transfer).toContain(buffer);

    // What the main thread gets: the same infos, the worker's copies detached
    const received = structuredClone(sent, { transfer });
    expect(instances[0].matrices.byteLength).toBe(0);
    expect(received.primitives.map(({ info }) => info)).toEqual(
      mainThread.primitives!.map(({ info }) => info)
    );
    expect(received.pointClouds).toEqual(mainThread.pointClouds);
  });
});

// i020: a box off its node's origin. quantize() maps its bounds to [-1, 1] around their centre,
// scaled by the largest half extent: the dequantization the asset pipeline records for it.
const BOX = [0.5, 1, -2, 2.5, 1, -2, 0.5, 4, -2, 2.5, 4, -1];
const BOX_DEQUANTIZATION = { offset: [1.5, 2.5, -1.5] as [number, number, number], scale: 1.5 };
const TRIANGLE_DEQUANTIZATION = { offset: [0.5, 0.5, 0] as [number, number, number], scale: 0.5 };

const createBoxMesh = (doc: Document, name: string) =>
  doc
    .createMesh(name)
    .addPrimitive(doc.createPrimitive().setAttribute('POSITION', accessor(doc, 'VEC3', BOX)));

/** What `devTools/assetPipeline/gltfQuantization.ts` writes into a node's extras */
const record = (
  node: Node,
  target: GLTFDequantizationTarget,
  dequantization = BOX_DEQUANTIZATION,
  version = GLTF_QUANTIZATION_FORMAT_VERSION
) =>
  node.setExtras({
    ...node.getExtras(),
    [GLTF_QUANTIZATION_EXTRAS_KEY]: { version, ...dequantization, target },
  });

/** quantize() put exactly this dequantization into the node's matrix */
const expectQuantizedBy = (
  node: Node,
  sourceMatrix: number[],
  dequantization: typeof BOX_DEQUANTIZATION
) => {
  const { offset, scale } = dequantization;
  const expected = new THREE.Matrix4()
    .fromArray(sourceMatrix)
    .multiply(new THREE.Matrix4().makeTranslation(...offset))
    .multiply(new THREE.Matrix4().makeScale(scale, scale, scale));
  expectClose(node.getMatrix(), expected.elements);
};

const expectFloatPositions = (geometry: THREE.BufferGeometry, expected: ArrayLike<number>) => {
  const position = geometry.getAttribute('position');
  expect(position.array).toBeInstanceOf(Float32Array);
  expect(position.normalized).toBe(false);
  expectClose(position.array, expected, 3);
};

const expectTransform = (
  transform: {
    position: THREE.Vector3Like;
    quaternion: THREE.QuaternionLike;
    scale: THREE.Vector3Like;
  },
  source: { translation: number[]; rotation: number[]; scale: number[] }
) => {
  expectClose(Object.values(transform.position), source.translation);
  expectClose(Object.values(transform.quaternion), source.rotation);
  expectClose(Object.values(transform.scale), source.scale);
};

describe("extractPrimitives: the asset pipeline's quantized meshes (i020)", () => {
  test('NODE: float positions in the source node space, the transform without the dequantization', async () => {
    const doc = createDoc();
    createScene(doc);
    const node = doc
      .createNode('crate')
      .setMesh(createBoxMesh(doc, 'crate'))
      .setTranslation([1, 2, 3])
      .setRotation([0, Math.SQRT1_2, 0, Math.SQRT1_2])
      .setScale([2, 2, 2]);
    doc.getRoot().getDefaultScene()!.addChild(node);
    // A second root, so the crate isn't the unwrapped import root
    doc.getRoot().getDefaultScene()!.addChild(doc.createNode('marker'));
    const source = {
      translation: node.getTranslation(),
      rotation: node.getRotation(),
      scale: node.getScale(),
    };
    const sourceMatrix = node.getMatrix();
    await doc.transform(quantize());
    expectQuantizedBy(node, sourceMatrix, BOX_DEQUANTIZATION);
    record(node, 'NODE');

    const [{ geometry, info }] = (await extractAsync(doc)).primitives!;
    expect(info.geometryId).toBe('scatter/crate');
    expectFloatPositions(geometry, BOX);
    expect(info.isDequantized).toBe(true);
    expectTransform(info.transform, source);
    expect(info.customProps.raw).not.toHaveProperty(GLTF_QUANTIZATION_EXTRAS_KEY);
    expectClose(geometry.boundingBox!.min.toArray(), [0.5, 1, -2], 3);
    expectClose(geometry.boundingBox!.max.toArray(), [2.5, 4, -1], 3);
  });

  test("PIVOT: the mesh takes its source node's name, extras and place; the node, a lone root, isn't unwrapped", async () => {
    const doc = createDoc();
    createScene(doc);
    const door = doc
      .createNode('door_left')
      .setMesh(createBoxMesh(doc, 'door_left'))
      .setTranslation([-0.25, 0.45, 0])
      .setExtras({ isPhysObj: true, keepMesh: true, colliderType: 'BOX', hx: 1 });
    const handle = doc.createNode('door_left_handle').setMesh(createBoxMesh(doc, 'handle'));
    doc.getRoot().getDefaultScene()!.addChild(door.addChild(handle));
    const doorMatrix = door.getMatrix();
    await doc.transform(quantize());
    const pivot = door.listChildren().find((child) => child !== handle)!;
    expectQuantizedBy(pivot, new THREE.Matrix4().elements, BOX_DEQUANTIZATION);
    expectQuantizedBy(handle, new THREE.Matrix4().elements, BOX_DEQUANTIZATION);
    record(pivot, 'PIVOT');
    record(handle, 'NODE');

    const { primitives } = await extractAsync(doc);
    const byId = new Map(primitives!.map((p) => [p.info.geometryId, p]));
    expect([...byId.keys()].sort()).toEqual(['scatter/door_left', 'scatter/door_left_handle']);
    const doorPrimitive = byId.get('scatter/door_left')!;
    expect(doorPrimitive.info).toMatchObject({ nodeName: 'door_left', parentPath: [] });
    expect(doorPrimitive.info.customProps).toMatchObject({
      isPhysObj: true,
      colliderParams: { type: 'BOX', hx: 1 },
    });
    expect(doorPrimitive.info.customProps.raw).not.toHaveProperty(GLTF_QUANTIZATION_EXTRAS_KEY);
    expectFloatPositions(doorPrimitive.geometry, BOX);
    expectClose(
      new THREE.Matrix4()
        .compose(
          new THREE.Vector3().copy(doorPrimitive.info.transform.position),
          new THREE.Quaternion().copy(doorPrimitive.info.transform.quaternion),
          new THREE.Vector3().copy(doorPrimitive.info.transform.scale)
        )
        .toArray(),
      doorMatrix
    );
    const handlePrimitive = byId.get('scatter/door_left_handle')!;
    expect(handlePrimitive.info).toMatchObject({ parentPath: ['door_left'] });
    expect(handlePrimitive.info.customProps.isPhysObj).toBe(false);
    expectClose(Object.values(handlePrimitive.info.transform.position), [-0.25, 0.45, 0]);
  });

  test('nodes sharing a mesh share one geometry, dequantized once', async () => {
    const doc = createDoc();
    createScene(doc);
    const mesh = createBoxMesh(doc, 'pillar');
    const scene = doc.getRoot().getDefaultScene()!;
    const a = doc.createNode('pillar_a').setMesh(mesh);
    const b = doc.createNode('pillar_b').setMesh(mesh).setTranslation([5, 0, 0]);
    scene.addChild(a).addChild(b);
    await doc.transform(quantize());
    record(a, 'NODE');
    record(b, 'NODE');

    const { primitives } = await extractAsync(doc);
    expect(primitives![0].geometry).toBe(primitives![1].geometry);
    expectFloatPositions(primitives![0].geometry, BOX);
    expect(primitives!.map(({ info }) => info.transform.position)).toEqual([
      { x: 0, y: 0, z: 0 },
      { x: 5, y: 0, z: 0 },
    ]);
  });

  test('INSTANCES: the node keeps its transform, each instance matrix loses the dequantization', async () => {
    const doc = createDoc();
    createScene(doc);
    const node = addInstancedNode(doc, 'Rocks');
    await doc.transform(quantize());
    record(node, 'INSTANCES', TRIANGLE_DEQUANTIZATION);

    const [{ geometry, info }] = (await extractAsync(doc)).primitives!;
    expectFloatPositions(geometry, TRIANGLE);
    expect(info.transform.position).toEqual({ x: 10, y: 0, z: 0 });
    expectClose(info.instances!.matrices, expectedMatrices(), 4);
  });

  test('a point cloud with a record is read, not refused', async () => {
    const doc = createDoc();
    createScene(doc);
    const node = addPointCloudNode(doc, 'RockPoints');
    await doc.transform(quantize());
    // The points' bounds: (-3, 0, 0) to (1, 1, 2)
    record(node, 'NODE', { offset: [-1, 0.5, 1], scale: 2 });

    const [cloud] = (await extractAsync(doc)).pointClouds!;
    expect(cloud.customProps.warnings).toEqual([]);
    expectClose(Object.values(cloud.transform.position), [10, 0, 0]);
    expectClose(cloud.instances.matrices, expectedMatrices(), 3);
  });

  test("a prebuilt LOD level gets the base's dequantized attribute objects, and the extent its scale", async () => {
    const doc = createDoc();
    createScene(doc);
    const node = doc.createNode('rock').setMesh(createBoxMesh(doc, 'rock'));
    doc.getRoot().getDefaultScene()!.addChild(node).addChild(doc.createNode('marker'));
    await doc.transform(quantize());
    record(node, 'NODE');
    const gltf = await parseAsync(await writeGlbAsync(doc));
    const base = (gltf.scene.getObjectByName('rock') as THREE.Mesh).geometry;
    const level = new THREE.BufferGeometry();
    level.setAttribute('position', base.getAttribute('position'));
    level.setIndex([0, 1, 2]);
    const chain = {
      extent: 2,
      baseTriangles: 2,
      vertices: 'BASE' as const,
      options: {
        ratios: [0.5],
        maxError: 0.05,
        attributeWeights: { normal: 0.5, uv: 0.5 },
        compactVertices: false,
        lockBorder: false,
        permissive: false,
      },
      levels: [{ geometry: level, triangles: 1, error: 0.01 }],
    };
    const { primitives } = extractPrimitives(gltf, {
      importId: 'scatter',
      lodChains: new Map([[getGLTFPrimitiveKey(0, 0), chain]]),
    });

    const [{ geometry, lodChain }] = primitives!;
    expectFloatPositions(geometry, BOX);
    expect(lodChain!.levels[0].geometry.getAttribute('position')).toBe(
      geometry.getAttribute('position')
    );
    expect(lodChain!.extent).toBeCloseTo(2 * BOX_DEQUANTIZATION.scale);
  });

  test("two identical glTF meshes dedup() joined keep their own ids, each in its node's space", async () => {
    const doc = createDoc();
    createScene(doc);
    const scene = doc.getRoot().getDefaultScene()!;
    const left = doc
      .createNode('door_left')
      .setMesh(createBoxMesh(doc, 'door_left'))
      .setTranslation([-1, 0, 0]);
    left.addChild(doc.createNode('door_left_handle'));
    const right = doc
      .createNode('door_right')
      .setMesh(createBoxMesh(doc, 'door_right'))
      .setTranslation([1, 0, 0]);
    scene.addChild(left).addChild(right);
    // quantize()'s own cleanup dedups accessors only (the meshes stay two)
    await doc.transform(quantize(), dedup({ propertyTypes: [PropertyType.ACCESSOR] }));
    const [leftMesh, rightMesh] = doc.getRoot().listMeshes();
    expect(leftMesh.listPrimitives()[0].getAttribute('POSITION')).toBe(
      rightMesh.listPrimitives()[0].getAttribute('POSITION')
    );
    record(left.listChildren().find((child) => child.getMesh())!, 'PIVOT');
    record(right, 'NODE');

    const { primitives } = await extractAsync(doc);
    const byId = new Map(primitives!.map((p) => [p.info.geometryId, p]));
    expect([...byId.keys()].sort()).toEqual(['scatter/door_left', 'scatter/door_right']);
    const [a, b] = [byId.get('scatter/door_left')!, byId.get('scatter/door_right')!];
    expect(a.geometry).not.toBe(b.geometry);
    expect(a.geometry.getAttribute('position')).toBe(b.geometry.getAttribute('position'));
    expectFloatPositions(b.geometry, BOX);
    expect(b.info.isDequantized).toBe(true);
    expectClose(Object.values(a.info.transform.position), [-1, 0, 0]);
    expectClose(Object.values(b.info.transform.position), [1, 0, 0]);
    expectClose(Object.values(b.info.transform.scale), [1, 1, 1]);
  });

  test('a record of another format version leaves the mesh as GLTFLoader gives it', async () => {
    const doc = createDoc();
    createScene(doc);
    const node = doc.createNode('crate').setMesh(createBoxMesh(doc, 'crate'));
    doc.getRoot().getDefaultScene()!.addChild(node).addChild(doc.createNode('marker'));
    await doc.transform(quantize());
    record(node, 'NODE', BOX_DEQUANTIZATION, GLTF_QUANTIZATION_FORMAT_VERSION + 1);

    const [{ geometry, info }] = (await extractAsync(doc)).primitives!;
    expect(geometry.getAttribute('position').array).not.toBeInstanceOf(Float32Array);
    expect(info.isDequantized).toBeUndefined();
    expect(info.transform.scale.x).toBeCloseTo(BOX_DEQUANTIZATION.scale);
  });
});
