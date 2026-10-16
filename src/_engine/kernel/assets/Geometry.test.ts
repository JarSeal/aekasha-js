import { beforeAll, describe, expect, test, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { createRootScene } from '../scene/Scene';
import { initEnvironment } from '../config/Config';
import { createGeometry, getGeometry, prewarmGeometry, saveBufferGeometry } from './Geometry';

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

beforeAll(() => {
  createRootScene();
});

describe('getGeometry', () => {
  test('returns undefined for an unregistered id instead of throwing', () => {
    expect(getGeometry('geometryTestNone')).toBeUndefined();
  });

  test('leaves an unregistered id out of an array', () => {
    const box = createGeometry({ id: 'geometryTestBox', type: 'BOX' });
    expect(getGeometry(['geometryTestNone', 'geometryTestBox'])).toEqual([box]);
  });
});

describe('prewarmGeometry', () => {
  test('compiles with one material and camera across calls, and disposes its stand-in', async () => {
    fns.compileAsync.mockClear();
    const disposed: THREE.Object3D[] = [];
    fns.compileAsync.mockImplementation(async (mesh) => {
      (mesh as THREE.Mesh).addEventListener('dispose', () => disposed.push(mesh as THREE.Mesh));
    });
    const geometry = createGeometry({ id: 'geometryTestWarm', type: 'SPHERE' });
    await prewarmGeometry('geometryTestWarm');
    await prewarmGeometry('geometryTestWarm');

    const [first, second] = fns.compileAsync.mock.calls as [THREE.Mesh, THREE.Camera][];
    expect(first[0].geometry).toBe(geometry);
    expect(second[0].material).toBe(first[0].material);
    expect(second[1]).toBe(first[1]);
    expect(disposed).toEqual([first[0], second[0]]);
  });

  test('warns on a failed compile instead of rejecting', async () => {
    fns.compileAsync.mockRejectedValueOnce(new Error('compile failed'));
    createGeometry({ id: 'geometryTestFailing', type: 'BOX' });
    await expect(prewarmGeometry('geometryTestFailing')).resolves.toBeUndefined();
    expect(fns.lwarn).toHaveBeenCalledWith(
      expect.stringContaining('geometryTestFailing'),
      expect.any(Error)
    );
  });
});

describe('saveBufferGeometry', () => {
  test('returns the registered geometry for a taken id, and warns in the debug env', () => {
    initEnvironment({ search: '?isDebug=true', env: { VITE_APP_ENV: 'development' } });
    const registered = saveBufferGeometry(new THREE.BufferGeometry(), { id: 'geometryTestSaved' });
    fns.lwarn.mockClear();

    expect(saveBufferGeometry(registered, { id: 'geometryTestSaved' })).toBe(registered);
    expect(fns.lwarn).not.toHaveBeenCalled();

    const other = new THREE.BufferGeometry();
    expect(saveBufferGeometry(other, { id: 'geometryTestSaved' })).toBe(registered);
    expect(fns.lwarn).toHaveBeenCalledWith(expect.stringContaining('"geometryTestSaved"'));
  });
});
