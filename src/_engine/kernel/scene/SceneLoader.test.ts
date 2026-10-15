import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TCMP } from '../../ui/CMP';
import type { AppData } from './AppData';
import type { SceneData } from './Scene';

// The scene registry, the scene hooks, the inputs' master switch and the asset owners are the
// real modules; what a load creates (cameras, assets, meshes) and the page around it (the HUD,
// the canvas, the debugger, the windows) are mocks: the test checks the load's order and state,
// not what the scene shows
const m = vi.hoisted(() => {
  const canvasStyle: Record<string, string> = {};
  return {
    canvasStyle,
    canvasParent: {
      style: { setProperty: (key: string, value: string) => (canvasStyle[key] = value) },
    },
    hudRoot: { add: vi.fn() },
    world: {
      id: '[default]',
      clearNonPersistent: vi.fn(),
      getEntitiesWith: vi.fn(() => [].values()),
    },
    textureCount: 0,
    registryLoads: 0,
  };
});

const fns = vi.hoisted(() => ({
  setIsLoadingScene: vi.fn(),
  createMaterial: vi.fn((props: { id?: string; params?: Record<string, unknown> }) => ({
    id: props.id,
    params: props.params,
  })),
  loadTextureAsync: vi.fn(async (props: { id: string }) => ({ id: props.id, n: ++m.textureCount })),
  disableDebugger: vi.fn(),
  releaseSceneOwnedAssets: vi.fn(),
  retagImportedAsset: vi.fn(),
  getEntityIdByAppId: vi.fn<(appId: string) => number | undefined>(),
  setActiveCamera: vi.fn(),
}));

vi.mock(import('../loop/MainLoop'), () => ({
  initMainLoop: vi.fn(),
  setIsLoadingScene: fns.setIsLoadingScene,
}));
vi.mock(import('../ecs/ECS'), () => ({
  DEFAULT_ECS_WORLD_ID: '[default]' as const,
  deleteECSWorld: vi.fn(),
  getAllECSWorlds: () => [],
  getECSWorld: (() => m.world) as never,
  getEntityIdByAppId: fns.getEntityIdByAppId,
}));
vi.mock(import('../camera/Camera'), () => ({
  createCameraEntity: vi.fn(),
  setActiveCamera: fns.setActiveCamera,
}));
vi.mock(import('../light/Light'), () => ({ createLightEntity: vi.fn() }));
vi.mock(import('../mesh/Mesh'), () => ({ createMeshEntity: vi.fn() }));
vi.mock(import('../assets/Texture'), () => ({
  getTexture: vi.fn(),
  loadTextureAsync: fns.loadTextureAsync as never,
}));
vi.mock(import('../assets/Material'), () => ({
  createMaterial: fns.createMaterial as never,
  getMaterial: vi.fn(),
  loadTslMaterialFileAsync: vi.fn(),
}));
vi.mock(import('../assets/Geometry'), () => ({
  createGeometry: vi.fn(),
  doesGeoExist: vi.fn(),
  getGeometry: vi.fn(),
}));
vi.mock(import('../assets/import/ImportRegistry'), () => {
  // Runs when the module is first imported: the loader's import()
  m.registryLoads++;
  return {
    getImportedAsset: vi.fn(() => ({
      id: 'byId',
      fileName: 'a.glb',
      geometries: [],
      textureIds: [],
    })),
    importAssetAsync: vi.fn(),
    retagImportedAsset: fns.retagImportedAsset,
  };
});
vi.mock(import('../assets/SceneAssetRelease'), () => ({
  releaseSceneOwnedAssets: fns.releaseSceneOwnedAssets,
}));
vi.mock(import('../render/Renderer'), () => ({
  getCanvasParentElem: (() => m.canvasParent) as never,
}));
vi.mock(import('../render/Raycast'), () => ({
  deleteAllRayHelpers: vi.fn(),
  resetRayCastStats: vi.fn(),
}));
vi.mock(import('./Group'), () => ({ deleteAllGroupEntities: vi.fn() }));
vi.mock(import('../../ui/HUD'), () => ({ getHUDRootCMP: (() => m.hudRoot) as never }));
vi.mock(import('../../debug/DebuggerGUI'), () => ({
  addDebugToastWhenReady: vi.fn(),
  DEBUGGER_SCENE_LOADER_ID: '__debugger-scene-loader' as const,
  disableDebugger: fns.disableDebugger,
  updateDebuggerSceneTitle: vi.fn(),
}));
vi.mock(import('../../debug/DebugTools'), () => ({ getDebugToolsState: vi.fn() }));
vi.mock(import('../../debug/OnScreenTools'), () => ({ updateOnScreenTools: vi.fn() }));
vi.mock(import('../../utils/Logger'), () => ({ lerror: vi.fn(), lwarn: vi.fn(), llog: vi.fn() }));

import { setAppData } from './AppData';
import { addSceneHooks } from './SceneHooks';
import { createRootScene, createScene, getCurrentSceneId, getLoadingSceneId } from './Scene';
import { areAllInputsEnabled, setAllInputsEnabled } from '../input/InputState';
import {
  createSceneLoader,
  getNextSceneId,
  isCurrentlyLoading,
  loadScene,
  type LoadSceneProps,
} from './SceneLoader';

type SceneFn = NonNullable<LoadSceneProps['nextSceneFn']>;

/** A promise to resolve by hand */
const createGate = () => {
  let open = () => {};
  const promise = new Promise<void>((resolve) => (open = resolve));
  return { promise, open };
};

const camera = { camProps: { id: 'cam', type: 'PERSPECTIVE' }, entityOpts: {} };

/** Scene data with a camera, and the given extras */
const sceneDataOf = (id: string, extra: Partial<SceneData> = {}) =>
  ({ id, sceneFile: `${id}.ts`, cameras: [camera], ...extra }) as SceneData;

/** A scene's code: creates its scene, then runs `body` */
const sceneFnOf =
  (id: string, body?: () => Promise<void> | void): SceneFn =>
  async () => {
    createScene(id);
    await body?.();
  };

const scenes: Record<string, SceneData> = {};
const sceneFiles: Record<string, SceneFn> = {};

/** Sets a scene's data and code */
const setScene = (id: string, body?: () => Promise<void> | void, extra?: Partial<SceneData>) => {
  scenes[id] = sceneDataOf(id, extra);
  sceneFiles[id] = sceneFnOf(id, body);
};

const loaderContainer = { remove: vi.fn() } as unknown as TCMP & { remove: typeof vi.fn };

beforeAll(async () => {
  createRootScene();
  setAppData({
    json: { scenes },
    sceneFiles,
    tslMaterialFiles: {},
    postFxFiles: {},
  } as unknown as AppData);
  await createSceneLoader({ id: 'testLoader', loaderContainerFn: () => loaderContainer });
});

beforeEach(() => {
  vi.clearAllMocks();
  setAllInputsEnabled(true);
  m.canvasStyle['pointer-events'] = '';
});

describe('loadScene: the queue', () => {
  it('a call during a load waits for it; a third call replaces the waiting one', async () => {
    const gate = createGate();
    const order: string[] = [];
    setScene('queueA', async () => {
      order.push('A:start');
      await gate.promise;
      order.push('A:end');
    });
    setScene('queueB', () => void order.push('B'));
    setScene('queueC', () => void order.push('C'));

    const loadA = loadScene({ sceneId: 'queueA' });
    expect(isCurrentlyLoading()).toBe(true);
    const loadB = loadScene({ sceneId: 'queueB' });
    const loadC = loadScene({ sceneId: 'queueC' });

    // B is dropped as soon as C replaces it, without loading
    await expect(loadB).resolves.toBe(false);
    await vi.waitFor(() => expect(order).toEqual(['A:start']));
    expect(getNextSceneId()).toBe('queueA');

    gate.open();
    await expect(loadA).resolves.toBe(true);
    await expect(loadC).resolves.toBe(true);
    expect(order).toEqual(['A:start', 'A:end', 'C']);
    expect(getCurrentSceneId()).toBe('queueC');
    expect(isCurrentlyLoading()).toBe(false);
  });
});

describe('loadScene: a failed load', () => {
  it('scene code that throws: resolves false and undoes what the load started', async () => {
    setScene('failOk');
    await loadScene({ sceneId: 'failOk' });
    vi.clearAllMocks();
    const phases: string[] = [];
    const removeHooks = addSceneHooks({
      loadStart: () => phases.push('loadStart'),
      entered: () => void phases.push('entered'),
      loadSettled: () => phases.push('loadSettled'),
    });
    setScene('failing', () => {
      throw new Error('scene code failed');
    });

    await expect(loadScene({ sceneId: 'failing' })).resolves.toBe(false);
    expect(areAllInputsEnabled()).toBe(true);
    expect(m.canvasStyle['pointer-events']).toBe('');
    expect(isCurrentlyLoading()).toBe(false);
    expect(getNextSceneId()).toBeNull();
    expect(getLoadingSceneId()).toBeNull();
    expect(fns.setIsLoadingScene).toHaveBeenLastCalledWith(false);
    expect(loaderContainer.remove).toHaveBeenCalledTimes(1);
    // The draggable windows close the ones the load suspended in loadSettled
    expect(phases).toEqual(['loadStart', 'loadSettled']);
    removeHooks();
    // The previous scene stays current (torn down: the next load starts from it)
    expect(getCurrentSceneId()).toBe('failOk');

    // The next load runs as usual
    await expect(loadScene({ sceneId: 'failOk' })).resolves.toBe(true);
    expect(getCurrentSceneId()).toBe('failOk');
  });

  it('an unknown scene: resolves false before anything changes, and the queue goes on', async () => {
    setAllInputsEnabled(true);
    await expect(loadScene({ sceneId: 'noSuchScene' })).resolves.toBe(false);
    expect(isCurrentlyLoading()).toBe(false);
    expect(getNextSceneId()).toBeNull();
    expect(fns.disableDebugger).not.toHaveBeenCalled();
    expect(m.hudRoot.add).not.toHaveBeenCalled();

    setScene('afterUnknown');
    await expect(loadScene({ sceneId: 'afterUnknown' })).resolves.toBe(true);
  });

  it('an unknown loader: resolves false', async () => {
    setScene('unknownLoader');
    await expect(loadScene({ sceneId: 'unknownLoader', loaderId: 'nope' })).resolves.toBe(false);
    expect(isCurrentlyLoading()).toBe(false);
  });
});

describe("loadScene: a material's texture ids (p302's bug B)", () => {
  it('resolves into a copy: a revisit reads the ids and gets the textures it loaded', async () => {
    const material = { id: 'texturedMat', type: 'BASIC', params: { map: 'texA', color: '#fff' } };
    setScene('textured', undefined, {
      textures: [{ id: 'texA', fileName: 'a.png' }] as SceneData['textures'],
      materials: [material] as SceneData['materials'],
    });
    setScene('elsewhere');

    await loadScene({ sceneId: 'textured' });
    await loadScene({ sceneId: 'elsewhere' });
    await loadScene({ sceneId: 'textured' });

    // The cached scene data still holds the id
    expect(material.params.map).toBe('texA');
    const [first, second] = fns.createMaterial.mock.calls.map(([props]) => props.params?.map);
    expect(first).toEqual({ id: 'texA', n: expect.any(Number) as number });
    expect(second).toEqual({ id: 'texA', n: expect.any(Number) as number });
    // Each visit's material gets that visit's texture, never the previous one's
    expect(second).not.toBe(first);
  });
});

describe('loadScene: the import registry (D4)', () => {
  it('loads only for a scene that names an imported asset (by id too)', async () => {
    setScene('noImports');
    await loadScene({ sceneId: 'noImports' });
    expect(m.registryLoads).toBe(0);

    const seen: { assets?: Parameters<SceneFn>[0]['assets'] } = {};
    scenes.importsById = sceneDataOf('importsById', { importedAssets: ['byId'] });
    sceneFiles.importsById = async (args) => {
      createScene('importsById');
      seen.assets = args.assets;
    };
    await expect(loadScene({ sceneId: 'importsById' })).resolves.toBe(true);
    expect(m.registryLoads).toBe(1);
    expect(fns.retagImportedAsset).toHaveBeenCalledWith('byId');
    expect(seen.assets?.importedAssets.byId).toMatchObject({ id: 'byId' });
  });
});

describe("loadScene: the scene data's cameras", () => {
  it('a persistent camera named first becomes active, entity id 0 too', async () => {
    fns.getEntityIdByAppId.mockReturnValue(0);
    setScene('persistentCamera', undefined, {
      cameras: ['persistentCam', camera] as SceneData['cameras'],
    });
    await expect(loadScene({ sceneId: 'persistentCamera' })).resolves.toBe(true);
    expect(fns.getEntityIdByAppId).toHaveBeenCalledWith('persistentCam');
    expect(fns.setActiveCamera).toHaveBeenCalledWith(0);
  });

  it('a scene without a camera it creates fails to load', async () => {
    setScene('noCamera', undefined, { cameras: [] });
    await expect(loadScene({ sceneId: 'noCamera' })).resolves.toBe(false);
    expect(isCurrentlyLoading()).toBe(false);
  });
});
