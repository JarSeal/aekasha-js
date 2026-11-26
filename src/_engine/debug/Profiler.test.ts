import { describe, expect, it, vi } from 'vitest';

// The profiler's implementation builds a draggable window (DOM): only its entry points, recorded
const profiler = vi.hoisted(() => ({
  _createProfilerTab: vi.fn(),
  _removeProfilerTab: vi.fn(),
  _onStatsSourceReplaced: vi.fn(),
}));
vi.mock(import('./profiler/_dbg__Profiler'), () => profiler as never);

vi.hoisted(() => {
  vi.stubGlobal('localStorage', {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  });
});

import * as THREE from 'three/webgpu';
import type { ECSWorld } from '../kernel/ecs/ECS';
import { initEnvironment } from '../kernel/config/Config';
import { isDebugHelperObject } from '../kernel/render/Object3DHelpers';
import {
  _getEntityWindowOpener,
  _getStatsSources,
  createProfilerTab,
  markDebugHelper,
  registerEntityWindowOpener,
  registerProfiler,
  registerStatsSource,
  removeProfilerTab,
} from './Profiler';

initEnvironment({ search: '?isDebug=true', env: { VITE_APP_ENV: 'development' } });

const tabDef = (id: string) => ({ id, title: id, icon: 'gear', content: () => [] });

describe('profiler: tabs (p618 §1.4)', () => {
  // B4: a tab created before the profiler loads (a feature's onDebug hook) was dropped. First in
  // the file: the profiler isn't loaded yet.
  it('keeps a tab created before the profiler loads, and drops a removed one (B4)', async () => {
    const early = tabDef('early');
    const replaced = tabDef('replaced');
    const replacement = { ...tabDef('replaced'), title: 'Replacement' };
    createProfilerTab(early);
    createProfilerTab(replaced);
    createProfilerTab(tabDef('removed'));
    createProfilerTab(replacement);
    removeProfilerTab('removed');

    await registerProfiler();

    expect(profiler._createProfilerTab.mock.calls.map(([def]) => def)).toEqual([
      early,
      replacement,
    ]);
    expect(profiler._removeProfilerTab).not.toHaveBeenCalled();
  });

  it('hands tabs to the profiler once it has loaded', () => {
    const late = tabDef('late');
    createProfilerTab(late);
    expect(profiler._createProfilerTab).toHaveBeenLastCalledWith(late);
    removeProfilerTab('late');
    expect(profiler._removeProfilerTab).toHaveBeenCalledWith('late');
  });
});

describe('profiler: stats sources', () => {
  it('replaces a source by id, and the replaced source’s remover does nothing', () => {
    const first = { id: 'test.source', label: 'First', read: () => 1 };
    const second = { id: 'test.source', label: 'Second', read: () => 2 };
    const removeFirst = registerStatsSource(first);
    const removeSecond = registerStatsSource(second);

    expect(_getStatsSources().get('test.source')).toBe(second);
    expect(profiler._onStatsSourceReplaced).toHaveBeenLastCalledWith(first);

    removeFirst();
    expect(_getStatsSources().get('test.source')).toBe(second);

    removeSecond();
    expect(_getStatsSources().has('test.source')).toBe(false);
    expect(profiler._onStatsSourceReplaced).toHaveBeenLastCalledWith(second);
  });
});

describe('profiler: entity window openers', () => {
  const world = { isAlive: () => true } as unknown as ECSWorld;

  it('tries the openers in descending priority, equal ones in registration order', () => {
    const opener = (id: string, priority?: number, canOpen = true) => ({
      id,
      label: id,
      priority,
      canOpen: () => canOpen,
      toggle: vi.fn(),
    });
    registerEntityWindowOpener(opener('physics'));
    registerEntityWindowOpener(opener('mesh'));
    registerEntityWindowOpener(opener('character', 10));
    expect(_getEntityWindowOpener(world, 1)?.id).toBe('character');

    // Replaced by id: the character opener can't open this entity now
    registerEntityWindowOpener(opener('character', 10, false));
    expect(_getEntityWindowOpener(world, 1)?.id).toBe('physics');
  });

  it('opens nothing for a deleted entity', () => {
    const deadWorld = { isAlive: () => false } as unknown as ECSWorld;
    expect(_getEntityWindowOpener(deadWorld, 1)).toBeNull();
  });
});

describe('profiler: the mode gate', () => {
  it('registers nothing where the profiler doesn’t load (production)', async () => {
    vi.resetModules();
    const config = await import('../kernel/config/Config');
    config.initEnvironment({ search: '?isDebug=true', env: {} });
    const fresh = await import('./Profiler');

    expect(fresh.isProfilerLoadedInThisMode()).toBe(false);
    const remove = fresh.registerStatsSource({ id: 'test.gated', label: 'Gated', read: () => 1 });
    expect(fresh._getStatsSources().has('test.gated')).toBe(false);
    expect(remove).not.toThrow();

    await fresh.registerProfiler();
    expect(fresh.isProfilerAvailable()).toBe(false);
  });
});

describe('profiler: debug helpers', () => {
  it('marks a subtree as a helper and turns the fog off on its materials (p106 D7)', () => {
    const material = new THREE.MeshBasicNodeMaterial();
    const multi = [new THREE.LineBasicNodeMaterial(), new THREE.LineBasicNodeMaterial()];
    const root = new THREE.Group();
    const child = new THREE.Mesh(new THREE.BoxGeometry(), material);
    child.add(new THREE.Mesh(new THREE.BoxGeometry(), multi));
    root.add(child);
    expect(markDebugHelper(root)).toBe(root);
    expect(isDebugHelperObject(root)).toBe(true);
    expect([material.fog, ...multi.map((entry) => entry.fog)]).toEqual([false, false, false]);
    // A material set after the mark isn't reached
    const later = new THREE.MeshBasicNodeMaterial();
    child.material = later;
    expect(later.fog).toBe(true);
  });
});
