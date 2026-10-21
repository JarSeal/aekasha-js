import { randomBytes, timingSafeEqual } from 'crypto';
import type { IncomingMessage } from 'http';
import { getHostAndOriginError, isLoopbackAddress, type RequestCheckOpts } from '../hostCheck';
import { DevFilesError } from './http';
import { DEV_FILES_TOKEN_HEADER } from '../../src/_engine/debug/DevFilesProtocol';

/**
 * The checks a request passes before a route runs (p342 §2.2). Two threats: another device on
 * the LAN (every `dev*` script serves with `--host`), and any website open in the developer's
 * browser. A simple cross-origin POST is sent without a preflight, and a DNS-rebinding page is
 * even same-origin, so:
 * - the token (per server start, in `index.html`) keeps out a cross-origin page: it can't read
 *   the HTML, and the custom header forces a preflight that gets no CORS answer;
 * - the Host check keeps out a rebound page, which can read the token;
 * - the remote address check keeps out the LAN unless it's allowed. A request that came through
 *   a proxy (a localhost tunnel: ngrok, VS Code's port forwarding) arrives on a loopback socket
 *   too, so one carrying a proxy header isn't local (p619 §1.4 F4).
 * Vite's own host check runs after these routes (configureServer's middlewares come first), and
 * not at all under HTTPS, so it doesn't cover them.
 */

export const createDevFilesToken = () => randomBytes(32).toString('hex');

/** BAD_HOST and BAD_ORIGIN, for every route (`hostCheck.ts`) */
export const checkHostAndOrigin = (req: IncomingMessage, opts: RequestCheckOpts) => {
  const error = getHostAndOriginError(req, opts);
  if (error) throw new DevFilesError(error.code, error.message);
};

/** The headers a proxy or tunnel adds: their request came from somewhere else */
const PROXY_HEADERS = ['forwarded', 'x-forwarded-for', 'x-forwarded-host', 'x-real-ip', 'via'];

/**
 * A request from this machine: on a loopback socket, and without a proxy header (a tunnel to
 * localhost forwards other machines' requests on a loopback socket)
 */
export const isLocalRequest = (req: IncomingMessage) =>
  isLoopbackAddress(req.socket.remoteAddress) &&
  !PROXY_HEADERS.some((header) => req.headers[header] !== undefined);

/** NOT_LOCAL and BAD_TOKEN, for every route but `status` */
export const checkDeviceAndToken = (
  req: IncomingMessage,
  opts: { token: string; isLANAllowed: boolean }
) => {
  if (!opts.isLANAllowed && !isLocalRequest(req)) {
    throw new DevFilesError(
      'NOT_LOCAL',
      'Dev files take requests from this machine only, not through a proxy or tunnel (AEK_DEV_FILES_LAN=true allows the LAN)'
    );
  }
  const header = req.headers[DEV_FILES_TOKEN_HEADER];
  const given = Buffer.from(typeof header === 'string' ? header : '');
  const expected = Buffer.from(opts.token);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    throw new DevFilesError(
      'BAD_TOKEN',
      `The ${DEV_FILES_TOKEN_HEADER} header is missing or wrong`
    );
  }
};
