import { describe, expect, test, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { deleteTexture } from './Texture';
import { buildTextureArray, setTextureArrayLayer } from './TextureArray';

// The file loads are stand-ins: a URL in `failing` rejects, one in `gates` waits for its gate,
// any other gives a 2 × 2 one-level compressed texture filled with the URL's length (so a layer's
// data tells which member wrote it). A load's URL is in `started` once it runs, every texture
// they made is in `loaded`, and in `disposed` once it's disposed.
const m = vi.hoisted(() => ({
  failing: new Set<string>(),
  gates: new Map<string, Promise<void>>(),
  loaded: [] as THREE.CompressedTexture[],
  disposed: new Set<THREE.Texture>(),
  started: new Set<string>(),
}));
vi.mock(import('./Texture'), async (importOriginal) => ({
  ...(await importOriginal()),
  resolveTextureUrl: (({ fileName }: { fileName: string }) => fileName) as never,
  loadTextureFileAsync: (async (url: string) => {
    m.started.add(url);
    await m.gates.get(url);
    if (m.failing.has(url)) throw new Error(`404 ${url}`);
    const mip = { data: new Uint8Array(16).fill(url.length), width: 2, height: 2 };
    const texture = new THREE.CompressedTexture(
      [mip] as unknown as ImageData[],
      2,
      2,
      THREE.RGBA_ASTC_4x4_Format
    );
    m.loaded.push(texture);
    texture.addEventListener('dispose', () => m.disposed.add(texture));
    return { texture, report: { target: 'MAIN_THREAD', loadedOn: 'MAIN_THREAD', durationMs: 0 } };
  }) as never,
}));

describe('buildTextureArray', () => {
  test('releases the members that loaded when another one fails', async () => {
    m.failing.add('arrayTestFailing.ktx2');
    m.loaded.length = 0;

    await expect(
      buildTextureArray({
        id: 'arrayTestFailed',
        members: [
          { id: 'arrayTestA', fileName: 'arrayTestA.ktx2' },
          { id: 'arrayTestFailing', fileName: 'arrayTestFailing.ktx2' },
          { id: 'arrayTestB', fileName: 'arrayTestB.ktx2' },
        ],
      })
    ).rejects.toThrow('404 arrayTestFailing.ktx2');
    expect(m.loaded).toHaveLength(2);
    expect(m.loaded.every((texture) => m.disposed.has(texture))).toBe(true);
  });
});

describe('setTextureArrayLayer', () => {
  /** A swappable one-layer array, and its layer's data */
  const buildSwappable = async (id: string) => {
    const array = await buildTextureArray({
      id,
      members: [{ id: `${id}L0`, fileName: 'l0.ktx2' }],
      swappable: true,
    });
    const data = () => [...(array.mipmaps as unknown as { data: Uint8Array }[])[0].data];
    return { array, data, before: data() };
  };

  test('skips a swap whose array was deleted before it started', async () => {
    const { array, data, before } = await buildSwappable('arrayTestDeletedFirst');
    m.loaded.length = 0;
    const swap = setTextureArrayLayer('arrayTestDeletedFirst', 0, { fileName: 'x.ktx2' });
    deleteTexture('arrayTestDeletedFirst');

    await expect(swap).resolves.toBeUndefined();
    expect(m.loaded).toHaveLength(0);
    expect(data()).toEqual(before);
    expect(array.userData.textureArray.members).toEqual(['arrayTestDeletedFirstL0']);
  });

  test("doesn't write into an array deleted while its member loaded", async () => {
    const { array, data, before } = await buildSwappable('arrayTestDeletedMidway');
    let openGate = () => {};
    m.gates.set('arrayTestLonger.ktx2', new Promise<void>((resolve) => (openGate = resolve)));
    m.loaded.length = 0;
    const swap = setTextureArrayLayer('arrayTestDeletedMidway', 0, {
      id: 'arrayTestLonger',
      fileName: 'arrayTestLonger.ktx2',
    });
    await vi.waitFor(() => expect(m.started.has('arrayTestLonger.ktx2')).toBe(true));
    deleteTexture('arrayTestDeletedMidway');
    openGate();

    await expect(swap).resolves.toBeUndefined();
    expect(data()).toEqual(before);
    expect(array.userData.textureArray.members).toEqual(['arrayTestDeletedMidwayL0']);
    expect(m.loaded).toHaveLength(1);
    expect(m.disposed.has(m.loaded[0])).toBe(true);
  });

  test('still swaps a registered array', async () => {
    const { array, data } = await buildSwappable('arrayTestSwapped');
    await setTextureArrayLayer('arrayTestSwapped', 0, { id: 'arrayTestNew', fileName: 'new.ktx2' });
    expect(data()).toEqual(new Array(16).fill('new.ktx2'.length));
    expect(array.userData.textureArray.members).toEqual(['arrayTestNew']);
  });
});
