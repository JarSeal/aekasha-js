import { describe, expect, test, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { getTextureRegistry, loadTexture, loadTextures } from './Texture';

// The document's base URL (the loaders resolve file names against it), a TextureLoader whose
// loads end in a microtask and fail for the URLs in `failing`, and the error log are stand-ins
const m = vi.hoisted(() => {
  vi.stubGlobal('document', { baseURI: 'https://app.test/' });
  return { failing: new Set<string>(), lerror: vi.fn() };
});
vi.mock(import('three/webgpu'), async (importOriginal) => {
  const three = await importOriginal();
  class TextureLoader {
    load(
      url: string,
      onLoad?: (texture: THREE.Texture) => void,
      _onProgress?: unknown,
      onError?: (err: unknown) => void
    ) {
      const texture = new three.Texture();
      queueMicrotask(() =>
        m.failing.has(url) ? onError?.(new Error(`404 ${url}`)) : onLoad?.(texture)
      );
      return texture;
    }
  }
  return { ...three, TextureLoader: TextureLoader as unknown as typeof three.TextureLoader };
});
vi.mock(import('../../utils/Logger'), async (importOriginal) => ({
  ...(await importOriginal()),
  lerror: m.lerror,
}));

/** The registry's ids whose texture is `texture` */
const getRegisteredIds = (texture: THREE.Texture) =>
  Object.keys(getTextureRegistry()).filter((id) => getTextureRegistry()[id].resource === texture);

describe('loadTexture', () => {
  test('registers a texture without an id once, under its file name', () => {
    const texture = loadTexture({ fileName: 'textureTestNoId.png' });
    expect(getRegisteredIds(texture)).toEqual(['textureTestNoId.png']);
    expect(texture.userData.id).toBe('textureTestNoId.png');
    expect(loadTexture({ fileName: 'textureTestNoId.png' })).toBe(texture);
  });

  test("logs a failed load instead of throwing it from three's callback", async () => {
    m.failing.add('https://app.test/textureTestFailing.png');
    const texture = loadTexture({
      id: 'textureTestFailing',
      fileName: 'textureTestFailing.png',
      throwOnError: true,
    });
    // An uncaught throw in the loader's callback would fail the test run
    await vi.waitFor(() =>
      expect(m.lerror).toHaveBeenCalledWith(
        expect.stringContaining('textureTestFailing'),
        expect.any(Error)
      )
    );
    expect(getRegisteredIds(texture)).toEqual(['textureTestFailing']);
  });
});

describe('loadTextures', () => {
  test("registers a failed load's EMPTY_TEXTURE stand-in, and counts the failure", async () => {
    m.failing.add('https://app.test/textureTestBatchFailing.png');
    const updates: number[] = [];
    let batch: Record<string, THREE.Texture> = {};
    loadTextures(
      [
        { id: 'textureTestBatchLoaded', fileName: 'textureTestBatchLoaded.png' },
        { id: 'textureTestBatchFailing', fileName: 'textureTestBatchFailing.png' },
      ],
      (textures, loadedCount) => {
        batch = textures;
        updates.push(loadedCount);
      },
      'EMPTY_TEXTURE'
    );
    await vi.waitFor(() => expect(updates.at(-1)).toBe(2));

    const standIn = batch.textureTestBatchFailing;
    expect(standIn).toBeInstanceOf(THREE.Texture);
    expect(getRegisteredIds(standIn)).toEqual(['textureTestBatchFailing']);
    expect(getRegisteredIds(batch.textureTestBatchLoaded)).toEqual(['textureTestBatchLoaded']);
  });

  test('counts a failed load with THROW_ERROR instead of throwing it', async () => {
    m.failing.add('https://app.test/textureTestThrowFailing.png');
    const updates: number[] = [];
    loadTextures(
      [{ id: 'textureTestThrowFailing', fileName: 'textureTestThrowFailing.png' }],
      (_textures, loadedCount) => updates.push(loadedCount),
      'THROW_ERROR'
    );
    await vi.waitFor(() => expect(updates).toEqual([0, 1]));
    expect(getTextureRegistry().textureTestThrowFailing).toBeUndefined();
  });
});
