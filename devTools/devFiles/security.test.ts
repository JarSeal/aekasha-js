import type { IncomingMessage } from 'node:http';
import { describe, expect, it } from 'vitest';
import { isLoopbackAddress } from '../hostCheck';
import { checkDeviceAndToken, checkHostAndOrigin, isLocalRequest } from './security';

const request = (
  host: string,
  opts: { remoteAddress?: string; headers?: Record<string, string> } = {}
) =>
  ({
    headers: { host, ...opts.headers },
    socket: { remoteAddress: opts.remoteAddress ?? '127.0.0.1' },
  }) as unknown as IncomingMessage;

const OPTS = { allowedHosts: [], isHttps: false };

const hostCheck = (host: string) => () => checkHostAndOrigin(request(host), OPTS);

describe('checkHostAndOrigin', () => {
  it.each(['localhost:8080', 'app.localhost:8080', '127.0.0.1:8080', '127.1.2.3', '[::1]:8080'])(
    'takes the loopback Host %s',
    (host) => {
      expect(hostCheck(host)).not.toThrow();
    }
  );

  it('refuses another machine’s name', () => {
    expect(hostCheck('example.com:8080')).toThrow(/isn't this machine/);
  });

  // p619 §1.4 F2: any name starting "127." passed as a loopback address
  it.each(['127.attacker.com:8080', '127.0.0.1.nip.io:8080', '127.0.0.1.:8080'])(
    'refuses the DNS name %s',
    (host) => {
      expect(hostCheck(host)).toThrow(/isn't this machine/);
    }
  );
});

describe('isLoopbackAddress', () => {
  it.each(['127.0.0.1', '127.1.2.3', '::1', '::ffff:127.0.0.1'])('%s is loopback', (address) => {
    expect(isLoopbackAddress(address)).toBe(true);
  });

  it.each(['127.attacker.com', '10.0.0.2', '::2', '', undefined])('%s is not', (address) => {
    expect(isLoopbackAddress(address)).toBe(false);
  });
});

// p619 §1.4 F4: a localhost tunnel forwards other machines' requests on a loopback socket
describe('isLocalRequest', () => {
  it('takes a loopback socket without a proxy header', () => {
    expect(isLocalRequest(request('localhost:8080'))).toBe(true);
  });

  it('refuses a LAN address', () => {
    expect(isLocalRequest(request('localhost:8080', { remoteAddress: '192.168.1.20' }))).toBe(
      false
    );
  });

  it.each([
    ['forwarded', 'for=203.0.113.7'],
    ['x-forwarded-for', '203.0.113.7'],
    ['x-forwarded-host', 'abc.ngrok.app'],
    ['x-real-ip', '203.0.113.7'],
    ['via', '1.1 tunnel'],
  ])('refuses a loopback socket with %s', (header, value) => {
    expect(isLocalRequest(request('localhost:8080', { headers: { [header]: value } }))).toBe(false);
  });

  it('so a tunnelled write is NOT_LOCAL before its token is read', () => {
    const tunnelled = request('localhost:8080', { headers: { 'x-forwarded-for': '203.0.113.7' } });
    expect(() => checkDeviceAndToken(tunnelled, { token: 'x', isLANAllowed: false })).toThrow(
      /this machine only/
    );
  });
});
