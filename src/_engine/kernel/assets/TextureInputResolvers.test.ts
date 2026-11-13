import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { float } from 'three/tsl';
import { initEnvironment } from '../config/Config';
import { createMaterial } from './Material';
import { getMaterialInputDependencies } from './MaterialInputResolvers';
import { registerTslMaterial } from './MaterialTsl';
import { loadTextureInputResolversAsync, saveTexture } from './Texture';
import type { TextureArrayInfo } from './TextureArray';
import type { TextureAtlasInfo } from './TextureAtlas';

// The warning log is a stand-in
const fns = vi.hoisted(() => ({ lwarn: vi.fn() }));
vi.mock(import('../../utils/Logger'), async (importOriginal) => ({
  ...(await importOriginal()),
  lwarn: fns.lwarn,
}));

type Uniforms = Record<string, THREE.TextureNode | undefined>;

/** A material of the test graph with these `setup` inputs, and its cached input nodes */
const createWithInputs = (id: string, inputs: Record<string, unknown>) => {
  const mat = createMaterial({
    id,
    type: 'BASICNODEMATERIAL',
    tslMaterialId: 'textureInputTest.graph',
    inputs,
  });
  return mat.userData.uniforms as Uniforms;
};

/** The white texel a missing texture samples */
const expectWhiteTexel = (node: THREE.TextureNode | undefined) => {
  const texel = node?.value as THREE.DataTexture;
  expect([...(texel.image.data as Uint8Array)]).toEqual([255, 255, 255, 255]);
};

// A two-layer array with member names, a plain texture, and an atlas slot of 16² with one cell
const array = saveTexture(new THREE.DataArrayTexture(new Uint8Array(32), 2, 2, 2), 'texInArray');
array.userData.textureArray = { members: ['rock', 'moss'] } as Partial<TextureArrayInfo>;
saveTexture(new THREE.Texture(), 'texInPlain');
const slot = saveTexture(new THREE.Texture(), 'texInAtlas.albedo');
slot.userData.textureAtlas = {
  id: 'texInAtlas',
  slot: 'albedo',
  cells: { fern: { uv: [0, 0, 0.5, 0.5], size: [8, 8] } },
  width: 16,
  height: 16,
} as Partial<TextureAtlasInfo>;

beforeAll(() => {
  initEnvironment({ search: '?isDebug=true', env: { VITE_APP_ENV: 'development' } });
  registerTslMaterial('textureInputTest.graph', {
    setup: (_inputs, material) => {
      material.colorNode = float(1);
    },
  });
});

afterEach(() => {
  fns.lwarn.mockClear();
});

// Runs first: the resolvers register with the first array or atlas slot loaded (below)
describe('before the resolvers register (p299 D5)', () => {
  test('the dependencies are known: the array, the atlas slot', () => {
    expect(getMaterialInputDependencies({ textureArray: 'texInArray', layer: 0 })).toEqual([
      { type: 'texture', id: 'texInArray' },
    ]);
    expect(
      getMaterialInputDependencies({ atlas: 'texInAtlas', slot: 'albedo', cell: 'fern' })
    ).toEqual([{ type: 'texture', id: 'texInAtlas.albedo' }]);
    expect(getMaterialInputDependencies({ atlas: 'texInAtlas', cell: 'fern' })).toEqual([]);
  });

  test('a form samples one white texel, warned, not an unknown footprint', () => {
    const uniforms = createWithInputs('texInUnresolved', {
      layer: { textureArray: 'texInNoArray', layer: 'rock' },
      cell: { atlas: 'texInAtlas', slot: 'normal', cell: 'fern' },
      // Registered by code before any load registered the resolvers: missed too
      saved: { textureArray: 'texInArray', layer: 'rock' },
    });
    expectWhiteTexel(uniforms.setup_layer);
    expectWhiteTexel(uniforms.setup_cell);
    expectWhiteTexel(uniforms.setup_saved);
    expect(fns.lwarn).toHaveBeenCalledTimes(3);
    expect(fns.lwarn).toHaveBeenCalledWith(expect.stringContaining('"texInNoArray"'));
    expect(fns.lwarn).toHaveBeenCalledWith(expect.stringContaining('"texInAtlas.normal"'));
    expect(fns.lwarn).toHaveBeenCalledWith(expect.stringContaining('input "saved"'));
  });
});

describe('the texture array layer resolver (p299 D5)', () => {
  beforeAll(async () => {
    await loadTextureInputResolversAsync();
  });

  test('samples a layer by name and by index at the mesh UV', () => {
    const uniforms = createWithInputs('texInLayer', {
      byName: { textureArray: 'texInArray', layer: 'moss' },
      byIndex: { textureArray: 'texInArray', layer: 0 },
    });
    const byName = uniforms.setup_byName!;
    expect(byName.isTextureNode).toBe(true);
    expect(byName.value).toBe(array);
    expect((byName.depthNode as unknown as { value: number }).value).toBe(1);
    expect((uniforms.setup_byIndex!.depthNode as unknown as { value: number }).value).toBe(0);
    // The layer stays through a resample (the node's clone keeps it)
    expect(byName.sample(float(0) as never).depthNode).toBe(byName.depthNode);
  });

  test('throws naming the input for an unknown layer, a bad layer or a plain texture', () => {
    expect(() =>
      createWithInputs('texInLayerBadName', { a: { textureArray: 'texInArray', layer: 'sand' } })
    ).toThrow(/input "a" \(setup\) in material "texInLayerBadName".*no member "sand"/);
    expect(() =>
      createWithInputs('texInLayerBadIndex', { a: { textureArray: 'texInArray', layer: 2 } })
    ).toThrow('layers 0-1, not 2');
    expect(() =>
      createWithInputs('texInLayerNoLayer', { a: { textureArray: 'texInArray' } })
    ).toThrow('has no "layer"');
    expect(() =>
      createWithInputs('texInLayerPlain', { a: { textureArray: 'texInPlain', layer: 0 } })
    ).toThrow(`names "texInPlain", which isn't an array texture`);
  });

  test('samples one white texel for an array that is not registered (warned)', () => {
    const uniforms = createWithInputs('texInLayerMissing', {
      a: { textureArray: 'texInNoArray', layer: 'rock' },
    });
    expectWhiteTexel(uniforms.setup_a);
    expect(fns.lwarn).toHaveBeenCalledWith(expect.stringContaining('texInNoArray'));
  });
});

describe('the atlas cell resolver (p299 D5)', () => {
  test("samples the slot at the mesh UV mapped into the cell's rect", () => {
    const uniforms = createWithInputs('texInCell', {
      clamped: { atlas: 'texInAtlas', slot: 'albedo', cell: 'fern' },
      unclamped: { atlas: 'texInAtlas', slot: 'albedo', cell: 'fern', clampToCell: false },
    });
    const clamped = uniforms.setup_clamped!;
    expect(clamped.isTextureNode).toBe(true);
    expect(clamped.value).toBe(slot);
    // Not the default UV: the cell's mapping (a clamp of it, or the mix alone)
    expect(clamped.uvNode).not.toBeNull();
    expect(uniforms.setup_unclamped!.uvNode).not.toBe(clamped.uvNode);
  });

  test('throws naming the input for an unknown cell, a missing key or a plain texture', () => {
    expect(() =>
      createWithInputs('texInCellBad', { a: { atlas: 'texInAtlas', slot: 'albedo', cell: 'x' } })
    ).toThrow(/input "a" \(setup\) in material "texInCellBad".*no cell "x" \(cells: fern\)/);
    expect(() =>
      createWithInputs('texInCellNoSlot', { a: { atlas: 'texInAtlas', cell: 'fern' } })
    ).toThrow('needs a "slot" and a "cell"');
    expect(() =>
      createWithInputs('texInCellClamp', {
        a: { atlas: 'texInAtlas', slot: 'albedo', cell: 'fern', clampToCell: 'yes' },
      })
    ).toThrow('"clampToCell" not boolean');
    saveTexture(new THREE.Texture(), 'texInAtlas.plain');
    expect(() =>
      createWithInputs('texInCellPlain', {
        a: { atlas: 'texInAtlas', slot: 'plain', cell: 'fern' },
      })
    ).toThrow(`names "texInAtlas.plain", which isn't an atlas slot`);
  });

  test('samples one white texel for a slot that is not registered (warned)', () => {
    const uniforms = createWithInputs('texInCellMissing', {
      a: { atlas: 'texInAtlas', slot: 'normal', cell: 'fern' },
    });
    expectWhiteTexel(uniforms.setup_a);
    expect(fns.lwarn).toHaveBeenCalledWith(expect.stringContaining('texInAtlas.normal'));
  });
});
