import { describe, expect, it, vi } from 'vitest';

// localStorage before anything reads it (the storage helpers check it once): items as own
// properties, as the browser's
const ls = vi.hoisted(() => {
  type Items = { [key: string]: string };
  const storage = Object.create({
    getItem(this: Items, key: string) {
      return Object.prototype.hasOwnProperty.call(this, key) ? this[key] : null;
    },
    setItem(this: Items, key: string, value: string) {
      this[key] = String(value);
    },
    removeItem(this: Items, key: string) {
      delete this[key];
    },
  }) as Storage & Items;
  vi.stubGlobal('localStorage', storage);
  return storage;
});

// Only the two scene ids the loader reads: the real module would load the main loop with it
vi.mock(import('./Scene'), () => ({
  getCurrentSceneId: () => 'propScene',
  getLoadingSceneId: () => null,
}));

import { initEnvironment } from '../config/Config';
import { loadPersistentProps } from './PropertyLoader';

// p150: the debugger's saved values over a camera's or light's creation props, read in the debug
// env and prod test mode (only the debugger writes them)

const DEV = { VITE_APP_ENV: 'development' };

const saveValues = () => {
  ls.setItem(
    'AEK_debugCams',
    JSON.stringify({ propScene: { cams: { propCam: { fov: 30 } }, debugCam: {} } })
  );
  ls.setItem(
    'AEK_debugLights',
    JSON.stringify({ propScene: { lights: { propLamp: { intensity: 4 } } } })
  );
};

describe('loadPersistentProps', () => {
  // First in the file: before initEnvironment every flag reads as production
  it('merges nothing in production, and returns a copy', () => {
    saveValues();
    const props = { appId: 'propCam', fov: 60 };
    const loaded = loadPersistentProps(props, 'CAMERA');
    expect(loaded).toEqual({ appId: 'propCam', fov: 60 });
    expect(loaded).not.toBe(props);
  });

  it('merges the saved values over the props in the debug env', () => {
    initEnvironment({ search: '?isDebug=true', env: DEV });
    saveValues();
    expect(loadPersistentProps({ appId: 'propCam', fov: 60 }, 'CAMERA')).toEqual({
      appId: 'propCam',
      fov: 30,
    });
    expect(loadPersistentProps({ appId: 'propLamp', intensity: 1 }, 'LIGHT')).toEqual({
      appId: 'propLamp',
      intensity: 4,
    });
  });

  it('merges them in prod test mode too', () => {
    initEnvironment({ search: '?isProdTest=true', env: DEV });
    saveValues();
    expect(loadPersistentProps({ appId: 'propCam', fov: 60 }, 'CAMERA').fov).toBe(30);
    expect(loadPersistentProps({ appId: 'propLamp', intensity: 1 }, 'LIGHT').intensity).toBe(4);
  });

  it('keeps the props without an app id or a saved entry', () => {
    initEnvironment({ search: '?isDebug=true', env: DEV });
    saveValues();
    const props = { fov: 60 };
    expect(loadPersistentProps(props, 'CAMERA')).toBe(props);
    expect(loadPersistentProps({ appId: 'otherCam', fov: 60 }, 'CAMERA')).toEqual({
      appId: 'otherCam',
      fov: 60,
    });
  });
});
