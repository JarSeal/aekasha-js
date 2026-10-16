import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import type { FeatureContext } from '../../kernel/init/Features';
import type { AfterRenderHook } from '../../kernel/render/RenderHooks';

// The DOM is a few fake elements (the HUD root, the layer, the slots) and the renderer a fake that
// records its state: the test checks the viewports' renderer state and layer wiring, not a GPU
const m = vi.hoisted(() => {
  type FakeElem = {
    isConnected: boolean;
    addEventListener: () => void;
    classList: { toggle: () => void };
    getBoundingClientRect: () => DOMRect;
  };
  const rect = (x: number, y: number, width: number, height: number) =>
    ({ left: x, top: y, width, height }) as DOMRect;
  type FakeCmp = { elem: FakeElem; add: () => FakeCmp; remove: () => void };
  const added: FakeCmp[] = [];
  const createCmp = (box: DOMRect): FakeCmp => {
    const elem: FakeElem = {
      isConnected: true,
      addEventListener: () => {},
      classList: { toggle: () => {} },
      getBoundingClientRect: () => box,
    };
    const cmp: FakeCmp = {
      elem,
      add: () => {
        const child = createCmp(rect(10, 10, 100, 50));
        added.push(child);
        return child;
      },
      remove: () => {
        elem.isConnected = false;
      },
    };
    return cmp;
  };
  const state = {
    hudRoot: createCmp(rect(0, 0, 800, 600)),
    /** Every CMP added under the HUD root, in order: the layer is the first */
    added,
    observerCallback: null as MutationCallback | null,
    disconnect: vi.fn(),
  };
  class FakeMutationObserver {
    constructor(callback: MutationCallback) {
      state.observerCallback = callback;
    }
    observe = vi.fn();
    disconnect = state.disconnect;
  }
  vi.stubGlobal('document', { body: {} });
  vi.stubGlobal('MutationObserver', FakeMutationObserver);
  return { state, rect };
});

vi.mock('../../ui/HUD', () => ({
  getHUDRootCMP: () => m.state.hudRoot,
  KEEP_IN_VIEWS_CLASS: 'aekKeepInViews',
}));
vi.mock('../../debug/GPUMemory', () => ({ registerGPUMemorySource: () => () => {} }));
vi.mock('./Viewports.module.scss', () => ({ default: {} }));

const { createViewport, deleteViewport, installViewports } = await import('./Viewports');

let renderViewports: AfterRenderHook;
installViewports({
  addAfterRender: (hook: AfterRenderHook) => {
    renderViewports = hook;
    return () => {};
  },
} as unknown as FeatureContext);

/** A renderer that keeps the state the viewports change, and renders through `onRender` */
const createRenderer = (onRender: (object: THREE.Object3D) => void = () => {}) => {
  const viewport = new THREE.Vector4(0, 0, 800, 600);
  const clearColor = new THREE.Color(0x336699);
  const renderer = {
    samples: 0,
    autoClear: true,
    toneMapping: THREE.ACESFilmicToneMapping as THREE.ToneMapping,
    outputColorSpace: THREE.SRGBColorSpace as string,
    renderTarget: null as THREE.RenderTarget | null,
    clearAlpha: 1,
    domElement: { getBoundingClientRect: () => m.rect(0, 0, 800, 600) },
    getSize: (out: THREE.Vector2) => out.set(800, 600),
    getPixelRatio: () => 1,
    getDrawingBufferSize: (out: THREE.Vector2) => out.set(800, 600),
    getRenderTarget: () => renderer.renderTarget,
    getActiveCubeFace: () => 0,
    getActiveMipmapLevel: () => 0,
    getClearAlpha: () => renderer.clearAlpha,
    getClearColor: (out: THREE.Color) => out.copy(clearColor),
    getViewport: (out: THREE.Vector4) => out.copy(viewport),
    setRenderTarget: (target: THREE.RenderTarget | null) => {
      renderer.renderTarget = target;
    },
    setClearColor: (color: THREE.Color, alpha: number) => {
      clearColor.copy(color);
      renderer.clearAlpha = alpha;
    },
    setViewport: (x: number | THREE.Vector4, y = 0, width = 0, height = 0) => {
      if (x instanceof THREE.Vector4) viewport.copy(x);
      else viewport.set(x, y, width, height);
    },
    render: vi.fn((object: THREE.Object3D) => onRender(object)),
    viewport,
    clearColor,
  };
  return renderer;
};

const expectRestored = (renderer: ReturnType<typeof createRenderer>) => {
  expect(renderer.toneMapping).toBe(THREE.ACESFilmicToneMapping);
  expect(renderer.outputColorSpace).toBe(THREE.SRGBColorSpace);
  expect(renderer.autoClear).toBe(true);
  expect(renderer.renderTarget).toBe(null);
  expect(renderer.clearAlpha).toBe(1);
  expect(renderer.clearColor.getHex()).toBe(0x336699);
  expect(renderer.viewport.toArray()).toEqual([0, 0, 800, 600]);
};

const render = (renderer: ReturnType<typeof createRenderer>) =>
  renderViewports(renderer as unknown as THREE.Renderer, 1 / 60);

describe('renderViewports', () => {
  beforeEach(() => {
    deleteViewport('vp');
    deleteViewport('vp2');
  });

  it('restores the renderer when a viewport throws in onBeforeRender after another rendered', () => {
    createViewport({ id: 'vp', scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera() });
    createViewport({
      id: 'vp2',
      scene: new THREE.Scene(),
      camera: new THREE.PerspectiveCamera(),
      onBeforeRender: () => {
        throw new Error('consumer bug');
      },
    });
    const renderer = createRenderer();
    expect(() => render(renderer)).toThrow('consumer bug');
    expectRestored(renderer);
  });

  it('restores the tone mapping and colour space when the composite throws', () => {
    createViewport({ id: 'vp', scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera() });
    const renderer = createRenderer((object) => {
      if (object instanceof THREE.QuadMesh) throw new Error('composite failed');
    });
    expect(() => render(renderer)).toThrow('composite failed');
    expectRestored(renderer);
  });

  it('skips a viewport whose camera resolver returns undefined', () => {
    createViewport({ id: 'vp', scene: new THREE.Scene(), camera: () => undefined });
    const renderer = createRenderer();
    render(renderer);
    expect(renderer.render).not.toHaveBeenCalled();
    expectRestored(renderer);
  });
});

describe('the layer', () => {
  it("disconnects its body observer once the layer has left the document (a mount's unmount)", () => {
    createViewport({ id: 'vp', scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera() });
    const callback = m.state.observerCallback!;
    const observer = { disconnect: m.state.disconnect } as unknown as MutationObserver;

    callback([], observer);
    expect(m.state.disconnect).not.toHaveBeenCalled();

    m.state.added[0].elem.isConnected = false;
    callback([], observer);
    expect(m.state.disconnect).toHaveBeenCalledTimes(1);
  });
});
