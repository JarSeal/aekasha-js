import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { color, float, uniform } from 'three/tsl';
import { initEnvironment } from '../config/Config';
import { createFeatureHost } from '../init/Features';
import { createMaterial, getMaterialVariant } from './Material';
import {
  getMaterialInputDependencies,
  installMaterialInputResolvers,
  type MaterialInputResolver,
  registerMaterialInputResolver,
} from './MaterialInputResolvers';
import { registerTslMaterial, type TslInputs } from './MaterialTsl';
import { saveTexture } from './Texture';

// The warning log is a stand-in
const fns = vi.hoisted(() => ({ lwarn: vi.fn() }));
vi.mock(import('../../utils/Logger'), async (importOriginal) => ({
  ...(await importOriginal()),
  lwarn: fns.lwarn,
}));

type UniformNode = { isNode: true; isUniformNode?: boolean; value: unknown };
type GradientInput = { gradient: [string, string] };

// A bundle of two colour uniforms (p302 Phase 4's dummy resolver)
const gradientResolver: MaterialInputResolver<GradientInput> = {
  kind: 'resolverTest.gradient',
  match: (value) => typeof value === 'object' && value !== null && 'gradient' in value,
  resolve: ({ gradient }) => ({
    from: uniform(color(gradient[0])),
    to: uniform(color(gradient[1])),
  }),
  dependencies: () => [{ type: 'texture', id: 'resolverTestGradientRamp' }],
};

/** The inputs each graph function got, by the material's id */
const received = new Map<string, TslInputs>();

/** A registered graph that keeps its inputs and sets the colour from `setup` */
const registerRecordingGraph = (id: string) => {
  registerTslMaterial(id, {
    setup: (inputs, material) => {
      received.set(`${id}:setup`, inputs);
      material.colorNode = float(1);
    },
    colorNode: (inputs) => {
      received.set(`${id}:colorNode`, inputs);
      return float(1);
    },
  });
};

const uniformsOf = (mat: THREE.Material) =>
  mat.userData.uniforms as Record<string, UniformNode | undefined>;

beforeAll(() => {
  // The debug env: its warnings (a kind registered again with other functions)
  initEnvironment({ search: '?isDebug=true', env: { VITE_APP_ENV: 'development' } });
  // The kernel's object-form texture ref, as installKernel registers it
  installMaterialInputResolvers(createFeatureHost({}).ctx);
  registerMaterialInputResolver(gradientResolver);
  registerRecordingGraph('resolverTest.graph');
});

afterEach(() => {
  fns.lwarn.mockClear();
});

describe('registerMaterialInputResolver (p302 D4)', () => {
  test('asks the resolvers in registration order, before the built-in rules', () => {
    const first = float(1);
    const second = float(2);
    registerMaterialInputResolver({
      kind: 'resolverTest.first',
      match: (value) => typeof value === 'string' && value.startsWith('res:'),
      resolve: () => first,
    });
    registerMaterialInputResolver({
      kind: 'resolverTest.second',
      match: (value) => typeof value === 'string' && value.startsWith('res:'),
      resolve: () => second,
    });

    const mat = createMaterial({
      id: 'resolverTestOrder',
      type: 'BASICNODEMATERIAL',
      tslMaterialId: 'resolverTest.graph',
      // A bare texture id by the built-in rules: no texture node, no missing texture warning
      inputs: { value: 'res:anything' },
    });
    expect(uniformsOf(mat).setup_value).toBe(first);
    expect(received.get('resolverTest.graph:setup')?.value).toBe(first);
    expect(fns.lwarn).not.toHaveBeenCalled();
  });

  test("keeps a bundle's nodes at <group>_<key>_<field> and passes the bundle as is", () => {
    const mat = createMaterial({
      id: 'resolverTestBundle',
      type: 'BASICNODEMATERIAL',
      tslMaterialId: 'resolverTest.graph',
      inputs: { band: { gradient: ['#ff0000', '#0000ff'] } },
      nodes: { colorNode: { band: { gradient: ['#00ff00', '#ffffff'] } } },
    });
    const uniforms = uniformsOf(mat);
    expect(Object.keys(uniforms).sort()).toEqual([
      'colorNode_band_from',
      'colorNode_band_to',
      'setup_band_from',
      'setup_band_to',
    ]);
    expect((uniforms.setup_band_from?.value as THREE.Color).getHexString()).toBe('ff0000');
    expect((uniforms.colorNode_band_to?.value as THREE.Color).getHexString()).toBe('ffffff');
    expect(received.get('resolverTest.graph:setup')?.band).toEqual({
      from: uniforms.setup_band_from,
      to: uniforms.setup_band_to,
    });
  });

  test('makes a variant overriding a resolved input', () => {
    createMaterial({
      id: 'resolverTestVariantBase',
      type: 'BASICNODEMATERIAL',
      tslMaterialId: 'resolverTest.graph',
      inputs: { band: { gradient: ['#ff0000', '#0000ff'] } },
    });
    const variant = getMaterialVariant('resolverTestVariantBase', {
      inputs: { band: { gradient: ['#ff0000', '#00ff00'] } },
    });
    expect((uniformsOf(variant).setup_band_to?.value as THREE.Color).getHexString()).toBe('00ff00');
  });

  test("throws naming the kind for a result that's neither a node nor an object of nodes", () => {
    registerMaterialInputResolver({
      kind: 'resolverTest.broken',
      match: (value) => value === 'broken',
      resolve: () => ({ notANode: 1 }) as never,
    });
    expect(() =>
      createMaterial({
        id: 'resolverTestBroken',
        type: 'BASICNODEMATERIAL',
        tslMaterialId: 'resolverTest.graph',
        inputs: { value: 'broken' },
      })
    ).toThrow('"resolverTest.broken"');
  });

  test('keeps the first functions of a kind registered again with other ones (warned)', () => {
    registerMaterialInputResolver(gradientResolver);
    registerMaterialInputResolver({ ...gradientResolver });
    expect(fns.lwarn).not.toHaveBeenCalled();

    const other = float(3);
    registerMaterialInputResolver({ ...gradientResolver, resolve: () => other });
    expect(fns.lwarn).toHaveBeenCalledWith(expect.stringContaining('"resolverTest.gradient"'));
    const mat = createMaterial({
      id: 'resolverTestDuplicate',
      type: 'BASICNODEMATERIAL',
      tslMaterialId: 'resolverTest.graph',
      inputs: { band: { gradient: ['#ff0000', '#0000ff'] } },
    });
    expect(uniformsOf(mat).setup_band_from).toBeDefined();
  });
});

describe("the kernel's object-form texture ref", () => {
  const rust = saveTexture(new THREE.Texture(), 'resolverTestRust');

  test('makes { texture } the texture node a bare id makes', () => {
    const mat = createMaterial({
      id: 'resolverTestTextureRef',
      type: 'BASICNODEMATERIAL',
      tslMaterialId: 'resolverTest.graph',
      inputs: { albedo: { texture: 'resolverTestRust' }, bare: 'resolverTestRust' },
    });
    const node = uniformsOf(mat).setup_albedo as unknown as THREE.TextureNode;
    expect(node.isTextureNode).toBe(true);
    expect(node.value).toBe(rust);
    expect((uniformsOf(mat).setup_bare as unknown as THREE.TextureNode).value).toBe(rust);
  });

  test("makes { texture, channel } the sample's channels", () => {
    const mat = createMaterial({
      id: 'resolverTestChannel',
      type: 'BASICNODEMATERIAL',
      tslMaterialId: 'resolverTest.graph',
      inputs: { mask: { texture: 'resolverTestRust', channel: 'r' } },
    });
    const node = uniformsOf(mat).setup_mask as unknown as THREE.SplitNode;
    expect(node.isNode).toBe(true);
    // TSL keeps a swizzle as xyzw: r is x
    expect(node.components).toBe('x');
    expect((node.node as THREE.TextureNode).value).toBe(rust);
  });

  test('samples one white texel for an unregistered id (warned)', () => {
    const mat = createMaterial({
      id: 'resolverTestTextureRefMissing',
      type: 'BASICNODEMATERIAL',
      tslMaterialId: 'resolverTest.graph',
      inputs: { albedo: { texture: 'resolverTestNoTexture', channel: 'rgb' } },
    });
    const node = uniformsOf(mat).setup_albedo as unknown as THREE.SplitNode;
    const texture = (node.node as THREE.TextureNode).value as THREE.DataTexture;
    expect([...(texture.image.data as Uint8Array)]).toEqual([255, 255, 255, 255]);
    expect(fns.lwarn).toHaveBeenCalledWith(expect.stringContaining('resolverTestNoTexture'));
  });

  test('throws for a channel that is not one to four of r, g, b and a', () => {
    expect(() =>
      createMaterial({
        id: 'resolverTestBadChannel',
        type: 'BASICNODEMATERIAL',
        tslMaterialId: 'resolverTest.graph',
        inputs: { mask: { texture: 'resolverTestRust', channel: 'x' } },
      })
    ).toThrow('the channel "x"');
  });
});

describe('getMaterialInputDependencies', () => {
  test("names a texture ref's and a bare id's texture, not a colour's", () => {
    expect(getMaterialInputDependencies({ texture: 'a', channel: 'r' })).toEqual([
      { type: 'texture', id: 'a' },
    ]);
    expect(getMaterialInputDependencies('b')).toEqual([{ type: 'texture', id: 'b' }]);
    expect(getMaterialInputDependencies('#ffffff')).toEqual([]);
    expect(getMaterialInputDependencies(4)).toEqual([]);
  });

  test("names what the matching resolver's dependencies do, none without them", () => {
    expect(getMaterialInputDependencies({ gradient: ['#000000', '#ffffff'] })).toEqual([
      { type: 'texture', id: 'resolverTestGradientRamp' },
    ]);
    expect(getMaterialInputDependencies('res:x')).toEqual([]);
  });
});
