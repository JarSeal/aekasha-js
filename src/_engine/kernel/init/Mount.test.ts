import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MountAekashaOptions } from './Mount';

// Every module the mount drives is a mock, and the DOM a few fake elements: the test checks the
// mount's wiring (its defaults, the holds on the loop, the teardown), not the engine's boot
const m = vi.hoisted(() => {
  type FakeElem = {
    className: string;
    style: Record<string, string>;
    children: FakeElem[];
    parent: FakeElem | null;
    clientHeight: number;
    appendChild: (child: FakeElem) => FakeElem;
    remove: () => void;
  };
  const createElem = (): FakeElem => {
    const elem: FakeElem = {
      className: '',
      style: {},
      children: [],
      parent: null,
      clientHeight: 300,
      appendChild: (child) => {
        child.parent = elem;
        elem.children.push(child);
        return child;
      },
      remove: () => {
        if (!elem.parent) return;
        elem.parent.children.splice(elem.parent.children.indexOf(elem), 1);
        elem.parent = null;
      },
    };
    return elem;
  };
  const state = {
    host: createElem(),
    hasGpu: true,
    hasWebGL2: true,
    reducedMotion: false,
    observerCallback: null as ((entries: { isIntersecting: boolean }[]) => void) | null,
  };
  class FakeIntersectionObserver {
    constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
      state.observerCallback = callback;
    }
    observe = vi.fn();
    disconnect = vi.fn();
  }
  vi.stubGlobal('document', {
    createElement: () => createElem(),
    querySelector: (selector: string) => (selector === '#hero' ? state.host : null),
  });
  vi.stubGlobal('window', { matchMedia: () => ({ matches: state.reducedMotion }) });
  vi.stubGlobal('navigator', new Proxy({}, { has: (_, key) => key === 'gpu' && state.hasGpu }));
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
  return {
    state,
    createElem,
    afterRenderHooks: [] as (() => void)[],
    sizeSource: { read: vi.fn(), observe: vi.fn() },
  };
});

const fns = vi.hoisted(() => ({
  bootEngineAsync: vi.fn(),
  isEngineBooted: vi.fn(() => false),
  createRenderer: vi.fn(),
  deleteRenderer: vi.fn(),
  getRenderer: vi.fn(() => ({})),
  loadScene: vi.fn(async () => true),
  createSceneLoader: vi.fn(),
  toggleMainPlay: vi.fn(),
  stopMainLoop: vi.fn(),
  setInputScope: vi.fn(),
  removeAllInputListeners: vi.fn(),
  setCanvasSizeSource: vi.fn(),
  createElementSizeSource: vi.fn(),
  setAssetBaseUrl: vi.fn(),
  stopAssetsWorker: vi.fn(),
}));

vi.mock(import('three/addons/capabilities/WebGL.js'), () => ({
  default: { isWebGL2Available: () => m.state.hasWebGL2 } as never,
}));
vi.mock(import('./Boot'), () => ({
  bootEngineAsync: fns.bootEngineAsync,
  isEngineBooted: fns.isEngineBooted,
}));
vi.mock(import('../render/Renderer'), () => ({
  createRenderer: fns.createRenderer,
  deleteRenderer: fns.deleteRenderer,
  getRenderer: fns.getRenderer as never,
}));
vi.mock(import('../render/RenderHooks'), () => ({
  addAfterRender: ((hook: () => void) => {
    m.afterRenderHooks.push(hook);
    return () => {
      m.afterRenderHooks.splice(m.afterRenderHooks.indexOf(hook), 1);
    };
  }) as never,
}));
vi.mock(import('../scene/SceneLoader'), () => ({
  loadScene: fns.loadScene,
  createSceneLoader: fns.createSceneLoader,
}));
vi.mock(import('../loop/MainLoop'), () => ({
  toggleMainPlay: fns.toggleMainPlay,
  stopMainLoop: fns.stopMainLoop,
}));
vi.mock(import('../input/InputState'), () => ({
  setInputScope: fns.setInputScope,
  removeAllInputListeners: fns.removeAllInputListeners,
}));
vi.mock(import('../render/CanvasSize'), () => ({
  setCanvasSizeSource: fns.setCanvasSizeSource,
  createElementSizeSource: fns.createElementSizeSource,
}));
vi.mock(import('../assets/AssetUrl'), () => ({ setAssetBaseUrl: fns.setAssetBaseUrl }));
vi.mock(import('../assets/AssetsAPI'), () => ({ stopAssetsWorker: fns.stopAssetsWorker }));
vi.mock(import('../../utils/Logger'), () => ({ lerror: vi.fn(), lwarn: vi.fn() }));

const data = {
  json: { scenes: { firstScene: {}, secondScene: {} } },
  sceneFiles: {},
  tslMaterialFiles: {},
  postFxFiles: {},
} as MountAekashaOptions['data'];

/** A fresh Mount module: its once-per-page flag starts clean */
const importMount = async () => {
  vi.resetModules();
  return import('./Mount');
};

const mount = async (opts: Partial<MountAekashaOptions> = {}) => {
  const { mountAekasha } = await importMount();
  return mountAekasha({ target: '#hero', data, features: [], ...opts });
};

const runFrames = (count: number) => {
  for (let i = 0; i < count; i++) for (const hook of [...m.afterRenderHooks]) hook();
};

beforeEach(() => {
  vi.clearAllMocks();
  m.state.host = m.createElem();
  m.state.hasGpu = true;
  m.state.hasWebGL2 = true;
  m.state.reducedMotion = false;
  m.state.observerCallback = null;
  m.afterRenderHooks.length = 0;
  fns.isEngineBooted.mockReturnValue(false);
  fns.createElementSizeSource.mockReturnValue(m.sizeSource);
  fns.bootEngineAsync.mockImplementation(async (opts: { start: () => Promise<void> }) => {
    await opts.start();
  });
});

describe('mountAekasha: the defaults', () => {
  it('an inline container at 100% × 100% in the target, no input, the first scene', async () => {
    const handle = await mount();
    const container = m.state.host.children[0];
    expect(handle.isFallback).toBe(false);
    expect(handle.container).toBe(container);
    expect(container.className).toBe('aekMount aekMount_INLINE');
    expect(container.style).toMatchObject({
      width: '100%',
      height: '100%',
      position: 'relative',
      overflow: 'hidden',
      contain: 'layout',
    });
    expect(fns.createElementSizeSource).toHaveBeenCalledWith(container);
    expect(fns.setCanvasSizeSource).toHaveBeenCalledWith(m.sizeSource);
    expect(fns.setInputScope).toHaveBeenCalledWith('NONE');
    expect(fns.setAssetBaseUrl).not.toHaveBeenCalled();
    // The canvas in its own element, the HUD's slot next to it
    const [canvasParent, hudSlot] = container.children;
    expect(fns.createRenderer).toHaveBeenCalledWith({
      parent: canvasParent,
      canvas: { style: 'display: block; ' },
    });
    expect(fns.bootEngineAsync).toHaveBeenCalledWith(expect.objectContaining({ hudSlot }));
    expect(fns.loadScene).toHaveBeenCalledWith({ sceneId: 'firstScene' });
    expect(m.state.observerCallback).not.toBeNull();
  });

  it('BACKGROUND, the sizes, the input, the asset base and the scene as given', async () => {
    await mount({
      layout: 'BACKGROUND',
      width: '40rem',
      height: 'calc(100vh - 2rem)',
      input: 'CANVAS',
      assetBaseUrl: 'https://cdn.test/embed/',
      sceneId: 'secondScene',
      pauseWhenHidden: false,
      canvas: { id: 'hero', style: 'border-radius: 8px' },
    });
    const container = m.state.host.children[0];
    expect(container.className).toBe('aekMount aekMount_BACKGROUND');
    expect(container.style).toMatchObject({
      width: '40rem',
      height: 'calc(100vh - 2rem)',
      position: 'fixed',
      zIndex: '-1',
      pointerEvents: 'none',
    });
    expect(fns.setInputScope).toHaveBeenCalledWith('CANVAS');
    expect(fns.setAssetBaseUrl).toHaveBeenCalledWith('https://cdn.test/embed/');
    expect(fns.createRenderer).toHaveBeenCalledWith(
      expect.objectContaining({
        canvas: { id: 'hero', style: 'display: block; border-radius: 8px' },
      })
    );
    expect(fns.loadScene).toHaveBeenCalledWith({ sceneId: 'secondScene' });
    expect(m.state.observerCallback).toBeNull();
  });

  it('the fallback image until the first loop frame (the second render)', async () => {
    await mount({ fallbackImage: 'banner.webp' });
    const container = m.state.host.children[0];
    const fallback = container.children.find((c) => c.className === 'aekMountFallback');
    expect(fallback?.style.background).toContain('url("banner.webp")');
    runFrames(1);
    expect(container.children).toContain(fallback);
    runFrames(1);
    expect(container.children).not.toContain(fallback);
  });
});

describe('mountAekasha: the loop', () => {
  it('pauses out of view and for pause(), and plays when neither holds', async () => {
    const handle = await mount();
    m.state.observerCallback!([{ isIntersecting: false }]);
    expect(fns.toggleMainPlay).toHaveBeenLastCalledWith(false);
    handle.pause();
    m.state.observerCallback!([{ isIntersecting: true }]);
    expect(handle.isPaused()).toBe(true);
    handle.resume();
    expect(fns.toggleMainPlay).toHaveBeenLastCalledWith(true);
    expect(handle.isPaused()).toBe(false);
  });

  it('with reduced motion: pauses after the first loop frame, until resume()', async () => {
    m.state.reducedMotion = true;
    const handle = await mount();
    runFrames(1);
    expect(handle.isPaused()).toBe(false);
    runFrames(1);
    expect(handle.isPaused()).toBe(true);
    handle.resume();
    expect(handle.isPaused()).toBe(false);
  });

  it('ignores reduced motion when told to', async () => {
    m.state.reducedMotion = true;
    const handle = await mount({ reducedMotion: 'IGNORE' });
    runFrames(2);
    expect(handle.isPaused()).toBe(false);
  });
});

describe('mountAekasha: once per page', () => {
  it('unmount tears down and removes the container; a second mount throws, also after it', async () => {
    const { mountAekasha } = await importMount();
    const handle = await mountAekasha({ target: '#hero', data, features: [] });
    await expect(mountAekasha({ target: '#hero', data, features: [] })).rejects.toThrow(
      'once per page load'
    );
    handle.unmount();
    expect(fns.stopMainLoop).toHaveBeenCalledTimes(1);
    expect(fns.removeAllInputListeners).toHaveBeenCalledTimes(1);
    expect(fns.stopAssetsWorker).toHaveBeenCalledTimes(1);
    expect(fns.deleteRenderer).toHaveBeenCalledTimes(1);
    expect(fns.setCanvasSizeSource).toHaveBeenLastCalledWith(null);
    expect(fns.setInputScope).toHaveBeenLastCalledWith('WINDOW');
    expect(fns.setAssetBaseUrl).toHaveBeenLastCalledWith(null);
    expect(m.state.host.children).toHaveLength(0);
    handle.unmount();
    expect(fns.stopMainLoop).toHaveBeenCalledTimes(1);
    await expect(mountAekasha({ target: '#hero', data, features: [] })).rejects.toThrow(
      'once per page load'
    );
  });

  it('throws after InitEngine, for a target that matches nothing, and without scenes', async () => {
    fns.isEngineBooted.mockReturnValue(true);
    await expect(mount()).rejects.toThrow('once per page load');
    fns.isEngineBooted.mockReturnValue(false);
    await expect(mount({ target: '#nothing' })).rejects.toThrow('no element matches');
    await expect(mount({ data: { ...data, json: { scenes: {} } } })).rejects.toThrow('no scenes');
  });
});

describe('mountAekasha: the fallback', () => {
  it('without WebGPU and WebGL2: the fallback image, no boot', async () => {
    m.state.hasGpu = false;
    m.state.hasWebGL2 = false;
    const handle = await mount({ fallbackImage: 'banner.webp' });
    expect(handle.isFallback).toBe(true);
    expect(fns.bootEngineAsync).not.toHaveBeenCalled();
    expect(m.state.host.children[0].children.some((c) => c.className === 'aekMountFallback')).toBe(
      true
    );
    handle.unmount();
    expect(m.state.host.children).toHaveLength(0);
  });

  it('a failed boot: torn down, the container kept with its fallback image', async () => {
    fns.bootEngineAsync.mockRejectedValue(new Error('no adapter'));
    fns.getRenderer.mockReturnValueOnce(null as never);
    const handle = await mount({ fallbackImage: 'banner.webp' });
    expect(handle.isFallback).toBe(true);
    expect(fns.stopMainLoop).toHaveBeenCalledTimes(1);
    expect(fns.deleteRenderer).not.toHaveBeenCalled();
    expect(m.state.host.children).toEqual([handle.container]);
    expect(m.state.host.children[0].children.some((c) => c.className === 'aekMountFallback')).toBe(
      true
    );
  });
});
