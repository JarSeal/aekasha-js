import type { IncomingMessage } from 'node:http';
import { describe, expect, it } from 'vitest';
import { checkHostAndOrigin, isLoopbackAddress } from './security';

const request = (host: string) =>
  ({ headers: { host }, socket: { remoteAddress: '127.0.0.1' } }) as unknown as IncomingMessage;

const OPTS = { allowedHosts: [], isHttps: false };

const hostCheck = (host: string) => () => checkHostAndOrigin(request(host), OPTS);

describe('checkHostAndOrigin', () => {
  it.each(['localhost:8080', 'app.localhost:8080', '127.0.0.1:8080', '[::1]:8080'])(
    'takes the loopback Host %s',
    (host) => {
      expect(hostCheck(host)).not.toThrow();
    }
  );

  it('refuses another machine’s name', () => {
    expect(hostCheck('example.com:8080')).toThrow(/isn't this machine/);
  });

  // p619 Phase 0 (§1.4 F2): any name starting "127." passes as a loopback address
  it.fails.each(['127.attacker.com:8080', '127.0.0.1.nip.io:8080'])(
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
});
