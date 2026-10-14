/**
 * The production bundles, as `yarn build` makes the template app's without `tsc` and the Hub
 * (decoders, the production gather, `vite build`, then the dev gather again), with their output in
 * the progress log: what `yarn verify:baselines` and `yarn sbp` measure. An embed profile's is
 * `vite build` with `AEK_EMBED_PROFILE` (`embedBuild.ts`), on the same production gather.
 */
import { spawn } from 'child_process';
import { ROOT } from '../assetPipeline/sources';
import { out } from '../verify/progressLog';
import { EMBED_PROFILE_ENV } from './embedBuild';

const DIM = process.env.NO_COLOR ? '' : '\x1b[2m';
const RESET = process.env.NO_COLOR ? '' : '\x1b[0m';

/** Runs `yarn <args>`, its output into the progress log */
export const runYarn = (args: string[], env: Record<string, string> = {}) =>
  new Promise<void>((resolve, reject) => {
    out(
      `${DIM}$ ${Object.entries(env)
        .map(([k, v]) => `${k}=${v} `)
        .join('')}yarn ${args.join(' ')}${RESET}`
    );
    const child = spawn('yarn', ['-s', ...args], { cwd: ROOT, env: { ...process.env, ...env } });
    const pipe = (stream: NodeJS.ReadableStream, isError: boolean) => {
      let pending = '';
      stream.on('data', (data: Buffer) => {
        const lines = (pending + data.toString()).split('\n');
        pending = lines.pop() ?? '';
        for (const line of lines) out(`  ${line}`, isError);
      });
      stream.on('end', () => pending && out(`  ${pending}`, isError));
    };
    pipe(child.stdout, false);
    pipe(child.stderr, true);
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`yarn ${args.join(' ')} exited with ${code}`))
    );
  });

/**
 * Builds the app (`yarn build`'s bundle steps into `dist/` and `dist-stats/`) and the embed
 * profiles (into `dist-embed/<id>/`), on one production gather; the dev data is gathered again
 * whatever happens.
 * @param opts.isApp whether the app is built
 * @param opts.embedIds the embed profiles built, in order
 */
export const buildBundles = async (opts: { isApp: boolean; embedIds: readonly string[] }) => {
  try {
    await runYarn(['copyDecoders']);
    await runYarn(['gatherAppData'], { NODE_ENV: 'production' });
    // Set, not inherited: a shell's `development` would build the debug code in (`__AEK_DEBUG__`)
    if (opts.isApp) await runYarn(['vite', 'build'], { VITE_APP_ENV: 'production' });
    for (const id of opts.embedIds) {
      await runYarn(['vite', 'build'], { VITE_APP_ENV: 'production', [EMBED_PROFILE_ENV]: id });
    }
  } finally {
    await runYarn(['gatherAppData']);
  }
};

/** The app's bundle alone ({@link buildBundles}) */
export const buildAppBundle = () => buildBundles({ isApp: true, embedIds: [] });
