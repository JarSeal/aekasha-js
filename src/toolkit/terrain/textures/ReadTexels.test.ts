import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { readTextureTexelsAsync } from './ReadTexels';

// The engine's bake and renderer stood in: the bake's target reads back as rows 0, 1 (a byte
// each texel, its row number)
const engine = vi.hoisted(() => ({
  isWebGPU: true,
  bakes: [] as { id: string; dispose: () => void }[],
  textures: new Map<string, unknown>(),
}));
vi.mock('aekasha', () => ({
  bakeTexture: vi.fn(async ({ id }: { id: string }) => {
    const bake = { id, textures: { data: { renderTarget: {} } }, dispose: vi.fn() };
    engine.bakes.push(bake);
    return bake;
  }),
  getRenderer: () => ({
    readRenderTargetPixelsAsync: async (
      _t: unknown,
      _x: number,
      _y: number,
      w: number,
      h: number
    ) => Uint8Array.from({ length: w * h * 4 }, (_, i) => Math.floor(i / (w * 4))),
  }),
  getTexture: (id: string) => engine.textures.get(id),
  isWebGPURenderer: () => engine.isWebGPU,
}));

const createTexture = (width: number, height: number) => {
  const tex = new THREE.Texture();
  tex.image = { width, height };
  return tex;
};

beforeEach(() => {
  engine.bakes.length = 0;
  engine.textures.clear();
  engine.isWebGPU = true;
});

describe('readTextureTexelsAsync', () => {
  it('reads a texture at its own size once, and disposes the bake', async () => {
    const tex = createTexture(2, 2);
    engine.textures.set('noise', tex);
    const texels = await readTextureTexelsAsync('noise');
    expect([texels.width, texels.height]).toEqual([2, 2]);
    expect(Array.from(texels.data)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1]);
    expect(await readTextureTexelsAsync(tex)).toBe(texels);
    expect(engine.bakes).toHaveLength(1);
    expect(engine.bakes[0].dispose).toHaveBeenCalled();
    // Another size is another read
    await readTextureTexelsAsync(tex, { size: [1, 1] });
    expect(engine.bakes).toHaveLength(2);
  });

  it('flips WebGL2’s bottom-first rows, so row 0 is v = 0', async () => {
    engine.isWebGPU = false;
    const texels = await readTextureTexelsAsync(createTexture(1, 2));
    expect(Array.from(texels.data)).toEqual([1, 1, 1, 1, 0, 0, 0, 0]);
  });

  it('refuses a texture not loaded, or one without a size', async () => {
    await expect(readTextureTexelsAsync('macroNoise')).rejects.toThrow(
      /no texture "macroNoise" is loaded \(list it in the scene's textures\)/
    );
    await expect(readTextureTexelsAsync(new THREE.Texture())).rejects.toThrow(/give opts\.size/);
  });
});
