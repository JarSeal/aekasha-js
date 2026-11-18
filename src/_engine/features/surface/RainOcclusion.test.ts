import * as THREE from 'three/webgpu';
import { beforeAll, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  isLoading: false,
  renderer: null as unknown,
  camera: null as unknown,
  scene: null as unknown,
}));
vi.mock(import('../../kernel/scene/SceneLoader'), async (importOriginal) => ({
  ...(await importOriginal()),
  isCurrentlyLoading: () => m.isLoading,
}));
vi.mock(import('../../kernel/render/Renderer'), async (importOriginal) => ({
  ...(await importOriginal()),
  getRenderer: (() => m.renderer) as never,
}));
vi.mock(import('../../kernel/camera/Camera'), async (importOriginal) => ({
  ...(await importOriginal()),
  getActiveCamera: () => m.camera as THREE.Camera,
}));
vi.mock(import('../../kernel/scene/Scene'), async (importOriginal) => ({
  ...(await importOriginal()),
  getRootScene: (() => m.scene) as never,
}));

import { DEFAULT_ECS_WORLD_ID, ECSWorld, getECSWorld } from '../../kernel/ecs/ECS';
import type { FeatureContext } from '../../kernel/init/Features';
import type { SceneData } from '../../kernel/scene/Scene';
import type { SceneHooks } from '../../kernel/scene/SceneHooks';
import {
  getRainOcclusionDebugState,
  getRainOcclusionNode,
  isRainOccluder,
  isRainOcclusionEnabled,
  requestRainOcclusionUpdate,
  setRainOcclusionEnabled,
} from './RainOcclusion';
import { rainOcclusion } from './RainOcclusionFeature';

new ECSWorld({ id: DEFAULT_ECS_WORLD_ID });

/** A renderer with what the map's clear and render call, counting the clears and renders */
const createFakeRenderer = () => {
  let target: THREE.RenderTarget | null = null;
  let objectFn: unknown = null;
  const renderer = {
    clears: 0,
    renders: [] as { target: THREE.RenderTarget | null; objectFn: unknown }[],
    reversedDepthBuffer: false,
    toneMapping: THREE.NoToneMapping,
    toneMappingExposure: 1,
    outputColorSpace: THREE.SRGBColorSpace,
    autoClear: true,
    autoClearColor: true,
    autoClearDepth: true,
    autoClearStencil: true,
    opaque: true,
    transparent: true,
    hasInitialized: () => true,
    getRenderTarget: () => target,
    setRenderTarget: (next: THREE.RenderTarget | null) => (target = next),
    getActiveCubeFace: () => 0,
    getActiveMipmapLevel: () => 0,
    getMRT: () => null,
    setMRT: () => {},
    getRenderObjectFunction: () => objectFn,
    setRenderObjectFunction: (fn: unknown) => (objectFn = fn),
    getPixelRatio: () => 1,
    setPixelRatio: () => {},
    getClearColor: (color: THREE.Color) => color.set(0),
    getClearAlpha: () => 1,
    setClearColor: () => {},
    getScissorTest: () => false,
    setScissorTest: () => {},
    clear: () => renderer.clears++,
    render: () => renderer.renders.push({ target, objectFn }),
  };
  return renderer;
};

let hooks: SceneHooks = {};
let system: ((world: ECSWorld) => void) | null = null;
const frame = () => system!(getECSWorld());
const switchScene = () => {
  hooks.exit?.('previous');
  hooks.worldCleared?.(getECSWorld(), 'previous', { id: 'next' } as SceneData);
};

describe('isRainOccluder', () => {
  it('follows castShadow unless userData.rainOccluder says otherwise', () => {
    const object = new THREE.Object3D();
    expect(isRainOccluder(object)).toBe(false);
    object.castShadow = true;
    expect(isRainOccluder(object)).toBe(true);
    object.userData.rainOccluder = false;
    expect(isRainOccluder(object)).toBe(false);
    object.castShadow = false;
    object.userData.rainOccluder = true;
    expect(isRainOccluder(object)).toBe(true);
  });
});

describe('rain occlusion without the feature', () => {
  it('returns null from the node and throws from the setters, naming it', () => {
    expect(getRainOcclusionNode()).toBeNull();
    expect(getRainOcclusionDebugState()).toBeNull();
    expect(isRainOcclusionEnabled()).toBeNull();
    expect(() => setRainOcclusionEnabled(false)).toThrow(/rainOcclusion\(\)/);
    expect(() => requestRainOcclusionUpdate()).toThrow(/rainOcclusion\(\)/);
  });
});

describe('rain occlusion with the feature', () => {
  const renderer = createFakeRenderer();
  const camera = new THREE.PerspectiveCamera();

  beforeAll(async () => {
    m.renderer = renderer;
    m.camera = camera;
    m.scene = new THREE.Scene();
    const fakeWorld = {
      addSystem: (_stage: unknown, _name: string, fn: typeof system) => (system = fn),
    };
    const ctx = {
      registerPlugin: (plugin: (world: unknown) => void) => plugin(fakeWorld),
      addSceneHooks: (sceneHooks: SceneHooks) => {
        hooks = sceneHooks;
        return () => {};
      },
      onUnmount: () => {},
    } as unknown as FeatureContext;
    await rainOcclusion({ updateFrames: 3 }).install(ctx);
  });

  it('clears the map at the first scene load and renders nothing before a material reads it', () => {
    switchScene();
    expect(renderer.clears).toBe(1);
    for (let i = 0; i < 10; i++) frame();
    expect(renderer.renders).toHaveLength(0);
    expect(getRainOcclusionDebugState()?.hasConsumer).toBe(false);
  });

  it('renders once a node is made: first, every updateFrames frames, and on a move', () => {
    const node = getRainOcclusionNode();
    expect(node).not.toBeNull();
    frame();
    expect(renderer.renders).toHaveLength(1);
    const [render] = renderer.renders;
    expect(render.target?.depthTexture?.name).toBe('RainOcclusionMap');
    // The occluders' filter, and the renderer's own put back afterwards
    expect(typeof render.objectFn).toBe('function');
    expect(renderer.getRenderObjectFunction()).toBeNull();
    expect(renderer.getRenderTarget()).toBeNull();
    frame();
    frame();
    expect(renderer.renders).toHaveLength(1);
    frame();
    expect(renderer.renders).toHaveLength(2);
    // 9 m across is past an eighth of 64 m
    camera.position.set(9, 0, 0);
    camera.updateMatrixWorld();
    frame();
    expect(renderer.renders).toHaveLength(3);
    expect(getRainOcclusionDebugState()?.centre).toBe('9.0, 0.0, 0.0');
  });

  it("maps the world under the centre to the map's middle, −z up the map", () => {
    // Read the matrix through a node's uniform: the one getRainOcclusionNode's nodes share
    let matrix: THREE.Matrix4 | null = null;
    getRainOcclusionNode()!.traverse((node) => {
      const value = (node as unknown as { value?: unknown }).value;
      if (value instanceof THREE.Matrix4) matrix = value;
    });
    expect(matrix).not.toBeNull();
    const at = (x: number, y: number, z: number) =>
      new THREE.Vector4(x, y, z, 1).applyMatrix4(matrix!).toArray();
    // The centre (9, 0, 0), 100 m below the map's camera of 200 m depth: halfway
    const [u, v, depth] = at(9, 0, 0);
    expect([u, v, depth].map((n) => +n.toFixed(4))).toEqual([0.5, 0.5, 0.5]);
    // A quarter of the extent along +x and −z: the right, and up the map (v before the flip)
    const [u2, v2] = at(9 + 16, 0, -16);
    expect([u2, v2].map((n) => +n.toFixed(4))).toEqual([0.75, 0.75]);
    // Higher is nearer the map's camera
    expect(at(9, 50, 0)[2]).toBeCloseTo(0.25);
  });

  it("doesn't render while a scene loads or while off, and drops the map at a scene's exit", () => {
    const count = renderer.renders.length;
    m.isLoading = true;
    switchScene();
    for (let i = 0; i < 5; i++) frame();
    expect(renderer.renders).toHaveLength(count);
    // Cleared once only: the target lives across scenes
    expect(renderer.clears).toBe(1);
    m.isLoading = false;
    frame();
    expect(renderer.renders).toHaveLength(count + 1);
    setRainOcclusionEnabled(false);
    expect(isRainOcclusionEnabled()).toBe(false);
    for (let i = 0; i < 5; i++) frame();
    expect(renderer.renders).toHaveLength(count + 1);
    setRainOcclusionEnabled(true);
    frame();
    expect(renderer.renders).toHaveLength(count + 2);
    requestRainOcclusionUpdate();
    frame();
    expect(renderer.renders).toHaveLength(count + 3);
  });
});
