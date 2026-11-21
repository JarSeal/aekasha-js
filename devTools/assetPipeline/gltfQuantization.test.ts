import { Document, Logger, type Node, type Transform } from '@gltf-transform/core';
import { EXTMeshGPUInstancing, type InstancedMesh } from '@gltf-transform/extensions';
import { meshopt, quantize } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import { beforeAll, describe, expect, it } from 'vitest';
import { GLTF_LOD_EXTRAS_KEY } from '../../src/_engine/features/lod/LodChainOptions';
import {
  GLTF_QUANTIZATION_EXTRAS_KEY,
  GLTF_QUANTIZATION_FORMAT_VERSION,
  type GLTFQuantizationExtras,
} from '../../src/_engine/kernel/assets/import/GLTFQuantization';
import { getSourceNode, listDequantizedPositions, quantizeRecordedAsync } from './gltfQuantization';

// A box off its node's origin, so the dequantization has an offset as well as a scale
const BOX = [0.5, 1, -2, 2.5, 1, -2, 0.5, 4, -2, 2.5, 4, -1];

const createDoc = () => {
  const doc = new Document().setLogger(new Logger(Logger.Verbosity.SILENT));
  doc.createBuffer();
  const scene = doc.createScene('Scene');
  doc.getRoot().setDefaultScene(scene);
  return { doc, scene };
};

const createMesh = (doc: Document, name: string, positions = BOX) =>
  doc.createMesh(name).addPrimitive(
    doc
      .createPrimitive()
      .setAttribute(
        'POSITION',
        doc.createAccessor().setType('VEC3').setArray(new Float32Array(positions))
      )
      .setIndices(
        doc
          .createAccessor()
          .setType('SCALAR')
          .setArray(new Uint16Array([0, 1, 2, 1, 3, 2]))
      )
  );

const runAsync = async (doc: Document, transform: Transform = quantize()) => {
  const warnings: string[] = [];
  await quantizeRecordedAsync(doc, transform, (message) => warnings.push(message));
  return warnings;
};

const getRecord = (node: Node) =>
  node.getExtras()[GLTF_QUANTIZATION_EXTRAS_KEY] as GLTFQuantizationExtras | undefined;

/** Column-major 4×4 product */
const multiply = (a: number[], b: number[]) =>
  Array.from({ length: 16 }, (_, i) => {
    const column = Math.floor(i / 4);
    const row = i % 4;
    let sum = 0;
    for (let k = 0; k < 4; k++) sum += a[k * 4 + row] * b[column * 4 + k];
    return sum;
  });

const toMatrix = ({ offset, scale }: GLTFQuantizationExtras) => [
  ...[scale, 0, 0, 0],
  ...[0, scale, 0, 0],
  ...[0, 0, scale, 0],
  ...[...offset, 1],
];

/** The recorded dequantization takes the quantized positions back to the source's */
const expectDequantizes = (node: Node, record: GLTFQuantizationExtras, source = BOX) => {
  const position = node.getMesh()!.listPrimitives()[0].getAttribute('POSITION')!;
  expect(position.getComponentSize()).toBeLessThan(4);
  const element: number[] = [];
  for (let i = 0; i < position.getCount(); i++) {
    position.getElement(i, element);
    for (let c = 0; c < 3; c++) {
      expect(element[c] * record.scale + record.offset[c]).toBeCloseTo(source[i * 3 + c], 3);
    }
  }
};

const expectMatrix = (actual: number[], expected: number[]) =>
  actual.forEach((value, i) => expect(value).toBeCloseTo(expected[i], 5));

describe('quantizeRecordedAsync (i020)', () => {
  beforeAll(() => MeshoptEncoder.ready);

  it.each([
    ['quantize()', () => quantize()],
    ['meshopt()', () => meshopt({ encoder: MeshoptEncoder })],
  ])(
    '%s: a leaf node gets NODE, its matrix the source matrix times the record',
    async (_, make) => {
      const { doc, scene } = createDoc();
      const node = doc
        .createNode('crate')
        .setMesh(createMesh(doc, 'crate'))
        .setTranslation([1, 2, 3])
        .setRotation([0, Math.SQRT1_2, 0, Math.SQRT1_2])
        .setScale([2, 2, 2]);
      scene.addChild(node);
      const sourceMatrix = node.getMatrix();
      expect(await runAsync(doc, make())).toEqual([]);

      const record = getRecord(node)!;
      expect(record).toMatchObject({ version: GLTF_QUANTIZATION_FORMAT_VERSION, target: 'NODE' });
      expectDequantizes(node, record);
      expectMatrix(node.getMatrix(), multiply(sourceMatrix, toMatrix(record)));
    }
  );

  it('a node with a child gets a PIVOT, whose parent keeps its name, extras and matrix', async () => {
    const { doc, scene } = createDoc();
    const door = doc
      .createNode('door_left')
      .setMesh(createMesh(doc, 'door_left'))
      .setTranslation([-0.25, 0.45, 0])
      .setExtras({ isPhysObj: true, colliderType: 'BOX' });
    const handle = doc.createNode('door_left_handle').setMesh(createMesh(doc, 'handle'));
    scene.addChild(door.addChild(handle));
    const sourceMatrix = door.getMatrix();
    await runAsync(doc);

    expect(door.getMesh()).toBeNull();
    expectMatrix(door.getMatrix(), sourceMatrix);
    expect(getRecord(door)).toBeUndefined();
    const pivot = door.listChildren().find((child) => child !== handle)!;
    const record = getRecord(pivot)!;
    expect(record.target).toBe('PIVOT');
    expectDequantizes(pivot, record);
    expectMatrix(pivot.getMatrix(), toMatrix(record));
    expect(getSourceNode(pivot)).toBe(door);
    expect(getSourceNode(handle)).toBe(handle);
    // The child keeps its place, and gets its own mesh's record
    expect(handle.getParentNode()).toBe(door);
    expect(getRecord(handle)?.target).toBe('NODE');
  });

  it('nodes sharing a mesh get the same record', async () => {
    const { doc, scene } = createDoc();
    const mesh = createMesh(doc, 'pillar');
    const a = doc.createNode('pillar_a').setMesh(mesh);
    const b = doc.createNode('pillar_b').setMesh(mesh).setTranslation([5, 0, 0]);
    scene.addChild(a).addChild(b);
    await runAsync(doc);

    expect(getRecord(a)).toEqual(getRecord(b));
    expectDequantizes(a, getRecord(a)!);
  });

  it('a GPU-instanced node gets INSTANCES: its node matrix stays, each instance matrix gets it', async () => {
    const { doc, scene } = createDoc();
    const translations = [0, 0, 0, 10, 0, 0];
    const batch = doc
      .createExtension(EXTMeshGPUInstancing)
      .createInstancedMesh()
      .setAttribute(
        'TRANSLATION',
        doc.createAccessor().setType('VEC3').setArray(new Float32Array(translations))
      );
    const node = doc
      .createNode('rocks')
      .setMesh(createMesh(doc, 'rock'))
      .setTranslation([1, 0, 0])
      .setExtension('EXT_mesh_gpu_instancing', batch);
    scene.addChild(node);
    await runAsync(doc);

    const record = getRecord(node)!;
    expect(record.target).toBe('INSTANCES');
    expect(node.getTranslation()).toEqual([1, 0, 0]);
    const after = node.getExtension<InstancedMesh>('EXT_mesh_gpu_instancing')!;
    const translation: number[] = [];
    const scale: number[] = [];
    for (let i = 0; i < 2; i++) {
      after.getAttribute('TRANSLATION')!.getElement(i, translation);
      after.getAttribute('SCALE')!.getElement(i, scale);
      translation.forEach((v, c) =>
        expect(v).toBeCloseTo(translations[i * 3 + c] + record.offset[c], 5)
      );
      scale.forEach((v) => expect(v).toBeCloseTo(record.scale, 5));
    }
  });

  it('a GPU-instanced node without TRS gets no record and a warning', async () => {
    const { doc, scene } = createDoc();
    const ext = doc.createExtension(EXTMeshGPUInstancing);
    const batch = ext.createInstancedMesh().setAttribute(
      '_ID',
      doc
        .createAccessor()
        .setType('SCALAR')
        .setArray(new Float32Array([0, 1]))
    );
    const node = doc
      .createNode('rocks')
      .setMesh(createMesh(doc, 'rock'))
      .setExtension('EXT_mesh_gpu_instancing', batch);
    scene.addChild(node);
    const warnings = await runAsync(doc);

    expect(getRecord(node)).toBeUndefined();
    expect(warnings).toEqual([expect.stringContaining('node "rocks"')]);
  });

  it('records nothing for an already quantized source', async () => {
    const { doc, scene } = createDoc();
    const mesh = createMesh(doc, 'crate');
    const position = mesh.listPrimitives()[0].getAttribute('POSITION')!;
    position
      .setArray(new Int16Array(BOX.map((v) => Math.round((v / 4) * 32767))))
      .setNormalized(true);
    scene.addChild(doc.createNode('crate').setMesh(mesh));
    await runAsync(doc);

    expect(getRecord(doc.getRoot().listNodes()[0])).toBeUndefined();
  });

  it("lists the recorded meshes' positions and their LOD levels', for the VRAM figure", async () => {
    const { doc, scene } = createDoc();
    const recorded = createMesh(doc, 'crate');
    scene.addChild(doc.createNode('crate').setMesh(recorded));
    const level = createMesh(doc, 'crate__lod1');
    const prequantized = createMesh(doc, 'other');
    prequantized
      .listPrimitives()[0]
      .getAttribute('POSITION')!
      .setArray(new Int16Array(BOX.length))
      .setNormalized(true);
    scene.addChild(doc.createNode('other').setMesh(prequantized));
    await runAsync(doc);
    doc.getRoot().setExtras({
      [GLTF_LOD_EXTRAS_KEY]: { chains: [{ mesh: 0, primitive: 0, levels: [{ mesh: 1 }] }] },
    });

    const position = (mesh: typeof recorded) => mesh.listPrimitives()[0].getAttribute('POSITION')!;
    expect(listDequantizedPositions(doc)).toEqual(new Set([position(recorded), position(level)]));
  });
});
