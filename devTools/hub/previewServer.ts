/* eslint-disable no-console -- a server's own lines: a request it couldn't serve */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { ROOT } from './paths';
import { getHubContentType, resolveHubRoute } from './serve';
import { rebaseNotFoundPage } from './shellPages';

/**
 * A built Hub served as a static host would (`yarn hub:preview`, `yarn verify:ui`): a directory
 * URL serves its `index.html`, anything missing gets `404.html` with a 404, and `_assets/` is
 * cached as `_headers` has it. `base` serves it under a path (`/hub/`). A bad request (a malformed
 * escape) is a 400 and a throw a 500, never the end of the server. The caller listens.
 * @param dir the build's folder, holding `index.html` and `404.html`
 * @param base the site root's URL path, with both slashes (`/`, `/hub/`)
 */
export const createHubPreviewServer = (dir: string, base: string) => {
  /** Cached as `_headers` caches them on Netlify: every reference to one carries its `?v=` */
  const assetsDir = path.join(dir, '_assets') + path.sep;

  const send = (res: http.ServerResponse, status: number, file: string) => {
    res.writeHead(status, {
      'Content-Type': getHubContentType(file),
      ...(file.startsWith(assetsDir) && {
        'Cache-Control': 'public, max-age=31536000, immutable',
      }),
    });
    fs.createReadStream(file)
      .on('error', (err) => {
        // Gone or unreadable since the route was resolved: the headers are out, so end it
        console.error(`[Hub] ${path.relative(ROOT, file)}: ${err.message}`);
        res.destroy(err);
      })
      .pipe(res);
  };

  const sendText = (res: http.ServerResponse, status: number, text: string) => {
    res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' }).end(text);
  };

  const handle = (req: http.IncomingMessage, res: http.ServerResponse) => {
    let pathname: string;
    try {
      pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
    } catch {
      sendText(res, 400, 'Bad request: the URL has a malformed escape');
      return;
    }
    const route = resolveHubRoute(dir, base, pathname);
    if (route.kind === 'redirect') {
      res.writeHead(301, { Location: route.location }).end();
    } else if (route.kind === 'file') {
      send(res, 200, route.file);
    } else {
      const html = fs.readFileSync(path.join(dir, '404.html'), 'utf-8');
      res.writeHead(404, { 'Content-Type': getHubContentType('404.html') });
      res.end(rebaseNotFoundPage(html, base));
    }
  };

  return http.createServer((req, res) => {
    try {
      handle(req, res);
    } catch (err) {
      console.error(`[Hub] ${req.url}: ${(err as Error).stack ?? String(err)}`);
      if (!res.headersSent)
        sendText(res, 500, 'The preview failed on this request: see the terminal');
      else res.destroy();
    }
  });
};
