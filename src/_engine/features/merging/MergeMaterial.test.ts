import { describe, expect, test } from 'vitest';
import * as THREE from 'three/webgpu';
import { MERGE_PALETTE_INDEX_ATTRIBUTE } from '../../kernel/assets/GeometryMergeCore';
import {
  createMergeMaterial,
  MERGE_MATERIAL_INDEX_ATTRIBUTE,
  MERGE_MATERIAL_RUNTIME_SLOTS,
  MERGE_TABLE_TEXELS,
  packMergeMaterialTable,
  type MergeMaterialInfo,
} from './MergeMaterial';
import { MERGE_MATERIAL_SLOTS, type SceneMergeMaterial } from './MergeMaterialSchema';

const entry = (fields: Partial<SceneMergeMaterial['__entries'][number]> = {}) => ({
  color: 0xffffff,
  opacity: 1,
  emissive: 0x000000,
  emissiveIntensity: 1,
  roughness: 1,
  metalness: 0,
  normalScale: [1, 1] as [number, number],
  aoMapIntensity: 1,
  ...fields,
});

const palette = (fields: Partial<SceneMergeMaterial> = {}): SceneMergeMaterial => ({
  id: 'stones',
  materials: ['stoneA', 'stoneB'],
  __slots: {
    map: { texture: 'stones.map', has: [true, true] },
    normalMap: { texture: 'stones.normalMap', has: [true, false], missing: 'SKIP' },
    orm: { texture: 'stones.orm', has: [false, true], missing: 'SKIP' },
  },
  __entries: [entry(), entry()],
  ...fields,
});

const createArray = () => {
  const array = new THREE.DataArrayTexture(new Uint8Array(4 * 4 * 4 * 2), 4, 4, 2);
  array.needsUpdate = true;
  return array;
};

/** One entry's texel `texel` (vec4) of a packed table */
const texelOf = (data: Float32Array, index: number, texel: number) =>
  Array.from(
    data.slice(
      (index * MERGE_TABLE_TEXELS + texel) * 4,
      (index * MERGE_TABLE_TEXELS + texel + 1) * 4
    )
  );

describe('the merge material (p374 D3)', () => {
  test("its slots are the schema's, in its order, and its index attribute the merge's", () => {
    expect([...MERGE_MATERIAL_RUNTIME_SLOTS]).toEqual([...MERGE_MATERIAL_SLOTS]);
    expect(MERGE_MATERIAL_INDEX_ATTRIBUTE).toBe(MERGE_PALETTE_INDEX_ATTRIBUTE);
  });

  test('packs each entry: linear colours, the scalars, an identity UV transform, the SKIP flags', () => {
    const data = packMergeMaterialTable(
      palette({
        __entries: [
          entry({
            color: '#808080',
            opacity: 0.5,
            emissive: 0xff0000,
            emissiveIntensity: 2,
            roughness: 0.3,
            metalness: 0.7,
            normalScale: [0.6, -0.6],
            aoMapIntensity: 0.8,
          }),
          entry(),
        ],
      })
    );
    expect(data).toHaveLength(2 * MERGE_TABLE_TEXELS * 4);
    const grey = new THREE.Color('#808080');
    const [r, g, b, opacity] = texelOf(data, 0, 0);
    expect([r, g, b]).toEqual([grey.r, grey.g, grey.b].map(Math.fround));
    expect(r).toBeCloseTo(0.2159, 4); // sRGB 0.502 in linear
    expect(opacity).toBe(0.5);
    expect(texelOf(data, 0, 1)).toEqual([1, 0, 0, 2]);
    expect(texelOf(data, 0, 2).map((v) => Number(v.toFixed(4)))).toEqual([0.3, 0.7, 0.6, -0.6]);
    expect(texelOf(data, 0, 3).map((v) => Number(v.toFixed(4)))).toEqual([1, 0, 0, 0.8]);
    // normalMap (bit 1) is SKIP and only entry 0 has it; orm (bit 2) is SKIP and only entry 1 has it
    expect(texelOf(data, 0, 4)).toEqual([0, 1, 0, 0b010]);
    expect(texelOf(data, 1, 4)).toEqual([0, 1, 0, 0b100]);
  });

  test('sets the sockets of the slots it has arrays for, and emissive only when a member is', () => {
    const arrays = { map: createArray(), orm: createArray() };
    const { material, table } = createMergeMaterial(palette(), arrays, 'stones.table');
    expect(material).toBeInstanceOf(THREE.MeshStandardNodeMaterial);
    expect(material.colorNode).toBeTruthy();
    expect(material.roughnessNode).toBeTruthy();
    expect(material.metalnessNode).toBeTruthy();
    expect(material.aoNode).toBeTruthy();
    // No normalMap array: no normal node; nobody is emissive: no emissive node
    expect(material.normalNode).toBeNull();
    expect(material.emissiveNode).toBeNull();
    expect(table.image).toMatchObject({ width: MERGE_TABLE_TEXELS, height: 2 });
    expect(table.type).toBe(THREE.FloatType);

    const emissive = createMergeMaterial(
      palette({ __entries: [entry(), entry({ emissive: '#202060' })] }),
      {},
      'stones.table'
    ).material;
    expect(emissive.emissiveNode).toBeTruthy();
    expect(emissive.aoNode).toBeNull();
  });

  test("takes the members' agreed state, keeps its textures and its palette in userData", () => {
    const arrays = { map: createArray() };
    const { material, table } = createMergeMaterial(
      palette({ __state: { side: THREE.DoubleSide, alphaTest: 0.5 }, userData: { tag: 'ruins' } }),
      arrays,
      'stones.table'
    );
    expect(material.side).toBe(THREE.DoubleSide);
    expect(material.alphaTest).toBe(0.5);
    expect(material.userData.tag).toBe('ruins');
    const uniforms = material.userData.uniforms as Record<string, { value: THREE.Texture }>;
    expect(uniforms.mergeMaterial_table.value).toBe(table);
    expect(uniforms.mergeMaterial_map.value).toBe(arrays.map);
    expect(Object.keys(uniforms).sort()).toEqual(['mergeMaterial_map', 'mergeMaterial_table']);
    expect(material.userData.mergeMaterial).toEqual({
      paletteId: 'stones',
      materials: ['stoneA', 'stoneB'],
      tableId: 'stones.table',
      arrays,
    } satisfies MergeMaterialInfo);
  });
});
