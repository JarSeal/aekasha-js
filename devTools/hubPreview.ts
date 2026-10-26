/* eslint-disable no-console -- a command's own output */
import fs from 'node:fs';
import path from 'node:path';
import { HUB_DIST_DIR, ROOT } from './hub/paths';
import { createHubPreviewServer } from './hub/previewServer';

/**
 * `yarn hub:preview [--base /hub/] [--port 8090] [--dir dist-hub]`: serves the built Hub as a
 * static host would (`hub/previewServer.ts`, which `yarn verify:ui` serves its build with too).
 * `--base` serves it under a path, as `AEK_HUB_IN_DIST` does (`/hub/`). It listens on `localhost`
 * only, as it logs (p619 §1.4 H2).
 */

const parseArgs = (args: string[]) => {
  const opts = { base: '/', port: 8090, dir: HUB_DIST_DIR };
  for (let i = 0; i < args.length; i += 2) {
    const value = args[i + 1];
    if (args[i] === '--base' && value)
      opts.base = `/${value.replace(/^\/+|\/+$/g, '')}/`.replace('//', '/');
    else if (args[i] === '--port' && value) opts.port = Number(value);
    else if (args[i] === '--dir' && value) opts.dir = path.resolve(ROOT, value);
    else throw new Error(`Unknown argument "${args[i]}"`);
  }
  return opts;
};

const { base, port, dir } = parseArgs(process.argv.slice(2));
if (!fs.existsSync(path.join(dir, 'index.html'))) {
  console.error(`No Hub build in ${dir}: run yarn hub:build first`);
  process.exit(1);
}

createHubPreviewServer(dir, base).listen(port, 'localhost', () =>
  console.log(`[Hub] ${path.relative(ROOT, dir)}/ at http://localhost:${port}${base}`)
);
