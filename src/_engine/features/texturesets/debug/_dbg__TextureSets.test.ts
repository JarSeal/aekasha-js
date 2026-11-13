import { beforeEach, describe, expect, test, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import type { MaterialAsset } from '../../../schemas/MaterialSchema';
import type { TextureSetArrayInputRef } from '../TextureSetRefs';
import {
  runMaterialEditorPreparerExits,
  runMaterialEditorPreparersAsync,
} from '../../../debug/editors/material/_dbg__MaterialEditorPreparers';
import {
  _registerTextureSetsDebug,
  getArrayBuild,
  getTextureSetArrayInputs,
} from './_dbg__TextureSets';

// The set array runtime, the scenes' data, the owner retag and the log are stand-ins: a build
// registers an entry with one array per call (or rejects for a set in `failing`)
const env = vi.hoisted(() => ({
  live: new Map<string, { id: string; arrays: Record<string, unknown> }>(),
  builds: [] as unknown[],
  failing: new Set<string>(),
  scenes: {} as Record<string, unknown>,
  retagged: [] as unknown[],
  error: vi.fn(),
}));
vi.mock(import('../TextureSetArrays'), () => ({
  getTextureSetArrayId: ((packing: string, sets: string[]) =>
    `tsa:${packing}:${sets.join(',')}`) as never,
  getTextureSetArray: ((id: string) => env.live.get(id)) as never,
  buildTextureSetArray: (async (props: { id?: string; sets: string[]; packing: string }) => {
    env.builds.push(props);
    await Promise.resolve();
    const failing = props.sets.find((set) => env.failing.has(set));
    if (failing) throw new Error(`the texture set "${failing}" has no packing "${props.packing}".`);
    const id = props.id ?? `tsa:${props.packing}:${props.sets.join(',')}`;
    const entry = { id, arrays: { albedoRough: new THREE.Texture() } };
    env.live.set(id, entry);
    return entry;
  }) as never,
}));
vi.mock(import('../../../kernel/scene/Scene'), () => ({
  getGeneratedAppData: (() => ({ scenes: env.scenes })) as never,
}));
vi.mock(import('../../../kernel/assets/AssetOwners'), () => ({
  retagAssetOwner: ((asset: unknown) => env.retagged.push(asset)) as never,
}));
vi.mock(import('../../../utils/Logger'), () => ({ lerror: env.error }));

const LIST: TextureSetArrayInputRef = { textureSetArray: ['sand01', 'grass01'], packing: 'LITE' };
const material = (inputs: Record<string, unknown>, nodes?: Record<string, unknown>) =>
  ({ id: 'groundMat', type: 'STANDARDNODEMATERIAL', inputs, nodes }) as unknown as MaterialAsset;

beforeEach(() => {
  env.live.clear();
  env.builds.length = 0;
  env.failing.clear();
  env.retagged.length = 0;
  env.error.mockClear();
  env.scenes = {
    gallery: {
      id: 'gallery',
      textureSetArrays: [{ id: 'ground', sets: ['rocks01'], packing: 'LITE', swappable: true }],
    },
  };
  runMaterialEditorPreparerExits();
  _registerTextureSetsDebug();
});

describe('the texture sets material editor preparer (p303)', () => {
  test('finds the set array inputs in inputs and in each socket', () => {
    const asset = material({ ground: LIST, tint: '#ffffff' }, { colorNode: { other: LIST } });
    expect(getTextureSetArrayInputs(asset)).toEqual([LIST, LIST]);
    expect(getTextureSetArrayInputs(material({ surface: { textureSet: 'sand01' } }))).toEqual([]);
  });

  test("a list builds its own sets; an id the scene's entry, unknown ones nothing", () => {
    expect(getArrayBuild(LIST)).toEqual({ sets: ['sand01', 'grass01'], packing: 'LITE' });
    expect(getArrayBuild({ textureSetArray: 'ground' })).toEqual({
      id: 'ground',
      sets: ['rocks01'],
      packing: 'LITE',
      swappable: true,
    });
    expect(getArrayBuild({ textureSetArray: 'nowhere' })).toBeUndefined();
  });

  test('builds the arrays a material needs before the copy, and skips built ones', async () => {
    env.live.set('ground', { id: 'ground', arrays: {} });
    await runMaterialEditorPreparersAsync(
      material({ a: LIST, b: { textureSetArray: 'ground' }, c: { textureSetArray: 'nowhere' } })
    );
    expect(env.builds).toEqual([{ sets: ['sand01', 'grass01'], packing: 'LITE' }]);
    // A second pick of the same material builds nothing
    await runMaterialEditorPreparersAsync(material({ a: LIST }));
    expect(env.builds).toHaveLength(1);
  });

  test('the exit hands only the arrays it built to the current scene', async () => {
    env.live.set('ground', { id: 'ground', arrays: { albedoRough: new THREE.Texture() } });
    await runMaterialEditorPreparersAsync(material({ a: LIST, b: { textureSetArray: 'ground' } }));
    runMaterialEditorPreparerExits();
    expect(env.retagged).toEqual([env.live.get('tsa:LITE:sand01,grass01')!.arrays.albedoRough]);
    // Its list was cleared
    env.retagged.length = 0;
    runMaterialEditorPreparerExits();
    expect(env.retagged).toEqual([]);
  });

  test('a failed build is logged and the load goes on', async () => {
    env.failing.add('grass01');
    await runMaterialEditorPreparersAsync(material({ a: LIST }));
    expect(env.error).toHaveBeenCalledOnce();
    expect(String(env.error.mock.calls[0][0])).toContain('"textureSetArrays"');
    expect(String(env.error.mock.calls[0][0])).toContain('"groundMat"');
  });
});
