import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  vi.stubGlobal('localStorage', {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  });
});

// The implementation talks to the dev server: only its listener entry point, recorded
const devFiles = vi.hoisted(() => {
  const remove = vi.fn();
  return { remove, _onDevDataGathered: vi.fn(() => remove) };
});
vi.mock(import('./_dbg__DevFiles'), () => devFiles as never);

// The Debug tools tab's "File server" setting
const tools = vi.hoisted(() => ({ saveHistorySize: undefined as unknown }));
vi.mock(import('./DebugTools'), async (importOriginal) => ({
  ...(await importOriginal()),
  getDebugToolsState: () => ({ devFiles: { saveHistorySize: tools.saveHistorySize } }) as never,
}));

import { initEnvironment, loadConfig } from '../kernel/config/Config';
import {
  DEFAULT_SAVE_HISTORY_SIZE,
  getDevFilesSaveHistorySize,
  onDevDataGathered,
} from './DevFiles';

const DEBUG = { search: '?isDebug=true', env: { VITE_APP_ENV: 'development' } };

describe('dev files: the save history size (p618 D11)', () => {
  it('reads the Debug tools setting, then the app config, then the default', () => {
    initEnvironment(DEBUG);
    loadConfig({ devFiles: { saveHistorySize: 5 } });

    tools.saveHistorySize = 7;
    expect(getDevFilesSaveHistorySize()).toBe(7);
    tools.saveHistorySize = Number.NaN;
    expect(getDevFilesSaveHistorySize()).toBe(5);
    tools.saveHistorySize = undefined;
    expect(getDevFilesSaveHistorySize()).toBe(5);

    loadConfig({});
    expect(getDevFilesSaveHistorySize()).toBe(DEFAULT_SAVE_HISTORY_SIZE);

    // Below -1 (all of them) is -1, a fraction is rounded
    tools.saveHistorySize = -5;
    expect(getDevFilesSaveHistorySize()).toBe(-1);
    tools.saveHistorySize = 2.6;
    expect(getDevFilesSaveHistorySize()).toBe(3);
    tools.saveHistorySize = undefined;
  });

  it('is 0 outside the debug env', () => {
    initEnvironment({ search: '', env: { VITE_APP_ENV: 'development' } });
    tools.saveHistorySize = 7;
    expect(getDevFilesSaveHistorySize()).toBe(0);
    tools.saveHistorySize = undefined;
  });
});

describe('dev files: onDevDataGathered (p618 D11)', () => {
  it('adds no listener when it was removed before the module loaded', async () => {
    initEnvironment(DEBUG);
    const remove = onDevDataGathered(vi.fn());
    remove();
    await vi.dynamicImportSettled();
    await Promise.resolve();
    expect(devFiles._onDevDataGathered).not.toHaveBeenCalled();
  });

  it('adds the listener once the module has loaded, and removes it', async () => {
    initEnvironment(DEBUG);
    const fn = vi.fn();
    const remove = onDevDataGathered(fn);
    await vi.waitFor(() => expect(devFiles._onDevDataGathered).toHaveBeenCalledWith(fn));
    remove();
    expect(devFiles.remove).toHaveBeenCalledTimes(1);
  });
});

describe('dev files outside the debug env (p618 D11)', () => {
  it('reports itself unavailable, and a write rejects with UNAVAILABLE', async () => {
    vi.resetModules();
    const config = await import('../kernel/config/Config');
    config.initEnvironment({ search: '?isDebug=true', env: {} });
    const fresh = await import('./DevFiles');

    await expect(fresh.getDevFilesStatus()).resolves.toMatchObject({
      available: false,
      reason: 'NOT_DEBUG_ENV',
    });
    await expect(fresh.writeDevFiles([])).rejects.toMatchObject({
      name: 'DevFilesError',
      code: 'UNAVAILABLE',
    });
  });
});
