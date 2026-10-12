import { describe, expect, test, vi } from 'vitest';
import { getConfig } from './Config';
import { ECSWorld } from './ECS';
import { ECSSystemStage } from './ECS/SystemStages';
import {
  checkFeatures,
  createFeatureHost,
  type EngineFeature,
  installFeaturesAsync,
  runFeatureDebugHooksAsync,
} from './Features';

vi.mock('../utils/Logger', () => ({ lerror: vi.fn() }));

const feature = (id: string, requires?: string[]): EngineFeature => ({
  id,
  requires,
  install: () => {},
});

describe('checkFeatures', () => {
  test('names `features` when an app leaves it out', () => {
    expect(() => checkFeatures(undefined as unknown as EngineFeature[])).toThrow(
      'InitEngine: `features` is required'
    );
  });

  test('passes a list whose requires are listed earlier', () => {
    expect(() =>
      checkFeatures([feature('physics'), feature('character', ['physics']), feature('app')])
    ).not.toThrow();
  });

  test('fails on an id listed twice', () => {
    expect(() => checkFeatures([feature('skybox'), feature('skybox')])).toThrow(
      "the feature 'skybox' is listed twice"
    );
  });

  test('fails on a required feature listed after, naming both', () => {
    expect(() => checkFeatures([feature('character', ['physics']), feature('physics')])).toThrow(
      "the feature 'character' requires 'physics', which is listed after it"
    );
  });

  test('fails on a required feature not listed, naming both', () => {
    expect(() => checkFeatures([feature('character', ['physics'])])).toThrow(
      "the feature 'character' requires 'physics', which isn't in `features`"
    );
  });
});

describe('installFeaturesAsync', () => {
  test('installs in list order, awaiting each, and isInstalled sees the earlier ones', async () => {
    const host = createFeatureHost(getConfig());
    const log: string[] = [];
    const slow: EngineFeature = {
      id: 'slow',
      install: async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        log.push('slow');
      },
    };
    const next: EngineFeature = {
      id: 'next',
      install: (ctx) => {
        log.push(`next sees slow: ${ctx.isInstalled('slow')}, itself: ${ctx.isInstalled('next')}`);
      },
    };
    await installFeaturesAsync([slow, next], host);
    expect(log).toEqual(['slow', 'next sees slow: true, itself: false']);
    expect([...host.installed]).toEqual(['slow', 'next']);
  });

  test('checks the list before installing anything', async () => {
    const install = vi.fn();
    const host = createFeatureHost(getConfig());
    await expect(
      installFeaturesAsync(
        [
          { id: 'a', install },
          { id: 'a', install },
        ],
        host
      )
    ).rejects.toThrow('listed twice');
    expect(install).not.toHaveBeenCalled();
  });

  test('a failed install rejects with its error and stops the list', async () => {
    const after = vi.fn();
    const host = createFeatureHost(getConfig());
    const broken: EngineFeature = {
      id: 'broken',
      install: () => {
        throw new Error('no GPU');
      },
    };
    await expect(
      installFeaturesAsync([broken, { id: 'after', install: after }], host)
    ).rejects.toThrow('no GPU');
    expect(after).not.toHaveBeenCalled();
    expect(host.installed.has('broken')).toBe(false);
  });

  test("the context's plugins reach the worlds created later", async () => {
    const host = createFeatureHost(getConfig());
    await installFeaturesAsync(
      [
        {
          id: 'plugins',
          install: (ctx) => {
            ctx.registerPlugin((world) => world.addSystem(ECSSystemStage.APP_LOGIC, 'p', () => {}));
            ctx.registerCorePlugin((world) => world.addSystem(ECSSystemStage.MAIN, 'c', () => {}));
          },
        },
      ],
      host
    );
    const bare = new ECSWorld({ id: 'featuresTestBare', applyGlobalPlugins: false });
    const full = new ECSWorld({ id: 'featuresTestFull' });
    expect(bare.getSystemOrder(ECSSystemStage.MAIN).map((s) => s.id)).toContain('c');
    expect(bare.getSystemOrder(ECSSystemStage.APP_LOGIC).map((s) => s.id)).not.toContain('p');
    expect(full.getSystemOrder(ECSSystemStage.APP_LOGIC).map((s) => s.id)).toContain('p');
    ECSWorld.deleteWorld(bare.id);
    ECSWorld.deleteWorld(full.id);
  });
});

describe('debug hooks', () => {
  test('are kept in install order and run in that order, awaiting each', async () => {
    const host = createFeatureHost(getConfig());
    const log: string[] = [];
    await installFeaturesAsync(
      [
        {
          id: 'a',
          install: (ctx) => {
            ctx.onDebug(async () => {
              await new Promise((resolve) => setTimeout(resolve, 5));
              log.push('a');
            });
            ctx.onDebugAfterStart(() => void log.push('a after start'));
          },
        },
        { id: 'b', install: (ctx) => ctx.onDebug(() => void log.push('b')) },
      ],
      host
    );
    expect(log).toEqual([]);
    await runFeatureDebugHooksAsync(host.debugHooks);
    expect(log).toEqual(['a', 'b']);
    await runFeatureDebugHooksAsync(host.debugAfterStartHooks);
    expect(log).toEqual(['a', 'b', 'a after start']);
  });
});

describe('the loop seam', () => {
  test('takes one fixed-step driver, and a second fails', () => {
    const { ctx } = createFeatureHost(getConfig());
    const driver = {
      latch: () => {},
      step: () => {},
      flushEvents: () => {},
      isStepping: () => false,
    };
    expect(() => ctx.setFixedStepDriver(driver)).not.toThrow();
    expect(() => ctx.setFixedStepDriver(driver)).toThrow('a fixed-step driver is already set');
  });
});
