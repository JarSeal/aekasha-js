import { beforeAll, describe, expect, test, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { ECSWorld } from '../ecs/ECS';
import { ComponentType } from '../ecs/ECSCoreComponents';
import { createRootScene } from '../scene/Scene';
import { saveMaterial } from '../assets/Material';
import { runCompileAsync } from '../render/CompileQueue';
import { setRenderPipeline } from '../render/RenderHooks';
import { createMeshEntity, disposeMesh, preWarmMesh } from './Mesh';

// Resolves once every pre-warm queued so far has ended
const flushCompilesAsync = () => runCompileAsync(async () => undefined);

// The renderer (only its compileAsync) and the warning log are stand-ins
const fns = vi.hoisted(() => ({
  compileAsync: vi.fn<(...args: unknown[]) => Promise<void>>(),
  lwarn: vi.fn(),
}));
vi.mock(import('../render/Renderer'), async (importOriginal) => ({
  ...(await importOriginal()),
  getRenderer: (() => ({ compileAsync: fns.compileAsync, init: async () => undefined })) as never,
}));
vi.mock(import('../../utils/Logger'), async (importOriginal) => ({
  ...(await importOriginal()),
  lwarn: fns.lwarn,
}));

// The default world (createMeshEntity's) and the root scene, once for this file
let world: ECSWorld;
beforeAll(() => {
  world = new ECSWorld();
  createRootScene();
});

describe('createMeshEntity', () => {
  test('takes a registered material by its id', () => {
    const material = new THREE.MeshBasicNodeMaterial();
    saveMaterial(material, 'meshTestMaterial');
    const entityId = createMeshEntity({
      geo: new THREE.BoxGeometry(),
      mat: 'meshTestMaterial',
      appId: 'meshTestMesh',
    });
    const mesh = world.getComponent(entityId, ComponentType.OBJECT3D)!.value as THREE.Mesh;
    expect(mesh.material).toBe(material);
    world.deleteEntity(entityId);
  });

  test('a deleted mesh entity disposes its mesh, so three frees its render objects', () => {
    const material = saveMaterial(new THREE.MeshBasicNodeMaterial(), 'meshTestShared');
    const entityId = createMeshEntity({ geo: new THREE.BoxGeometry(), mat: 'meshTestShared' });
    const mesh = world.getComponent(entityId, ComponentType.OBJECT3D)!.value as THREE.Mesh;
    const onDispose = vi.fn();
    mesh.addEventListener('dispose', onDispose);
    disposeMesh(entityId, world);
    expect(onDispose).toHaveBeenCalledOnce();
    expect(mesh.parent).toBeNull();
    expect(mesh.material).toBe(material);
    world.deleteEntity(entityId);
  });

  // p353 Phase 5: a streamed cell's meshes are created in MAIN after object3DSyncSystem, and drew
  // a frame at the origin
  test('puts its mesh at the creation pose at once, before any object sync', () => {
    const entityId = createMeshEntity({
      geo: new THREE.BoxGeometry(),
      mat: new THREE.MeshBasicNodeMaterial(),
      position: { x: 300, y: -4, z: 120 },
      rotation: { y: Math.PI / 2 },
      scale: { x: 2, y: 2, z: 2 },
    });
    const mesh = world.getComponent(entityId, ComponentType.OBJECT3D)!.value;
    expect(mesh.position.toArray()).toEqual([300, -4, 120]);
    expect(mesh.rotation.y).toBeCloseTo(Math.PI / 2);
    expect(mesh.scale.toArray()).toEqual([2, 2, 2]);
    world.deleteEntity(entityId);
  });

  test('throws its own message for an unregistered geometry id', () => {
    expect(() =>
      createMeshEntity({ geo: 'meshTestNoGeometry', mat: new THREE.MeshBasicNodeMaterial() })
    ).toThrow('Could not find geometry with id "meshTestNoGeometry"');
  });
});

describe('preWarmMesh', () => {
  test('warns on a failed compile instead of leaving its rejection unhandled', async () => {
    fns.compileAsync.mockRejectedValueOnce(new Error('compile failed'));
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicNodeMaterial());
    preWarmMesh(mesh, 'failingMesh');
    await vi.waitFor(() =>
      expect(fns.lwarn).toHaveBeenCalledWith(
        expect.stringContaining('failingMesh'),
        expect.any(Error)
      )
    );
  });

  test('compiles with one camera across calls', async () => {
    fns.compileAsync.mockResolvedValue(undefined);
    fns.compileAsync.mockClear();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicNodeMaterial());
    preWarmMesh(mesh, 'a');
    preWarmMesh(mesh, 'b');
    await flushCompilesAsync();
    const [first, second] = fns.compileAsync.mock.calls;
    expect(first[1]).toBeInstanceOf(THREE.Camera);
    expect(second[1]).toBe(first[1]);
  });

  test('compiles unculled (its camera is at the origin), and puts the flag back', async () => {
    const culled: boolean[] = [];
    fns.compileAsync.mockImplementation(async (mesh) => {
      culled.push((mesh as THREE.Mesh).frustumCulled);
    });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicNodeMaterial());
    mesh.position.set(0, 0, 50);
    preWarmMesh(mesh, 'farMesh');
    await flushCompilesAsync();
    expect(culled).toEqual([false]);
    expect(mesh.frustumCulled).toBe(true);
    fns.compileAsync.mockReset();
  });

  test("compiles one pre-warm at a time, and in the render pipeline's targets while it's on", async () => {
    const calls: string[] = [];
    let release = () => {};
    fns.compileAsync.mockImplementation(async (mesh) => {
      calls.push(`start ${(mesh as THREE.Mesh).name}`);
      await new Promise<void>((resolve) => (release = resolve));
      calls.push(`end ${(mesh as THREE.Mesh).name}`);
    });
    // The pipeline's compiler: two targets, each with the camera it renders with
    const passCamera = new THREE.PerspectiveCamera();
    let isPipelineOn = false;
    setRenderPipeline(
      () => null,
      (compile) =>
        isPipelineOn
          ? (async () => {
              calls.push('target A');
              await compile(passCamera);
              calls.push('target B');
              await compile(passCamera);
            })()
          : null
    );

    const a = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicNodeMaterial());
    a.name = 'a';
    const b = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicNodeMaterial());
    b.name = 'b';
    isPipelineOn = true;
    preWarmMesh(a, 'a');
    preWarmMesh(b, 'b');
    const countStarts = () => calls.filter((call) => call.startsWith('start')).length;
    for (let i = 1; i <= 4; i++) {
      await vi.waitFor(() => expect(countStarts()).toBe(i));
      release();
    }
    await flushCompilesAsync();
    expect(calls).toEqual([
      'target A',
      'start a',
      'end a',
      'target B',
      'start a',
      'end a',
      'target A',
      'start b',
      'end b',
      'target B',
      'start b',
      'end b',
    ]);
    expect(fns.compileAsync.mock.calls.every((call) => call[1] === passCamera)).toBe(true);
    fns.compileAsync.mockReset();
  });
});
