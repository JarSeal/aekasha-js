import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { AppData } from '../scene/AppData';
import {
  ensureMaterialDependencies,
  findTextureDeclaration,
  getMaterialTextureIds,
} from './MaterialDependencies';
import type { MatProps } from './Material';

// The texture registry, the loads, the app's data and the logs are stand-ins
const fns = vi.hoisted(() => ({
  registered: new Map<string, { id: string }>(),
  loadTextureAsync: vi.fn(),
  loadTslMaterialFileAsync: vi.fn(),
  retagAssetOwner: vi.fn(),
  lwarn: vi.fn(),
  lerror: vi.fn(),
  appData: { json: { scenes: {} }, sceneFiles: {}, tslMaterialFiles: {}, postFxFiles: {} },
}));
vi.mock(import('./Texture'), () => ({
  getTexture: (id: string) => fns.registered.get(id) as never,
  loadTextureAsync: fns.loadTextureAsync,
}));
vi.mock(import('./MaterialTsl'), () => ({
  loadTslMaterialFileAsync: fns.loadTslMaterialFileAsync,
}));
vi.mock(import('./AssetOwners'), () => ({ retagAssetOwner: fns.retagAssetOwner }));
vi.mock(import('../scene/AppData'), () => ({ getAppData: () => fns.appData as AppData }));
vi.mock(import('../../utils/Logger'), async (importOriginal) => ({
  ...(await importOriginal()),
  lwarn: fns.lwarn,
  lerror: fns.lerror,
}));

const setAppData = (data: Partial<AppData>) => {
  fns.appData = { ...fns.appData, ...data };
};

beforeEach(() => {
  vi.clearAllMocks();
  fns.registered.clear();
  fns.loadTextureAsync.mockResolvedValue({});
  fns.loadTslMaterialFileAsync.mockResolvedValue(true);
  fns.appData = { json: { scenes: {} }, sceneFiles: {}, tslMaterialFiles: {}, postFxFiles: {} };
});

describe('getMaterialTextureIds', () => {
  test('the params slots, the inputs and the nodes, each once, staticDefines aside', () => {
    const ids = getMaterialTextureIds({
      params: { map: 'albedo', normalMap: 'normal', color: '#ffffff', name: 'notASlot' },
      inputs: {
        mask: { texture: 'mask', channel: 'r' },
        tint: '#ff8000',
        again: 'albedo',
        staticDefines: { texture: 'define' },
      },
      nodes: { colorNode: { detail: 'detail', scale: 2, staticDefines: { USE: 'define' } } },
    });
    expect(ids).toEqual(['albedo', 'normal', 'mask', 'detail']);
  });

  test('an array layer’s array and an atlas cell’s slot (p299 D5), before their resolvers', () => {
    expect(
      getMaterialTextureIds({
        inputs: { layer: { textureArray: 'ground', layer: 'rock' } },
        nodes: { colorNode: { cell: { atlas: 'decals', slot: 'albedo', cell: 'crack' } } },
      })
    ).toEqual(['ground', 'decals.albedo']);
  });

  test('a material without textures names none', () => {
    expect(getMaterialTextureIds({ params: { color: '#ffffff' } })).toEqual([]);
  });
});

describe('findTextureDeclaration', () => {
  test('the development texture section first, then a scene’s list, then a cell’s assets', () => {
    setAppData({
      json: {
        textures: { dev: { id: 'dev', fileName: 'dev.png' } },
        scenes: {
          a: { textures: ['dev', { id: 'listed', fileName: 'a.png' }] },
          b: {
            textures: [{ id: 'listed', fileName: 'b.png' }],
            __streaming: { assets: { textures: [{ id: 'cell', fileName: 'cell.png' }] } },
          },
        },
      },
    });
    expect(findTextureDeclaration('dev')).toEqual({ id: 'dev', fileName: 'dev.png' });
    expect(findTextureDeclaration('listed')).toEqual({ id: 'listed', fileName: 'a.png' });
    expect(findTextureDeclaration('cell')).toEqual({ id: 'cell', fileName: 'cell.png' });
    expect(findTextureDeclaration('none')).toBeUndefined();
  });
});

describe('ensureMaterialDependencies', () => {
  const props = {
    id: 'panel',
    type: 'STANDARD',
    params: { map: 'loaded', normalMap: 'declared' },
  } as MatProps;

  test('loads a declared texture, re-tags a registered one, and resolves true', async () => {
    fns.registered.set('loaded', { id: 'loaded' });
    setAppData({
      json: { scenes: { a: { textures: [{ id: 'declared', fileName: 'd.png' }] } } },
    });
    await expect(ensureMaterialDependencies(props)).resolves.toBe(true);
    expect(fns.retagAssetOwner).toHaveBeenCalledWith({ id: 'loaded' });
    expect(fns.loadTextureAsync).toHaveBeenCalledTimes(1);
    expect(fns.loadTextureAsync).toHaveBeenCalledWith({
      id: 'declared',
      fileName: 'd.png',
      throwOnError: true,
    });
  });

  test('warns about a texture no data declares, and resolves false', async () => {
    fns.registered.set('loaded', { id: 'loaded' });
    await expect(ensureMaterialDependencies(props)).resolves.toBe(false);
    expect(fns.lwarn).toHaveBeenCalledWith(expect.stringContaining('"declared"'));
  });

  test('logs a failed load, and resolves false', async () => {
    fns.registered.set('loaded', { id: 'loaded' });
    setAppData({ json: { scenes: { a: { textures: [{ id: 'declared', fileName: 'x' }] } } } });
    fns.loadTextureAsync.mockRejectedValue(new Error('404'));
    await expect(ensureMaterialDependencies(props)).resolves.toBe(false);
    expect(fns.lerror).toHaveBeenCalledTimes(1);
  });

  test('loads the TSL file the data has, by tslMaterialId', async () => {
    setAppData({ tslMaterialFiles: { 'shared.graph': () => Promise.resolve({}) } });
    const tsl = {
      id: 'tslPanel',
      type: 'STANDARDNODEMATERIAL',
      tslFile: 'materials/shared.tsl.ts',
      tslMaterialId: 'shared.graph',
    } as MatProps;
    await expect(ensureMaterialDependencies(tsl)).resolves.toBe(true);
    expect(fns.loadTslMaterialFileAsync).toHaveBeenCalledWith('shared.graph');
  });

  test('leaves a tslFile the data doesn’t have (a registration’s) to createMaterial', async () => {
    const tsl = { id: 'code', type: 'STANDARDNODEMATERIAL', tslFile: '<runtime>' } as MatProps;
    await expect(ensureMaterialDependencies(tsl)).resolves.toBe(true);
    expect(fns.loadTslMaterialFileAsync).not.toHaveBeenCalled();
  });

  test('takes a variant’s overrides', async () => {
    setAppData({ json: { scenes: { a: { textures: [{ id: 'rust', fileName: 'r.png' }] } } } });
    await expect(ensureMaterialDependencies({ inputs: { albedo: 'rust' } })).resolves.toBe(true);
    expect(fns.loadTextureAsync).toHaveBeenCalledWith(expect.objectContaining({ id: 'rust' }));
  });
});
