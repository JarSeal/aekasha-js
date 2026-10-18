import { describe, expect, test } from 'vitest';

// No window stub: Config.ts reads the environment only in initEnvironment() (p606 Phase 5)
import {
  getConfig,
  getCurrentEnvironment,
  getEnv,
  getStartSceneQueryParam,
  initEnvironment,
  IS_DEBUG_ENV,
  IS_PROD_ENV,
  IS_PROD_TEST_MODE,
  loadConfig,
} from './Config';

describe('initEnvironment', () => {
  // First in the file: nothing has called initEnvironment yet
  test('before it runs, the flags read as production', () => {
    expect(getCurrentEnvironment()).toBe('production');
    expect(IS_DEBUG_ENV).toBe(false);
    expect(IS_PROD_TEST_MODE).toBe(false);
    expect(IS_PROD_ENV).toBe(true);
    expect(getStartSceneQueryParam()).toBe(null);
  });

  test('?isDebug=true turns the debug env on in development, and the flags are live', () => {
    initEnvironment({
      search: '?isDebug=true&startScene=physicsTiers',
      env: { VITE_APP_ENV: 'development' },
    });
    expect(getCurrentEnvironment()).toBe('development');
    expect(IS_DEBUG_ENV).toBe(true);
    expect(IS_PROD_TEST_MODE).toBe(false);
    expect(IS_PROD_ENV).toBe(false);
    expect(getStartSceneQueryParam()).toBe('physicsTiers');
  });

  test('?isProdTest=true turns prod test mode on in test', () => {
    initEnvironment({ search: '?isProdTest=true', env: { VITE_APP_ENV: 'test' } });
    expect(getCurrentEnvironment()).toBe('test');
    expect(IS_DEBUG_ENV).toBe(false);
    expect(IS_PROD_TEST_MODE).toBe(true);
    expect(IS_PROD_ENV).toBe(true);
  });

  test('a production build ignores the URL params', () => {
    initEnvironment({ search: '?isDebug=true&isProdTest=true&startScene=physicsTiers', env: {} });
    expect(getCurrentEnvironment()).toBe('production');
    expect(IS_DEBUG_ENV).toBe(false);
    expect(IS_PROD_TEST_MODE).toBe(false);
    expect(getStartSceneQueryParam()).toBe(null);
  });
});

describe('loadConfig', () => {
  test('takes the app config as given (no engine defaults) and parses the env vars into a copy', () => {
    const env = { VITE_PHYS_GRAVITY: '0,-3,x' };
    initEnvironment({ search: '', env });
    loadConfig({ physics: { enabled: true }, undoRedo: { historySize: 7 } });

    const config = getConfig();
    expect(config.physics?.enabled).toBe(true);
    // A missing key stays missing: its reader defaults it (PhysicsState.ts' facade.state)
    expect(config.physics?.workerTarget).toBeUndefined();
    expect(config.physics?.gravity).toEqual({ x: 0, y: -3, z: 0 });
    expect(config.undoRedo?.historySize).toBe(7);
    expect(config.ecs?.storageMode).toBeUndefined();
    expect(config.debugCamera).toBeUndefined();
    expect(getEnv('VITE_PHYS_GRAVITY')).toEqual({ x: 0, y: -3, z: 0 });
    expect(env.VITE_PHYS_GRAVITY).toBe('0,-3,x');
  });

  test('the env overrides go into copies: the app’s own section objects stay as they were', () => {
    initEnvironment({
      search: '',
      env: { VITE_PHYS_ENABLED: 'true', VITE_ECS_STORAGE_MODE: 'TYPED_ARRAY' },
    });
    const physics = { enabled: false, timestep: 30 };
    const ecs = { maxEntities: 500 };
    loadConfig({ physics, ecs });

    expect(getConfig().physics).toEqual({ enabled: true, timestep: 30 });
    expect(getConfig().ecs).toEqual({ maxEntities: 500, storageMode: 'TYPED_ARRAY' });
    expect(physics).toEqual({ enabled: false, timestep: 30 });
    expect(ecs).toEqual({ maxEntities: 500 });
  });
});
