/**
 * The verify commands' own dev server (`yarn verify:scenes`, `yarn verify:ui`): `vite.config.ts`
 * on `localhost`, port 8092 or the next free one, with its own dependency cache, so a run never
 * shares one with a `yarn dev*` (p619 V3).
 */
import path from 'path';
import type { Logger } from 'vite';
import { ROOT } from '../paths';
import { out } from '../progressLog';

const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

/** Vite's own lines that explain a page reloading mid-run (p619 V3): its dep optimizer's (a
 * new dependency found at runtime, a re-optimize) and its page reloads */
const VITE_RELOAD_LINE = /dependenc|optimiz|page reload/i;

/** Vite's logger at `warn`, but its lines about optimizing and reloading go to the progress log
 * too (`logLevel: 'warn'` hid them, so a reload mid-run had no trace) */
const createRunnerLogger = (createLogger: typeof import('vite').createLogger): Logger => {
  const logger = createLogger('warn');
  logger.info = (msg) => {
    if (VITE_RELOAD_LINE.test(msg.replace(/\x1b\[[0-9;]*m/g, '')))
      out(`${DIM}[vite]${RESET} ${msg}`);
  };
  return logger;
};

/** The runners' own dep cache (p619 V3): `node_modules/.vite` is every `yarn dev*`'s, and
 * `dev:https` (another plugin, another config hash) re-optimizes under it */
const VERIFY_CACHE_DIR = path.join(ROOT, 'node_modules/.vite-verify');

/**
 * Starts the server in the development env (a shell's `VITE_APP_ENV` unset: only a development
 * or test build installs the test bridge, so in another every scene would wait 120 s for it,
 * p619 §1.4 V2), without `AEK_DEV_HTTPS`.
 * @throws when the shell's `VITE_APP_ENV` is another env, or the server has no port
 */
export const startVerifyServerAsync = async () => {
  const env = process.env.VITE_APP_ENV;
  if (env && env !== 'development' && env !== 'test') {
    throw new Error(
      `VITE_APP_ENV=${env}: the runner's server needs development or test (unset it)`
    );
  }
  process.env.VITE_APP_ENV ??= 'development';
  delete process.env.AEK_DEV_HTTPS;
  const { createServer, createLogger } = await import('vite');
  const server = await createServer({
    configFile: path.join(ROOT, 'vite.config.ts'),
    cacheDir: VERIFY_CACHE_DIR,
    // This machine only: the app's dev server is on the LAN (`--host`), the runner's needn't be
    server: { port: 8092, host: 'localhost' },
    customLogger: createRunnerLogger(createLogger),
  });
  await server.listen();
  const address = server.httpServer?.address();
  if (!address || typeof address === 'string') throw new Error('The server has no port');
  return { server, url: `http://localhost:${address.port}` };
};
