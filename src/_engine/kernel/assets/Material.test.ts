import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { createRootScene, getRootScene } from '../scene/Scene';
import { addSceneHooks } from '../scene/SceneHooks';
import { setAppData } from '../scene/AppData';
import { float } from 'three/tsl';
import { initEnvironment } from '../config/Config';
import { createMaterial, decMaterialRef, getMaterialVariant, incMaterialRef } from './Material';
import { loadTslMaterialFileAsync, registerTslMaterial, type TslMaterialFns } from './MaterialTsl';
import { getTexture, saveTexture } from './Texture';

// The warning log is a stand-in
const fns = vi.hoisted(() => ({ lwarn: vi.fn() }));
vi.mock(import('../../utils/Logger'), async (importOriginal) => ({
  ...(await importOriginal()),
  lwarn: fns.lwarn,
}));

beforeAll(() => {
  createRootScene();
});

describe('createMaterial', () => {
  test('gives a TSL texture input with an unregistered id one white texel', async () => {
    setAppData({
      json: { scenes: {} },
      sceneFiles: {},
      tslMaterialFiles: {
        materialTestTsl: async () => ({
          colorNode: (inputs: Record<string, unknown>) => inputs.tex,
        }),
      },
      postFxFiles: {},
    });
    expect(await loadTslMaterialFileAsync('materialTestTsl')).toBe(true);

    const mat = createMaterial({
      id: 'materialTestTsl',
      type: 'BASICNODEMATERIAL',
      tslFile: 'materialTestTsl.tsl.ts',
      nodes: { colorNode: { tex: 'materialTestNoTexture' } },
    });

    const node = mat.userData.uniforms.colorNode_tex as { isTextureNode: boolean; value: unknown };
    expect(node.isTextureNode).toBe(true);
    const texture = node.value as THREE.DataTexture;
    expect(texture).toBeInstanceOf(THREE.DataTexture);
    expect([texture.image.width, texture.image.height]).toEqual([1, 1]);
    expect([...(texture.image.data as Uint8Array)]).toEqual([255, 255, 255, 255]);
    expect(fns.lwarn).toHaveBeenCalledWith(expect.stringContaining('materialTestNoTexture'));
  });

  test("makes a JSON's [x, y] or { x, y } normal scale a Vector2", () => {
    const fromArray = createMaterial({
      id: 'materialTestNormalScaleArray',
      type: 'STANDARD',
      params: { normalScale: [0.8, -0.5] as unknown as THREE.Vector2 },
    }) as THREE.MeshStandardMaterial;
    expect(fromArray.normalScale).toBeInstanceOf(THREE.Vector2);
    expect(fromArray.normalScale.toArray()).toEqual([0.8, -0.5]);

    const fromObject = createMaterial({
      id: 'materialTestNormalScaleObject',
      type: 'PHYSICAL',
      params: { clearcoatNormalScale: { x: 0.3, y: 0.4 } as THREE.Vector2 },
    }) as THREE.MeshPhysicalMaterial;
    expect(fromObject.clearcoatNormalScale).toBeInstanceOf(THREE.Vector2);
    expect(fromObject.clearcoatNormalScale.toArray()).toEqual([0.3, 0.4]);

    const given = new THREE.Vector2(2, 3);
    const fromVector = createMaterial({
      id: 'materialTestNormalScaleVector',
      type: 'STANDARD',
      params: { normalScale: given },
    }) as THREE.MeshStandardMaterial;
    expect(fromVector.normalScale.toArray()).toEqual([2, 3]);
  });
});

describe('the TSL setup entry and registerTslMaterial (p302 D2, D3)', () => {
  beforeAll(() => {
    // The debug env: its warnings (a socket replaced, a registration with other functions)
    initEnvironment({ search: '?isDebug=true', env: { VITE_APP_ENV: 'development' } });
  });

  afterEach(() => {
    fns.lwarn.mockClear();
  });

  // Three sockets from one graph: colour and emissive share the tint node
  type SetupInputs = { tint: THREE.Node<'color'>; roughness: THREE.Node<'float'> };
  const setupFns: TslMaterialFns = {
    setup: (inputs: SetupInputs, material, staticDefines) => {
      const tint = staticDefines.isDark ? inputs.tint.mul(0.5) : inputs.tint;
      material.colorNode = tint;
      material.emissiveNode = tint;
      material.roughnessNode = inputs.roughness;
    },
  };

  test('runs setup with the material inputs, kept as setup_<key> uniforms', () => {
    registerTslMaterial('materialTest.setup', setupFns);
    const mat = createMaterial({
      id: 'materialTestSetup',
      type: 'STANDARDNODEMATERIAL',
      tslMaterialId: 'materialTest.setup',
      inputs: { tint: '#ff8000', roughness: 0.25 },
    }) as THREE.MeshStandardNodeMaterial;

    const uniforms = mat.userData.uniforms as Record<string, { value: unknown }>;
    expect(mat.colorNode).toBe(uniforms.setup_tint);
    expect(mat.emissiveNode).toBe(mat.colorNode);
    expect(mat.roughnessNode).toBe(uniforms.setup_roughness);
    expect(uniforms.setup_roughness.value).toBe(0.25);
    expect(mat.userData.hasTslFile).toBe(true);
  });

  test('gives setup the static defines, and runs the nodes sockets after it', () => {
    registerTslMaterial('materialTest.setup', setupFns);
    const roughness = float(0.9);
    registerTslMaterial('materialTest.setupAndSocket', {
      ...setupFns,
      roughnessNode: () => roughness,
    });
    const mat = createMaterial({
      id: 'materialTestSetupAndSocket',
      type: 'STANDARDNODEMATERIAL',
      tslMaterialId: 'materialTest.setupAndSocket',
      staticDefines: { isDark: true },
      inputs: { tint: '#ff8000', roughness: 0.25 },
      nodes: { roughnessNode: {} },
    }) as THREE.MeshStandardNodeMaterial;

    expect(mat.colorNode).not.toBe(mat.userData.uniforms.setup_tint);
    expect(mat.roughnessNode).toBe(roughness);
    expect(fns.lwarn).toHaveBeenCalledWith(
      expect.stringContaining('roughnessNode function replaces the roughnessNode setup set')
    );
  });

  test('looks up a registration before a loaded TSL file of the id', async () => {
    const fromFile = float(1);
    const registered = float(2);
    setAppData({
      json: { scenes: {} },
      sceneFiles: {},
      tslMaterialFiles: { materialTestBoth: async () => ({ colorNode: () => fromFile }) },
      postFxFiles: {},
    });
    await loadTslMaterialFileAsync('materialTestBoth');
    registerTslMaterial('materialTestBoth', { colorNode: () => registered });

    const mat = createMaterial({
      id: 'materialTestBoth',
      type: 'BASICNODEMATERIAL',
      tslFile: 'materialTestBoth.tsl.ts',
      nodes: { colorNode: {} },
    }) as THREE.MeshBasicNodeMaterial;
    expect(mat.colorNode).toBe(registered);
  });

  test('keeps the first functions of an id registered again with other ones (warned)', () => {
    const first = float(1);
    const firstFns = { colorNode: () => first };
    registerTslMaterial('materialTest.duplicate', firstFns);
    registerTslMaterial('materialTest.duplicate', firstFns);
    expect(fns.lwarn).not.toHaveBeenCalled();

    registerTslMaterial('materialTest.duplicate', { colorNode: () => float(2) });
    expect(fns.lwarn).toHaveBeenCalledWith(expect.stringContaining('"materialTest.duplicate"'));
    const mat = createMaterial({
      id: 'materialTestDuplicate',
      type: 'BASICNODEMATERIAL',
      tslMaterialId: 'materialTest.duplicate',
      nodes: { colorNode: {} },
    }) as THREE.MeshBasicNodeMaterial;
    expect(mat.colorNode).toBe(first);
  });

  test("never calls a function for a nodes key named setup (NodeMaterial's own method)", () => {
    const setup = vi.fn<NonNullable<TslMaterialFns['setup']>>();
    registerTslMaterial('materialTest.setupAsSocket', { setup });
    const mat = createMaterial({
      id: 'materialTestSetupAsSocket',
      type: 'BASICNODEMATERIAL',
      tslMaterialId: 'materialTest.setupAsSocket',
      nodes: { setup: { value: 1 } },
    });
    expect(setup).toHaveBeenCalledTimes(1);
    expect(mat.setup).toBe(THREE.MeshBasicNodeMaterial.prototype.setup);
    expect(fns.lwarn).toHaveBeenCalledWith(expect.stringContaining("setup isn't a socket"));
  });

  test('throws for a tslFile that no file and no registration has', () => {
    expect(() =>
      createMaterial({
        id: 'materialTestNoFunctions',
        type: 'BASICNODEMATERIAL',
        tslFile: 'materialTestNoFunctions.tsl.ts',
        nodes: { colorNode: {} },
      })
    ).toThrow('no TSL file');
  });

  test('makes a variant overriding an input: the base keeps its own', () => {
    registerTslMaterial('materialTest.setup', setupFns);
    const base = createMaterial({
      id: 'materialTestInputsBase',
      type: 'STANDARDNODEMATERIAL',
      tslMaterialId: 'materialTest.setup',
      inputs: { tint: '#ff8000', roughness: 0.25 },
    });
    const variant = getMaterialVariant('materialTestInputsBase', { inputs: { roughness: 0.75 } });

    const value = (mat: THREE.Material, key: string) =>
      (mat.userData.uniforms as Record<string, { value: unknown }>)[key].value;
    expect(value(variant, 'setup_roughness')).toBe(0.75);
    expect(value(base, 'setup_roughness')).toBe(0.25);
    // The other inputs are the base's
    expect((value(variant, 'setup_tint') as THREE.Color).getHexString()).toBe('ff8000');
    expect(getMaterialVariant('materialTestInputsBase', { inputs: { roughness: 0.75 } })).toBe(
      variant
    );
  });

  test("gives a registered material's variant the base's functions", () => {
    registerTslMaterial('materialTest.setup', setupFns);
    createMaterial({
      id: 'materialTestVariantBase',
      type: 'STANDARDNODEMATERIAL',
      tslMaterialId: 'materialTest.setup',
      inputs: { tint: '#ff8000', roughness: 0.25 },
    });
    const variant = getMaterialVariant('materialTestVariantBase', {
      params: { metalness: 1 },
    }) as THREE.MeshStandardNodeMaterial;
    expect(variant.metalness).toBe(1);
    expect(variant.colorNode).toBe(variant.userData.uniforms.setup_tint);
  });

  test('gives a plain material no TSL functions, though its id names some', () => {
    registerTslMaterial('materialTestPlainBase', { colorNode: () => float(1) });
    const mat = createMaterial({
      id: 'materialTestPlainBase',
      type: 'BASIC',
      params: { color: '#00ff00' },
    });
    const variant = getMaterialVariant('materialTestPlainBase', { params: { opacity: 0.5 } });
    expect(mat.userData.hasTslFile).toBeUndefined();
    expect(variant.userData.hasTslFile).toBeUndefined();
  });
});

describe('decMaterialRef', () => {
  // A registered texture in the map of a registered material holding one ref
  const createTexturedMaterial = (name: string) => {
    const texture = saveTexture(new THREE.Texture(), `${name}Texture`);
    createMaterial({ id: `${name}Material`, type: 'BASIC', params: { map: `${name}Texture` } });
    incMaterialRef(`${name}Material`);
    return texture;
  };

  afterEach(() => {
    getRootScene()!.background = null;
  });

  test('releases a registered texture with the last material holding it', () => {
    createTexturedMaterial('materialTestReleased');
    decMaterialRef('materialTestReleasedMaterial');
    expect(getTexture('materialTestReleasedTexture')).toBeUndefined();
  });

  test("keeps the root scene's background texture", () => {
    const texture = createTexturedMaterial('materialTestBackground');
    getRootScene()!.background = texture;
    decMaterialRef('materialTestBackgroundMaterial');
    expect(getTexture('materialTestBackgroundTexture')).toBe(texture);
  });

  test('keeps a texture a retainedTextures scene hook names', () => {
    const texture = createTexturedMaterial('materialTestRetained');
    const removeHooks = addSceneHooks({ retainedTextures: () => [texture] });
    decMaterialRef('materialTestRetainedMaterial');
    removeHooks();
    expect(getTexture('materialTestRetainedTexture')).toBe(texture);
  });
});
