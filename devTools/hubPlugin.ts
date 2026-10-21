/* eslint-disable no-console */
import fs from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import type { Plugin } from 'vite';
import { getHostAndOriginError } from './hostCheck';
import { extractApiModelInChildProcess, isApiInputFile } from './hub/api/extract';
import { isApiPagePath } from './hub/api/model';
import { buildHub } from './hub/build';
import { getProjectMetadata, type ProjectMetadata } from './projectMetadata';
import {
  HUB_API_REBUILDING_STATUS,
  HUB_DEV_EVENT,
  HUB_DEV_SOCKET_PLACEHOLDER,
} from './hub/devProtocol';
import { createHubDevRunner } from './hub/devRunner';
import {
  HUB_CONFIG_FILE,
  HUB_DEV_OUT_DIR,
  HUB_DEV_URL_BASE,
  HUB_DIR,
  toRepoPath,
} from './hub/paths';
import { getHubContentType, resolveHubRoute } from './hub/serve';

/**
 * The Ækasha Hub in the dev server: serves `/hub/` from `.cache/hub/dev/` and keeps it current
 * while `yarn dev` runs. Dev server only, never in a build. `AEK_HUB=false` turns it off. The runs,
 * their events and the API docs' state are `createHubDevRunner`'s (`hub/devRunner.ts`); this wires
 * them to the server: the watchers, the HMR socket and the middleware.
 * - `hub/` is watched with `fs.watch`, not Vite's watcher: Vite logs every watched `.html` save
 *   as a "page reload", clearing the terminal, and sends a `full-reload`. The build's sources
 *   outside `hub/` (`package.json`, `CHANGELOG.md`, `docs/issues/*.md`) and the folders whose new
 *   files it reads (`docs/issues/`) go through Vite's watcher. `hub/hub.config.ts` and the
 *   generator are Vite config dependencies: a change restarts the server, and the open pages
 *   reload once it's back.
 * - A page with an error is served as an error page (`buildHub`), and the terminal gets the
 *   errors and warnings that are new since the last run.
 * - An API page requested while the API docs are stale gets the rebuilding page
 *   (`HUB_API_REBUILDING_STATUS`), which reloads on the `api` event. The builds take the last good
 *   model (`api: 'last'`, from the cache file at first).
 */

const RED = '\x1b[31m';
const RESET = '\x1b[0m';

const getPathname = (req: IncomingMessage) => {
  try {
    return decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
  } catch {
    return null; // A malformed escape
  }
};

const sendText = (res: ServerResponse, status: number, text: string) => {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' }).end(text);
};

export const hubPlugin = (): Plugin => {
  /** Stops the watching and the pending run: on the HTTP server's close, or in middleware mode
   * (no HTTP server) on Vite's `closeBundle` when the dev server closes (H3) */
  let dispose = () => {};
  return {
    name: 'vite-plugin-aek-hub',
    apply: 'serve',
    closeBundle() {
      dispose();
    },
    configureServer(server) {
      if (process.env.AEK_HUB === 'false') return;
      const checkOpts = {
        allowedHosts: server.config.server.allowedHosts,
        isHttps: !!server.config.server.https,
      };

      let hubWatcher: fs.FSWatcher | null = null;
      /** The first build's commit, local changes and time, on the Version page until a restart */
      let buildInfo: ProjectMetadata['build'] | undefined;

      const runner = createHubDevRunner({
        buildAsync: (last) => {
          buildInfo ??= getProjectMetadata().build;
          return buildHub({
            mode: 'dev',
            outDir: HUB_DEV_OUT_DIR,
            basePath: HUB_DEV_URL_BASE,
            fallback: last?.assets,
            build: buildInfo,
            api: 'last',
          });
        },
        extractApiAsync: extractApiModelInChildProcess,
        start: () => {
          // Pages of an earlier session may be gone from hub/ since
          fs.rmSync(HUB_DEV_OUT_DIR, { recursive: true, force: true });
          hubWatcher = fs.watch(HUB_DIR, { recursive: true }, (_event, name) => {
            const file = name ? path.join(HUB_DIR, name) : HUB_DIR;
            // Vite restarts the server for it (a config dependency): the next request rebuilds
            if (file !== HUB_CONFIG_FILE) runner.onHubFileEvent(file);
          });
          hubWatcher.on('error', (err) =>
            console.error(`${RED}✗ [Hub] Watching hub/ failed:${RESET}`, err)
          );
        },
        watch: (paths) => server.watcher.add(paths),
        send: (data) => server.hot.send({ type: 'custom', event: HUB_DEV_EVENT, data }),
        log: {
          info: (message) => console.log(message),
          warn: (message) => console.warn(message),
          error: (message, err) => (err ? console.error(message, err) : console.error(message)),
        },
        isApiInput: isApiInputFile,
        outDir: HUB_DEV_OUT_DIR,
      });
      for (const event of ['add', 'change', 'unlink']) {
        server.watcher.on(event, (filePath: string) =>
          runner.onWatcherEvent(path.resolve(filePath))
        );
      }

      /** The socket path and token, for the dev client (never written to disk) */
      const socketPath = () =>
        server.config.server.ws === false
          ? ''
          : `${server.config.base}?token=${encodeURIComponent(server.config.webSocketToken)}`;

      const serve = async (pathname: string, res: ServerResponse) => {
        const build = await runner.getBuildAsync();
        const route = resolveHubRoute(HUB_DEV_OUT_DIR, HUB_DEV_URL_BASE, pathname);
        if (route.kind === 'redirect') {
          res.writeHead(301, { Location: route.location }).end();
          return;
        }
        const rebuildingHtml = build.apiRebuildingHtml;
        if (
          rebuildingHtml &&
          isApiPagePath(pathname.slice(HUB_DEV_URL_BASE.length)) &&
          runner.takeApiRebuild()
        ) {
          res.writeHead(HUB_API_REBUILDING_STATUS, {
            'Content-Type': getHubContentType('.html'),
            'Cache-Control': 'no-cache',
            'Retry-After': '5',
          });
          res.end(rebuildingHtml.replace(HUB_DEV_SOCKET_PLACEHOLDER, socketPath()));
          return;
        }
        const file = route.kind === 'file' ? route.file : path.join(HUB_DEV_OUT_DIR, '404.html');
        let content: string | Buffer = fs.readFileSync(file);
        if (file.endsWith('.html')) {
          content = content.toString('utf-8').replace(HUB_DEV_SOCKET_PLACEHOLDER, socketPath());
        }
        res.writeHead(route.kind === 'file' ? 200 : 404, {
          'Content-Type': getHubContentType(file),
          'Cache-Control': 'no-cache',
        });
        res.end(content);
      };

      dispose = () => {
        runner.close();
        hubWatcher?.close();
      };
      server.httpServer?.once('close', dispose);

      server.middlewares.use((req, res, next) => {
        const pathname = getPathname(req);
        if (pathname === null) return next();
        if (pathname !== '/hub' && !pathname.startsWith(HUB_DEV_URL_BASE)) return next();
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          sendText(res, 405, 'The Hub only serves GET and HEAD');
          return;
        }
        // Vite's own host check runs after this, and the pages carry the HMR socket's token
        const hostError = getHostAndOriginError(req, checkOpts);
        if (hostError) {
          sendText(res, 403, hostError.message);
          return;
        }
        serve(pathname, res).catch((err: Error) => {
          console.error(`${RED}✗ [Hub] ${toRepoPath(HUB_DEV_OUT_DIR)}: ${err.message}${RESET}`);
          if (!res.headersSent) sendText(res, 500, `[Hub] ${err.stack ?? err.message}`);
        });
      });
    },
  };
};
