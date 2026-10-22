import { isIP } from 'net';
import { networkInterfaces } from 'os';
import type { IncomingMessage } from 'http';

/**
 * The dev server's Host and Origin check, for the routes the repo's own Vite plugins add in front
 * of Vite's (`configureServer`'s middlewares run before Vite's host check, which HTTPS turns off
 * anyway): the dev files (`devFiles/security.ts`) and the Hub's dev pages (`hubPlugin.ts`), which
 * carry the HMR socket's token. It keeps out a DNS-rebinding page: a name that isn't this
 * machine's. Moved out of `devFiles/` (p619 §1.4 F6): both plugins use it.
 */

/** The header's value; under HTTP/2 (`dev:https`) the host is `:authority` */
const getHostHeader = (req: IncomingMessage) => {
  const value = req.headers.host ?? req.headers[':authority'];
  return typeof value === 'string' ? value : undefined;
};

/** `example.com:8080` → `example.com`, `[::1]:8080` → `::1` */
const toHostName = (host: string) => {
  if (host.startsWith('[')) return host.slice(1, host.indexOf(']')).toLowerCase();
  const colon = host.indexOf(':');
  return (colon === -1 ? host : host.slice(0, colon)).toLowerCase();
};

const normaliseAddress = (address: string) =>
  address.startsWith('::ffff:') ? address.slice('::ffff:'.length) : address;

/** An IP address in 127.0.0.0/8 or ::1 (an IPv4-mapped one too); a host name never is */
export const isLoopbackAddress = (address: string | undefined) => {
  if (!address) return false;
  const normalised = normaliseAddress(address);
  if (normalised === '::1') return true;
  return isIP(normalised) === 4 && normalised.startsWith('127.');
};

/**
 * `localhost`, a `*.localhost` name (both resolve to loopback, RFC 6761) or a loopback IP. Not any
 * name starting with "127.": `127.attacker.com` is a DNS name its owner points anywhere (F2).
 */
const isLoopbackHostName = (name: string) =>
  name === 'localhost' || name.endsWith('.localhost') || isLoopbackAddress(name);

/** The machine's own addresses, read per request: a DHCP lease can change them */
const isOwnAddress = (name: string) =>
  Object.values(networkInterfaces()).some((infos) =>
    infos?.some((info) => normaliseAddress(info.address).toLowerCase() === name)
  );

/** Vite's `server.allowedHosts` rules: an exact name, or `.example.com` for it and subdomains */
const isInAllowedHosts = (name: string, allowedHosts: string[] | true) => {
  if (allowedHosts === true) return true;
  return allowedHosts.some((allowed) => {
    const entry = allowed.toLowerCase();
    if (!entry.startsWith('.')) return entry === name;
    return name === entry.slice(1) || name.endsWith(entry);
  });
};

/** The server's settings the check reads */
export type RequestCheckOpts = {
  allowedHosts: string[] | true;
  isHttps: boolean;
};

/** Why a request's Host or Origin isn't this server's, or null when both are */
export const getHostAndOriginError = (
  req: IncomingMessage,
  opts: RequestCheckOpts
): { code: 'BAD_HOST' | 'BAD_ORIGIN'; message: string } | null => {
  const host = getHostHeader(req);
  const name = host ? toHostName(host) : '';
  if (
    !name ||
    !(isLoopbackHostName(name) || isOwnAddress(name) || isInAllowedHosts(name, opts.allowedHosts))
  ) {
    return {
      code: 'BAD_HOST',
      message: `The Host "${host ?? ''}" isn't this machine or in server.allowedHosts`,
    };
  }
  const origin = req.headers.origin;
  if (origin !== undefined) {
    const ownOrigin = `${opts.isHttps ? 'https' : 'http'}://${host}`.toLowerCase();
    if (origin.toLowerCase() !== ownOrigin) {
      return { code: 'BAD_ORIGIN', message: `The Origin "${origin}" isn't ${ownOrigin}` };
    }
  }
  return null;
};
