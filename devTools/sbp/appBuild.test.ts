import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';

// p619 §1.4 B4: a failed build's error was replaced by the dev gather's in `finally`, and by its
// plugins' `closeBundle`, which Vite runs after a failed build too

/** Each fake `yarn` run's exit code, from its arguments and env (0 when it returns nothing) */
const { exitCode } = vi.hoisted(() => ({
  exitCode: {
    of: (() => undefined) as (args: string[], env: NodeJS.ProcessEnv) => number | undefined,
  },
}));

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  const spawn = (_cmd: string, args: string[], opts: { env: NodeJS.ProcessEnv }) => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(),
      stderr: new PassThrough(),
    });
    setTimeout(() => {
      child.stdout.end();
      child.stderr.end();
      child.emit('close', exitCode.of(args.slice(1), opts.env) ?? 0);
    }, 0);
    return child;
  };
  return { ...actual, default: { ...actual, spawn }, spawn };
});
vi.mock('../progressLog', () => ({ out: () => {} }));

const { buildBundles } = await import('./appBuild');
const { embedOutputsPlugin } = await import('./embedBuild');
const { assetOutputsBuildPlugin } = await import('../assetOutputsBuildPlugin');

afterEach(() => {
  exitCode.of = () => undefined;
  vi.restoreAllMocks();
});

describe('buildBundles', () => {
  it('throws the build’s error when the dev gather after it fails too', async () => {
    const runs: string[] = [];
    exitCode.of = (args, env) => {
      runs.push(args.join(' '));
      if (args[0] === 'vite') return 1;
      // The production gather passes, the dev gather after the build fails
      if (args[0] === 'gatherAppData' && env.NODE_ENV !== 'production') return 1;
      return 0;
    };
    await expect(buildBundles({ isApp: true, embedIds: [] })).rejects.toThrow(
      'yarn vite build exited with 1'
    );
    expect(runs).toEqual(['copyDecoders', 'gatherAppData', 'vite build', 'gatherAppData']);
  });

  it('gathers the dev data after a build that passed', async () => {
    await expect(buildBundles({ isApp: true, embedIds: [] })).resolves.toBeUndefined();
  });
});

describe('closeBundle after a failed build', () => {
  type Hooks = { buildEnd: (error?: Error) => void; closeBundle: () => void };
  it.each([
    ['the asset outputs plugin', () => assetOutputsBuildPlugin() as unknown as Hooks],
    [
      'the embed outputs plugin',
      () =>
        embedOutputsPlugin({
          id: 'p619',
          entry: 'src/app/profiles/p619/p619.embed.ts',
          scenes: ['p619'],
        }) as unknown as Hooks,
    ],
  ])('%s does nothing, so the build’s error is the one shown', (_name, create) => {
    const read = vi.spyOn(fs, 'readFileSync');
    const plugin = create();
    plugin.buildEnd(new Error('the build failed'));
    expect(() => plugin.closeBundle()).not.toThrow();
    expect(read).not.toHaveBeenCalled();
  });
});
