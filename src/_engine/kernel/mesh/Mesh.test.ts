import { beforeAll, describe, expect, test, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { ECSWorld } from '../ecs/ECS';
import { ComponentType } from '../ecs/ECSCoreComponents';
import { createRootScene } from '../scene/Scene';
import { saveMaterial } from '../assets/Material';
import { createMeshEntity, preWarmMesh } from './Mesh';

// The renderer (only its compileAsync) and the warning log are stand-ins
const fns = vi.hoisted(() => ({
  compileAsync: vi.fn<(...args: unknown[]) => Promise<void>>(),
  lwarn: vi.fn(),
}));
vi.mock(import('../render/Renderer'), async (importOriginal) => ({
  ...(await importOriginal()),
  getRenderer: (() => ({ compileAsync: fns.compileAsync })) as never,
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

  test('compiles with one camera across calls', () => {
    fns.compileAsync.mockResolvedValue(undefined);
    fns.compileAsync.mockClear();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicNodeMaterial());
    preWarmMesh(mesh, 'a');
    preWarmMesh(mesh, 'b');
    const [first, second] = fns.compileAsync.mock.calls;
    expect(first[1]).toBeInstanceOf(THREE.Camera);
    expect(second[1]).toBe(first[1]);
  });
});
