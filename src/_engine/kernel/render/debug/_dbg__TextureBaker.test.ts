import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { convertHalfFloatsToBytes, exportBakedTextureAsync } from './_dbg__TextureBaker';

const stubs = vi.hoisted(() => ({
  textures: new Map<string, unknown>(),
  status: { available: true, message: '' } as { available: boolean; message: string },
  files: new Map<string, { sha256: string; bytes: Uint8Array }>(),
  writes: [] as { path: string; expectedHash?: string | null }[],
  encoded: [] as { data: ArrayLike<number>; flipY?: boolean }[],
  rgba8Reads: [] as number[],
  halfFloatData: null as Uint16Array | null,
  isWebGL: false,
  downloads: [] as string[],
  warnings: [] as string[],
  /** The file changes between the export's read and its write */
  changesMeanwhile: false,
}));

vi.mock('../../assets/Texture', () => ({
  getTexture: (id: string) => stubs.textures.get(id),
}));
vi.mock('../Snapshot', () => ({
  readRenderTargetRGBA8Async: async (target: THREE.RenderTarget, index: number) => {
    stubs.rgba8Reads.push(index);
    return new Uint8ClampedArray(target.width * target.height * 4).fill(10 + index);
  },
}));
vi.mock('../Renderer', () => ({
  getRenderer: () => ({
    backend: { isWebGLBackend: stubs.isWebGL },
    readRenderTargetPixelsAsync: async () => stubs.halfFloatData,
  }),
}));
vi.mock('../../../utils/Logger', () => ({
  lwarn: (message: string) => stubs.warnings.push(message),
}));
vi.mock('../../../debug/DevFiles', () => {
  class DevFilesError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  }
  return {
    DevFilesError,
    getDevFilesStatus: async () => stubs.status,
    readDevFile: async (path: string) => stubs.files.get(path) ?? null,
    encodePNG: async (source: { data: ArrayLike<number> }, opts?: { flipY?: boolean }) => {
      stubs.encoded.push({ data: source.data, flipY: opts?.flipY });
      return new Blob([new Uint8Array(Array.from(source.data).slice(0, 8))]);
    },
    writeDevFiles: async (writes: { path: string; expectedHash?: string | null }[]) => {
      stubs.writes.push(...writes);
      const { path, expectedHash } = writes[0];
      const existing = stubs.files.get(path);
      if (stubs.changesMeanwhile || (existing?.sha256 ?? null) !== expectedHash) {
        throw new DevFilesError('CONFLICT', 'changed');
      }
      return { results: [{ path, status: existing ? 'updated' : 'created' }] };
    },
  };
});

/** A bake's target with a texture per output, registered as `<id>.<name>` */
const registerBake = (
  id: string,
  outputs: { name: string; type?: THREE.TextureDataType }[],
  depth = 1
) => {
  const target = new THREE.RenderTarget(2, 2, { count: outputs.length, depth });
  outputs.forEach(({ name, type }, i) => {
    target.textures[i].type = type ?? THREE.UnsignedByteType;
    target.textures[i].renderTarget = target;
    stubs.textures.set(`${id}.${name}`, target.textures[i]);
  });
};

const half = THREE.DataUtils.toHalfFloat;

beforeEach(() => {
  stubs.textures.clear();
  stubs.files.clear();
  stubs.status = { available: true, message: '' };
  stubs.writes.length = 0;
  stubs.encoded.length = 0;
  stubs.rgba8Reads.length = 0;
  stubs.downloads.length = 0;
  stubs.warnings.length = 0;
  stubs.halfFloatData = null;
  stubs.isWebGL = false;
  stubs.changesMeanwhile = false;
  registerBake('sand', [{ name: 'albedoRough' }, { name: 'normalHeight' }]);
});

describe('convertHalfFloatsToBytes', () => {
  it('scales 0..1 to bytes and counts what it clamps', () => {
    const { bytes, clamped } = convertHalfFloatsToBytes(
      Uint16Array.from([0, 0.5, 1, 4, -1, 0.25, 1, 1].map(half))
    );
    expect(Array.from(bytes)).toEqual([0, 128, 255, 255, 0, 64, 255, 255]);
    expect(clamped).toBe(2);
  });
});

describe('exportBakedTextureAsync', () => {
  it("writes an output's flipped PNG as <id>_<output>.png, which must not exist yet", async () => {
    const result = await exportBakedTextureAsync({
      id: 'sand',
      output: 'normalHeight',
      dir: './src/app/textures/sand03/source/',
    });
    expect(result).toEqual({
      path: 'src/app/textures/sand03/source/sand_normalHeight.png',
      status: 'CREATED',
      clampedValues: 0,
    });
    // The second MRT attachment, rows flipped
    expect(stubs.rgba8Reads).toEqual([1]);
    expect(stubs.encoded[0].flipY).toBe(true);
    expect(stubs.writes).toEqual([
      expect.objectContaining({ path: result.path, expectedHash: null }),
    ]);
  });

  it('leaves another file there unless told to overwrite, then expects it as read', async () => {
    const path = 'src/app/t/source/sand.png';
    stubs.files.set(path, { sha256: 'abc', bytes: new Uint8Array([1, 2, 3]) });
    const opts = {
      id: 'sand',
      output: 'albedoRough',
      dir: 'src/app/t/source',
      fileName: 'sand.png',
    };
    expect((await exportBakedTextureAsync(opts)).status).toBe('EXISTS');
    expect(stubs.writes).toHaveLength(0);
    expect((await exportBakedTextureAsync({ ...opts, overwrite: true })).status).toBe('UPDATED');
    expect(stubs.writes[0].expectedHash).toBe('abc');
  });

  it('is unchanged when the file has the same bytes, without a write', async () => {
    const path = 'src/app/t/source/sand_albedoRough.png';
    stubs.files.set(path, { sha256: 'abc', bytes: new Uint8Array(8).fill(10) });
    const result = await exportBakedTextureAsync({
      id: 'sand',
      output: 'albedoRough',
      dir: 'src/app/t/source',
    });
    expect(result.status).toBe('UNCHANGED');
    expect(stubs.writes).toHaveLength(0);
  });

  it('downloads the PNG where the dev files are unavailable', async () => {
    stubs.status = { available: false, message: 'The dev server is off' };
    const click = vi.fn();
    vi.stubGlobal('document', {
      createElement: () => ({ click, remove: () => undefined }),
      body: { append: () => undefined },
    });
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:x', revokeObjectURL: () => undefined });
    try {
      const result = await exportBakedTextureAsync({
        id: 'sand',
        output: 'albedoRough',
        dir: 'src/app/t/source',
      });
      expect(result).toMatchObject({ status: 'DOWNLOADED', reason: 'The dev server is off' });
      expect(click).toHaveBeenCalledOnce();
      expect(stubs.warnings[0]).toMatch(/Put it at src\/app\/t\/source\/sand_albedoRough.png/);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('clamps a HALF_FLOAT output with a warning, top row first on both backends', async () => {
    registerBake('hdr', [{ name: 'light', type: THREE.HalfFloatType }]);
    // 2 × 2: the first row 0.25, the second 4 (clamped)
    const rows = [...Array(8).fill(half(0.25)), ...Array(8).fill(half(4))];
    stubs.halfFloatData = Uint16Array.from(rows);
    const opts = { id: 'hdr', output: 'light', dir: 'src/app/t/source' };
    const result = await exportBakedTextureAsync(opts);
    expect(result.clampedValues).toBe(8);
    expect(stubs.warnings[0]).toMatch(/"hdr.light" is HALF_FLOAT.*8 values outside 0..1/);
    expect(Array.from(stubs.encoded[0].data).slice(0, 4)).toEqual([64, 64, 64, 64]);
    // WebGL reads bottom-up: the same data is then the image upside down
    stubs.isWebGL = true;
    await exportBakedTextureAsync({ ...opts, fileName: 'gl.png' });
    expect(Array.from(stubs.encoded[1].data).slice(0, 4)).toEqual([255, 255, 255, 255]);
  });

  it("rejects what isn't a baked texture, an array bake, a bad file name and a conflict", async () => {
    const dir = 'src/app/t/source';
    await expect(exportBakedTextureAsync({ id: 'sand', output: 'orm', dir })).rejects.toThrow(
      /"sand.orm" isn't a baked texture/
    );
    stubs.textures.set('plain.map', new THREE.Texture());
    await expect(exportBakedTextureAsync({ id: 'plain', output: 'map', dir })).rejects.toThrow(
      /"plain.map" isn't a baked texture/
    );
    registerBake('layers', [{ name: 'data' }], 4);
    await expect(exportBakedTextureAsync({ id: 'layers', output: 'data', dir })).rejects.toThrow(
      /is an array bake \(4 layers\)/
    );
    await expect(
      exportBakedTextureAsync({ id: 'sand', output: 'albedoRough', dir, fileName: '../x.png' })
    ).rejects.toThrow(/the file name "..\/x.png"/);
    stubs.changesMeanwhile = true;
    const racing = exportBakedTextureAsync({ id: 'sand', output: 'albedoRough', dir });
    await expect(racing).rejects.toThrow(/changed on disk while exporting/);
  });
});
