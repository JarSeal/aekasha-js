/**
 * The template app's production bundle, as `yarn build` makes it without `tsc` and the Hub
 * (decoders, the production gather, `vite build`, then the dev gather again), with its output in
 * the progress log: what `yarn verify:baselines` and `yarn sbp --profile app` measure.
 */
import { spawn } from 'child_process';
import { ROOT } from '../assetPipeline/sources';
import { out } from '../verify/progressLog';

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

/** `yarn build`'s bundle steps into `dist/` and `dist-stats/`; the dev data is gathered again
 * whatever happens */
export const buildAppBundle = async () => {
  try {
    await runYarn(['copyDecoders']);
    await runYarn(['gatherAppData'], { NODE_ENV: 'production' });
    // Set, not inherited: a shell's `development` would build the debug code in (`__AEK_DEBUG__`)
    await runYarn(['vite', 'build'], { VITE_APP_ENV: 'production' });
  } finally {
    await runYarn(['gatherAppData']);
  }
};
