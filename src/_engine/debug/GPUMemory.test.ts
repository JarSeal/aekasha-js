import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  vi.stubGlobal('localStorage', {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  });
});

import { initEnvironment } from '../kernel/config/Config';
import { _getGPUMemorySources, registerGPUMemorySource } from './GPUMemory';

initEnvironment({ search: '?isDebug=true', env: { VITE_APP_ENV: 'development' } });

const source = (label: string) => ({ id: 'test.targets', label, getResources: () => [] });

describe('GPU memory sources (p618 D11)', () => {
  it('registers, replaces by id and removes a source', () => {
    const first = source('First');
    const second = source('Second');
    const removeFirst = registerGPUMemorySource(first);
    expect(_getGPUMemorySources().get('test.targets')).toBe(first);

    const removeSecond = registerGPUMemorySource(second);
    expect(_getGPUMemorySources().get('test.targets')).toBe(second);

    // The replaced source's remover leaves its replacement alone
    removeFirst();
    expect(_getGPUMemorySources().get('test.targets')).toBe(second);
    removeSecond();
    expect(_getGPUMemorySources().has('test.targets')).toBe(false);
  });

  it('registers nothing where the profiler doesn’t load (production)', async () => {
    vi.resetModules();
    const config = await import('../kernel/config/Config');
    config.initEnvironment({ search: '?isDebug=true', env: {} });
    const fresh = await import('./GPUMemory');

    const remove = fresh.registerGPUMemorySource(source('Gated'));
    expect(fresh._getGPUMemorySources().size).toBe(0);
    expect(remove).not.toThrow();
  });
});
