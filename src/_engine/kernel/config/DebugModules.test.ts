import { describe, expect, it, vi } from 'vitest';

vi.mock(import('../../utils/Logger'), async (importOriginal) => ({
  ...(await importOriginal()),
  lerror: vi.fn(),
}));

import { lerror } from '../../utils/Logger';
import { initEnvironment } from './Config';
import { loadDebugModule, loadDebugModuleAsync, useDebug } from './DebugModules';

const DEBUG = { search: '?isDebug=true', env: { VITE_APP_ENV: 'development' } };
const PROD_TEST = { search: '?isProdTest=true', env: { VITE_APP_ENV: 'development' } };
const PRODUCTION = { search: '?isDebug=true', env: {} };

const fakeModule = { name: 'fake' };
const importer = () => Promise.resolve(fakeModule);

describe('debug module loaders (p618 D11)', () => {
  it('loadDebugModule returns a ref at once, set when the import resolves (debug env)', async () => {
    initEnvironment(DEBUG);
    const ref = loadDebugModule(importer);
    expect(ref).toEqual({ current: null });
    await Promise.resolve();
    expect(ref?.current).toBe(fakeModule);
  });

  it('loadDebugModule returns null outside the debug env, prod test mode included', () => {
    const load = vi.fn(importer);
    initEnvironment(PROD_TEST);
    expect(loadDebugModule(load)).toBeNull();
    initEnvironment(PRODUCTION);
    expect(loadDebugModule(load)).toBeNull();
    expect(load).not.toHaveBeenCalled();
  });

  it('loadDebugModuleAsync resolves with the loaded ref in the debug env', async () => {
    initEnvironment(DEBUG);
    expect((await loadDebugModuleAsync(importer))?.current).toBe(fakeModule);
  });

  it('loadDebugModuleAsync loads in prod test mode only when asked to', async () => {
    initEnvironment(PROD_TEST);
    expect(await loadDebugModuleAsync(importer)).toBeNull();
    expect((await loadDebugModuleAsync(importer, true))?.current).toBe(fakeModule);
    initEnvironment(PRODUCTION);
    expect(await loadDebugModuleAsync(importer, true)).toBeNull();
  });

  it('loadDebugModuleAsync logs and rejects with the debug id when the import fails', async () => {
    initEnvironment(DEBUG);
    const failing = () => Promise.reject(new Error('chunk missing'));
    await expect(loadDebugModuleAsync(failing, false, 'Test module')).rejects.toThrow(
      'Debug module async loading failed: Test module. chunk missing'
    );
    expect(lerror).toHaveBeenCalledWith('Debug module async loading failed: Test module.');
  });

  it('useDebug returns the module only when it has loaded and its mode is on', () => {
    const loaded = { current: fakeModule };
    initEnvironment(DEBUG);
    expect(useDebug(loaded)).toBe(fakeModule);
    expect(useDebug({ current: null })).toBeUndefined();
    expect(useDebug(null)).toBeUndefined();

    initEnvironment(PROD_TEST);
    expect(useDebug(loaded)).toBeUndefined();
    expect(useDebug(loaded, true)).toBe(fakeModule);

    initEnvironment(PRODUCTION);
    expect(useDebug(loaded, true)).toBeUndefined();
  });
});
